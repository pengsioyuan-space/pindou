export const EMPTY = null;
export function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
export function hex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}
export function nearest(color, palette) {
  let best = palette[0],
    distance = Infinity;
  for (const p of palette) {
    const c = p.rgb || rgb(p.hex);
    const d = c.reduce((sum, v, i) => sum + (v - color[i]) ** 2, 0);
    if (d < distance) {
      distance = d;
      best = p;
    }
  }
  return best.hex;
}
export function validateProject(p) {
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
    !p.cells.every((c) => c === null || /^#[0-9a-f]{6}$/i.test(c))
  )
    throw new Error("图纸数据无效，宽高需为 1–500 格。");
  return {
    width: p.width,
    height: p.height,
    cells: p.cells.map((c) => c?.toUpperCase() || null),
  };
}
export function counts(cells) {
  const result = new Map();
  cells.forEach((c) => {
    if (c) result.set(c, (result.get(c) || 0) + 1);
  });
  return [...result].sort((a, b) => b[1] - a[1]);
}
export function parseCSV(text) {
  const rows = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .map((row) =>
      row.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1")),
    );
  const width = rows[0]?.length;
  if (!width || rows.some((r) => r.length !== width))
    throw new Error("CSV 每行格数必须一致。");
  return validateProject({
    width,
    height: rows.length,
    cells: rows
      .flat()
      .map((c) => (!c || /^(TRANSPARENT|NULL)$/i.test(c) ? null : c)),
  });
}
export function toCSV(p) {
  return Array.from({ length: p.height }, (_, y) =>
    p.cells
      .slice(y * p.width, (y + 1) * p.width)
      .map((c) => c || "TRANSPARENT")
      .join(","),
  ).join("\n");
}
export function flood(cells, width, height, start, replacement, tolerance = 0) {
  const target = cells[start];
  if (target === undefined || target === replacement) return;
  const match = (c) =>
    c === target ||
    (target &&
      c &&
      tolerance > 0 &&
      Math.hypot(...rgb(c).map((v, i) => v - rgb(target)[i])) <= tolerance);
  const seen = new Uint8Array(cells.length),
    stack = [start];
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    seen[i] = 1;
    if (!match(cells[i])) continue;
    cells[i] = replacement;
    const x = i % width,
      y = Math.floor(i / width);
    if (x) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (y) stack.push(i - width);
    if (y < height - 1) stack.push(i + width);
  }
}
export function removeBackground(p) {
  const edge = [];
  for (let x = 0; x < p.width; x++) {
    edge.push(x, (p.height - 1) * p.width + x);
  }
  for (let y = 1; y < p.height - 1; y++)
    edge.push(y * p.width, y * p.width + p.width - 1);
  const background = counts(edge.map((i) => p.cells[i]))[0]?.[0];
  if (background)
    for (const i of edge)
      if (p.cells[i] === background) flood(p.cells, p.width, p.height, i, null);
}
export function flip(p, vertical = false) {
  const result = p.cells.slice();
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++)
      result[y * p.width + x] =
        p.cells[
          (vertical ? p.height - 1 - y : y) * p.width +
            (vertical ? x : p.width - 1 - x)
        ];
  p.cells = result;
}
export function line(x0, y0, x1, y1, paint) {
  let dx = Math.abs(x1 - x0),
    sx = x0 < x1 ? 1 : -1,
    dy = -Math.abs(y1 - y0),
    sy = y0 < y1 ? 1 : -1,
    error = dx + dy;
  for (;;) {
    paint(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e = 2 * error;
    if (e >= dy) {
      error += dy;
      x0 += sx;
    }
    if (e <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}
export async function pixelate(
  image,
  width,
  palette,
  mode,
  threshold,
  yieldFrame = () => Promise.resolve(),
) {
  if (!palette.length) throw new Error("请至少选择一种颜色。");
  if (!Number.isInteger(width) || width < 10 || width > 500)
    throw new Error("横向格数需为 10–500。");
  const height = Math.max(1, Math.round((width * image.height) / image.width));
  if (height > 500)
    throw new Error("按图片比例计算的高度超过 500 格，请减少横向格数。");
  const pixels = new Array(width * height),
    sample = new Array(width * height),
    pal = palette.map((p) => ({ ...p, rgb: rgb(p.hex) }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * image.width) / width),
        x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / width));
      const y0 = Math.floor((y * image.height) / height),
        y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / height));
      let sum = [0, 0, 0],
        n = 0,
        histogram = new Map();
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * image.width + sx) * 4;
          if (image.data[i + 3] < 128) continue;
          const c = [...image.data.slice(i, i + 3)];
          sum = sum.map((v, j) => v + c[j]);
          n++;
          if (mode === "dominant") {
            const key = c.map((v) => v >> 4).join(",");
            const prev = histogram.get(key) || { n: 0, sum: [0, 0, 0] };
            prev.n++;
            prev.sum = prev.sum.map((v, j) => v + c[j]);
            histogram.set(key, prev);
          }
        }
      if (!n) {
        sample[y * width + x] = null;
        continue;
      }
      if (mode === "dominant") {
        let winner;
        for (const value of histogram.values())
          if (!winner || value.n > winner.n) winner = value;
        sample[y * width + x] = winner.sum.map((v) => v / winner.n);
      } else sample[y * width + x] = sum.map((v) => v / n);
    }
    if (y % 12 === 0) await yieldFrame();
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        c = sample[i];
      if (!c) {
        pixels[i] = null;
        continue;
      }
      const color = nearest(c, pal);
      pixels[i] = color;
      if (mode === "dither") {
        const error = c.map((v, j) => v - rgb(color)[j]);
        for (const [dx, dy, weight] of [
          [1, 0, 7 / 16],
          [-1, 1, 3 / 16],
          [0, 1, 5 / 16],
          [1, 1, 1 / 16],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (nx >= 0 && nx < width && ny < height && sample[ny * width + nx])
            sample[ny * width + nx] = sample[ny * width + nx].map(
              (v, j) => v + error[j] * weight,
            );
        }
      }
    }
    if (y % 12 === 0) await yieldFrame();
  }
  if (!["dither", "palette"].includes(mode) && threshold > 0) {
    const common = counts(pixels).map(([c]) => c),
      mapping = new Map(),
      limit = mode === "smooth" ? Math.max(45, threshold) : threshold;
    for (const c of common) {
      const near = [...mapping.keys()].find(
        (k) => Math.hypot(...rgb(c).map((v, i) => v - rgb(k)[i])) <= limit,
      );
      mapping.set(c, near ? mapping.get(near) : c);
    }
    pixels.forEach((c, i) => {
      if (c) pixels[i] = mapping.get(c);
    });
  }
  return { width, height, cells: pixels };
}
