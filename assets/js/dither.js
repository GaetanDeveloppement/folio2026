const PIXEL_SIZE_DESKTOP = 3;
const PIXEL_SIZE_MOBILE = 2;
const BREAKPOINT_MOBILE = 768;
const BAYER_SIZE = 8;
const PALETTE_SIZE = 8;
const ALPHA_THRESHOLD = 128;
const COLOR_QUANTIZE_SHIFT = 4;
const MIN_COLOR_DISTANCE_SQ = 2500;
const MAX_PALETTE_SAMPLE_SIZE = 200;
const HOVER_DURATION = 1500;
const DISSOLVE_REVEAL_DURATION = 2000;
const DITHER_INIT_ATTR = "data-dither-initialized";
const COLOR_WAVE_LEAD = 1.5;
const HOVER_SPREAD_SCALE = 1.6;
const EASE_SPLIT = 0.2;
const EASING_POWER = 3;

function getPixelSize() {
  return window.innerWidth <= BREAKPOINT_MOBILE
    ? PIXEL_SIZE_MOBILE
    : PIXEL_SIZE_DESKTOP;
}

function isWebGLAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
    );
  } catch (e) {
    return false;
  }
}

let _mouseX = -1;
let _mouseY = -1;
let _lightMode = window.matchMedia("(prefers-color-scheme: light)").matches;
window
  .matchMedia("(prefers-color-scheme: light)")
  .addEventListener("change", function (e) {
    _lightMode = e.matches;
    ditherInstances.forEach(function (dc) {
      dc.render();
    });
  });
document.addEventListener(
  "mousemove",
  function (e) {
    _mouseX = e.clientX;
    _mouseY = e.clientY;
  },
  { passive: true },
);

const VERT = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
        v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
        gl_Position = vec4(a_pos, 0.0, 1.0);
    }
`;

function buildFrag(pixelSize) {
  return `
    precision mediump float;

    uniform sampler2D u_image;
    uniform sampler2D u_bayer;
    uniform sampler2D u_palette;
    uniform vec2      u_resolution;
    uniform float     u_dissolve;
    uniform float     u_hover;
    uniform float     u_reveal;
    uniform float     u_light;

    varying vec2 v_uv;

    float colorDist(vec3 a, vec3 b) {
        vec3 d = a - b;
        return d.r * d.r * 0.299 + d.g * d.g * 0.587 + d.b * d.b * 0.114;
    }

    vec3 paletteColor(float index) {
        return texture2D(u_palette, vec2((index + 0.5) / float(${PALETTE_SIZE}), 0.5)).rgb;
    }

    void main() {
        vec2 pixelCoord = floor(v_uv * u_resolution / ${pixelSize}.0) * ${pixelSize}.0;
        vec2 blockUV    = (pixelCoord + ${pixelSize}.0 * 0.5) / u_resolution;

        vec3  col = texture2D(u_image, blockUV).rgb;
        float lum = dot(col, vec3(0.299, 0.587, 0.114));

        vec2  blockPx = floor(v_uv * u_resolution / ${pixelSize}.0);
        vec2  bayerUV = mod(blockPx, ${BAYER_SIZE}.0) / ${BAYER_SIZE}.0;
        float t       = texture2D(u_bayer, bayerUV).r;

        vec3 bw = mix(vec3(0.0, 0.0, 0.0), vec3(0.9, 0.9, 0.9), step(t, lum));

        vec3 c0 = paletteColor(0.0);
        vec3 c1 = paletteColor(0.0);
        float d0 = 1.0e9;
        float d1 = 1.0e9;

        for (int i = 0; i < ${PALETTE_SIZE}; i++) {
            vec3  pc = paletteColor(float(i));
            float d  = colorDist(col, pc);
            if (d < d0) { d1 = d0; c1 = c0; d0 = d; c0 = pc; }
            else if (d < d1) { d1 = d; c1 = pc; }
        }

        float total = d0 + d1;
        float ratio = (total > 0.0) ? (1.0 - d0 / total) : 0.0;
        vec3 color = (t < ratio) ? c0 : c1;

        vec2  dissolvePx = floor(v_uv * u_resolution / (${pixelSize}.0 * 2.0));
        vec2  dissolveUV = mod(dissolvePx, ${BAYER_SIZE}.0) / ${BAYER_SIZE}.0;
        float dissolveT  = texture2D(u_bayer, dissolveUV).r;

        float colorHover = 1.0;
        vec3 result = (dissolveT < colorHover) ? color : bw;

        vec3 bgDark  = vec3(0.012, 0.012, 0.008);
        vec3 bgLight = vec3(0.953, 0.969, 0.984);
        vec3 bgColor = mix(bgDark, bgLight, u_light);

        if (u_dissolve > 0.0) {
            float dissolveLum = mix(lum, 1.0 - lum, u_light);
            float mask        = step(dissolveLum, u_dissolve * (1.0 + t * 0.4));
            result = mix(result, bgColor, mask);
        }

        float hoverSpread = ${HOVER_SPREAD_SCALE} * u_hover * (1.0 - u_hover);
        float hoverMask = step(max(1.0 - lum, 0.001), u_hover + (t - 0.5) * hoverSpread);
        float a = 1.0 - hoverMask;

        float revealLum   = mix(lum, 1.0 - lum, u_light);
        float revealAlpha = step(revealLum, u_dissolve * (1.0 + t * 0.4));
        gl_FragColor = mix(vec4(result * a, a), vec4(bgColor * revealAlpha, revealAlpha), u_reveal);
    }
`;
}

function easeAsymmetric(p, split, power) {
  if (p < split) {
    return 0.5 * Math.pow(p / split, power);
  }
  return 1 - 0.5 * Math.pow((1 - p) / (1 - split), power);
}

function makeBayerMatrix(n) {
  if (n === 2) {
    return [
      [0, 2],
      [3, 1],
    ];
  }

  const half = makeBayerMatrix(n / 2);
  const m = Array.from({ length: n }, function () {
    return new Array(n);
  });

  for (let y = 0; y < n / 2; y++) {
    for (let x = 0; x < n / 2; x++) {
      const v = half[y][x] * 4;
      m[y][x] = v;
      m[y][x + n / 2] = v + 2;
      m[y + n / 2][x] = v + 3;
      m[y + n / 2][x + n / 2] = v + 1;
    }
  }

  return m;
}

function bayerToUint8(n) {
  const m = makeBayerMatrix(n);
  const data = new Uint8Array(n * n);
  const max = n * n;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      data[y * n + x] = Math.round(((m[y][x] + 0.5) / max) * 255);
    }
  }

  return data;
}

const BAYER_DATA = bayerToUint8(BAYER_SIZE);

function extractPalette(img) {
  const scale = Math.min(
    1,
    MAX_PALETTE_SAMPLE_SIZE / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  if (w === 0 || h === 0) {
    return Array.from({ length: PALETTE_SIZE }, function () {
      return { r: 0, g: 0, b: 0 };
    });
  }

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < ALPHA_THRESHOLD) {
      continue;
    }
    const key =
      ((data[i] >> COLOR_QUANTIZE_SHIFT) << 8) |
      ((data[i + 1] >> COLOR_QUANTIZE_SHIFT) << 4) |
      (data[i + 2] >> COLOR_QUANTIZE_SHIFT);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const sorted = [...counts.entries()].sort(function (a, b) {
    return b[1] - a[1];
  });

  const selected = [];
  for (const [key] of sorted) {
    const r = ((key >> 8) & 0xf) * 17;
    const g = ((key >> 4) & 0xf) * 17;
    const b = (key & 0xf) * 17;
    const tooClose = selected.some(function (c) {
      const dr = r - c.r;
      const dg = g - c.g;
      const db = b - c.b;
      return dr * dr + dg * dg + db * db < MIN_COLOR_DISTANCE_SQ;
    });

    if (!tooClose) {
      selected.push({ r, g, b });
      if (selected.length >= PALETTE_SIZE) {
        break;
      }
    }
  }

  while (selected.length < PALETTE_SIZE) {
    selected.push({ r: 0, g: 0, b: 0 });
  }

  return selected;
}

class DitherCanvas {
  constructor(imgEl, skipReveal = false) {
    this.img = imgEl;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "parallax";
    this.gl = this.canvas.getContext("webgl");

    if (!this.gl) {
      return;
    }

    imgEl.parentElement.appendChild(this.canvas);
    this._setup();

    this.isMobile = window.innerWidth <= BREAKPOINT_MOBILE;
    this.dissolve = 1.0;
    this.hover = 0.0;
    this._rafId = null;
    this._dissolveRafId = null;
    this._pollRafId = null;
    this._hoverActive = false;
    this._hoverStart = null;
    this.textureReady = false;
    this.ro = null;
    this.revealOnly = document.body.dataset.layout === "project";

    if (skipReveal) {
      imgEl.style.visibility = "visible";
    }

    const self = this;

    if (!this.revealOnly && !this.isMobile) {
      function pollHover() {
        if (!self.gl) {
          return;
        }
        let isHovered = false;
        if (_mouseX >= 0) {
          const el = document.elementFromPoint(_mouseX, _mouseY);
          isHovered = el !== null && self.img.parentElement.contains(el);
        }
        if (isHovered !== self._hoverActive) {
          self._hoverActive = isHovered;
          if (isHovered) {
            self._handleEnter();
          } else {
            self._handleLeave();
          }
        }
        self._pollRafId = requestAnimationFrame(pollHover);
      }
      this._pollRafId = requestAnimationFrame(pollHover);
    }

    function onReady() {
      self._uploadTexture();
      if (skipReveal) {
        self.dissolve = 0.0;
      }
      self._resize();
      self.ro = new ResizeObserver(function () {
        self._resize();
      });
      self.ro.observe(imgEl.parentElement);
      if (!skipReveal) {
        imgEl.style.visibility = "visible";
        self.dissolveFromBlack(DISSOLVE_REVEAL_DURATION);
      }
    }

    function onError() {
      self.destroy();
    }

    if (imgEl.complete && imgEl.naturalWidth > 0) {
      onReady();
    } else {
      imgEl.addEventListener("load", onReady);
      imgEl.addEventListener("error", onError);
    }
  }

  _getTwin() {
    const mySrc = this.img.src;
    const self = this;
    return ditherInstances.find(function (dc) {
      return dc !== self && dc.img.src === mySrc;
    });
  }

  _handleEnter() {
    const twin = this._getTwin();
    if (twin) {
      this.hover = twin.hover;
      this.render();
    }
    this._animateOpacity(1);
  }

  _handleLeave() {
    this._animateOpacity(0);
  }

  _setup() {
    const gl = this.gl;

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s));
      }
      return s;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(
      prog,
      compile(gl.FRAGMENT_SHADER, buildFrag(getPixelSize())),
    );
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog));
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    this.prog = prog;

    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.u = {
      image: gl.getUniformLocation(prog, "u_image"),
      bayer: gl.getUniformLocation(prog, "u_bayer"),
      palette: gl.getUniformLocation(prog, "u_palette"),
      resolution: gl.getUniformLocation(prog, "u_resolution"),
      dissolve: gl.getUniformLocation(prog, "u_dissolve"),
      hover: gl.getUniformLocation(prog, "u_hover"),
      reveal: gl.getUniformLocation(prog, "u_reveal"),
      light: gl.getUniformLocation(prog, "u_light"),
    };

    this.bayerTex = this._makeTex(
      BAYER_DATA,
      BAYER_SIZE,
      gl.LUMINANCE,
      gl.REPEAT,
    );

    this.paletteTex = this._makeTex(null, 1, gl.RGB, gl.CLAMP_TO_EDGE);

    this.imgTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  _makeTex(data, size, format, wrap) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    if (data) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        format,
        size,
        size,
        0,
        format,
        gl.UNSIGNED_BYTE,
        data,
      );
    }

    return t;
  }

  _uploadTexture() {
    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.img,
    );

    const palette = extractPalette(this.img);
    const palData = new Uint8Array(
      palette.flatMap(function (c) {
        return [c.r, c.g, c.b];
      }),
    );

    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB,
      PALETTE_SIZE,
      1,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      palData,
    );

    this.textureReady = true;
  }

  _resize() {
    const rect = this.img.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    if (w === 0 || h === 0) {
      return;
    }

    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.viewport(0, 0, w, h);
    gl.uniform2f(this.u.resolution, w, h);
    this.render();
  }

  _tween(prop, target, duration, rafKey) {
    const key = rafKey || "_rafId";
    cancelAnimationFrame(this[key]);
    const start = performance.now();
    const from = this[prop];
    const delta = target - from;
    const self = this;

    return new Promise(function (resolve) {
      function tick(now) {
        const p = Math.min((now - start) / duration, 1.0);
        self[prop] = from + delta * easeAsymmetric(p, EASE_SPLIT, EASING_POWER);
        self.render();
        if (p < 1.0) {
          self[key] = requestAnimationFrame(tick);
        } else {
          resolve();
        }
      }
      self[key] = requestAnimationFrame(tick);
    });
  }

  _animateOpacity(target) {
    this._hoverStart = performance.now();
    this._tween("hover", target, HOVER_DURATION);
  }

  hoverRemaining() {
    if (this._hoverStart === null) {
      return 0;
    }
    return Math.max(0, HOVER_DURATION - (performance.now() - this._hoverStart));
  }

  dissolveToBlack(duration) {
    if (this.canvas) {
      this.canvas.style.display = "";
    }
    this.dissolve = 0;
    return this._tween("dissolve", 1, duration, "_dissolveRafId");
  }

  dissolveFromBlack(duration) {
    this.dissolve = 1.0;
    this.render();
    const self = this;
    return this._tween("dissolve", 0, duration, "_dissolveRafId").then(
      function () {
        if (self.revealOnly && self.canvas) {
          self.canvas.style.display = "none";
        }
      },
    );
  }

  render() {
    if (!this.textureReady) {
      return;
    }

    const gl = this.gl;
    gl.useProgram(this.prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.uniform1i(this.u.image, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bayerTex);
    gl.uniform1i(this.u.bayer, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.uniform1i(this.u.palette, 2);

    gl.uniform1f(this.u.dissolve, this.dissolve);
    gl.uniform1f(this.u.hover, this.hover);
    gl.uniform1f(this.u.reveal, this.revealOnly ? 1.0 : 0.0);
    gl.uniform1f(this.u.light, _lightMode ? 1.0 : 0.0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy() {
    cancelAnimationFrame(this._rafId);
    cancelAnimationFrame(this._dissolveRafId);
    cancelAnimationFrame(this._pollRafId);

    if (this.ro) {
      this.ro.disconnect();
    }

    if (this.gl) {
      const gl = this.gl;
      if (this.imgTex) {
        gl.deleteTexture(this.imgTex);
      }
      if (this.bayerTex) {
        gl.deleteTexture(this.bayerTex);
      }
      if (this.paletteTex) {
        gl.deleteTexture(this.paletteTex);
      }
      if (this.buf) {
        gl.deleteBuffer(this.buf);
      }
      if (this.prog) {
        gl.deleteProgram(this.prog);
      }

      const loseContext = gl.getExtension("WEBGL_lose_context");
      if (loseContext) {
        loseContext.loseContext();
      }

      this.gl = null;
    }

    if (this.canvas && this.canvas.parentElement) {
      this.canvas.remove();
    }

    this.textureReady = false;

    const idx = ditherInstances.indexOf(this);
    if (idx !== -1) {
      ditherInstances.splice(idx, 1);
    }
  }
}

const ditherInstances = [];
window._ditherInstances = ditherInstances;

function initDither(root) {
  if (!root) {
    root = document;
  }

  if (!isWebGLAvailable()) {
    root.querySelectorAll(".dither-wrap img").forEach(function (img) {
      img.style.visibility = "visible";
    });
    return;
  }

  root.querySelectorAll(".dither-wrap img.parallax").forEach(function (img) {
    if (img.hasAttribute(DITHER_INIT_ATTR)) {
      return;
    }

    img.setAttribute(DITHER_INIT_ATTR, "true");

    const skipReveal = img.hasAttribute("data-skip-reveal");
    if (skipReveal) {
      img.removeAttribute("data-skip-reveal");
    }

    ditherInstances.push(new DitherCanvas(img, skipReveal));
  });
}

function destroyAllDither() {
  while (ditherInstances.length > 0) {
    const instance = ditherInstances[0];
    instance.destroy();
  }
}

function dissolveAllToBlack(duration) {
  if (ditherInstances.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(
    ditherInstances.map(function (dc) {
      return dc.dissolveToBlack(duration);
    }),
  );
}

function dissolveAllFromBlack(duration) {
  if (ditherInstances.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(
    ditherInstances.map(function (dc) {
      return dc.dissolveFromBlack(duration);
    }),
  );
}

document.addEventListener("DOMContentLoaded", function () {
  initDither();
});

window.addEventListener("ditherInitClone", function (e) {
  initDither(e.detail);
});

window.initDither = initDither;
window.destroyAllDither = destroyAllDither;
window.dissolveAllToBlack = dissolveAllToBlack;
window.dissolveAllFromBlack = dissolveAllFromBlack;
window.getMaxHoverRemaining = function () {
  return ditherInstances.reduce(function (max, dc) {
    return Math.max(max, dc.hoverRemaining());
  }, 0);
};
