const $ = (id) => document.getElementById(id);
async function api(path, body) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Pindou-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await r.json();
  if (!r.ok) {
    if (r.status === 401) {
      $("adminLogin").hidden = false;
      $("adminContent").hidden = true;
    }
    throw new Error(value.error || "请求失败");
  }
  return value;
}
const error = (e) => ($("adminError").textContent = e.message);
const date = (value) => (value ? new Date(value).toLocaleString() : "—");
async function refresh() {
  const { cards } = await api("/api/admin/cards");
  $("adminLogin").hidden = true;
  $("adminContent").hidden = false;
  $("cardsTable").replaceChildren();
  $("adminError").textContent = "";
  for (const card of cards) {
    const row = document.createElement("tr");
    const status = card.revoked
      ? "已停用"
      : card.expires_at && card.expires_at <= Date.now()
        ? "已到期"
        : card.activated_at
          ? "使用中"
          : "未激活";
    for (const value of [
      card.suffix,
      card.label || "—",
      card.duration_days ? `${card.duration_days} 天` : "永久",
      status,
      date(card.activated_at),
      card.duration_days === 0 ? "永久" : date(card.expires_at),
      `${card.devices} / 2`,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    const actions = document.createElement("td");
    for (const [action, label] of [
      [card.revoked ? "restore" : "revoke", card.revoked ? "恢复" : "停用"],
      ["reset", "重置绑定"],
    ]) {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = async () => {
        if (!confirm(`${label}尾号 ${card.suffix} 的卡密？现有登录将失效。`))
          return;
        b.disabled = true;
        try {
          await api(`/api/admin/cards/${card.id}/${action}`, {});
          await refresh();
        } catch (e) {
          error(e);
          b.disabled = false;
        }
      };
      actions.append(b);
    }
    row.append(actions);
    $("cardsTable").append(row);
  }
}
$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const b = e.target.querySelector("button");
  b.disabled = true;
  try {
    await api("/api/admin/login", { key: $("adminKey").value });
    $("adminKey").value = "";
    await refresh();
  } catch (e) {
    error(e);
  } finally {
    b.disabled = false;
  }
};
$("createCards").onsubmit = async (e) => {
  e.preventDefault();
  if (
    !$("generated").hidden &&
    !confirm("请确认上一批卡密已经下载。继续会替换当前显示的明文卡密。")
  )
    return;
  $("createButton").disabled = true;
  try {
    const value = await api("/api/admin/cards", {
      count: Number($("cardCount").value),
      days: Number($("cardDays").value),
      label: $("batchLabel").value,
    });
    $("generatedCodes").value = value.cards.map((c) => c.code).join("\n");
    $("generated").hidden = false;
    await refresh();
  } catch (e) {
    error(e);
  } finally {
    $("createButton").disabled = false;
  }
};
$("downloadCodes").onclick = () => {
  const blob = new Blob([$("generatedCodes").value], {
      type: "text/plain;charset=utf-8",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "pindou-cards.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
$("clearCodes").onclick = () => {
  if (confirm("确认已经下载保存这些卡密？清空后不能再次查看明文。")) {
    $("generatedCodes").value = "";
    $("generated").hidden = true;
  }
};
$("refreshCards").onclick = () => refresh().catch(error);
$("adminLogout").onclick = async () => {
  try {
    await api("/api/logout", {});
    location.reload();
  } catch (e) {
    error(e);
  }
};
refresh().catch((e) => {
  if (!e.message.includes("请先登录")) error(e);
});
window.addEventListener("beforeunload", (e) => {
  if ($("generatedCodes").value) {
    e.preventDefault();
    e.returnValue = "";
  }
});
