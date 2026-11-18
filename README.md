# Minecraft-Dungeons-Mod-Fix-Edu26.32

A fixed version of the **Minecraft Dungeons** adventure map (Squid Coast + the Camp, by *Pilot Raptor 64*) that imports and plays in **Minecraft Education 26.32**.

## Install

1. Download **`MinecraftDungeons_Edu26.32.mcworld`**.
2. Open it with Minecraft Education. Either double-click the file, or go to **Play → Import** and pick it.
3. The world **§eMINECRAFT §6DUNGEONS §fV1.0** appears in *View My Worlds*. Its sound pack, **World Edit v3** and **Craftable Portals v2** are applied automatically.

> If you tried importing the old file before, delete that broken world copy first so you don't open the wrong one.

## What was fixed

Short version (full details in [FIXES.md](FIXES.md)):

1. **Import failed.** The world was nested inside an extra folder and shipped as `.zip`. It's now a proper `.mcworld` with `level.dat` at the root.
2. **Broken unused packs removed.** World Edit (as a zip), Craftable Portals (missing dependency) and X-Ray (uses removed shaders) were bundled but never turned on.
3. **Sound pack modernised.** The manifest format went from 1 to 2, and template junk was removed, including an override of the vanilla particle material.
4. **Command blocks.** `fence 5` became `dark_oak_fence`, since data values and the old `fence` block were removed. A malformed `@p [r=100]` selector was also fixed.
5. **Over 2,600 stuck wither skulls / vexes** left over from the boss fight were removed. They would lag or crash lower-end classroom devices.
6. **level.dat.** The flat-world layer `minecraft:grass` was renamed to `minecraft:grass_block`.

## Remade add-ons

The three broken packs that came with the map have been rewritten from scratch. See **[ADDONS.md](ADDONS.md)** for the full guide.

| Add-on | In the world? | Separate download | Quick start |
|---|---|---|---|
| **World Edit v3** | ✅ enabled | `addons/WorldEdit_v3.mcpack` | `/we:wand`, then `/we:help`. Operators only. Has undo. |
| **Craftable Portals v2** | ✅ enabled | `addons/CraftablePortals_v2.mcaddon` | Craft a Nether or End Portal Kit and use it on the ground. |
| **X-Ray v2** | ❌ (would affect everyone) | `addons/XRay_v2.mcaddon` | Add it as a global resource pack, then run `/xray:nightvision`. |

## Rebuilding

`mcdungeons_mcb.zip` is the untouched original. To regenerate the fixed world (Python 3, standard library only):

```sh
python3 tools/build_packs.py   # regenerates icons, X-Ray subpacks, fallback functions, addons/*
python3 tools/fix_world.py mcdungeons_mcb.zip MinecraftDungeons_Edu26.32.mcworld
```

Optional script checks (Node 18+): `npm install && npm run check && npm test`.

Credits: map and sounds by Pilot Raptor 64. This repo contains compatibility fixes, plus clean rewrites of the World Edit (originally by BONY162), Craftable Portals and X-Ray (originally by d6b) ideas. No code from those packs is reused.
