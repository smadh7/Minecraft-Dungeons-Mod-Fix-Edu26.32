# What was wrong, and what was fixed

Target: **Minecraft Education 26.32** (Bedrock engine 1.26.3x).
Source: `mcdungeons_mcb.zip` ("§eMINECRAFT §6DUNGEONS §fV1.0" by Pilot Raptor 64, last saved in Bedrock 1.18.12).
Output: `MinecraftDungeons_Edu26.32.mcworld`, built by `tools/fix_world.py`.

## 1. The archive couldn't be imported (main problem)

* The world files were wrapped in an extra folder (`HBpOYo3qDgA=/level.dat`, …).
  A `.mcworld` must have `level.dat`, `db/`, `behavior_packs/` and so on **at the root** of the archive. Otherwise Minecraft rejects the import.
* The file was a `.zip`. Minecraft Education only imports worlds with a **`.mcworld`** extension.

**Fix:** rebuilt the archive with the world at the root, saved as `.mcworld`.

## 2. Broken / unused packs bundled inside the world

The world only turns on one pack pair (*mc dungeons sounds*). It also contained:

| Pack | Problem | Action |
|---|---|---|
| `World Edit BP V2.1 BY BONY162.mcpack.zip` | A zipped pack inside `behavior_packs/` isn't a valid world pack, and it overrides `player.json` | removed |
| `craftable_portals_tiny_addons_behaviourpack` | Depends on a resource pack (`f0549f37…`) that isn't included | removed |
| `X-RayByd6b` | Built on custom `.material` files and GLSL/HLSL shaders, which the current renderer no longer supports. Its manifest also lists a `variant_0` subpack folder that doesn't exist | removed |

None of these were part of the map, and none of them were turned on. All three have been **rewritten from scratch** for 26.32. See [ADDONS.md](ADDONS.md) and section 7 below.

## 3. The *mc dungeons sounds* packs used a legacy format

* Both manifests used `"format_version": 1` with `min_engine_version` 1.8.0. That forces legacy pack handling in current versions, which has caused vanilla mobs to render incorrectly (e.g. MCPE-178910).
  **Fix:** both manifests upgraded to `format_version: 2` with `min_engine_version: [1, 21, 0]`. The pack version went from `0.0.1` to `1.0.0` so a stale cached copy can't take precedence. `world_*_packs.json` and the history files were updated to match.
* The resource pack was full of leftovers from the "Addons Maker" app template: a replacement **`materials/particles.material`** (which overrode the vanilla particle materials), `entity.material`, models, render and animation controllers for mobs that don't exist, `item_texture.json` / `terrain_texture.json` pointing at missing textures, and a language file for non-existent spawn eggs. The behaviour pack had an app metadata file (`.data`).
  **Fix:** removed. The pack now contains only what it actually does: the three Minecraft Dungeons note-block sounds (`sounds/note/bell|flute|hat.ogg`), which the map plays with `/playsound note.*`.

## 4. Command blocks using removed syntax

All 229 command blocks were checked (173 in the world, 56 in saved structures).

| Where | Old command | New command | Why |
|---|---|---|---|
| Boat start (247 -51 -415) + structure `mystructure:cmd` | `/fill 246 -49 -415 246 -48 -415 fence 5` | `/fill 246 -49 -415 246 -48 -415 dark_oak_fence` | Numeric block data was removed from `/fill` in 1.19.70, and the `fence` block was split per wood type in 1.19.80. Data value 5 = dark oak. |
| Tower teleporters (2 59 -176), (-117 -2 -115) + structure `mystructure:groundfloor` | `/playsound random.levelup @p [r=100]` | `/playsound random.levelup @p[r=100]` | Stray space between the selector and its arguments |

Command blocks keep their stored command version, so every other command runs exactly as before.

## 5. Over 2,600 stuck projectiles (lag / crash on school devices)

The wither and evoker boss fight at the top of the tower left entities frozen in **451 unloaded chunks**. They would all start moving again whenever those chunks loaded:

* 1,760 `wither_skull` + 876 `wither_skull_dangerous` projectiles
* 11 vexes scattered around the map, attacking whoever walks by
* 2 `elder_guardian_ghost` entities at Y = 781, far above the world height limit

**Fix:** removed. The boss fight still works normally, because its command blocks summon fresh mobs.
All other entities (NPCs, villagers, armour stands, paintings, items, named mobs and so on) are untouched.

## 6. level.dat

This is a **flat** world, so every newly generated chunk uses the flat layer list. That list still referenced `minecraft:grass`, which was renamed to `minecraft:grass_block` (1.20.60).
**Fix:** layer name updated. Every other setting is unchanged: Adventure mode, cheats and command blocks on, keep inventory, spawn at the intro camp.

## 7. Removed packs remade (World Edit v3, Craftable Portals v2, X-Ray v2)

| Old pack | Why it was broken | Remake |
|---|---|---|
| World Edit v2.1 | Overrode `player.json` to run a function **every tick**. Used pre-1.19.50 `/execute`, aux data values and `replaceitem`. Depended on a missing RP. Anyone could trigger it by dropping named items. | Script API (`@minecraft/server` 2.1.0): 34 `/we:` commands, a wand, menus, undo/redo and brushes. **Operators only.** No `player.json` override, no tick function. Plain-command fallback functions included. |
| Craftable Portals | Recipes produced `portal`, `end_portal` and `end_gateway`, which **are not items**, so 3 of the 4 recipes could never work. Used legacy `bucket` data 10 and format 1.12. Depended on a missing RP. | 1.21.60 recipes with recipe-book unlocks. Recipes make an **End Portal Frame**, a **Nether Portal Kit** or an **End Portal Kit**. A kit builds a complete, working portal where you use it, and only in empty space. |
| X-Ray | Custom materials and HLSL/GLSL shaders, which RenderDragon ignores. A missing `variant_0` folder. About 230 duplicated ore textures. | A pure `blocks.json` pack (`"blockshape": "invisible"` on 49 vanilla terrain blocks, with entries copied from the 26.30 vanilla pack so textures and footstep sounds stay correct). 3 modes as subpacks. `/xray:nightvision` replaces the shader "fullbright". |

World Edit v3 and Craftable Portals v2 are installed **and enabled** in the world. X-Ray v2 is **not**, because it would make the map see-through for every player. It ships separately as `addons/XRay_v2.mcaddon`.

Checks: all scripts type-check against the official 2.1.0 / 2.0.0 typings (`npm run check`). The geometry code is unit-tested against brute force (`npm test`). Every block, item and command name was checked against Mojang's bedrock-samples v1.26.30.5 data.

## How the world database was edited safely

Bedrock stores worlds in Mojang's fork of LevelDB. `tools/leveldb.py` reads it (including Mojang's raw-deflate compression) and writes changes the way LevelDB does itself: new records are appended to the world's `.log` file. The game replays that log when the world is opened. The existing `.ldb` tables are never rewritten.

Verification:
* CRC32C matches the standard test vector and validates every existing log record.
* The NBT writer reproduces all 3,585 touched-type records byte-for-byte before any change.
* Diff of the result: exactly 456 records changed (451 entity lists, 3 block-entity chunks, 2 structures). All other ~54,000 records are identical.
* Google's reference LevelDB (`plyvel`, `paranoid_checks=True`) opens the result, replays the log, and returns the expected value for every changed key.
* The script is deterministic: re-running it gives a byte-identical `.mcworld`.

## Not changed (noted only)

* Three always-active command blocks run `/tp @p` with no destination ((-185 86 -76), (-105 -19 -90), (-108 -62 -76)). That command can't do anything from a command block, and it didn't in 1.18 either, so the author's blocks were left as-is.
