import { readFile, writeFile, mkdir, readdir, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = process.cwd(),
  assets = {},
  types = {
    ".html": "text/html; charset=utf-8",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".jpg": "image/jpeg",
  };
for (const name of await readdir("public")) {
  if (name === "strawberry.png") continue;
  const data = await readFile(path.join("public", name));
  assets["/" + name] = {
    type: types[path.extname(name)] || "application/octet-stream",
    content: data.toString("base64"),
  };
  if (name.endsWith(".mjs")) {
    const r = spawnSync(process.execPath, ["--input-type=module", "--check"], {
      input: data,
    });
    if (r.status !== 0) throw new Error(r.stderr.toString());
  }
}
let api = await readFile("server/api.mjs", "utf8");
api = api.replace(/^import .*project-codec.*\n/m, "");
let worker = await readFile("server/worker.mjs", "utf8");
worker = worker.replace(/^import .*\n/gm, "");
const bundle = `${await readFile("server/project-codec.mjs", "utf8")}\n${api}\nconst assets=${JSON.stringify(assets)};\n${worker}`;
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await writeFile("dist/server/index.js", bundle);
await cp(".openai/hosting.json", "dist/.openai/hosting.json");
await cp("drizzle", "dist/.openai/drizzle", { recursive: true });
const r = spawnSync(process.execPath, ["--check", "dist/server/index.js"]);
if (r.status !== 0) throw new Error(r.stderr.toString());
const built = await import(new URL("../dist/server/index.js", import.meta.url));
if (typeof built.default?.fetch !== "function")
  throw new Error("Worker fetch export is missing");
for (const route of [
  "/",
  "/admin",
  "/style.css",
  "/bootstrap.mjs",
  "/palette-model.mjs",
  "/palette-manager.mjs",
  "/presets.json",
  "/strawberry.jpg",
]) {
  const response = await built.default.fetch(
    new Request("https://test.local" + route),
    {},
  );
  if (response.status !== 200) throw new Error("Missing route " + route);
}
if (
  (await built.default.fetch(new Request("https://test.local/engine.mjs"), {}))
    .status !== 401
)
  throw new Error("Editor code must require a card");
console.log(
  `Build verified: ${Object.keys(assets).length} assets, Worker fetch, protected editor modules, routes and JavaScript syntax.`,
);
