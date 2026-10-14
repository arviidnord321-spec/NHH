/**
 * Game: orchestrates systems and owns the authoritative SaveData.
 * States: BOOT → PLAYING ⇄ MENU / HATCHING / PAUSED / AD_PENDING / AD_PLAYING.
 * Pause reasons are tracked independently so e.g. closing an ad never resumes
 * a game still paused by a menu or hidden tab.
 */
import * as THREE from 'three';
import {
  BIOMES, BiomeId, COIN_CACHE_MUL, COLLECTIBLES, DIG, EGG_BY_ID, FIND_GEMS, GEODE_GEMS, MATERIALS, PET_ENTRY_BY_ID,
  QUALITY, RARITY_INFO, RELIC_DUPLICATE_GEMS, SAVE, SITE, TOOLS, BIOME_ORDER, CAPS,
} from './data/balance';
import * as L from './core/logic';
import type { SaveData } from './core/state';
import { cellXYZ, depthCategory, TreasureSpec } from './core/site';
import { World, CAMP, SPAWN, RayHit } from './world/World';
import { buildLanternTool, buildPickaxe, buildShovel } from './world/models';
import { PlayerController } from './world/PlayerController';
import { CameraController } from './world/CameraController';
import { PetFollowers } from './world/PetFollowers';
import { ParticlePool } from './world/ParticlePool';
import { InputManager } from './systems/InputManager';
import { AudioManager } from './systems/AudioManager';
import { SaveManager } from './systems/SaveManager';
import type { Platform } from './systems/PlatformAdapter';
import { Showcase } from './ui/Showcase';
import { UIManager } from './ui/UIManager';
import { VoxelSite } from './world/VoxelSite';
import { hashString } from './core/rng';

export type GameState = 'BOOT' | 'PLAYING' | 'MENU' | 'HATCHING' | 'AD_PENDING' | 'AD_PLAYING' | 'PAUSED';
export type PauseReason = 'menu' | 'hatch' | 'hidden' | 'ad' | 'boot';

export interface DigTarget {
  site: VoxelSite;
  cell: number;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  treasure: TreasureSpec | null;
  inReach: boolean;
}

export class Game {
  s!: SaveData;
  readonly renderer: THREE.WebGLRenderer;
  readonly world = new World();
  player!: PlayerController;
  cam!: CameraController;
  pets!: PetFollowers;
  particles!: ParticlePool;
  input!: InputManager;
  readonly audio = new AudioManager();
  readonly showcase = new Showcase();
  ui!: UIManager;
  private pause = new Set<PauseReason>(['boot']);
  private last = performance.now();
  time = 0;
  private autosave = 0;
  private outline!: THREE.Group;
  private outlineMat = new THREE.MeshBasicMaterial({ color: '#7dff6a', transparent: true, opacity: 0.95, depthWrite: false });
  private outlineFill = new THREE.MeshBasicMaterial({ color: '#7dff6a', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  private crack!: THREE.Mesh;
  private crackTex: THREE.Texture[] = [];
  target: DigTarget | null = null;
  private swingT = -1;
  private swingDur = 0.45;
  private swingTarget: { site: VoxelSite; cell: number } | null = null;
  private contactDone = false;
  private uncoverT = 0;
  scanCd = 0;
  scanTarget: { site: VoxelSite; t: TreasureSpec; until: number } | null = null;
  private pingT = 0;
  private scanRing!: THREE.Mesh;
  private scanRingT = -1;
  private scanRingR = 12;
  selectedSlot = 0; // 0 shovel 1 pickaxe 2 lantern 3 scanner
  nearSell = false;
  private hatchBusy = false;
  private fps = { frames: 0, t: 0, value: 0 };
  private raycaster = new THREE.Raycaster();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private lastBiome: BiomeId = 'meadow';
  private lastBagFullWarn = 0;

  constructor(private canvas: HTMLCanvasElement, private uiRoot: HTMLElement, private touchRoot: HTMLElement, public platform: Platform, public saves: SaveManager) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  get state(): GameState {
    if (this.pause.has('boot')) return 'BOOT';
    if (this.pause.has('ad')) return 'AD_PLAYING';
    if (this.pause.has('hatch')) return 'HATCHING';
    if (this.pause.has('menu')) return 'MENU';
    if (this.pause.has('hidden')) return 'PAUSED';
    return 'PLAYING';
  }
  get running() { return this.pause.size === 0; }

  setPause(reason: PauseReason, on: boolean) {
    const before = this.running;
    if (on) this.pause.add(reason); else this.pause.delete(reason);
    if (!this.running && this.input?.pointerLocked) document.exitPointerLock?.();
    if (this.running !== before) {
      if (this.running) this.platform.gameplayStart(); else this.platform.gameplayStop();
      this.input.releaseAll();
      this.swingT = -1;
      this.uncoverT = 0;
    }
    this.audio.setSuspended(this.pause.has('ad') || this.pause.has('hidden'));
  }

  // ───────── boot ─────────
  async start(save: SaveData) {
    this.s = save;
    const q = this.s.settings.quality;
    this.world.build(this.s, q);
    // persist every site's seed so finds stay stable between sessions
    for (const site of this.world.sites) this.s.sites[site.id] = site.toState();
    this.particles = new ParticlePool(QUALITY[q].particles);
    this.world.scene.add(this.particles.group);
    this.player = new PlayerController(this.world);
    this.cam = new CameraController(this.world, 1);
    this.pets = new PetFollowers(this.world, this.particles);
    this.input = new InputManager(this.canvas, this.touchRoot);
    this.buildHelpers();
    this.ui = new UIManager(this.uiRoot, this);
    this.player.teleport(this.s.stats.cells === 0 ? SPAWN : CAMP, Math.PI);
    this.cam.yaw = 0;
    this.cam.snap(this.player.pos);
    this.applySettings();
    this.refreshPlayerLook();
    this.world.scene.add(this.cam.camera);
    this.cam.camera.add(this.viewmodel);
    if (this.s.cameraFirstPerson) this.setView(true, false);
    this.syncPets();
    this.world.refresh(this.s);
    L.syncStateQuests(this.s);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('visibilitychange', () => {
      this.setPause('hidden', document.hidden);
      if (document.hidden) this.persist();
      this.last = performance.now();
    });
    window.addEventListener('pagehide', () => this.persist());
    this.platform.onMuteChange((m) => this.audio.setPlatformMuted(m));
    this.audio.setPlatformMuted(this.platform.muted);
    this.platform.onAuthChange(() => this.onAuthChange());
    // unlock audio on first gesture
    const unlock = () => { this.audio.unlock(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.ui.updateAll();
    this.platform.loadingStop();
    this.setPause('boot', false);
    // resume an interrupted hatch reveal (already paid & rolled — never re-rolled)
    if (this.s.pendingHatch) this.playPendingHatch();
    this.persist();
    requestAnimationFrame(() => this.frame());
  }

  private buildHelpers() {
    // glowing selection frame: 12 bars along the cube edges + a faint fill
    this.outline = new THREE.Group();
    const t = 0.07, L = 1.06;
    const bar = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.outlineMat);
      m.position.set(x, y, z);
      m.renderOrder = 3;
      this.outline.add(m);
    };
    for (const a of [-0.51, 0.51]) for (const b of [-0.51, 0.51]) {
      bar(L, t, t, 0, a, b);
      bar(t, L, t, a, 0, b);
      bar(t, t, L, a, b, 0);
    }
    const fill = new THREE.Mesh(new THREE.BoxGeometry(1.03, 1.03, 1.03), this.outlineFill);
    this.outline.add(fill);
    this.outline.visible = false;
    this.world.scene.add(this.outline);
    for (let stage = 0; stage < 4; stage++) this.crackTex.push(makeCrackTexture(stage));
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.01, 1.01), new THREE.MeshBasicMaterial({ map: this.crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.crack.visible = false;
    this.world.scene.add(this.crack);
    this.scanRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color: '#16cdbb', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    this.scanRing.rotation.x = -Math.PI / 2;
    this.scanRing.visible = false;
    this.world.scene.add(this.scanRing);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, QUALITY[this.s.settings.quality].pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    this.particles.setViewportHeight(h * pr);
    this.ui?.onResize();
  }

  applySettings() {
    const st = this.s.settings;
    this.audio.setVolumes(st.master, st.music, st.sfx);
    this.audio.setUserMuted(st.muted);
    const cfg = QUALITY[st.quality];
    this.world.setQuality(st.quality);
    this.renderer.shadowMap.enabled = cfg.shadows;
    this.particles.setBudget(cfg.particles);
    this.particles.enabled = st.particles;
    this.particles.scale = st.quality === 'low' ? 0.6 : 1;
    this.cam.shakeEnabled = st.shake && !st.reducedMotion;
    document.body.classList.toggle('reduced-motion', st.reducedMotion);
    this.resize();
  }

  // ───────── main loop ─────────
  private frame() {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    this.fps.frames++;
    this.fps.t += Math.min(dt, 2);
    if (this.fps.t >= 0.5) { this.fps.value = this.fps.frames / this.fps.t; this.fps.frames = 0; this.fps.t = 0; }
    if (dt > 2) { this.input.releaseAll(); dt = 0; } // long suspension: no catch-up burst
    dt = Math.min(dt, 0.1);
    this.input.poll();
    if (this.running) {
      // bounded sub-steps keep simulation identical across refresh rates
      const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) this.step(h, i === 0, dt);
    } else {
      this.ui.handleMenuKeys();
    }
    this.time += this.running ? dt : 0;
    this.world.update(dt, this.time, this.player.pos);
    this.pets.update(this.running ? dt : 0, this.time, this.player.pos, this.player.yaw, this.target ? this.target.center : null, this.ui.showPetLabels);
    this.particles.update(dt);
    this.updateScanRing(dt);
    this.player.rig.root.visible = !this.cam.tooClose;
    this.updateViewmodel(dt);
    this.audio.update(dt);
    this.renderer.render(this.world.scene, this.cam.camera);
    this.ui.frame(dt);
    if (this.s.settings.showFps) this.ui.setDebug(this.debugText());
    this.input.endFrame();
  }

  private debugText() {
    const info = this.renderer.info;
    return `FPS ${this.fps.value.toFixed(0)} · draws ${info.render.calls} · tris ${(info.render.triangles / 1000).toFixed(1)}k · particles ${this.particles.activeCount()} · sites ${this.world.sites.filter((s) => this.world.biomeGroups[s.biome].visible).length}`;
  }

  private step(dt: number, first: boolean, frameDt: number) {
    const inp = this.input;
    if (first) {
      // discrete actions once per frame
      if (inp.wasPressed('pause')) { this.ui.open('settings'); return; }
      if (inp.wasPressed('pets')) { this.ui.open('pets'); return; }
      if (inp.wasPressed('avatar')) { this.ui.open('avatar'); return; }
      if (inp.wasPressed('view')) this.setView(!this.cam.firstPerson);
      if (inp.wasPressed('camp')) this.returnToCamp();
      if (inp.wasPressed('scan')) this.echoScan();
      if (inp.wasPressed('tool1')) this.selectTool(0);
      if (inp.wasPressed('tool2')) this.selectTool(1);
      if (inp.wasPressed('tool3')) this.selectTool(2);
      if (inp.wasPressed('tool4')) this.selectTool(3);
      this.cam.update(dt, this.player.visualPos, inp.look.dx, inp.look.dy, inp.zoom);
    } else {
      this.cam.update(dt, this.player.visualPos, 0, 0, 0);
    }
    const team = L.teamStats(this.s);
    if (this.cam.zoomedIn || this.cam.zoomedOut) { this.cam.zoomedIn = this.cam.zoomedOut = false; this.setView(this.cam.firstPerson); }
    const facing = this.swingT >= 0 && this.swingTarget ? Math.atan2(this.swingTargetCenter().x - this.player.pos.x, this.swingTargetCenter().z - this.player.pos.z) : this.cam.firstPerson ? this.cam.yaw + Math.PI : null;
    const res = this.player.update(dt, inp.move, this.cam.yaw, inp.isHeld('sprint'), first && inp.wasPressed('jump') || (inp.isHeld('jump') && this.player.grounded && first), L.moveSpeedMul(this.s, team), facing);
    if (res === 'oob') {
      this.returnToCamp(true);
      this.ui.toast('You were returned safely to camp.', 'info');
    }
    if (first) {
      this.updateTarget();
      this.updateInteract(frameDt);
      this.updateBiome();
    }
    this.updateDig(dt);
    this.scanCd = Math.max(0, this.scanCd - dt);
    this.updateScanSignal(dt);
    this.autosave += dt;
    if (this.autosave > SAVE.autosaveSeconds) { this.autosave = 0; this.persist(); }
  }

  private updateBiome() {
    const b = this.world.biomeAt(this.player.pos.x, this.player.pos.z);
    if (b !== this.lastBiome) {
      this.lastBiome = b;
      this.audio.setBiome(b);
      this.ui.banner(BIOMES[b].name);
    }
  }

  // ───────── targeting & digging ─────────
  private updateTarget() {
    const inp = this.input;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const fp = this.cam.firstPerson;
    const useCenter = inp.isTouch || !inp.pointer.inside || fp || inp.pointerLocked;
    const px = useCenter ? w / 2 : inp.pointer.x;
    const py = useCenter ? h * (fp ? 0.5 : 0.45) : inp.pointer.y;
    this.raycaster.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), this.cam.camera);
    const ray = this.raycaster.ray;
    const hit = this.world.raycast(ray.origin, ray.direction, 40);
    this.target = null;
    if (hit && hit.site && hit.cell >= 0) {
      const center = hit.site.worldCellCenter(hit.cell, new THREE.Vector3());
      const treasure = hit.site.treasureByCell.get(hit.cell) ?? null;
      const tr = treasure && !hit.site.treasureClaimed(treasure) ? treasure : null;
      this.target = { site: hit.site, cell: hit.cell, center, normal: new THREE.Vector3(hit.nx, hit.ny, hit.nz), treasure: tr, inReach: this.canReach(hit) };
    }
    const t = this.target;
    this.outline.visible = !!t;
    if (t) {
      this.outline.position.copy(t.center);
      this.outlineMat.color.set(!t.inReach ? '#ff6a5a' : t.treasure ? '#ffbd38' : '#7dff6a');
      this.outlineFill.color.copy(this.outlineMat.color);
      this.outlineMat.opacity = 0.75 + Math.sin(this.time * 6) * 0.2;
      const hp = t.site.damage.get(t.cell);
      const mat = MATERIALS[t.site.materialIndex(t.cell)];
      const max = L.cellMaxHp(mat, t.site.biome, this.s.stats.cells);
      if (hp !== undefined && !t.treasure) {
        this.crack.visible = true;
        this.crack.position.copy(t.center);
        const frac = 1 - hp / max;
        (this.crack.material as THREE.MeshBasicMaterial).map = this.crackTex[Math.min(3, Math.floor(frac * 4))];
      } else this.crack.visible = false;
    } else this.crack.visible = false;
  }

  /** Within 4 m of the player's chest and with an unobstructed line to the cell. */
  private canReach(hit: RayHit): boolean {
    const chest = this.tmpV.set(this.player.pos.x, this.player.pos.y + 1.2, this.player.pos.z);
    const cx = Math.max(hit.ix, Math.min(chest.x, hit.ix + 1));
    const cy = Math.max(hit.iy, Math.min(chest.y, hit.iy + 1));
    const cz = Math.max(hit.iz, Math.min(chest.z, hit.iz + 1));
    const d = Math.hypot(chest.x - cx, chest.y - cy, chest.z - cz);
    if (d > DIG.reach) return false;
    // line of sight to the struck face center
    const face = this.tmpV2.set(hit.ix + 0.5 + hit.nx * 0.5, hit.iy + 0.5 + hit.ny * 0.5, hit.iz + 0.5 + hit.nz * 0.5);
    const dir = face.clone().sub(chest);
    const len = dir.length();
    if (len < 0.01) return true;
    dir.normalize();
    const los = this.world.raycast(chest, dir, len + 0.6);
    return !!los && los.ix === hit.ix && los.iy === hit.iy && los.iz === hit.iz;
  }

  private swingTargetCenter() {
    return this.swingTarget ? this.swingTarget.site.worldCellCenter(this.swingTarget.cell, this.tmpV2) : this.player.pos;
  }

  private updateDig(dt: number) {
    if (this.swingT >= 0) {
      this.swingT += dt / this.swingDur;
      this.player.swing = Math.min(1, this.swingT);
      if (!this.contactDone && this.swingT >= 0.45) {
        this.contactDone = true;
        this.strike();
      }
      if (this.swingT >= 1) { this.swingT = -1; this.player.swing = -1; }
      return;
    }
    if (this.selectedSlot > 1) return; // lantern / scanner selected
    if (!this.input.isHeld('dig')) return;
    const t = this.target;
    if (!t || !t.inReach) return;
    if (t.treasure) return; // treasures are uncovered with E, never mined
    const mat = MATERIALS[t.site.materialIndex(t.cell)];
    if (mat.indestructible) { this.denyOnce(`${mat.name} can't be dug — it marks the site boundary.`); return; }
    if (mat.minToolTier > this.s.toolTier) { this.denyOnce(`Needs a ${TOOLS[mat.minToolTier].name} (Smithy).`); return; }
    if (!L.canStore(this.s, mat)) { this.bagFull(mat.units); return; }
    this.swingDur = L.toolInterval(this.s);
    this.swingT = 0;
    this.contactDone = false;
    this.swingTarget = { site: t.site, cell: t.cell };
  }

  private denyT = 0;
  private denyOnce(msg: string) {
    if (this.time - this.denyT < 1.2) return;
    this.denyT = this.time;
    this.audio.play('deny');
    this.ui.toast(msg, 'warn');
  }

  private bagFull(units: number) {
    if (this.time - this.lastBagFullWarn < 2) return;
    this.lastBagFullWarn = this.time;
    this.audio.play('deny');
    const free = L.bagCapacity(this.s) - L.bagCount(this.s);
    this.ui.toast(units > 1 ? `Bag full — this node needs ${units} free slots (you have ${free}). Sell at camp (R).` : 'Bag full! Return to camp (R) and sell at Mara.', 'warn');
    this.ui.pulseBag();
  }

  /** Damage registers at the contact frame, synchronized with effects. */
  private strike() {
    const st = this.swingTarget;
    if (!st) return;
    const { site, cell } = st;
    // re-validate: the cell must still be solid, unclaimed and reachable
    if (!site.isSolid(cell) || site.treasureByCell.has(cell) && !site.treasureClaimed(site.treasureByCell.get(cell)!)) return;
    const center = site.worldCellCenter(cell, new THREE.Vector3());
    const [x, y, z] = cellXYZ(cell);
    const hit: RayHit = { ix: site.ox + x, iy: site.oy + y, iz: site.oz + z, nx: 0, ny: 1, nz: 0, dist: 0, site, cell, point: center };
    const normal = this.target && this.target.site === site && this.target.cell === cell ? this.target.normal.clone() : new THREE.Vector3(0, 1, 0);
    hit.nx = normal.x; hit.ny = normal.y; hit.nz = normal.z;
    if (!this.canReach(hit)) return;
    const mat = MATERIALS[site.materialIndex(cell)];
    const team = L.teamStats(this.s);
    const max = L.cellMaxHp(mat, site.biome, this.s.stats.cells);
    const hp = site.damage.get(cell) ?? max;
    const bonus = L.golemTick(this.s, team);
    const dmg = L.computeDamage(this.s, mat, team);
    const facePt = center.clone().addScaledVector(normal, 0.52);
    this.pets.assist(center);
    const color = new THREE.Color(mat.color);
    this.particles.chipsBurst(facePt, normal, color, 8 + Math.floor(Math.random() * 7), 3.2, 0.09);
    this.particles.puff(facePt, mat.category === 'soil' ? '#d8c09a' : '#c8c8d0', 2, 0.45);
    if (mat.sound === 'crystal' || mat.category !== 'soil') this.particles.sparkle(facePt, mat.emissive ? mat.color : '#ffffff', 4 + Math.floor(Math.random() * 5), 0.4, 1.4, 0.18);
    this.audio.play(mat.sound);
    if (bonus > 0) {
      this.particles.sparkle(facePt, '#b68aff', 8, 0.5, 2, 0.3, 1);
      this.ui.floatText(facePt, `Golem +${Math.round(bonus)}`, '#c9a8ff');
    }
    let remaining = hp - dmg - bonus;
    this.ui.floatText(facePt, `-${Math.round(dmg + bonus)}`, '#fff4dc');
    if (remaining <= 0) {
      if (!L.canStore(this.s, mat)) {
        // never delete an uncollected reward: stop before the final removal
        site.damage.set(cell, Math.max(0.5, Math.min(hp, 1)));
        this.bagFull(mat.units);
        return;
      }
      this.breakCell(site, cell, mat, center, normal);
    } else {
      site.damage.set(cell, remaining);
      this.cam.addShake(0.02);
    }
  }

  private breakCell(site: VoxelSite, cell: number, mat: (typeof MATERIALS)[number], center: THREE.Vector3, normal: THREE.Vector3) {
    const exposedBefore = site.layout.treasures.filter((t) => !site.treasureClaimed(t) && site.isExposed(t.cell)).map((t) => t.index);
    site.setMined(cell);
    site.damage.delete(cell);
    site.dirty = true;
    L.storeMaterial(this.s, mat);
    this.s.stats.cells++;
    const ups = L.awardPetXp(this.s, CAPS.xpPerCell);
    this.afterPetXp(ups);
    this.particles.chipsBurst(center, normal, mat.color, 12 + Math.floor(Math.random() * 9), 4.5, 0.16, 1);
    this.particles.burstRing(center.clone().addScaledVector(normal, 0.4), '#ffffff', 10, 3, 0.18);
    this.audio.play('break');
    this.cam.addShake(0.06);
    this.ui.floatText(center, mat.units > 1 ? `+${mat.units} ${mat.name}` : `+1 ${mat.name}`, mat.units > 1 ? '#ffbd38' : '#fff4dc');
    const q = L.progressQuest(this.s, 'break');
    if (q) this.questDone(q);
    const cr = L.progressContract(this.s, { kind: 'resource', material: mat.id, units: mat.units });
    if (cr) this.contractDone(cr);
    if (this.s.stats.cells === DIG.tutorialCells) {
      this.world.refresh(this.s);
      this.particles.sparkle(this.world.starterEgg!.root.position.clone().add(new THREE.Vector3(0, 1, 0)), '#16cdbb', 20, 1, 2, 0.35, 1);
      this.ui.toast('A Starter Egg appeared by the dig site!', 'good');
    }
    // newly exposed treasures glint
    for (const t of site.layout.treasures) {
      if (site.treasureClaimed(t) || exposedBefore.includes(t.index)) continue;
      // exposure is evaluated after the mined bit is set
      if (site.isExposed(t.cell)) {
        const c = site.worldCellCenter(t.cell, new THREE.Vector3());
        this.particles.sparkle(c, '#ffbd38', 18, 0.8, 1.5, 0.3, 1);
        this.audio.play('crystal');
        this.ui.toast('Something glints in the soil! Press E nearby to uncover it.', 'good');
      }
    }
    this.checkAchievements();
    if (L.bagCount(this.s) >= L.bagCapacity(this.s)) this.ui.pulseBag();
    this.ui.updateHud();
  }

  // ───────── treasures ─────────
  private nearestUncoverable(): { site: VoxelSite; t: TreasureSpec; center: THREE.Vector3 } | null {
    let best: { site: VoxelSite; t: TreasureSpec; center: THREE.Vector3 } | null = null;
    let bd = 3.6;
    const p = this.tmpV.set(this.player.pos.x, this.player.pos.y + 0.9, this.player.pos.z);
    for (const site of this.world.sites) {
      if (Math.abs(p.x - (site.ox + 6)) > 12 || Math.abs(p.z - (site.oz + 6)) > 12) continue;
      for (const t of site.layout.treasures) {
        if (site.treasureClaimed(t) || !site.isExposed(t.cell)) continue;
        const c = site.worldCellCenter(t.cell, new THREE.Vector3());
        const d = c.distanceTo(p);
        if (d < bd) { bd = d; best = { site, t, center: c }; }
      }
    }
    return best;
  }

  private updateInteract(dt: number) {
    const tr = this.nearestUncoverable();
    if (tr) {
      if (this.input.isHeld('interact')) {
        this.uncoverT += dt;
        if (this.uncoverT >= DIG.uncoverHold) {
          this.uncoverT = 0;
          this.claimTreasure(tr.site, tr.t, tr.center);
        }
      } else this.uncoverT = 0;
      this.ui.setPrompt(`${this.input.isTouch ? 'Hold Use' : 'Hold E'} — Uncover ${treasureName(tr.t)}`, this.uncoverT / DIG.uncoverHold);
      this.nearSell = false;
      this.ui.setSellShortcut(false);
      return;
    }
    this.uncoverT = 0;
    let best: (typeof this.world.interactables)[number] | null = null;
    let bd = Infinity;
    for (const it of this.world.interactables) {
      if (!it.active) continue;
      const d = Math.hypot(it.pos.x - this.player.pos.x, it.pos.z - this.player.pos.z);
      if (d < it.radius && d < bd && Math.abs(this.player.pos.y) < 2) { bd = d; best = it; }
    }
    this.nearSell = !!best && best.kind === 'trader';
    this.ui.setSellShortcut(this.nearSell && L.bagCount(this.s) > 0);
    if (best) {
      this.ui.setPrompt(`${this.input.isTouch ? 'Use' : 'E'} — ${this.ui.interactLabel(best)}`, -1);
      if (this.input.wasPressed('interact')) this.ui.interact(best);
    } else this.ui.setPrompt(null, -1);
  }

  private claimTreasure(site: VoxelSite, t: TreasureSpec, center: THREE.Vector3) {
    if (site.treasureClaimed(t)) return;
    const b = site.biome;
    const bi = BIOME_ORDER.indexOf(b);
    let title = '', detail = '', color = '#ffbd38';
    switch (t.kind) {
      case 'coins': {
        const c = L.addCoins(this.s, BIOMES[b].baseValue * COIN_CACHE_MUL);
        title = 'Coin Cache'; detail = `+${c.toLocaleString('en-US')} coins`;
        this.ui.flyCoins(center, 6);
        break;
      }
      case 'geode': {
        const g = L.addGems(this.s, GEODE_GEMS[bi]);
        title = 'Gem Geode'; detail = `+${g} gems`; color = '#a46bff';
        break;
      }
      case 'token': {
        const egg = BIOMES[b].egg;
        this.s.eggTokens[egg] = (this.s.eggTokens[egg] ?? 0) + 1;
        title = 'Egg Token'; detail = `Redeem for a free ${EGG_BY_ID[egg].name} at the shrine`; color = '#16cdbb';
        break;
      }
      case 'fossil':
      case 'decor': {
        const pool = COLLECTIBLES.filter((c) => c.biome === b && c.kind === t.kind);
        const missing = pool.find((c) => !(this.s.collection[c.id] > 0));
        const pick = missing ?? pool[(t.index + site.layout.seed) % pool.length];
        this.s.collection[pick.id] = (this.s.collection[pick.id] ?? 0) + 1;
        if (missing) { title = pick.name; detail = `New museum find! +${FIND_GEMS} gems`; }
        else { title = pick.name; detail = `Duplicate · +${FIND_GEMS} gems`; }
        L.addGems(this.s, FIND_GEMS);
        color = pick.color;
        break;
      }
      case 'relic': {
        const id = t.relic!;
        const had = (this.s.collection[id] ?? 0) > 0;
        this.s.collection[id] = (this.s.collection[id] ?? 0) + 1;
        title = COLLECTIBLES.find((c) => c.id === id)!.name;
        if (had) {
          L.addGems(this.s, RELIC_DUPLICATE_GEMS);
          detail = `Relic duplicate · +${RELIC_DUPLICATE_GEMS} gems`;
          const cr = L.progressContract(this.s, { kind: 'relic', biome: b });
          if (cr) this.contractDone(cr);
        } else {
          detail = `Relic shard ${L.relicCount(this.s, b)}/3 for the ${BIOMES[b].name} display`;
        }
        color = '#ffd36a';
        break;
      }
    }
    site.claimed.add(t.index);
    site.dirty = true;
    this.s.stats.treasures++;
    this.afterPetXp(L.awardPetXp(this.s, CAPS.xpPerTreasure));
    if (t.kind !== 'relic') {
      const cr = L.progressContract(this.s, { kind: 'cache', biome: b });
      if (cr) this.contractDone(cr);
    }
    const q = L.progressQuest(this.s, 'uncover');
    if (q) this.questDone(q);
    if (this.scanTarget && this.scanTarget.t === t) this.scanTarget = null;
    // effects: local sparkles, rising item, reward card, restrained rays
    this.particles.sparkle(center, color, 24 + Math.floor(Math.random() * 16), 1.0, 2.2, 0.32, 1, 0.7);
    this.particles.burstRing(center, '#ffffff', 14, 4, 0.22, 1);
    this.audio.play('treasure');
    this.player.celebrate = 1;
    this.pets.celebrate();
    this.ui.rewardCard(t.kind, title, detail, color);
    const newDisplays = L.claimDisplays(this.s);
    for (const nb of newDisplays) {
      this.audio.play('unlock');
      this.ui.toast(`${BIOMES[nb].name} museum display complete! Its secret chamber is open.`, 'good');
      if (this.s.displaysClaimed.length === 1) this.ui.toast('A 4th pet team slot unlocked!', 'good');
    }
    if (newDisplays.length) this.world.refresh(this.s);
    this.checkAchievements();
    this.ui.updateHud();
    this.persist();
  }

  // ───────── echo scan ─────────
  echoScan() {
    if (this.scanCd > 0) { this.ui.toast(`Echo Scan recharging (${this.scanCd.toFixed(1)}s)`, 'info'); return; }
    const team = L.teamStats(this.s);
    const radius = L.scanRadius(this.s, team);
    this.scanCd = L.scanCooldown(this.s, team);
    this.s.stats.scans++;
    this.audio.play('scan');
    this.scanRingT = 0;
    this.scanRingR = radius;
    const p = this.tmpV.set(this.player.pos.x, this.player.pos.y + 1, this.player.pos.z);
    let best: { site: VoxelSite; t: TreasureSpec; d: number } | null = null;
    for (const site of this.world.sites) {
      for (const t of site.layout.treasures) {
        if (site.treasureClaimed(t)) continue;
        const d = site.worldCellCenter(t.cell, this.tmpV2).distanceTo(p);
        if (d <= radius && (!best || d < best.d)) best = { site, t, d };
      }
    }
    const q = L.progressQuest(this.s, 'scan');
    if (q) this.questDone(q);
    this.checkAchievements();
    if (best) {
      this.scanTarget = { site: best.site, t: best.t, until: this.time + 30 };
      const [, y] = cellXYZ(best.t.cell);
      this.ui.scanResult(depthCategory(y));
    } else {
      this.scanTarget = null;
      this.ui.scanResult(null);
    }
    this.ui.updateHud();
  }

  private updateScanSignal(dt: number) {
    const st = this.scanTarget;
    if (!st || this.time > st.until || st.site.treasureClaimed(st.t)) {
      if (st) this.scanTarget = null;
      this.ui.setSignal(null);
      return;
    }
    const c = st.site.worldCellCenter(st.t.cell, this.tmpV2);
    const dx = c.x - this.player.pos.x, dz = c.z - this.player.pos.z;
    const dist = Math.hypot(dx, dz, c.y - this.player.pos.y);
    const strength = Math.max(0, Math.min(1, 1 - dist / (this.scanRingR + 2)));
    // arrow angle relative to camera view (screen-up = camera forward)
    const ang = Math.atan2(dx, dz) - Math.atan2(-Math.sin(this.cam.yaw), -Math.cos(this.cam.yaw));
    const [, y] = cellXYZ(st.t.cell);
    this.ui.setSignal({ angle: ang, strength, depth: depthCategory(y), exposed: st.site.isExposed(st.t.cell) });
    this.pingT -= dt;
    if (this.pingT <= 0) {
      this.pingT = 1.4 - strength * 1.1;
      this.audio.play('ping', strength);
    }
  }

  private updateScanRing(dt: number) {
    if (this.scanRingT < 0) { this.scanRing.visible = false; return; }
    this.scanRingT += dt / 0.9;
    const k = this.scanRingT;
    if (k >= 1) { this.scanRingT = -1; this.scanRing.visible = false; return; }
    this.scanRing.visible = true;
    const r = 0.5 + k * this.scanRingR;
    this.scanRing.scale.setScalar(r);
    this.scanRing.position.set(this.player.pos.x, this.player.pos.y + 0.15, this.player.pos.z);
    (this.scanRing.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
  }

  // ───────── actions used by UI ─────────
  selectTool(i: number) {
    if (i === 1 && !this.s.hasPickaxe) { this.ui.toast(this.s.unlocked.includes('crystal') ? 'Buy the pickaxe at the Smithy.' : 'The pickaxe unlocks with Crystal Hollow.', 'info'); return; }
    if (i === 2) {
      if (!this.s.hasLantern) { this.ui.toast('Buy a lantern at the Smithy (40 coins).', 'info'); return; }
      this.player.lanternOn = !this.player.lanternOn;
      this.ui.toast(this.player.lanternOn ? 'Lantern on' : 'Lantern off', 'info');
      this.audio.play('click');
      this.ui.updateHud();
      return;
    }
    if (i === 3) { this.echoScan(); return; }
    this.selectedSlot = i;
    this.s.activeTool = i === 1 ? 'pickaxe' : 'shovel';
    this.refreshTool();
    this.audio.play('click');
    this.ui.updateHud();
  }

  /** First-person ⇄ third-person. */
  setView(fp: boolean, announce = true) {
    this.cam.setFirstPerson(fp);
    this.s.cameraFirstPerson = fp;
    this.input.wantPointerLock = fp && !this.input.isTouch;
    if (!fp && this.input.pointerLocked) document.exitPointerLock?.();
    this.ui.setFirstPerson(fp);
    this.rebuildViewmodel();
    if (announce) this.ui.toast(fp ? (this.input.isTouch ? 'First person — drag to look' : 'First person — click to look around with the mouse (Esc frees it)') : 'Third person view', 'info');
  }

  readonly viewmodel = new THREE.Group();
  private vmKey = '';
  private vmBob = 0;
  private rebuildViewmodel() {
    const key = `${this.selectedSlot}:${this.s.toolTier}:${this.s.avatar.skin}:${this.s.avatar.inner}`;
    if (key === this.vmKey) return;
    this.vmKey = key;
    this.viewmodel.clear();
    const tool = this.selectedSlot === 1 ? buildPickaxe(this.s.toolTier) : this.selectedSlot === 2 ? buildLanternTool() : buildShovel(this.s.toolTier);
    // blade (tool −Y) aims forward, slightly up and toward the crosshair
    tool.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-0.38, 0.32, -1).normalize());
    tool.rotateY(0.6);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshStandardMaterial({ color: this.s.avatar.skin, roughness: 0.5 }));
    hand.scale.set(1, 1.15, 0.9);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.4, 4, 12), new THREE.MeshStandardMaterial({ color: this.s.avatar.inner, roughness: 0.6 }));
    sleeve.position.set(0.1, -0.12, 0.3);
    sleeve.rotation.set(1.2, 0, 0.3);
    const g = new THREE.Group();
    g.add(tool, hand, sleeve);
    g.traverse((o) => { o.castShadow = false; (o as THREE.Mesh).renderOrder = 10; });
    this.viewmodel.add(g);
    this.viewmodel.position.set(0.3, -0.3, -0.5);
    g.scale.setScalar(0.42);
  }
  private updateViewmodel(dt: number) {
    this.viewmodel.visible = this.cam.firstPerson && this.selectedSlot !== 3;
    if (!this.viewmodel.visible) return;
    this.rebuildViewmodel();
    const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
    this.vmBob += dt * speed * 1.6;
    const g = this.viewmodel;
    const s = this.player.swing;
    let rx = 0, ry = 0;
    if (s >= 0) {
      if (s < 0.45) rx = 0.7 * (s / 0.45);
      else if (s < 0.6) rx = 0.7 - 1.6 * ((s - 0.45) / 0.15);
      else rx = -0.9 + 0.9 * ((s - 0.6) / 0.4);
      ry = -rx * 0.25;
    }
    g.rotation.set(rx, ry, 0);
    g.position.set(0.3 + Math.sin(this.vmBob) * 0.01, -0.3 + Math.abs(Math.cos(this.vmBob)) * 0.014, -0.5);
  }

  refreshTool() {
    this.player.setTool(this.s.activeTool, this.s.toolTier);
  }

  refreshPlayerLook() {
    this.player.applyAvatar(this.s.avatar, this.s.cosmetics.crown);
    this.refreshTool();
  }

  returnToCamp(silent = false) {
    if (!silent) this.particles.puff(this.player.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), '#ffffff', 8, 0.8);
    this.player.teleport(CAMP.clone().add(new THREE.Vector3(0, 0.01, 0)), Math.PI);
    this.cam.yaw = 0;
    this.cam.snap(this.player.pos);
    this.pets.teleportAll(this.player.pos);
    this.swingT = -1;
    this.player.swing = -1;
    this.audio.play('pop');
    this.ui.fade();
  }

  syncPets() {
    this.pets.sync(L.equippedPets(this.s), this.player.pos);
  }

  /** Called by UI after any state-changing transaction. */
  changed(save = true) {
    this.world.refresh(this.s);
    const qs = L.syncStateQuests(this.s);
    for (const q of qs) this.questDone(q);
    this.checkAchievements();
    this.ui.updateHud();
    if (save) this.persist();
  }

  sell() {
    const r = L.sellBag(this.s);
    if (!r.ok) { this.ui.toast(r.reason, 'warn'); this.audio.play('deny'); return; }
    this.audio.play('coin');
    this.ui.flyCoins(null, Math.min(10, 3 + Math.floor(r.units / 10)));
    this.ui.toast(`Sold ${r.units} items for ${r.coins.toLocaleString('en-US')} coins`, 'good');
    const q = L.progressQuest(this.s, 'sell');
    if (q) this.questDone(q);
    this.changed();
  }

  hatchStarter() {
    if (this.hatchBusy) return;
    const r = L.resolveStarterHatch(this.s);
    if (!r.ok) { this.ui.toast(r.reason, 'warn'); return; }
    this.persist();
    this.syncPets();
    this.playHatch('starter', r.entry, r.isNew, 'tutorial');
  }

  hatch(eggId: string, useToken: boolean) {
    if (this.hatchBusy || this.s.pendingHatch) return; // double-click guard
    const r = L.resolveHatch(this.s, eggId, { useToken });
    if (!r.ok) { this.ui.toast(r.reason, 'warn'); this.audio.play('deny'); return; }
    // state transition complete & saved before any reveal
    this.persist();
    const egg = EGG_BY_ID[eggId];
    const rarity = egg.outcomes.find((o) => o.pet === r.entry)!.rarity;
    const q = L.progressQuest(this.s, 'hatch');
    if (q) this.questDone(q);
    this.playHatch(eggId, r.entry, r.isNew, rarity);
  }

  private playPendingHatch() {
    const ph = this.s.pendingHatch!;
    const pet = this.s.pets.find((p) => p.id === ph.petId)!;
    const rarity = ph.egg === 'starter' ? 'tutorial' : EGG_BY_ID[ph.egg].outcomes.find((o) => o.pet === pet.entry)?.rarity ?? 'common';
    this.playHatch(ph.egg, pet.entry, ph.isNew, rarity);
  }

  private playHatch(eggId: string, entry: string, isNew: boolean, rarity: keyof typeof RARITY_INFO) {
    this.hatchBusy = true;
    this.setPause('hatch', true);
    const fast = this.s.settings.fastHatch && this.s.stats.hatches + (this.s.starterHatched ? 1 : 0) > 1;
    this.ui.showHatch(eggId, entry, isNew, rarity, { fast: fast || this.s.settings.reducedMotion, reduced: this.s.settings.reducedMotion }, (phase) => {
      if (phase === 'anticipation' || phase === 'rocking') this.audio.play('hatchRumble');
      if (phase === 'cracks') this.audio.play('crack');
      if (phase === 'separate') this.audio.play('crack');
      if (phase === 'reveal') this.audio.play('reveal');
    });
  }

  /** Close the reveal; optionally equip the new pet. */
  finishHatch(equip: boolean) {
    const ph = this.s.pendingHatch;
    if (ph && equip && !this.s.equipped.includes(ph.petId)) {
      const r = L.equipPet(this.s, ph.petId);
      if (!r.ok) this.ui.toast(r.reason + ' Open Pets to swap.', 'warn');
    }
    if (ph?.egg === 'starter') {
      const q = L.progressQuest(this.s, 'hatchStarter');
      if (q) this.questDone(q);
    }
    L.finishHatch(this.s);
    this.hatchBusy = false;
    this.setPause('hatch', false);
    this.syncPets();
    this.pets.celebrate();
    this.changed();
  }

  unlockGate(b: BiomeId) {
    const r = L.unlockBiome(this.s, b);
    if (!r.ok) { this.ui.toast(r.reason, 'warn'); this.audio.play('deny'); return false; }
    this.audio.play('unlock');
    this.ui.toast(`${BIOMES[b].name} is open!`, 'good');
    if (b === 'crystal') this.ui.toast('A 3rd pet team slot unlocked!', 'good');
    const q = L.progressQuest(this.s, 'unlock');
    if (q) this.questDone(q);
    this.changed();
    return true;
  }

  renewSite(id: string) {
    const site = this.world.sites.find((s) => s.id === id);
    if (!site) return;
    const ppos = this.player.pos;
    if (ppos.x >= site.ox - 1 && ppos.x <= site.ox + SITE.w + 1 && ppos.z >= site.oz - 1 && ppos.z <= site.oz + SITE.d + 1) {
      this.ui.toast('Leave the site before renewing it.', 'warn');
      return;
    }
    const seed = hashString(`${id}:${Date.now()}:${Math.random()}`) || 1;
    site.load({ seed, mined: '', claimed: [], damage: [] }, seed);
    site.rebuild();
    if (this.scanTarget?.site === site) this.scanTarget = null;
    this.s.sites[id] = site.toState();
    this.ui.toast('Site renewed — its buried finds have changed.', 'good');
    this.changed();
  }

  questDone(q: { text: string; reward: { coins?: number; gems?: number } }) {
    this.audio.play('levelup');
    const parts = [];
    if (q.reward.coins) parts.push(`+${q.reward.coins} coins`);
    if (q.reward.gems) parts.push(`+${q.reward.gems} gems`);
    this.ui.toast(`Quest complete: ${q.text}${parts.length ? ' · ' + parts.join(', ') : ''}`, 'quest');
  }

  contractDone(r: { coins: number; gems: number }) {
    this.audio.play('unlock');
    this.ui.toast(`Contract complete! +${r.coins.toLocaleString('en-US')} coins, +${r.gems} gems`, 'quest');
    this.ui.flyCoins(null, 6);
  }

  private afterPetXp(ups: { id: number; entry: string; level: number }[]) {
    for (const p of ups) {
      this.audio.play('levelup');
      this.ui.toast(`${PET_ENTRY_BY_ID[p.entry].name} reached level ${p.level}! (+0.5 pp dig bonus)`, 'good');
    }
  }

  checkAchievements() {
    for (const a of L.checkAchievements(this.s)) {
      this.audio.play('unlock');
      this.ui.toast(`Achievement: ${a.name} · +${a.gems} gems`, 'quest');
    }
  }

  persist() {
    if (!this.s) return;
    for (const site of this.world.sites) this.s.sites[site.id] = site.toState();
    this.saves.save(this.s).then(() => this.ui?.saveStatus(this.saves.lastError));
  }

  async resetSave() {
    const fresh = await this.saves.wipe();
    void fresh;
    location.reload();
  }

  private async onAuthChange() {
    // finish/suspend: flush current profile, then reload so profiles never blend
    this.setPause('menu', true);
    await this.saves.save(this.s);
    this.ui.toast('Account changed — reloading your progress…', 'info');
    setTimeout(() => location.reload(), 800);
  }

  /** Optional rewarded ad (disabled in this build; kept for Full Launch wiring). */
  async rewardedCoins() {
    if (!this.platform.adsEnabled) return;
    this.setPause('ad', true);
    this.audio.setSuspended(true);
    let ok = false;
    try { ok = await this.platform.rewardedAd({ started: () => this.audio.setSuspended(true) }); } catch { ok = false; }
    this.setPause('ad', false);
    if (ok) { L.addCoins(this.s, 100); this.changed(); }
  }

  projectToScreen(p: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const v = p.clone().project(this.cam.camera);
    return { x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight, visible: v.z < 1 };
  }
}

export function treasureName(t: TreasureSpec) {
  return t.kind === 'coins' ? 'Coin Cache' : t.kind === 'geode' ? 'Gem Geode' : t.kind === 'fossil' ? 'Fossil' : t.kind === 'decor' ? 'Curio' : t.kind === 'token' ? 'Egg Token' : 'Relic Shard';
}

function makeCrackTexture(stage: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(20,14,10,0.85)';
  g.lineWidth = 2.5;
  const rng = (n: number) => ((Math.sin(n * 91.7 + stage * 13.1) * 43758.5453) % 1 + 1) % 1;
  const lines = 2 + stage * 3;
  for (let i = 0; i < lines; i++) {
    let x = 32 + (rng(i) - 0.5) * 20, y = 32 + (rng(i + 7) - 0.5) * 20;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (rng(i * 5 + k) - 0.5) * 26;
      y += (rng(i * 3 + k + 11) - 0.5) * 26;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}
