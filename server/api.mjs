import { encodeProject, decodeProject } from "./project-codec.mjs";
const DAY = 86400000;
const json = (value, status = 200, cookies = []) => {
  const h = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  cookies.forEach((c) => h.append("Set-Cookie", c));
  return new Response(JSON.stringify(value), { status, headers: h });
};
const failure = (message, status = 400) => json({ error: message }, status);
const token = () =>
  [...crypto.getRandomValues(new Uint8Array(24))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
async function hash(s) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
function cookies(req) {
  return Object.fromEntries(
    (req.headers.get("Cookie") || "")
      .split(";")
      .map((v) => v.trim().split("="))
      .filter((v) => v.length === 2),
  );
}
function cookie(req, name, value, age) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
const digest = (env, type, value) => hash(`${env.APP_SECRET}:${type}:${value}`);
const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
async function body(req, limit = 3000000) {
  const reader = req.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error("请求数据过大");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let i = 0;
  chunks.forEach((c) => {
    bytes.set(c, i);
    i += c.length;
  });
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("请求格式无效");
  }
}
async function limited(req, env, action, limit) {
  const ip = env.CLIENT_IP || req.headers.get("CF-Connecting-IP") || "unknown";
  const bucket = Math.floor(Date.now() / 600000),
    key = await digest(env, "rate", `${action}:${ip}:${bucket}`);
  const r = await stmt(
    env,
    "INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count",
    key,
    (bucket + 2) * 600000,
  ).first();
  await stmt(
    env,
    "DELETE FROM rate_limits WHERE expires_at < ?",
    Date.now(),
  ).run();
  return r.count > limit;
}
export async function session(req, env, admin = false) {
  const c = cookies(req),
    raw = c[admin ? "pd_admin" : "pd_session"];
  if (!raw) return null;
  const s = await stmt(
    env,
    "SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ? AND role = ?",
    await digest(env, "session", raw),
    Date.now(),
    admin ? "admin" : "card",
  ).first();
  if (!s) return null;
  if (admin) {
    if (s.device_hash !== (await digest(env, "admin-version", env.ADMIN_KEY)))
      return null;
    return s;
  }
  const card = await stmt(
    env,
    "SELECT * FROM cards WHERE id = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > ?)",
    s.card_id,
    Date.now(),
  ).first();
  const device = await digest(env, "device", c.pd_device || "");
  if (
    !card ||
    s.device_hash !== device ||
    ![card.device1, card.device2].includes(device)
  )
    return null;
  return { ...s, card };
}
async function newSession(req, env, role, cardId, device) {
  const raw = token();
  await stmt(
    env,
    "INSERT INTO sessions (token_hash, role, card_id, device_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
    await digest(env, "session", raw),
    role,
    cardId,
    device,
    Date.now() + (role === "admin" ? DAY / 3 : 7 * DAY),
  ).run();
  await stmt(
    env,
    "DELETE FROM sessions WHERE expires_at <= ?",
    Date.now(),
  ).run();
  return cookie(
    req,
    role === "admin" ? "pd_admin" : "pd_session",
    raw,
    role === "admin" ? 28800 : 604800,
  );
}
export async function handleApi(req, env) {
  if (
    !env.DB ||
    !env.APP_SECRET ||
    env.APP_SECRET.length < 32 ||
    !env.ADMIN_KEY ||
    env.ADMIN_KEY.length < 20
  )
    return failure("服务尚未配置，请联系站长。", 503);
  const url = new URL(req.url),
    route = url.pathname,
    method = req.method;
  if (method !== "GET") {
    if (
      req.headers.get("X-Pindou-Request") !== "1" ||
      (req.headers.get("Origin") && req.headers.get("Origin") !== url.origin)
    )
      return failure("请求来源无效。", 403);
    if (!req.headers.get("Content-Type")?.startsWith("application/json"))
      return failure("仅接受 JSON 请求。", 415);
  }
  try {
    if (route === "/api/session" && method === "GET") {
      const s = await session(req, env);
      return json({
        active: !!s,
        card: s
          ? {
              suffix: s.card.suffix,
              expiresAt: s.card.expires_at,
              devices: Number(!!s.card.device1) + Number(!!s.card.device2),
              maxDevices: 2,
            }
          : null,
      });
    }
    if (route === "/api/activate" && method === "POST") {
      if (await limited(req, env, "activate", 30))
        return failure("尝试过于频繁，请 10 分钟后重试。", 429);
      const input = await body(req, 1024),
        code = String(input.code || "")
          .replace(/[\s-]/g, "")
          .toUpperCase();
      if (!/^[A-F0-9]{32}$/.test(code)) return failure("请输入有效的卡密。");
      const rawDevice = /^[a-f0-9]{48}$/.test(cookies(req).pd_device || "")
          ? cookies(req).pd_device
          : token(),
        device = await digest(env, "device", rawDevice),
        now = Date.now();
      // One conditional UPDATE serializes first-use activation and both binding slots.
      const card = await stmt(
        env,
        `UPDATE cards SET activated_at = COALESCE(activated_at, ?),
        expires_at = CASE WHEN activated_at IS NULL AND duration_days > 0 THEN ? + duration_days * 86400000 ELSE expires_at END,
        device1 = CASE WHEN device1 IS NULL THEN ? ELSE device1 END,
        device2 = CASE WHEN device1 IS NOT NULL AND device1 != ? AND device2 IS NULL THEN ? ELSE device2 END
        WHERE code_hash = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > ?)
          AND (device1 IS NULL OR device1 = ? OR device2 IS NULL OR device2 = ?)
        RETURNING id, suffix, expires_at, device1, device2`,
        now,
        now,
        device,
        device,
        device,
        await digest(env, "card", code),
        now,
        device,
        device,
      ).first();
      if (!card)
        return failure("卡密无效、已到期、已停用或已绑定 2 个浏览器。", 403);
      return json({ active: true, expiresAt: card.expires_at }, 200, [
        cookie(req, "pd_device", rawDevice, 315360000),
        await newSession(req, env, "card", card.id, device),
      ]);
    }
    if (route === "/api/admin/login" && method === "POST") {
      if (await limited(req, env, "admin", 10))
        return failure("尝试过于频繁，请稍后重试。", 429);
      const input = await body(req, 1024),
        given = await hash(String(input.key || "")),
        expected = await hash(env.ADMIN_KEY);
      let diff = 0;
      for (let i = 0; i < expected.length; i++)
        diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
      if (diff) return failure("管理密钥错误。", 401);
      return json({ active: true }, 200, [
        await newSession(
          req,
          env,
          "admin",
          null,
          await digest(env, "admin-version", env.ADMIN_KEY),
        ),
      ]);
    }
    if (route === "/api/logout" && method === "POST") {
      const c = cookies(req);
      for (const name of ["pd_session", "pd_admin"])
        if (c[name])
          await stmt(
            env,
            "DELETE FROM sessions WHERE token_hash = ?",
            await digest(env, "session", c[name]),
          ).run();
      return json({ ok: true }, 200, [
        cookie(req, "pd_session", "", 0),
        cookie(req, "pd_admin", "", 0),
      ]);
    }
    if (route.startsWith("/api/admin/")) {
      if (!(await session(req, env, true)))
        return failure("请先登录管理后台。", 401);
      if (route === "/api/admin/cards" && method === "GET") {
        const result = await stmt(
          env,
          `SELECT id, suffix, label, duration_days, created_at, activated_at, expires_at, revoked,
        (CASE WHEN device1 IS NULL THEN 0 ELSE 1 END + CASE WHEN device2 IS NULL THEN 0 ELSE 1 END) AS devices FROM cards ORDER BY created_at DESC LIMIT 500`,
        ).all();
        return json({ cards: result.results });
      }
      if (route === "/api/admin/cards" && method === "POST") {
        const input = await body(req, 2048),
          count = Number(input.count),
          days = Number(input.days),
          label = String(input.label || "")
            .trim()
            .slice(0, 80);
        if (
          !Number.isInteger(count) ||
          count < 1 ||
          count > 100 ||
          !Number.isInteger(days) ||
          days < 0 ||
          days > 3650
        )
          return failure("数量需为 1–100；有效天数需为 0–3650，0 表示永久。");
        const created = [],
          queries = [];
        for (let i = 0; i < count; i++) {
          const code = token().slice(0, 32).toUpperCase(),
            id = crypto.randomUUID();
          queries.push(
            stmt(
              env,
              "INSERT INTO cards (id, code_hash, suffix, label, duration_days, created_at) VALUES (?, ?, ?, ?, ?, ?)",
              id,
              await digest(env, "card", code),
              code.slice(-6),
              label,
              days,
              Date.now(),
            ),
          );
          created.push({ id, code: code.match(/.{1,4}/g).join("-") });
        }
        await env.DB.batch(queries);
        return json({ cards: created }, 201);
      }
      const match = route.match(
        /^\/api\/admin\/cards\/([a-f0-9-]{36})\/(revoke|restore|reset)$/,
      );
      if (match && method === "POST") {
        const card = await stmt(
          env,
          "SELECT id FROM cards WHERE id = ?",
          match[1],
        ).first();
        if (!card) return failure("卡密不存在。", 404);
        const sql =
          match[2] === "reset"
            ? "UPDATE cards SET device1 = NULL, device2 = NULL WHERE id = ?"
            : "UPDATE cards SET revoked = ? WHERE id = ?";
        await env.DB.batch([
          match[2] === "reset"
            ? stmt(env, sql, card.id)
            : stmt(env, sql, match[2] === "revoke" ? 1 : 0, card.id),
          stmt(env, "DELETE FROM sessions WHERE card_id = ?", card.id),
        ]);
        return json({ ok: true });
      }
      return failure("接口不存在。", 404);
    }
    const s = await session(req, env);
    if (!s) return failure("请先验证卡密，或重新验证已到期的登录状态。", 401);
    if (route === "/api/projects" && method === "GET") {
      const result = await stmt(
        env,
        "SELECT id, name, updated_at FROM projects WHERE card_id = ? ORDER BY updated_at DESC LIMIT 100",
        s.card_id,
      ).all();
      return json({ projects: result.results });
    }
    if (route === "/api/projects" && method === "POST") {
      const input = await body(req),
        p = input.project;
      if (
        !p ||
        !Number.isInteger(p.width) ||
        !Number.isInteger(p.height) ||
        p.width < 1 ||
        p.height < 1 ||
        p.width > 500 ||
        p.height > 500 ||
        !Array.isArray(p.cells) ||
        p.cells.length !== p.width * p.height ||
        !p.cells.every((c) => c === null || /^#[a-f0-9]{6}$/i.test(c))
      )
        return failure("图纸数据无效。");
      const name = String(input.name || "未命名图纸")
          .trim()
          .slice(0, 80),
        id = crypto.randomUUID();
      const result = await stmt(
        env,
        "INSERT INTO projects (id, card_id, name, data, updated_at) SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM projects WHERE card_id = ?) < 100 RETURNING id",
        id,
        s.card_id,
        name,
        encodeProject(p),
        Date.now(),
        s.card_id,
      ).first();
      if (!result)
        return failure(
          "最多保存 100 份图纸，请先下载备份并删除不需要的历史记录。",
          409,
        );
      return json({ id }, 201);
    }
    const match = route.match(/^\/api\/projects\/([a-f0-9-]{36})$/);
    if (match && method === "GET") {
      const p = await stmt(
        env,
        "SELECT name, data FROM projects WHERE id = ? AND card_id = ?",
        match[1],
        s.card_id,
      ).first();
      return p
        ? json({ name: p.name, project: decodeProject(p.data) })
        : failure("图纸不存在。", 404);
    }
    if (match && method === "DELETE") {
      await stmt(
        env,
        "DELETE FROM projects WHERE id = ? AND card_id = ?",
        match[1],
        s.card_id,
      ).run();
      return json({ ok: true });
    }
    return failure("接口不存在。", 404);
  } catch (e) {
    if (
      [
        "请求数据过大",
        "请求格式无效",
        "图纸颜色超过 65535 种，请减少颜色后保存。",
      ].includes(e.message)
    )
      return failure(e.message, 400);
    console.error("API failure", route, e.name);
    return failure("服务暂时不可用，请重试。", 503);
  }
}
