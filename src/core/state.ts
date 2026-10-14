import {
  BAGS, BIOME_ORDER, BiomeId, CAPS, COLLECTIBLE_BY_ID, COSMETICS, EGG_BY_ID, MATERIAL_BY_ID, PET_ENTRY_BY_ID,
  QUEST_CHAIN, QualityLevel, SAVE, TOOLS, ACHIEVEMENTS,
} from '../data/balance';

export interface PetInstance {
  id: number;
  entry: string;
  level: number;
  xp: number;
  locked: boolean;
  shiny: boolean;
}

export interface SiteState {
  seed: number;
  /** base64 bitset of removed cells */
  mined: string;
  /** claimed treasure indices for this seed */
  claimed: number[];
  /** partial damage: [cellIndex, remainingHp] */
  damage: [number, number][];
}

export interface PendingHatch {
  egg: string; // egg id or 'starter'
  petId: number;
  isNew: boolean;
}

export type ContractKind = 'resource' | 'cache' | 'relic';
export interface Contract {
  kind: ContractKind;
  biome: BiomeId;
  material?: string;
  target: number;
  progress: number;
}

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  quality: QualityLevel;
  particles: boolean;
  shake: boolean;
  reducedMotion: boolean;
  keepFavorites: boolean;
  fastHatch: boolean;
  showFps: boolean;
}

export interface SaveData {
  v: number;
  coins: number;
  gems: number;
  toolTier: number;
  bagTier: number;
  hasPickaxe: boolean;
  hasLantern: boolean;
  activeTool: 'shovel' | 'pickaxe';
  bag: Record<string, number>;
  pets: PetInstance[];
  nextPetId: number;
  equipped: number[];
  pity: Record<string, number>;
  eggTokens: Record<string, number>;
  hatchSeed: number;
  pendingHatch: PendingHatch | null;
  starterHatched: boolean;
  seenEntries: string[];
  unlocked: BiomeId[];
  collection: Record<string, number>;
  displaysClaimed: BiomeId[];
  chambersClaimed: BiomeId[];
  finalClaimed: boolean;
  questIndex: number;
  questProgress: number;
  achievements: string[];
  stats: { cells: number; treasures: number; hatches: number; coinsEarned: number; scans: number; sells: number };
  contract: Contract | null;
  contractsDone: number;
  contractSeed: number;
  cosmetics: { owned: string[]; helmet: string; scarf: string; crown: boolean };
  sites: Record<string, SiteState>;
  settings: Settings;
  golemCounter: number;
  savedAt: number;
}

export function defaultSettings(): Settings {
  return {
    master: 0.8, music: 0.45, sfx: 0.8, muted: false, quality: 'medium', particles: true, shake: true,
    reducedMotion: false, keepFavorites: true, fastHatch: false, showFps: false,
  };
}

export function createDefaultSave(seed = Date.now() >>> 0): SaveData {
  return {
    v: SAVE.schemaVersion,
    coins: 0,
    gems: 0,
    toolTier: 0,
    bagTier: 0,
    hasPickaxe: false,
    hasLantern: false,
    activeTool: 'shovel',
    bag: {},
    pets: [],
    nextPetId: 1,
    equipped: [],
    pity: { meadow: 0, geode: 0, ember: 0, aurora: 0 },
    eggTokens: {},
    hatchSeed: (seed ^ 0x9e3779b9) >>> 0,
    pendingHatch: null,
    starterHatched: false,
    seenEntries: [],
    unlocked: ['meadow'],
    collection: {},
    displaysClaimed: [],
    chambersClaimed: [],
    finalClaimed: false,
    questIndex: 0,
    questProgress: 0,
    achievements: [],
    stats: { cells: 0, treasures: 0, hatches: 0, coinsEarned: 0, scans: 0, sells: 0 },
    contract: null,
    contractsDone: 0,
    contractSeed: (seed ^ 0x51ed270b) >>> 0,
    cosmetics: { owned: ['helmet_default', 'scarf_default'], helmet: 'helmet_default', scarf: 'scarf_default', crown: false },
    sites: {},
    settings: defaultSettings(),
    golemCounter: 0,
    savedAt: 0,
  };
}

// ───────── Validation helpers ─────────
const int = (v: unknown, min: number, max: number, def: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.floor(v)));
};
const num = (v: unknown, min: number, max: number, def: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
};
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type ValidateResult =
  | { ok: true; data: SaveData; repaired: string[] }
  | { ok: false; reason: 'malformed' | 'newer'; detail: string };

/**
 * Validate an untrusted parsed save. Unknown ids are dropped, integers bounded,
 * NaN replaced. A newer schema is rejected (never silently overwritten).
 */
export function validateSave(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'malformed', detail: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.v !== 'number') return { ok: false, reason: 'malformed', detail: 'missing version' };
  if (r.v > SAVE.schemaVersion) return { ok: false, reason: 'newer', detail: `save version ${r.v} is newer than ${SAVE.schemaVersion}` };
  const repaired: string[] = [];
  const d = createDefaultSave();

  d.coins = int(r.coins, 0, CAPS.maxCoins, 0);
  d.gems = int(r.gems, 0, CAPS.maxGems, 0);
  d.toolTier = int(r.toolTier, 0, TOOLS.length - 1, 0);
  d.bagTier = int(r.bagTier, 0, BAGS.length - 1, 0);
  d.hasPickaxe = bool(r.hasPickaxe, false);
  d.hasLantern = bool(r.hasLantern, false);
  d.activeTool = r.activeTool === 'pickaxe' && d.hasPickaxe ? 'pickaxe' : 'shovel';

  for (const [k, v] of Object.entries(obj(r.bag))) {
    if (!MATERIAL_BY_ID[k] || MATERIAL_BY_ID[k].indestructible) { repaired.push(`bag:${k}`); continue; }
    const n = int(v, 0, 100000, 0);
    if (n > 0) d.bag[k] = n;
  }

  const ids = new Set<number>();
  let maxId = 0;
  for (const p of arr(r.pets)) {
    const po = obj(p);
    const entry = String(po.entry ?? '');
    const id = int(po.id, 1, 1e9, 0);
    if (!PET_ENTRY_BY_ID[entry] || !id || ids.has(id)) { repaired.push(`pet:${entry}`); continue; }
    ids.add(id);
    maxId = Math.max(maxId, id);
    d.pets.push({
      id, entry,
      level: int(po.level, 1, CAPS.petMaxLevel, 1),
      xp: int(po.xp, 0, 100000, 0),
      locked: bool(po.locked, false),
      shiny: bool(po.shiny, false),
    });
    if (d.pets.length >= CAPS.petInventory) break;
  }
  d.nextPetId = Math.max(int(r.nextPetId, 1, 1e9, 1), maxId + 1);
  d.equipped = [...new Set(arr(r.equipped).map((x) => int(x, 0, 1e9, 0)))].filter((id) => ids.has(id)).slice(0, CAPS.maxTeam);

  for (const e of Object.keys(EGG_BY_ID)) {
    d.pity[e] = int(obj(r.pity)[e], 0, CAPS.pityCount - 1, 0);
    const t = int(obj(r.eggTokens)[e], 0, 999, 0);
    if (t) d.eggTokens[e] = t;
  }
  d.hatchSeed = int(r.hatchSeed, 0, 4294967295, d.hatchSeed);

  const ph = obj(r.pendingHatch);
  if (r.pendingHatch && ids.has(int(ph.petId, 0, 1e9, 0)) && (EGG_BY_ID[String(ph.egg)] || ph.egg === 'starter')) {
    d.pendingHatch = { egg: String(ph.egg), petId: int(ph.petId, 0, 1e9, 0), isNew: bool(ph.isNew, false) };
  }
  d.starterHatched = bool(r.starterHatched, false);
  d.seenEntries = arr(r.seenEntries).map(String).filter((e) => PET_ENTRY_BY_ID[e]);

  const unlocked = arr(r.unlocked).map(String).filter((b): b is BiomeId => (BIOME_ORDER as string[]).includes(b));
  d.unlocked = [...new Set<BiomeId>(['meadow', ...unlocked])];

  for (const [k, v] of Object.entries(obj(r.collection))) {
    if (!COLLECTIBLE_BY_ID[k]) { repaired.push(`col:${k}`); continue; }
    const n = int(v, 0, 9999, 0);
    if (n) d.collection[k] = n;
  }
  const biomeList = (v: unknown) => [...new Set(arr(v).map(String).filter((b): b is BiomeId => (BIOME_ORDER as string[]).includes(b)))];
  d.displaysClaimed = biomeList(r.displaysClaimed);
  d.chambersClaimed = biomeList(r.chambersClaimed);
  d.finalClaimed = bool(r.finalClaimed, false);

  d.questIndex = int(r.questIndex, 0, QUEST_CHAIN.length, 0);
  d.questProgress = int(r.questProgress, 0, 1e6, 0);
  d.achievements = arr(r.achievements).map(String).filter((a) => ACHIEVEMENTS.some((x) => x.id === a));

  const st = obj(r.stats);
  for (const k of Object.keys(d.stats) as (keyof SaveData['stats'])[]) d.stats[k] = int(st[k], 0, 1e12, 0);

  const c = obj(r.contract);
  if (r.contract && ['resource', 'cache', 'relic'].includes(String(c.kind)) && (BIOME_ORDER as string[]).includes(String(c.biome))) {
    const mat = c.material === undefined ? undefined : String(c.material);
    if (mat === undefined || MATERIAL_BY_ID[mat]) {
      d.contract = {
        kind: c.kind as ContractKind, biome: c.biome as BiomeId, material: mat,
        target: int(c.target, 1, 1000, 1), progress: int(c.progress, 0, 1000, 0),
      };
    }
  }
  d.contractsDone = int(r.contractsDone, 0, 1e6, 0);
  d.contractSeed = int(r.contractSeed, 0, 4294967295, d.contractSeed);

  const cos = obj(r.cosmetics);
  const owned = arr(cos.owned).map(String).filter((id) => COSMETICS.some((c2) => c2.id === id));
  d.cosmetics.owned = [...new Set(['helmet_default', 'scarf_default', ...owned])];
  d.cosmetics.helmet = d.cosmetics.owned.includes(String(cos.helmet)) && String(cos.helmet).startsWith('helmet') ? String(cos.helmet) : 'helmet_default';
  d.cosmetics.scarf = d.cosmetics.owned.includes(String(cos.scarf)) && String(cos.scarf).startsWith('scarf') ? String(cos.scarf) : 'scarf_default';
  d.cosmetics.crown = bool(cos.crown, false) && d.finalClaimed;

  for (const [k, v] of Object.entries(obj(r.sites))) {
    if (!/^(meadow|crystal|ember|aurora)_\d$/.test(k)) continue;
    const s = obj(v);
    const mined = typeof s.mined === 'string' && /^[A-Za-z0-9+/=]*$/.test(s.mined) && s.mined.length < 4000 ? s.mined : '';
    d.sites[k] = {
      seed: int(s.seed, 0, 4294967295, 1),
      mined,
      claimed: [...new Set(arr(s.claimed).map((x) => int(x, 0, 64, -1)).filter((x) => x >= 0))],
      damage: arr(s.damage).slice(0, 64).map((p) => arr(p)).filter((p) => p.length === 2)
        .map((p) => [int(p[0], 0, 100000, 0), num(p[1], 0, 1e9, 0)] as [number, number]),
    };
  }

  const se = obj(r.settings);
  const ds = defaultSettings();
  d.settings = {
    master: num(se.master, 0, 1, ds.master), music: num(se.music, 0, 1, ds.music), sfx: num(se.sfx, 0, 1, ds.sfx),
    muted: bool(se.muted, false),
    quality: se.quality === 'low' || se.quality === 'high' || se.quality === 'medium' ? se.quality : 'medium',
    particles: bool(se.particles, true), shake: bool(se.shake, true), reducedMotion: bool(se.reducedMotion, false),
    keepFavorites: bool(se.keepFavorites, true), fastHatch: bool(se.fastHatch, false), showFps: bool(se.showFps, false),
  };
  d.golemCounter = int(r.golemCounter, 0, 7, 0);
  d.savedAt = int(r.savedAt, 0, 1e15, 0);
  return { ok: true, data: d, repaired };
}

// ───────── Bitset helpers for compact mined-cell storage ─────────
export function bitsetToB64(bits: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bits.length; i++) s += String.fromCharCode(bits[i]);
  return btoa(s);
}
export function b64ToBitset(b64: string, byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  if (!b64) return out;
  try {
    const s = atob(b64);
    for (let i = 0; i < Math.min(byteLen, s.length); i++) out[i] = s.charCodeAt(i);
  } catch {
    /* corrupted → treat as untouched */
  }
  return out;
}
