# World Edit v3 fallback: Drain water & lava within 15 blocks (no scripts needed)
fill ~-15 ~-15 ~-15 ~15 ~15 ~15 air replace water
fill ~-15 ~-15 ~-15 ~15 ~15 ~15 air replace flowing_water
fill ~-15 ~-15 ~-15 ~15 ~15 ~15 air replace lava
fill ~-15 ~-15 ~-15 ~15 ~15 ~15 air replace flowing_lava
tellraw @s {"rawtext":[{"text":"§aDrain water & lava done (15 block radius)."}]}
