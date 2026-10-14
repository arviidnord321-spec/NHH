/**
 * Renders the store cover images from the real game engine.
 *   npm run build:standalone && node scripts/store-covers.cjs
 * Output: store/cover-*.png (with title logo) and store/cover-*-notext.png.
 * Needs Playwright + Chromium (set PLAYWRIGHT_MODULE for a global install).
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const fs = require('fs');

const FILE = 'file://' + path.resolve('standalone/index.html') + '?debug';
const OUT = path.resolve('store');
fs.mkdirSync(OUT, { recursive: true });

const SIZES = [
  { name: 'landscape', w: 1920, h: 1080 },
  { name: 'portrait', w: 800, h: 1200 },
  { name: 'square', w: 800, h: 800 },
];

const LOGO_CSS = `
#promo-logo { position: fixed; z-index: 50; pointer-events: none; display: flex; flex-direction: column; align-items: center; }
#promo-logo .t1 { font-family: "Lilita One", sans-serif; color: #fff; -webkit-text-stroke: var(--sw) #2a2440; paint-order: stroke fill; letter-spacing: .02em; line-height: .95; text-shadow: 0 var(--sh) 0 #2a2440; }
#promo-logo .t1 b { font-weight: 400; color: #ffc23a; }
#promo-logo .t2 { margin-top: var(--gap); font-family: "Lilita One", sans-serif; color: #fff; background: linear-gradient(#3fe0cf, #12a99a); border: var(--bw) solid #2a2440; border-radius: 999px; padding: .08em .7em .12em; letter-spacing: .08em; box-shadow: inset 0 .12em 0 rgba(255,255,255,.4), 0 .14em 0 #2a2440; text-shadow: 0 .06em 0 rgba(0,0,0,.35); }
#promo-vignette { position: fixed; inset: 0; z-index: 40; pointer-events: none; background: radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 55%, rgba(30,20,60,.35) 100%); }
`;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const size of SIZES) {
    const p = await b.newPage({ viewport: { width: size.w, height: size.h } });
    p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await p.addInitScript(() => { try { localStorage.clear(); } catch {} });
    await p.goto(FILE);
    await p.waitForFunction(() => window.__game && window.__game.state === 'PLAYING' && window.__dev, null, { timeout: 120000 });
    await p.evaluate(({ size }) => {
      const g = window.__game;
      const { models, THREE } = window.__dev;
      g.s.settings.quality = 'high';
      g.applySettings();
      document.getElementById('ui').style.display = 'none';
      document.getElementById('touch').style.display = 'none';
      // team of pets
      const team = ['pup', 'fox', 'dragon', 'bunny'];
      team.forEach((e, i) => g.s.pets.push({ id: i + 1, entry: e, level: 3, xp: 0, locked: false, shiny: e === 'dragon' }));
      g.s.nextPetId = 5; g.s.equipped = [1, 2, 3, 4];
      g.s.unlocked = ['meadow', 'crystal'];
      g.syncPets();
      g.world.refresh(g.s);
      // hide name tags / signs text sprites for a clean cover
      g.world.scene.traverse((o) => { if (o.isSprite) o.visible = false; });
      // a small freshly dug pit at the front of dig site I
      const site = g.world.sites[0];
      for (let z = 8; z < 11; z++) for (let x = 4; x < 8; x++) for (let y = 7; y < 8; y++) site.setMined(x + z * 12 + y * 144);
      site.dirty = true; site.rebuild();
      // treasure chest bursting with coins in the pit
      const chest = models.buildChest('coins');
      chest.position.set(0, -0.62, -9.75);
      chest.rotation.y = -0.35;
      chest.scale.setScalar(1.35);
      g.world.scene.add(chest);
      const glow = new THREE.Sprite(models.glowMaterial('#ffd36a'));
      glow.scale.setScalar(5);
      glow.position.set(0, 0.35, -9.75);
      g.world.scene.add(glow);
      for (let i = 0; i < 11; i++) {
        const coin = models.buildCoinFace();
        const a = i * 0.9;
        coin.position.set(Math.cos(a) * (0.35 + (i % 3) * 0.22), 0.25 + (i % 6) * 0.12, -9.85 + Math.sin(a) * 0.3);
        coin.rotation.set(0.4 * i, i * 0.8, 0.3);
        coin.scale.setScalar(0.36);
        g.world.scene.add(coin);
      }
      const gem = models.buildGemIcon();
      gem.position.set(0.8, 0.15, -10.0);
      gem.scale.setScalar(0.7);
      g.world.scene.add(gem);
      // a featured egg on the rim
      const egg = models.buildEgg('meadow');
      egg.root.position.set(3.4, 0.05, -10.4);
      egg.root.rotation.y = -0.6;
      egg.root.scale.setScalar(1.05);
      g.world.scene.add(egg.root);
      const egg2 = models.buildEgg('geode');
      egg2.root.position.set(-4.4, 0.05, -7.9);
      egg2.root.rotation.y = 0.5;
      egg2.root.scale.setScalar(0.95);
      g.world.scene.add(egg2.root);
      // explorer cheering behind the pit, facing the camera
      g.setPause('menu', true);
      const pl = g.player;
      pl.teleport(new THREE.Vector3(0.1, 0.001, -7.2), Math.PI);
      const rig = pl.rig;
      rig.root.position.copy(pl.pos);
      rig.root.rotation.y = Math.PI + 0.2;
      rig.armR.rotation.set(-2.7, 0, 0.25);
      rig.armL.rotation.set(-0.3, 0, -0.5);
      rig.legL.rotation.x = 0.15; rig.legR.rotation.x = -0.15;
      // pets lined up with the explorer
      const spots = { pup: [-1.6, -7.6, Math.PI + 0.35], fox: [1.9, -7.7, Math.PI - 0.35], dragon: [-1.3, -6.0, Math.PI + 0.2], bunny: [3.3, -7.0, Math.PI - 0.55] };
      for (const f of g.pets.list) {
        const [x, z, yaw] = spots[f.pet.entry];
        f.pos.set(x, f.pet.entry === 'dragon' ? 1.1 : 0, z);
        f.yaw = yaw;
        f.rig.root.scale.setScalar(f.pet.entry === 'dragon' ? 1.05 : 0.95);
      }
      // sparkles
      for (let i = 0; i < 6; i++) g.particles.sparkle(new THREE.Vector3(0, 0.4, -9.6), '#ffd84a', 30, 2.2, 0.8, 0.3, 1, 3);
      // camera framing per aspect
      const shots = {
        landscape: { pos: [-2.2, 1.9, -15.4], look: [0.3, 0.9, -7.4], fov: 44 },
        portrait: { pos: [0.3, 1.7, -17.2], look: [0.3, 1.7, -7.4], fov: 58 },
        square: { pos: [-0.6, 1.8, -16.0], look: [0.3, 1.25, -7.4], fov: 50 },
      };
      const sh = shots[size.name];
      const cam = g.cam.camera;
      g.onBeforeRender = () => {
        cam.fov = sh.fov;
        cam.aspect = size.w / size.h;
        cam.updateProjectionMatrix();
        cam.position.set(...sh.pos);
        cam.lookAt(...sh.look);
        rig.root.visible = true;
        g.outline.visible = false;
        g.crack.visible = false;
        g.viewmodel.visible = false;
        g.world.sun.position.set(-14, 26, -24);
        g.world.sun.target.position.set(0, 0, -8);
        g.world.sun.shadow.camera.left = -18; g.world.sun.shadow.camera.right = 18;
        g.world.sun.shadow.camera.top = 18; g.world.sun.shadow.camera.bottom = -18;
        g.world.sun.shadow.camera.updateProjectionMatrix();
      };
    }, { size });
    await p.waitForTimeout(6000);
    await p.screenshot({ path: path.join(OUT, `cover-${size.name}-notext.png`) });
    // title logo
    await p.evaluate(({ size, css }) => {
      const st = document.createElement('style');
      st.textContent = css;
      document.head.appendChild(st);
      const v = document.createElement('div'); v.id = 'promo-vignette'; document.body.appendChild(v);
      const d = document.createElement('div');
      d.id = 'promo-logo';
      d.innerHTML = '<div class="t1"><b>DIG</b>BOUND</div><div class="t2">PET EXPLORERS</div>';
      const L = {
        landscape: { fs: 150, sub: 50, x: 'right: 64px', y: 'top: 56px' },
        portrait: { fs: 118, sub: 40, x: 'left: 0; right: 0', y: 'top: 50px' },
        square: { fs: 100, sub: 34, x: 'left: 0; right: 0', y: 'top: 26px' },
      }[size.name];
      d.style.cssText = `${L.x}; ${L.y}; --sw: ${L.fs * 0.14}px; --sh: ${L.fs * 0.07}px; --gap: ${L.fs * 0.06}px; --bw: ${L.sub * 0.12}px;`;
      d.querySelector('.t1').style.fontSize = L.fs + 'px';
      d.querySelector('.t2').style.fontSize = L.sub + 'px';
      document.body.appendChild(d);
    }, { size, css: LOGO_CSS });
    await p.waitForTimeout(800);
    await p.screenshot({ path: path.join(OUT, `cover-${size.name}.png`) });
    console.log('wrote', size.name);
    await p.close();
  }
  await b.close();
})();
