export const BRANDS = [
  { value: "MARD", label: "MARD" },
  { value: "COCO", label: "COCO" },
  { value: "漫漫", label: "ManMan" },
  { value: "盼盼", label: "PanPan" },
  { value: "咪小窝", label: "MiXiaoWo" },
];
export function colorCode(color, brand) {
  return color.codes?.[brand] || color.hex;
}
export function sortColors(colors, brand) {
  return colors
    .slice()
    .sort(
      (a, b) =>
        colorCode(a, brand).localeCompare(colorCode(b, brand), "en", {
          numeric: true,
        }) || a.hex.localeCompare(b.hex),
    );
}
export function groupsFor(palette, brand, search = "") {
  const query = search.trim().toUpperCase(),
    groups = new Map();
  for (const color of sortColors(palette, brand)) {
    const code = colorCode(color, brand);
    if (
      query &&
      !code.toUpperCase().includes(query) &&
      !color.hex.includes(query)
    )
      continue;
    const prefix = code.match(/^[A-Za-z]+/)?.[0].toUpperCase() || "其他";
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(color);
  }
  return [...groups].sort(([a], [b]) =>
    a.localeCompare(b, "en", { numeric: true }),
  );
}
export function selectedPreset(presets, brand, selected) {
  return (
    Object.entries(presets[brand] || {}).find(
      ([, colors]) =>
        colors.length === selected.size && colors.every((c) => selected.has(c)),
    )?.[0] || null
  );
}
export function parsePaletteConfig(input, currentPalette, currentBrand) {
  if (!input || typeof input !== "object") throw new Error("无效的色板配置。");
  const source = Array.isArray(input) ? input : input.palette;
  let palette = currentPalette.map((c) => ({
    hex: c.hex,
    codes: { ...c.codes },
  }));
  if (source !== undefined) {
    if (!Array.isArray(source) || !source.length || source.length > 500)
      throw new Error("色板需包含 1–500 种颜色。");
    palette = source.map((c) => {
      if (
        !c ||
        !/^#[a-f0-9]{6}$/i.test(c.hex) ||
        (c.codes !== undefined &&
          (!c.codes ||
            Array.isArray(c.codes) ||
            typeof c.codes !== "object" ||
            !Object.values(c.codes).every(
              (v) => typeof v === "string" && v.length <= 20,
            )))
      )
        throw new Error("色板颜色或色号格式不正确。");
      return { hex: c.hex.toUpperCase(), codes: { ...c.codes } };
    });
    if (new Set(palette.map((c) => c.hex)).size !== palette.length)
      throw new Error("色板含有重复颜色。");
  }
  const values = Array.isArray(input)
    ? palette.map((c) => c.hex)
    : input.selectedHexValues;
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.some((c) => typeof c !== "string")
  )
    throw new Error("配置中没有有效的已选颜色。");
  const known = new Set(palette.map((c) => c.hex)),
    selected = new Set(values.map((c) => c.toUpperCase()));
  if ([...selected].some((c) => !known.has(c)))
    throw new Error("配置包含当前色板不存在的颜色，请导入带完整色板的配置。");
  const brand = input.brand ?? currentBrand;
  if (!BRANDS.some((b) => b.value === brand))
    throw new Error("不支持的色号系统。");
  return { palette, selected, brand };
}
export function exportPaletteConfig(palette, selected, brand) {
  return {
    version: "4.0",
    brand,
    totalColors: selected.size,
    selectedHexValues: [...selected],
    palette: palette.map((c) => ({ hex: c.hex, codes: { ...c.codes } })),
  };
}
