/**
 * Approximate economy simulation. A greedy bot digs ordinary cells in the
 * current best biome, sells when full (with a fixed walk overhead), and buys
 * tool/bag/egg/gate upgrades in a simple priority order. Prints a pacing table.
 * These are model estimates for tuning — not measured playtest results.
 */
import { describe, expect, it } from 'vitest';
import { BAGS, BIOMES, BIOME_ORDER, MATERIALS, TOOLS, EGG_BY_ID } from '../src/data/balance';
import * as L from '../src/core/logic';
import { createDefaultSave } from '../src/core/state';
import { mulberry32 } from '../src/core/rng';

function simulate(withPets: boolean, minutes = 60) {
  const s = createDefaultSave(99);
  const rng = mulberry32(7);
  let t = 0;
  const events: { t: number; what: string }[] = [];
  const log = (what: string) => events.push({ t, what });
  const SELL_TRIP = 12; // seconds walking to camp & back
  const PER_CELL_MOVE = 0.35; // seconds retargeting between cells
  while (t < minutes * 60) {
    const biome = [...s.unlocked].sort((a, b) => BIOME_ORDER.indexOf(b) - BIOME_ORDER.indexOf(a))[0];
    // typical cell: weighted average material from that biome
    const mats = MATERIALS.filter((m) => m.biome === biome && m.minToolTier <= s.toolTier);
    const m = mats[Math.floor(rng() * mats.length)];
    const hp = L.cellMaxHp(m, biome, s.stats.cells);
    const team = L.teamStats(s);
    let dealt = 0;
    let hits = 0;
    while (dealt < hp) { dealt += L.computeDamage(s, m, team) + L.golemTick(s, team); hits++; }
    t += hits * L.toolInterval(s) + PER_CELL_MOVE;
    if (!L.canStore(s, m, team)) {
      t += SELL_TRIP;
      const r = L.sellBag(s);
      if (r.ok && s.stats.sells === 1) log(`first sale (${r.coins}c)`);
      // shopping
      for (let k = 0; k < 6; k++) {
        const nextTool = TOOLS[s.toolTier + 1];
        const nextBag = BAGS[s.bagTier + 1];
        const nextBiome = BIOME_ORDER.find((b) => !s.unlocked.includes(b));
        if (nextBiome) {
          // assume relic requirements are met by exploring (relics are seeded, not rolls)
          const rb = BIOMES[nextBiome].relicReq;
          if (rb) for (let i = 1; i <= rb.count; i++) s.collection[`${rb.biome}_r${i}`] = 1;
          if (L.unlockBiome(s, nextBiome).ok) { log(`unlock ${BIOMES[nextBiome].name}`); continue; }
        }
        if (nextTool && s.coins >= nextTool.price && (!nextBiome || s.coins - nextTool.price > 0)) { L.buyTool(s); log(`tool → ${TOOLS[s.toolTier].name}`); continue; }
        if (nextBag && s.coins >= nextBag.price) { L.buyBag(s); log(`bag → ${BAGS[s.bagTier].capacity}`); continue; }
        if (withPets) {
          const egg = EGG_BY_ID[BIOMES[biome].egg];
          if (s.coins >= egg.cost && s.pets.length < 20) {
            const h = L.resolveHatch(s, egg.id);
            L.finishHatch(s);
            if (h.ok) { if (s.stats.hatches === 1) log('first purchased hatch'); L.equipBest(s); continue; }
          }
        }
        break;
      }
    }
    if (L.canStore(s, m)) {
      L.storeMaterial(s, m);
      s.stats.cells++;
      if (withPets) L.awardPetXp(s, 1);
    }
    if (withPets && s.stats.cells === 5 && !s.starterHatched) { L.resolveStarterHatch(s); L.finishHatch(s); }
  }
  return { s, events };
}

describe('economy simulation', () => {
  it('progresses through all biomes within a reasonable time', () => {
    for (const withPets of [false, true]) {
      const { s, events } = simulate(withPets, 120);
      const fmt = (x: number) => `${Math.floor(x / 60)}m${String(Math.floor(x % 60)).padStart(2, '0')}s`;
      console.log(`\n=== Simulation ${withPets ? 'WITH' : 'WITHOUT'} pets (model estimate) ===`);
      for (const e of events) console.log(fmt(e.t).padStart(8), e.what);
      console.log(`coins earned ${s.stats.coinsEarned}, cells ${s.stats.cells}, pets ${s.pets.length}`);
      expect(s.unlocked.length).toBeGreaterThanOrEqual(3);
      const first = events.find((e) => e.what.startsWith('tool'));
      expect(first && first.t < 150).toBe(true);
    }
  });
});
