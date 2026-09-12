import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCSV,
  toCSV,
  validateProject,
  flood,
  flip,
  removeBackground,
  pixelate,
} from "../public/engine.mjs";
test("CSV round trip preserves transparency and dimensions; malformed input rejected", () => {
  const p = parseCSV("\uFEFF#ff0000,TRANSPARENT\r\n#000000,#FFFFFF");
  assert.deepEqual(parseCSV(toCSV(p)), p);
  assert.throws(() => parseCSV("#FFFFFF,#000000\n#FFFFFF"));
  assert.throws(() => validateProject({ width: 501, height: 1, cells: [] }));
  assert.throws(() => parseCSV("=cmd()"));
});
test("fill respects connectivity; background removal preserves enclosed regions; flips reverse correctly", () => {
  const p = {
    width: 3,
    height: 3,
    cells: [
      "#FFFFFF",
      "#000000",
      "#FFFFFF",
      "#000000",
      "#FFFFFF",
      "#000000",
      "#FFFFFF",
      "#000000",
      "#FFFFFF",
    ],
  };
  removeBackground(p);
  assert.equal(p.cells[0], null);
  assert.equal(p.cells[4], "#FFFFFF");
  flood(p.cells, 3, 3, 4, "#FF0000");
  assert.equal(p.cells[4], "#FF0000");
  const row = { width: 3, height: 1, cells: ["#FFFFFF", null, "#000000"] };
  flip(row);
  assert.deepEqual(row.cells, ["#000000", null, "#FFFFFF"]);
});
test("all five modes preserve transparent images and map to chosen palette", async () => {
  const image = { width: 10, height: 10, data: new Uint8ClampedArray(400) };
  for (let i = 0; i < 50; i++) image.data.set([255, 0, 0, 255], i * 4);
  const pal = [{ hex: "#FF0000" }, { hex: "#000000" }];
  for (const mode of ["dominant", "average", "dither", "smooth", "palette"]) {
    const p = await pixelate(image, 10, pal, mode, 32);
    assert.equal(p.cells.filter(Boolean).length, 50);
    assert.ok(p.cells.filter(Boolean).every((c) => c === "#FF0000"));
  }
  await assert.rejects(() => pixelate(image, 10, [], "dominant", 0));
});
