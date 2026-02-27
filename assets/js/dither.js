const PIXEL_SIZE = 3;
const BAYER_SIZE = 8;
const PALETTE_SIZE = 8;

// -----------------------------------------------------------------------
// Shaders
// -----------------------------------------------------------------------
const VERT = `
                attribute vec2 a_pos;
                varying vec2 v_uv;
                void main() {
                    v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
                    gl_Position = vec4(a_pos, 0.0, 1.0);
                }
            `;

const FRAG = `
                precision mediump float;

                uniform sampler2D u_image;
                uniform sampler2D u_bayer;
                uniform sampler2D u_palette;
                uniform vec2      u_resolution;
                uniform float     u_colorize;
                uniform float     u_dissolve;
                uniform vec2      u_mouse;

                varying vec2 v_uv;

                float colorDist(vec3 a, vec3 b) {
                    vec3 d = a - b;
                    return d.r * d.r * 0.299 + d.g * d.g * 0.587 + d.b * d.b * 0.114;
                }

                vec3 paletteColor(float index) {
                    return texture2D(u_palette, vec2((index + 0.5) / float(${PALETTE_SIZE}), 0.5)).rgb;
                }

                void main() {
                    vec2 pixelCoord = floor(v_uv * u_resolution / ${PIXEL_SIZE}.0) * ${PIXEL_SIZE}.0;
                    vec2 blockUV    = (pixelCoord + ${PIXEL_SIZE}.0 * 0.5) / u_resolution;

                    vec3  col = texture2D(u_image, blockUV).rgb;
                    float lum = dot(col, vec3(0.299, 0.587, 0.114));

                    vec2  blockPx = floor(v_uv * u_resolution / ${PIXEL_SIZE}.0);
                    vec2  bayerUV = mod(blockPx, ${BAYER_SIZE}.0) / ${BAYER_SIZE}.0;
                    float t       = texture2D(u_bayer, bayerUV).r;

                    // B&W
                    // vec3 bw = vec3(step(t, lum));
                    vec3 bw = mix(vec3(0.0, 0.0, 0.0), vec3(0.9, 0.9, 0.9), step(t, lum));

                    // Color: find two nearest palette colors, dither between them
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

                    // Bayer dissolve + radial mouse reveal
                    vec2  dissolvePx = floor(v_uv * u_resolution / (${PIXEL_SIZE}.0 * 2.0));
                    vec2  dissolveUV = mod(dissolvePx, ${BAYER_SIZE}.0) / ${BAYER_SIZE}.0;
                    float dissolveT  = texture2D(u_bayer, dissolveUV).r;

                    float dist = (u_mouse.x >= 0.0)
                        ? length((v_uv - u_mouse) * vec2(u_resolution.x / u_resolution.y, 1.0))
                        : 1.0;
                    float radial  = clamp(1.0 - dist * 1.0, 0.0, 1.0);
                    float effectiveColorize = clamp(u_colorize + radial * 1.0, 0.0, 1.0);

                    vec3 result = (dissolveT < effectiveColorize) ? color : bw;

                    // Dissolve to black on navigation: luminance-ordered, bayer-dithered
                    if (u_dissolve > 0.0) {
                        float spread = 0.4 * (1.0 - u_dissolve);
                        float mask = step(lum, u_dissolve + (t - 0.5) * spread);
                        result = mix(result, vec3(0.0), mask);
                    }

                    gl_FragColor = vec4(result, 1.0);
                }
            `;

// -----------------------------------------------------------------------
// Bayer 8x8 matrix
// -----------------------------------------------------------------------
function makeBayerMatrix(n) {
  if (n === 2)
    return [
      [0, 2],
      [3, 1],
    ];
  const half = makeBayerMatrix(n / 2);
  const m = Array.from({ length: n }, () => new Array(n));
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
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      data[y * n + x] = Math.round(((m[y][x] + 0.5) / max) * 255);
  return data;
}

const BAYER_DATA = bayerToUint8(BAYER_SIZE);

// -----------------------------------------------------------------------
// Palette extraction
// -----------------------------------------------------------------------
function extractPalette(img) {
  const MAX = 200;
  const scale = Math.min(
    1,
    MAX / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  off.getContext("2d").drawImage(img, 0, 0, w, h);
  const { data } = off.getContext("2d").getImageData(0, 0, w, h);

  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key =
      ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const MIN_DIST_SQ = 50 * 50;
  const selected = [];
  for (const [key] of sorted) {
    const r = ((key >> 8) & 0xf) * 17;
    const g = ((key >> 4) & 0xf) * 17;
    const b = (key & 0xf) * 17;
    const tooClose = selected.some((c) => {
      const dr = r - c.r,
        dg = g - c.g,
        db = b - c.b;
      return dr * dr + dg * dg + db * db < MIN_DIST_SQ;
    });
    if (!tooClose) {
      selected.push({ r, g, b });
      if (selected.length >= PALETTE_SIZE) break;
    }
  }
  while (selected.length < PALETTE_SIZE) selected.push({ r: 0, g: 0, b: 0 });
  return selected;
}

// -----------------------------------------------------------------------
// DitherCanvas
// -----------------------------------------------------------------------
class DitherCanvas {
  constructor(imgEl) {
    this.img = imgEl;

    this.canvas = document.createElement("canvas");
    imgEl.parentElement.appendChild(this.canvas);

    this.gl = this.canvas.getContext("webgl");
    this._setup();

    this.colorize = 0.0;
    this.dissolve = 1.0;
    this.mouse = [-1, -1];
    this._rafId = null;

    imgEl.parentElement.addEventListener("mouseenter", () =>
      this._animateTo(1.0),
    );
    imgEl.parentElement.addEventListener("mouseleave", () => {
      this.mouse = [-1, -1];
      this._animateTo(0.0);
    });
    imgEl.parentElement.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse = [
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      ];
      this.render();
    });

    const onReady = () => {
      this._uploadTexture();
      this._resize();
      this.ro = new ResizeObserver(() => this._resize());
      this.ro.observe(imgEl.parentElement);
      this.dissolveFromBlack(1500);
    };

    if (imgEl.complete && imgEl.naturalWidth > 0) {
      onReady();
    } else {
      imgEl.addEventListener("load", onReady);
    }
  }

  _setup() {
    const gl = this.gl;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
      return s;
    };

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;

    // Full-screen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
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
      colorize: gl.getUniformLocation(prog, "u_colorize"),
      dissolve: gl.getUniformLocation(prog, "u_dissolve"),
      mouse: gl.getUniformLocation(prog, "u_mouse"),
    };

    // Bayer texture
    this.bayerTex = this._makeTex(
      BAYER_DATA,
      BAYER_SIZE,
      gl.LUMINANCE,
      gl.REPEAT,
    );

    // Palette texture placeholder
    this.paletteTex = this._makeTex(null, 1, gl.RGB, gl.CLAMP_TO_EDGE);

    // Image texture
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
    if (data)
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
    const palData = new Uint8Array(palette.flatMap((c) => [c.r, c.g, c.b]));
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
    if (w === 0 || h === 0) return;

    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.viewport(0, 0, w, h);
    gl.uniform2f(this.u.resolution, w, h);
    this.render();
  }

  _animateTo(target) {
    const DURATION = 300;
    cancelAnimationFrame(this._rafId);
    const start = performance.now();
    const from = this.colorize;
    const delta = target - from;
    const tick = (now) => {
      const p = Math.min((now - start) / DURATION, 1.0);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      this.colorize = from + delta * e;
      this.render();
      if (p < 1.0) this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  dissolveToBlack(duration) {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min((now - start) / duration, 1.0);
        this.dissolve = p;
        this.render();
        if (p < 1.0) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  dissolveFromBlack(duration) {
    this.dissolve = 1.0;
    this.render();
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min((now - start) / duration, 1.0);
        this.dissolve = 1.0 - p;
        this.render();
        if (p < 1.0) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  render() {
    if (!this.textureReady) return;
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

    gl.uniform1f(this.u.colorize, this.colorize);
    gl.uniform1f(this.u.dissolve, this.dissolve);
    gl.uniform2f(this.u.mouse, this.mouse[0], this.mouse[1]);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

// -----------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------
window._ditherInstances = [];

function initDither(root = document) {
  root.querySelectorAll(".dither-wrap img.parallax").forEach((img) => {
    window._ditherInstances.push(new DitherCanvas(img));
  });
}

document.addEventListener("DOMContentLoaded", () => initDither());
window.addEventListener("ditherInitClone", (e) => initDither(e.detail));
