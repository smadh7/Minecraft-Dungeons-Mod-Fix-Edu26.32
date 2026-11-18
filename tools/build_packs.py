#!/usr/bin/env python3
"""Build the remade add-ons (World Edit v3, Craftable Portals v2, X-Ray v2).

    python3 tools/build_packs.py

1. Generates the files that are derived from data rather than hand-written:
     packs/world_edit_bp/functions/we/*.mcfunction   (no-script fallback tools)
     packs/xray_rp/subpacks/*/blocks.json            (X-Ray modes)
     packs/*/pack_icon.png, portal kit item icons    (drawn procedurally)
2. Zips each add-on into addons/ (deterministic: same input -> same bytes).

tools/fix_world.py then copies World Edit + Craftable Portals into the world.
"""
import io
import json
import os
import re
import struct
import zipfile
import zlib

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(HERE, "packs")
ADDONS = os.path.join(HERE, "addons")
DATA = os.path.join(HERE, "tools", "data")

# which packs go into which download
BUNDLES = {
    "WorldEdit_v3.mcpack": ["world_edit_bp"],
    "CraftablePortals_v2.mcaddon": ["craftable_portals_bp", "craftable_portals_rp"],
    "XRay_v2.mcaddon": ["xray_rp", "xray_bp"],
}


def log(msg):
    print(msg, flush=True)


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if isinstance(data, str):
        data = data.encode("utf-8")
    with open(path, "wb") as f:
        f.write(data)


def write_json(path, obj):
    write(path, json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------
# tiny PNG writer (no Pillow needed)

def png(pixels):
    """pixels: list of rows of (r, g, b, a) tuples."""
    h, w = len(pixels), len(pixels[0])
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in pixels)

    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _noise(x, y, seed):
    """Deterministic 0..1 hash noise."""
    n = (x * 374761393 + y * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 0xFFFF


def _shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c[:3]) + (c[3] if len(c) > 3 else 255,)


def icon_portal(size, frame, inner, swirl, seed, frame_px=None):
    """A framed portal: frame colour around a swirly interior."""
    t = frame_px or max(2, size // 8)
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            edge = x < t or y < t or x >= size - t or y >= size - t
            n = _noise(x, y, seed)
            if edge:
                row.append(_shade(frame, 0.75 + 0.5 * n))
            else:
                cx, cy = (x - size / 2 + 0.5) / size, (y - size / 2 + 0.5) / size
                ring = (abs((cx * cx + cy * cy) ** 0.5 * 9 + (cx - cy) * 3) % 1.0)
                c = swirl if ring < 0.35 or n > 0.93 else inner
                row.append(_shade(c, 0.8 + 0.4 * n))
        rows.append(row)
    return rows


def icon_wand(size):
    """Diagonal wand with a sparkle: World Edit pack icon."""
    bg, stick, tip = (36, 18, 52), (150, 104, 60), (230, 120, 255)
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            d = abs((x + y) - (size - 1))
            n = _noise(x, y, 7)
            if d <= size // 16 and x < size * 0.7:
                row.append(_shade(stick, 0.85 + 0.3 * n))
            elif (x - size * 0.75) ** 2 + (y - size * 0.25) ** 2 < (size * 0.12) ** 2:
                row.append(_shade(tip, 0.9 + 0.2 * n))
            elif n > 0.985:
                row.append((255, 255, 255, 255))
            else:
                row.append(_shade(bg, 0.85 + 0.3 * n))
        rows.append(row)
    return rows


def icon_xray(size):
    """Ores floating in an invisible block outline."""
    ores = [(93, 236, 245), (240, 214, 60), (220, 40, 40), (60, 200, 80), (40, 90, 220)]
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            n = _noise(x, y, 11)
            edge = x in (0, size - 1) or y in (0, size - 1)
            blob = int(_noise(x // (size // 8), y // (size // 8), 3) * 10)
            if edge:
                row.append((200, 200, 200, 255))
            elif blob < len(ores) and n > 0.35:
                row.append(_shade(ores[blob], 0.8 + 0.4 * n))
            else:
                row.append((20, 20, 26, 255))
        rows.append(row)
    return rows


OBSIDIAN, NETHER_IN, NETHER_SWIRL = (30, 18, 46), (122, 40, 196), (196, 120, 255)
END_FRAME, END_IN, END_SWIRL = (190, 196, 140), (8, 14, 22), (40, 130, 120)


def make_icons():
    write(os.path.join(PACKS, "craftable_portals_rp/textures/items/portals_nether_kit.png"),
          png(icon_portal(16, OBSIDIAN, NETHER_IN, NETHER_SWIRL, 1)))
    write(os.path.join(PACKS, "craftable_portals_rp/textures/items/portals_end_kit.png"),
          png(icon_portal(16, END_FRAME, END_IN, END_SWIRL, 2)))
    for pack, img in (("world_edit_bp", icon_wand(64)),
                      ("craftable_portals_bp", icon_portal(64, OBSIDIAN, NETHER_IN, NETHER_SWIRL, 3)),
                      ("craftable_portals_rp", icon_portal(64, OBSIDIAN, NETHER_IN, NETHER_SWIRL, 3)),
                      ("xray_rp", icon_xray(64)), ("xray_bp", icon_xray(64))):
        write(os.path.join(PACKS, pack, "pack_icon.png"), png(img))
    log("  icons: 2 item icons, 5 pack icons")


# --------------------------------------------------------------------------
# X-Ray subpacks

def make_xray():
    src = json.load(open(os.path.join(DATA, "xray_vanilla_blocks.json")))
    groups, blocks = src["groups"], src["blocks"]
    modes = {
        "all": groups["underground"] + groups["surface"] + groups["nether"] + groups["end"],
        "underground": groups["underground"],
        "nether": groups["nether"],
    }
    for mode, keys in modes.items():
        out = {"format_version": "1.21.40"}
        for k in keys:
            # keep the vanilla textures + sounds (footsteps still sound right), only hide the shape
            out[k] = dict(blocks[k], blockshape="invisible")
        write_json(os.path.join(PACKS, "xray_rp", "subpacks", mode, "blocks.json"), out)
    log("  x-ray: subpacks " + ", ".join("%s (%d blocks)" % (m, len(k)) for m, k in modes.items()))


# --------------------------------------------------------------------------
# World Edit no-script fallback functions

def js_list(name):
    text = open(os.path.join(PACKS, "world_edit_bp/scripts/blocks.js")).read()
    m = re.search(r"export const %s = \[(.*?)\];" % name, text, re.S)
    return re.findall(r'"minecraft:([a-z0-9_]+)"', m.group(1))


R = 15  # 31 x 31 x 31 = 29,791 blocks: just under the /fill limit of 32,768
AREA = "~-%d ~-%d ~-%d ~%d ~%d ~%d" % (R, R, R, R, R, R)


def _remove(title, blocks):
    lines = ["# World Edit v3 fallback: %s within %d blocks (no scripts needed)" % (title, R)]
    lines += ["fill %s air replace %s" % (AREA, b) for b in blocks]
    lines.append('tellraw @s {"rawtext":[{"text":"\u00a7a%s done (%d block radius)."}]}' % (title, R))
    return "\n".join(lines) + "\n"


def make_functions():
    fdir = os.path.join(PACKS, "world_edit_bp", "functions", "we")
    funcs = {
        "drain": _remove("Drain water & lava", js_list("LIQUID_BLOCKS")),
        "remove_trees": _remove("Remove trees", js_list("TREE_BLOCKS")),
        "remove_plants": _remove("Remove grass & flowers", js_list("PLANT_BLOCKS")),
        "remove_snow": _remove("Remove snow", js_list("SNOW_BLOCKS")),
        "clear_above": "# World Edit v3 fallback: clear a 31x31x31 space starting at your feet\n"
                       "fill ~-15 ~ ~-15 ~15 ~30 ~15 air\n"
                       'tellraw @s {"rawtext":[{"text":"\u00a7aCleared 31x31x31 above you."}]}\n',
        "light": "# World Edit v3 fallback: invisible light blocks in the air layer you stand in\n"
                 "fill ~-15 ~ ~-15 ~15 ~ ~15 light_block_15 replace air\n"
                 'tellraw @s {"rawtext":[{"text":"\u00a7aLit up 31x31 around you."}]}\n',
        "help": "# World Edit v3: help\n" + "".join(
            'tellraw @s {"rawtext":[{"text":"%s"}]}\n' % t for t in [
                "\u00a7d=== World Edit v3 ===",
                "\u00a7fType \u00a7e/we:help\u00a7f for the full command list, or \u00a7e/we:wand\u00a7f for the selection wand.",
                "\u00a7fIf /we: commands don't appear, scripts are off; these still work:",
                "\u00a7e/function we/drain  we/remove_trees  we/remove_plants  we/remove_snow  we/clear_above  we/light",
            ]),
    }
    if os.path.isdir(fdir):
        for fn in os.listdir(fdir):
            os.remove(os.path.join(fdir, fn))
    for name, body in funcs.items():
        write(os.path.join(fdir, name + ".mcfunction"), body)
    log("  world edit: %d fallback functions" % len(funcs))


# --------------------------------------------------------------------------
# validation + packaging

def validate():
    uuids = {}
    for pack in sorted(os.listdir(PACKS)):
        m = json.load(open(os.path.join(PACKS, pack, "manifest.json")))
        for u in [m["header"]["uuid"]] + [x["uuid"] for x in m["modules"]]:
            assert u not in uuids, "duplicate uuid %s in %s and %s" % (u, pack, uuids[u])
            uuids[u] = pack
        for d in m.get("dependencies", []):
            if "uuid" in d:
                assert d["uuid"] in uuids or any(
                    json.load(open(os.path.join(PACKS, p, "manifest.json")))["header"]["uuid"] == d["uuid"]
                    for p in os.listdir(PACKS)), "%s depends on unknown pack %s" % (pack, d["uuid"])
        for dirpath, _, files in os.walk(os.path.join(PACKS, pack)):
            for fn in files:
                if fn.endswith(".json"):
                    json.load(open(os.path.join(dirpath, fn)))  # raises on bad JSON
    log("  validated %d manifests, %d unique uuids, all JSON parses" % (len(os.listdir(PACKS)), len(uuids)))


def pack_files(pack):
    root = os.path.join(PACKS, pack)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            yield os.path.relpath(full, root).replace(os.sep, "/"), full


def zip_bytes(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel, full in entries:
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(full, "rb") as f:
                z.writestr(info, f.read())
    return buf.getvalue()


def package():
    os.makedirs(ADDONS, exist_ok=True)
    for name, packs in BUNDLES.items():
        if len(packs) == 1:
            data = zip_bytes(pack_files(packs[0]))
        else:  # .mcaddon = one folder per pack
            data = zip_bytes((pack + "/" + rel, full) for pack in packs for rel, full in pack_files(pack))
        write(os.path.join(ADDONS, name), data)
        log("  wrote addons/%s (%d KB)" % (name, (len(data) + 1023) // 1024))


def main():
    log("[1/3] generating files")
    make_icons()
    make_xray()
    make_functions()
    log("[2/3] validating")
    validate()
    log("[3/3] packaging")
    package()


if __name__ == "__main__":
    main()
