// World Edit v3 for Minecraft Education / Bedrock (Script API @minecraft/server 2.1.0)
// Remake of "World Edit v2.1 by BONY162": no player.json override, no old /execute
// syntax, works in current versions, undo/redo, operators only.
import {
  system,
  world,
  CommandPermissionLevel,
  CustomCommandParamType as T,
  CustomCommandStatus,
  Player,
} from "@minecraft/server";
import * as we from "./core.js";
import { help, openMenu } from "./ui.js";

const NS = "we";
const warn = (/** @type {string} */ m) => { try { globalThis["console"]?.warn(`[World Edit] ${m}`); } catch { /* no console */ } };
/** Enum parameter: Bedrock links an enum parameter by giving it the enum's name. */
/** @param {string} name @returns {[string, any]} */
const E = (name) => [`${NS}:${name}`, T.Enum];

/** Wrap a handler: only players, run outside the restricted command context. */
function handler(fn) {
  return (origin, ...args) => {
    const p = origin.sourceEntity;
    if (!(p instanceof Player)) {
      return { status: CustomCommandStatus.Failure, message: "World Edit commands must be run by a player." };
    }
    system.run(() => {
      try { fn(p, ...args); } catch (e) { we.tell(p, `§cError: ${e?.message ?? e}`); }
    });
    return { status: CustomCommandStatus.Success };
  };
}

/** @type {Array<[string, string, Array<[string, any]>, Array<[string, any]>, Function]>} */
const COMMANDS = [
  ["help", "Show World Edit help", [], [], (p) => help(p)],
  ["menu", "Open the World Edit menu", [], [], (p) => openMenu(p)],
  ["wand", "Get the selection wand", [], [], (p) => we.giveWand(p)],
  ["pos1", "Set position 1 (default: your position)", [], [["location", T.Location]], (p, loc) => we.setPos(p, 1, loc ?? p.location)],
  ["pos2", "Set position 2 (default: your position)", [], [["location", T.Location]], (p, loc) => we.setPos(p, 2, loc ?? p.location)],
  ["hpos1", "Set position 1 to the block you look at", [], [], (p) => lookPos(p, 1)],
  ["hpos2", "Set position 2 to the block you look at", [], [], (p) => lookPos(p, 2)],
  ["desel", "Clear your selection", [], [], (p) => we.clearSelection(p)],
  ["size", "Show selection, clipboard and history info", [], [], (p) => we.info(p)],
  ["expand", "Expand the selection", [["amount", T.Integer]], [E("direction")], (p, n, d) => we.expandSelection(p, d ?? "look", n)],
  ["set", "Fill the selection with a block", [["block", T.BlockType]], [], (p, b) => we.opSet(p, b)],
  ["replace", "Replace one block with another in the selection", [["from", T.BlockType], ["to", T.BlockType]], [], (p, a, b) => we.opReplace(p, a, b)],
  ["walls", "Build walls around the selection", [["block", T.BlockType]], [], (p, b) => we.opWalls(p, b, false)],
  ["outline", "Hollow box around the selection", [["block", T.BlockType]], [], (p, b) => we.opWalls(p, b, true)],
  ["clear", "Fill the selection with air", [], [], (p) => we.opSet(p, "air")],
  ["copy", "Copy the selection (relative to you)", [], [], (p) => we.opCopy(p, false)],
  ["cut", "Copy the selection, then clear it", [], [], (p) => we.opCopy(p, true)],
  ["paste", "Paste the clipboard (relative to you)", [], [E("rotation"), E("mirror")], (p, r, m) => we.opPaste(p, r, m)],
  ["stack", "Repeat the selection next to itself", [["count", T.Integer]], [E("direction")], (p, n, d) => we.opStack(p, n, d)],
  ["sphere", "Sphere at your feet", [["block", T.BlockType], ["radius", T.Integer]], [["hollow", T.Boolean]], (p, b, r, h) => we.opSphere(p, b, r, h)],
  ["cyl", "Cylinder at your feet", [["block", T.BlockType], ["radius", T.Integer]], [["height", T.Integer], ["hollow", T.Boolean]], (p, b, r, h, ho) => we.opCylinder(p, b, r, h ?? 1, ho)],
  ["drain", "Remove water and lava around you", [], [["radius", T.Integer]], (p, r) => we.opDrain(p, r)],
  ["removetrees", "Remove logs and leaves around you", [], [["radius", T.Integer]], (p, r) => we.opRemoveTrees(p, r)],
  ["removeplants", "Remove grass and flowers around you", [], [["radius", T.Integer]], (p, r) => we.opRemovePlants(p, r)],
  ["removesnow", "Remove snow layers around you", [], [["radius", T.Integer]], (p, r) => we.opRemoveSnow(p, r)],
  ["removenear", "Remove a block type around you", [["block", T.BlockType]], [["radius", T.Integer]], (p, b, r) => we.opRemoveNear(p, b, r)],
  ["replacenear", "Replace a block type around you", [["from", T.BlockType], ["to", T.BlockType]], [["radius", T.Integer]], (p, a, b, r) => we.opReplaceNear(p, a, b, r)],
  ["light", "Light up the ground around you with invisible lights", [], [["radius", T.Integer]], (p, r) => we.opLight(p, r)],
  ["flatten", "Flatten the area around you", [], [["radius", T.Integer]], (p, r) => we.opFlatten(p, r)],
  ["brush", "Bind a brush to the held item", [["block", T.BlockType]], [["radius", T.Integer], E("brushmode")], (p, b, r, m) => we.bindBrush(p, b, r ?? 3, m ?? "sphere")],
  ["unbrush", "Remove the brush from the held item", [], [], (p) => we.unbindBrush(p)],
  ["undo", "Undo your last edit", [], [], (p) => we.undoRedo(p, false)],
  ["redo", "Redo the last undone edit", [], [], (p) => we.undoRedo(p, true)],
  ["limit", "Set the maximum blocks per edit", [["blocks", T.Integer]], [], (p, n) => we.setLimit(p, n)],
];

function lookPos(p, which) {
  const hit = p.getBlockFromViewDirection({ maxDistance: 200 });
  if (!hit) return we.tell(p, "§cYou aren't looking at a block.");
  we.setPos(p, which, hit.block.location);
}

system.beforeEvents.startup.subscribe((ev) => {
  const reg = ev.customCommandRegistry;
  try {
    reg.registerEnum(`${NS}:direction`, ["look", "up", "down", "north", "south", "east", "west", "vert"]);
    reg.registerEnum(`${NS}:rotation`, ["none", "rot90", "rot180", "rot270"]);
    reg.registerEnum(`${NS}:mirror`, ["none", "x", "z", "xz"]);
    reg.registerEnum(`${NS}:brushmode`, we.BRUSH_MODES);
  } catch (e) { warn(`enum registration failed: ${e}`); }
  for (const [name, description, mandatory, optional, fn] of COMMANDS) {
    try {
      reg.registerCommand({
        name: `${NS}:${name}`,
        description,
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: true,
        mandatoryParameters: mandatory.map(([n, type]) => ({ name: n, type })),
        optionalParameters: optional.map(([n, type]) => ({ name: n, type })),
      }, handler(fn));
    } catch (e) { warn(`could not register /${NS}:${name}: ${e}`); }
  }
});

// ---- wand: left-click block = pos1, right-click block = pos2 --------------
// entityHitBlock fires on every punch, including in Adventure mode (this map's
// default), where block-break events never fire.
world.afterEvents.entityHitBlock.subscribe((ev) => {
  const p = ev.damagingEntity;
  if (!(p instanceof Player) || !we.canEdit(p) || !we.isWand(we.heldItem(p))) return;
  we.setPos(p, 1, ev.hitBlock.location);
});

// In Creative/Survival: don't actually break the block with the wand.
world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  if (we.isWand(ev.itemStack) && we.canEdit(ev.player)) ev.cancel = true;
});

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player;
  if (!ev.itemStack || !we.canEdit(p)) return;
  const wand = we.isWand(ev.itemStack);
  const brush = !wand && we.hasBrush(p, ev.itemStack.typeId);
  if (!wand && !brush) return;
  ev.cancel = true; // no log stripping / block placing with tools
  if (!ev.isFirstEvent) return;
  const loc = ev.block.location, typeId = ev.itemStack.typeId, sneaking = p.isSneaking;
  system.run(() => {
    if (brush) we.useBrush(p, typeId);
    else if (sneaking) openMenu(p);
    else we.setPos(p, 2, loc);
  });
});

// ---- wand in the air = menu; bound items = brushes ------------------------
world.afterEvents.itemUse.subscribe((ev) => {
  const p = ev.source;
  if (!we.canEdit(p)) return;
  if (we.isWand(ev.itemStack)) {
    if (!p.getBlockFromViewDirection({ maxDistance: 6 })) openMenu(p);
    return;
  }
  // aiming at a nearby block is handled by playerInteractWithBlock
  if (we.hasBrush(p, ev.itemStack.typeId) && !p.getBlockFromViewDirection({ maxDistance: 6 })) we.useBrush(p, ev.itemStack.typeId);
});

system.runInterval(() => we.tickSelectionDisplay(), 10);

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (ev.initialSpawn && we.canEdit(ev.player)) {
    we.tell(ev.player, "§dWorld Edit v3 §fis active. Type §e/we:help §for §e/we:wand §fto start.");
  }
});
