# LagFixer Bedrock - Initialization Function
# Run this function once on world load to set up performance tracking

scoreboard objectives add lagfixer_tps dummy "LagFixer TPS"
scoreboard objectives add lagfixer_entities dummy "LagFixer Entities"
scoreboard objectives add lagfixer_optimized dummy "LagFixer Optimized"

execute as @a run scoreboard players set @s lagfixer_tps 20
say [LagFixer] Performance monitoring initialized
