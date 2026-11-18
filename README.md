# Minecraft-Dungeons-Mod-Fix-Edu26.32

A fixed version of the **Minecraft Dungeons** adventure map (Squid Coast + the Camp, by *Pilot Raptor 64*) that imports and plays in **Minecraft Education 26.32**.

## Install

1. Download **`MinecraftDungeons_Edu26.32.mcworld`**.
2. Open it with Minecraft Education. Either double-click the file, or go to **Play → Import** and pick it.
3. The world **§eMINECRAFT §6DUNGEONS §fV1.0** appears in *View My Worlds*. Its sound pack is applied automatically.

> If you tried importing the old file before, delete that broken world copy first so you don't open the wrong one.

## What was fixed

Short version (full details in [FIXES.md](FIXES.md)):

1. **Import failed.** The world was nested inside an extra folder and shipped as `.zip`. It's now a proper `.mcworld` with `level.dat` at the root.
2. **Broken unused packs removed.** World Edit (as a zip), Craftable Portals (missing dependency) and X-Ray (uses removed shaders) were bundled but never turned on.
3. **Sound pack modernised.** The manifest format went from 1 to 2, and template junk was removed, including an override of the vanilla particle material.
4. **Command blocks.** `fence 5` became `dark_oak_fence`, since data values and the old `fence` block were removed. A malformed `@p [r=100]` selector was also fixed.
5. **Over 2,600 stuck wither skulls / vexes** left over from the boss fight were removed. They would lag or crash lower-end classroom devices.
6. **level.dat.** The flat-world layer `minecraft:grass` was renamed to `minecraft:grass_block`.

## Rebuilding

`mcdungeons_mcb.zip` is the untouched original. To regenerate the fixed world (Python 3, standard library only):

```sh
python3 tools/fix_world.py mcdungeons_mcb.zip MinecraftDungeons_Edu26.32.mcworld
```

Credits: map and sounds by Pilot Raptor 64. This repo only contains compatibility fixes.
