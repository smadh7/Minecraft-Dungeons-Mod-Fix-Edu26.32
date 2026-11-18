// Craftable Portals v2 - portal kits.
// Nether/End portal blocks aren't items, so recipes can't output them directly
// (that's why the old pack's "portal" / "end_portal" / "end_gateway" recipes never
// worked). Instead you craft a kit; using it on the ground builds a working portal.
import { system, world, BlockPermutation, GameMode, Player } from "@minecraft/server";

const NETHER_KIT = "portals:nether_portal_kit";
const END_KIT = "portals:end_portal_kit";

/** @typedef {{x:number,y:number,z:number}} Vec */
/** @typedef {{loc:Vec, perm:BlockPermutation}} Placement */

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

/** Blocks a kit may build over. */
const BUILDABLE = new Set([
  "minecraft:air", "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern", "minecraft:large_fern",
  "minecraft:snow_layer", "minecraft:deadbush", "minecraft:light_block_15", "minecraft:fire", "minecraft:soul_fire",
]);

/** Which way the player is looking, flattened to a horizontal axis. */
function facing(p) {
  const v = p.getViewDirection();
  return Math.abs(v.x) >= Math.abs(v.z) ? (v.x >= 0 ? "east" : "west") : v.z >= 0 ? "south" : "north";
}

/** Standard 4 x 5 obsidian frame with a 2 x 3 portal, centred in front of the player.
 * @param {Vec} base block the portal stands on top of (frame bottom row is base.y+1) */
function netherPortal(base, dir) {
  // the portal faces the player, so it runs left-right across their view
  const alongX = dir === "north" || dir === "south";
  const step = alongX ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
  const obsidian = BlockPermutation.resolve("minecraft:obsidian");
  const portal = BlockPermutation.resolve("minecraft:portal", { portal_axis: alongX ? "x" : "z" });
  /** @type {Placement[]} */
  const out = [];
  for (let i = -1; i <= 2; i++) {
    for (let h = 1; h <= 5; h++) {
      const edgeCol = i === -1 || i === 2, edgeRow = h === 1 || h === 5;
      if (edgeCol && edgeRow) continue; // corners aren't needed (saves 4 obsidian)
      const loc = add(base, { x: step.x * i, y: h, z: step.z * i });
      out.push({ loc, perm: edgeCol || edgeRow ? obsidian : portal });
    }
  }
  return out;
}

/** 3 x 3 End portal surrounded by 12 filled frames, centred on the block above `base`. */
function endPortal(base) {
  const center = add(base, { x: 0, y: 1, z: 0 });
  const end = BlockPermutation.resolve("minecraft:end_portal");
  /** @type {Placement[]} */
  const out = [];
  const frame = (dir) => BlockPermutation.resolve("minecraft:end_portal_frame", {
    "minecraft:cardinal_direction": dir, end_portal_eye_bit: true,
  });
  for (let d = -1; d <= 1; d++) {
    out.push({ loc: add(center, { x: d, y: 0, z: -2 }), perm: frame("south") }); // north row faces in (south)
    out.push({ loc: add(center, { x: d, y: 0, z: 2 }), perm: frame("north") });
    out.push({ loc: add(center, { x: -2, y: 0, z: d }), perm: frame("east") });
    out.push({ loc: add(center, { x: 2, y: 0, z: d }), perm: frame("west") });
    for (let e = -1; e <= 1; e++) out.push({ loc: add(center, { x: d, y: 0, z: e }), perm: end });
  }
  return out;
}

/** @param {Player} p @param {string} msg */
const tell = (p, msg) => { try { p.sendMessage(msg); } catch { /* left */ } };

/** Check, place, take one kit. Runs in normal (write) context. @param {Player} p */
function build(p, kit, base) {
  const dim = p.dimension;
  let plan;
  try {
    if (kit === NETHER_KIT) {
      if (dim.id === "minecraft:the_end") return tell(p, "§cNether portals don't work in the End.");
      plan = netherPortal(base, facing(p));
    } else {
      plan = endPortal(base);
    }
  } catch (e) { return tell(p, `§cThis game version can't build that portal (${e?.message ?? e}).`); }

  const hr = dim.heightRange;
  for (const { loc } of plan) {
    if (loc.y < hr.min || loc.y >= hr.max) return tell(p, "§cNot enough room here (world height limit).");
    const b = dim.getBlock(loc);
    if (!b) return tell(p, "§cPart of that area isn't loaded.");
    if (!BUILDABLE.has(b.typeId)) {
      // show the player what's in the way
      try { dim.spawnParticle("minecraft:villager_angry", add(loc, { x: 0.5, y: 0.5, z: 0.5 })); } catch { /* ignore */ }
      return tell(p, `§cSomething is in the way (${b.typeId.replace("minecraft:", "")} at ${loc.x}, ${loc.y}, ${loc.z}). Clear the space and try again.`);
    }
  }
  // frames first so the portal blocks are supported when they appear
  const portalIds = new Set(["minecraft:portal", "minecraft:end_portal"]);
  for (const pass of [false, true]) {
    for (const { loc, perm } of plan) {
      if (portalIds.has(perm.type.id) === pass) dim.getBlock(loc)?.setPermutation(perm);
    }
  }
  consumeOne(p, kit);
  try { dim.playSound(kit === END_KIT ? "block.end_portal.spawn" : "portal.trigger", base, { volume: 0.6 }); } catch { /* ignore */ }
  tell(p, kit === END_KIT ? "§aEnd portal built. §7Jump in to go to the End." : "§aNether portal built. §7Stand inside it to travel.");
}

/** @param {Player} p */
function consumeOne(p, kit) {
  try { if (p.getGameMode() === GameMode.Creative) return; } catch { /* assume survival */ }
  const inv = p.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  const slot = p.selectedSlotIndex;
  const item = inv.getItem(slot);
  if (!item || item.typeId !== kit) return;
  if (item.amount > 1) { item.amount -= 1; inv.setItem(slot, item); } else inv.setItem(slot);
}

const isKit = (id) => id === NETHER_KIT || id === END_KIT;

// Use the kit on a block: build on top of it.
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (!ev.itemStack || !isKit(ev.itemStack.typeId)) return;
  ev.cancel = true;
  if (!ev.isFirstEvent) return;
  const p = ev.player, kit = ev.itemStack.typeId, base = ev.block.location;
  system.run(() => build(p, kit, base));
});

// Use the kit in the air: build on the ground a few blocks in front of you.
world.afterEvents.itemUse.subscribe((ev) => {
  if (!isKit(ev.itemStack.typeId)) return;
  const p = ev.source;
  if (p.getBlockFromViewDirection({ maxDistance: 6 })) return; // handled above
  const v = p.getViewDirection();
  const ahead = { x: Math.floor(p.location.x + v.x * 3), y: Math.floor(p.location.y), z: Math.floor(p.location.z + v.z * 3) };
  // find the ground below that spot
  for (let dy = 2; dy >= -6; dy--) {
    const b = p.dimension.getBlock({ ...ahead, y: ahead.y + dy });
    if (b && !b.isAir && !b.isLiquid && !BUILDABLE.has(b.typeId)) return build(p, ev.itemStack.typeId, b.location);
  }
  tell(p, "§cAim at the ground to place the portal.");
});
