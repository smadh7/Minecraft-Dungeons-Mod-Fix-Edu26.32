# World Edit v3 fallback: Remove snow within 15 blocks (no scripts needed)
fill ~-15 ~-15 ~-15 ~15 ~15 ~15 air replace snow_layer
tellraw @s {"rawtext":[{"text":"§aRemove snow done (15 block radius)."}]}
