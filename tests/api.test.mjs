import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { sqliteDB } from "../server/sqlite.mjs";
import { handleApi } from "../server/api.mjs";
async function fixture() {
  const DB = sqliteDB(":memory:");
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    DB.exec(
      await readFile(new URL("../drizzle/" + file, import.meta.url), "utf8"),
    );
  const env = {
    DB,
    ADMIN_KEY: "admin-test-only-12345678901234567890",
    APP_SECRET: "test-secret-12345678901234567890123456",
    CLIENT_IP: "test",
  };
  const client = (ip = "test") => {
    const jar = {};
    return async (
      path,
      value,
      method = value === undefined ? "GET" : "POST",
      headers = {},
    ) => {
      const response = await handleApi(
        new Request("https://pindou.test" + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Pindou-Request": "1",
            Cookie: Object.entries(jar)
              .map(([k, v]) => k + "=" + v)
              .join("; "),
            ...headers,
          },
          ...(value === undefined ? {} : { body: JSON.stringify(value) }),
        }),
        { ...env, CLIENT_IP: ip },
      );
      response.headers.getSetCookie().forEach((c) => {
        const [k, v] = c.split(";")[0].split("=");
        jar[k] = v;
      });
      return {
        status: response.status,
        body: await response.json(),
        headers: response.headers,
      };
    };
  };
  const admin = client("admin");
  await admin("/api/admin/login", { key: env.ADMIN_KEY });
  const create = async (days = 30) =>
    (await admin("/api/admin/cards", { days, count: 1, label: "test" })).body
      .cards[0];
  return { DB, env, admin, client, create };
}
test("first activation starts clock; two browsers allowed; third rejected; same browser can reactivate", async () => {
  const f = await fixture();
  try {
    const card = await f.create(),
      a = f.client("a"),
      b = f.client("b"),
      c = f.client("c");
    const before = await f.DB.prepare("SELECT * FROM cards").first();
    assert.equal(before.activated_at, null);
    assert.equal(before.expires_at, null);
    const r = await a("/api/activate", { code: card.code });
    assert.equal(r.status, 200);
    assert.ok(
      r.headers
        .getSetCookie()
        .every(
          (c) =>
            c.includes("HttpOnly") &&
            c.includes("Secure") &&
            c.includes("SameSite=Strict"),
        ),
    );
    const first = await f.DB.prepare("SELECT * FROM cards").first();
    assert.ok(
      Math.abs(first.expires_at - first.activated_at - 30 * 86400000) < 1,
    );
    assert.equal((await b("/api/activate", { code: card.code })).status, 200);
    assert.equal((await c("/api/activate", { code: card.code })).status, 403);
    assert.equal((await a("/api/activate", { code: card.code })).status, 200);
    assert.equal(
      (await f.DB.prepare("SELECT * FROM cards").first()).expires_at,
      first.expires_at,
    );
    assert.equal((await a("/api/session")).body.card.devices, 2);
  } finally {
    f.DB.close();
  }
});
test("concurrent activation cannot occupy a third slot", async () => {
  const f = await fixture();
  try {
    const card = await f.create();
    const results = await Promise.all(
      [f.client("a"), f.client("b"), f.client("c")].map((c) =>
        c("/api/activate", { code: card.code }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 200).length, 2);
    assert.equal(results.filter((r) => r.status === 403).length, 1);
  } finally {
    f.DB.close();
  }
});
test("revocation and reset invalidate sessions; reset does not extend expiry", async () => {
  const f = await fixture();
  try {
    const card = await f.create(),
      a = f.client("a");
    await a("/api/activate", { code: card.code });
    const expiry = (await a("/api/session")).body.card.expiresAt;
    await f.admin(`/api/admin/cards/${card.id}/revoke`, {});
    assert.equal((await a("/api/projects")).status, 401);
    assert.equal((await a("/api/activate", { code: card.code })).status, 403);
    await f.admin(`/api/admin/cards/${card.id}/restore`, {});
    await a("/api/activate", { code: card.code });
    await f.admin(`/api/admin/cards/${card.id}/reset`, {});
    assert.equal((await a("/api/session")).body.active, false);
    const third = f.client("new");
    assert.equal(
      (await third("/api/activate", { code: card.code })).status,
      200,
    );
    assert.equal((await third("/api/session")).body.card.expiresAt, expiry);
  } finally {
    f.DB.close();
  }
});
test("expired card is refused; permanent card has no expiry", async () => {
  const f = await fixture();
  try {
    const card = await f.create(),
      a = f.client("a");
    await a("/api/activate", { code: card.code });
    await f.DB.prepare("UPDATE cards SET expires_at = ? WHERE id = ?")
      .bind(Date.now() - 1, card.id)
      .run();
    assert.equal((await a("/api/session")).body.active, false);
    assert.equal((await a("/api/activate", { code: card.code })).status, 403);
    const permanent = await f.create(0);
    assert.equal(
      (await a("/api/activate", { code: permanent.code })).body.expiresAt,
      null,
    );
  } finally {
    f.DB.close();
  }
});
test("projects persist for same card across browsers; another card cannot read or delete them", async () => {
  const f = await fixture();
  try {
    const card = await f.create(),
      other = await f.create(),
      a = f.client("a"),
      b = f.client("b"),
      c = f.client("c");
    await a("/api/activate", { code: card.code });
    await b("/api/activate", { code: card.code });
    await c("/api/activate", { code: other.code });
    const data = { width: 2, height: 1, cells: ["#FF0000", null] },
      created = await a("/api/projects", { name: "<script>", project: data });
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.deepEqual((await b("/api/projects/" + id)).body.project, data);
    assert.equal((await c("/api/projects/" + id)).status, 404);
    await c("/api/projects/" + id, {}, "DELETE");
    assert.equal((await a("/api/projects/" + id)).status, 200);
    assert.equal(
      (await a("/api/projects", { project: { ...data, cells: ["bad"] } }))
        .status,
      400,
    );
  } finally {
    f.DB.close();
  }
});
test("admin authentication, secret storage, CSRF, input limits, rate limiting", async () => {
  const f = await fixture();
  try {
    const a = f.client("public");
    assert.equal((await a("/api/admin/cards")).status, 401);
    assert.equal((await a("/api/admin/login", { key: "wrong" })).status, 401);
    assert.equal(
      (await a("/api/activate", {}, "POST", { Origin: "https://evil.test" }))
        .status,
      403,
    );
    assert.equal(
      (await a("/api/activate", {}, "POST", { "X-Pindou-Request": "" })).status,
      403,
    );
    const card = await f.create();
    const record = await f.DB.prepare("SELECT * FROM cards WHERE id = ?")
      .bind(card.id)
      .first();
    assert.ok(!JSON.stringify(record).includes(card.code.replaceAll("-", "")));
    assert.equal(
      (await f.admin("/api/admin/cards", { count: 101, days: 1 })).status,
      400,
    );
    let r;
    for (let i = 0; i < 31; i++) r = await a("/api/activate", { code: "bad" });
    assert.equal(r.status, 429);
  } finally {
    f.DB.close();
  }
});
