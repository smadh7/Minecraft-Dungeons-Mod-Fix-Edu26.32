// World Edit v3 - in-game menus (opened by using the wand in the air, or /we:menu).
import { system } from "@minecraft/server";
import { ActionFormData, FormCancelationReason, ModalFormData } from "@minecraft/server-ui";
import * as we from "./core.js";

/** @typedef {import("@minecraft/server").Player} Player */

/** Show a form; if the player still has chat open, retry for a few seconds. */
async function show(p, form, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const r = await form.show(p);
    if (!r.canceled || r.cancelationReason !== FormCancelationReason.UserBusy) return r;
    await new Promise((res) => system.runTimeout(() => res(undefined), 10));
  }
  return undefined;
}

const MODES = ["sphere", "paint", "erase", "overlay"];
const ROTS = ["none", "rot90", "rot180", "rot270"];
const MIRRORS = ["none", "x", "z", "xz"];

/** @param {Player} p */
export function openMenu(p) {
  system.run(() => { mainMenu(p).catch((e) => we.tell(p, `§cMenu error: ${e?.message ?? e}`)); });
}

/** @param {Player} p */
async function mainMenu(p) {
  const sel = we.selection(p, true);
  const items = [
    { label: "Selection info", run: () => we.info(p) },
    { label: "Set blocks", run: () => askBlocks(p, "Set selection to", 1, (a) => we.opSet(p, a)) },
    { label: "Replace blocks", run: () => askBlocks(p, "Replace in selection", 2, (a, b) => we.opReplace(p, a, b)) },
    { label: "Walls", run: () => askBlocks(p, "Build walls with", 1, (a) => we.opWalls(p, a, false)) },
    { label: "Outline (hollow box)", run: () => askBlocks(p, "Outline with", 1, (a) => we.opWalls(p, a, true)) },
    { label: "Clear selection area", run: () => we.opSet(p, "air") },
    { label: "Copy", run: () => we.opCopy(p, false) },
    { label: "Cut", run: () => we.opCopy(p, true) },
    { label: "Paste", run: () => askPaste(p) },
    { label: "Sphere / Cylinder", run: () => askShape(p) },
    { label: "Brush", run: () => askBrush(p) },
    { label: "Terrain tools", run: () => terrainMenu(p) },
    { label: "Undo", run: () => we.undoRedo(p, false) },
    { label: "Redo", run: () => we.undoRedo(p, true) },
    { label: "Help", run: () => help(p) },
  ];
  const f = new ActionFormData()
    .title("§dWorld Edit v3")
    .body(sel ? `Selection: ${sel.max.x - sel.min.x + 1} x ${sel.max.y - sel.min.y + 1} x ${sel.max.z - sel.min.z + 1}` : "No selection yet. Left-click a block with the wand for position 1, right-click for position 2.");
  for (const it of items) f.button(it.label);
  const r = await show(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  await items[r.selection].run();
}

/** Ask for 1 or 2 block ids. */
async function askBlocks(p, title, count, done) {
  const f = new ModalFormData().title(title)
    .textField(count === 2 ? "Find block" : "Block", "e.g. stone, oak_planks, glass", { defaultValue: "stone" });
  if (count === 2) f.textField("Replace with", "e.g. grass_block", { defaultValue: "dirt" });
  const r = await show(p, f);
  if (!r || r.canceled || !r.formValues) return;
  done(String(r.formValues[0] ?? ""), String(r.formValues[1] ?? ""));
}

async function askPaste(p) {
  const f = new ModalFormData().title("Paste")
    .dropdown("Rotation (clockwise)", ["0°", "90°", "180°", "270°"], { defaultValueIndex: 0 })
    .dropdown("Mirror", ["None", "X", "Z", "X and Z"], { defaultValueIndex: 0 });
  const r = await show(p, f);
  if (!r || r.canceled || !r.formValues) return;
  we.opPaste(p, ROTS[Number(r.formValues[0])], MIRRORS[Number(r.formValues[1])]);
}

async function askShape(p) {
  const f = new ModalFormData().title("Sphere / Cylinder (at your feet)")
    .dropdown("Shape", ["Sphere", "Cylinder"], { defaultValueIndex: 0 })
    .textField("Block", "e.g. stone", { defaultValue: "stone" })
    .slider("Radius", 1, 32, { valueStep: 1, defaultValue: 5 })
    .slider("Cylinder height", 1, 64, { valueStep: 1, defaultValue: 5 })
    .toggle("Hollow", { defaultValue: false });
  const r = await show(p, f);
  if (!r || r.canceled || !r.formValues) return;
  const [shape, block, radius, height, hollow] = r.formValues;
  if (Number(shape) === 0) we.opSphere(p, String(block), Number(radius), !!hollow);
  else we.opCylinder(p, String(block), Number(radius), Number(height), !!hollow);
}

async function askBrush(p) {
  const f = new ModalFormData().title("Bind brush to held item")
    .dropdown("Mode", ["Sphere (fill)", "Paint (recolour existing blocks)", "Erase", "Overlay (cover the ground)"], { defaultValueIndex: 0 })
    .textField("Block", "e.g. stone, snow_layer, short_grass", { defaultValue: "stone" })
    .slider("Radius", 0, 16, { valueStep: 1, defaultValue: 3 });
  const r = await show(p, f);
  if (!r || r.canceled || !r.formValues) return;
  we.bindBrush(p, String(r.formValues[1]), Number(r.formValues[2]), MODES[Number(r.formValues[0])]);
}

async function terrainMenu(p) {
  const tools = [
    { label: "Drain water & lava", run: (rad) => we.opDrain(p, rad) },
    { label: "Remove trees", run: (rad) => we.opRemoveTrees(p, rad) },
    { label: "Remove grass & flowers", run: (rad) => we.opRemovePlants(p, rad) },
    { label: "Remove snow", run: (rad) => we.opRemoveSnow(p, rad) },
    { label: "Light up area (invisible lights)", run: (rad) => we.opLight(p, rad) },
    { label: "Flatten", run: (rad) => we.opFlatten(p, rad) },
    { label: "Replace nearby blocks", run: (rad) => askBlocks(p, "Replace nearby", 2, (a, b) => we.opReplaceNear(p, a, b, rad)) },
  ];
  const f = new ModalFormData().title("Terrain tools (around you)")
    .dropdown("Tool", tools.map((t) => t.label), { defaultValueIndex: 0 })
    .slider("Radius", 1, 48, { valueStep: 1, defaultValue: 12 });
  const r = await show(p, f);
  if (!r || r.canceled || !r.formValues) return;
  await tools[Number(r.formValues[0])].run(Number(r.formValues[1]));
}

/** @param {Player} p */
export function help(p) {
  we.tell(p, [
    "§d=== World Edit v3 (operators only) ===",
    "§e/we:wand §f- get the wand (left-click pos1, right-click pos2, use in air = menu)",
    "§e/we:pos1 /we:pos2 [x y z] §f- set corners (default: where you stand)",
    "§e/we:hpos1 /we:hpos2 §f- set a corner to the block you're looking at",
    "§e/we:set <block>  /we:replace <from> <to>  /we:walls <block>  /we:outline <block>",
    "§e/we:copy  /we:cut  /we:paste [rotation] [mirror]  /we:stack <count> [direction]",
    "§e/we:sphere <block> <radius> [hollow]  /we:cyl <block> <radius> [height] [hollow]",
    "§e/we:expand <amount> [direction]  /we:size  /we:desel",
    "§e/we:drain  /we:removetrees  /we:removeplants  /we:removesnow  /we:light  /we:flatten [radius]",
    "§e/we:removenear <block> [radius]  /we:replacenear <from> <to> [radius]",
    "§e/we:brush <block> [radius] [sphere|paint|erase|overlay]  /we:unbrush",
    "§e/we:undo  /we:redo  /we:limit <blocks>  /we:menu",
  ].join("\n"));
}
