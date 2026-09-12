import { handleApi, session } from "./api.mjs";
import assets from "./assets.mjs";
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env);
    const path =
      url.pathname === "/"
        ? "/index.html"
        : url.pathname === "/admin"
          ? "/admin.html"
          : url.pathname;
    if (!["GET", "HEAD"].includes(req.method))
      return new Response("Method not allowed", { status: 405 });
    const asset = assets[path];
    if (!asset) return new Response("Not found", { status: 404 });
    if (["/editor.mjs", "/engine.mjs"].includes(path)) {
      try {
        if (!env.DB || !env.APP_SECRET || !(await session(req, env)))
          return new Response("Card required", {
            status: 401,
            headers: { "Cache-Control": "no-store" },
          });
      } catch {
        return new Response("Service unavailable", { status: 503 });
      }
    }
    const bytes = Uint8Array.from(atob(asset.content), (c) => c.charCodeAt(0));
    return new Response(req.method === "HEAD" ? null : bytes, {
      headers: {
        "Content-Type": asset.type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      },
    });
  },
};
