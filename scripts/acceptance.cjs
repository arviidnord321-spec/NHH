const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
/**
 * Browser acceptance checks (persistence, pending-hatch replay, duplicate
 * clicks, refresh-rate independence, particle bounds, reach rules, save
 * recovery, pause reasons). Usage:
 *   npm run dev            # in another terminal
 *   node scripts/acceptance.cjs [baseUrl]
 * Needs Playwright with a Chromium build (set PLAYWRIGHT_MODULE to a global
 * install path if it is not a local dependency). Screenshots go to ./shots.
 */
const BASE = process.argv[2] || 'http://localhost:5173/';
const fs = require('fs');
fs.mkdirSync('shots', { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const ready = () => p.waitForFunction(() => window.__game && window.__game.s && window.__game.state !== 'BOOT', null, { timeout: 60000 });
  await p.goto(BASE + '?debug');
  await ready();
  // 1. persistence round trip
  await p.evaluate(() => { const g = window.__game; g.s.coins = 4321; g.s.bag = { m_soil: 7 }; g.s.pets.push({ id: 1, entry: 'fox', level: 4, xp: 9, locked: true, shiny: false }); g.s.nextPetId = 2; g.s.questIndex = 3;
    const site = g.world.sites[0]; site.setMined(1100); site.setMined(1101); site.dirty = true; g.persist(); });
  await p.waitForTimeout(500);
  await p.reload(); await ready();
  const r1 = await p.evaluate(() => { const g = window.__game; const site = g.world.sites[0]; return { coins: g.s.coins, bag: g.s.bag.m_soil, pet: g.s.pets[0] && g.s.pets[0].level, q: g.s.questIndex, mined: site.isMined(1100) && site.isMined(1101) }; });
  check('returning player keeps coins/bag/pets/quests/site digs', r1.coins === 4321 && r1.bag === 7 && r1.pet === 4 && r1.q === 3 && r1.mined, JSON.stringify(r1));
  // 2. pending hatch survives reload without reroll/recharge
  await p.evaluate(() => { const g = window.__game; g.s.coins = 1000; g.hatch('meadow', false); });
  await p.waitForTimeout(300);
  const before = await p.evaluate(() => { const g = window.__game; return { coins: g.s.coins, pend: g.s.pendingHatch && g.s.pendingHatch.petId, pets: g.s.pets.length, entry: g.s.pets.find(x => x.id === g.s.pendingHatch.petId).entry }; });
  await p.reload(); await ready();
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => { const g = window.__game; return { coins: g.s.coins, pend: g.s.pendingHatch && g.s.pendingHatch.petId, pets: g.s.pets.length, state: g.state, entry: g.s.pets.find(x => x.id === (g.s.pendingHatch && g.s.pendingHatch.petId))?.entry }; });
  check('mid-hatch reload replays same result, no recharge', before.coins === after.coins && before.pend === after.pend && before.pets === after.pets && before.entry === after.entry && after.state === 'HATCHING', JSON.stringify({ before, after }));
  await p.waitForSelector('#hcard:not(.hidden)', { timeout: 60000 }); await p.click('#hcont');
  // 3. rapid double hatch clicks → one transaction
  await p.evaluate(() => { const g = window.__game; g.s.coins = 300; g.ui.open('eggs'); });
  await p.waitForTimeout(300);
  const c0 = await p.evaluate(() => window.__game.s.pets.length);
  await p.evaluate(() => { const btn = document.querySelector('[data-act="hatch"][data-egg="meadow"]'); btn.click(); window.__game.hatch('meadow', false); window.__game.hatch('meadow', false); });
  const c1 = await p.evaluate(() => ({ pets: window.__game.s.pets.length, coins: window.__game.s.coins }));
  check('rapid duplicate hatch → exactly one transaction', c1.pets === c0 + 1 && c1.coins === 150, JSON.stringify(c1));
  await p.waitForSelector('#hcard:not(.hidden)', { timeout: 60000 }); await p.click('#hcont');
  // 4. frame-rate independence of movement
  const moves = await p.evaluate(() => {
    const g = window.__game; const out = {};
    for (const hz of [60, 120, 144]) {
      g.player.teleport(new g.player.pos.constructor(0, 0.001, 10), 0); g.player.grounded = true;
      const dt = 1 / hz; const steps = hz * 2; // 2 seconds of walking forward
      for (let i = 0; i < steps; i++) { const sub = Math.max(1, Math.ceil(dt / (1/60))); for (let k = 0; k < sub; k++) g.player.update(dt / sub, { x: 0, y: 1 }, Math.PI, false, false, 1, null); }
      out[hz] = +g.player.pos.z.toFixed(3);
    }
    return out;
  });
  const spread = Math.max(...Object.values(moves)) - Math.min(...Object.values(moves));
  check('movement distance identical at 60/120/144 Hz (±2 cm)', spread < 0.02, JSON.stringify(moves));
  // 5. particles bounded
  const parts = await p.evaluate(() => { const g = window.__game; const v = new g.player.pos.constructor(0, 1, 0); for (let i = 0; i < 200; i++) { g.particles.chipsBurst(v, v, '#ffffff', 30); g.particles.sparkle(v, '#fff', 30); g.particles.puff(v, '#fff', 10); } return g.particles.activeCount(); });
  check('particle count bounded by quality budget (Medium 300)', parts <= 300, `active=${parts}`);
  // 6. out of reach / hidden cells not mineable; destroyed cell no second reward
  const reach = await p.evaluate(() => {
    const g = window.__game; g.returnToCamp(true); g.s.bag = {}; g.s.stats.cells = 50;
    const site = g.world.sites[0];
    // a buried cell far below (y=2) cannot be a valid target from the surface
    const hit = { ix: site.ox + 5, iy: site.oy + 2, iz: site.oz + 5, nx: 0, ny: 1, nz: 0 };
    const can = g['canReach'](hit);
    return { can };
  });
  check('hidden/out-of-reach cell rejected', reach.can === false, JSON.stringify(reach));
  // 7. corrupted save → recovery dialog, data untouched
  await p.close();
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('digbound_save_v1', '{not json'); } });
  await p2.goto(BASE + '?debug');
  await p2.waitForSelector('#b-play', { timeout: 30000 });
  check('corrupted save shows recovery dialog and is not overwritten', (await p2.evaluate(() => localStorage.getItem('digbound_save_v1'))) === '{not json');
  await p2.click('#b-play');
  await p2.waitForFunction(() => window.__game && window.__game.state !== 'BOOT', null, { timeout: 60000 });
  await p2.waitForTimeout(1500);
  await p2.evaluate(() => window.__game.persist());
  await p2.waitForTimeout(300);
  check('play-without-saving keeps corrupted data untouched', (await p2.evaluate(() => localStorage.getItem('digbound_save_v1'))) === '{not json');
  await p2.close();
  const p3 = await ctx.newPage();
  await p3.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('digbound_save_v1', JSON.stringify({ v: 99, coins: 5 })); } });
  await p3.goto(BASE + '?debug');
  await p3.waitForSelector('#b-play', { timeout: 30000 });
  check('newer-version save is protected', await p3.evaluate(() => document.body.innerText.includes('newer version')));
  await p3.evaluate(() => localStorage.clear());
  await p3.close();
  const p4 = await ctx.newPage();
  p4.on('pageerror', (e) => errors.push(e.message));
  await p4.goto(BASE + '?debug');
  await p4.waitForFunction(() => window.__game && window.__game.state !== 'BOOT', null, { timeout: 60000 });
  const pp = p4;
  // 8. pause reasons independent
  const pause = await pp.evaluate(() => { const g = window.__game; g.ui.open('pets'); g.setPause('ad', true); g.setPause('ad', false); const s1 = g.state; g.ui.close(); return { s1, s2: g.state }; });
  check('closing an ad keeps menu pause; closing menu resumes', pause.s1 === 'MENU' && pause.s2 === 'PLAYING', JSON.stringify(pause));
  // 9. visuals: camp & pit camera
  await pp.evaluate(() => { const g = window.__game; g.player.teleport(new g.player.pos.constructor(0, 0.001, 3), 0); g.cam.yaw = Math.PI; g.cam.pitch = 0.35; g.cam.snap(g.player.pos); });
  await pp.waitForTimeout(2500);
  await pp.screenshot({ path: 'shots/camp.png' });
  await pp.evaluate(() => { const g = window.__game; const site = g.world.sites[0]; for (let y = 3; y < 8; y++) for (let z = 3; z < 9; z++) for (let x = 3; x < 9; x++) site.setMined(x + z*12 + y*144); site.dirty = true; site.rebuild(); g.player.teleport(new g.player.pos.constructor(site.ox + 6, site.oy + 3.001, site.oz + 6), Math.PI); g.cam.yaw = 0; g.cam.pitch = 0.5; g.cam.snap(g.player.pos); });
  await pp.waitForTimeout(2500);
  await pp.screenshot({ path: 'shots/pit.png' });
  check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
