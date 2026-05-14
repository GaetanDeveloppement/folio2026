import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "node_modules", "ogl", "src");
const DEST = join(ROOT, "assets", "js", "lib", "ogl");

const SLIM_INDEX = `export { Renderer } from "./core/Renderer.js";
export { Program } from "./core/Program.js";
export { Mesh } from "./core/Mesh.js";
export { Texture } from "./core/Texture.js";
export { Geometry } from "./core/Geometry.js";
export { Triangle } from "./extras/Triangle.js";
`;

if (!existsSync(SRC)) {
  console.error("ogl src not found at", SRC, "— run `pnpm install` first");
  process.exit(1);
}

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });
await cp(SRC, DEST, { recursive: true });
await writeFile(join(DEST, "index.js"), SLIM_INDEX);

console.log("ogl vendored to", DEST);
