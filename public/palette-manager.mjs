import { $, modal, toast } from "./bootstrap.mjs";
import {
  BRANDS,
  colorCode,
  groupsFor,
  parsePaletteConfig,
  exportPaletteConfig,
} from "./palette-model.mjs";

export function managePalette(state, onApply) {
  let draft = {
    palette: state.palette,
    selected: new Set(state.selected),
    brand: state.brand,
  };
  const expanded = new Set();
  modal(
    "色板设置",
    `<div class="palette-dialog-top"><p id="paletteSubtitle"></p><h3>色号系统</h3><div id="dialogBrands" class="brand-buttons"></div><p class="muted">切换色号系统仅影响显示，不会改变已选颜色。</p><input type="search" id="paletteSearch" placeholder="⌕  搜索色号…" aria-label="搜索色号"><p class="palette-help">ⓘ 在此选择要使用的拼豆色系。可以选择预设色板，再按需添加或删除特定色号。完成后点击底部的“保存并应用”。</p><div class="palette-actions"><button id="selectAll">全选</button><button id="selectNone">全不选</button><button id="importConfig">↥ 导入配置</button><button id="exportConfig">↧ 导出配置</button></div><input type="file" id="configFile" accept=".json" hidden></div><div id="paletteGroups"></div><footer class="palette-dialog-footer"><button id="cancelPalette">取消</button><button class="primary" id="applyPalette">保存并应用</button></footer>`,
    "palette-dialog",
  );
  const updateCount = () => {
    $("paletteSubtitle").textContent =
      `系统 ${draft.brand} · 已选 ${draft.selected.size} 色`;
  };
  function drawBrands() {
    $("dialogBrands").replaceChildren();
    for (const brand of BRANDS) {
      const b = document.createElement("button");
      b.textContent = brand.label;
      b.className = draft.brand === brand.value ? "primary" : "";
      b.setAttribute("aria-pressed", draft.brand === brand.value);
      b.onclick = () => {
        draft.brand = brand.value;
        expanded.clear();
        drawBrands();
        drawGroups();
        updateCount();
      };
      $("dialogBrands").append(b);
    }
  }
  function drawGroups() {
    const container = $("paletteGroups"),
      scroll = container.scrollTop,
      search = $("paletteSearch").value;
    container.replaceChildren();
    const groups = groupsFor(draft.palette, draft.brand, search);
    if (!groups.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "没有匹配的色号";
      container.append(empty);
    }
    for (const [prefix, colors] of groups) {
      const group = document.createElement("section");
      group.className = "palette-group";
      const header = document.createElement("div");
      header.className = "palette-group-header";
      const toggle = document.createElement("button"),
        tools = document.createElement("div"),
        body = document.createElement("div");
      toggle.className = "group-toggle";
      toggle.textContent = `${prefix} 系列（${colors.length} 色）`;
      body.className = "palette-group-colors";
      const open = search.trim() ? true : expanded.has(prefix);
      body.hidden = !open;
      toggle.setAttribute("aria-expanded", open);
      toggle.onclick = () => {
        expanded.has(prefix) ? expanded.delete(prefix) : expanded.add(prefix);
        body.hidden = !body.hidden;
        toggle.setAttribute("aria-expanded", !body.hidden);
      };
      for (const [label, enabled] of [
        ["全选", true],
        ["全不选", false],
      ]) {
        const b = document.createElement("button");
        b.textContent = label;
        b.className = enabled ? "group-select" : "group-clear";
        b.title = `对该组当前显示的 ${colors.length} 色${label}`;
        b.onclick = () => {
          colors.forEach((c) =>
            enabled ? draft.selected.add(c.hex) : draft.selected.delete(c.hex),
          );
          drawGroups();
          updateCount();
        };
        tools.append(b);
      }
      for (const color of colors) {
        const label = document.createElement("label"),
          checkbox = document.createElement("input"),
          swatch = document.createElement("i"),
          text = document.createElement("span");
        checkbox.type = "checkbox";
        checkbox.checked = draft.selected.has(color.hex);
        checkbox.onchange = () => {
          checkbox.checked
            ? draft.selected.add(color.hex)
            : draft.selected.delete(color.hex);
          updateCount();
        };
        swatch.style.background = color.hex;
        text.textContent = colorCode(color, draft.brand);
        label.title = color.hex;
        label.append(checkbox, swatch, text);
        body.append(label);
      }
      header.append(toggle, tools);
      group.append(header, body);
      container.append(group);
    }
    container.scrollTop = scroll;
  }
  $("paletteSearch").oninput = () => {
    $("paletteGroups").scrollTop = 0;
    drawGroups();
  };
  $("selectAll").onclick = () => {
    draft.selected = new Set(draft.palette.map((c) => c.hex));
    drawGroups();
    updateCount();
  };
  $("selectNone").onclick = () => {
    draft.selected.clear();
    drawGroups();
    updateCount();
  };
  $("cancelPalette").onclick = () => $("dialog").close();
  $("applyPalette").onclick = () => {
    if (!draft.selected.size) return toast("请至少选择一种颜色");
    onApply(draft);
    $("dialog").close();
  };
  $("importConfig").onclick = () => $("configFile").click();
  $("configFile").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error("配置文件不能超过 1 MB");
      const parsed = parsePaletteConfig(
        JSON.parse(await file.text()),
        draft.palette,
        draft.brand,
      );
      draft = parsed;
      expanded.clear();
      $("paletteSearch").value = "";
      drawBrands();
      drawGroups();
      updateCount();
      toast("已导入配置，点击保存并应用后生效");
    } catch (e) {
      toast(e.message);
    }
  };
  $("exportConfig").onclick = () => {
    const blob = new Blob(
        [
          JSON.stringify(
            exportPaletteConfig(draft.palette, draft.selected, draft.brand),
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "pindou-palette-config.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  drawBrands();
  drawGroups();
  updateCount();
}
