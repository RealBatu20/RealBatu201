gamerule sendcommandfeedback false
gamerule commandblocksenabled true
scoreboard objectives add lagfixer_tps dummy "LagFixer TPS"
scoreboard objectives add lagfixer_mspt dummy "LagFixer MSPT"
scoreboard objectives add lagfixer_entities dummy "LagFixer Entity Count"
scoreboard objectives setdisplay sidebar lagfixer_tps

tag @a add lagfixer_enabled
