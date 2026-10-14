/**
 * Renders the store preview videos from the real game engine with a virtual
 * clock (every frame is stepped exactly 1/30 s, so slow software rendering
 * still produces smooth footage).
 *   npm run build:standalone && node scripts/store-videos.cjs [landscape|portrait]
 * Output: store/preview-landscape.mp4 (1920x1080), store/preview-portrait.mp4 (1080x1920).
 * Needs Playwright + Chromium (set PLAYWRIGHT_MODULE for a global install) and ffmpeg.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const FILE = 'file://' + path.resolve('standalone/index.html') + '?debug';
const OUT = path.resolve('store');
const FPS = 30;
const SIZES = {
  landscape: { w: 1920, h: 1080, fov: 74 },
  portrait: { w: 1080, h: 1920, fov: 92 },
};

/** Installed after boot: virtual performance.now / rAF / timers + stepped CSS animations. */
function installVirtualTime() {
  const w = window;
  w.__vt = performance.now();
  performance.now = () => w.__vt;
  let raf = [];
  let timers = [];
  let nextId = 1;
  w.requestAnimationFrame = (cb) => { raf.push(cb); return nextId++; };
  w.cancelAnimationFrame = () => {};
  w.setTimeout = (fn, ms, ...a) => { const id = nextId++; timers.push({ id, at: w.__vt + (ms || 0), fn, a }); return id; };
  w.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
  w.__advance = (ms) => {
    w.__vt += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= w.__vt).sort((x, y) => x.at - y.at);
      if (!due.length) break;
      timers = timers.filter((t) => !due.includes(t));
      for (const t of due) { try { typeof t.fn === 'function' ? t.fn(...t.a) : 0; } catch (e) { console.error(e); } }
    }
    const q = raf; raf = [];
    for (const cb of q) cb(w.__vt);
    for (const an of document.getAnimations()) {
      if (!an.__virt) { an.__virt = true; an.pause(); }
      try { an.currentTime = (an.currentTime || 0) + ms; } catch {}
      if (an.effect && an.effect.getComputedTiming().progress === null && an.playState !== 'finished') {
        const end = an.effect.getComputedTiming().endTime;
        if (an.currentTime >= end) an.finish();
      }
    }
  };
}

(async () => {
  const only = process.argv[2];
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [name, size] of Object.entries(SIZES)) {
    if (only && only !== name) continue;
    const frames = path.join(OUT, `.frames-${name}`);
    fs.rmSync(frames, { recursive: true, force: true });
    fs.mkdirSync(frames, { recursive: true });
    const p = await b.newPage({ viewport: { width: size.w, height: size.h } });
    p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('DBG')) console.log('CONSOLE', m.text()); });
    await p.addInitScript(() => { try { localStorage.clear(); } catch {} });
    await p.goto(FILE);
    await p.waitForFunction(() => window.__game && window.__game.state === 'PLAYING' && window.__dev, null, { timeout: 120000 });
    await p.waitForTimeout(1500);

    // ───── scene setup ─────
    await p.evaluate(({ size }) => {
      const g = window.__game;
      const { THREE } = window.__dev;
      const s = g.s;
      s.settings.quality = 'high';
      s.settings.fov = size.fov;
      s.settings.music = 0; s.settings.sfx = 0;
      g.applySettings();
      document.getElementById('touch').style.display = 'none';
      document.querySelectorAll('.hint, #hint, .help').forEach((e) => { e.style.display = 'none'; });
      // a mid-game explorer: good shovel, roomy bag, a team of four
      s.toolTier = 4; s.bagTier = 3; s.coins = 2480; s.gems = 36;
      ['pup', 'fox', 'dragon', 'bunny'].forEach((e, i) => s.pets.push({ id: i + 1, entry: e, level: 3 + i, xp: 0, locked: false, shiny: e === 'dragon' }));
      s.nextPetId = 5; s.equipped = [1, 2, 3, 4];
      s.starterHatched = true;
      s.unlocked = ['meadow', 'crystal'];
      g.refreshTool();
      g.syncPets();
      g.world.refresh(s);
      g.ui.updateHud();
      document.querySelectorAll('.toast').forEach((e) => e.remove());
      // a few already-dug cells so the site reads as an excavation
      const site = g.world.sites[0];
      // the site layout is seeded per save: pick a shallow treasure (one cell under the turf) to uncover on camera
      const rank = { coins: 0, geode: 1, relic: 2, decor: 3, fossil: 3, token: 4 };
      const xyz = (c) => [c % 12, Math.floor(c / 144), Math.floor(c / 12) % 12];
      const pick = () => {
        const c = site.layout.treasures.map((t) => ({ t, p: xyz(t.cell) })).filter((o) => o.p[1] === 6 && o.p[0] >= 2 && o.p[0] <= 10 && o.p[2] >= 4 && o.p[2] <= 9);
        return c.sort((a, b) => rank[a.t.kind] - rank[b.t.kind] || b.p[2] - a.p[2]);
      };
      let cands = pick();
      // reseed the (untouched) first site until a coin cache sits one cell under the turf
      for (let seed = 1; seed < 4000 && !(cands.length && cands[0].t.kind === 'coins'); seed++) { site.load({ seed, mined: '', claimed: [], damage: [] }, seed); cands = pick(); }
      if (!cands.length) throw new Error('no shallow treasure');
      const [tx, , tz] = cands[0].p;
      const dir = tx >= 6 ? -1 : 1;
      window.__plan = { tx, tz, dir, kind: cands[0].t.kind };
      const avoid = new Set(site.layout.treasures.map((t) => t.cell));
      for (let k = 0; k <= 2; k++) avoid.add(tx + dir * k + tz * 12 + 7 * 144);
      for (const [x, z] of [[1, 10], [1, 11], [2, 11], [11, 10], [11, 11], [10, 11]]) { const c = x + z * 12 + 7 * 144; if (!avoid.has(c)) site.setMined(c); }
      site.dirty = true; site.rebuild();
      window.__V = { THREE };
    }, { size });
    await p.evaluate(installVirtualTime);

    // ───── shot list (driven per frame) ─────
    await p.evaluate(({ size }) => {
      const g = window.__game;
      const { THREE } = window.__V;
      const inp = g.input;
      const cam = g.cam;
      const ui = document.getElementById('ui');
      const ease = (t) => t * t * (3 - 2 * t);
      const lerp = (a, b, t) => a + (b - a) * t;
      const clamp01 = (t) => Math.max(0, Math.min(1, t));
      const keys = inp.keys; const held = inp.held;
      const setKeys = (ks) => { keys.clear(); for (const k of ks) keys.add(k); };
      const setHeld = (as) => { for (const a of ['dig', 'interact', 'sprint']) held.delete(a); for (const a of as) held.add(a); };
      let override = null;
      g.onBeforeRender = () => {
        if (!override) { g.player.rig.root.visible = false; return; }
        const c = cam.camera;
        c.fov = override.fov; c.aspect = size.w / size.h; c.updateProjectionMatrix();
        c.position.copy(override.pos); c.lookAt(override.look);
        g.player.rig.root.visible = true;
        g.viewmodel.visible = false; g.outline.visible = false; g.crack.visible = false;
      };
      const portrait = size.h > size.w;
      // aim helper: yaw/pitch that look from the eye at a world point
      const aimAt = (pt) => {
        const eye = g.player.pos.clone(); eye.y += 1.82;
        const d = pt.clone().sub(eye);
        return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(-d.y, Math.hypot(d.x, d.z)) };
      };
      const site = g.world.sites[0];
      const cellPt = (x, y, z) => new THREE.Vector3(site.ox + x + 0.5, site.oy + y + 0.5, site.oz + z + 0.5);
      let aim = null; // {from:{yaw,pitch}, to:{yaw,pitch}, t0, dur}
      const steerTo = (to, t, dur) => { aim = { from: { yaw: cam.yaw, pitch: cam.pitch }, to, t0: t, dur }; };
      const fired = new Set();
      const once = (k, fn) => { if (!fired.has(k)) { fired.add(k); fn(); } };

      window.__shot = (t) => {
        // A — cinematic intro: explorer + pet team at the dig site (0 – 3.4 s)
        if (t < 3.4) {
          once('A', () => {
            ui.style.visibility = 'hidden';
            g.player.teleport(new THREE.Vector3(1.0, 0.001, -4.2), 0);
            cam.yaw = Math.PI - 0.25; cam.pitch = 0.1;
            g.pets.teleportAll(g.player.pos);
            setKeys([]); setHeld([]);
          });
          const k = ease(t / 3.4);
          const ang = lerp(-0.75, 0.55, k);
          const r = portrait ? lerp(7.4, 6.2, k) : lerp(6.6, 5.4, k);
          const c = new THREE.Vector3(1.0, 1.15, -4.2);
          override = { pos: new THREE.Vector3(c.x + Math.sin(ang) * r, lerp(2.7, 1.9, k), c.z + Math.cos(ang) * r), look: c, fov: portrait ? 62 : 46 };
          return;
        }
        // B — first-person gameplay: scan, dig, uncover a coin cache (3.4 – 13 s)
        if (t < 13) {
          once('B', () => {
            override = null;
            ui.style.visibility = '';
            const P = window.__plan;
            g.player.teleport(new THREE.Vector3(site.ox + P.tx + 0.5 + P.dir * 0.4, 0.001, site.oz + P.tz + 0.5 + 2.2), 0);
            cam.yaw = 0.45; cam.pitch = 0.1;
            g.pets.teleportAll(g.player.pos);
            g.selectTool(0);
          });
          if (t >= 3.5) once('scan', () => { g.scanCd = 0; g.echoScan(); });
          setKeys([]);
          if (t >= 4.4) once('turn1', () => steerTo({ yaw: 0.0, pitch: 0.35 }, t, 1.0));
          // dig three cells; the last one opens onto the coin cache
          const P = window.__plan;
          const plan = [[P.tx + 2 * P.dir, 7, P.tz, 5.8], [P.tx + P.dir, 7, P.tz, 6.9], [P.tx, 7, P.tz, 8.0]];
          for (const [x, y, z, at] of plan) {
            if (t >= at - 0.35) once(`aim${x}_${at}`, () => steerTo(aimAt(cellPt(x, y, z)), t, 0.35));
          }
          setHeld(t >= 5.8 && t < 8.9 ? ['dig'] : []);
          if (t >= 9.4) {
            once('look', () => steerTo(aimAt(cellPt(P.tx, 6, P.tz)), t, 0.4));
            if (t >= 9.9 && t < 11.0) setHeld(['interact']);
          }
          if (t >= 11.6) once('turn2', () => steerTo({ yaw: cam.yaw + 0.5, pitch: 0.25 }, t, 1.3));
        }
        // C — egg hatch (13 – 17.6 s)
        else if (t < 17.6) {
          setHeld([]); setKeys([]);
          once('C', () => { document.querySelectorAll('.reward, .toast').forEach((e) => e.remove()); g.hatch('meadow', false); });
          return;
        }
        // D — sprint through camp with the team (17.6 – 22 s)
        else {
          once('D', () => {
            const btn = document.getElementById('hequip');
            const cont = document.getElementById('hcont');
            if (btn && !btn.disabled) btn.click(); else cont?.click();
            document.querySelectorAll('.toast').forEach((e) => e.remove());
            g.player.teleport(new THREE.Vector3(-6.0, 0.001, 1.5), 0);
            cam.yaw = Math.PI + 0.75; cam.pitch = 0.06;
            g.pets.teleportAll(g.player.pos);
          });
          setKeys(t < 19.2 ? ['KeyW'] : []);
          setHeld([]);
          once('turn3', () => steerTo({ yaw: Math.PI + 0.3, pitch: 0.12 }, t, 2.6));
        }
        if (aim) {
          const k = ease(clamp01((t - aim.t0) / aim.dur));
          let dy = aim.to.yaw - aim.from.yaw;
          while (dy > Math.PI) dy -= 2 * Math.PI;
          while (dy < -Math.PI) dy += 2 * Math.PI;
          cam.yaw = aim.from.yaw + dy * k;
          cam.pitch = lerp(aim.from.pitch, aim.to.pitch, k);
          if (k >= 1) aim = null;
        }
      };
    }, { size });

    const total = (+process.env.STOP_AT || 22) * FPS;
    const t0 = Date.now();
    for (let f = 0; f < total; f++) {
      const t = f / FPS;
      await p.evaluate(({ t, ms }) => { window.__shot(t); window.__advance(ms); }, { t, ms: 1000 / FPS });
      if (process.env.PREVIEW_EVERY && f % +process.env.PREVIEW_EVERY) continue;
      await p.screenshot({ path: path.join(frames, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 94 });
      if (f % 60 === 0) console.log(name, f, '/', total, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    console.log('plan', await p.evaluate(() => JSON.stringify(window.__plan) + ' treasures ' + window.__game.s.stats.treasures));
    await p.close();
    if (process.env.PREVIEW_EVERY) { console.log('preview frames in', frames); continue; }
    const out = path.join(OUT, `preview-${name}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.jpg'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
    fs.rmSync(frames, { recursive: true, force: true });
    console.log('wrote', out);
  }
  await b.close();
})();
