// X-Ray v2 helper: /xray:nightvision toggles permanent, particle-free night vision.
// (The old pack tried a "fullbright" shader, which the RenderDragon engine ignores.)
import { system, world, CommandPermissionLevel, CustomCommandStatus, Player } from "@minecraft/server";

const TAG = "xray_nv";
const LONG = 20_000_000; // ticks (~11 days) - the longest duration addEffect accepts

/** @param {Player} p */
function apply(p) {
  try { p.addEffect("night_vision", LONG, { amplifier: 0, showParticles: false }); } catch { /* dead / left */ }
}

/** @param {Player} p */
function toggle(p) {
  if (p.hasTag(TAG)) {
    p.removeTag(TAG);
    try { p.removeEffect("night_vision"); } catch { /* none */ }
    p.sendMessage("§bX-Ray night vision §coff");
  } else {
    p.addTag(TAG);
    apply(p);
    p.sendMessage("§bX-Ray night vision §aon §7(/xray:nightvision again to turn off)");
  }
}

system.beforeEvents.startup.subscribe((ev) => {
  ev.customCommandRegistry.registerCommand({
    name: "xray:nightvision",
    description: "Toggle permanent night vision (for X-Ray)",
    permissionLevel: CommandPermissionLevel.GameDirectors,
    cheatsRequired: true,
  }, (origin) => {
    const p = origin.sourceEntity;
    if (!(p instanceof Player)) return { status: CustomCommandStatus.Failure, message: "Run this as a player." };
    system.run(() => toggle(p));
    return { status: CustomCommandStatus.Success };
  });
});

// milk / death clears effects - put night vision back for anyone who turned it on
system.runInterval(() => {
  for (const p of world.getPlayers({ tags: [TAG] })) {
    if (!p.getEffect("night_vision")) apply(p);
  }
}, 40);
