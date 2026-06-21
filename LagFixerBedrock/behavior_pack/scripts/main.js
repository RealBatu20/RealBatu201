// behavior_pack/scripts/main.js
import { world, system, EntityComponentTypes, DynamicPropertiesDefinition, PropertyRegistry, DimensionTypeRegistry, CustomCommandRegistry, ActionFormData } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";

const LAGFIXER_VERSION = "1.6.1-bedrock";
const CONFIG_DEFAULTS = {
    mobAiReducer: {
        enabled: true,
        reduceAIFrequency: 20,
        disableLookAround: true,
        disableRandomMovement: false,
        affectedMobs: ["cow", "pig", "sheep", "chicken", "zombie", "skeleton", "creeper"],
        spawnReasons: ["natural", "spawner", "breeding"]
    },
    entityLimiter: {
        enabled: true,
        maxEntitiesPerChunk: 50,
        maxMobsPerChunk: 30,
        maxItemsPerChunk: 20,
        overflowMultiplier: 1.5,
        checkInterval: 60
    },
    worldCleaner: {
        enabled: true,
        itemDespawnTime: 300,
        cleanupInterval: 100,
        removeNamedItems: false,
        cleanupProjectiles: true,
        alertsEnabled: false
    },
    explosionOptimizer: {
        enabled: true,
        maxExplosionsPerSecond: 5,
        limitChainReactions: true,
        reduceExplosionPower: false,
        preventTNTChains: true
    },
    lagShield: {
        enabled: true,
        tpsThreshold: 18,
        msptThreshold: 45,
        dynamicAdjustments: true
    },
    vehicleMotion: {
        enabled: false,
        optimizeBoats: true,
        optimizeMinecarts: true,
        removeChestMinecarts: false
    },
    abilityLimiter: {
        enabled: false,
        tridentCooldown: 20,
        elytraCooldown: 30,
        tridentDurabilityLoss: 1,
        elytraDurabilityLoss: 2
    }
};

let config = {};
let entityCounts = new Map();
let recentExplosions = [];
let performanceStats = {
    tps: 20,
    mspt: 50,
    entitiesRemoved: 0,
    aiOptimizations: 0,
    explosionsLimited: 0
};
let lastTick = Date.now();
let tickCount = 0;

function initializeConfig() {
    config = JSON.parse(JSON.stringify(CONFIG_DEFAULTS));
    const storedConfig = world.getDynamicProperty("lagfixer_config");
    if (storedConfig) {
        try {
            const parsed = JSON.parse(storedConfig);
            config = { ...config, ...parsed };
        } catch (e) {
            console.warn("Failed to parse stored config, using defaults");
        }
    }
}

function saveConfig() {
    world.setDynamicProperty("lagfixer_config", JSON.stringify(config));
}

function calculateTPS() {
    const now = Date.now();
    const elapsed = now - lastTick;
    lastTick = now;
    tickCount++;
    
    if (elapsed > 0) {
        const currentTPS = Math.min(20, 1000 / elapsed * 20 / 20);
        performanceStats.tps = Math.round(currentTPS * 100) / 100;
    }
    
    return performanceStats.tps;
}

function getEntityCounts(dimension) {
    const counts = {
        total: 0,
        mobs: 0,
        items: 0,
        projectiles: 0,
        vehicles: 0
    };
    
    try {
        for (const entity of dimension.getEntities()) {
            counts.total++;
            const typeId = entity.typeId;
            
            if (typeId.includes("item")) {
                counts.items++;
            } else if (typeId.includes("arrow") || typeId.includes("fireball") || typeId.includes("egg") || typeId.includes("snowball") || typeId.includes("potion")) {
                counts.projectiles++;
            } else if (typeId.includes("boat") || typeId.includes("minecart") || typeId.includes("chest_boat")) {
                counts.vehicles++;
            } else if (!typeId.includes("player") && !typeId.includes("item") && !typeId.includes("falling_block") && !typeId.includes("painting") && !typeId.includes("leash_knot") && !typeId.includes("armor_stand")) {
                counts.mobs++;
            }
        }
    } catch (e) {
        console.error("Error counting entities:", e);
    }
    
    return counts;
}

function optimizeMobAI(entity) {
    if (!config.mobAiReducer.enabled) return;
    
    try {
        const mobility = entity.getComponent(EntityComponentTypes.Mobility);
        if (mobility) {
            if (config.mobAiReducer.disableRandomMovement) {
                entity.setDynamicProperty("lagfixer_ai_reduced", true);
                performanceStats.aiOptimizations++;
            }
        }
        
        const navigation = entity.getComponent(EntityComponentTypes.Navigation);
        if (navigation && config.mobAiReducer.disableLookAround) {
            entity.setDynamicProperty("lagfixer_look_disabled", true);
        }
        
        entity.setDynamicProperty("lagfixer_last_optimized", system.currentTick);
    } catch (e) {
    }
}

function checkEntityLimits(dimension) {
    if (!config.entityLimiter.enabled) return;
    
    const counts = getEntityCounts(dimension);
    const chunks = new Map();
    
    try {
        for (const entity of dimension.getEntities()) {
            const loc = entity.location;
            const chunkKey = `${Math.floor(loc.x / 16)},${Math.floor(loc.z / 16)}`;
            
            if (!chunks.has(chunkKey)) {
                chunks.set(chunkKey, { mobs: 0, items: 0, total: 0 });
            }
            
            const chunkData = chunks.get(chunkKey);
            chunkData.total++;
            
            const typeId = entity.typeId;
            if (typeId.includes("item")) {
                chunkData.items++;
            } else if (!typeId.includes("player")) {
                chunkData.mobs++;
            }
        }
        
        for (const [chunkKey, data] of chunks) {
            if (data.mobs > config.entityLimiter.maxMobsPerChunk || data.items > config.entityLimiter.maxItemsPerChunk) {
                const [chunkX, chunkZ] = chunkKey.split(",").map(Number);
                const centerX = chunkX * 16 + 8;
                const centerZ = chunkZ * 16 + 8;
                
                const entitiesInChunk = dimension.getEntitiesAtBlockLocation({ x: centerX, y: 100, z: centerZ });
                
                let removed = 0;
                for (const entity of entitiesInChunk) {
                    if (entity.typeId.includes("player")) continue;
                    
                    if ((entity.typeId.includes("item") && data.items > config.entityLimiter.maxItemsPerChunk) ||
                        (!entity.typeId.includes("item") && data.mobs > config.entityLimiter.maxMobsPerChunk)) {
                        
                        const isNamed = entity.nameTag !== undefined && entity.nameTag !== "";
                        if (isNamed && !config.worldCleaner.removeNamedItems) continue;
                        
                        entity.kill();
                        removed++;
                        performanceStats.entitiesRemoved++;
                        
                        if (removed >= Math.floor((data.mobs - config.entityLimiter.maxMobsPerChunk) * 1.5)) break;
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error checking entity limits:", e);
    }
}

function cleanupOldItems(dimension) {
    if (!config.worldCleaner.enabled) return;
    
    try {
        const currentTime = system.currentTick;
        const despawnTicks = config.worldCleaner.itemDespawnTime;
        
        for (const entity of dimension.getEntities()) {
            if (entity.typeId.includes("item")) {
                const created = entity.getDynamicProperty("lagfixer_item_created");
                if (created === undefined) {
                    entity.setDynamicProperty("lagfixer_item_created", currentTime);
                } else if (currentTime - created > despawnTicks) {
                    const isNamed = entity.nameTag !== undefined && entity.nameTag !== "";
                    if (!isNamed || config.worldCleaner.removeNamedItems) {
                        entity.kill();
                        performanceStats.entitiesRemoved++;
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error cleaning up items:", e);
    }
}

function trackExplosion(location) {
    if (!config.explosionOptimizer.enabled) return true;
    
    const currentTime = Date.now();
    recentExplosions = recentExplosions.filter(t => currentTime - t < 1000);
    
    if (recentExplosions.length >= config.explosionOptimizer.maxExplosionsPerSecond) {
        performanceStats.explosionsLimited++;
        return false;
    }
    
    recentExplosions.push(currentTime);
    return true;
}

function showPerformanceMonitorUI(player) {
    const counts = getEntityCounts(player.dimension);
    const form = new ActionFormData();
    
    form.title("§6§lLagFixer Monitor");
    form.body(`§eVersion: §f${LAGFIXER_VERSION}\n\n` +
              `§aTPS: §f${performanceStats.tps.toFixed(2)}\n` +
              `§bEntities: §f${counts.total} (Mobs: ${counts.mobs}, Items: ${counts.items})\n` +
              `§dAI Optimizations: §f${performanceStats.aiOptimizations}\n` +
              `§cEntities Removed: §f${performanceStats.entitiesRemoved}\n` +
              `§eExplosions Limited: §f${performanceStats.explosionsLimited}\n\n` +
              `§7Modules Active:\n` +
              `§8- §fMob AI Reducer: ${config.mobAiReducer.enabled ? "§aON" : "§cOFF"}\n` +
              `§8- §fEntity Limiter: ${config.entityLimiter.enabled ? "§aON" : "§cOFF"}\n` +
              `§8- §fWorld Cleaner: ${config.worldCleaner.enabled ? "§aON" : "§cOFF"}\n` +
              `§8- §fExplosion Optimizer: ${config.explosionOptimizer.enabled ? "§aON" : "§cOFF"}\n` +
              `§8- §fLag Shield: ${config.lagShield.enabled ? "§aON" : "§cOFF"}`);
    
    form.button("§aConfigure Modules");
    form.button("§bReset Statistics");
    form.button("§cClose");
    
    form.show(player).then(response => {
        if (response.selection === 0) {
            showConfigMenu(player);
        } else if (response.selection === 1) {
            performanceStats = { tps: 20, mspt: 50, entitiesRemoved: 0, aiOptimizations: 0, explosionsLimited: 0 };
            player.sendMessage("§a[ LagFixer ] Statistics reset!");
        }
    });
}

function showConfigMenu(player) {
    const form = new ModalFormData();
    
    form.title("§6§lLagFixer Configuration");
    
    form.toggle("Mob AI Reducer", config.mobAiReducer.enabled);
    form.toggle("Entity Limiter", config.entityLimiter.enabled);
    form.toggle("World Cleaner", config.worldCleaner.enabled);
    form.toggle("Explosion Optimizer", config.explosionOptimizer.enabled);
    form.toggle("Lag Shield", config.lagShield.enabled);
    form.slider("Max Entities Per Chunk", 10, 200, 10, config.entityLimiter.maxEntitiesPerChunk);
    form.slider("Item Despawn Time (ticks)", 60, 1200, 60, config.worldCleaner.itemDespawnTime);
    
    form.show(player).then(response => {
        if (response.canceled) return;
        
        config.mobAiReducer.enabled = response.formValues[0];
        config.entityLimiter.enabled = response.formValues[1];
        config.worldCleaner.enabled = response.formValues[2];
        config.explosionOptimizer.enabled = response.formValues[3];
        config.lagShield.enabled = response.formValues[4];
        config.entityLimiter.maxEntitiesPerChunk = response.formValues[5];
        config.worldCleaner.itemDespawnTime = response.formValues[6];
        
        saveConfig();
        player.sendMessage("§a[ LagFixer ] Configuration saved!");
    });
}

system.beforeEvents.startup.subscribe(() => {
    try {
        CustomCommandRegistry.registerCommand("lagfixer");
        console.log(`[LagFixer] Registered lagfixer: command`);
    } catch (e) {
        console.warn("[LagFixer] Command registration may require reload");
    }
    
    initializeConfig();
    console.log(`[LagFixer] v${LAGFIXER_VERSION} initialized`);
});

world.afterEvents.command.subscribe(event => {
    const command = event.command.toLowerCase();
    
    if (command === "lagfixer" || command.startsWith("lagfixer ")) {
        event.cancel = true;
        
        if (event.sender.typeId === "minecraft:player") {
            const player = event.sender;
            
            if (command === "lagfixer") {
                showPerformanceMonitorUI(player);
            } else if (command === "lagfixer reload") {
                initializeConfig();
                player.sendMessage("§a[ LagFixer ] Configuration reloaded!");
            } else if (command === "lagfixer stats") {
                const counts = getEntityCounts(player.dimension);
                player.sendMessage(`§6=== LagFixer Statistics ===`);
                player.sendMessage(`§eTPS: §f${performanceStats.tps.toFixed(2)}`);
                player.sendMessage(`§bTotal Entities: §f${counts.total}`);
                player.sendMessage(`§dAI Optimizations: §f${performanceStats.aiOptimizations}`);
                player.sendMessage(`§cEntities Removed: §f${performanceStats.entitiesRemoved}`);
            } else if (command === "lagfixer config") {
                showConfigMenu(player);
            } else {
                player.sendMessage(`§6=== LagFixer Commands ===`);
                player.sendMessage(`§e/lagfixer §7- Open monitor UI`);
                player.sendMessage(`§e/lagfixer config §7- Configure modules`);
                player.sendMessage(`§e/lagfixer stats §7- Show statistics`);
                player.sendMessage(`§e/lagfixer reload §7- Reload configuration`);
            }
        }
    }
});

world.afterEvents.entitySpawn.subscribe(event => {
    const entity = event.entity;
    
    if (entity.typeId.includes("player")) return;
    
    if (config.mobAiReducer.enabled && config.mobAiReducer.affectedMobs.some(mob => entity.typeId.includes(mob))) {
        system.runTimeout(() => {
            if (entity.isValid()) {
                optimizeMobAI(entity);
            }
        }, 5);
    }
    
    if (entity.typeId.includes("item")) {
        entity.setDynamicProperty("lagfixer_item_created", system.currentTick);
    }
});

world.afterEvents.explosion.subscribe(event => {
    if (!trackExplosion(event.source?.location ?? event.location)) {
        event.cancel = true;
    }
});

system.runInterval(() => {
    calculateTPS();
    
    const dimensions = [world.overworld, world.nether, world.theEnd];
    
    for (const dimension of dimensions) {
        if (config.entityLimiter.enabled) {
            checkEntityLimits(dimension);
        }
        
        if (config.worldCleaner.enabled) {
            cleanupOldItems(dimension);
        }
    }
    
    if (config.lagShield.enabled && performanceStats.tps < config.lagShield.tpsThreshold) {
        console.warn(`[LagShield] Low TPS detected: ${performanceStats.tps}`);
    }
    
    if (tickCount % 600 === 0) {
        const totalMobs = 0;
        const totalItems = 0;
        for (const dimension of dimensions) {
            const counts = getEntityCounts(dimension);
            totalMobs += counts.mobs;
            totalItems += counts.items;
        }
        console.log(`[LagFixer] World Stats - Mobs: ${totalMobs}, Items: ${totalItems}, TPS: ${performanceStats.tps}`);
    }
}, 20);

system.runInterval(() => {
    for (const player of world.getPlayers()) {
        const hasReducedAI = player.getDynamicProperty("lagfixer_ai_reduced");
        if (hasReducedAI) {
            player.setDynamicProperty("lagfixer_ai_reduced", undefined);
        }
    }
}, 100);

console.log("[LagFixer] Script loaded successfully");
