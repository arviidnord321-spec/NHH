/**
 * DIGBOUND balancing module.
 * Every price, cap, probability and tuning number lives here so it can be
 * tuned from playtests / the economy simulation without touching systems.
 * Values are proposed starting balance, not facts from any reference.
 */

export type BiomeId = 'meadow' | 'crystal' | 'ember' | 'aurora';
export const BIOME_ORDER: BiomeId[] = ['meadow', 'crystal', 'ember', 'aurora'];

export type MaterialCategory = 'soil' | 'mineral' | 'basalt';
export type SoundKind = 'soil' | 'rock' | 'crystal';

export interface MaterialDef {
  id: string;
  name: string;
  biome: BiomeId | 'any';
  category: MaterialCategory;
  hpMul: number; // × biome base HP
  valueMul: number; // × biome base sale value, per unit
  units: number; // bag units granted on extraction
  minToolTier: number; // index into TOOLS
  color: string;
  emissive?: string;
  sound: SoundKind;
  indestructible?: boolean;
}

export const MATERIALS: MaterialDef[] = [
  { id: 'bedrock', name: 'Bedrock', biome: 'any', category: 'mineral', hpMul: 1, valueMul: 0, units: 0, minToolTier: 99, color: '#3a3644', sound: 'rock', indestructible: true },
  // Meadow
  { id: 'm_turf', name: 'Meadow Turf', biome: 'meadow', category: 'soil', hpMul: 1, valueMul: 1, units: 1, minToolTier: 0, color: '#78ae48', sound: 'soil' },
  { id: 'm_soil', name: 'Loam', biome: 'meadow', category: 'soil', hpMul: 1, valueMul: 1, units: 1, minToolTier: 0, color: '#865637', sound: 'soil' },
  { id: 'm_clay', name: 'Red Clay', biome: 'meadow', category: 'soil', hpMul: 1.5, valueMul: 1.6, units: 1, minToolTier: 0, color: '#a5603d', sound: 'soil' },
  { id: 'm_stone', name: 'Field Stone', biome: 'meadow', category: 'mineral', hpMul: 2.2, valueMul: 2.2, units: 1, minToolTier: 0, color: '#8e8a86', sound: 'rock' },
  { id: 'm_copper', name: 'Copper Node', biome: 'meadow', category: 'mineral', hpMul: 3, valueMul: 2.5, units: 3, minToolTier: 1, color: '#d9853b', emissive: '#4a2208', sound: 'crystal' },
  // Crystal Hollow
  { id: 'c_turf', name: 'Glowmoss', biome: 'crystal', category: 'soil', hpMul: 1, valueMul: 1, units: 1, minToolTier: 0, color: '#5f8fb8', sound: 'soil' },
  { id: 'c_soil', name: 'Blue Silt', biome: 'crystal', category: 'soil', hpMul: 1, valueMul: 1, units: 1, minToolTier: 0, color: '#4a5d86', sound: 'soil' },
  { id: 'c_stone', name: 'Bluestone', biome: 'crystal', category: 'mineral', hpMul: 1.6, valueMul: 1.6, units: 1, minToolTier: 0, color: '#56709a', sound: 'rock' },
  { id: 'c_amethyst', name: 'Amethyst Cluster', biome: 'crystal', category: 'mineral', hpMul: 2.5, valueMul: 2.4, units: 3, minToolTier: 0, color: '#9462f5', emissive: '#3b1880', sound: 'crystal' },
  { id: 'c_quartz', name: 'Quartz Heart', biome: 'crystal', category: 'mineral', hpMul: 3.2, valueMul: 3, units: 4, minToolTier: 2, color: '#d9f3ff', emissive: '#3f6f8a', sound: 'crystal' },
  // Ember Quarry
  { id: 'e_ash', name: 'Ash Soil', biome: 'ember', category: 'soil', hpMul: 1, valueMul: 1, units: 1, minToolTier: 0, color: '#5a4a46', sound: 'soil' },
  { id: 'e_basalt', name: 'Basalt', biome: 'ember', category: 'basalt', hpMul: 1.5, valueMul: 1.5, units: 1, minToolTier: 0, color: '#2e2b33', sound: 'rock' },
  { id: 'e_copper', name: 'Copper Vein', biome: 'ember', category: 'basalt', hpMul: 2.2, valueMul: 2.4, units: 2, minToolTier: 0, color: '#c4733a', emissive: '#3a1606', sound: 'rock' },
  { id: 'e_core', name: 'Ember Core', biome: 'ember', category: 'basalt', hpMul: 3, valueMul: 3, units: 4, minToolTier: 3, color: '#ff7a2e', emissive: '#a03000', sound: 'crystal' },
  // Aurora Depths
  { id: 'a_soil', name: 'Starlit Soil', biome: 'aurora', category: 'soil', hpMul: 1, valueMul: 1, units: 1, minToolTier: 0, color: '#2c3d6b', sound: 'soil' },
  { id: 'a_stone', name: 'Ruin Stone', biome: 'aurora', category: 'mineral', hpMul: 1.5, valueMul: 1.5, units: 1, minToolTier: 0, color: '#3d4f80', sound: 'rock' },
  { id: 'a_teal', name: 'Turquoise Spire', biome: 'aurora', category: 'mineral', hpMul: 2.4, valueMul: 2.5, units: 3, minToolTier: 0, color: '#16cdbb', emissive: '#065a52', sound: 'crystal' },
  { id: 'a_celestial', name: 'Celestial Shard', biome: 'aurora', category: 'mineral', hpMul: 3, valueMul: 3.2, units: 5, minToolTier: 4, color: '#c8b0ff', emissive: '#5a30c0', sound: 'crystal' },
];
export const MATERIAL_BY_ID: Record<string, MaterialDef> = Object.fromEntries(MATERIALS.map((m) => [m.id, m]));
export const MATERIAL_INDEX: Record<string, number> = Object.fromEntries(MATERIALS.map((m, i) => [m.id, i]));

export interface BiomeDef {
  id: BiomeId;
  name: string;
  baseHp: number;
  baseValue: number;
  unlockCost: number;
  /** Relic requirement: number of fragments from `relicBiome` needed. */
  relicReq: { biome: BiomeId; count: number } | null;
  center: [number, number];
  half: number; // half size of square region
  ground: string;
  ground2: string;
  fog: string;
  sky: string;
  layers: { top: string; upper: string; mid: string; deep: string; node: string; rare: string };
  egg: string;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  meadow: {
    id: 'meadow', name: 'Meadow Camp', baseHp: 20, baseValue: 5, unlockCost: 0, relicReq: null,
    center: [0, 0], half: 40, ground: '#78ae48', ground2: '#8cc257', fog: '#bfe3f2', sky: '#9fd6f0',
    layers: { top: 'm_turf', upper: 'm_soil', mid: 'm_clay', deep: 'm_stone', node: 'm_copper', rare: 'm_copper' },
    egg: 'meadow',
  },
  crystal: {
    id: 'crystal', name: 'Crystal Hollow', baseHp: 55, baseValue: 12, unlockCost: 1200, relicReq: { biome: 'meadow', count: 1 },
    center: [0, -82], half: 40, ground: '#4f6fa3', ground2: '#5b7fb6', fog: '#8f9fd6', sky: '#7d8fd0',
    layers: { top: 'c_turf', upper: 'c_soil', mid: 'c_stone', deep: 'c_stone', node: 'c_amethyst', rare: 'c_quartz' },
    egg: 'geode',
  },
  ember: {
    id: 'ember', name: 'Ember Quarry', baseHp: 140, baseValue: 30, unlockCost: 8000, relicReq: { biome: 'crystal', count: 3 },
    center: [82, 0], half: 40, ground: '#5a4a46', ground2: '#6b5650', fog: '#c98a6a', sky: '#e0a080',
    layers: { top: 'e_ash', upper: 'e_basalt', mid: 'e_basalt', deep: 'e_copper', node: 'e_copper', rare: 'e_core' },
    egg: 'ember',
  },
  aurora: {
    id: 'aurora', name: 'Aurora Depths', baseHp: 360, baseValue: 75, unlockCost: 35000, relicReq: { biome: 'ember', count: 3 },
    center: [0, 82], half: 40, ground: '#24345e', ground2: '#2c3f70', fog: '#3a4c88', sky: '#1d2a55',
    layers: { top: 'a_soil', upper: 'a_stone', mid: 'a_stone', deep: 'a_stone', node: 'a_teal', rare: 'a_celestial' },
    egg: 'aurora',
  },
};

// ───────── Tools ─────────
export interface ToolTier { name: string; power: number; interval: number; price: number; color: string }
export const TOOLS: ToolTier[] = [
  { name: 'Starter Spade', power: 10, interval: 0.45, price: 0, color: '#9aa3ad' },
  { name: 'Reinforced Spade', power: 16, interval: 0.43, price: 90, color: '#c9d2dc' },
  { name: 'Prospector Shovel', power: 30, interval: 0.4, price: 500, color: '#ffbd38' },
  { name: 'Crystal Shovel', power: 65, interval: 0.38, price: 2500, color: '#9462f5' },
  { name: 'Ember Shovel', power: 145, interval: 0.36, price: 12000, color: '#ff7a2e' },
  { name: 'Aurora Shovel', power: 320, interval: 0.34, price: 50000, color: '#16cdbb' },
];

export const BAGS: { capacity: number; price: number; name: string }[] = [
  { capacity: 20, price: 0, name: 'Canvas Satchel' },
  { capacity: 40, price: 120, name: 'Explorer Pack' },
  { capacity: 80, price: 650, name: 'Prospector Pack' },
  { capacity: 160, price: 3000, name: 'Expedition Pack' },
  { capacity: 320, price: 15000, name: 'Titan Pack' },
];

export const PICKAXE = { price: 600, requiresBiome: 'crystal' as BiomeId, mineralMul: 1.25, soilMul: 0.75 };
export const LANTERN = { price: 40 };

export const CAPS = {
  petDigBonus: 0.75,
  petSaleBonus: 0.5,
  petInventory: 60,
  maxTeam: 4,
  petMaxLevel: 10,
  xpPerCell: 1,
  xpPerTreasure: 20,
  levelBonusPP: 0.5, // percentage points per level above 1
  shinyBonusPP: 3,
  pityCount: 20,
  maxCoins: 1e12,
  maxGems: 1e9,
};

export const SCAN = { radius: 12, cooldown: 10 };
export const DIG = { reach: 4, tutorialCells: 5, tutorialHp: 10, uncoverHold: 0.8 };
export const MOVE = { walk: 5, sprint: 7.5, jumpHeight: 1.3, accel: 30, gravity: 24, height: 1.8, radius: 0.35 };

// ───────── Pets ─────────
export type Rarity = 'common' | 'rare' | 'legendary' | 'tutorial';
export type UtilityKind = 'sale' | 'speed' | 'scanRadius' | 'mineralDmg' | 'bag' | 'basaltDmg' | 'golemHit' | 'scanCooldown';

export interface SpeciesDef {
  id: string;
  name: string;
  digBonus: number; // fraction, e.g. 0.05
  utility: UtilityKind;
  utilityValue: number;
  utilityText: string;
}

export const SPECIES: Record<string, SpeciesDef> = {
  pup: { id: 'pup', name: 'Pebble Pup', digBonus: 0.05, utility: 'sale', utilityValue: 0.05, utilityText: '+5% resource sale value' },
  bunny: { id: 'bunny', name: 'Sprout Bunny', digBonus: 0.06, utility: 'speed', utilityValue: 0.08, utilityText: '+8% movement speed' },
  mole: { id: 'mole', name: 'Lantern Mole', digBonus: 0.08, utility: 'scanRadius', utilityValue: 2, utilityText: '+2 m Echo Scan radius' },
  fox: { id: 'fox', name: 'Quartz Fox', digBonus: 0.1, utility: 'mineralDmg', utilityValue: 0.1, utilityText: '+10% dig bonus on mineral cells' },
  turtle: { id: 'turtle', name: 'Moss Turtle', digBonus: 0.07, utility: 'bag', utilityValue: 10, utilityText: '+10 bag units' },
  axolotl: { id: 'axolotl', name: 'Ember Axolotl', digBonus: 0.12, utility: 'basaltDmg', utilityValue: 0.15, utilityText: '+15% dig bonus on basalt cells' },
  golem: { id: 'golem', name: 'Geode Golem', digBonus: 0.15, utility: 'golemHit', utilityValue: 0.5, utilityText: 'Every 8th hit adds 50% tool power to the same target' },
  dragon: { id: 'dragon', name: 'Aurora Dragon', digBonus: 0.18, utility: 'scanCooldown', utilityValue: 0.2, utilityText: 'Echo Scan cooldown −20%' },
};

export interface PetPalette { body: string; accent: string; detail: string; belly: string; glow?: string }

/** A collection entry: base species or a named variant. */
export interface PetEntry {
  id: string;
  name: string;
  species: string;
  palette: PetPalette;
  variant: boolean;
}

export const PET_ENTRIES: PetEntry[] = [
  { id: 'pup', name: 'Pebble Pup', species: 'pup', variant: false, palette: { body: '#d9b07a', accent: '#16cdbb', detail: '#3b3a40', belly: '#f3dcb4' } },
  { id: 'bunny', name: 'Sprout Bunny', species: 'bunny', variant: false, palette: { body: '#7cc457', accent: '#4f9a3a', detail: '#fff4dc', belly: '#fff4dc' } },
  { id: 'mole', name: 'Lantern Mole', species: 'mole', variant: false, palette: { body: '#7a5236', accent: '#ff9a2e', detail: '#f5dcc0', belly: '#a0785a', glow: '#ffd27a' } },
  { id: 'fox', name: 'Quartz Fox', species: 'fox', variant: false, palette: { body: '#9462f5', accent: '#c7a6ff', detail: '#f3ecff', belly: '#f3ecff', glow: '#9462f5' } },
  { id: 'turtle', name: 'Moss Turtle', species: 'turtle', variant: false, palette: { body: '#86c45a', accent: '#7f8a72', detail: '#e0473a', belly: '#e9e2b0' } },
  { id: 'axolotl', name: 'Ember Axolotl', species: 'axolotl', variant: false, palette: { body: '#ff8a3d', accent: '#ff4f5e', detail: '#5a2a1e', belly: '#5a2a1e' } },
  { id: 'golem', name: 'Geode Golem', species: 'golem', variant: false, palette: { body: '#8d8a92', accent: '#a46bff', detail: '#5d5a63', belly: '#6c6872', glow: '#b68aff' } },
  { id: 'dragon', name: 'Aurora Dragon', species: 'dragon', variant: false, palette: { body: '#1f3a6b', accent: '#5ff2ff', detail: '#9462f5', belly: '#16cdbb', glow: '#ffe27a' } },
  { id: 'cinder_pup', name: 'Cinder Pebble Pup', species: 'pup', variant: true, palette: { body: '#45414a', accent: '#ff7a2e', detail: '#1f1d22', belly: '#6a646f' } },
  { id: 'forge_mole', name: 'Forge Lantern Mole', species: 'mole', variant: true, palette: { body: '#6a4430', accent: '#c4733a', detail: '#f5dcc0', belly: '#8a6248', glow: '#ff9a4a' } },
  { id: 'prism_fox', name: 'Prism Quartz Fox', species: 'fox', variant: true, palette: { body: '#8a5df0', accent: '#16cdbb', detail: '#f3ecff', belly: '#e9fbff', glow: '#6ff5e6' } },
  { id: 'lunar_golem', name: 'Lunar Geode Golem', species: 'golem', variant: true, palette: { body: '#2c3d6b', accent: '#9ff2ff', detail: '#1d2a4d', belly: '#24345e', glow: '#c8f8ff' } },
];
export const PET_ENTRY_BY_ID: Record<string, PetEntry> = Object.fromEntries(PET_ENTRIES.map((p) => [p.id, p]));

// ───────── Eggs ─────────
export interface EggDef {
  id: string;
  name: string;
  cost: number;
  biome: BiomeId; // must be unlocked to buy
  outcomes: { pet: string; weight: number; rarity: Rarity }[];
  featuredIndex: number;
  shell: string;
  accent: string;
  detail: string;
}

export const EGGS: EggDef[] = [
  {
    id: 'meadow', name: 'Meadow Egg', cost: 150, biome: 'meadow', featuredIndex: 2,
    outcomes: [{ pet: 'pup', weight: 55, rarity: 'common' }, { pet: 'bunny', weight: 35, rarity: 'rare' }, { pet: 'turtle', weight: 10, rarity: 'legendary' }],
    shell: '#fff0d0', accent: '#78ae48', detail: '#8e8a86',
  },
  {
    id: 'geode', name: 'Geode Egg', cost: 1200, biome: 'crystal', featuredIndex: 2,
    outcomes: [{ pet: 'mole', weight: 55, rarity: 'common' }, { pet: 'fox', weight: 35, rarity: 'rare' }, { pet: 'golem', weight: 10, rarity: 'legendary' }],
    shell: '#5a34b0', accent: '#a46bff', detail: '#16cdbb',
  },
  {
    id: 'ember', name: 'Ember Egg', cost: 7500, biome: 'ember', featuredIndex: 2,
    outcomes: [{ pet: 'cinder_pup', weight: 55, rarity: 'common' }, { pet: 'forge_mole', weight: 35, rarity: 'rare' }, { pet: 'axolotl', weight: 10, rarity: 'legendary' }],
    shell: '#2b2629', accent: '#ff7a2e', detail: '#c4733a',
  },
  {
    id: 'aurora', name: 'Aurora Egg', cost: 30000, biome: 'aurora', featuredIndex: 2,
    outcomes: [{ pet: 'prism_fox', weight: 55, rarity: 'common' }, { pet: 'lunar_golem', weight: 35, rarity: 'rare' }, { pet: 'dragon', weight: 10, rarity: 'legendary' }],
    shell: '#14243d', accent: '#16cdbb', detail: '#9462f5',
  },
];
export const EGG_BY_ID: Record<string, EggDef> = Object.fromEntries(EGGS.map((e) => [e.id, e]));
export const STARTER_EGG = { id: 'starter', name: 'Starter Egg', pet: 'pup', shell: '#fff4dc', accent: '#16cdbb', detail: '#ffbd38' };

export const RARITY_INFO: Record<Rarity, { label: string; color: string; icon: string }> = {
  tutorial: { label: 'Starter', color: '#16cdbb', icon: '✿' },
  common: { label: 'Common', color: '#b8c4d6', icon: '●' },
  rare: { label: 'Rare', color: '#4da3ff', icon: '◆' },
  legendary: { label: 'Featured', color: '#ffbd38', icon: '★' },
};

// ───────── Treasures & collection ─────────
export type TreasureKind = 'coins' | 'geode' | 'fossil' | 'decor' | 'token' | 'relic';

export const TREASURE_WEIGHTS: { kind: TreasureKind; weight: number }[] = [
  { kind: 'coins', weight: 45 },
  { kind: 'geode', weight: 25 },
  { kind: 'fossil', weight: 14 },
  { kind: 'decor', weight: 10 },
  { kind: 'token', weight: 6 },
];

/** Coin cache = biome baseValue × this. */
export const COIN_CACHE_MUL = 14;
export const GEODE_GEMS = [3, 5, 8, 12];
export const FIND_GEMS = 2;
export const RELIC_DUPLICATE_GEMS = 6;

export interface CollectibleDef { id: string; name: string; biome: BiomeId; kind: 'relic' | 'fossil' | 'decor'; color: string }

export const COLLECTIBLES: CollectibleDef[] = [
  // Relic fragments: 3 per biome, seeded into reachable sites (never a loot roll).
  { id: 'meadow_r1', name: 'Leaf Crown Shard I', biome: 'meadow', kind: 'relic', color: '#9ad86a' },
  { id: 'meadow_r2', name: 'Leaf Crown Shard II', biome: 'meadow', kind: 'relic', color: '#9ad86a' },
  { id: 'meadow_r3', name: 'Leaf Crown Shard III', biome: 'meadow', kind: 'relic', color: '#9ad86a' },
  { id: 'crystal_r1', name: 'Prism Lens Shard I', biome: 'crystal', kind: 'relic', color: '#c9a8ff' },
  { id: 'crystal_r2', name: 'Prism Lens Shard II', biome: 'crystal', kind: 'relic', color: '#c9a8ff' },
  { id: 'crystal_r3', name: 'Prism Lens Shard III', biome: 'crystal', kind: 'relic', color: '#c9a8ff' },
  { id: 'ember_r1', name: 'Forge Heart Shard I', biome: 'ember', kind: 'relic', color: '#ff9a4a' },
  { id: 'ember_r2', name: 'Forge Heart Shard II', biome: 'ember', kind: 'relic', color: '#ff9a4a' },
  { id: 'ember_r3', name: 'Forge Heart Shard III', biome: 'ember', kind: 'relic', color: '#ff9a4a' },
  { id: 'aurora_r1', name: 'Star Compass Shard I', biome: 'aurora', kind: 'relic', color: '#6ff5e6' },
  { id: 'aurora_r2', name: 'Star Compass Shard II', biome: 'aurora', kind: 'relic', color: '#6ff5e6' },
  { id: 'aurora_r3', name: 'Star Compass Shard III', biome: 'aurora', kind: 'relic', color: '#6ff5e6' },
  // Fossils & decorative finds
  { id: 'meadow_f1', name: 'Fern Fossil', biome: 'meadow', kind: 'fossil', color: '#d8c8a8' },
  { id: 'meadow_f2', name: 'Snail Ammonite', biome: 'meadow', kind: 'fossil', color: '#d8c8a8' },
  { id: 'meadow_d1', name: 'Clay Whistle', biome: 'meadow', kind: 'decor', color: '#c47a4a' },
  { id: 'crystal_f1', name: 'Glass Trilobite', biome: 'crystal', kind: 'fossil', color: '#b8d8ff' },
  { id: 'crystal_d1', name: 'Rune Bell', biome: 'crystal', kind: 'decor', color: '#9462f5' },
  { id: 'crystal_d2', name: 'Mirror Comb', biome: 'crystal', kind: 'decor', color: '#d9f3ff' },
  { id: 'ember_f1', name: 'Salamander Skull', biome: 'ember', kind: 'fossil', color: '#e0c0a0' },
  { id: 'ember_d1', name: 'Copper Gear', biome: 'ember', kind: 'decor', color: '#c4733a' },
  { id: 'ember_d2', name: 'Forge Token', biome: 'ember', kind: 'decor', color: '#ffbd38' },
  { id: 'aurora_f1', name: 'Comet Shell', biome: 'aurora', kind: 'fossil', color: '#c8f8ff' },
  { id: 'aurora_d1', name: 'Orbit Charm', biome: 'aurora', kind: 'decor', color: '#ffe27a' },
  { id: 'aurora_d2', name: 'Lunar Mask', biome: 'aurora', kind: 'decor', color: '#9462f5' },
];
export const COLLECTIBLE_BY_ID: Record<string, CollectibleDef> = Object.fromEntries(COLLECTIBLES.map((c) => [c.id, c]));

export const DISPLAY_REWARD = { gems: 25, coinsMul: 60 }; // coins = baseValue × coinsMul
export const SECRET_CHAMBER_GEMS = 30;

// ───────── Gem cosmetics ─────────
export interface CosmeticDef { id: string; name: string; slot: 'helmet' | 'scarf' | 'crown'; color: string; gems: number; purchasable: boolean }
export const COSMETICS: CosmeticDef[] = [
  { id: 'helmet_default', name: 'Miner Helmet', slot: 'helmet', color: '#ffbd38', gems: 0, purchasable: true },
  { id: 'helmet_teal', name: 'Teal Helmet', slot: 'helmet', color: '#16cdbb', gems: 15, purchasable: true },
  { id: 'helmet_violet', name: 'Amethyst Helmet', slot: 'helmet', color: '#9462f5', gems: 30, purchasable: true },
  { id: 'helmet_ember', name: 'Forge Helmet', slot: 'helmet', color: '#ff7a2e', gems: 45, purchasable: true },
  { id: 'scarf_default', name: 'Teal Scarf', slot: 'scarf', color: '#16cdbb', gems: 0, purchasable: true },
  { id: 'scarf_amber', name: 'Amber Scarf', slot: 'scarf', color: '#ffbd38', gems: 10, purchasable: true },
  { id: 'scarf_violet', name: 'Violet Scarf', slot: 'scarf', color: '#9462f5', gems: 20, purchasable: true },
  { id: 'crown_aurora', name: 'Aurora Explorer Crown', slot: 'crown', color: '#6ff5e6', gems: 0, purchasable: false },
];

// ───────── Quests ─────────
export type QuestType = 'break' | 'hatchStarter' | 'sell' | 'upgradeTool' | 'scan' | 'uncover' | 'hatch' | 'equipTeam' | 'unlock';
export interface QuestDef { id: string; type: QuestType; target: number; text: string; reward: { coins?: number; gems?: number } }
export const QUEST_CHAIN: QuestDef[] = [
  { id: 'q_break', type: 'break', target: 5, text: 'Break 5 cells at the dig site', reward: { coins: 20 } },
  { id: 'q_starter', type: 'hatchStarter', target: 1, text: 'Hatch the free Starter Egg', reward: {} },
  { id: 'q_sell', type: 'sell', target: 1, text: 'Sell your bag at the Trader', reward: { coins: 25 } },
  { id: 'q_upgrade', type: 'upgradeTool', target: 1, text: 'Upgrade your shovel at the Smithy', reward: { gems: 2 } },
  { id: 'q_scan', type: 'scan', target: 1, text: 'Use Echo Scan (Q)', reward: { coins: 30 } },
  { id: 'q_uncover', type: 'uncover', target: 1, text: 'Uncover a buried cache', reward: { gems: 3 } },
  { id: 'q_hatch', type: 'hatch', target: 1, text: 'Hatch a Meadow Egg', reward: { coins: 60 } },
  { id: 'q_team', type: 'equipTeam', target: 2, text: 'Equip a team of 2 pets', reward: { gems: 3 } },
  { id: 'q_unlock', type: 'unlock', target: 1, text: 'Open the gate to Crystal Hollow', reward: { gems: 10 } },
];

export interface AchievementDef { id: string; name: string; text: string; stat: string; target: number; gems: number }
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'a_cells100', name: 'Groundbreaker', text: 'Break 100 cells', stat: 'cells', target: 100, gems: 5 },
  { id: 'a_cells1000', name: 'Tunnel Legend', text: 'Break 1,000 cells', stat: 'cells', target: 1000, gems: 20 },
  { id: 'a_treasure10', name: 'Treasure Nose', text: 'Uncover 10 treasures', stat: 'treasures', target: 10, gems: 10 },
  { id: 'a_hatch10', name: 'Egg Whisperer', text: 'Hatch 10 eggs', stat: 'hatches', target: 10, gems: 10 },
  { id: 'a_species8', name: 'Full Den', text: 'Collect all 8 base species', stat: 'species', target: 8, gems: 30 },
  { id: 'a_level10', name: 'Best Friends', text: 'Raise a pet to level 10', stat: 'maxPetLevel', target: 10, gems: 15 },
  { id: 'a_coins10k', name: 'Prospector', text: 'Earn 10,000 coins in total', stat: 'coinsEarned', target: 10000, gems: 10 },
  { id: 'a_scan25', name: 'Echo Listener', text: 'Use Echo Scan 25 times', stat: 'scans', target: 25, gems: 5 },
  { id: 'a_display1', name: 'Curator', text: 'Complete a museum display', stat: 'displays', target: 1, gems: 10 },
  { id: 'a_biomes4', name: 'Pathfinder', text: 'Unlock all four biomes', stat: 'biomes', target: 4, gems: 25 },
];

export const CONTRACT = {
  resourceAmountByBiome: { meadow: 25, crystal: 30, ember: 30, aurora: 30 } as Record<BiomeId, number>,
  cacheCount: 2,
  rewardMul: { resource: 30, cache: 40, relic: 50 }, // coins = baseValue × mul
  gems: { resource: 2, cache: 3, relic: 5 },
};

export const SAVE = { key: 'digbound_save_v1', schemaVersion: 1, autosaveSeconds: 20 };

export const QUALITY = {
  low: { particles: 120, pixelRatio: 1.0, shadows: false, decorDensity: 0.4 },
  medium: { particles: 300, pixelRatio: 1.5, shadows: true, decorDensity: 0.75 },
  high: { particles: 600, pixelRatio: 2.0, shadows: true, decorDensity: 1 },
};
export type QualityLevel = keyof typeof QUALITY;

export const SITE = { w: 12, d: 12, h: 8 };
export const SITES_PER_BIOME = 3;
