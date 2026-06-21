// behavior_pack/scripts/main.js
import { world, system, EntityComponentTypes, DynamicProperties } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const CONFIG = {
  mobAiReducer: {
    enabled: true,
    reducePathfinding: true,
    disableLookAround: true
  },
  entityLimiter: {
    enabled: true,
    maxEntitiesPerChunk: 50,
    maxMobsPerChunk: 30,
    maxItemsPerChunk: 20
  },
  itemsCleaner: {
    enabled: true,
    despawnTime: 300,
    checkInterval: 20
  },
  lagShield: {
    enabled: true,
    tpsThreshold: 18,
    msptThreshold: 50
  },
  vehicleMotion: {
    enabled: true,
    removeChestMinecarts: true
  },
  abilityLimiter: {
    enabled: true,
    tridentCooldown: 20,
    elytraBoostCooldown: 10
  }
};

const performanceData = {
  tps: 20,
  mspt: 50,
  entityCount: 0,
  chunkCount: 0,
  lastTick: Date.now()
};

function registerCustomCommands(event) {
  try {
    event.customCommandRegistry.registerCommand({
      name: "lagfixer:status",
      description: "Display current server performance metrics",
      permissions: ["host"],
      callback: (source, args) => {
        const player = source.getEntity();
        if (!player) return;
        
        const form = new ActionFormData()
          .title("§6LagFixer Status")
          .body(`§eTPS: §f${performanceData.tps.toFixed(1)}\n§eMSPT: §f${performanceData.mspt.toFixed(1)}ms\n§eEntities: §f${performanceData.entityCount}\n§eChunks: §f${performanceData.chunkCount}`)
          .button("Close");
        
        form.show(player).then(() => {});
      }
    });
  } catch (e) {}

  try {
    event.customCommandRegistry.registerCommand({
      name: "lagfixer:clean",
      description: "Remove all dropped items in loaded chunks",
      permissions: ["host"],
      callback: (source, args) => {
        const dimension = source.getDimension();
        let removed = 0;
        
        for (const entity of dimension.getEntities()) {
          if (entity.typeId === "minecraft:item") {
            entity.remove();
            removed++;
          }
        }
        
        const player = source.getEntity();
        if (player && player.isValid()) {
          player.runCommandAsync(`tellraw @s {"rawtext":[{"text":"§aRemoved ${removed} items"}]}`);
        }
      }
    });
  } catch (e) {}

  try {
    event.customCommandRegistry.registerCommand({
      name: "lagfixer:config",
      description: "Open LagFixer configuration menu",
      permissions: ["host"],
      callback: (source, args) => {
        const player = source.getEntity();
        if (!player || !player.isValid()) return;
        
        const form = new ActionFormData()
          .title("§6LagFixer Configuration")
          .button("§bMob AI Reducer", () => {})
          .button("§cEntity Limiter", () => {})
          .button("§aItems Cleaner", () => {})
          .button("§eLag Shield", () => {})
          .button("§dVehicle Motion", () => {})
          .button("§9Ability Limiter", () => {});
        
        form.show(player).then(() => {});
      }
    });
  } catch (e) {}
}

function setupMobAiReducer() {
  if (!CONFIG.mobAiReducer.enabled) return;
  
  system.runInterval(() => {
    try {
      const overworld = world.getDimension("minecraft:overworld");
      for (const entity of overworld.getEntities({ type: "minecraft:cow" })) {
        if (entity.hasComponent(EntityComponentTypes.LookAt)) {
          const lookAt = entity.getComponent(EntityComponentTypes.LookAt);
          if (lookAt) {
            lookAt.lookAtEntity = null;
          }
        }
      }
    } catch (e) {}
  }, 10);
}

function setupEntityLimiter() {
  if (!CONFIG.entityLimiter.enabled) return;
  
  system.runInterval(() => {
    try {
      const dimensions = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
      
      for (const dimId of dimensions) {
        const dimension = world.getDimension(dimId);
        const entities = Array.from(dimension.getEntities());
        
        if (entities.length > CONFIG.entityLimiter.maxEntitiesPerChunk * 100) {
          let itemsRemoved = 0;
          for (const entity of entities) {
            if (entity.typeId === "minecraft:item" && itemsRemoved < 100) {
              entity.remove();
              itemsRemoved++;
            }
          }
        }
      }
    } catch (e) {}
  }, 40);
}

function setupItemsCleaner() {
  if (!CONFIG.itemsCleaner.enabled) return;
  
  system.runInterval(() => {
    try {
      const dimensions = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
      
      for (const dimId of dimensions) {
        const dimension = world.getDimension(dimId);
        for (const entity of dimension.getEntities({ type: "minecraft:item" })) {
          const age = entity.age || 0;
          if (age > CONFIG.itemsCleaner.despawnTime) {
            entity.remove();
          }
        }
      }
    } catch (e) {}
  }, CONFIG.itemsCleaner.checkInterval);
}

function setupLagShield() {
  if (!CONFIG.lagShield.enabled) return;
  
  let tickCount = 0;
  const history = [];
  const maxHistory = 20;
  
  system.runInterval(() => {
    try {
      const now = Date.now();
      const delta = now - performanceData.lastTick;
      performanceData.lastTick = now;
      
      const currentTps = 1000 / delta;
      history.push(currentTps);
      
      if (history.length > maxHistory) {
        history.shift();
      }
      
      const avgTps = history.reduce((a, b) => a + b, 0) / history.length;
      performanceData.tps = Math.min(20, avgTps);
      performanceData.mspt = delta;
      
      if (performanceData.tps < CONFIG.lagShield.tpsThreshold) {
        const overworld = world.getDimension("minecraft:overworld");
        let removed = 0;
        for (const entity of overworld.getEntities({ type: "minecraft:item" })) {
          if (removed < 50) {
            entity.remove();
            removed++;
          }
        }
      }
      
      tickCount++;
      if (tickCount % 100 === 0) {
        performanceData.entityCount = 0;
        performanceData.chunkCount = 0;
        
        for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
          const dimension = world.getDimension(dimId);
          performanceData.entityCount += Array.from(dimension.getEntities()).length;
        }
      }
    } catch (e) {}
  }, 1);
}

function setupVehicleMotion() {
  if (!CONFIG.vehicleMotion.enabled) return;
  
  system.runInterval(() => {
    try {
      const overworld = world.getDimension("minecraft:overworld");
      
      if (CONFIG.vehicleMotion.removeChestMinecarts) {
        for (const entity of overworld.getEntities({ type: "minecraft:chest_minecart" })) {
          const pos = entity.location;
          const block = overworld.getBlock(pos);
          if (block && block.typeId !== "minecraft:rail" && block.typeId !== "minecraft:powered_rail" && block.typeId !== "minecraft:detector_rail" && block.typeId !== "minecraft:activator_rail") {
            entity.remove();
          }
        }
      }
    } catch (e) {}
  }, 20);
}

function setupAbilityLimiter() {
  if (!CONFIG.abilityLimiter.enabled) return;
  
  const tridentCooldowns = new Map();
  const elytraCooldowns = new Map();
  
  system.runInterval(() => {
    try {
      const overworld = world.getDimension("minecraft:overworld");
      
      for (const player of overworld.getEntities({ type: "minecraft:player" })) {
        const playerName = player.nameTag || player.id;
        
        const equipment = player.getComponent(EntityComponentTypes.Equippable);
        if (equipment) {
          const hand = equipment.getEquipmentSlot(0);
          if (hand && hand.typeId === "minecraft:trident") {
            const now = Date.now();
            const lastUse = tridentCooldowns.get(playerName) || 0;
            
            if (now - lastUse < CONFIG.abilityLimiter.tridentCooldown * 50) {
              player.runCommandAsync("clear @s trident 0 1");
            } else {
              tridentCooldowns.set(playerName, now);
            }
          }
        }
        
        const isFlying = player.isFlying;
        if (isFlying) {
          const now = Date.now();
          const lastBoost = elytraCooldowns.get(playerName) || 0;
          
          if (now - lastBoost < CONFIG.abilityLimiter.elytraBoostCooldown * 50) {
            player.clearVelocity();
          }
        }
      }
    } catch (e) {}
  }, 10);
}

system.beforeEvents.startup.subscribe((event) => {
  try {
    registerCustomCommands(event);
  } catch (e) {
    console.warn("Failed to register custom commands: " + e.message);
  }
});

system.afterEvents.worldInitialize.subscribe(() => {
  setupMobAiReducer();
  setupEntityLimiter();
  setupItemsCleaner();
  setupLagShield();
  setupVehicleMotion();
  setupAbilityLimiter();
});

system.runInterval(() => {
  try {
    const players = world.getDimension("minecraft:overworld").getEntities({ type: "minecraft:player" });
    for (const player of players) {
      if (player.isValid()) {
        player.setProperty("lagfixer:tps", performanceData.tps);
        player.setProperty("lagfixer:mspt", performanceData.mspt);
      }
    }
  } catch (e) {}
}, 20);
