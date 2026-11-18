# Remade add-ons: World Edit v3 · Craftable Portals v2 · X-Ray v2

The original map came with three packs that couldn't work in Minecraft Education 26.32 (see [FIXES.md §2](FIXES.md)). They have been rewritten from scratch, with more features and none of the old problems.

| | World Edit v3 | Craftable Portals v2 | X-Ray v2 |
|---|---|---|---|
| Enabled in `MinecraftDungeons_Edu26.32.mcworld` | ✅ | ✅ | ❌ (see below) |
| Separate download (for any world) | `addons/WorldEdit_v3.mcpack` | `addons/CraftablePortals_v2.mcaddon` | `addons/XRay_v2.mcaddon` |
| Who can use it | Operators (teachers) | Everyone | Whoever installs it |
| Needs cheats on | yes | no | only for `/xray:nightvision` |

To add a separate download to another world, open the file with Minecraft Education. It imports into your packs. Then go to **world settings → Behavior Packs / Resource Packs → Available → Activate**.

---

## World Edit v3

### Getting started
1. Make sure you are an **Operator** (world settings → *Player Permissions*). Students with Member or Visitor permissions can't use World Edit, so they can't wreck the map.
2. Type **`/we:wand`**. You get a glowing *World Edit Wand* (a named wooden axe).
3. **Left-click** a block for **position 1**. **Right-click** a block for **position 2**. Green particles outline your selection, and its size shows above the hotbar.
4. **Use the wand in the air**, or **sneak + right-click**, to open the menu. Everything can be done from the menu, so you never need to type commands.

The wand works in **Adventure mode** too. The map defaults to Adventure, and the old pack didn't work there.

### Commands
All commands start with `/we:` and appear in command autocomplete with descriptions.

| Command | What it does |
|---|---|
| `/we:pos1 [x y z]`, `/we:pos2 [x y z]` | Set a corner (default: where you stand) |
| `/we:hpos1`, `/we:hpos2` | Set a corner to the block you're looking at (up to 200 blocks away) |
| `/we:expand <n> [look\|up\|down\|north\|south\|east\|west\|vert]` | Grow the selection (`vert` = full world height) |
| `/we:size`, `/we:desel` | Show selection, clipboard, history and brushes / clear the selection |
| `/we:set <block>` | Fill the selection |
| `/we:replace <from> <to>` | Replace one block type in the selection |
| `/we:walls <block>`, `/we:outline <block>` | Four walls / hollow box |
| `/we:clear` | Fill the selection with air |
| `/we:copy`, `/we:cut`, `/we:paste [rot90\|rot180\|rot270] [x\|z\|xz]` | Clipboard, relative to where you stand, with rotation and mirroring |
| `/we:stack <count> [direction]` | Repeat the selection next to itself (bridges, walls, rows of houses) |
| `/we:sphere <block> <radius> [hollow]` | Sphere at your feet |
| `/we:cyl <block> <radius> [height] [hollow]` | Cylinder / tower at your feet |
| `/we:drain [radius]` | Remove water and lava around you |
| `/we:removetrees [radius]` | Remove logs, leaves, stems and vines (all wood types, including cherry, mangrove, pale oak and nether) |
| `/we:removeplants [radius]`, `/we:removesnow [radius]` | Remove grass and flowers / snow layers |
| `/we:removenear <block> [radius]`, `/we:replacenear <from> <to> [radius]` | Same, for any block |
| `/we:light [radius]` | Put invisible light blocks on the ground every 5 blocks (no more mobs or dark corners) |
| `/we:flatten [radius]` | Clear everything above your feet and fill holes in the floor |
| `/we:brush <block> [radius] [sphere\|paint\|erase\|overlay]` | Turn the **item in your hand** into a long-range brush (right-click to use) |
| `/we:unbrush` | Remove the brush from the held item |
| `/we:undo`, `/we:redo` | Last 15 edits per player, including cut, paste, brushes and terrain tools |
| `/we:limit <blocks>` | Safety limit per edit (default 500,000, max 5,000,000) |
| `/we:menu`, `/we:help` | Menu / command list |

**Brush modes:**
- **sphere** fills a ball.
- **paint** only recolours existing blocks, which is good for paths and patterns.
- **erase** carves holes.
- **overlay** puts a layer on top of the ground, for example `snow_layer` or `short_grass`.

### Improvements over v2.1

| v2.1 (BONY162) | v3 |
|---|---|
| Ran a function on every player **every tick**, even when unused | Nothing runs until you use it |
| Overrode `player.json` (breaks other add-ons and new player features) | Doesn't touch any vanilla file |
| Triggered by **dropping** specially-named items, so anyone could do it | Operator-only commands, wand and menus |
| Fixed sizes (20×20, 50×50, 3×3×3 brush, ...) | Any selection size, radius and block |
| No undo | 15-step undo/redo per player |
| Old `/execute` and data values, removed in 1.19.50–1.19.80 | Current Script API. Block names are checked as you type |
| No copy/paste, shapes or replace | Copy/cut/paste with rotate and mirror, stack, spheres, cylinders, walls, outline, replace, 4 brush modes |
| Big edits froze the game | Edits are spread over several ticks, and you get a "blocks changed / time" report |

**Limits:**
- Copy, paste and stack are limited to 64 × 384 × 64 blocks. That's the largest structure Bedrock supports.
- The area you edit must be loaded, so stand reasonably close.
- Undo history is kept in memory and is cleared when the world closes. Your selection and brushes are saved.

### If `/we:` commands don't show up
Check that cheats are on and that you are an Operator. As a last resort, these plain-command versions work even if scripts are disabled. Each one acts on a 31×31×31 area around you:
`/function we/drain`, `we/remove_trees`, `we/remove_plants`, `we/remove_snow`, `we/clear_above`, `we/light`, `we/help`.

---

## Craftable Portals v2

Craft at a crafting table. The recipes unlock in the recipe book as soon as you pick up the first ingredient.

| Result | Recipe |
|---|---|
| **End Portal Frame** | 8 Ender Pearls around 1 End Stone |
| **Nether Portal Kit** | 8 Obsidian around 1 Flint and Steel |
| **End Portal Kit** | 8 Eyes of Ender around 1 Lava Bucket |

**Using a kit:** right-click the ground with it, or use it in the air while looking at the ground in front of you.
- **Nether Portal Kit** builds a standard obsidian frame with a lit 2×3 portal, facing you.
- **End Portal Kit** builds a 3×3 End portal with all 12 frames filled with eyes. Jump in to go to the End.
- Kits only build into **empty space** (air, grass, snow), so they can't break anything. If something is in the way, you're told what and where, and an angry-villager particle marks the spot.
- One kit is used per portal. Creative mode doesn't use any.

**Why kits instead of crafting portal blocks?** Portal blocks are *not items* in Bedrock. The old pack's `portal`, `end_portal` and `end_gateway` recipes could never produce anything. End gateways were left out because they aren't in Mojang's 26.30 block data, so they can't be placed reliably.

---

## X-Ray v2

Makes natural terrain invisible, so you can see caves, ores, chests, spawners, ancient debris and mob farms through it. Blocks are still solid, so you can't walk through them.

**Not enabled in the world on purpose:** resource packs apply to everyone in a world, and it would spoil a dungeon map. To use it:
1. Open `addons/XRay_v2.mcaddon`.
2. Either activate **X-Ray v2** under **Settings → Global Resources**, which affects only you, or turn it on in a world's resource packs.
3. Click the ⚙ on the pack to choose a mode:
   - **All terrain:** 49 blocks from the Overworld, Nether and End.
   - **Underground only:** stone, deepslate, tuff, granite, diorite, andesite, calcite, dripstone, dirt, gravel, clay, bedrock and the like. The surface looks normal.
   - **Nether only:** netherrack, basalt, blackstone, soul sand/soil, nylium and magma.
4. Caves are dark, so run **`/xray:nightvision`** to toggle permanent night vision without particles. It comes back after milk or death. Without scripts, use `/function xray/nightvision_on` and `xray/nightvision_off`. These need the X-Ray v2 behavior pack active in the world.

**Improvements over X-RayByd6b:**
- No custom shaders or materials, which RenderDragon ignores. It uses only `blocks.json`.
- It is 13 KB instead of several MB, because it reuses the game's own textures instead of 230 copied ore images.
- Footstep sounds and textures stay correct.
- It covers 1.17–1.21 blocks: deepslate, tuff, calcite, dripstone, mud, moss, pale moss, suspicious sand and gravel.

> ⚠️ `"blockshape": "invisible"` is a legacy option. It works in Bedrock 26.30, which Education 26.32 is based on, but there are reports that it stopped working in newer Bedrock previews (26.60). If terrain still looks solid, your version no longer supports this method. No other resource-pack X-Ray method works on the current renderer.

---

## For developers

```
packs/
  world_edit_bp/          scripts/{main,core,ui,shapes,blocks}.js, functions/we/ (generated)
  craftable_portals_bp/   scripts/main.js, items/, recipes/
  craftable_portals_rp/   item icons
  xray_rp/                subpacks/{all,underground,nether}/blocks.json (generated)
  xray_bp/                scripts/main.js, functions/xray/
tools/build_packs.py      generates icons, subpacks and fallback functions; writes addons/*
tools/data/xray_vanilla_blocks.json   vanilla 26.30 blocks.json entries used by X-Ray
tests/shapes.test.mjs     geometry tests (node --test tests/shapes.test.mjs)
```

- **Script API versions:** `@minecraft/server` 2.1.0 and `@minecraft/server-ui` 2.0.0, both stable with no beta APIs. `min_engine_version` is 1.21.100.
- **Checks:** `npm install && npm run check && npm test`.
- **Data source:** block, item and command names come from Mojang's `bedrock-samples` v1.26.30.5.
