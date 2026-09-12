import test from "node:test";
import assert from "node:assert/strict";
import { encodeProject, decodeProject } from "../server/project-codec.mjs";
test("maximum-size pattern fits compact storage and round trips exactly", () => {
  const p = {
    width: 500,
    height: 500,
    cells: Array.from({ length: 250000 }, (_, i) => (i % 3 ? "#12AB34" : null)),
  };
  const stored = encodeProject(p);
  assert.ok(stored.length < 1000000);
  assert.deepEqual(decodeProject(stored), p);
});
