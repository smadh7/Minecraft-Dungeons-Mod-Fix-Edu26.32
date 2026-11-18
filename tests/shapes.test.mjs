// Unit tests for the World Edit geometry helpers.  Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boxOf, clampY, cylinderRuns, dirFromView, expandBox, rotateClip, shellBoxes, sizeOf, sphereRuns, tiles, volumeOf,
} from "../packs/world_edit_bp/scripts/shapes.js";

/** Expand boxes into a set of "x,y,z" keys, asserting no block is covered twice. */
function cells(boxes) {
  const s = new Set();
  for (const b of boxes)
    for (let x = b.min.x; x <= b.max.x; x++)
      for (let y = b.min.y; y <= b.max.y; y++)
        for (let z = b.min.z; z <= b.max.z; z++) {
          const k = `${x},${y},${z}`;
          assert.ok(!s.has(k), `overlap at ${k}`);
          s.add(k);
        }
  return s;
}

test("boxOf normalises corners", () => {
  const b = boxOf({ x: 5, y: -2, z: 3 }, { x: 1, y: 4, z: -3 });
  assert.deepEqual(b, { min: { x: 1, y: -2, z: -3 }, max: { x: 5, y: 4, z: 3 } });
  assert.deepEqual(sizeOf(b), { x: 5, y: 7, z: 7 });
  assert.equal(volumeOf(b), 245);
});

test("tiles cover the box exactly and stay within /fill limits", () => {
  const b = boxOf({ x: -40, y: -3, z: 0 }, { x: 30, y: 70, z: 33 });
  const ts = [...tiles(b, 32, 32, 32)];
  for (const t of ts) assert.ok(volumeOf(t) <= 32768);
  assert.equal(cells(ts).size, volumeOf(b));
});

test("shell = box minus interior, no overlaps", () => {
  for (const [a, c] of [[{ x: 0, y: 0, z: 0 }, { x: 4, y: 3, z: 5 }], [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }], [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 1 }]]) {
    const b = boxOf(a, c);
    const s = sizeOf(b);
    const inner = Math.max(0, s.x - 2) * Math.max(0, s.y - 2) * Math.max(0, s.z - 2);
    assert.equal(cells(shellBoxes(b, true)).size, volumeOf(b) - inner);
    const innerXZ = Math.max(0, s.x - 2) * s.y * Math.max(0, s.z - 2);
    assert.equal(cells(shellBoxes(b, false)).size, volumeOf(b) - innerXZ);
  }
});

test("sphere runs match brute force (solid + hollow)", () => {
  for (const r of [0, 1, 2, 5, 9]) {
    const c = { x: 3, y: -7, z: 11 };
    const solid = cells(sphereRuns(c, r, false));
    const hollow = cells(sphereRuns(c, r, true));
    let nSolid = 0, nHollow = 0;
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
      const d = x * x + y * y + z * z;
      const inS = d <= (r + 0.5) ** 2;
      const inH = inS && !(r > 0 && d < (r - 0.5) ** 2);
      const k = `${c.x + x},${c.y + y},${c.z + z}`;
      assert.equal(solid.has(k), inS, `solid r=${r} ${k}`);
      assert.equal(hollow.has(k), inH, `hollow r=${r} ${k}`);
      nSolid += inS; nHollow += inH;
    }
    assert.equal(solid.size, nSolid);
    assert.equal(hollow.size, nHollow);
  }
});

test("cylinder runs match brute force", () => {
  for (const [r, h, hollow] of [[3, 4, false], [4, 2, true], [0, 1, false]]) {
    const base = { x: 0, y: 10, z: 0 };
    const got = cells(cylinderRuns(base, r, h, hollow));
    let n = 0;
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      const d = x * x + z * z;
      const inside = d <= (r + 0.5) ** 2 && !(hollow && r > 0 && d < (r - 0.5) ** 2);
      for (let y = 0; y < h; y++) { assert.equal(got.has(`${x},${10 + y},${z}`), inside); n += inside; }
    }
    assert.equal(got.size, n);
  }
});

test("rotateClip matches rotating every block", () => {
  const off = { x: 2, y: -1, z: -5 }, size = { x: 3, y: 2, z: 4 };
  const rot = { 90: ([x, z]) => [-z, x], 180: ([x, z]) => [-x, -z], 270: ([x, z]) => [z, -x] };
  for (const deg of [90, 180, 270]) {
    const r = rotateClip(off, size, deg);
    let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
    for (let x = off.x; x < off.x + size.x; x++) for (let z = off.z; z < off.z + size.z; z++) {
      const [a, b] = rot[deg]([x, z]);
      mnx = Math.min(mnx, a); mxx = Math.max(mxx, a); mnz = Math.min(mnz, b); mxz = Math.max(mxz, b);
    }
    assert.deepEqual(r.off, { x: mnx, y: off.y, z: mnz });
    assert.deepEqual(r.size, { x: mxx - mnx + 1, y: size.y, z: mxz - mnz + 1 });
  }
});

test("expand, clamp and directions", () => {
  const b = boxOf({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
  assert.deepEqual(expandBox(b, "up", 5).max.y, 7);
  assert.deepEqual(expandBox(b, "west", 3).min.x, -3);
  assert.deepEqual(expandBox(b, "north", -10).min.z, 2); // never shrinks past 1 block
  assert.equal(clampY(boxOf({ x: 0, y: -100, z: 0 }, { x: 0, y: 400, z: 0 }), -64, 319).min.y, -64);
  assert.equal(clampY(boxOf({ x: 0, y: 400, z: 0 }, { x: 0, y: 500, z: 0 }), -64, 319), null);
  assert.equal(dirFromView({ x: 0.1, y: 0.9, z: 0 }), "up");
  assert.equal(dirFromView({ x: -0.8, y: 0.1, z: 0.3 }), "west");
  assert.equal(dirFromView({ x: 0.2, y: 0, z: -0.9 }), "north");
});
