import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BRANDS,
  groupsFor,
  selectedPreset,
  parsePaletteConfig,
  exportPaletteConfig,
} from "../public/palette-model.mjs";
const palette = JSON.parse(
  readFileSync(new URL("../public/palette.json", import.meta.url)),
);
const presets = JSON.parse(
  readFileSync(new URL("../public/presets.json", import.meta.url)),
);

test("all 20 recovered brand presets have exact sizes and known unique colors", () => {
  const known = new Set(palette.map((c) => c.hex));
  for (const { value } of BRANDS)
    for (const size of [120, 144, 221, 291]) {
      const colors = presets[value][size];
      assert.equal(colors.length, size);
      assert.equal(new Set(colors).size, size);
      assert.ok(colors.every((c) => known.has(c)));
      assert.equal(
        selectedPreset(presets, value, new Set(colors)),
        String(size),
      );
    }
});
test("brand grouping preserves selection, naturally sorts codes, and supports search", () => {
  const selected = new Set(presets.MARD[221]),
    original = [...selected];
  const groups = new Map(groupsFor(palette, "漫漫"));
  assert.equal(groups.get("B").length, 15);
  assert.deepEqual(
    groups.get("B").map((c) => c.codes["漫漫"]),
    Array.from({ length: 15 }, (_, i) => "B" + (i + 1)),
  );
  for (const { value } of BRANDS) groupsFor(palette, value);
  assert.deepEqual([...selected], original);
  assert.ok(
    groupsFor(palette, "MARD", "a01")
      .flatMap(([, colors]) => colors)
      .every((c) => c.codes.MARD.includes("A01")),
  );
  assert.deepEqual(groupsFor(palette, "MARD", "not-a-code"), []);
});
test("config export and import preserve full palette and partial selection independently", () => {
  const selected = new Set(presets["漫漫"][120]);
  const config = exportPaletteConfig(palette, selected, "漫漫");
  const restored = parsePaletteConfig(
    JSON.parse(JSON.stringify(config)),
    [],
    "MARD",
  );
  assert.deepEqual(restored.selected, selected);
  assert.deepEqual(restored.palette, palette);
  assert.equal(restored.brand, "漫漫");
  restored.selected.clear();
  restored.palette[0].codes.MARD = "changed";
  assert.equal(selected.size, 120);
  assert.notEqual(palette[0].codes.MARD, "changed");
});
test("original selectedHexValues and older full palette arrays remain importable", () => {
  const original = parsePaletteConfig(
    { selectedHexValues: presets.MARD[144] },
    palette,
    "COCO",
  );
  assert.equal(original.selected.size, 144);
  assert.equal(original.brand, "COCO");
  const old = parsePaletteConfig(palette.slice(0, 5), palette, "MARD");
  assert.equal(old.palette.length, 5);
  assert.equal(old.selected.size, 5);
});
test("invalid imports reject empty, unknown, duplicate and malformed colors without mutation", () => {
  const before = JSON.stringify(palette);
  for (const input of [
    { selectedHexValues: [] },
    { selectedHexValues: ["#123456"] },
    [palette[0], palette[0]],
    [{ hex: "#broken" }],
    { selectedHexValues: [palette[0].hex], brand: "unknown" },
  ]) {
    assert.throws(() => parsePaletteConfig(input, palette, "MARD"));
  }
  assert.equal(JSON.stringify(palette), before);
});
test("custom selection is not mislabeled as a preset", () => {
  const selected = new Set(presets.MARD[221]);
  selected.delete(selected.values().next().value);
  assert.equal(selectedPreset(presets, "MARD", selected), null);
});
