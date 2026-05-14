import { Renderer, Program, Mesh, Texture, Triangle } from "ogl";

const PIXEL_SIZE_DESKTOP = 3;
const PIXEL_SIZE_MOBILE = 2;
const BREAKPOINT_MOBILE = 768;
const BAYER_SIZE = 8;
const PALETTE_SIZE = 32;
const HOVER_SPREAD_SCALE = 2.1;

const HOVER_DURATION = 1500;
const HOVER_EASE_SPLIT = 0.5;
const DISSOLVE_REVEAL_DURATION = 2000;
const EASE_SPLIT = 0.2;
const EASING_POWER = 3;
const COLOR_WAVE_LEAD = 1.5;

const ALPHA_THRESHOLD = 128;
const COLOR_QUANTIZE_SHIFT = 2;
const MIN_COLOR_DISTANCE_SQ = 2500;
const MAX_PALETTE_SAMPLE_SIZE = 200;

const DITHER_INIT_ATTR = "data-dither-initialized";
const SKIP_REVEAL_ATTR = "data-skip-reveal";
const LIGHT_MODE_QUERY = "(prefers-color-scheme: light)";

const ditherInstances = [];

let _mouseX = -1;
let _mouseY = -1;
let _lightMode = window.matchMedia(LIGHT_MODE_QUERY).matches;

document.addEventListener(
  "mousemove",
  function (e) {
    _mouseX = e.clientX;
    _mouseY = e.clientY;
  },
  { passive: true },
);

window.matchMedia(LIGHT_MODE_QUERY).addEventListener("change", function (e) {
  _lightMode = e.matches;
  ditherInstances.forEach(function (dc) {
    dc.render();
  });
});

const VERT = `
    attribute vec2 position;
    attribute vec2 uv;
    varying vec2 v_uv;
    void main() {
        v_uv = vec2(uv.x, 1.0 - uv.y);
        gl_Position = vec4(position, 0.0, 1.0);
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

function getPixelSize() {
  if (window.innerWidth <= BREAKPOINT_MOBILE) {
    return PIXEL_SIZE_MOBILE;
  }
  return PIXEL_SIZE_DESKTOP;
}

function isWebGLAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    );
  } catch (e) {
    return false;
  }
}

function easeAsymmetric(p, split, power) {
  if (p < split) {
    return 0.5 * Math.pow(p / split, power);
  }
  return 1 - 0.5 * Math.pow((1 - p) / (1 - split), power);
}

function easeOut(p) {
  return 1.0 - Math.pow(1.0 - p, EASING_POWER);
}

function defaultTweenEase(p) {
  return easeAsymmetric(p, EASE_SPLIT, EASING_POWER);
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

  const BITS = 8 - COLOR_QUANTIZE_SHIFT;
  const CHANNEL_MASK = (1 << BITS) - 1;

  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < ALPHA_THRESHOLD) {
      continue;
    }
    const key =
      ((data[i] >> COLOR_QUANTIZE_SHIFT) << (2 * BITS)) |
      ((data[i + 1] >> COLOR_QUANTIZE_SHIFT) << BITS) |
      (data[i + 2] >> COLOR_QUANTIZE_SHIFT);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const sorted = [...counts.entries()].sort(function (a, b) {
    return b[1] - a[1];
  });

  const selected = [];
  for (const [key] of sorted) {
    const r = ((key >> (2 * BITS)) & CHANNEL_MASK) << COLOR_QUANTIZE_SHIFT;
    const g = ((key >> BITS) & CHANNEL_MASK) << COLOR_QUANTIZE_SHIFT;
    const b = (key & CHANNEL_MASK) << COLOR_QUANTIZE_SHIFT;
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

function paletteToData(palette) {
  return new Uint8Array(
    palette.flatMap(function (c) {
      return [c.r, c.g, c.b];
    }),
  );
}

function createImageTexture(gl) {
  return new Texture(gl, {
    wrapS: gl.CLAMP_TO_EDGE,
    wrapT: gl.CLAMP_TO_EDGE,
    minFilter: gl.LINEAR,
    magFilter: gl.LINEAR,
    generateMipmaps: false,
    flipY: false,
  });
}

function createDataTexture(gl, options) {
  return new Texture(
    gl,
    Object.assign(
      {
        type: gl.UNSIGNED_BYTE,
        minFilter: gl.NEAREST,
        magFilter: gl.NEAREST,
        generateMipmaps: false,
        flipY: false,
        unpackAlignment: 1,
      },
      options,
    ),
  );
}

class DitherCanvas {
  dissolve = 1.0;
  hover = 0.0;
  textureReady = false;
  _rafId = null;
  _dissolveRafId = null;
  _pollRafId = null;
  _hoverActive = false;
  _hoverStart = null;
  _ro = null;

  constructor(imgEl, skipReveal = false) {
    this.img = imgEl;
    this.skipReveal = skipReveal;
    this.isMobile = window.innerWidth <= BREAKPOINT_MOBILE;
    this.revealOnly = document.body.dataset.layout === "project";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "parallax";

    if (!this._initRenderer()) {
      return;
    }

    imgEl.parentElement.appendChild(this.canvas);
    this._buildPipeline();

    if (skipReveal) {
      imgEl.style.visibility = "visible";
    }

    if (!this.revealOnly && !this.isMobile) {
      this._startHoverPolling();
    }

    this._waitForImage();
  }

  _initRenderer() {
    try {
      this.renderer = new Renderer({
        canvas: this.canvas,
        alpha: true,
        premultipliedAlpha: false,
        depth: false,
        antialias: false,
        autoClear: false,
        dpr: 1,
      });
    } catch (e) {
      this.renderer = null;
    }

    if (!this.renderer || !this.renderer.gl) {
      return false;
    }

    this.canvas.style.width = "";
    this.canvas.style.height = "";
    this.gl = this.renderer.gl;
    return true;
  }

  _buildPipeline() {
    const gl = this.gl;

    this.geometry = new Triangle(gl);

    this.imgTex = createImageTexture(gl);

    this.bayerTex = createDataTexture(gl, {
      image: BAYER_DATA,
      width: BAYER_SIZE,
      height: BAYER_SIZE,
      format: gl.LUMINANCE,
      internalFormat: gl.LUMINANCE,
      wrapS: gl.REPEAT,
      wrapT: gl.REPEAT,
    });

    this.paletteTex = createDataTexture(gl, {
      width: PALETTE_SIZE,
      height: 1,
      format: gl.RGB,
      internalFormat: gl.RGB,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
    });

    this.program = new Program(gl, {
      vertex: VERT,
      fragment: buildFrag(getPixelSize()),
      uniforms: {
        u_image: { value: this.imgTex },
        u_bayer: { value: this.bayerTex },
        u_palette: { value: this.paletteTex },
        u_resolution: { value: [1, 1] },
        u_dissolve: { value: this.dissolve },
        u_hover: { value: this.hover },
        u_reveal: { value: 0 },
        u_light: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      cullFace: null,
    });
    this.program.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.mesh = new Mesh(gl, {
      geometry: this.geometry,
      program: this.program,
    });
  }

  _startHoverPolling() {
    const self = this;
    function tick() {
      if (!self.gl) {
        return;
      }
      const hovered = self._isMouseOver();
      if (hovered !== self._hoverActive) {
        self._hoverActive = hovered;
        if (hovered) {
          self._handleEnter();
        } else {
          self._handleLeave();
        }
      }
      self._pollRafId = requestAnimationFrame(tick);
    }
    this._pollRafId = requestAnimationFrame(tick);
  }

  _isMouseOver() {
    if (_mouseX < 0) {
      return false;
    }
    const el = document.elementFromPoint(_mouseX, _mouseY);
    return el !== null && this.img.parentElement.contains(el);
  }

  _waitForImage() {
    const self = this;
    function onReady() {
      self._onImageReady();
    }
    function onError() {
      self.destroy();
    }
    if (this.img.complete && this.img.naturalWidth > 0) {
      onReady();
      return;
    }
    this.img.addEventListener("load", onReady);
    this.img.addEventListener("error", onError);
  }

  _onImageReady() {
    this._uploadTextures();

    if (this.skipReveal) {
      this.dissolve = 0.0;
    }

    this._resize();

    const self = this;
    this._ro = new ResizeObserver(function () {
      self._resize();
    });
    this._ro.observe(this.img.parentElement);

    if (!this.skipReveal) {
      this.img.style.visibility = "visible";
      this.dissolveFromBlack(DISSOLVE_REVEAL_DURATION);
    }
  }

  _uploadTextures() {
    this.imgTex.image = this.img;
    this.imgTex.needsUpdate = true;

    this.paletteTex.image = paletteToData(extractPalette(this.img));
    this.paletteTex.needsUpdate = true;

    this.textureReady = true;
  }

  _getTwin() {
    const self = this;
    return ditherInstances.find(function (dc) {
      return dc !== self && dc.img.src === self.img.src;
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

  _animateOpacity(target) {
    this._hoverStart = performance.now();
    this._tween("hover", target, HOVER_DURATION, "_rafId", easeOut);
  }

  _tween(prop, target, duration, rafKey, easeFn) {
    const key = rafKey || "_rafId";
    const ease = easeFn || defaultTweenEase;
    cancelAnimationFrame(this[key]);
    const start = performance.now();
    const from = this[prop];
    const delta = target - from;
    const self = this;

    return new Promise(function (resolve) {
      function tick(now) {
        const p = Math.min((now - start) / duration, 1.0);
        self[prop] = from + delta * ease(p);
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

  _resize() {
    const rect = this.img.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    if (w === 0 || h === 0) {
      return;
    }

    this.canvas.width = w;
    this.canvas.height = h;
    this.renderer.width = w;
    this.renderer.height = h;
    this.program.uniforms.u_resolution.value = [w, h];
    this.render();
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
    cancelAnimationFrame(this._pollRafId);
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
    if (!this.textureReady || !this.gl) {
      return;
    }

    this.renderer.setViewport(this.canvas.width, this.canvas.height);

    const u = this.program.uniforms;
    u.u_dissolve.value = this.dissolve;
    u.u_hover.value = this.hover;
    u.u_reveal.value = this.revealOnly ? 1.0 : 0.0;
    u.u_light.value = _lightMode ? 1.0 : 0.0;

    this.mesh.draw();
  }

  destroy() {
    cancelAnimationFrame(this._rafId);
    cancelAnimationFrame(this._dissolveRafId);
    cancelAnimationFrame(this._pollRafId);

    if (this._ro) {
      this._ro.disconnect();
    }

    this._releaseGL();

    if (this.canvas && this.canvas.parentElement) {
      this.canvas.remove();
    }

    this.textureReady = false;

    const idx = ditherInstances.indexOf(this);
    if (idx !== -1) {
      ditherInstances.splice(idx, 1);
    }
  }

  _releaseGL() {
    if (!this.gl) {
      return;
    }

    const gl = this.gl;
    const textures = [this.imgTex, this.bayerTex, this.paletteTex];
    for (const tex of textures) {
      if (tex && tex.texture) {
        gl.deleteTexture(tex.texture);
      }
    }

    if (this.geometry) {
      this.geometry.remove();
    }
    if (this.program) {
      this.program.remove();
    }

    const loseContext = gl.getExtension("WEBGL_lose_context");
    if (loseContext) {
      loseContext.loseContext();
    }

    this.gl = null;
    this.renderer = null;
  }
}

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

    const skipReveal = img.hasAttribute(SKIP_REVEAL_ATTR);
    if (skipReveal) {
      img.removeAttribute(SKIP_REVEAL_ATTR);
    }

    ditherInstances.push(new DitherCanvas(img, skipReveal));
  });
}

function destroyAllDither() {
  while (ditherInstances.length > 0) {
    ditherInstances[0].destroy();
  }
}

function dissolveAllToBlack(duration) {
  if (ditherInstances.length === 0) {
    return Promise.resolve();
  }
  return Promise.all(
    ditherInstances
      .filter(function (dc) {
        return !dc._hoverActive;
      })
      .map(function (dc) {
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

function getMaxHoverRemaining() {
  return ditherInstances.reduce(function (max, dc) {
    return Math.max(max, dc.hoverRemaining());
  }, 0);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () {
    initDither();
  });
} else {
  initDither();
}

window.addEventListener("ditherInitClone", function (e) {
  initDither(e.detail);
});

window.initDither = initDither;
window.destroyAllDither = destroyAllDither;
window.dissolveAllToBlack = dissolveAllToBlack;
window.dissolveAllFromBlack = dissolveAllFromBlack;
window.getMaxHoverRemaining = getMaxHoverRemaining;
window._ditherInstances = ditherInstances;
