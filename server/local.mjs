import http from "node:http";
import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi, session } from "./api.mjs";
import { sqliteDB } from "./sqlite.mjs";
const root = fileURLToPath(new URL("../", import.meta.url)),
  local = path.join(root, ".local");
await mkdir(local, { recursive: true });
let secrets;
try {
  secrets = JSON.parse(
    await readFile(path.join(local, "secrets.json"), "utf8"),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  secrets = {
    ADMIN_KEY: crypto.randomUUID() + crypto.randomUUID(),
    APP_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  };
  await writeFile(path.join(local, "secrets.json"), JSON.stringify(secrets), {
    mode: 0o600,
  });
}
const env = {
  ...secrets,
  ...(process.env.ADMIN_KEY ? { ADMIN_KEY: process.env.ADMIN_KEY } : {}),
  ...(process.env.APP_SECRET ? { APP_SECRET: process.env.APP_SECRET } : {}),
  DB: sqliteDB(path.join(local, "pindou.sqlite")),
};
await writeFile(
  path.join(local, "管理入口.txt"),
  `管理页面：http://127.0.0.1:${process.env.PORT || 4173}/admin\n管理密钥：${env.ADMIN_KEY}\n请勿上传本文件。\n`,
  { mode: 0o600 },
);
env.DB.exec(
  "CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)",
);
for (const name of (await readdir(path.join(root, "drizzle")))
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  if (
    !(await env.DB.prepare("SELECT name FROM local_migrations WHERE name=?")
      .bind(name)
      .first())
  ) {
    env.DB.exec("BEGIN IMMEDIATE");
    try {
      env.DB.exec(await readFile(path.join(root, "drizzle", name), "utf8"));
      await env.DB.prepare("INSERT INTO local_migrations (name) VALUES (?)")
        .bind(name)
        .run();
      env.DB.exec("COMMIT");
    } catch (e) {
      env.DB.exec("ROLLBACK");
      throw e;
    }
  }
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};
export const server = http.createServer(async (incoming, outgoing) => {
  try {
    const base = `http://${incoming.headers.host || "127.0.0.1"}`,
      url = new URL(incoming.url, base);
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      outgoing.writeHead(403);
      outgoing.end("Invalid host");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const req = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(incoming.method !== "GET" && incoming.method !== "HEAD"
          ? { body: incoming, duplex: "half" }
          : {}),
      });
      const response = await handleApi(req, {
        ...env,
        CLIENT_IP: incoming.socket.remoteAddress,
      });
      outgoing.writeHead(response.status, {
        ...Object.fromEntries(response.headers),
        "set-cookie": response.headers.getSetCookie(),
      });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const route =
        url.pathname === "/"
          ? "index.html"
          : url.pathname === "/admin"
            ? "admin.html"
            : decodeURIComponent(url.pathname).slice(1),
      file = path.resolve(root, "public", route),
      publicRoot = path.join(root, "public");
    if (!file.startsWith(publicRoot + path.sep)) {
      outgoing.writeHead(403);
      outgoing.end();
      return;
    }
    if (
      ["editor.mjs", "engine.mjs"].includes(route) &&
      !(await session(new Request(url, { headers: incoming.headers }), env))
    ) {
      outgoing.writeHead(401);
      outgoing.end("Card required");
      return;
    }
    const data = await readFile(file);
    outgoing.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    outgoing.end(data);
  } catch (e) {
    outgoing.writeHead(e.code === "ENOENT" ? 404 : 500);
    outgoing.end("Unable to serve request");
  }
});
server.listen(Number(process.env.PORT || 4173), "127.0.0.1", () =>
  console.log(
    `Pindou: http://127.0.0.1:${process.env.PORT || 4173} — 管理入口见 .local/管理入口.txt`,
  ),
);
