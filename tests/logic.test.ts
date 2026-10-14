import { describe, expect, it } from 'vitest';
import { BAGS, CAPS, EGGS, MATERIAL_BY_ID, TOOLS } from '../src/data/balance';
import * as L from '../src/core/logic';
import { mulberry32 } from '../src/core/rng';
import { createDefaultSave, validateSave, bitsetToB64, b64ToBitset } from '../src/core/state';
import { generateSite, CELL_COUNT, EMPTY } from '../src/core/site';

const fresh = () => createDefaultSave(12345);

describe('eggs', () => {
  it('base distributions total 100%', () => {
    for (const e of EGGS) expect(e.outcomes.reduce((s, o) => s + o.weight, 0)).toBe(100);
  });

  it('20th hatch guarantees featured pet; counters are per egg', () => {
    const s = fresh();
    s.coins = 1e9;
    s.unlocked = ['meadow', 'crystal', 'ember', 'aurora'];
    // rng that always rolls the most common outcome
    const common = () => 0;
    for (let i = 0; i < 19; i++) {
      const r = L.resolveHatch(s, 'meadow', { rng: common });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.featured).toBe(false);
      L.finishHatch(s);
      s.pets = s.pets.slice(-5); // keep inventory below cap
    }
    expect(s.pity.meadow).toBe(19);
    expect(s.pity.geode).toBe(0);
    const r = L.resolveHatch(s, 'meadow', { rng: common });
    expect(r.ok && r.featured && r.guaranteed).toBe(true);
    if (r.ok) expect(r.entry).toBe('turtle');
    expect(s.pity.meadow).toBe(0);
  });

  it('featured pet from a normal roll resets the counter', () => {
    const s = fresh();
    s.coins = 1e6;
    s.pity.meadow = 7;
    const r = L.resolveHatch(s, 'meadow', { rng: () => 0.99 });
    expect(r.ok && r.featured && !r.guaranteed).toBe(true);
    expect(s.pity.meadow).toBe(0);
  });

  it('seeded distribution roughly matches 55/35/10', () => {
    const s = fresh();
    const rng = mulberry32(42);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) {
      s.coins = 1e6; s.pity.meadow = 0; s.pets = []; s.pendingHatch = null;
      const r = L.resolveHatch(s, 'meadow', { rng });
      if (r.ok) counts[r.entry] = (counts[r.entry] ?? 0) + 1;
    }
    expect(counts.pup / 20000).toBeGreaterThan(0.53);
    expect(counts.pup / 20000).toBeLessThan(0.57);
    expect(counts.turtle / 20000).toBeGreaterThan(0.09);
    expect(counts.turtle / 20000).toBeLessThan(0.11);
  });

  it('duplicate confirm while a hatch is pending is rejected (one transaction)', () => {
    const s = fresh();
    s.coins = 300;
    expect(L.resolveHatch(s, 'meadow').ok).toBe(true);
    expect(L.resolveHatch(s, 'meadow').ok).toBe(false);
    expect(s.coins).toBe(150);
    expect(s.pets.length).toBe(1);
  });

  it('pending hatch survives save/load without reroll or recharge', () => {
    const s = fresh();
    s.coins = 150;
    const r = L.resolveHatch(s, 'meadow');
    expect(r.ok).toBe(true);
    const loaded = validateSave(JSON.parse(JSON.stringify(s)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || !r.ok) return;
    expect(loaded.data.pendingHatch?.petId).toBe(r.petId);
    expect(loaded.data.coins).toBe(0);
    expect(L.resolveHatch(loaded.data, 'meadow').ok).toBe(false);
  });

  it('insufficient funds / full inventory consume nothing', () => {
    const s = fresh();
    s.coins = 149;
    expect(L.resolveHatch(s, 'meadow').ok).toBe(false);
    expect(s.coins).toBe(149);
    s.coins = 1000;
    for (let i = 0; i < CAPS.petInventory; i++) s.pets.push({ id: 1000 + i, entry: 'pup', level: 1, xp: 0, locked: false, shiny: false });
    expect(L.resolveHatch(s, 'meadow').ok).toBe(false);
    expect(s.coins).toBe(1000);
    expect(s.pity.meadow).toBe(0);
  });

  it('starter egg is a guaranteed pup and does not touch pity', () => {
    const s = fresh();
    const r = L.resolveStarterHatch(s);
    expect(r.ok && r.entry === 'pup').toBe(true);
    expect(s.pity).toEqual({ meadow: 0, geode: 0, ember: 0, aurora: 0 });
    L.finishHatch(s);
    expect(L.resolveStarterHatch(s).ok).toBe(false);
  });

  it('locked eggs require their biome', () => {
    const s = fresh();
    s.coins = 1e6;
    expect(L.resolveHatch(s, 'geode').ok).toBe(false);
  });
});

describe('digging & economy', () => {
  it('damage formula with capped additive pet bonus', () => {
    const s = fresh();
    const soil = MATERIAL_BY_ID.m_soil;
    expect(L.computeDamage(s, soil)).toBe(10);
    s.pets = [1, 2, 3, 4].map((id) => ({ id, entry: 'dragon', level: 10, xp: 0, locked: false, shiny: true }));
    s.equipped = [1, 2, 3, 4];
    // 4 × (0.18 + 0.045 + 0.03) = 1.02 → capped 0.75
    expect(L.computeDamage(s, soil)).toBeCloseTo(17.5);
  });

  it('pickaxe modifiers', () => {
    const s = fresh();
    s.hasPickaxe = true; s.activeTool = 'pickaxe';
    expect(L.computeDamage(s, MATERIAL_BY_ID.m_soil)).toBeCloseTo(7.5);
    expect(L.computeDamage(s, MATERIAL_BY_ID.m_stone)).toBeCloseTo(12.5);
  });

  it('utility stacking: same species applies once, material bonus adds before cap', () => {
    const s = fresh();
    s.pets = [
      { id: 1, entry: 'fox', level: 1, xp: 0, locked: false, shiny: false },
      { id: 2, entry: 'prism_fox', level: 3, xp: 0, locked: false, shiny: false },
    ];
    s.equipped = [1, 2];
    const t = L.teamStats(s);
    expect(t.mineralDmg).toBeCloseTo(0.1);
    expect(t.digSum).toBeCloseTo(0.1 + 0.11);
    expect(L.totalPetDigBonus(MATERIAL_BY_ID.m_stone, t)).toBeCloseTo(0.31);
    expect(L.totalPetDigBonus(MATERIAL_BY_ID.m_soil, t)).toBeCloseTo(0.21);
  });

  it('golem bonus triggers on every 8th hit and resets after', () => {
    const s = fresh();
    s.pets = [{ id: 1, entry: 'golem', level: 1, xp: 0, locked: false, shiny: false }];
    s.equipped = [1];
    const t = L.teamStats(s);
    const hits = Array.from({ length: 16 }, () => L.golemTick(s, t));
    expect(hits.filter((h) => h > 0).length).toBe(2);
    expect(hits[7]).toBe(TOOLS[0].power * 0.5);
    expect(s.golemCounter).toBe(0);
  });

  it('full bag blocks storing; selling clears exactly once', () => {
    const s = fresh();
    s.bag = { m_soil: BAGS[0].capacity };
    expect(L.canStore(s, MATERIAL_BY_ID.m_soil)).toBe(false);
    const r = L.sellBag(s);
    expect(r.ok && r.coins === 100).toBe(true);
    expect(s.coins).toBe(100);
    expect(L.sellBag(s).ok).toBe(false);
    expect(s.coins).toBe(100);
  });

  it('multi-unit node needs room for all units', () => {
    const s = fresh();
    s.bag = { m_soil: 18 };
    expect(L.canStore(s, MATERIAL_BY_ID.m_copper)).toBe(false); // 3 units
    expect(L.canStore(s, MATERIAL_BY_ID.m_soil)).toBe(true);
  });

  it('sale bonus is capped and applied once', () => {
    const s = fresh();
    s.bag = { m_soil: 10 };
    s.pets = [{ id: 1, entry: 'pup', level: 1, xp: 0, locked: false, shiny: false }, { id: 2, entry: 'cinder_pup', level: 1, xp: 0, locked: false, shiny: false }];
    s.equipped = [1, 2];
    expect(L.bagSaleValue(s)).toBe(Math.floor(50 * 1.05));
  });

  it('purchases deduct once and cannot go negative', () => {
    const s = fresh();
    s.coins = 100;
    expect(L.buyTool(s).ok).toBe(true);
    expect(L.buyTool(s).ok).toBe(false);
    expect(s.coins).toBe(10);
    expect(s.toolTier).toBe(1);
  });

  it('biome gate shows missing requirements and never consumes relics', () => {
    const s = fresh();
    s.coins = 1500;
    const r = L.unlockBiome(s, 'crystal');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/relic shard/);
    s.collection.meadow_r1 = 1;
    expect(L.unlockBiome(s, 'crystal').ok).toBe(true);
    expect(s.coins).toBe(300);
    expect(s.collection.meadow_r1).toBe(1);
    expect(L.equipSlots(s)).toBe(3);
  });

  it('pet XP levels carry excess', () => {
    const s = fresh();
    s.pets = [{ id: 1, entry: 'pup', level: 1, xp: 0, locked: false, shiny: false }];
    s.equipped = [1];
    L.awardPetXp(s, 30); // needs 25 → level 2 with 5 xp
    expect(s.pets[0].level).toBe(2);
    expect(s.pets[0].xp).toBe(5);
  });
});

describe('pet inventory', () => {
  it('equip best respects slot limit, tie-break and favorites', () => {
    const s = fresh();
    s.pets = [
      { id: 1, entry: 'pup', level: 1, xp: 0, locked: true, shiny: false },
      { id: 2, entry: 'golem', level: 1, xp: 0, locked: false, shiny: false },
      { id: 3, entry: 'dragon', level: 1, xp: 0, locked: false, shiny: false },
      { id: 4, entry: 'fox', level: 1, xp: 0, locked: false, shiny: false },
    ];
    s.equipped = [1];
    L.equipBest(s);
    expect(s.equipped).toEqual([1, 3]);
    s.settings.keepFavorites = false;
    L.equipBest(s);
    expect(s.equipped).toEqual([3, 2]);
  });

  it('merge consumes exactly three unlocked duplicates atomically', () => {
    const s = fresh();
    s.pets = [1, 2, 3, 4].map((id) => ({ id, entry: 'pup', level: id, xp: 0, locked: id === 4, shiny: false }));
    s.nextPetId = 5;
    expect(L.mergePets(s, [1, 2, 4]).ok).toBe(false);
    expect(s.pets.length).toBe(4);
    const r = L.mergePets(s, [1, 2, 3]);
    expect(r.ok).toBe(true);
    expect(s.pets.length).toBe(2);
    const shiny = s.pets.find((p) => p.shiny)!;
    expect(shiny.level).toBe(3);
    expect(L.mergePets(s, [shiny.id, 4, 1]).ok).toBe(false);
  });

  it('release cannot consume locked or equipped pets', () => {
    const s = fresh();
    s.pets = [{ id: 1, entry: 'pup', level: 1, xp: 0, locked: true, shiny: false }, { id: 2, entry: 'pup', level: 1, xp: 0, locked: false, shiny: false }];
    s.equipped = [2];
    expect(L.releasePet(s, 1).ok).toBe(false);
    expect(L.releasePet(s, 2).ok).toBe(false);
    expect(s.pets.length).toBe(2);
  });
});

describe('quests & contracts', () => {
  it('quest rewards are granted once', () => {
    const s = fresh();
    for (let i = 0; i < 4; i++) L.progressQuest(s, 'break');
    expect(s.coins).toBe(0);
    const q = L.progressQuest(s, 'break');
    expect(q?.id).toBe('q_break');
    expect(s.coins).toBe(20);
    expect(L.progressQuest(s, 'break')).toBe(null);
    expect(s.coins).toBe(20);
  });

  it('contract completes once', () => {
    const s = fresh();
    expect(L.acceptContract(s, 1).ok).toBe(true);
    const c = s.contract!;
    expect(L.progressContract(s, { kind: 'cache', biome: c.biome })).toBe(null);
    expect(L.progressContract(s, { kind: 'cache', biome: c.biome })).not.toBe(null);
    expect(s.contract).toBe(null);
    expect(L.progressContract(s, { kind: 'cache', biome: c.biome })).toBe(null);
  });
});

describe('save validation', () => {
  it('rejects malformed and newer saves', () => {
    expect(validateSave(null).ok).toBe(false);
    expect(validateSave('x').ok).toBe(false);
    const newer = validateSave({ v: 999 });
    expect(!newer.ok && newer.reason === 'newer').toBe(true);
  });

  it('bounds numbers, drops unknown ids, avoids NaN', () => {
    const r = validateSave({
      v: 1, coins: NaN, gems: -5, toolTier: 99, bag: { nope: 5, m_soil: 3 },
      pets: [{ id: 1, entry: 'pup', level: 50 }, { id: 1, entry: 'pup' }, { id: 2, entry: 'unicorn' }],
      equipped: [1, 1, 77], unlocked: ['meadow', 'mars'], settings: { master: 7, quality: 'ultra' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.coins).toBe(0);
    expect(r.data.gems).toBe(0);
    expect(r.data.toolTier).toBe(TOOLS.length - 1);
    expect(r.data.bag).toEqual({ m_soil: 3 });
    expect(r.data.pets.length).toBe(1);
    expect(r.data.pets[0].level).toBe(10);
    expect(r.data.equipped).toEqual([1]);
    expect(r.data.unlocked).toEqual(['meadow']);
    expect(r.data.settings.master).toBe(1);
    expect(r.data.settings.quality).toBe('medium');
  });

  it('round-trips a full save', () => {
    const s = fresh();
    s.coins = 1234; s.pets.push({ id: 1, entry: 'fox', level: 3, xp: 4, locked: true, shiny: false }); s.nextPetId = 2;
    s.sites.meadow_0 = { seed: 9, mined: bitsetToB64(new Uint8Array([1, 2, 3])), claimed: [0, 2], damage: [[5, 3.5]] };
    const r = validateSave(JSON.parse(JSON.stringify(s)));
    expect(r.ok && r.data.coins === 1234).toBe(true);
    if (r.ok) {
      expect(r.data.sites.meadow_0.claimed).toEqual([0, 2]);
      expect(Array.from(b64ToBitset(r.data.sites.meadow_0.mined, 3))).toEqual([1, 2, 3]);
      expect(JSON.stringify(r.data).length).toBeLessThan(200_000);
    }
  });
});

describe('site generation', () => {
  it('is deterministic per seed and places a relic in every site', () => {
    for (const b of ['meadow', 'crystal', 'ember', 'aurora'] as const) {
      for (let i = 0; i < 3; i++) {
        const a = generateSite(b, i, 777);
        const c = generateSite(b, i, 777);
        expect(Array.from(a.mats)).toEqual(Array.from(c.mats));
        expect(a.treasures).toEqual(c.treasures);
        expect(a.treasures.find((t) => t.kind === 'relic')?.relic).toBe(`${b}_r${i + 1}`);
        expect(a.mats.length).toBe(CELL_COUNT);
        for (const t of a.treasures) expect(a.mats[t.cell]).not.toBe(EMPTY);
      }
    }
  });

  it('different seeds produce different finds', () => {
    const a = generateSite('meadow', 0, 1);
    const b = generateSite('meadow', 0, 2);
    expect(a.treasures.map((t) => t.cell)).not.toEqual(b.treasures.map((t) => t.cell));
  });
});

import { sanitizeAvatar, DEFAULT_AVATAR } from '../src/core/avatarData';
describe('avatar', () => {
  it('sanitizes untrusted avatar data and round-trips through saves', () => {
    expect(sanitizeAvatar(null)).toEqual(DEFAULT_AVATAR);
    const a = sanitizeAvatar({ skin: '#123456', face: 'nope', hair: 'spiky', scarf: '', top: 'red', backpack: false });
    expect(a.skin).toBe('#123456');
    expect(a.face).toBe(DEFAULT_AVATAR.face);
    expect(a.hair).toBe('spiky');
    expect(a.scarf).toBe('');
    expect(a.top).toBe(DEFAULT_AVATAR.top);
    expect(a.backpack).toBe(false);
    const s = createDefaultSave(1);
    s.avatar = a; s.cameraFirstPerson = true;
    const r = validateSave(JSON.parse(JSON.stringify(s)));
    expect(r.ok && r.data.avatar.hair === 'spiky' && r.data.cameraFirstPerson).toBe(true);
  });
});
