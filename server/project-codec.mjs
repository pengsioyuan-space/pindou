// Compact color indexes keep a 500×500 project below D1's per-row size budget.
export function encodeProject(p) {
  const colors = [null],
    indexes = new Map([[null, 0]]),
    bytes = new Uint8Array(p.cells.length * 2);
  p.cells.forEach((c, i) => {
    if (!indexes.has(c)) {
      if (colors.length >= 65536)
        throw new Error("图纸颜色超过 65535 种，请减少颜色后保存。");
      indexes.set(c, colors.length);
      colors.push(c);
    }
    const n = indexes.get(c);
    bytes[i * 2] = n >> 8;
    bytes[i * 2 + 1] = n & 255;
  });
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return JSON.stringify({
    version: 1,
    width: p.width,
    height: p.height,
    colors,
    data: btoa(binary),
  });
}
export function decodeProject(text) {
  const p = JSON.parse(text);
  if (p.version !== 1) return p;
  const bytes = atob(p.data);
  return {
    width: p.width,
    height: p.height,
    cells: Array.from(
      { length: p.width * p.height },
      (_, i) =>
        p.colors[(bytes.charCodeAt(i * 2) << 8) | bytes.charCodeAt(i * 2 + 1)],
    ),
  };
}
