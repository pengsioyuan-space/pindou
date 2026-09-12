import { $, api, modal, toast, requireCard } from "./bootstrap.mjs";
import { BRANDS, sortColors, selectedPreset } from "./palette-model.mjs";
import { managePalette as openPaletteManager } from "./palette-manager.mjs";
import {
  rgb,
  pixelate,
  counts,
  parseCSV,
  toCSV,
  validateProject,
  flood,
  flip,
  removeBackground,
  line,
} from "./engine.mjs";
let p = null,
  palette = [],
  presets = {},
  brushSelected = false,
  showAllColors = true,
  selected = new Set(),
  imageData = null,
  undoStack = [],
  redoStack = [],
  tool = "pan",
  zoom = 1,
  showKeys = false,
  showCoords = false,
  highlighted = false,
  drawing = null,
  dirty = false;
const toolNames = {
  brush: "画笔",
  pick: "取色",
  pan: "拖拽",
  fill: "填充",
  rect: "矩形",
  erase: "橡皮",
};
const copy = () => ({
  width: p.width,
  height: p.height,
  cells: p.cells.slice(),
});
const code = (c) =>
  palette.find((e) => e.hex === c)?.codes?.[$("brand").value] || c;
const contrast = (c) =>
  rgb(c).reduce((s, v, i) => s + v * [0.299, 0.587, 0.114][i], 0) > 145
    ? "#263042"
    : "#fff";
function remember() {
  if (!p) return;
  undoStack.push(copy());
  let total = undoStack.reduce((sum, item) => sum + item.cells.length, 0);
  while (undoStack.length > 1 && (undoStack.length > 35 || total > 2000000))
    total -= undoStack.shift().cells.length;
  redoStack = [];
  dirty = true;
}
function setProject(next) {
  p = validateProject(next);
  undoStack = [];
  redoStack = [];
  dirty = false;
  $("gridWidth").value = Math.max(10, p.width);
  $("widthNumber").value = p.width;
  $("widthOut").value = p.width;
  $("empty").hidden = true;
  $("canvas").hidden = false;
  zoom = 1;
  render();
}
function need() {
  if (!p) {
    toast("请先导入图片或创建画板");
    return false;
  }
  return true;
}
function choose(c) {
  brushSelected = true;
  $("color").value = c;
  $("colorName").textContent = "当前：" + code(c);
  renderPalette();
  if (highlighted) render();
}
function selectTool(value) {
  tool = value;
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => b.classList.toggle("primary", b.dataset.tool === tool));
  $("currentTool").textContent = "当前：" + toolNames[tool];
  $("toolHint").textContent = `${toolNames[tool]} · 滚轮配合 Ctrl 缩放`;
  $("canvas").style.cursor =
    tool === "pan" ? "grab" : tool === "pick" ? "copy" : "crosshair";
}
function renderPalette() {
  $("swatches").replaceChildren();
  const used = new Set(p?.cells.filter(Boolean) || []);
  const visible = palette.filter((e) =>
    showAllColors ? selected.has(e.hex) : used.has(e.hex),
  );
  for (const item of sortColors(visible, $("brand").value)) {
    const b = document.createElement("button");
    b.className =
      "swatch" +
      (brushSelected && item.hex === $("color").value.toUpperCase()
        ? " selected"
        : "");
    b.style.background = item.hex;
    b.style.color = contrast(item.hex);
    b.textContent = item.codes?.[$("brand").value] || "";
    b.title = `${b.textContent} ${item.hex}`;
    b.onclick = () => choose(item.hex);
    $("swatches").append(b);
  }
  $("paletteTotal").textContent = `可用色 ${selected.size}`;
  $("paletteView").textContent = showAllColors
    ? `完整色板（${selected.size}）`
    : `图片颜色（${visible.length}）· 展开完整色板`;
  renderPresetButtons();
}
function render() {
  if (!p) return;
  const c = $("canvas"),
    ctx = c.getContext("2d"),
    unit = Math.max(
      5,
      Math.min(24, Math.floor(2600 / Math.max(p.width, p.height))),
    ),
    margin = showCoords ? 28 : 0;
  c.width = p.width * unit + margin;
  c.height = p.height * unit + margin;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const color = p.cells[y * p.width + x];
      ctx.fillStyle = !color
        ? (x + y) % 2
          ? "#edf0f4"
          : "#fff"
        : highlighted && color !== $("color").value.toUpperCase()
          ? "#e9ecf1"
          : color;
      ctx.fillRect(margin + x * unit, margin + y * unit, unit, unit);
      if (showKeys && color && unit >= 12) {
        ctx.fillStyle = contrast(color);
        ctx.font = `${Math.max(6, unit * 0.36)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          code(color).replace(/^#/, "").slice(0, 5),
          margin + (x + 0.5) * unit,
          margin + (y + 0.5) * unit,
        );
      }
    }
  ctx.lineWidth = 1;
  for (let x = 0; x <= p.width; x++) {
    ctx.strokeStyle = x % 10 ? "#87909e55" : "#6d788999";
    ctx.beginPath();
    ctx.moveTo(margin + x * unit + 0.5, margin);
    ctx.lineTo(margin + x * unit + 0.5, c.height);
    ctx.stroke();
  }
  for (let y = 0; y <= p.height; y++) {
    ctx.strokeStyle = y % 10 ? "#87909e55" : "#6d788999";
    ctx.beginPath();
    ctx.moveTo(margin, margin + y * unit + 0.5);
    ctx.lineTo(c.width, margin + y * unit + 0.5);
    ctx.stroke();
  }
  if (showCoords) {
    ctx.fillStyle = "#526178";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let x = 0; x < p.width; x++)
      if (x === 0 || (x + 1) % 5 === 0)
        ctx.fillText(x + 1, margin + (x + 0.5) * unit, 14);
    for (let y = 0; y < p.height; y++)
      if (y === 0 || (y + 1) % 5 === 0)
        ctx.fillText(y + 1, 14, margin + (y + 0.5) * unit);
  }
  const fit = Math.min(
    ($("viewport").clientWidth - 52) / c.width,
    ($("viewport").clientHeight - 52) / c.height,
    1,
  );
  c.style.width = `${Math.max(1, c.width * fit * zoom)}px`;
  $("viewport").style.placeItems = zoom > 1 ? "start" : "center";
  c.style.height = `${Math.max(1, c.height * fit * zoom)}px`;
  c.dataset.margin = margin;
  c.dataset.unit = unit;
  $("zoomLabel").textContent = Math.round(zoom * 100) + "%";
  $("dimensions").textContent = `模具尺寸 ${p.width}×${p.height}`;
  const entries = counts(p.cells),
    total = entries.reduce((s, [, n]) => s + n, 0);
  $("summary").textContent =
    `${p.width}×${p.height} 格 · ${entries.length} 色 · ${total.toLocaleString()} 颗豆子${dirty ? " · 未保存" : ""}`;
  $("beadTotal").textContent = `${total.toLocaleString()} 颗`;
  $("colorCounts").replaceChildren();
  for (const [color, amount] of entries) {
    const row = document.createElement("button");
    row.className = "count-row";
    const swatch = document.createElement("i"),
      text = document.createElement("span"),
      n = document.createElement("b");
    swatch.style.background = color;
    text.textContent = code(color);
    n.textContent = amount + " 颗";
    row.append(swatch, text, n);
    row.onclick = () => replaceColor(color, amount);
    $("colorCounts").append(row);
  }
  $("undo").disabled = !undoStack.length;
  $("redo").disabled = !redoStack.length;
  if (!showAllColors) renderPalette();
}
function point(e) {
  const c = $("canvas"),
    r = c.getBoundingClientRect(),
    unit = Number(c.dataset.unit),
    margin = Number(c.dataset.margin);
  return {
    x: Math.floor((((e.clientX - r.left) * c.width) / r.width - margin) / unit),
    y: Math.floor(
      (((e.clientY - r.top) * c.height) / r.height - margin) / unit,
    ),
  };
}
function paint(x, y) {
  const size = Math.max(1, Math.min(20, Number($("brushSize").value) || 1)),
    offset = Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) {
      const nx = x + dx - offset,
        ny = y + dy - offset;
      if (nx >= 0 && nx < p.width && ny >= 0 && ny < p.height)
        p.cells[ny * p.width + nx] =
          tool === "erase" ? null : $("color").value.toUpperCase();
    }
}
function inBounds(q) {
  return q.x >= 0 && q.x < p.width && q.y >= 0 && q.y < p.height;
}
function events() {
  const c = $("canvas");
  c.onpointerdown = (e) => {
    if (!p || e.button !== 0) return;
    const q = point(e);
    if (!inBounds(q)) return;
    if (["brush", "fill", "rect"].includes(tool) && !brushSelected)
      return toast("请先在画笔色板中选择颜色");
    e.preventDefault();
    c.setPointerCapture(e.pointerId);
    if (tool === "pick") {
      const color = p.cells[q.y * p.width + q.x];
      if (color) choose(color);
      selectTool("brush");
      return;
    }
    if (tool === "pan") {
      drawing = {
        pan: true,
        clientX: e.clientX,
        clientY: e.clientY,
        left: $("viewport").scrollLeft,
        top: $("viewport").scrollTop,
      };
      return;
    }
    remember();
    drawing = {
      start: q,
      last: q,
      original: tool === "rect" ? p.cells.slice() : null,
    };
    if (tool === "fill") {
      flood(
        p.cells,
        p.width,
        p.height,
        q.y * p.width + q.x,
        $("color").value.toUpperCase(),
      );
      drawing = null;
    } else if (tool !== "rect") paint(q.x, q.y);
    render();
  };
  c.onpointermove = (e) => {
    if (!drawing) return;
    if (drawing.pan) {
      $("viewport").scrollLeft = drawing.left - e.clientX + drawing.clientX;
      $("viewport").scrollTop = drawing.top - e.clientY + drawing.clientY;
      return;
    }
    const q = point(e);
    q.x = Math.max(0, Math.min(p.width - 1, q.x));
    q.y = Math.max(0, Math.min(p.height - 1, q.y));
    if (tool === "rect") {
      p.cells = drawing.original.slice();
      const left = Math.min(q.x, drawing.start.x),
        right = Math.max(q.x, drawing.start.x),
        top = Math.min(q.y, drawing.start.y),
        bottom = Math.max(q.y, drawing.start.y);
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++)
          if (
            $("solid").checked ||
            x === left ||
            x === right ||
            y === top ||
            y === bottom
          )
            p.cells[y * p.width + x] = $("color").value.toUpperCase();
    } else line(drawing.last.x, drawing.last.y, q.x, q.y, paint);
    drawing.last = q;
    render();
  };
  c.onpointerup = () => {
    if (
      drawing?.original &&
      drawing.start.x === drawing.last.x &&
      drawing.start.y === drawing.last.y
    ) {
      p.cells[drawing.start.y * p.width + drawing.start.x] =
        $("color").value.toUpperCase();
      render();
    }
    drawing = null;
  };
  c.onpointercancel = () => {
    drawing = null;
  };
  $("viewport").onwheel = (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      zoom = Math.max(0.25, Math.min(8, zoom * (e.deltaY < 0 ? 1.15 : 0.87)));
      render();
    }
  };
  document.addEventListener("keydown", (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || $("dialog").open)
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      $(e.shiftKey ? "redo" : "undo").click();
      return;
    }
    const key = e.key.toLowerCase(),
      map = { h: "pan", b: "brush", i: "pick", f: "fill", r: "rect" };
    if (map[key]) selectTool(map[key]);
    if (key === "e") $("undo").click();
  });
}
async function generate() {
  if (!imageData) {
    toast("请先导入图片；空白画板请使用“调整画布”");
    return;
  }
  if (!(await requireCard())) return;
  if (dirty && !confirm("重新生成会覆盖手工修改，继续吗？")) return;
  $("busy").hidden = false;
  try {
    const next = await pixelate(
      imageData,
      Number($("widthNumber").value),
      palette.filter((e) => selected.has(e.hex)),
      $("mode").value,
      Number($("threshold").value),
      () => new Promise(requestAnimationFrame),
    );
    setProject(next);
    dirty = true;
    render();
  } catch (e) {
    toast(e.message);
  } finally {
    $("busy").hidden = true;
  }
}
async function importFile(file) {
  if (!file || !(await requireCard())) return;
  if (file.size > 25 * 1024 * 1024) throw new Error("文件需小于 25 MB。");
  if (dirty && !confirm("导入会替换当前未保存的图纸，继续吗？")) return;
  if (/\.csv$/i.test(file.name)) {
    const next = parseCSV(await file.text());
    imageData = null;
    setProject(next);
    dirty = true;
    render();
    return;
  }
  if (/\.json$/i.test(file.name)) {
    const next = validateProject(JSON.parse(await file.text()));
    imageData = null;
    setProject(next);
    dirty = true;
    render();
    return;
  }
  if (!/^image\/(png|jpeg)$/.test(file.type))
    throw new Error("仅支持 JPG、PNG、CSV 或图纸 JSON。");
  const bitmap = await createImageBitmap(file),
    ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
    off = document.createElement("canvas");
  off.width = Math.max(1, Math.round(bitmap.width * ratio));
  off.height = Math.max(1, Math.round(bitmap.height * ratio));
  const ctx = off.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, off.width, off.height);
  bitmap.close();
  imageData = ctx.getImageData(0, 0, off.width, off.height);
  dirty = false;
  await generate();
}
function blank() {
  if (dirty && !confirm("新建将替换未保存图纸，继续吗？")) return;
  imageData = null;
  setProject({ width: 100, height: 100, cells: Array(10000).fill(null) });
  dirty = true;
  render();
}
function saveDownload(name, blob) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function downloadDialog() {
  if (!need()) return;
  modal(
    "下载图纸设置",
    '<label class="check"><input type="checkbox" id="exportGrid" checked>显示网格线</label><label>网格线间隔 <input type="number" id="gridEvery" min="1" max="20" value="1"></label><label class="check"><input type="checkbox" id="exportCoords" checked>显示坐标数字</label><label class="check"><input type="checkbox" id="exportKeys" checked>显示格内色号</label><label class="check"><input type="checkbox" id="exportCounts" checked>包含色号统计</label><label>每格像素 <input type="number" id="exportSize" min="10" max="30" value="18"></label><p id="exportError" class="error"></p><button class="primary wide" id="pngExport">下载 PNG 图纸</button><button class="wide" id="csvExport">下载 CSV（可重新导入）</button><button class="wide" id="jsonExport">下载图纸 JSON</button>',
  );
  $("csvExport").onclick = () =>
    saveDownload(
      "pindou.csv",
      new Blob(["\uFEFF" + toCSV(p)], { type: "text/csv;charset=utf-8" }),
    );
  $("jsonExport").onclick = () =>
    saveDownload(
      "pindou.json",
      new Blob([JSON.stringify(p)], { type: "application/json" }),
    );
  $("pngExport").onclick = () => {
    const size = Number($("exportSize").value),
      every = Number($("gridEvery").value);
    if (
      !Number.isInteger(size) ||
      size < 10 ||
      size > 30 ||
      !Number.isInteger(every) ||
      every < 1 ||
      every > 20
    ) {
      $("exportError").textContent = "请输入有效的像素尺寸和网格间隔。";
      return;
    }
    const entries = counts(p.cells),
      margin = 40,
      width = Math.max(480, p.width * size + margin * 2),
      columns = Math.max(1, Math.floor((width - 80) / 130)),
      countHeight = $("exportCounts").checked
        ? Math.ceil(entries.length / columns) * 28 + 50
        : 0,
      height = p.height * size + margin * 2 + 38 + countHeight;
    if (width * height > 40000000 || width > 10000 || height > 10000) {
      $("exportError").textContent = "导出尺寸过大，请减小每格像素或关闭统计。";
      return;
    }
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#263449";
    ctx.font = "20px sans-serif";
    ctx.fillText(
      `拼豆图纸 · ${p.width}×${p.height} · ${$("brand").value}`,
      margin,
      30,
    );
    const top = margin + 38;
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) {
        const color = p.cells[y * p.width + x];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(margin + x * size, top + y * size, size, size);
        if ($("exportKeys").checked) {
          ctx.fillStyle = contrast(color);
          ctx.font = `${Math.max(6, size * 0.38)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            code(color).replace(/^#/, "").slice(0, 6),
            margin + (x + 0.5) * size,
            top + (y + 0.5) * size,
            size - 1,
          );
        }
      }
    if ($("exportGrid").checked) {
      ctx.strokeStyle = "#6f778b";
      ctx.lineWidth = 0.6;
      for (let x = 0; x <= p.width; x++)
        if (x % every === 0 || x === p.width) {
          ctx.beginPath();
          ctx.moveTo(margin + x * size, top);
          ctx.lineTo(margin + x * size, top + p.height * size);
          ctx.stroke();
        }
      for (let y = 0; y <= p.height; y++)
        if (y % every === 0 || y === p.height) {
          ctx.beginPath();
          ctx.moveTo(margin, top + y * size);
          ctx.lineTo(margin + p.width * size, top + y * size);
          ctx.stroke();
        }
    }
    if ($("exportCoords").checked) {
      ctx.fillStyle = "#34415a";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let x = 0; x < p.width; x++)
        if (x === 0 || (x + 1) % 5 === 0)
          ctx.fillText(x + 1, margin + (x + 0.5) * size, top - 13);
      for (let y = 0; y < p.height; y++)
        if (y === 0 || (y + 1) % 5 === 0)
          ctx.fillText(y + 1, margin - 18, top + (y + 0.5) * size);
    }
    if ($("exportCounts").checked) {
      const start = top + p.height * size + 25;
      ctx.textAlign = "left";
      ctx.font = "13px sans-serif";
      entries.forEach(([color, n], i) => {
        const x = margin + (i % columns) * 130,
          y = start + Math.floor(i / columns) * 28;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 18, 18);
        ctx.strokeStyle = "#ccc";
        ctx.strokeRect(x, y, 18, 18);
        ctx.fillStyle = "#283348";
        ctx.fillText(`${code(color)} × ${n}`, x + 24, y + 10);
      });
    }
    out.toBlob((blob) => {
      if (blob) {
        saveDownload(`pindou-${p.width}x${p.height}.png`, blob);
        toast("PNG 已生成");
      } else toast("图片生成失败，请减小尺寸");
    }, "image/png");
  };
}
function renderPresetButtons() {
  const active = selectedPreset(presets, $("brand").value, selected);
  $("presetButtons").replaceChildren();
  for (const size of [291, 221, 144, 120]) {
    const button = document.createElement("button");
    button.textContent = size + "色";
    button.className = active === String(size) ? "primary" : "";
    button.setAttribute("aria-pressed", active === String(size));
    button.onclick = () => {
      const values = presets[$("brand").value][size];
      const known = new Set(palette.map((c) => c.hex));
      if (values.some((c) => !known.has(c)))
        return toast("当前为自定义色板，请先导入完整色板再选择此预设");
      selected = new Set(values);
      renderPalette();
      toast("已选择 " + size + " 色，重新生成时应用");
    };
    $("presetButtons").append(button);
  }
  $("presetStatus").hidden = !!active;
  $("presetStatus").textContent = "自定义 · " + selected.size + " 色";
}
function renderBrands() {
  $("brandButtons").replaceChildren();
  for (const brand of BRANDS) {
    const button = document.createElement("button");
    button.textContent = brand.label;
    button.className = $("brand").value === brand.value ? "primary" : "";
    button.setAttribute("aria-pressed", $("brand").value === brand.value);
    button.onclick = () => {
      $("brand").value = brand.value;
      $("brand").onchange();
    };
    $("brandButtons").append(button);
  }
}
function managePalette() {
  openPaletteManager({ palette, selected, brand: $("brand").value }, (next) => {
    palette = next.palette;
    selected = next.selected;
    $("brand").value = next.brand;
    renderBrands();
    renderPalette();
    render();
    if (brushSelected)
      $("colorName").textContent =
        "当前：" + code($("color").value.toUpperCase());
    toast("色板已应用，重新生成图片时使用所选颜色");
  });
}
function replaceColor(from, amount) {
  const body = document.createElement("div"),
    hint = document.createElement("p"),
    grid = document.createElement("div");
  hint.className = "muted";
  hint.textContent =
    "将 " + code(from) + " 的 " + amount + " 颗替换为所选颜色，可撤回。";
  grid.className = "swatches";
  for (const color of sortColors(
    palette.filter((c) => selected.has(c.hex)),
    $("brand").value,
  )) {
    const button = document.createElement("button");
    button.className = "swatch";
    button.style.background = color.hex;
    button.style.color = contrast(color.hex);
    button.textContent = code(color.hex);
    button.title = code(color.hex) + " " + color.hex;
    button.onclick = () => {
      if (from !== color.hex) {
        remember();
        p.cells = p.cells.map((c) => (c === from ? color.hex : c));
        render();
      }
      $("dialog").close();
    };
    grid.append(button);
  }
  body.append(hint, grid);
  modal("替换杂色", body);
}
export async function init() {
  const response = await fetch("./palette.json");
  if (!response.ok) throw new Error("色板加载失败");
  palette = await response.json();
  const presetResponse = await fetch("./presets.json");
  if (!presetResponse.ok) throw new Error("预设加载失败");
  presets = await presetResponse.json();
  selected = new Set(presets.MARD[221]);
  renderBrands();
  renderPalette();
  events();
  const action = (id, fn) => {
    $(id).onclick = async () => {
      try {
        await fn();
      } catch (e) {
        toast(e.message);
      }
    };
  };
  for (const id of ["uploadStart", "import"])
    action(id, async () => {
      if (await requireCard()) $("file").click();
    });
  for (const id of ["blankStart", "newBlank"])
    action(id, async () => {
      if (await requireCard()) blank();
    });
  $("file").onchange = (e) => {
    importFile(e.target.files[0]).catch((e) => toast(e.message));
    e.target.value = "";
  };
  $("viewport").ondrop = (e) => {
    e.preventDefault();
    importFile(e.dataTransfer.files[0]).catch((e) => toast(e.message));
  };
  $("gridWidth").oninput = () => {
    $("widthNumber").value = $("gridWidth").value;
    $("widthOut").value = $("gridWidth").value;
  };
  $("widthNumber").oninput = () => {
    $("gridWidth").value = $("widthNumber").value;
    $("widthOut").value = $("widthNumber").value;
  };
  $("threshold").oninput = () => {
    $("thresholdOut").value = $("threshold").value;
    $("thresholdNumber").value = $("threshold").value;
  };
  action("applyThreshold", () => {
    const value = Number($("thresholdNumber").value);
    if (
      $("thresholdNumber").value.trim() === "" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 100
    )
      return toast("阈值需为 0–100 的整数");
    $("threshold").value = value;
    $("thresholdOut").value = value;
    if (imageData) return generate();
  });
  action("regenerate", generate);
  action("applySize", generate);
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => (b.onclick = () => selectTool(b.dataset.tool)));
  action("undo", () => {
    if (undoStack.length) {
      redoStack.push(copy());
      p = undoStack.pop();
      dirty = true;
      render();
    }
  });
  action("redo", () => {
    if (redoStack.length) {
      undoStack.push(copy());
      p = redoStack.pop();
      dirty = true;
      render();
    }
  });
  for (const [id, fn] of [
    ["flipX", () => flip(p)],
    ["flipY", () => flip(p, true)],
    ["background", () => removeBackground(p)],
  ])
    action(id, () => {
      if (need()) {
        remember();
        fn();
        render();
      }
    });
  action("keys", () => {
    showKeys = !showKeys;
    $("keys").classList.toggle("primary", showKeys);
    render();
    if (showKeys && p && Number($("canvas").dataset.unit) < 12)
      toast("当前网格较密，完整色号请在下载图纸中查看");
  });
  action("coords", () => {
    showCoords = !showCoords;
    $("coords").classList.toggle("primary", showCoords);
    render();
  });
  action("highlight", () => {
    highlighted = !highlighted;
    $("highlight").classList.toggle("primary", highlighted);
    render();
  });
  $("color").oninput = () => choose($("color").value.toUpperCase());
  $("brand").onchange = () => {
    renderPalette();
    render();
    renderBrands();
    if (brushSelected)
      $("colorName").textContent =
        "当前：" + code($("color").value.toUpperCase());
  };
  action("zoomIn", () => {
    zoom = Math.min(8, zoom * 1.25);
    render();
  });
  action("zoomOut", () => {
    zoom = Math.max(0.25, zoom / 1.25);
    render();
  });
  action("fit", () => {
    zoom = 1;
    render();
  });
  window.addEventListener("resize", () => {
    if (p) render();
  });
  action("replace", () => {
    if (need()) {
      $("replacementPanel").scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      toast("点击用量列表中的颜色，再选择替换色");
    }
  });
  action("resize", () => {
    if (!need()) return;
    modal(
      "调整画布",
      '<p class="muted">保留左上方图案；缩小会裁掉超出部分，可撤回。</p><label>宽度 <input id="resizeW" type="number" min="1" max="500"></label><label>高度 <input id="resizeH" type="number" min="1" max="500"></label><button class="primary wide" id="resizeNow">调整</button>',
    );
    $("resizeW").value = p.width;
    $("resizeH").value = p.height;
    $("resizeNow").onclick = () => {
      const w = Number($("resizeW").value),
        h = Number($("resizeH").value);
      if (
        !Number.isInteger(w) ||
        !Number.isInteger(h) ||
        w < 1 ||
        h < 1 ||
        w > 500 ||
        h > 500
      )
        return toast("宽高需为 1–500 的整数");
      remember();
      const cells = Array(w * h).fill(null);
      for (let y = 0; y < Math.min(h, p.height); y++)
        for (let x = 0; x < Math.min(w, p.width); x++)
          cells[y * w + x] = p.cells[y * p.width + x];
      p = { width: w, height: h, cells };
      render();
      $("dialog").close();
    };
  });
  action("textTool", async () => {
    if (!(await requireCard())) return;
    modal(
      "文字生成",
      '<p class="muted">使用当前画笔颜色生成最多 5 个字，替换当前画布。</p><input id="textInput" type="text" placeholder="输入文字"><label>单字高度 <input id="textHeight" type="number" min="16" max="80" value="32"></label><button class="primary wide" id="textNow">生成拼豆图</button>',
    );
    $("textNow").onclick = () => {
      const text = $("textInput").value.trim(),
        size = Number($("textHeight").value);
      if (
        ![...text].length ||
        [...text].length > 5 ||
        !Number.isInteger(size) ||
        size < 16 ||
        size > 80
      )
        return toast("请输入 1–5 个字，高度 16–80");
      if (dirty && !confirm("替换当前未保存图纸？")) return;
      const c = document.createElement("canvas");
      c.width = [...text].length * size + 8;
      c.height = size + 8;
      const ctx = c.getContext("2d");
      ctx.font = `bold ${size}px "Microsoft YaHei",sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(text, 4, 2);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      imageData = null;
      setProject({
        width: c.width,
        height: c.height,
        cells: Array.from({ length: c.width * c.height }, (_, i) =>
          data[i * 4 + 3] > 100 ? $("color").value.toUpperCase() : null,
        ),
      });
      dirty = true;
      render();
      $("dialog").close();
    };
  });
  action("download", async () => {
    if (await requireCard()) downloadDialog();
  });
  action("paletteManage", managePalette);
  action("downloadBottom", async () => {
    if (await requireCard()) downloadDialog();
  });
  action("paletteView", () => {
    showAllColors = !showAllColors;
    renderPalette();
  });
  action("save", async () => {
    if (!need() || !(await requireCard())) return;
    modal(
      "保存图纸",
      '<p class="muted">保存到服务器，同一卡密的两个浏览器均可打开。</p><input type="text" id="projectName" maxlength="80" placeholder="图纸名称"><p id="saveError" class="error"></p><button class="primary wide" id="saveNow">保存</button>',
    );
    $("saveNow").onclick = async () => {
      $("saveNow").disabled = true;
      try {
        await api("/api/projects", {
          name: $("projectName").value || "未命名图纸",
          project: copy(),
        });
        dirty = false;
        render();
        $("dialog").close();
        toast("图纸已保存");
      } catch (e) {
        $("saveError").textContent = e.message;
      } finally {
        $("saveNow").disabled = false;
      }
    };
  });
  action("history", async () => {
    if (!(await requireCard())) return;
    const result = await api("/api/projects");
    const content = document.createElement("div");
    if (!result.projects.length) {
      const text = document.createElement("p");
      text.className = "muted";
      text.textContent = "还没有保存的图纸";
      content.append(text);
    }
    for (const item of result.projects) {
      const row = document.createElement("div"),
        name = document.createElement("span"),
        open = document.createElement("button"),
        remove = document.createElement("button");
      row.className = "history-item";
      name.textContent = item.name;
      name.title = new Date(item.updated_at).toLocaleString();
      open.textContent = "打开";
      remove.textContent = "删除";
      remove.className = "danger";
      open.onclick = async () => {
        try {
          if (dirty && !confirm("打开将替换未保存图纸，继续吗？")) return;
          const saved = await api("/api/projects/" + item.id);
          imageData = null;
          setProject(saved.project);
          $("dialog").close();
        } catch (e) {
          toast(e.message);
        }
      };
      remove.onclick = async () => {
        if (!confirm("永久删除这份服务器图纸？请确认已下载备份。")) return;
        try {
          await api("/api/projects/" + item.id, {}, "DELETE");
          row.remove();
        } catch (e) {
          toast(e.message);
        }
      };
      row.append(name, open, remove);
      content.append(row);
    }
    modal("历史记录", content);
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  const context = document.modelContext;
  if (context?.registerTool) {
    const lifetime = new AbortController();
    for (const definition of [
      {
        name: "get_pattern_summary",
        description: "读取当前图纸尺寸及各颜色用量",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: async () =>
          p
            ? { width: p.width, height: p.height, colors: counts(p.cells) }
            : { empty: true },
      },
      {
        name: "set_editor_tool",
        description: "选择编辑工具，不修改图纸",
        inputSchema: {
          type: "object",
          properties: {
            tool: { type: "string", enum: Object.keys(toolNames) },
          },
          required: ["tool"],
          additionalProperties: false,
        },
        execute: async (input) => {
          if (!input || !Object.hasOwn(toolNames, input.tool))
            throw new Error("无效工具");
          selectTool(input.tool);
          return { tool };
        },
      },
    ])
      Promise.resolve(
        context.registerTool(definition, { signal: lifetime.signal }),
      ).catch(() => {});
    window.addEventListener("pagehide", () => lifetime.abort(), { once: true });
  }
}
