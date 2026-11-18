// Pure geometry helpers (no Minecraft APIs) - unit-tested in Node (tests/).

/** @typedef {{x:number,y:number,z:number}} Vec */
/** @typedef {{min:Vec,max:Vec}} Box  inclusive integer bounds */

/** @param {Vec} v */
export const floorVec = (v) => ({ x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) });

/** @param {Vec} a @param {Vec} b @returns {Box} */
export function boxOf(a, b) {
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

/** @param {Box} b */
export const sizeOf = (b) => ({ x: b.max.x - b.min.x + 1, y: b.max.y - b.min.y + 1, z: b.max.z - b.min.z + 1 });

/** @param {Box} b */
export function volumeOf(b) {
  const s = sizeOf(b);
  return s.x * s.y * s.z;
}

/** Union of boxes. @param {Box[]} boxes @returns {Box} */
export function unionOf(boxes) {
  let r = { min: { ...boxes[0].min }, max: { ...boxes[0].max } };
  for (const b of boxes.slice(1)) r = boxOf({ x: Math.min(r.min.x, b.min.x), y: Math.min(r.min.y, b.min.y), z: Math.min(r.min.z, b.min.z) },
    { x: Math.max(r.max.x, b.max.x), y: Math.max(r.max.y, b.max.y), z: Math.max(r.max.z, b.max.z) });
  return r;
}

/** Clamp a box vertically to [minY, maxY] (inclusive). Returns null if nothing is left.
 * @param {Box} b @param {number} minY @param {number} maxY @returns {Box|null} */
export function clampY(b, minY, maxY) {
  const lo = Math.max(b.min.y, minY);
  const hi = Math.min(b.max.y, maxY);
  if (lo > hi) return null;
  return { min: { ...b.min, y: lo }, max: { ...b.max, y: hi } };
}

/** Split a box into tiles of at most tx*ty*tz blocks.
 * @param {Box} b @param {number} tx @param {number} ty @param {number} tz @returns {Generator<Box>} */
export function* tiles(b, tx, ty, tz) {
  for (let x = b.min.x; x <= b.max.x; x += tx)
    for (let y = b.min.y; y <= b.max.y; y += ty)
      for (let z = b.min.z; z <= b.max.z; z += tz)
        yield {
          min: { x, y, z },
          max: { x: Math.min(x + tx - 1, b.max.x), y: Math.min(y + ty - 1, b.max.y), z: Math.min(z + tz - 1, b.max.z) },
        };
}

/** The six 1-thick faces (or four walls) of a box, without overlaps.
 * @param {Box} b @param {boolean} withTopBottom @returns {Box[]} */
export function shellBoxes(b, withTopBottom) {
  const { min, max } = b;
  const out = [];
  let yLo = min.y, yHi = max.y;
  if (withTopBottom) {
    out.push({ min: { ...min }, max: { x: max.x, y: min.y, z: max.z } });
    if (max.y > min.y) out.push({ min: { x: min.x, y: max.y, z: min.z }, max: { ...max } });
    yLo = min.y + 1; yHi = max.y - 1;
    if (yLo > yHi) return out;
  }
  out.push({ min: { x: min.x, y: yLo, z: min.z }, max: { x: max.x, y: yHi, z: min.z } }); // north
  if (max.z > min.z) out.push({ min: { x: min.x, y: yLo, z: max.z }, max: { x: max.x, y: yHi, z: max.z } }); // south
  if (max.z - min.z >= 2) {
    out.push({ min: { x: min.x, y: yLo, z: min.z + 1 }, max: { x: min.x, y: yHi, z: max.z - 1 } }); // west
    if (max.x > min.x) out.push({ min: { x: max.x, y: yLo, z: min.z + 1 }, max: { x: max.x, y: yHi, z: max.z - 1 } }); // east
  }
  return out;
}

/** Largest integer n >= 0 with n*n <= v, or -1 if v < 0. */
const isqrtFloor = (v) => (v < 0 ? -1 : Math.floor(Math.sqrt(v) + 1e-9));
/** Largest integer n >= 0 with n*n < v (strict), or -1. */
const isqrtStrict = (v) => {
  if (v <= 0) return -1;
  const n = Math.ceil(Math.sqrt(v) - 1e-9) - 1;
  return n < 0 ? -1 : n;
};

/** Sphere (or 1-thick hollow sphere) as horizontal X-runs.
 * @param {Vec} c center @param {number} r radius @param {boolean} hollow
 * @returns {Generator<Box>} each a 1x1 row along X */
export function* sphereRuns(c, r, hollow) {
  const ro = (r + 0.5) * (r + 0.5);
  const ri = (r - 0.5) * (r - 0.5);
  for (let dy = -r; dy <= r; dy++)
    for (let dz = -r; dz <= r; dz++) {
      const d2 = dy * dy + dz * dz;
      const dx = isqrtFloor(ro - d2);
      if (dx < 0) continue;
      const y = c.y + dy, z = c.z + dz;
      const di = hollow && r > 0 ? isqrtStrict(ri - d2) : -1;
      if (di < 0) {
        yield { min: { x: c.x - dx, y, z }, max: { x: c.x + dx, y, z } };
      } else if (di < dx) {
        yield { min: { x: c.x - dx, y, z }, max: { x: c.x - di - 1, y, z } };
        yield { min: { x: c.x + di + 1, y, z }, max: { x: c.x + dx, y, z } };
      }
    }
}

/** Vertical cylinder as Z-slabs (rows along X, full height).
 * @param {Vec} base center of the bottom layer @param {number} r @param {number} h @param {boolean} hollow
 * @returns {Generator<Box>} */
export function* cylinderRuns(base, r, h, hollow) {
  const ro = (r + 0.5) * (r + 0.5);
  const ri = (r - 0.5) * (r - 0.5);
  const y0 = base.y, y1 = base.y + Math.max(1, h) - 1;
  for (let dz = -r; dz <= r; dz++) {
    const d2 = dz * dz;
    const dx = isqrtFloor(ro - d2);
    if (dx < 0) continue;
    const z = base.z + dz;
    const di = hollow && r > 0 ? isqrtStrict(ri - d2) : -1;
    if (di < 0) {
      yield { min: { x: base.x - dx, y: y0, z }, max: { x: base.x + dx, y: y1, z } };
    } else if (di < dx) {
      yield { min: { x: base.x - dx, y: y0, z }, max: { x: base.x - di - 1, y: y1, z } };
      yield { min: { x: base.x + di + 1, y: y0, z }, max: { x: base.x + dx, y: y1, z } };
    }
  }
}

/** Bounding box of a sphere/cylinder. */
export const sphereBox = (c, r) => boxOf({ x: c.x - r, y: c.y - r, z: c.z - r }, { x: c.x + r, y: c.y + r, z: c.z + r });
export const cylinderBox = (b, r, h) => boxOf({ x: b.x - r, y: b.y, z: b.z - r }, { x: b.x + r, y: b.y + Math.max(1, h) - 1, z: b.z + r });

export const DIRS = /** @type {const} */ ({
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
});

/** Turn a view vector into the closest of the six directions.
 * @param {Vec} v @returns {keyof typeof DIRS} */
export function dirFromView(v) {
  if (v.y > 0.7) return "up";
  if (v.y < -0.7) return "down";
  if (Math.abs(v.x) >= Math.abs(v.z)) return v.x >= 0 ? "east" : "west";
  return v.z >= 0 ? "south" : "north";
}

/** Horizontal-only facing (for portal kits etc.). @param {Vec} v */
export function horizontalDir(v) {
  if (Math.abs(v.x) >= Math.abs(v.z)) return v.x >= 0 ? "east" : "west";
  return v.z >= 0 ? "south" : "north";
}

/** Grow a box by n in a direction (negative n shrinks, never past 1 block).
 * @param {Box} b @param {keyof typeof DIRS} dir @param {number} n @returns {Box} */
export function expandBox(b, dir, n) {
  const r = { min: { ...b.min }, max: { ...b.max } };
  const d = DIRS[dir];
  for (const ax of /** @type {const} */ (["x", "y", "z"])) {
    if (d[ax] > 0) r.max[ax] = Math.max(r.min[ax], r.max[ax] + n);
    if (d[ax] < 0) r.min[ax] = Math.min(r.max[ax], r.min[ax] - n);
  }
  return r;
}

/** Clipboard placement after rotation.  Rotation is clockwise seen from above,
 * around the player's block.  Mirroring flips the clipboard in place.
 * @param {Vec} off  clipboard min corner relative to the player
 * @param {Vec} size clipboard size
 * @param {0|90|180|270} deg
 * @returns {{off:Vec,size:Vec}} */
export function rotateClip(off, size, deg) {
  const xHi = off.x + size.x - 1;
  const zHi = off.z + size.z - 1;
  switch (deg) {
    case 90: // (x,z) -> (-z, x)
      return { off: { x: -zHi, y: off.y, z: off.x }, size: { x: size.z, y: size.y, z: size.x } };
    case 180: // (x,z) -> (-x,-z)
      return { off: { x: -xHi, y: off.y, z: -zHi }, size: { ...size } };
    case 270: // (x,z) -> (z,-x)
      return { off: { x: off.z, y: off.y, z: -xHi }, size: { x: size.z, y: size.y, z: size.x } };
    default:
      return { off: { ...off }, size: { ...size } };
  }
}

/** @param {Vec} a @param {Vec} b */
export const addVec = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
/** @param {Vec} a @param {number} k */
export const scaleVec = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
/** @param {Vec} v */
export const fmt = (v) => `${v.x}, ${v.y}, ${v.z}`;
/** @param {Box} b */
export const fmtSize = (b) => { const s = sizeOf(b); return `${s.x}x${s.y}x${s.z} (${volumeOf(b).toLocaleString()} blocks)`; };
