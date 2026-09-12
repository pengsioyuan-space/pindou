export const $ = (id) => document.getElementById(id);
let timer;
export function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => ($("toast").hidden = true), 4500);
}
export async function api(path, data, method = "POST") {
  const response = await fetch(path, {
    method: data === undefined && method === "POST" ? "GET" : method,
    headers: { "Content-Type": "application/json", "X-Pindou-Request": "1" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "请求失败");
  return value;
}
export function modal(title, content, className = "") {
  $("dialog").className = className;
  $("dialogTitle").textContent = title;
  $("dialogBody").replaceChildren();
  if (typeof content === "string") $("dialogBody").innerHTML = content;
  else $("dialogBody").append(content);
  if (!$("dialog").open) $("dialog").showModal();
}
$("closeDialog").onclick = () => $("dialog").close();
let activated = false,
  editor;
export async function requireCard() {
  const s = await api("/api/session");
  if (s.active) {
    activated = true;
    return true;
  }
  activated = false;
  login();
  return false;
}
function login() {
  modal(
    "卡密验证",
    '<p class="muted">首次激活开始计时，每张卡最多绑定 2 个浏览器。请向站长获取卡密。</p><form id="activation"><label>卡密<input id="cardCode" type="text" autocomplete="off" placeholder="输入卡密，支持带短横线" required maxlength="80"></label><p class="error" id="activationError" role="alert"></p><button class="primary wide">验证并开始使用</button></form><p class="muted">清除浏览器数据会占用新的绑定名额，可联系站长重置。</p>',
  );
  $("activation").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button");
    b.disabled = true;
    try {
      await api("/api/activate", { code: $("cardCode").value });
      activated = true;
      $("dialog").close();
      await loadEditor();
      toast("验证成功，可以开始制作图纸");
    } catch (e) {
      $("activationError").textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
}
async function loadEditor() {
  if (!editor) {
    editor = await import("./editor.mjs");
    await editor.init();
  }
  $("account").textContent = "卡密状态";
}
$("account").onclick = async () => {
  try {
    const s = await api("/api/session");
    if (!s.active) return login();
    modal(
      "卡密状态",
      `<p>卡密尾号：${s.card.suffix}</p><p>到期时间：${s.card.expiresAt ? new Date(s.card.expiresAt).toLocaleString() : "永久有效"}</p><p>已绑定浏览器：${s.card.devices} / 2</p><button id="logout" class="wide">退出验证</button>`,
    );
    $("logout").onclick = async () => {
      await api("/api/logout", {});
      location.reload();
    };
  } catch (e) {
    toast(e.message);
  }
};
for (const id of [
  "uploadStart",
  "blankStart",
  "import",
  "history",
  "save",
  "download",
  "regenerate",
  "newBlank",
  "textTool",
])
  $(id).onclick = () => {
    if (!activated) login();
  };
for (const id of ["fullscreen", "modeFull"])
  $(id).onclick = () => {
    document.body.classList.toggle("full");
    window.dispatchEvent(new Event("resize"));
  };
for (const id of ["generation", "modeGenerate"])
  $(id).onclick = () => document.body.classList.remove("full");
$("viewport").ondragover = (e) => e.preventDefault();
$("viewport").ondrop = (e) => {
  e.preventDefault();
  if (!activated) login();
};
api("/api/session")
  .then((s) => {
    if (s.active) {
      activated = true;
      return loadEditor();
    }
  })
  .catch((e) => toast(e.message));
