// World Edit v3 - engine: per-player state, undo/redo history and operations.
import {
  system,
  world,
  BlockPermutation,
  BlockTypes,
  BlockVolume,
  GameMode,
  ItemStack,
  PlayerPermissionLevel,
  StructureMirrorAxis,
  StructureRotation,
  StructureSaveMode,
} from "@minecraft/server";
import {
  addVec, boxOf, clampY, cylinderBox, cylinderRuns, DIRS, dirFromView, expandBox, floorVec, fmt, fmtSize,
  rotateClip, scaleVec, shellBoxes, sizeOf, sphereBox, sphereRuns, tiles, unionOf, volumeOf,
} from "./shapes.js";
import { LIQUID_BLOCKS, PLANT_BLOCKS, REPLACEABLE, SNOW_BLOCKS, TREE_BLOCKS } from "./blocks.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Dimension} Dimension */
/** @typedef {import("./shapes.js").Box} Box */
/** @typedef {import("./shapes.js").Vec} Vec */
/** @typedef {{id:string, min:Vec}} Tile */
/** @typedef {{dim:string, box:Box, tiles:Tile[], label:string}} HistoryEntry */
/** @typedef {{block:string, radius:number, mode:string}} Brush */

export const WAND_ITEM = "minecraft:wooden_axe";
export const WAND_NAME = "§dWorld Edit Wand";
const HISTORY_MAX = 15;
const DEFAULT_LIMIT = 500_000;
const MAX_LIMIT = 5_000_000;
const FILL_TILE = 32; // 32^3 = 32,768 blocks, the /fill limit
const SNAP_TILE = 64; // structure tiles (Bedrock max is 64 x 384 x 64)
const PROP = "we3:state";

let structCounter = 0;
const session = Math.floor(Math.random() * 0xffffff).toString(36);

class PlayerState {
  constructor() {
    /** @type {Vec|undefined} */ this.pos1 = undefined;
    /** @type {Vec|undefined} */ this.pos2 = undefined;
    /** @type {string|undefined} */ this.dim = undefined;
    /** @type {HistoryEntry[]} */ this.history = [];
    /** @type {HistoryEntry[]} */ this.redo = [];
    /** @type {Record<string, Brush>} */ this.brushes = {};
    /** @type {{id:string, off:Vec, size:Vec}|undefined} */ this.clip = undefined;
    this.limit = DEFAULT_LIMIT;
    this.busy = false;
  }
}

/** @type {Map<string, PlayerState>} */
const states = new Map();

/** @param {Player} p @returns {PlayerState} */
export function stateOf(p) {
  let s = states.get(p.id);
  if (!s) {
    s = new PlayerState();
    try {
      const raw = p.getDynamicProperty(PROP);
      if (typeof raw === "string") {
        const d = JSON.parse(raw);
        s.pos1 = d.pos1; s.pos2 = d.pos2; s.dim = d.dim;
        s.brushes = d.brushes ?? {};
        s.limit = Math.min(MAX_LIMIT, d.limit ?? DEFAULT_LIMIT);
      }
    } catch { /* corrupt or read-only context: start fresh */ }
    states.set(p.id, s);
  }
  return s;
}

/** Persist selection/brushes so they survive leaving and rejoining the world. */
function save(p) {
  const s = stateOf(p);
  const data = JSON.stringify({ pos1: s.pos1, pos2: s.pos2, dim: s.dim, brushes: s.brushes, limit: s.limit });
  system.run(() => { try { p.setDynamicProperty(PROP, data); } catch { /* player left */ } });
}

/** @param {Player} p @param {string} msg */
export function tell(p, msg) {
  system.run(() => { try { p.sendMessage(msg); } catch { /* player left */ } });
}

/** Operators only: keeps students from editing the map with the wand/brushes. */
export function canEdit(p) {
  try { return p.playerPermissionLevel === PlayerPermissionLevel.Operator; } catch { return false; }
}

// --------------------------------------------------------------------------
// block helpers

/** Accepts BlockType objects (from commands) or text like "stone"/"minecraft:stone".
 * @returns {BlockPermutation|undefined} */
export function toPerm(block) {
  try {
    if (!block) return undefined;
    if (typeof block !== "string") return BlockPermutation.resolve(block.id);
    let id = block.trim().toLowerCase();
    if (!id) return undefined;
    if (!id.includes(":")) id = "minecraft:" + id;
    if (!BlockTypes.get(id)) return undefined;
    return BlockPermutation.resolve(id);
  } catch { return undefined; }
}

/** Keep only block ids this game version knows (Education can lag behind Bedrock). */
const known = (ids) => ids.filter((id) => { try { return !!BlockTypes.get(id); } catch { return false; } });
const AIR = () => BlockPermutation.resolve("minecraft:air");

// --------------------------------------------------------------------------
// selection

/** @param {Player} p @param {1|2} which @param {Vec} loc */
export function setPos(p, which, loc) {
  const s = stateOf(p);
  const v = floorVec(loc);
  if (s.dim && s.dim !== p.dimension.id) { s.pos1 = undefined; s.pos2 = undefined; }
  s.dim = p.dimension.id;
  if (which === 1) s.pos1 = v; else s.pos2 = v;
  save(p);
  const sel = selection(p, true);
  tell(p, `§dPosition ${which} §fset to §e${fmt(v)}${sel ? ` §7- ${fmtSize(sel)}` : ""}`);
}

/** @param {Player} p @param {boolean} [quiet] @returns {Box|undefined} */
export function selection(p, quiet) {
  const s = stateOf(p);
  if (!s.pos1 || !s.pos2) { if (!quiet) tell(p, "§cMake a selection first: §fwand left-click = pos1, right-click = pos2§c, or /we:pos1 and /we:pos2."); return undefined; }
  if (s.dim !== p.dimension.id) { if (!quiet) tell(p, "§cYour selection is in another dimension."); return undefined; }
  return boxOf(s.pos1, s.pos2);
}

export function clearSelection(p) {
  const s = stateOf(p);
  s.pos1 = s.pos2 = undefined;
  save(p);
  tell(p, "§dSelection cleared.");
}

/** @param {Player} p @param {string} dirName @param {number} n */
export function expandSelection(p, dirName, n) {
  const sel = selection(p); if (!sel) return;
  const s = stateOf(p);
  let b = sel;
  if (dirName === "vert") {
    const hr = p.dimension.heightRange;
    b = { min: { ...sel.min, y: hr.min }, max: { ...sel.max, y: hr.max - 1 } };
  } else {
    const d = dirName === "look" || !dirName ? dirFromView(p.getViewDirection()) : /** @type {keyof typeof DIRS} */ (dirName);
    if (!DIRS[d]) { tell(p, "§cUnknown direction."); return; }
    b = expandBox(sel, d, n);
  }
  s.pos1 = b.min; s.pos2 = b.max;
  save(p);
  tell(p, `§dSelection is now §e${fmtSize(b)}`);
}

// --------------------------------------------------------------------------
// job runner: checks, undo snapshot, then the work - all spread over ticks

/** True if every chunk column touched by the box is loaded. @param {Dimension} dim @param {Box} b */
function chunksLoaded(dim, b) {
  const y = b.min.y;
  const xs = [], zs = [];
  for (let x = b.min.x; x <= b.max.x; x += 16) xs.push(x);
  xs.push(b.max.x);
  for (let z = b.min.z; z <= b.max.z; z += 16) zs.push(z);
  zs.push(b.max.z);
  for (const x of xs) for (const z of zs) {
    try { if (!dim.getBlock({ x, y, z })) return false; } catch { return false; }
  }
  return true;
}

/** @param {Dimension} dim @param {Box} b @returns {Generator<void, Tile[], void>} */
function* snapshot(dim, b) {
  /** @type {Tile[]} */
  const out = [];
  for (const t of tiles(b, SNAP_TILE, SNAP_TILE, SNAP_TILE)) {
    const id = `we3:${session}_${structCounter++}`;
    world.structureManager.createFromWorld(id, dim, t.min, t.max, {
      includeBlocks: true, includeEntities: false, saveMode: StructureSaveMode.Memory,
    });
    out.push({ id, min: t.min });
    yield;
  }
  return out;
}

/** @param {Tile[]} ts */
function dropTiles(ts) {
  for (const t of ts) { try { world.structureManager.delete(t.id); } catch { /* already gone */ } }
}

/** @param {HistoryEntry[]} list */
function trim(list) {
  while (list.length > HISTORY_MAX) dropTiles(list.shift().tiles);
}

/**
 * Run an undoable edit.
 * @param {Player} p
 * @param {string} label
 * @param {Box} box   area that may change (snapshotted for undo)
 * @param {(dim: Dimension) => Generator<void, number, void>} work returns blocks changed
 */
export function runEdit(p, label, box, work) {
  system.run(() => {
    const s = stateOf(p);
    if (s.busy) { tell(p, "§eStill working on your last edit - try again in a moment."); return; }
    const dim = p.dimension;
    const hr = dim.heightRange;
    const b = clampY(box, hr.min, hr.max - 1);
    if (!b) { tell(p, "§cThat area is outside the world's height limits."); return; }
    const vol = volumeOf(b);
    if (vol > s.limit) { tell(p, `§cThat would affect ${vol.toLocaleString()} blocks; your limit is ${s.limit.toLocaleString()}. §7(/we:limit to change)`); return; }
    if (!chunksLoaded(dim, b)) { tell(p, "§cPart of that area isn't loaded. Move closer (or raise simulation distance) and try again."); return; }
    s.busy = true;
    const started = Date.now();
    system.runJob((function* () {
      try {
        const ts = yield* snapshot(dim, b);
        // record before working, so even a partial/failed edit can be undone
        s.history.push({ dim: dim.id, box: b, tiles: ts, label });
        trim(s.history);
        for (const e of s.redo) dropTiles(e.tiles);
        s.redo = [];
        const changed = yield* work(dim);
        tell(p, `§a${label}: §f${changed.toLocaleString()} blocks changed §7(${Date.now() - started} ms, /we:undo to revert)`);
      } catch (e) {
        tell(p, `§c${label} failed: ${e?.message ?? e}`);
      } finally {
        s.busy = false;
      }
    })());
  });
}

/** Restore a history entry, returning a snapshot of what it replaced. */
function* restore(dim, entry, label) {
  const back = yield* snapshot(dim, entry.box);
  for (const t of entry.tiles) {
    world.structureManager.place(t.id, dim, t.min, { includeEntities: false, includeBlocks: true });
    yield;
  }
  dropTiles(entry.tiles);
  return /** @type {HistoryEntry} */ ({ dim: entry.dim, box: entry.box, tiles: back, label });
}

/** @param {Player} p @param {boolean} redo */
export function undoRedo(p, redo) {
  system.run(() => {
    const s = stateOf(p);
    if (s.busy) { tell(p, "§eStill working - try again in a moment."); return; }
    const from = redo ? s.redo : s.history;
    const to = redo ? s.history : s.redo;
    const entry = from[from.length - 1];
    if (!entry) { tell(p, redo ? "§eNothing to redo." : "§eNothing to undo."); return; }
    let dim;
    try { dim = world.getDimension(entry.dim); } catch { tell(p, "§cThat dimension isn't available."); return; }
    if (!chunksLoaded(dim, entry.box)) { tell(p, "§cThat area isn't loaded. Go back near it first."); return; }
    from.pop();
    s.busy = true;
    system.runJob((function* () {
      try {
        const back = yield* restore(dim, entry, entry.label);
        to.push(back);
        trim(to);
        tell(p, `§a${redo ? "Redid" : "Undid"}: §f${entry.label} §7(${from.length} more)`);
      } catch (e) {
        tell(p, `§c${redo ? "Redo" : "Undo"} failed: ${e?.message ?? e}`);
      } finally { s.busy = false; }
    })());
  });
}

// --------------------------------------------------------------------------
// fill primitives (generators that yield between chunks of work)

/** @param {Dimension} dim @param {Box} b @param {BlockPermutation} perm @param {import("@minecraft/server").BlockFilter} [filter] */
function* fillBox(dim, b, perm, filter) {
  let n = 0;
  for (const t of tiles(b, FILL_TILE, FILL_TILE, FILL_TILE)) {
    const placed = dim.fillBlocks(new BlockVolume(t.min, t.max), perm, filter ? { blockFilter: filter } : undefined);
    n += placed.getCapacity();
    yield;
  }
  return n;
}

/** @param {Dimension} dim @param {Iterable<Box>} runs */
function* fillRuns(dim, runs, perm, filter) {
  let n = 0, i = 0;
  for (const r of runs) {
    n += yield* fillBox(dim, r, perm, filter);
    if (++i % 64 === 0) yield;
  }
  return n;
}

// --------------------------------------------------------------------------
// operations

export function opSet(p, block) {
  const sel = selection(p); if (!sel) return;
  const perm = toPerm(block); if (!perm) return tell(p, `§cUnknown block: ${block}`);
  runEdit(p, `Set ${perm.type.id}`, sel, (dim) => fillBox(dim, sel, perm));
}

export function opReplace(p, from, to) {
  const sel = selection(p); if (!sel) return;
  const a = toPerm(from), b = toPerm(to);
  if (!a || !b) return tell(p, "§cUnknown block.");
  runEdit(p, `Replace ${a.type.id} -> ${b.type.id}`, sel, (dim) => fillBox(dim, sel, b, { includeTypes: [a.type.id] }));
}

export function opWalls(p, block, withTopBottom) {
  const sel = selection(p); if (!sel) return;
  const perm = toPerm(block); if (!perm) return tell(p, `§cUnknown block: ${block}`);
  runEdit(p, withTopBottom ? "Outline" : "Walls", sel, (dim) => fillRuns(dim, shellBoxes(sel, withTopBottom), perm));
}

export function opCopy(p, cut) {
  const sel = selection(p); if (!sel) return;
  system.run(() => {
    const s = stateOf(p);
    const hr = p.dimension.heightRange;
    const b = clampY(sel, hr.min, hr.max - 1);
    if (!b) return tell(p, "§cSelection is outside the world.");
    const sz = sizeOf(b);
    if (sz.x > 64 || sz.z > 64 || sz.y > 384) return tell(p, "§cCopy is limited to 64 x 384 x 64 blocks (Bedrock structure size).");
    if (!chunksLoaded(p.dimension, b)) return tell(p, "§cPart of the selection isn't loaded.");
    try {
      const id = `we3:clip_${p.id.replace(/[^0-9a-z]/gi, "")}`;
      try { world.structureManager.delete(id); } catch { /* none yet */ }
      world.structureManager.createFromWorld(id, p.dimension, b.min, b.max, {
        includeBlocks: true, includeEntities: false, saveMode: StructureSaveMode.Memory,
      });
      const here = floorVec(p.location);
      s.clip = { id, off: { x: b.min.x - here.x, y: b.min.y - here.y, z: b.min.z - here.z }, size: sz };
      tell(p, `§aCopied §f${fmtSize(b)}§a. Stand somewhere and use /we:paste.`);
      if (cut) runEdit(p, "Cut", b, (dim) => fillBox(dim, b, AIR()));
    } catch (e) { tell(p, `§cCopy failed: ${e?.message ?? e}`); }
  });
}

const ROT = { none: 0, rot90: 90, rot180: 180, rot270: 270 };
const ROT_ENUM = { 0: StructureRotation.None, 90: StructureRotation.Rotate90, 180: StructureRotation.Rotate180, 270: StructureRotation.Rotate270 };
const MIRROR = { none: StructureMirrorAxis.None, x: StructureMirrorAxis.X, z: StructureMirrorAxis.Z, xz: StructureMirrorAxis.XZ };

export function opPaste(p, rotName, mirrorName) {
  const s = stateOf(p);
  if (!s.clip) return tell(p, "§cClipboard is empty - use /we:copy first.");
  const clip = s.clip;
  const deg = /** @type {0|90|180|270} */ (ROT[rotName ?? "none"] ?? 0);
  const placed = rotateClip(clip.off, clip.size, deg);
  const at = addVec(floorVec(p.location), placed.off);
  const box = boxOf(at, addVec(at, { x: placed.size.x - 1, y: placed.size.y - 1, z: placed.size.z - 1 }));
  runEdit(p, "Paste", box, function* (dim) {
    world.structureManager.place(clip.id, dim, at, {
      includeBlocks: true, includeEntities: false,
      rotation: ROT_ENUM[deg], mirror: MIRROR[mirrorName ?? "none"] ?? StructureMirrorAxis.None,
    });
    yield;
    return volumeOf(box);
  });
}

export function opStack(p, count, dirName) {
  const sel = selection(p); if (!sel) return;
  const n = Math.max(1, Math.min(64, Math.floor(count || 1)));
  const d = !dirName || dirName === "look" ? dirFromView(p.getViewDirection()) : dirName;
  const dv = DIRS[d]; if (!dv) return tell(p, "§cUnknown direction.");
  const sz = sizeOf(sel);
  if (sz.x > 64 || sz.z > 64 || sz.y > 384) return tell(p, "§cStack is limited to 64 x 384 x 64 selections.");
  const step = { x: dv.x * sz.x, y: dv.y * sz.y, z: dv.z * sz.z };
  const targets = [];
  for (let i = 1; i <= n; i++) {
    const off = scaleVec(step, i);
    targets.push({ min: addVec(sel.min, off), max: addVec(sel.max, off) });
  }
  runEdit(p, `Stack x${n} ${d}`, unionOf(targets), function* (dim) {
    const id = `we3:${session}_stack${structCounter++}`;
    world.structureManager.createFromWorld(id, dim, sel.min, sel.max, { includeEntities: false, saveMode: StructureSaveMode.Memory });
    try {
      for (const t of targets) { world.structureManager.place(id, dim, t.min, { includeEntities: false }); yield; }
    } finally { world.structureManager.delete(id); }
    return volumeOf(sel) * n;
  });
}

export function opSphere(p, block, radius, hollow, center) {
  const perm = toPerm(block); if (!perm) return tell(p, `§cUnknown block: ${block}`);
  const r = Math.max(0, Math.min(64, Math.floor(radius)));
  const c = floorVec(center ?? p.location);
  runEdit(p, `${hollow ? "Hollow sphere" : "Sphere"} r=${r}`, sphereBox(c, r), (dim) => fillRuns(dim, sphereRuns(c, r, !!hollow), perm));
}

export function opCylinder(p, block, radius, height, hollow) {
  const perm = toPerm(block); if (!perm) return tell(p, `§cUnknown block: ${block}`);
  const r = Math.max(0, Math.min(64, Math.floor(radius)));
  const h = Math.max(1, Math.min(384, Math.floor(height || 1)));
  const c = floorVec(p.location);
  runEdit(p, `${hollow ? "Hollow cylinder" : "Cylinder"} r=${r} h=${h}`, cylinderBox(c, r, h), (dim) => fillRuns(dim, cylinderRuns(c, r, h, !!hollow), perm));
}

/** Cube of radius r around the player. */
const around = (p, r) => {
  const c = floorVec(p.location);
  return boxOf({ x: c.x - r, y: c.y - r, z: c.z - r }, { x: c.x + r, y: c.y + r, z: c.z + r });
};
const radiusOf = (r, def, max = 64) => Math.max(1, Math.min(max, Math.floor(r || def)));

/** Replace a group of blocks near the player with air (or another block). */
export function opRemoveGroup(p, label, ids, radius, replacement = "minecraft:air") {
  const types = known(ids);
  if (!types.length) return tell(p, "§cNone of those blocks exist in this version.");
  const r = radiusOf(radius, 16);
  const box = around(p, r);
  const perm = toPerm(replacement) ?? AIR();
  runEdit(p, `${label} (r=${r})`, box, (dim) => fillBox(dim, box, perm, { includeTypes: types }));
}

export const opDrain = (p, r) => opRemoveGroup(p, "Drain water & lava", LIQUID_BLOCKS, r);
export const opRemoveTrees = (p, r) => opRemoveGroup(p, "Remove trees", TREE_BLOCKS, r);
export const opRemovePlants = (p, r) => opRemoveGroup(p, "Remove plants", PLANT_BLOCKS, r);
export const opRemoveSnow = (p, r) => opRemoveGroup(p, "Remove snow", SNOW_BLOCKS, r);

export function opRemoveNear(p, block, radius) {
  const perm = toPerm(block); if (!perm) return tell(p, `§cUnknown block: ${block}`);
  opRemoveGroup(p, `Remove ${perm.type.id}`, [perm.type.id], radius);
}

export function opReplaceNear(p, from, to, radius) {
  const a = toPerm(from), b = toPerm(to);
  if (!a || !b) return tell(p, "§cUnknown block.");
  opRemoveGroup(p, `Replace ${a.type.id} -> ${b.type.id}`, [a.type.id], radius, b.type.id);
}

/** Put invisible light blocks on a 5-block grid over the ground near the player. */
export function opLight(p, radius) {
  const r = radiusOf(radius, 16, 48);
  const c = floorVec(p.location);
  const box = boxOf({ x: c.x - r, y: c.y - 8, z: c.z - r }, { x: c.x + r, y: c.y + 8, z: c.z + r });
  runEdit(p, `Light (r=${r})`, box, function* (dim) {
    const light = BlockPermutation.resolve("minecraft:light_block_15");
    let n = 0;
    for (let x = box.min.x; x <= box.max.x; x += 5) {
      for (let z = box.min.z; z <= box.max.z; z += 5) {
        // walk down from the top of the box: first air block sitting on something solid
        for (let y = box.max.y; y > box.min.y; y--) {
          const here = dim.getBlock({ x, y, z });
          const below = dim.getBlock({ x, y: y - 1, z });
          if (!here || !below) break;
          if (here.isAir && !below.isAir && !below.isLiquid && !REPLACEABLE.has(below.typeId)) {
            here.setPermutation(light);
            n++;
            break;
          }
        }
      }
      yield;
    }
    return n;
  });
}

/** Clear everything above your feet and fill holes in the layer you stand on. */
export function opFlatten(p, radius) {
  const r = radiusOf(radius, 10, 48);
  const c = floorVec(p.location);
  const above = boxOf({ x: c.x - r, y: c.y, z: c.z - r }, { x: c.x + r, y: c.y + 64, z: c.z + r });
  const floor = boxOf({ x: c.x - r, y: c.y - 1, z: c.z - r }, { x: c.x + r, y: c.y - 1, z: c.z + r });
  runEdit(p, `Flatten (r=${r})`, unionOf([above, floor]), function* (dim) {
    const under = dim.getBlock({ x: c.x, y: c.y - 1, z: c.z });
    const ground = under && !under.isAir && !under.isLiquid ? under.permutation : BlockPermutation.resolve("minecraft:grass_block");
    const hr = dim.heightRange;
    const top = clampY(above, hr.min, hr.max - 1);
    let n = top ? yield* fillBox(dim, top, AIR(), { excludeTypes: ["minecraft:air"] }) : 0;
    n += yield* fillBox(dim, floor, ground, { includeTypes: known(["minecraft:air", ...LIQUID_BLOCKS, ...PLANT_BLOCKS, ...SNOW_BLOCKS]) });
    return n;
  });
}

// --------------------------------------------------------------------------
// brushes

export const BRUSH_MODES = ["sphere", "paint", "erase", "overlay"];

/** Bind a brush to the item in the player's hand. */
export function bindBrush(p, block, radius, mode) {
  const held = heldItem(p);
  if (!held) return tell(p, "§cHold the item you want to use as a brush (a stick, feather or blaze rod works well).");
  const m = BRUSH_MODES.includes(mode) ? mode : "sphere";
  const perm = m === "erase" ? AIR() : toPerm(block);
  if (!perm) return tell(p, `§cUnknown block: ${block}`);
  const r = Math.max(0, Math.min(16, Math.floor(radius ?? 3)));
  const s = stateOf(p);
  s.brushes[held.typeId] = { block: perm.type.id, radius: r, mode: m };
  save(p);
  tell(p, `§aBrush bound to §f${held.typeId}§a: ${m} ${m === "erase" ? "" : perm.type.id + " "}r=${r}. §7Right-click while aiming to use, /we:unbrush to remove.`);
}

export function unbindBrush(p) {
  const held = heldItem(p);
  const s = stateOf(p);
  if (held && s.brushes[held.typeId]) { delete s.brushes[held.typeId]; save(p); tell(p, "§aBrush removed."); }
  else tell(p, "§eThe item in your hand has no brush.");
}

/** @param {Player} p */
export function heldItem(p) {
  try { return p.getComponent("minecraft:inventory")?.container?.getItem(p.selectedSlotIndex); } catch { return undefined; }
}

/** @param {Player} p @param {string} typeId */
export const hasBrush = (p, typeId) => !!stateOf(p).brushes[typeId];

/** @param {Player} p @param {string} typeId @returns {boolean} true if a brush handled it */
export function useBrush(p, typeId) {
  const s = stateOf(p);
  const b = s.brushes[typeId];
  if (!b) return false;
  const hit = p.getBlockFromViewDirection({ maxDistance: 160, includeLiquidBlocks: false, includePassableBlocks: false });
  if (!hit) { tell(p, "§7(brush) No block in range."); return true; }
  const c = floorVec(hit.block.location);
  const perm = toPerm(b.block) ?? AIR();
  const r = b.radius;
  const box = sphereBox(c, r);
  if (b.mode === "paint") {
    runEdit(p, `Brush paint ${b.block}`, box, (dim) => fillRuns(dim, sphereRuns(c, r, false), perm, { excludeTypes: known(["minecraft:air", ...LIQUID_BLOCKS]) }));
  } else if (b.mode === "erase") {
    runEdit(p, "Brush erase", box, (dim) => fillRuns(dim, sphereRuns(c, r, false), AIR()));
  } else if (b.mode === "overlay") {
    runEdit(p, `Brush overlay ${b.block}`, box, function* (dim) {
      let n = 0;
      for (let x = c.x - r; x <= c.x + r; x++) {
        for (let z = c.z - r; z <= c.z + r; z++) {
          if ((x - c.x) ** 2 + (z - c.z) ** 2 > (r + 0.5) ** 2) continue;
          for (let y = c.y + r; y > c.y - r; y--) {
            const here = dim.getBlock({ x, y, z });
            const below = dim.getBlock({ x, y: y - 1, z });
            if (!here || !below) break;
            if (here.isAir && !below.isAir && !below.isLiquid && !REPLACEABLE.has(below.typeId)) { here.setPermutation(perm); n++; break; }
          }
        }
        yield;
      }
      return n;
    });
  } else {
    runEdit(p, `Brush sphere ${b.block}`, box, (dim) => fillRuns(dim, sphereRuns(c, r, false), perm));
  }
  return true;
}

// --------------------------------------------------------------------------
// misc

export function setLimit(p, n) {
  const s = stateOf(p);
  s.limit = Math.max(1000, Math.min(MAX_LIMIT, Math.floor(n)));
  save(p);
  tell(p, `§aEdit limit set to ${s.limit.toLocaleString()} blocks.`);
}

export function info(p) {
  const s = stateOf(p);
  const sel = selection(p, true);
  const brushes = Object.entries(s.brushes).map(([k, b]) => `${k.replace("minecraft:", "")}=${b.mode} ${b.block.replace("minecraft:", "")} r${b.radius}`);
  tell(p, [
    "§d--- World Edit v3 ---",
    `§fPos1: §e${s.pos1 ? fmt(s.pos1) : "-"}  §fPos2: §e${s.pos2 ? fmt(s.pos2) : "-"}`,
    `§fSelection: §e${sel ? fmtSize(sel) : "none"}`,
    `§fClipboard: §e${s.clip ? `${s.clip.size.x}x${s.clip.size.y}x${s.clip.size.z}` : "empty"}  §fUndo: §e${s.history.length}  §fRedo: §e${s.redo.length}`,
    `§fLimit: §e${s.limit.toLocaleString()}  §fBrushes: §e${brushes.join(", ") || "none"}`,
  ].join("\n"));
}

export function giveWand(p) {
  system.run(() => {
    const wand = new ItemStack(WAND_ITEM, 1);
    wand.nameTag = WAND_NAME;
    wand.setLore(["§7Left-click block: §fposition 1", "§7Right-click block: §fposition 2", "§7Use in the air / sneak + right-click: §fmenu"]);
    const inv = p.getComponent("minecraft:inventory")?.container;
    const left = inv?.addItem(wand);
    if (left) p.dimension.spawnItem(left, p.location);
    tell(p, "§aHere's your wand. §7Left-click = pos1, right-click = pos2, use in the air for the menu.");
  });
}

/** @param {import("@minecraft/server").ItemStack|undefined} item */
export const isWand = (item) => !!item && item.typeId === WAND_ITEM && item.nameTag === WAND_NAME;

/** Particle outline + action bar for operators holding the wand. */
export function tickSelectionDisplay() {
  for (const p of world.getAllPlayers()) {
    if (!canEdit(p) || !isWand(heldItem(p))) continue;
    const s = stateOf(p);
    const sel = selection(p, true);
    const label = sel ? `§dSelection §f${fmtSize(sel)}` : `§dPos1 §f${s.pos1 ? fmt(s.pos1) : "-"} §dPos2 §f${s.pos2 ? fmt(s.pos2) : "-"}`;
    try { p.onScreenDisplay.setActionBar(label); } catch { /* ignore */ }
    if (!sel) continue;
    const { min, max } = sel;
    const lo = { x: min.x, y: min.y, z: min.z }, hi = { x: max.x + 1, y: max.y + 1, z: max.z + 1 };
    const sz = sizeOf(sel);
    const step = Math.max(1, Math.ceil((sz.x + sz.y + sz.z) * 4 / 240));
    const edge = (a, b) => {
      const len = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z));
      for (let i = 0; i <= len; i += step) {
        const t = len ? i / len : 0;
        try { p.spawnParticle("minecraft:villager_happy", { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }); } catch { return; }
      }
    };
    for (const y of [lo.y, hi.y]) {
      edge({ x: lo.x, y, z: lo.z }, { x: hi.x, y, z: lo.z });
      edge({ x: lo.x, y, z: hi.z }, { x: hi.x, y, z: hi.z });
      edge({ x: lo.x, y, z: lo.z }, { x: lo.x, y, z: hi.z });
      edge({ x: hi.x, y, z: lo.z }, { x: hi.x, y, z: hi.z });
    }
    for (const x of [lo.x, hi.x]) for (const z of [lo.z, hi.z]) edge({ x, y: lo.y, z }, { x, y: hi.y, z });
  }
}

/** For the help text. */
export const isCreative = (p) => { try { return p.getGameMode() === GameMode.Creative; } catch { return false; } };
