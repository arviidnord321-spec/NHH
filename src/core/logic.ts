/**
 * Pure gameplay rules operating on SaveData. No rendering, no DOM — these are
 * covered by the unit tests and the economy simulation.
 */
import {
  ACHIEVEMENTS, BAGS, BIOMES, BIOME_ORDER, BiomeId, CAPS, COLLECTIBLES, CONTRACT, COSMETICS, DISPLAY_REWARD,
  EGG_BY_ID, LANTERN, MATERIAL_BY_ID, MATERIALS, MaterialDef, PET_ENTRY_BY_ID, PICKAXE, QUEST_CHAIN, QuestType,
  SCAN, SECRET_CHAMBER_GEMS, SPECIES, STARTER_EGG, TOOLS, MOVE, UtilityKind,
} from '../data/balance';
import { mulberry32, pickWeighted, Rng } from './rng';
import type { PetInstance, SaveData } from './state';

export type Fail = { ok: false; reason: string };
export type Ok<T = {}> = { ok: true } & T;

// ───────── Currency ─────────
export function addCoins(s: SaveData, n: number): number {
  const amt = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  s.coins = Math.min(CAPS.maxCoins, s.coins + amt);
  s.stats.coinsEarned = Math.min(1e12, s.stats.coinsEarned + amt);
  return amt;
}
export function addGems(s: SaveData, n: number): number {
  const amt = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  s.gems = Math.min(CAPS.maxGems, s.gems + amt);
  return amt;
}

// ───────── Pets ─────────
export function speciesOf(p: PetInstance) {
  return SPECIES[PET_ENTRY_BY_ID[p.entry].species];
}

/** Pet dig bonus as a fraction: base + 0.5 pp per level above 1 + shiny 3 pp. */
export function petDigBonus(p: PetInstance): number {
  const sp = speciesOf(p);
  return sp.digBonus + (p.level - 1) * (CAPS.levelBonusPP / 100) + (p.shiny ? CAPS.shinyBonusPP / 100 : 0);
}

export function xpToNext(level: number): number {
  return 25 * level;
}

export function equipSlots(s: SaveData): number {
  let n = 2;
  if (s.unlocked.includes('crystal')) n++;
  if (s.displaysClaimed.length > 0) n++;
  return Math.min(CAPS.maxTeam, n);
}

export interface TeamStats {
  digSum: number; // sum of equipped base dig bonuses (uncapped)
  mineralDmg: number;
  basaltDmg: number;
  sale: number;
  speed: number;
  scanRadius: number;
  scanCooldownMul: number;
  bag: number;
  golem: boolean;
  utilities: UtilityKind[];
}

export function equippedPets(s: SaveData): PetInstance[] {
  return s.equipped.map((id) => s.pets.find((p) => p.id === id)).filter((p): p is PetInstance => !!p);
}

/**
 * Utility effects from the same base species apply once (highest-level copy);
 * different species combine. Dig bonuses add within their category.
 */
export function teamStats(s: SaveData): TeamStats {
  const t: TeamStats = { digSum: 0, mineralDmg: 0, basaltDmg: 0, sale: 0, speed: 0, scanRadius: 0, scanCooldownMul: 1, bag: 0, golem: false, utilities: [] };
  const seen = new Set<string>();
  const team = equippedPets(s).sort((a, b) => b.level - a.level || a.id - b.id);
  for (const p of team) {
    t.digSum += petDigBonus(p);
    const sp = speciesOf(p);
    if (seen.has(sp.id)) continue;
    seen.add(sp.id);
    t.utilities.push(sp.utility);
    switch (sp.utility) {
      case 'sale': t.sale += sp.utilityValue; break;
      case 'speed': t.speed += sp.utilityValue; break;
      case 'scanRadius': t.scanRadius += sp.utilityValue; break;
      case 'mineralDmg': t.mineralDmg += sp.utilityValue; break;
      case 'basaltDmg': t.basaltDmg += sp.utilityValue; break;
      case 'bag': t.bag += sp.utilityValue; break;
      case 'golemHit': t.golem = true; break;
      case 'scanCooldown': t.scanCooldownMul *= 1 - sp.utilityValue; break;
    }
  }
  return t;
}

export function bagCapacity(s: SaveData, t = teamStats(s)): number {
  return BAGS[s.bagTier].capacity + t.bag;
}
export function bagCount(s: SaveData): number {
  let n = 0;
  for (const v of Object.values(s.bag)) n += v;
  return n;
}
export function scanRadius(s: SaveData, t = teamStats(s)): number {
  return SCAN.radius + t.scanRadius;
}
export function scanCooldown(s: SaveData, t = teamStats(s)): number {
  return SCAN.cooldown * t.scanCooldownMul;
}
export function moveSpeedMul(s: SaveData, t = teamStats(s)): number {
  return 1 + t.speed;
}

// ───────── Digging ─────────
export function materialToolModifier(m: MaterialDef, tool: 'shovel' | 'pickaxe'): number {
  if (tool !== 'pickaxe') return 1;
  return m.category === 'soil' ? PICKAXE.soilMul : PICKAXE.mineralMul;
}

/** Total pet dig bonus for a material (category bonuses added before the cap). */
export function totalPetDigBonus(m: MaterialDef, t: TeamStats): number {
  let sum = t.digSum;
  if (m.category === 'mineral') sum += t.mineralDmg;
  if (m.category === 'basalt') sum += t.basaltDmg;
  return Math.min(CAPS.petDigBonus, sum);
}

/** damage = toolPower × materialToolModifier × (1 + totalPetDigBonus) */
export function computeDamage(s: SaveData, m: MaterialDef, t = teamStats(s)): number {
  const tool = TOOLS[s.toolTier];
  return tool.power * materialToolModifier(m, s.activeTool) * (1 + totalPetDigBonus(m, t));
}

export function toolInterval(s: SaveData): number {
  return TOOLS[s.toolTier].interval;
}

export function cellMaxHp(m: MaterialDef, biome: BiomeId, cellsBroken: number): number {
  const hp = BIOMES[biome].baseHp * m.hpMul;
  return cellsBroken < 5 && biome === 'meadow' ? Math.min(hp, 10) : hp;
}

export function unitValue(m: MaterialDef): number {
  const biome = m.biome === 'any' ? 'meadow' : m.biome;
  return Math.round(BIOMES[biome].baseValue * m.valueMul);
}

/** Can the bag accept this material's units? */
export function canStore(s: SaveData, m: MaterialDef, t = teamStats(s)): boolean {
  return bagCount(s) + m.units <= bagCapacity(s, t);
}

/**
 * Golem: deterministic every-8th-hit bonus. Returns extra damage (0 if none).
 * Counter resets only after triggering.
 */
export function golemTick(s: SaveData, t: TeamStats): number {
  if (!t.golem) return 0;
  s.golemCounter++;
  if (s.golemCounter >= 8) {
    s.golemCounter = 0;
    return TOOLS[s.toolTier].power * 0.5;
  }
  return 0;
}

/** Grant extraction reward (assumes canStore checked). */
export function storeMaterial(s: SaveData, m: MaterialDef): void {
  s.bag[m.id] = (s.bag[m.id] ?? 0) + m.units;
}

/** Award XP to equipped pets; returns pets that levelled up. */
export function awardPetXp(s: SaveData, xp: number): PetInstance[] {
  const ups: PetInstance[] = [];
  for (const p of equippedPets(s)) {
    if (p.level >= CAPS.petMaxLevel) continue;
    p.xp += xp;
    let leveled = false;
    while (p.level < CAPS.petMaxLevel && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      leveled = true;
    }
    if (p.level >= CAPS.petMaxLevel) p.xp = 0;
    if (leveled) ups.push(p);
  }
  return ups;
}

// ───────── Selling ─────────
export function bagSaleValue(s: SaveData, t = teamStats(s)): number {
  let base = 0;
  for (const [id, n] of Object.entries(s.bag)) {
    const m = MATERIAL_BY_ID[id];
    if (m) base += unitValue(m) * n;
  }
  return Math.floor(base * (1 + Math.min(CAPS.petSaleBonus, t.sale)));
}

export function sellBag(s: SaveData): Fail | Ok<{ coins: number; units: number }> {
  const units = bagCount(s);
  if (units <= 0) return { ok: false, reason: 'Your bag is empty.' };
  const coins = bagSaleValue(s);
  s.bag = {};
  addCoins(s, coins);
  s.stats.sells++;
  return { ok: true, coins, units };
}

// ───────── Purchases ─────────
export function buyTool(s: SaveData): Fail | Ok<{ tier: number }> {
  const next = s.toolTier + 1;
  if (next >= TOOLS.length) return { ok: false, reason: 'Already at the best shovel.' };
  const price = TOOLS[next].price;
  if (s.coins < price) return { ok: false, reason: `Need ${price - s.coins} more coins.` };
  s.coins -= price;
  s.toolTier = next;
  return { ok: true, tier: next };
}
export function buyBag(s: SaveData): Fail | Ok<{ tier: number }> {
  const next = s.bagTier + 1;
  if (next >= BAGS.length) return { ok: false, reason: 'Already at the biggest bag.' };
  const price = BAGS[next].price;
  if (s.coins < price) return { ok: false, reason: `Need ${price - s.coins} more coins.` };
  s.coins -= price;
  s.bagTier = next;
  return { ok: true, tier: next };
}
export function buyPickaxe(s: SaveData): Fail | Ok {
  if (s.hasPickaxe) return { ok: false, reason: 'Already owned.' };
  if (!s.unlocked.includes(PICKAXE.requiresBiome)) return { ok: false, reason: 'Unlock Crystal Hollow first.' };
  if (s.coins < PICKAXE.price) return { ok: false, reason: `Need ${PICKAXE.price - s.coins} more coins.` };
  s.coins -= PICKAXE.price;
  s.hasPickaxe = true;
  return { ok: true };
}
export function buyLantern(s: SaveData): Fail | Ok {
  if (s.hasLantern) return { ok: false, reason: 'Already owned.' };
  if (s.coins < LANTERN.price) return { ok: false, reason: `Need ${LANTERN.price - s.coins} more coins.` };
  s.coins -= LANTERN.price;
  s.hasLantern = true;
  return { ok: true };
}
export function buyCosmetic(s: SaveData, id: string): Fail | Ok {
  const c = COSMETICS.find((x) => x.id === id);
  if (!c || !c.purchasable) return { ok: false, reason: 'Not for sale.' };
  if (s.cosmetics.owned.includes(id)) return { ok: false, reason: 'Already owned.' };
  if (s.gems < c.gems) return { ok: false, reason: `Need ${c.gems - s.gems} more gems.` };
  s.gems -= c.gems;
  s.cosmetics.owned.push(id);
  return { ok: true };
}

// ───────── Biomes ─────────
export function relicCount(s: SaveData, biome: BiomeId): number {
  return COLLECTIBLES.filter((c) => c.biome === biome && c.kind === 'relic' && (s.collection[c.id] ?? 0) > 0).length;
}

export function gateRequirement(s: SaveData, biome: BiomeId): { coinsOk: boolean; relicOk: boolean; missing: string[] } {
  const b = BIOMES[biome];
  const missing: string[] = [];
  const coinsOk = s.coins >= b.unlockCost;
  if (!coinsOk) missing.push(`${(b.unlockCost - s.coins).toLocaleString('en-US')} more coins`);
  let relicOk = true;
  if (b.relicReq) {
    const have = relicCount(s, b.relicReq.biome);
    relicOk = have >= b.relicReq.count;
    if (!relicOk) {
      const bn = BIOMES[b.relicReq.biome].name;
      missing.push(b.relicReq.count >= 3 ? `complete ${bn} relic display (${have}/3 shards)` : `${b.relicReq.count} ${bn} relic shard (${have}/${b.relicReq.count})`);
    }
  }
  return { coinsOk, relicOk, missing };
}

export function unlockBiome(s: SaveData, biome: BiomeId): Fail | Ok {
  if (s.unlocked.includes(biome)) return { ok: false, reason: 'Already open.' };
  const idx = BIOME_ORDER.indexOf(biome);
  if (idx > 0 && !s.unlocked.includes(BIOME_ORDER[idx - 1])) return { ok: false, reason: `Open ${BIOMES[BIOME_ORDER[idx - 1]].name} first.` };
  const req = gateRequirement(s, biome);
  if (req.missing.length) return { ok: false, reason: `Needs ${req.missing.join(' and ')}.` };
  s.coins -= BIOMES[biome].unlockCost; // relics are never consumed
  s.unlocked.push(biome);
  return { ok: true };
}

// ───────── Eggs ─────────
export type HatchResult = Ok<{ petId: number; entry: string; featured: boolean; guaranteed: boolean; isNew: boolean; usedToken: boolean }>;

export function eggAvailable(s: SaveData, eggId: string): boolean {
  const e = EGG_BY_ID[eggId];
  return !!e && s.unlocked.includes(e.biome);
}

/**
 * Resolve a hatch completely in one state transition BEFORE any reveal:
 * validate funds/space, deduct, roll, create pet, update pity, set pendingHatch.
 */
export function resolveHatch(s: SaveData, eggId: string, opts: { useToken?: boolean; rng?: Rng } = {}): Fail | HatchResult {
  if (s.pendingHatch) return { ok: false, reason: 'Finish the current hatch first.' };
  const egg = EGG_BY_ID[eggId];
  if (!egg) return { ok: false, reason: 'Unknown egg.' };
  if (!eggAvailable(s, eggId)) return { ok: false, reason: `Unlock ${BIOMES[egg.biome].name} first.` };
  if (s.pets.length >= CAPS.petInventory) return { ok: false, reason: `Pet inventory full (${CAPS.petInventory}). Release or merge pets first.` };
  const useToken = !!opts.useToken;
  if (useToken) {
    if ((s.eggTokens[eggId] ?? 0) <= 0) return { ok: false, reason: 'No egg token for this egg.' };
  } else if (s.coins < egg.cost) {
    return { ok: false, reason: `Need ${(egg.cost - s.coins).toLocaleString('en-US')} more coins.` };
  }

  let rng = opts.rng;
  if (!rng) {
    rng = mulberry32(s.hatchSeed);
  }
  const pityNow = s.pity[eggId] ?? 0;
  const guaranteed = pityNow >= CAPS.pityCount - 1;
  const featured = egg.outcomes[egg.featuredIndex];
  const outcome = guaranteed ? featured : pickWeighted(rng, egg.outcomes);
  if (!opts.rng) s.hatchSeed = Math.floor(rng() * 4294967296) >>> 0;

  // commit
  if (useToken) s.eggTokens[eggId] = (s.eggTokens[eggId] ?? 0) - 1;
  else s.coins -= egg.cost;
  const isFeatured = outcome.pet === featured.pet;
  s.pity[eggId] = isFeatured ? 0 : pityNow + 1;
  const isNew = !s.seenEntries.includes(outcome.pet);
  const pet = createPet(s, outcome.pet);
  s.pendingHatch = { egg: eggId, petId: pet.id, isNew };
  s.stats.hatches++;
  return { ok: true, petId: pet.id, entry: outcome.pet, featured: isFeatured, guaranteed, isNew, usedToken: useToken };
}

/** Tutorial grant: guaranteed Pebble Pup; never touches pity counters. */
export function resolveStarterHatch(s: SaveData): Fail | HatchResult {
  if (s.starterHatched) return { ok: false, reason: 'Starter egg already hatched.' };
  if (s.pendingHatch) return { ok: false, reason: 'Finish the current hatch first.' };
  const isNew = !s.seenEntries.includes(STARTER_EGG.pet);
  const pet = createPet(s, STARTER_EGG.pet);
  s.starterHatched = true;
  s.pendingHatch = { egg: 'starter', petId: pet.id, isNew };
  // auto-equip the very first pet so its help is felt immediately
  if (s.equipped.length < equipSlots(s)) s.equipped.push(pet.id);
  return { ok: true, petId: pet.id, entry: STARTER_EGG.pet, featured: false, guaranteed: true, isNew, usedToken: false };
}

export function finishHatch(s: SaveData): void {
  const ph = s.pendingHatch;
  if (!ph) return;
  const pet = s.pets.find((p) => p.id === ph.petId);
  if (pet && !s.seenEntries.includes(pet.entry)) s.seenEntries.push(pet.entry);
  s.pendingHatch = null;
}

function createPet(s: SaveData, entry: string): PetInstance {
  const p: PetInstance = { id: s.nextPetId++, entry, level: 1, xp: 0, locked: false, shiny: false };
  s.pets.push(p);
  return p;
}

// ───────── Pet inventory actions ─────────
export function equipPet(s: SaveData, id: number): Fail | Ok {
  if (!s.pets.some((p) => p.id === id)) return { ok: false, reason: 'Unknown pet.' };
  if (s.equipped.includes(id)) return { ok: false, reason: 'Already equipped.' };
  if (s.equipped.length >= equipSlots(s)) return { ok: false, reason: `All ${equipSlots(s)} team slots are full.` };
  s.equipped.push(id);
  return { ok: true };
}
export function unequipPet(s: SaveData, id: number): void {
  s.equipped = s.equipped.filter((x) => x !== id);
}
export function toggleLock(s: SaveData, id: number): void {
  const p = s.pets.find((x) => x.id === id);
  if (p) p.locked = !p.locked;
}

/** Equip Best: maximizes dig bonus; deterministic tie-break (level desc, id asc). */
export function equipBest(s: SaveData): number[] {
  const slots = equipSlots(s);
  const keep = s.settings.keepFavorites
    ? s.equipped.filter((id) => s.pets.find((p) => p.id === id)?.locked).slice(0, slots)
    : [];
  const ranked = s.pets
    .filter((p) => !keep.includes(p.id))
    .sort((a, b) => petDigBonus(b) - petDigBonus(a) || b.level - a.level || a.id - b.id);
  s.equipped = [...keep, ...ranked.slice(0, slots - keep.length).map((p) => p.id)];
  return s.equipped;
}

export function releasePet(s: SaveData, id: number): Fail | Ok<{ coins: number }> {
  const p = s.pets.find((x) => x.id === id);
  if (!p) return { ok: false, reason: 'Unknown pet.' };
  if (p.locked) return { ok: false, reason: 'Unlock this favorite first.' };
  if (s.equipped.includes(id)) return { ok: false, reason: 'Unequip it first.' };
  if (s.pendingHatch?.petId === id) return { ok: false, reason: 'Pet is still hatching.' };
  s.pets = s.pets.filter((x) => x.id !== id);
  const coins = 10 * p.level;
  addCoins(s, coins);
  return { ok: true, coins };
}

/** Candidates for a merge: unlocked, unequipped, non-shiny copies of one entry. */
export function mergeCandidates(s: SaveData, entry: string): PetInstance[] {
  return s.pets
    .filter((p) => p.entry === entry && !p.shiny && !p.locked && !s.equipped.includes(p.id) && s.pendingHatch?.petId !== p.id)
    .sort((a, b) => b.level - a.level || b.xp - a.xp || a.id - b.id);
}

/** Merge exactly three duplicates into one Shiny copy, atomically. */
export function mergePets(s: SaveData, ids: number[]): Fail | Ok<{ petId: number }> {
  if (new Set(ids).size !== 3) return { ok: false, reason: 'Select exactly three pets.' };
  const pets = ids.map((id) => s.pets.find((p) => p.id === id));
  if (pets.some((p) => !p)) return { ok: false, reason: 'Unknown pet.' };
  const ps = pets as PetInstance[];
  const entry = ps[0].entry;
  for (const p of ps) {
    if (p.entry !== entry) return { ok: false, reason: 'Pets must be the same species and variant.' };
    if (p.shiny) return { ok: false, reason: 'Shiny pets cannot be merged again.' };
    if (p.locked) return { ok: false, reason: 'Locked favorites cannot be merged.' };
    if (s.equipped.includes(p.id)) return { ok: false, reason: 'Unequip pets before merging.' };
  }
  const best = [...ps].sort((a, b) => b.level - a.level || b.xp - a.xp)[0];
  s.pets = s.pets.filter((p) => !ids.includes(p.id));
  const shiny: PetInstance = { id: s.nextPetId++, entry, level: best.level, xp: best.xp, locked: false, shiny: true };
  s.pets.push(shiny);
  return { ok: true, petId: shiny.id };
}

// ───────── Quests ─────────
export function currentQuest(s: SaveData) {
  return QUEST_CHAIN[s.questIndex] ?? null;
}

/** Returns the completed quest (and applies its reward) if the step finished. */
export function progressQuest(s: SaveData, type: QuestType, amount = 1, absolute = false) {
  const q = currentQuest(s);
  if (!q || q.type !== type) return null;
  s.questProgress = absolute ? Math.max(s.questProgress, amount) : s.questProgress + amount;
  if (s.questProgress < q.target) return null;
  s.questIndex++;
  s.questProgress = 0;
  if (q.reward.coins) addCoins(s, q.reward.coins);
  if (q.reward.gems) addGems(s, q.reward.gems);
  return q;
}

/** Some quest steps are state-based; re-check them (e.g. after load). */
export function syncStateQuests(s: SaveData) {
  const done = [];
  for (let i = 0; i < 4; i++) {
    const q = currentQuest(s);
    if (!q) break;
    let r = null;
    if (q.type === 'hatchStarter' && s.starterHatched) r = progressQuest(s, 'hatchStarter', 1, true);
    else if (q.type === 'upgradeTool' && s.toolTier > 0) r = progressQuest(s, 'upgradeTool', 1, true);
    else if (q.type === 'equipTeam' && s.equipped.length >= q.target) r = progressQuest(s, 'equipTeam', s.equipped.length, true);
    else if (q.type === 'unlock' && s.unlocked.includes('crystal')) r = progressQuest(s, 'unlock', 1, true);
    if (!r) break;
    done.push(r);
  }
  return done;
}

// ───────── Achievements ─────────
export function achievementStat(s: SaveData, stat: string): number {
  switch (stat) {
    case 'cells': return s.stats.cells;
    case 'treasures': return s.stats.treasures;
    case 'hatches': return s.stats.hatches;
    case 'coinsEarned': return s.stats.coinsEarned;
    case 'scans': return s.stats.scans;
    case 'species': return new Set(s.pets.map((p) => PET_ENTRY_BY_ID[p.entry].species)).size;
    case 'maxPetLevel': return s.pets.reduce((m, p) => Math.max(m, p.level), 0);
    case 'displays': return s.displaysClaimed.length;
    case 'biomes': return s.unlocked.length;
    default: return 0;
  }
}
export function checkAchievements(s: SaveData) {
  const earned = [];
  for (const a of ACHIEVEMENTS) {
    if (s.achievements.includes(a.id)) continue;
    if (achievementStat(s, a.stat) >= a.target) {
      s.achievements.push(a.id);
      addGems(s, a.gems);
      earned.push(a);
    }
  }
  return earned;
}

// ───────── Museum ─────────
export function displayComplete(s: SaveData, biome: BiomeId): boolean {
  return relicCount(s, biome) >= 3;
}

/** Claims newly completed displays (once). Returns biomes newly completed. */
export function claimDisplays(s: SaveData): BiomeId[] {
  const out: BiomeId[] = [];
  for (const b of BIOME_ORDER) {
    if (!s.displaysClaimed.includes(b) && displayComplete(s, b)) {
      s.displaysClaimed.push(b);
      addGems(s, DISPLAY_REWARD.gems);
      addCoins(s, BIOMES[b].baseValue * DISPLAY_REWARD.coinsMul);
      out.push(b);
    }
  }
  return out;
}

export function claimChamber(s: SaveData, biome: BiomeId): Fail | Ok<{ gems: number }> {
  if (!s.displaysClaimed.includes(biome)) return { ok: false, reason: 'Complete this biome’s relic display first.' };
  if (s.chambersClaimed.includes(biome)) return { ok: false, reason: 'Already claimed.' };
  s.chambersClaimed.push(biome);
  addGems(s, SECRET_CHAMBER_GEMS);
  return { ok: true, gems: SECRET_CHAMBER_GEMS };
}

export function claimFinal(s: SaveData): Fail | Ok {
  if (s.finalClaimed) return { ok: false, reason: 'Already claimed.' };
  if (s.displaysClaimed.length < 4) return { ok: false, reason: 'Complete all four museum displays.' };
  s.finalClaimed = true;
  s.cosmetics.crown = true;
  if (!s.cosmetics.owned.includes('crown_aurora')) s.cosmetics.owned.push('crown_aurora');
  addGems(s, 100);
  return { ok: true };
}

// ───────── Contracts ─────────
export function contractOffers(s: SaveData): import('./state').Contract[] {
  const rng = mulberry32(s.contractSeed);
  const offers: import('./state').Contract[] = [];
  const biomes = s.unlocked;
  const b1 = biomes[Math.floor(rng() * biomes.length)];
  const mats = MATERIALS.filter((m) => m.biome === b1 && m.units === 1 && !m.indestructible);
  const mat = mats[Math.floor(rng() * mats.length)];
  offers.push({ kind: 'resource', biome: b1, material: mat.id, target: CONTRACT.resourceAmountByBiome[b1], progress: 0 });
  const b2 = biomes[Math.floor(rng() * biomes.length)];
  offers.push({ kind: 'cache', biome: b2, target: CONTRACT.cacheCount, progress: 0 });
  const relicBiomes = biomes.filter((b) => relicCount(s, b) > 0);
  if (relicBiomes.length) {
    const b3 = relicBiomes[Math.floor(rng() * relicBiomes.length)];
    offers.push({ kind: 'relic', biome: b3, target: 1, progress: 0 });
  }
  return offers;
}

export function contractReward(c: import('./state').Contract): { coins: number; gems: number } {
  const bv = BIOMES[c.biome].baseValue;
  return { coins: bv * CONTRACT.rewardMul[c.kind], gems: CONTRACT.gems[c.kind] };
}

export function acceptContract(s: SaveData, index: number): Fail | Ok {
  if (s.contract) return { ok: false, reason: 'Finish or abandon your current contract first.' };
  const offers = contractOffers(s);
  const c = offers[index];
  if (!c) return { ok: false, reason: 'Unknown contract.' };
  s.contract = { ...c };
  return { ok: true };
}

export function abandonContract(s: SaveData): void {
  s.contract = null;
  s.contractSeed = (Math.imul(s.contractSeed, 1664525) + 1013904223) >>> 0;
}

/** Progress contract; returns reward if completed (awarded once). */
export function progressContract(s: SaveData, ev: { kind: 'resource'; material: string; units: number } | { kind: 'cache'; biome: BiomeId } | { kind: 'relic'; biome: BiomeId }) {
  const c = s.contract;
  if (!c || c.kind !== ev.kind) return null;
  if (ev.kind === 'resource' && ev.material !== c.material) return null;
  if (ev.kind !== 'resource' && ev.biome !== c.biome) return null;
  c.progress += ev.kind === 'resource' ? ev.units : 1;
  if (c.progress < c.target) return null;
  const reward = contractReward(c);
  addCoins(s, reward.coins);
  addGems(s, reward.gems);
  s.contract = null;
  s.contractsDone++;
  s.contractSeed = (Math.imul(s.contractSeed, 1664525) + 1013904223) >>> 0;
  return reward;
}

export function walkSpeed(s: SaveData, sprint: boolean): number {
  return (sprint ? MOVE.sprint : MOVE.walk) * moveSpeedMul(s);
}
