#!/usr/bin/env python3
"""Repair the "Minecraft Dungeons" Bedrock map so it imports and runs in
Minecraft Education 26.32 (Bedrock engine 1.26.3x).

Usage:
    python3 tools/fix_world.py [input.zip] [output.mcworld]

Defaults: mcdungeons_mcb.zip  ->  MinecraftDungeons_Edu26.32.mcworld

Only the Python 3 standard library is needed.  The script is deterministic:
running it again on the original archive produces the same .mcworld.

See FIXES.md for an explanation of every change.
"""
import io
import json
import os
import shutil
import struct
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import leveldb  # noqa: E402
import nbt  # noqa: E402

RP_UUID = "ea6a53c7-e433-4033-84f7-ac6af1cfff4c"
RP_MODULE_UUID = "f078f5a5-926d-4198-aa6f-12edddb16e01"
BP_UUID = "222d13cd-e419-4dff-bfa1-ea050b58d114"
BP_MODULE_UUID = "60ec858c-c1a1-4b27-82c9-f6935d2ba3fb"
PACK_VERSION = [1, 0, 0]          # bumped from 0.0.1 so stale cached copies are not reused
MIN_ENGINE = [1, 21, 0]
PACK_NAME = "\u00a7bmc dungeons sounds"
PACK_DESC = "mc dungeons sounds v1.0 by pilot raptor 64"

# Packs that ship inside the world folder but are NOT enabled for the world
# and cannot load on a current engine (see FIXES.md).
UNUSED_PACKS = [
    "behavior_packs/World Edit BP V2.1 BY BONY162.mcpack.zip",
    "behavior_packs/craftable_portals_tiny_addons_behaviourpack",
    "resource_packs/X-RayByd6b",
]
# Leftovers from the "Addons Maker" app template.  Nothing in the world uses
# them, and the .material files rely on the old renderer that was removed.
RP_JUNK = ["animation_controllers", "materials", "models", "render_controllers",
           "textures", "texts"]
BP_JUNK = [".data"]

# Exact command rewrites (old -> new).  Command blocks keep their stored
# command version, so everything else keeps its original behaviour.
COMMAND_FIXES = {
    # `fence` + data value 5 no longer exists: the fence block was split per
    # wood type in 1.19.80 and numeric block data was dropped in 1.19.70.
    "/fill 246 -49 -415 246 -48 -415 fence 5":
        "/fill 246 -49 -415 246 -48 -415 dark_oak_fence",
    # stray space between the selector and its arguments
    "/playsound random.levelup @p [r=100]":
        "/playsound random.levelup @p[r=100]",
}

# Entities frozen in unloaded chunks after the tower boss fight.
STRAY_ENTITIES = {
    "minecraft:wither_skull",            # 1760 projectiles
    "minecraft:wither_skull_dangerous",  # 876 projectiles
    "minecraft:vex",                     # 11 evoker vexes scattered around the map
    "minecraft:elder_guardian_ghost",    # 2 curse-effect entities at Y=781
}


def log(msg):
    print(msg, flush=True)


# --------------------------------------------------------------------------
def find_world_root(base):
    for dirpath, dirnames, filenames in os.walk(base):
        if "level.dat" in filenames and "db" in dirnames:
            return dirpath
    raise SystemExit("level.dat not found in the archive")


def write_json(path, obj):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def fix_packs(root):
    for rel in UNUSED_PACKS:
        p = os.path.join(root, rel)
        if os.path.isdir(p):
            shutil.rmtree(p)
            log("  removed unused pack folder  " + rel)
        elif os.path.exists(p):
            os.remove(p)
            log("  removed unused pack archive " + rel)

    rp = os.path.join(root, "resource_packs", "mcdungeons")
    bp = os.path.join(root, "behavior_packs", "mcdungeons")
    for d, junk in ((rp, RP_JUNK), (bp, BP_JUNK)):
        for j in junk:
            p = os.path.join(d, j)
            if os.path.isdir(p):
                shutil.rmtree(p)
            elif os.path.exists(p):
                os.remove(p)
    log("  stripped unused template files from the mc dungeons packs")

    write_json(os.path.join(rp, "manifest.json"), {
        "format_version": 2,
        "header": {
            "name": PACK_NAME, "description": PACK_DESC, "uuid": RP_UUID,
            "version": PACK_VERSION, "min_engine_version": MIN_ENGINE,
        },
        "modules": [{
            "type": "resources", "description": PACK_DESC,
            "uuid": RP_MODULE_UUID, "version": PACK_VERSION,
        }],
    })
    write_json(os.path.join(bp, "manifest.json"), {
        "format_version": 2,
        "header": {
            "name": PACK_NAME, "description": PACK_DESC, "uuid": BP_UUID,
            "version": PACK_VERSION, "min_engine_version": MIN_ENGINE,
        },
        "modules": [{
            "type": "data", "description": PACK_DESC,
            "uuid": BP_MODULE_UUID, "version": PACK_VERSION,
        }],
        "dependencies": [{"uuid": RP_UUID, "version": PACK_VERSION}],
    })
    log("  upgraded both pack manifests to format_version 2 (v%s)" %
        ".".join(map(str, PACK_VERSION)))

    write_json(os.path.join(root, "world_resource_packs.json"),
               [{"pack_id": RP_UUID, "version": PACK_VERSION}])
    write_json(os.path.join(root, "world_behavior_packs.json"),
               [{"pack_id": BP_UUID, "version": PACK_VERSION}])
    hist = lambda u: {"packs": [{"can_be_redownloaded": False, "name": PACK_NAME,  # noqa: E731
                                 "uuid": u, "version": PACK_VERSION}]}
    write_json(os.path.join(root, "world_resource_pack_history.json"), hist(RP_UUID))
    write_json(os.path.join(root, "world_behavior_pack_history.json"), hist(BP_UUID))
    log("  updated world pack lists / history")


def fix_level_dat(root):
    path = os.path.join(root, "level.dat")
    data = open(path, "rb").read()
    storage_version, length = struct.unpack("<ii", data[:8])
    name, tag = nbt.read_root(io.BytesIO(data[8:8 + length]))
    lv = tag.v
    layers = lv["FlatWorldLayers"].v
    # minecraft:grass was renamed to minecraft:grass_block (1.20.60).  This is
    # a flat world, so every newly generated chunk uses these layers.
    new_layers = layers.replace('"minecraft:grass"', '"minecraft:grass_block"')
    if new_layers != layers:
        lv["FlatWorldLayers"] = nbt.T(nbt.TAG_STRING, new_layers)
        log("  level.dat: flat-world layer minecraft:grass -> minecraft:grass_block")
    out = io.BytesIO()
    nbt.write_root(out, name, tag)
    body = out.getvalue()
    with open(path, "wb") as f:
        f.write(struct.pack("<ii", storage_version, len(body)) + body)
    # level.dat_old is only a backup of the previous save; keep it consistent
    shutil.copyfile(path, os.path.join(root, "level.dat_old"))


def _fix_commands(tag, counter):
    """Recursively rewrite Command strings inside an NBT tree."""
    changed = False
    if tag.t == nbt.TAG_COMPOUND:
        cmd = tag.v.get("Command")
        if cmd is not None and cmd.t == nbt.TAG_STRING and cmd.v in COMMAND_FIXES:
            tag.v["Command"] = nbt.T(nbt.TAG_STRING, COMMAND_FIXES[cmd.v])
            counter.append(cmd.v)
            changed = True
        for x in tag.v.values():
            changed |= _fix_commands(x, counter)
    elif tag.t == nbt.TAG_LIST:
        et, items = tag.v
        if et in (nbt.TAG_COMPOUND, nbt.TAG_LIST):
            for it in items:
                changed |= _fix_commands(nbt.T(et, it), counter)
    return changed


def _encode(roots):
    out = io.BytesIO()
    for name, r in roots:
        nbt.write_root(out, name, r)
    return out.getvalue()


def fix_db(root):
    world = leveldb.World(os.path.join(root, "db"))
    log("  db: %d keys, last sequence %d" % (len(world.data), world.max_seq))
    ops = []
    fixed_cmds = []
    removed = {}
    for key in sorted(world.data):
        value = world.data[key]
        is_chunk = len(key) in (9, 13)
        tag = key[-1] if is_chunk else None
        if (is_chunk and tag == 49) or key.startswith(b"structuretemplate_"):
            roots = nbt.read_all(value)
            results = [_fix_commands(r, fixed_cmds) for _, r in roots]  # no short-circuit
            if any(results):
                ops.append((key, _encode(roots)))
        elif is_chunk and tag == 50:  # legacy per-chunk entity list
            roots = nbt.read_all(value)
            keep = []
            for name, r in roots:
                ident = r.v.get("identifier")
                ident = ident.v if ident is not None else ""
                if ident in STRAY_ENTITIES:
                    removed[ident] = removed.get(ident, 0) + 1
                else:
                    keep.append((name, r))
            if len(keep) != len(roots):
                ops.append((key, _encode(keep) if keep else None))
    for c in sorted(set(fixed_cmds)):
        log("  command fixed x%d: %s  ->  %s" % (fixed_cmds.count(c), c, COMMAND_FIXES[c]))
    for ident in sorted(removed):
        log("  removed %5d stray %s" % (removed[ident], ident))
    if ops:
        n = world.append(ops)
        log("  db: wrote %d changed records (%d batches) to the LevelDB log" % (len(ops), n))
    return ops


def write_mcworld(root, out_path):
    entries = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            entries.append((os.path.relpath(full, root).replace(os.sep, "/"), full))
    tmp = out_path + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel, full in entries:
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(full, "rb") as f:
                z.writestr(info, f.read())
    os.replace(tmp, out_path)
    log("wrote %s (%d files, level.dat at archive root)" % (out_path, len(entries)))


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "mcdungeons_mcb.zip")
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "MinecraftDungeons_Edu26.32.mcworld")
    work = tempfile.mkdtemp(prefix="mcworld_fix_")
    try:
        with zipfile.ZipFile(src) as z:
            z.extractall(work)
        root = find_world_root(work)
        log("world folder inside archive: %s" % os.path.relpath(root, work))
        log("[1/3] packs")
        fix_packs(root)
        log("[2/3] level.dat")
        fix_level_dat(root)
        log("[3/3] world database")
        fix_db(root)
        write_mcworld(root, dst)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
