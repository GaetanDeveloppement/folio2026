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
const HOVER_EASE_SPLIT = 0.5;
const DISSOLVE_REVEAL_DURATION = 2000;
const DITHER_INIT_ATTR = "data-dither-initialized";
const COLOR_WAVE_LEAD = 1.5;
const HOVER_SPREAD_SCALE = 1.6;
const EASE_SPLIT = 0.2;
const EASING_POWER = 3;
// Hover circle (cursor-following reveal mask, single physical disk that bleeds across canvases)
const HOVER_CIRCLE_RADIUS_PX = 400; // radius in CSS pixels — same physical size on every image
const HOVER_CIRCLE_FALLOFF = 0.9; // width of the dithered band as fraction of radius (0 = hard edge, 1 = dither covers the whole disk)
const HOVER_CIRCLE_PULSE = 0.25; // radius pulse amplitude as fraction of radius (0 = no pulse)
const HOVER_CIRCLE_PULSE_HZ = 0.1; // pulse frequency in Hz
// Click circle — sharper second disk that grows from the cursor on click
const CLICK_CIRCLE_FALLOFF = 0.15; // dither band width as fraction of radius — keep small for a hard, distinct edge
const HOVER_CLICK_GROW_DURATION = 1000; // duration of the click-grow animation (ms)
// Pixel sort — vertical luminance sort triggered by clicking the title
// One odd-even pass per frame, n passes guarantees an n-tall column is sorted.
const SORTED_MAX_SIZE = 384;
const SORT_START_DURATION = 600;
const SORT_RESET_DURATION = 600;
const SORT_SCALE_TWEEN_DURATION = 500;
const SORT_ACTIVE_SCALE = 1;

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
document.addEventListener("mouseleave", function () {
  _mouseX = -1;
  _mouseY = -1;
});

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
    uniform sampler2D u_sorted;
    uniform sampler2D u_bayer;
    uniform sampler2D u_palette;
    uniform vec2      u_resolution;
    uniform float     u_dissolve;
    uniform float     u_hover;
    uniform float     u_reveal;
    uniform float     u_light;
    uniform float     u_sort;
    uniform vec2      u_mouse;
    uniform float     u_radius;
    uniform float     u_clickRadius;
    uniform float     u_time;

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

        vec2  blockPx = floor(v_uv * u_resolution / ${pixelSize}.0);
        vec2  bayerUV = mod(blockPx, ${BAYER_SIZE}.0) / ${BAYER_SIZE}.0;
        float t       = texture2D(u_bayer, bayerUV).r;

        vec3  origCol   = texture2D(u_image, blockUV).rgb;
        vec3  sortedCol = texture2D(u_sorted, blockUV).rgb;
        // Wave from top to bottom so sorted pixels appear to "fall" into place.
        float sortProgress = clamp(u_sort * 1.5 - v_uv.y * 0.5, 0.0, 1.0);
        vec3  col = (t < sortProgress) ? sortedCol : origCol;
        float lum = dot(col, vec3(0.299, 0.587, 0.114));

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
        // Bias toward c0 (nearest palette color) as the sort engages, so the
        // sorted state renders as flat color bands instead of stippled noise.
        ratio = mix(ratio, 1.0, u_sort);
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

        float aspect        = u_resolution.x / u_resolution.y;
        vec2  circleDelta   = (v_uv - u_mouse) * vec2(aspect, 1.0);
        float circleDist    = length(circleDelta);

        // Hover circle: soft, pulsing, follows cursor.
        float pulse         = 1.0 + ${HOVER_CIRCLE_PULSE.toFixed(4)} * sin(u_time * ${HOVER_CIRCLE_PULSE_HZ.toFixed(4)} * 6.28318);
        float pulsedRadius  = max(u_radius * pulse, 0.0001);
        float hoverNorm     = circleDist / pulsedRadius;
        float hoverMin      = 1.0 - ${HOVER_CIRCLE_FALLOFF};
        float hoverCircle   = (u_radius > 0.0)
            ? step(hoverNorm, mix(hoverMin, 1.0, t))
            : 0.0;

        // Click circle: sharper second disk that grows from the cursor on click.
        float clickRad      = max(u_clickRadius, 0.0001);
        float clickNorm     = circleDist / clickRad;
        float clickMin      = 1.0 - ${CLICK_CIRCLE_FALLOFF};
        float clickCircle   = (u_clickRadius > 0.0)
            ? step(clickNorm, mix(clickMin, 1.0, t))
            : 0.0;

        float circleMask    = max(hoverCircle, clickCircle);

        float effectiveHover = u_hover * circleMask;
        float hoverSpread = ${HOVER_SPREAD_SCALE} * effectiveHover * (1.0 - effectiveHover);
        float hoverMask = step(max(1.0 - lum, 0.001), effectiveHover + (t - 0.5) * hoverSpread);
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

function easeOut(p) {
  return 1.0 - Math.pow(1.0 - p, EASING_POWER);
}

function linear(p) {
  return p;
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

const _sortDataCache = new Map();

function loadImageData(img) {
  const scale = Math.min(
    1,
    SORTED_MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return { data: new Uint8Array(imageData.data), width: w, height: h };
}

function getOrLoadSortData(img) {
  if (!img.naturalWidth) {
    return null;
  }
  const key = img.src;
  let entry = _sortDataCache.get(key);
  if (!entry) {
    entry = loadImageData(img);
    _sortDataCache.set(key, entry);
  }
  return entry;
}

function ensurePaletteIdx(cached, palette) {
  if (cached.paletteIdx || !palette || palette.length === 0) {
    return cached.paletteIdx || null;
  }
  const n = cached.width * cached.height;
  const idx = new Uint8Array(n);
  const data = cached.data;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const r = data[j];
    const g = data[j + 1];
    const b = data[j + 2];
    let bestD = Infinity;
    let bestIdx = 0;
    for (let k = 0; k < palette.length; k++) {
      const p = palette[k];
      const dr = r - p.r;
      const dg = g - p.g;
      const db = b - p.b;
      const d = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
      if (d < bestD) {
        bestD = d;
        bestIdx = k;
      }
    }
    idx[i] = bestIdx;
  }
  cached.paletteIdx = idx;
  return idx;
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
    this.sort = 0.0;
    this.mouse = [0.5, 0.5];
    this.radius = 0.0;
    this.clickRadius = 0.0;
    this._rafId = null;
    this._dissolveRafId = null;
    this._pollRafId = null;
    this._radiusRafId = null;
    this._clickRadiusRafId = null;
    this._sortRafId = null;
    this._sortAnimRafId = null;
    this._sortIdleId = null;
    this.sortBuffer = null;
    this.sortLum = null;
    this.sortW = 0;
    this.sortH = 0;
    this.sortIter = 0;
    this.sortDone = false;
    this._hoverActive = false;
    this._pointerOver = false;
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

        const rect = self.canvas.getBoundingClientRect();
        let inRange = false;
        let pointerOver = false;
        let nx = self.mouse[0];
        let ny = self.mouse[1];
        let radiusH = self.radius;

        if (_mouseX >= 0 && rect.width > 0 && rect.height > 0) {
          nx = (_mouseX - rect.left) / rect.width;
          ny = (_mouseY - rect.top) / rect.height;

          // Same height-normalized aspect-corrected metric as the shader.
          const aspect = rect.width / rect.height;
          const cx = Math.max(0, Math.min(1, nx));
          const cy = Math.max(0, Math.min(1, ny));
          const dx = (nx - cx) * aspect;
          const dy = ny - cy;
          const distH = Math.sqrt(dx * dx + dy * dy);

          radiusH = HOVER_CIRCLE_RADIUS_PX / rect.height;
          inRange = distH < radiusH;
          pointerOver = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
        }

        self._pointerOver = pointerOver;

        if (inRange !== self._hoverActive) {
          self._hoverActive = inRange;
          if (inRange) {
            self._handleEnter();
          } else {
            self._handleLeave();
          }
        }

        if (inRange) {
          self.mouse[0] = nx;
          self.mouse[1] = ny;
          self.radius = radiusH;
          // Render every frame so the pulse animates (and dither edge updates)
          // even when the cursor is still.
          self.render();
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
    cancelAnimationFrame(this._radiusRafId);
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
      sorted: gl.getUniformLocation(prog, "u_sorted"),
      bayer: gl.getUniformLocation(prog, "u_bayer"),
      palette: gl.getUniformLocation(prog, "u_palette"),
      resolution: gl.getUniformLocation(prog, "u_resolution"),
      dissolve: gl.getUniformLocation(prog, "u_dissolve"),
      hover: gl.getUniformLocation(prog, "u_hover"),
      reveal: gl.getUniformLocation(prog, "u_reveal"),
      light: gl.getUniformLocation(prog, "u_light"),
      sort: gl.getUniformLocation(prog, "u_sort"),
      mouse: gl.getUniformLocation(prog, "u_mouse"),
      radius: gl.getUniformLocation(prog, "u_radius"),
      clickRadius: gl.getUniformLocation(prog, "u_clickRadius"),
      time: gl.getUniformLocation(prog, "u_time"),
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

    this.sortedTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sortedTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // NEAREST so the user sees crisp per-pixel swaps, not a blur across columns.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
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

    this.palette = palette;
    this.paletteLum = new Float32Array(palette.length);
    for (let k = 0; k < palette.length; k++) {
      this.paletteLum[k] =
        palette[k].r * 0.299 + palette[k].g * 0.587 + palette[k].b * 0.114;
    }

    this.textureReady = true;

    const self = this;
    const scheduleIdle =
      window.requestIdleCallback ||
      function (cb) {
        return setTimeout(cb, 200);
      };
    this._sortIdleId = scheduleIdle(function () {
      self._sortIdleId = null;
      // Warm cache: image data + per-pixel palette-index lookup so the
      // first click doesn't hitch.
      const cached = getOrLoadSortData(self.img);
      if (cached) {
        ensurePaletteIdx(cached, self.palette);
      }
    });
  }

  _uploadSortedTex() {
    if (!this.gl || !this.sortBuffer) {
      return;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sortedTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.sortW,
      this.sortH,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.sortBuffer,
    );
  }

  // One odd-even (brick) sort pass per column. Alternates between comparing
  // even/odd pairs each iteration; n iterations guarantees a fully-sorted
  // column of length n.
  _runSortPass() {
    const data = this.sortBuffer;
    const lum = this.sortLum;
    const w = this.sortW;
    const h = this.sortH;
    const startY = this.sortIter % 2;

    for (let x = 0; x < w; x++) {
      for (let y = startY; y < h - 1; y += 2) {
        const li1 = y * w + x;
        const li2 = li1 + w;
        if (lum[li1] > lum[li2]) {
          const tl = lum[li1];
          lum[li1] = lum[li2];
          lum[li2] = tl;
          const i1 = li1 * 4;
          const i2 = li2 * 4;
          const r = data[i1];
          const g = data[i1 + 1];
          const b = data[i1 + 2];
          const a = data[i1 + 3];
          data[i1] = data[i2];
          data[i1 + 1] = data[i2 + 1];
          data[i1 + 2] = data[i2 + 2];
          data[i1 + 3] = data[i2 + 3];
          data[i2] = r;
          data[i2 + 1] = g;
          data[i2 + 2] = b;
          data[i2 + 3] = a;
        }
      }
    }

    this.sortIter++;
    if (this.sortIter >= h) {
      this.sortDone = true;
    }
  }

  startSort() {
    if (!this.gl) {
      return;
    }
    cancelAnimationFrame(this._sortAnimRafId);
    cancelAnimationFrame(this._sortRafId);
    this._sortAnimRafId = null;
    this._sortRafId = null;

    const cached = getOrLoadSortData(this.img);
    if (!cached) {
      return;
    }

    this.sortW = cached.width;
    this.sortH = cached.height;
    this.sortBuffer = new Uint8Array(cached.data);
    const n = this.sortW * this.sortH;
    this.sortLum = new Float32Array(n);

    // Sort key: palette-color luminance (primary) + raw luminance (secondary).
    // This groups pixels mapping to the same palette color into a single
    // band, ordered darkest palette → lightest, then darkest raw → lightest
    // within each band.
    const palIdx = ensurePaletteIdx(cached, this.palette);
    const paletteLum = this.paletteLum;
    if (palIdx && paletteLum) {
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        const rawLum =
          this.sortBuffer[j] * 0.299 +
          this.sortBuffer[j + 1] * 0.587 +
          this.sortBuffer[j + 2] * 0.114;
        this.sortLum[i] = paletteLum[palIdx[i]] * 1000 + rawLum;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        this.sortLum[i] =
          this.sortBuffer[j] * 0.299 +
          this.sortBuffer[j + 1] * 0.587 +
          this.sortBuffer[j + 2] * 0.114;
      }
    }

    this.sortIter = 0;
    this.sortDone = false;
    this._uploadSortedTex();
    this.render();
    // Smoothly tween the sort uniform up so the dither→flat transition is
    // a soft fade instead of a snap.
    this._tween("sort", 1, SORT_START_DURATION, "_sortRafId", easeOut);

    const self = this;
    function tick() {
      if (!self.gl || !self.sortBuffer) {
        self._sortAnimRafId = null;
        return;
      }
      self._runSortPass();
      self._uploadSortedTex();
      self.render();
      if (self.sortDone) {
        self._sortAnimRafId = null;
      } else {
        self._sortAnimRafId = requestAnimationFrame(tick);
      }
    }
    self._sortAnimRafId = requestAnimationFrame(tick);
  }

  resetSort() {
    cancelAnimationFrame(this._sortAnimRafId);
    this._sortAnimRafId = null;
    if (!this.gl) {
      return Promise.resolve();
    }
    const self = this;
    return this._tween(
      "sort",
      0,
      SORT_RESET_DURATION,
      "_sortRafId",
      easeOut,
    ).then(function () {
      self.sortBuffer = null;
      self.sortLum = null;
      self.sortDone = false;
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
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.viewport(0, 0, w, h);
    gl.uniform2f(this.u.resolution, w, h);
    this.render();
  }

  _tween(prop, target, duration, rafKey, easeFn) {
    const key = rafKey || "_rafId";
    const ease =
      easeFn ||
      function (p) {
        return easeAsymmetric(p, EASE_SPLIT, EASING_POWER);
      };
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

  _animateOpacity(target) {
    this._hoverStart = performance.now();
    this._tween("hover", target, HOVER_DURATION, "_rafId", easeOut);
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
    // Bleed canvases have hover > 0, which makes them transparent inside the
    // circle (revealing the original <img> behind, which the dissolve doesn't
    // touch). Fade hover alongside the dissolve so the bleed circle closes.
    this._tween("hover", 0, duration, "_rafId", easeOut);
    return this._tween("dissolve", 1, duration, "_dissolveRafId");
  }

  growCircleAndCover(duration) {
    cancelAnimationFrame(this._pollRafId);
    cancelAnimationFrame(this._rafId);
    cancelAnimationFrame(this._clickRadiusRafId);
    this.hover = 1.0;
    this.clickRadius = 0.0;
    const aspect = this.canvas.width / this.canvas.height;
    const dx = Math.max(this.mouse[0], 1 - this.mouse[0]) * aspect;
    const dy = Math.max(this.mouse[1], 1 - this.mouse[1]);
    const maxDist = Math.sqrt(dx * dx + dy * dy);
    // Click circle's inner fully-revealed zone is clickRadius * (1 - clickFalloff).
    const innerFraction = Math.max(1 - CLICK_CIRCLE_FALLOFF, 0.01);
    const target = (maxDist / innerFraction) * 1.05;
    // Linear so the visible reveal lasts the full duration.
    return this._tween(
      "clickRadius",
      target,
      duration,
      "_clickRadiusRafId",
      linear,
    );
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

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.sortedTex);
    gl.uniform1i(this.u.sorted, 3);

    gl.uniform1f(this.u.dissolve, this.dissolve);
    gl.uniform1f(this.u.hover, this.hover);
    gl.uniform1f(this.u.reveal, this.revealOnly ? 1.0 : 0.0);
    gl.uniform1f(this.u.light, _lightMode ? 1.0 : 0.0);
    gl.uniform1f(this.u.sort, this.sort);
    gl.uniform2f(this.u.mouse, this.mouse[0], this.mouse[1]);
    gl.uniform1f(this.u.radius, this.radius);
    gl.uniform1f(this.u.clickRadius, this.clickRadius);
    gl.uniform1f(this.u.time, (performance.now() / 1000) % 1000);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy() {
    cancelAnimationFrame(this._rafId);
    cancelAnimationFrame(this._dissolveRafId);
    cancelAnimationFrame(this._pollRafId);
    cancelAnimationFrame(this._radiusRafId);
    cancelAnimationFrame(this._clickRadiusRafId);
    cancelAnimationFrame(this._sortRafId);
    cancelAnimationFrame(this._sortAnimRafId);
    if (this._sortIdleId !== null && window.cancelIdleCallback) {
      window.cancelIdleCallback(this._sortIdleId);
    }
    this.sortBuffer = null;
    this.sortLum = null;

    if (this.ro) {
      this.ro.disconnect();
    }

    if (this.gl) {
      const gl = this.gl;
      if (this.imgTex) {
        gl.deleteTexture(this.imgTex);
      }
      if (this.sortedTex) {
        gl.deleteTexture(this.sortedTex);
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

let _defaultScale = null;

function captureDefaultScale() {
  // Read once, before any inline override exists, so we know what to tween back to.
  if (_defaultScale === null) {
    const inline = document.body.style.getPropertyValue("--scale-image");
    if (inline) {
      document.body.style.removeProperty("--scale-image");
    }
    _defaultScale =
      parseFloat(
        getComputedStyle(document.body).getPropertyValue("--scale-image"),
      ) || 1;
    if (inline) {
      document.body.style.setProperty("--scale-image", inline);
    }
  }
  return _defaultScale;
}

function togglePixelSort() {
  const defaultScale = captureDefaultScale();
  const someActive = ditherInstances.some(function (dc) {
    return dc.sort > 0 || dc._sortAnimRafId !== null;
  });
  if (someActive) {
    if (window.tweenParallaxScale) {
      window.tweenParallaxScale(defaultScale, SORT_SCALE_TWEEN_DURATION);
    }
    ditherInstances.forEach(function (dc) {
      dc.resetSort();
    });
  } else {
    if (window.tweenParallaxScale) {
      window.tweenParallaxScale(SORT_ACTIVE_SCALE, SORT_SCALE_TWEEN_DURATION);
    }
    ditherInstances.forEach(function (dc) {
      if (!dc.revealOnly) {
        dc.startSort();
      }
    });
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

    const skipReveal = img.hasAttribute("data-skip-reveal");
    if (skipReveal) {
      img.removeAttribute("data-skip-reveal");
    }

    ditherInstances.push(new DitherCanvas(img, skipReveal));
  });
}

function destroyAllDither() {
  if (window.cancelParallaxScaleTween) {
    window.cancelParallaxScaleTween();
  }
  document.body.style.removeProperty("--scale-image");
  while (ditherInstances.length > 0) {
    const instance = ditherInstances[0];
    instance.destroy();
  }
}

function dissolveAllToBlack() {
  if (ditherInstances.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(
    ditherInstances
      .filter(function (dc) {
        return !dc._pointerOver;
      })
      .map(function (dc) {
        return dc.dissolveToBlack(HOVER_CLICK_GROW_DURATION);
      }),
  );
}

function growHoveredCircles() {
  if (ditherInstances.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(
    ditherInstances
      .filter(function (dc) {
        return dc._pointerOver;
      })
      .map(function (dc) {
        return dc.growCircleAndCover(HOVER_CLICK_GROW_DURATION);
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

document.addEventListener("click", function (e) {
  if (document.body.dataset.layout !== "home") {
    return;
  }
  const h1 = e.target.closest(".sidebar header h1");
  if (!h1 || h1.querySelector("a")) {
    return;
  }
  togglePixelSort();
});

window.addEventListener("ditherInitClone", function (e) {
  initDither(e.detail);
});

window.initDither = initDither;
window.destroyAllDither = destroyAllDither;
window.dissolveAllToBlack = dissolveAllToBlack;
window.dissolveAllFromBlack = dissolveAllFromBlack;
window.growHoveredCircles = growHoveredCircles;
window.togglePixelSort = togglePixelSort;
window.getMaxHoverRemaining = function () {
  return ditherInstances.reduce(function (max, dc) {
    return Math.max(max, dc.hoverRemaining());
  }, 0);
};
