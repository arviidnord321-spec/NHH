/**
 * WorldManager: builds the four biomes around the persistent camp, owns the
 * excavation sites, static colliders, interactables and environment effects.
 * Static scenery is merged per material per biome (few draw calls); inactive
 * biomes far from the player are hidden.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BIOMES, BIOME_ORDER, BiomeId, COLLECTIBLES, EGGS, SITE, QualityLevel, QUALITY } from '../data/balance';
import type { SaveData } from '../core/state';
import { hashString, mulberry32 } from '../core/rng';
import { VoxelSite, blockTexture } from './VoxelSite';
import {
  add, basic, buildChest, buildCrystalCluster, buildEgg, buildFencePost, buildFlag, buildHuman, buildLanternPost,
  buildBush, buildPedestal, buildRock, buildSign, buildTent, buildTree, EggRig, HumanRig, lam, makeLabel, prepGeo, rb, shade, sharedVertexMaterial,
} from './models';

export type InteractKind = 'trader' | 'smith' | 'eggs' | 'museum' | 'contracts' | 'surveyor' | 'gate' | 'chamber' | 'final' | 'starterEgg' | 'cosmetics';
export interface Interactable {
  id: string;
  kind: InteractKind;
  pos: THREE.Vector3;
  radius: number;
  data?: string;
  active: boolean;
}

export interface BoxCollider { minX: number; minZ: number; maxX: number; maxZ: number; h: number; id?: string; enabled: boolean }
export interface CircleCollider { x: number; z: number; r: number; h: number }

export interface RayHit {
  ix: number; iy: number; iz: number;
  nx: number; ny: number; nz: number;
  dist: number;
  site: VoxelSite | null;
  cell: number;
  point: THREE.Vector3;
}

interface Npc { rig: HumanRig; home: THREE.Vector3; phase: number }

const SITE_ORIGINS: Record<BiomeId, [number, number][]> = {
  meadow: [[-6, -18], [-34, -14], [20, -26]],
  crystal: [[-6, -66], [-30, -100], [14, -104]],
  ember: [[50, -6], [80, -30], [88, 12]],
  aurora: [[-6, 50], [-30, 80], [16, 92]],
};
const CHAMBERS: Record<BiomeId, [number, number]> = {
  meadow: [-31, 31], crystal: [28, -113], ember: [113, 28], aurora: [-28, 113],
};
const GATES: Record<Exclude<BiomeId, 'meadow'>, { x: number; z: number; axis: 'x' | 'z' }> = {
  crystal: { x: 0, z: -40, axis: 'x' },
  ember: { x: 40, z: 0, axis: 'z' },
  aurora: { x: 0, z: 40, axis: 'x' },
};
export const SPAWN = new THREE.Vector3(0, 0, -4.4);
export const CAMP = new THREE.Vector3(0, 0, 6);
export const FINAL_POS = new THREE.Vector3(24, 0, 28);
export const STARTER_EGG_POS = new THREE.Vector3(4.5, 0, -3.2);

export class World {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sites: VoxelSite[] = [];
  readonly boxes: BoxCollider[] = [];
  readonly circles: CircleCollider[] = [];
  readonly interactables: Interactable[] = [];
  readonly vents: { x: number; z: number; r: number }[] = [];
  readonly biomeGroups = {} as Record<BiomeId, THREE.Group>;
  readonly dynamic = new THREE.Group();
  private waterMats: THREE.ShaderMaterial[] = [];
  private grassMats: THREE.Material[] = [];
  private grassUniform = { value: 0 };
  private flags: THREE.Object3D[] = [];
  private npcs: Npc[] = [];
  readonly shrineEggs: { id: string; rig: EggRig; lock: THREE.Sprite; pos: THREE.Vector3 }[] = [];
  starterEgg: EggRig | null = null;
  private starterLabel: THREE.Sprite | null = null;
  private gateBarriers = new Map<BiomeId, THREE.Object3D>();
  private gateLabels = new Map<BiomeId, THREE.Sprite>();
  private chamberDoors = new Map<BiomeId, THREE.Object3D>();
  private museumShards = new Map<string, THREE.Mesh>();
  private finalCrystal!: THREE.Group;
  private finalBarrier!: THREE.Object3D;
  private auroraRibbons: THREE.Mesh[] = [];
  private floaters: THREE.Object3D[] = [];
  private clouds: THREE.Object3D[] = [];
  private fireLight!: THREE.PointLight;
  private fireFlames: THREE.Mesh[] = [];
  private skyMat!: THREE.ShaderMaterial;
  private siteLambert: THREE.MeshLambertMaterial;
  private siteGlow: THREE.MeshBasicMaterial;
  private quality: QualityLevel = 'medium';
  private labels: THREE.Sprite[] = [];
  private labelPos = new THREE.Vector3();
  readonly fog = new THREE.Fog('#cdeaf7', 60, 210);
  private fogTarget = new THREE.Color();
  private skyTop = new THREE.Color('#4aa8ee');
  private skyBottom = new THREE.Color('#d4f0ff');

  constructor() {
    this.scene.fog = this.fog;
    this.hemi = new THREE.HemisphereLight('#eaf6ff', '#7a6a3a', 1.45);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0d0', 2.7);
    this.sun.position.set(18, 30, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 80;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.siteLambert = new THREE.MeshLambertMaterial({ vertexColors: true, map: blockTexture() });
    this.siteGlow = new THREE.MeshBasicMaterial({ vertexColors: true, map: blockTexture() });
    this.scene.add(this.dynamic);
  }

  build(save: SaveData, quality: QualityLevel) {
    this.quality = quality;
    this.buildSky();
    for (const b of BIOME_ORDER) {
      const g = new THREE.Group();
      g.name = b;
      this.biomeGroups[b] = g;
      this.scene.add(g);
    }
    this.buildBounds();
    this.buildBackdrop();
    for (const b of BIOME_ORDER) this.buildBiome(b);
    this.buildCamp();
    this.buildGates();
    this.buildChambers();
    for (const b of BIOME_ORDER) {
      SITE_ORIGINS[b].forEach(([ox, oz], i) => {
        const site = new VoxelSite(b, i, ox, oz, this.siteLambert, this.siteGlow);
        site.load(save.sites[site.id], hashString(`${site.id}:${save.hatchSeed}`) || 1);
        site.rebuild();
        this.sites.push(site);
        this.biomeGroups[b].add(site.group);
        this.buildSiteMarkers(site);
      });
    }
    // merge static scenery per biome (static subgroup only)
    for (const b of BIOME_ORDER) {
      const st = this.biomeGroups[b].getObjectByName('static');
      if (st) {
        const merged = mergeStatic(st as THREE.Group);
        this.biomeGroups[b].remove(st);
        this.biomeGroups[b].add(merged);
      }
    }
    this.scene.traverse((o) => { if ((o as THREE.Sprite).isSprite) this.labels.push(o as THREE.Sprite); });
    this.refresh(save);
  }

  private staticGroup(b: BiomeId): THREE.Group {
    let g = this.biomeGroups[b].getObjectByName('static') as THREE.Group | undefined;
    if (!g) {
      g = new THREE.Group();
      g.name = 'static';
      this.biomeGroups[b].add(g);
    }
    return g;
  }

  // ───────── Sky ─────────
  private buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: this.skyTop }, bottom: { value: this.skyBottom } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.4+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 16, 10), this.skyMat);
    sky.name = 'sky';
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.scene.userData.sky = sky;
    // chunky clouds
    const cm = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c8dcf0', emissiveIntensity: 0.55 });
    for (let i = 0; i < 10; i++) {
      const c = new THREE.Group();
      const n = 3 + (i % 3);
      const puff = new THREE.IcosahedronGeometry(1, 2);
      for (let k = 0; k < n; k++) add(c, puff, cm, k * 2.6 - n, (k % 2) * 0.9, (k % 3) * 0.8, 0, 0, 0, false).scale.setScalar(2.2 + (k % 2) * 1.1);
      c.position.set(-150 + i * 34, 38 + (i % 3) * 5, -120 + ((i * 53) % 240));
      this.clouds.push(c);
      this.scene.add(c);
    }
  }

  // ───────── Ground, walls ─────────
  private inAnyFootprint(x: number, z: number, pad = 0): boolean {
    for (const b of BIOME_ORDER) for (const [ox, oz] of SITE_ORIGINS[b]) {
      if (x >= ox - pad && x < ox + SITE.w + pad && z >= oz - pad && z < oz + SITE.d + pad) return true;
    }
    return false;
  }

  private pathSegments(b: BiomeId): [number, number, number, number][] {
    const segs: [number, number, number, number][] = [];
    const c = BIOMES[b].center;
    if (b === 'meadow') {
      segs.push([0, 6, 0, -40], [0, 6, 40, 0], [0, 6, 0, 40], [0, -2, -28, -8], [0, -2, 26, -20], [0, 18, -14, 16], [0, 12, 13, 15], [0, 12, -24, 22], [6, 20, 24, 28]);
    } else {
      const gate = GATES[b as Exclude<BiomeId, 'meadow'>];
      segs.push([gate.x, gate.z, c[0], c[1]]);
      for (const [ox, oz] of SITE_ORIGINS[b]) segs.push([c[0], c[1], ox + 6, oz + 6]);
      segs.push([c[0], c[1], CHAMBERS[b][0], CHAMBERS[b][1]]);
    }
    return segs;
  }

  private buildGround(b: BiomeId) {
    const def = BIOMES[b];
    const [cx, cz] = def.center;
    const h = def.half;
    const T = 2;
    const P: number[] = [], C: number[] = [], N: number[] = [];
    const g1 = new THREE.Color(def.ground), g2 = new THREE.Color(def.ground2);
    const pathC = new THREE.Color(b === 'meadow' ? '#cf9452' : b === 'crystal' ? '#8fa0c8' : b === 'ember' ? '#7a6158' : '#4a5a8a');
    const segs = this.pathSegments(b);
    const rng = mulberry32(hashString(b));
    const col = new THREE.Color();
    const distSeg = (x: number, z: number, s: [number, number, number, number]) => {
      const [ax, az, bx, bz] = s;
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    };
    // colors are evaluated per vertex (shared by neighbouring tiles) so paths get
    // soft organic edges and the grass has no tile seams
    const vcache = new Map<number, THREE.Color>();
    const hash = (x: number, z: number) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
    const vertexColor = (x: number, z: number) => {
      const key = x * 100003 + z;
      let c = vcache.get(key);
      if (c) return c;
      let d = Infinity;
      for (const sg of segs) d = Math.min(d, distSeg(x, z, sg));
      const wob = (hash(x * 0.37, z * 0.41) - 0.5) * 1.1;
      const t = Math.min(1, Math.max(0, (d + wob - 1.1) / 1.4));
      const grass = new THREE.Color().copy(g1).lerp(g2, hash(x, z)).multiplyScalar(0.96 + hash(z, x) * 0.08);
      c = new THREE.Color().copy(pathC).multiplyScalar(0.95 + hash(x + 3, z) * 0.1).lerp(grass, t * t * (3 - 2 * t));
      vcache.set(key, c);
      return c;
    };
    void rng; void col;
    for (let x = cx - h; x < cx + h; x += T) {
      for (let z = cz - h; z < cz + h; z += T) {
        if (this.inAnyFootprint(x + 0.5, z + 0.5)) continue;
        const quad = [[x, z], [x, z + T], [x + T, z + T], [x, z], [x + T, z + T], [x + T, z]];
        for (const [qx, qz] of quad) { const vc = vertexColor(qx, qz); P.push(qx, 0, qz); C.push(vc.r, vc.g, vc.b); N.push(0, 1, 0); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    const U: number[] = [];
    for (let i = 0; i < P.length; i += 3) U.push(P[i] / 3.5, P[i + 2] / 3.5);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTexture() }));
    ground.receiveShadow = true;
    this.biomeGroups[b].add(ground);
  }

  /** Perimeter walls (cliffs) with gaps for gates. */
  private buildBounds() {
    const wall = (b: BiomeId, x0: number, z0: number, x1: number, z1: number) => {
      this.boxes.push({ minX: Math.min(x0, x1) - 1, minZ: Math.min(z0, z1) - 1, maxX: Math.max(x0, x1) + 1, maxZ: Math.max(z0, z1) + 1, h: 50, enabled: true });
      const st = this.staticGroup(b);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.ceil(len / 3);
      const def = BIOMES[b];
      const rockC = b === 'meadow' ? '#ab9c82' : b === 'crystal' ? '#5a6a9a' : b === 'ember' ? '#3a3438' : '#2c3b66';
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        // low rocky ledges keep the horizon (sky, mesas, forest) visible
        const hh = 1.6 + ((i * 7) % 5) * 0.45;
        add(st, rb(3.4, hh, 3.4, 0.4), lam(shade(rockC, ((i * 3) % 4) * 0.03)), x, hh / 2 - 0.2, z, 0, (i % 3) * 0.2, 0, false).userData.noShadow = true;
        if (b !== 'ember' && b !== 'aurora' && i % 2 === 0) add(st, rb(3.6, 0.5, 3.6, 0.2), lam(def.ground), x, hh - 0.1, z, 0, (i % 3) * 0.2, 0, false);
        if (b === 'crystal' && i % 4 === 0) { const cc = buildCrystalCluster('#9462f5', 4, 1.4); cc.position.set(x, hh - 0.2, z); st.add(cc); }
      }
    };
    const H = 40;
    // meadow
    wall('meadow', -H, -H, -H, H);
    wall('meadow', -H, -H, -4, -H); wall('meadow', 4, -H, H, -H);
    wall('meadow', H, -H, H, -4); wall('meadow', H, 4, H, H);
    wall('meadow', -H, H, -4, H); wall('meadow', 4, H, H, H);
    // crystal (north) z -42..-122
    wall('crystal', -H, -42, -H, -122); wall('crystal', H, -42, H, -122); wall('crystal', -H, -122, H, -122);
    wall('crystal', -H, -42, -4, -42); wall('crystal', 4, -42, H, -42);
    // ember (east) x 42..122
    wall('ember', 42, -H, 122, -H); wall('ember', 42, H, 122, H); wall('ember', 122, -H, 122, H);
    wall('ember', 42, -H, 42, -4); wall('ember', 42, 4, 42, H);
    // aurora (south) z 42..122
    wall('aurora', -H, 42, -H, 122); wall('aurora', H, 42, H, 122); wall('aurora', -H, 122, H, 122);
    wall('aurora', -H, 42, -4, 42); wall('aurora', 4, 42, H, 42);
    // gate corridor side walls (between z=-40 and -42 etc.)
    this.boxes.push({ minX: -40, minZ: -43, maxX: -4.5, maxZ: -39, h: 50, enabled: true });
    this.boxes.push({ minX: 4.5, minZ: -43, maxX: 40, maxZ: -39, h: 50, enabled: true });
    this.boxes.push({ minX: 39, minZ: -40, maxX: 43, maxZ: -4.5, h: 50, enabled: true });
    this.boxes.push({ minX: 39, minZ: 4.5, maxX: 43, maxZ: 40, h: 50, enabled: true });
    this.boxes.push({ minX: -40, minZ: 39, maxX: -4.5, maxZ: 43, h: 50, enabled: true });
    this.boxes.push({ minX: 4.5, minZ: 39, maxX: 40, maxZ: 43, h: 50, enabled: true });
  }

  /** Ground to the horizon (with a hole over the playable plus-shape), distant mesas and forest. */
  private buildBackdrop() {
    const outer = new THREE.Shape();
    outer.moveTo(-420, -420); outer.lineTo(420, -420); outer.lineTo(420, 420); outer.lineTo(-420, 420); outer.lineTo(-420, -420);
    const e = 39; // just inside the perimeter ledges, under them
    const hole = new THREE.Path();
    const pts: [number, number][] = [[-e, -121], [e, -121], [e, -e], [121, -e], [121, e], [e, e], [e, 121], [-e, 121], [-e, e], [-e, -e], [-e, -121]];
    hole.moveTo(pts[0][0], -pts[0][1]);
    for (const [x, z] of pts.slice(1)) hole.lineTo(x, -z);
    outer.holes.push(hole);
    const geo = new THREE.ShapeGeometry(outer);
    geo.rotateX(-Math.PI / 2);
    const gp = geo.attributes.position;
    const gu: number[] = [];
    for (let i = 0; i < gp.count; i++) gu.push(gp.getX(i) / 3.5, gp.getZ(i) / 3.5);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(gu, 2));
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#66b83c', map: groundTexture() }));
    ground.position.y = -0.03;
    ground.receiveShadow = false;
    this.scene.add(ground);
    const g = new THREE.Group();
    const rng = mulberry32(4242);
    // forest band just beyond the ledges
    for (let i = 0; i < 95; i++) {
      const a = rng() * Math.PI * 2, r = 135 + rng() * 60;
      let x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (i < 70) { // also hug the meadow's outer edges
        const side = i % 3;
        if (side === 0) { x = -46 - rng() * 30; z = (rng() * 2 - 1) * 40; }
        else if (side === 1) { x = 46 + rng() * 30; z = 46 + rng() * 20; }
        else { x = -46 - rng() * 20; z = -46 - rng() * 20; }
      }
      if (Math.abs(x) < 42 && z > -124 && z < 124) continue;
      if (Math.abs(z) < 42 && x > -42 && x < 124) continue;
      const t = buildTree(rng() < 0.55 ? 'pine' : 'oak', i + 900);
      t.position.set(x, 0, z);
      t.scale.setScalar(1.4 + rng() * 1.2);
      g.add(t);
    }
    // distant grass-topped mesas
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng() * 0.1, r = 240 + rng() * 70;
      const w = 30 + rng() * 40, h = 22 + rng() * 34;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      add(g, rb(w, h, w * 0.8, 3), lam(shade('#b0a086', (rng() - 0.5) * 0.08), undefined, true), x, h / 2 - 1, z, 0, a, 0, false);
      add(g, rb(w + 2, 3, w * 0.8 + 2, 1.2), lam('#5fae3a'), x, h, z, 0, a, 0, false);
      if (rng() < 0.6) add(g, rb(w * 0.55, h * 0.4, w * 0.45, 2.5), lam('#a39378', undefined, true), x + 6, h + h * 0.2, z, 0, a + 0.3, 0, false);
    }
    g.traverse((o) => { o.userData.noShadow = true; });
    const merged = mergeStatic(g, 400);
    merged.traverse((o) => { (o as THREE.Mesh).castShadow = false; (o as THREE.Mesh).receiveShadow = false; });
    merged.name = 'backdrop';
    this.scene.add(merged);
  }

  private density() {
    return QUALITY[this.quality].decorDensity;
  }

  private placeFree(rng: () => number, cx: number, cz: number, half: number, avoid: (x: number, z: number) => boolean, tries = 30): [number, number] | null {
    for (let i = 0; i < tries; i++) {
      const x = cx + (rng() * 2 - 1) * (half - 4), z = cz + (rng() * 2 - 1) * (half - 4);
      if (this.inAnyFootprint(x, z, 3)) continue;
      if (avoid(x, z)) continue;
      return [x, z];
    }
    return null;
  }

  private nearPath(b: BiomeId, x: number, z: number, d: number) {
    for (const [ax, az, bx, bz] of this.pathSegments(b)) {
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < d) return true;
    }
    return false;
  }

  private buildBiome(b: BiomeId) {
    this.buildGround(b);
    const def = BIOMES[b];
    const [cx, cz] = def.center;
    const rng = mulberry32(hashString(b + 'decor'));
    const st = this.staticGroup(b);
    const dens = this.density();
    const avoid = (x: number, z: number) =>
      this.nearPath(b, x, z, 2.5) || (b === 'meadow' && Math.hypot(x, z - 10) < 20) || Math.hypot(x - CHAMBERS[b][0], z - CHAMBERS[b][1]) < 7 || this.nearLandmark(b, x, z);
    const treeKind = b === 'meadow' ? 'oak' : b === 'crystal' ? 'crystal' : b === 'ember' ? 'ember' : 'aurora';
    const nTrees = Math.round(28 * Math.max(0.6, dens));
    for (let i = 0; i < nTrees; i++) {
      const p = this.placeFree(rng, cx, cz, def.half, avoid);
      if (!p) continue;
      const kind = b === 'meadow' && rng() < 0.35 ? 'pine' : treeKind;
      const t = buildTree(kind, i + hashString(b));
      t.position.set(p[0], 0, p[1]);
      t.rotation.y = rng() * Math.PI * 2;
      st.add(t);
      this.circles.push({ x: p[0], z: p[1], r: kind === 'crystal' || kind === 'aurora' ? 0.7 : 0.55, h: 5 });
    }
    const rockC = b === 'meadow' ? '#9a968f' : b === 'crystal' ? '#6a7cb0' : b === 'ember' ? '#3a3640' : '#3d4f80';
    for (let i = 0; i < 22; i++) {
      const p = this.placeFree(rng, cx, cz, def.half, avoid);
      if (!p) continue;
      const s = 0.5 + rng() * 1.2;
      const r = buildRock(shade(rockC, (rng() - 0.5) * 0.1), s);
      r.position.set(p[0], s * 0.25, p[1]);
      r.rotation.set(rng(), rng() * 6, rng());
      st.add(r);
      if (s > 0.9) this.circles.push({ x: p[0], z: p[1], r: s * 0.6, h: s });
    }
    const bushC = b === 'meadow' ? '#4fa83a' : b === 'crystal' ? '#4f78c0' : b === 'ember' ? '#5a4a40' : '#1f8a80';
    for (let i = 0; i < Math.round(36 * Math.max(0.6, dens)); i++) {
      const p = this.placeFree(rng, cx, cz, def.half, avoid);
      if (!p) continue;
      const bush = buildBush(i + hashString(b), bushC);
      bush.position.set(p[0], 0, p[1]);
      bush.rotation.y = rng() * 6;
      st.add(bush);
    }
    if (b !== 'meadow') {
      const cc = b === 'crystal' ? '#9462f5' : b === 'ember' ? '#ff7a2e' : '#16cdbb';
      for (let i = 0; i < 16; i++) {
        const p = this.placeFree(rng, cx, cz, def.half, avoid);
        if (!p) continue;
        const cl = buildCrystalCluster(i % 3 === 0 && b === 'crystal' ? '#5fd0ff' : cc, 4 + (i % 3), 0.7 + rng() * 0.8);
        cl.position.set(p[0], 0, p[1]);
        st.add(cl);
      }
    }
    // landmarks & special features
    if (b === 'meadow') this.buildMeadowFeatures(st);
    if (b === 'crystal') this.buildCrystalFeatures(st);
    if (b === 'ember') this.buildEmberFeatures(st);
    if (b === 'aurora') this.buildAuroraFeatures(st);
    this.buildGrass(b, rng);
  }

  private nearLandmark(b: BiomeId, x: number, z: number) {
    const L: Record<BiomeId, [number, number, number][]> = {
      meadow: [[-24, 22, 6], [28, 12, 7], [24, 28, 6]],
      crystal: [[0, -86, 8], [-20, -74, 5], [20, -82, 4]],
      ember: [[104, -12, 7], [70, 20, 4], [100, 32, 3]],
      aurora: [[0, 88, 9]],
    };
    return L[b].some(([lx, lz, r]) => Math.hypot(x - lx, z - lz) < r);
  }

  private buildGrass(b: BiomeId, rng: () => number) {
    if (b === 'ember') return;
    const def = BIOMES[b];
    const count = Math.round((b === 'meadow' ? 3600 : 900) * this.density());
    // a tuft = 4 tapered blades with a dark-root → bright-tip gradient
    const base = new THREE.Color(b === 'meadow' ? '#3f8a2a' : b === 'crystal' ? '#3d5f9a' : '#16786e');
    const tip = new THREE.Color(b === 'meadow' ? '#8fd24e' : b === 'crystal' ? '#9fc4ff' : '#5ff0dc');
    const P: number[] = [], C: number[] = [], N: number[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI + rng() * 0.4;
      const h = 0.28 + rng() * 0.22, w = 0.075;
      const ox = Math.cos(a + 1.5) * 0.06, oz = Math.sin(a + 1.5) * 0.06;
      const lean = (rng() - 0.5) * 0.2;
      const dx = Math.cos(a) * w, dz = Math.sin(a) * w;
      P.push(ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox + lean, h, oz + lean * 0.5);
      C.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
      N.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    // unlit vertex colors: both blade sides stay bright (no dark back faces)
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.grassUniform;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
        float sway = sin(uTime*1.8 + wp.x*0.35 + wp.z*0.27) * 0.18 * position.y;
        transformed.x += sway; transformed.z += sway*0.6;`);
    };
    this.grassMats.push(m);
    const mesh = new THREE.InstancedMesh(geo, m, count);
    const d = new THREE.Object3D();
    let n = 0;
    const [cx, cz] = def.center;
    for (let i = 0; i < count; i++) {
      const x = cx + (rng() * 2 - 1) * (def.half - 2), z = cz + (rng() * 2 - 1) * (def.half - 2);
      if (this.inAnyFootprint(x, z, 0.4) || this.nearPath(b, x, z, 1.6)) continue;
      if (b === 'meadow' && Math.abs(x) < 7 && z > 2 && z < 16) continue;
      d.position.set(x, 0, z);
      d.rotation.set(0, rng() * 6, 0);
      d.scale.setScalar(0.8 + rng() * 0.5);
      d.updateMatrix();
      mesh.setMatrixAt(n++, d.matrix);
    }
    mesh.count = n;
    this.biomeGroups[b].add(mesh);
    if (b === 'meadow') {
      // daisies: petals + golden centre share instance transforms
      const petals = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.035, 6, 1), new THREE.MeshLambertMaterial({ color: '#ffffff' }), 520);
      const centers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 5, 3), new THREE.MeshLambertMaterial({ color: '#ffc928' }), 520);
      const fc = [new THREE.Color('#ffffff'), new THREE.Color('#ffffff'), new THREE.Color('#ff9ad0'), new THREE.Color('#ffe36a'), new THREE.Color('#c9a8ff')];
      let fn = 0;
      for (let i = 0; i < 520; i++) {
        const x = (rng() * 2 - 1) * 37, z = (rng() * 2 - 1) * 37;
        if (this.inAnyFootprint(x, z, 0.5) || this.nearPath(b, x, z, 1.8)) continue;
        if (Math.abs(x) < 7 && z > 2 && z < 16) continue;
        d.position.set(x, 0.3 + rng() * 0.12, z);
        d.rotation.set((rng() - 0.5) * 0.4, rng() * 6, (rng() - 0.5) * 0.4);
        d.scale.setScalar(0.8 + rng() * 0.6);
        d.updateMatrix();
        petals.setMatrixAt(fn, d.matrix);
        petals.setColorAt(fn, fc[fn % fc.length]);
        d.position.y += 0.025;
        d.updateMatrix();
        centers.setMatrixAt(fn, d.matrix);
        fn++;
      }
      petals.count = fn;
      centers.count = fn;
      this.biomeGroups[b].add(petals, centers);
    }
  }

  private buildWater(b: BiomeId, x: number, z: number, r: number, deep: string, shallow: string) {
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, deep: { value: new THREE.Color(deep) }, shallow: { value: new THREE.Color(shallow) }, fogColor: { value: this.fog.color }, fogNear: { value: 40 }, fogFar: { value: 140 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform float uTime; uniform vec3 deep; uniform vec3 shallow; varying vec2 vUv; varying vec3 vW;
        void main(){ float d = length(vUv-0.5)*2.0;
          vec3 c = mix(deep, shallow, smoothstep(0.2,0.95,d));
          float rip = sin(vW.x*1.7+uTime*1.6)*sin(vW.z*1.9-uTime*1.3);
          c += smoothstep(0.75,0.98,rip)*0.18;
          float foam = smoothstep(0.86,0.93,d+sin(atan(vUv.y-0.5,vUv.x-0.5)*7.0+uTime*2.0)*0.015);
          c = mix(c, vec3(1.0), foam*0.85);
          gl_FragColor = vec4(c, 0.92); }`,
      transparent: true,
    });
    this.waterMats.push(m);
    const w = new THREE.Mesh(new THREE.CircleGeometry(r, 28), m);
    w.rotation.x = -Math.PI / 2;
    w.position.set(x, 0.04, z);
    this.biomeGroups[b].add(w);
    // rim stones
    const st = this.staticGroup(b);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rk = buildRock(b === 'meadow' ? '#9a968f' : '#6a7cb0', 0.45);
      rk.position.set(x + Math.cos(a) * (r + 0.2), 0.05, z + Math.sin(a) * (r + 0.2));
      st.add(rk);
    }
    this.circles.push({ x, z, r: r + 0.1, h: 0.5 });
  }

  private buildMeadowFeatures(st: THREE.Group) {
    // ruined stone well landmark + big oak
    const wx = -24, wz = 22;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const hh = i % 3 === 0 ? 0.6 : 1.1;
      add(st, rb(0.9, hh, 0.6, 0.1), lam(shade('#a8a296', (i % 3) * 0.03)), wx + Math.cos(a) * 1.5, hh / 2, wz + Math.sin(a) * 1.5, 0, -a, 0);
    }
    add(st, rb(0.25, 2.6, 0.25, 0.05), lam('#7a5236'), wx - 1.4, 1.3, wz);
    add(st, rb(0.25, 2.6, 0.25, 0.05), lam('#7a5236'), wx + 1.4, 1.3, wz);
    add(st, rb(3.2, 0.25, 0.3, 0.05), lam('#7a5236'), wx, 2.55, wz, 0, 0, 0.08);
    add(st, cachedCyl(1.2, 1.2, 0.05), lam('#2a4a7a'), wx, 0.3, wz);
    this.circles.push({ x: wx, z: wz, r: 2.1, h: 2 });
    const oak = buildTree('oak', 99);
    oak.scale.setScalar(1.9);
    oak.position.set(wx - 5, 0, wz + 3);
    st.add(oak);
    this.circles.push({ x: wx - 5, z: wz + 3, r: 0.9, h: 6 });
    this.buildWater('meadow', 28, 12, 5, '#2f7fb8', '#5fc8e8');
  }

  private buildCrystalFeatures(st: THREE.Group) {
    // giant geode arch
    const ax = 0, az = -86;
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI;
      const x = ax + Math.cos(a) * 6, y = Math.sin(a) * 6;
      add(st, rb(1.8, 1.8, 2.2, 0.3), lam('#4a4652', undefined, true), x, y + 0.6, az, 0, 0, a);
      const cl = buildCrystalCluster(i % 2 ? '#9462f5' : '#5fd0ff', 3, 0.9);
      cl.position.set(x * 0.92 + ax * 0.08, y * 0.85 + 0.4, az);
      cl.rotation.z = a + Math.PI / 2;
      st.add(cl);
    }
    this.circles.push({ x: ax - 6, z: az, r: 1.3, h: 5 }, { x: ax + 6, z: az, r: 1.3, h: 5 });
    this.buildWater('crystal', -20, -74, 4, '#3a2a8a', '#8f7fe8');
    this.buildWater('crystal', 20, -82, 3, '#1a4a8a', '#6fb8f0');
  }

  private buildEmberFeatures(st: THREE.Group) {
    const fx = 104, fz = -12;
    add(st, rb(5, 3, 5, 0.3), lam('#2e2b33'), fx, 1.5, fz);
    add(st, rb(2, 7, 2, 0.2), lam('#3a3438'), fx + 1, 5, fz - 1);
    add(st, rb(1.6, 0.6, 1.6, 0.1), basic('#ff7a2e'), fx + 1, 8.6, fz - 1);
    add(st, rb(2.6, 1.4, 0.3, 0.1), basic('#ff9a3d'), fx, 1.4, fz + 2.5);
    for (let i = 0; i < 4; i++) {
      add(st, cachedCyl(0.25, 0.25, 6), lam('#c4733a'), fx - 4 + i * 0.7, 0.4, fz + 4 - i * 2, 0, 0, Math.PI / 2);
      add(st, cachedCyl(0.3, 0.3, 0.4), lam('#8a5a2a'), fx - 1.2 + i * 0.7, 0.4, fz + 4 - i * 2, 0, 0, Math.PI / 2);
    }
    this.boxes.push({ minX: fx - 2.7, minZ: fz - 2.7, maxX: fx + 2.7, maxZ: fz + 2.7, h: 8, enabled: true });
    // basalt columns
    const rng = mulberry32(7);
    for (let i = 0; i < 14; i++) {
      const x = 60 + rng() * 55, z = -36 + rng() * 72;
      if (this.inAnyFootprint(x, z, 3) || this.nearPath('ember', x, z, 2.5) || Math.hypot(x - fx, z - fz) < 7) continue;
      const h = 1 + rng() * 3;
      add(st, cachedCyl(0.6, 0.6, h, 6), lam('#2a272e', undefined, true), x, h / 2, z);
      this.circles.push({ x, z, r: 0.65, h });
    }
    // warm vents: readable, gentle push
    for (const [x, z] of [[70, 20], [100, 32], [64, -26]] as [number, number][]) {
      add(st, cachedCyl(1.2, 1.5, 0.3, 8), lam('#3a3438', undefined, true), x, 0.15, z);
      add(st, cachedCyl(0.8, 0.8, 0.32, 8), basic('#ff7a2e'), x, 0.17, z);
      this.vents.push({ x, z, r: 1.4 });
    }
  }

  private buildAuroraFeatures(st: THREE.Group) {
    const cx = 0, cz = 88;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = 3 + (i % 3);
      add(st, rb(1.2, h, 1.2, 0.15), lam('#3d4f80', undefined, true), cx + Math.cos(a) * 7, h / 2, cz + Math.sin(a) * 7);
      add(st, rb(1.6, 0.4, 1.6, 0.1), lam('#4d5f90'), cx + Math.cos(a) * 7, h, cz + Math.sin(a) * 7);
      this.circles.push({ x: cx + Math.cos(a) * 7, z: cz + Math.sin(a) * 7, r: 0.8, h });
    }
    const core = buildCrystalCluster('#16cdbb', 6, 2.2);
    core.position.set(cx, 0, cz);
    st.add(core);
    this.circles.push({ x: cx, z: cz, r: 1.2, h: 4 });
    // floating stones (animated; not merged)
    for (let i = 0; i < 9; i++) {
      const r = buildRock('#4d5f90', 0.6 + (i % 3) * 0.4);
      const a = (i / 9) * Math.PI * 2;
      r.position.set(cx + Math.cos(a) * (11 + (i % 2) * 6), 4 + (i % 4) * 1.5, cz + Math.sin(a) * (11 + (i % 2) * 6));
      r.userData.baseY = r.position.y;
      r.userData.phase = i;
      this.biomeGroups.aurora.add(r);
      this.floaters.push(r);
    }
    // aurora ribbons in the sky
    for (let i = 0; i < 3; i++) {
      const g = new THREE.PlaneGeometry(90, 10, 30, 1);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: i === 1 ? '#9462f5' : '#16cdbb', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      m.position.set(-10 + i * 12, 34 + i * 4, 110 - i * 14);
      m.rotation.set(0.3, i * 0.4, 0);
      m.userData.base = Float32Array.from(g.attributes.position.array as Float32Array);
      this.auroraRibbons.push(m);
      this.biomeGroups.aurora.add(m);
    }
  }

  // ───────── Camp ─────────
  private npc(name: string, role: string, x: number, z: number, look: Parameters<typeof buildHuman>[0], face = 0) {
    const rig = buildHuman(look);
    rig.root.position.set(x, 0, z);
    rig.root.rotation.y = face;
    rig.root.scale.setScalar(0.92);
    const label = makeLabel(name, { sub: role, size: 0.5 });
    label.position.set(0, 2.75, 0);
    rig.root.add(label);
    this.biomeGroups.meadow.add(rig.root);
    this.npcs.push({ rig, home: new THREE.Vector3(x, 0, z), phase: x * 0.3 });
    this.circles.push({ x, z, r: 0.5, h: 2 });
  }

  private buildCamp() {
    const st = this.staticGroup('meadow');
    // campfire
    const fx = 0, fz = 9;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(st, buildRockGeo(), lam('#8e8a86', undefined, true), fx + Math.cos(a) * 0.9, 0.15, fz + Math.sin(a) * 0.9).scale.set(0.5, 0.4, 0.5);
    }
    add(st, rb(1.4, 0.22, 0.25, 0.06), lam('#6a4630'), fx, 0.15, fz, 0, 0.6, 0);
    add(st, rb(1.4, 0.22, 0.25, 0.06), lam('#6a4630'), fx, 0.2, fz, 0, -0.6, 0);
    for (let i = 0; i < 3; i++) {
      const fl = add(this.biomeGroups.meadow, new THREE.ConeGeometry(0.3 - i * 0.07, 0.9 - i * 0.2, 5), basic(i === 0 ? '#ff7a2e' : i === 1 ? '#ffbd38' : '#fff4b0'), fx, 0.5 + i * 0.05, fz, 0, i, 0, false);
      this.fireFlames.push(fl);
    }
    this.fireLight = new THREE.PointLight('#ffa040', 18, 12, 1.6);
    this.fireLight.position.set(fx, 1.2, fz);
    this.biomeGroups.meadow.add(this.fireLight);
    this.circles.push({ x: fx, z: fz, r: 1.1, h: 1 });
    // log benches
    for (const [x, z, r] of [[-2.6, 9, 0], [2.6, 9, 0], [0, 11.6, Math.PI / 2]] as number[][]) {
      add(st, cachedCyl(0.3, 0.3, 1.8, 8), lam('#7a5236'), x, 0.3, z, 0, r, Math.PI / 2);
    }
    // Trader stall
    const stall = (x: number, z: number, canopy: string, rot: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      add(g, rb(3.2, 1.0, 1.2, 0.08), lam('#9a6a3a'), 0, 0.5, 0.8);
      add(g, rb(3.4, 0.12, 1.4, 0.04), lam('#7a5236'), 0, 1.05, 0.8);
      for (const sx of [-1.6, 1.6]) for (const sz of [-0.4, 1.4]) add(g, rb(0.16, 2.8, 0.16, 0.04), lam('#6a4630'), sx, 1.4, sz);
      add(g, rb(3.8, 0.12, 2.4, 0.05), lam(canopy), 0, 2.85, 0.5, 0.12, 0, 0);
      for (let i = 0; i < 4; i++) add(g, rb(0.95, 0.24, 0.1, 0.04), lam(i % 2 ? '#fff4dc' : canopy), -1.45 + i * 0.96, 2.62, 1.75);
      add(g, rb(0.7, 0.6, 0.7, 0.06), lam('#a8743f'), -2.2, 0.3, -0.2);
      add(g, rb(0.6, 0.5, 0.6, 0.06), lam('#8a5a32'), -2.1, 0.85, -0.2, 0, 0.3, 0);
      st.add(g);
      return g;
    };
    stall(-9, 4, '#ffbd38', 0.35);
    this.boxes.push({ minX: -11, minZ: 3.4, maxX: -7, maxZ: 6.2, h: 1.2, enabled: true });
    this.npc('Mara', 'Trader · Sell resources', -9.2, 3.6, { jacket: '#c44a3a', pants: '#3a3f4f', skin: '#e8b88a', helmet: null, scarf: '#ffbd38', backpack: false, hat: 'wide', hair: '#3b2418' }, 0.35);
    this.interactables.push({ id: 'trader', kind: 'trader', pos: new THREE.Vector3(-8.2, 0, 6.6), radius: 3.6, active: true });
    // sell-zone ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.9, 32), basic('#ffbd38', 0.55));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(-8.2, 0.03, 6.6);
    this.biomeGroups.meadow.add(ring);
    // Smithy
    const sg = new THREE.Group();
    sg.position.set(9, 0, 4);
    sg.rotation.y = -0.35;
    add(sg, rb(3.6, 2.4, 2.4, 0.15), lam('#8e8a86', undefined, true), 0, 1.2, -0.6);
    add(sg, rb(4.0, 0.4, 2.8, 0.1), lam('#6a4630'), 0, 2.6, -0.4);
    add(sg, rb(1.2, 0.5, 0.2, 0.05), basic('#ff9a3d'), 0, 0.8, 0.62);
    add(sg, rb(0.9, 0.4, 0.45, 0.06), lam('#3b3a40'), -0.3, 0.75, 1.6);
    add(sg, rb(0.4, 0.5, 0.35, 0.05), lam('#4a4652'), -0.3, 0.3, 1.6);
    add(sg, rb(0.7, 2.6, 0.7, 0.08), lam('#6c6872'), 1.3, 3.0, -1.2);
    st.add(sg);
    this.boxes.push({ minX: 7, minZ: 2.2, maxX: 11, maxZ: 5, h: 3, enabled: true });
    this.npc('Bram', 'Smith · Upgrades', 7.6, 6.1, { jacket: '#5a5f6e', pants: '#3b2b22', skin: '#c98e62', helmet: null, scarf: '#ff7a2e', backpack: false, hair: '#2a2a2a' }, -0.6);
    this.interactables.push({ id: 'smith', kind: 'smith', pos: new THREE.Vector3(7.6, 0, 7.4), radius: 3.2, active: true });
    // Egg shrine
    const shrineZ = 19;
    add(st, cachedCyl(6.5, 6.8, 0.3, 16), lam('#d8cdb8', undefined, true), 0, 0.15, shrineZ);
    add(st, cachedCyl(6.6, 6.6, 0.06, 16), lam('#16cdbb', '#0a5a52'), 0, 0.31, shrineZ);
    EGGS.forEach((e, i) => {
      const a = Math.PI + (i - 1.5) * 0.55;
      const x = Math.sin(a) * 4.2, z = shrineZ + Math.cos(a) * -4.2 * -1 * 0.6 + 1.2;
      const ped = buildPedestal(e.accent);
      ped.position.set(x, 0.3, z);
      st.add(ped);
      const rig = buildEgg(e.id);
      rig.root.position.set(x, 1.32, z);
      rig.root.scale.setScalar(0.95);
      this.biomeGroups.meadow.add(rig.root);
      const lock = makeLabel('🔒 ' + BIOMES[e.biome].name, { size: 0.42 });
      lock.position.set(x, 3.2, z);
      this.biomeGroups.meadow.add(lock);
      const name = makeLabel(e.name, { sub: `${e.cost.toLocaleString('en-US')} coins`, size: 0.42 });
      name.position.set(x, 3.0, z);
      name.name = 'eggName';
      rig.root.userData.nameLabel = name;
      this.biomeGroups.meadow.add(name);
      this.shrineEggs.push({ id: e.id, rig, lock, pos: new THREE.Vector3(x, 0, z) });
      this.circles.push({ x, z, r: 0.9, h: 1.5 });
      this.interactables.push({ id: `egg_${e.id}`, kind: 'eggs', pos: new THREE.Vector3(x, 0, z - 1.6), radius: 2.0, data: e.id, active: true });
    });
    this.npc('Wren', 'Egg Keeper', 0, 22.5, { jacket: '#9462f5', pants: '#2c3d6b', skin: '#ffd9a8', helmet: null, scarf: '#fff4dc', backpack: false, hat: 'cap', hair: '#a85a2a' }, Math.PI);
    // Museum tent
    const mt = buildTent('#f2e2c0');
    mt.position.set(-16, 0, 16);
    mt.rotation.y = Math.PI / 2;
    mt.scale.setScalar(1.6);
    st.add(mt);
    this.boxes.push({ minX: -18.6, minZ: 12.2, maxX: -13.4, maxZ: 19.8, h: 3, enabled: true });
    this.npc('Prof. Hollis', 'Curator · Museum', -12, 13.2, { jacket: '#2c6e5a', pants: '#5a3a24', skin: '#f0c8a0', helmet: null, scarf: '#ffbd38', backpack: false, hat: 'wide', hair: '#d8d8d8' }, 0.9);
    this.interactables.push({ id: 'museum', kind: 'museum', pos: new THREE.Vector3(-11.2, 0, 14.4), radius: 3, active: true });
    // museum display stands (outside the tent) with relic shards
    BIOME_ORDER.forEach((b, bi) => {
      const x = -11, z = 18 + bi * 1.9;
      add(st, rb(1.6, 0.9, 0.9, 0.08), lam('#d8cdb8'), x - 1.2, 0.45, z);
      add(st, rb(1.7, 0.08, 1.0, 0.03), lam(['#78ae48', '#9462f5', '#ff7a2e', '#16cdbb'][bi]), x - 1.2, 0.92, z);
      COLLECTIBLES.filter((c) => c.biome === b && c.kind === 'relic').forEach((c, ci) => {
        const shard = add(this.biomeGroups.meadow, new THREE.OctahedronGeometry(0.16, 0), lam('#2a2a33'), x - 1.7 + ci * 0.5, 1.2, z);
        shard.scale.set(0.8, 1.4, 0.5);
        this.museumShards.set(c.id, shard);
      });
      this.boxes.push({ minX: x - 2.1, minZ: z - 0.5, maxX: x - 0.3, maxZ: z + 0.5, h: 1, enabled: true });
    });
    // Contracts board + Pip
    const board = buildSign('Expedition', 'Contracts');
    board.position.set(-6, 0, 14);
    board.rotation.y = 0.5;
    this.biomeGroups.meadow.add(board);
    this.npc('Pip', 'Cartographer · Contracts', -4.6, 13.2, { jacket: '#2f6fd0', pants: '#3b2b22', skin: '#ffd9a8', helmet: '#ffbd38', scarf: '#ff7a2e', backpack: true }, 0.4);
    this.interactables.push({ id: 'contracts', kind: 'contracts', pos: new THREE.Vector3(-4.2, 0, 11.6), radius: 2.6, active: true });
    // Surveyor (site renewal)
    const tripod = new THREE.Group();
    tripod.position.set(14.5, 0, 14.5);
    for (let i = 0; i < 3; i++) add(tripod, cachedCyl(0.04, 0.04, 1.4, 5), lam('#7a5236'), Math.cos(i * 2.1) * 0.25, 0.65, Math.sin(i * 2.1) * 0.25, Math.sin(i * 2.1) * 0.3, 0, -Math.cos(i * 2.1) * 0.3);
    add(tripod, rb(0.3, 0.22, 0.4, 0.05), lam('#ffbd38'), 0, 1.4, 0);
    st.add(tripod);
    this.npc('Juno', 'Surveyor · Renew sites', 13, 13.2, { jacket: '#78ae48', pants: '#5a3a24', skin: '#a8754a', helmet: '#16cdbb', scarf: '#9462f5', backpack: true }, -0.8);
    this.interactables.push({ id: 'surveyor', kind: 'surveyor', pos: new THREE.Vector3(12.2, 0, 11.8), radius: 2.6, active: true });
    // Outfitter (cosmetics)
    const wardrobe = new THREE.Group();
    wardrobe.position.set(16, 0, 6);
    add(wardrobe, rb(1.6, 2.2, 0.8, 0.1), lam('#8a5a32'), 0, 1.1, 0);
    add(wardrobe, rb(0.7, 1.8, 0.05, 0.04), lam('#16cdbb'), -0.37, 1.1, 0.42);
    add(wardrobe, rb(0.7, 1.8, 0.05, 0.04), lam('#ffbd38'), 0.37, 1.1, 0.42);
    wardrobe.rotation.y = -Math.PI / 2;
    st.add(wardrobe);
    this.boxes.push({ minX: 15.5, minZ: 5, maxX: 16.6, maxZ: 7, h: 2.2, enabled: true });
    this.interactables.push({ id: 'cosmetics', kind: 'cosmetics', pos: new THREE.Vector3(14.6, 0, 6), radius: 2.2, active: true });
    const wl = makeLabel('Outfitter', { sub: 'Gem cosmetics', size: 0.42 });
    wl.position.set(16, 2.8, 6);
    this.biomeGroups.meadow.add(wl);
    // Decorative tents, lanterns, flags, fences
    for (const [x, z, r, c] of [[-20, 6, 0.4, '#e8d4a8'], [20, 18, -0.6, '#cfe0c0'], [-21, -1, 0.9, '#f0c890']] as [number, number, number, string][]) {
      const t = buildTent(c);
      t.position.set(x, 0, z);
      t.rotation.y = r;
      st.add(t);
      this.circles.push({ x, z, r: 1.8, h: 2 });
    }
    for (const [x, z] of [[-4, 3], [4, 3], [-4, 16], [4, 16], [-12, 9], [12, 9], [3, -5], [-3, -5]] as [number, number][]) {
      const l = buildLanternPost();
      l.position.set(x, 0, z);
      st.add(l);
    }
    for (const [x, z, c] of [[-2, 25, '#16cdbb'], [2, 25, '#ffbd38'], [18, 0, '#9462f5'], [-18, 12, '#ff7a2e']] as [number, number, string][]) {
      const f = buildFlag(c);
      f.position.set(x, 0, z);
      this.biomeGroups.meadow.add(f);
      this.flags.push(f.getObjectByName('flagCloth')!);
    }
    // Camp sign
    const sign = buildSign('DIGBOUND', 'Explorer Camp');
    sign.position.set(-7, 0, 1.5);
    sign.rotation.y = 0.5;
    st.add(sign);
    // Starter egg (tutorial grant)
    const se = buildEgg('starter');
    se.root.position.copy(STARTER_EGG_POS);
    se.root.position.y = 0.2;
    se.root.scale.setScalar(0.8);
    this.biomeGroups.meadow.add(se.root);
    this.starterEgg = se;
    this.starterLabel = makeLabel('Starter Egg', { sub: 'FREE · Press E', size: 0.5 });
    this.starterLabel.position.set(STARTER_EGG_POS.x, 2.2, STARTER_EGG_POS.z);
    this.biomeGroups.meadow.add(this.starterLabel);
    this.interactables.push({ id: 'starterEgg', kind: 'starterEgg', pos: STARTER_EGG_POS.clone(), radius: 2.2, active: false });
    // Final chamber monument
    const fg = new THREE.Group();
    fg.position.copy(FINAL_POS);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(fg, rb(0.9, 3.4, 0.9, 0.12), lam('#d8cdb8', undefined, true), Math.cos(a) * 3, 1.7, Math.sin(a) * 3);
      add(fg, octa(0.3), lam(['#78ae48', '#9462f5', '#ff7a2e', '#16cdbb', '#ffbd38', '#fff4dc'][i], undefined, true), Math.cos(a) * 3, 3.7, Math.sin(a) * 3);
      this.circles.push({ x: FINAL_POS.x + Math.cos(a) * 3, z: FINAL_POS.z + Math.sin(a) * 3, r: 0.6, h: 3 });
    }
    st.add(fg);
    this.finalCrystal = buildCrystalCluster('#6ff5e6', 6, 1.8);
    this.finalCrystal.position.copy(FINAL_POS);
    this.biomeGroups.meadow.add(this.finalCrystal);
    const barrier = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3, 20, 1, true), basic('#9462f5', 0.25, true));
    barrier.position.set(FINAL_POS.x, 1.5, FINAL_POS.z);
    this.finalBarrier = barrier;
    this.biomeGroups.meadow.add(barrier);
    const fl = makeLabel('Star Monument', { sub: 'Complete all 4 museum displays', size: 0.45 });
    fl.position.set(FINAL_POS.x, 4.8, FINAL_POS.z);
    this.biomeGroups.meadow.add(fl);
    this.interactables.push({ id: 'final', kind: 'final', pos: FINAL_POS.clone().add(new THREE.Vector3(0, 0, -3.6)), radius: 2.4, active: true });
  }

  private buildGates() {
    for (const b of ['crystal', 'ember', 'aurora'] as const) {
      const g = GATES[b];
      const grp = new THREE.Group();
      grp.position.set(g.x, 0, g.z);
      if (g.axis === 'z') grp.rotation.y = Math.PI / 2;
      const stoneC = BIOMES[b].ground2;
      add(grp, rb(1.6, 6, 1.6, 0.2), lam(shade(stoneC, -0.05), undefined, true), -4.6, 3, 0);
      add(grp, rb(1.6, 6, 1.6, 0.2), lam(shade(stoneC, -0.05), undefined, true), 4.6, 3, 0);
      add(grp, rb(11, 1.4, 1.8, 0.25), lam(stoneC, undefined, true), 0, 6.4, 0);
      add(grp, octa(0.6), lam(BIOMES[b].layers.node === 'c_amethyst' ? '#9462f5' : b === 'ember' ? '#ff7a2e' : '#16cdbb', undefined, true), 0, 7.6, 0).scale.set(1, 1.4, 1);
      const barrier = new THREE.Mesh(new THREE.PlaneGeometry(8, 5.6), new THREE.MeshBasicMaterial({ color: '#16cdbb', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      barrier.position.set(0, 2.8, 0);
      grp.add(barrier);
      this.gateBarriers.set(b, barrier);
      this.scene.add(grp);
      const lbl = makeLabel(BIOMES[b].name, { sub: 'Locked', size: 0.6 });
      const meadowSide = g.axis === 'x' ? new THREE.Vector3(g.x, 0, g.z + Math.sign(-g.z) * 2.2) : new THREE.Vector3(g.x - 2.2, 0, g.z);
      lbl.position.set(meadowSide.x, 4.6, meadowSide.z);
      this.scene.add(lbl);
      this.gateLabels.set(b, lbl);
      const box: BoxCollider = g.axis === 'x'
        ? { minX: g.x - 4, minZ: g.z - 0.6, maxX: g.x + 4, maxZ: g.z + 0.6, h: 50, id: `gate_${b}`, enabled: true }
        : { minX: g.x - 0.6, minZ: g.z - 4, maxX: g.x + 0.6, maxZ: g.z + 4, h: 50, id: `gate_${b}`, enabled: true };
      this.boxes.push(box);
      this.interactables.push({ id: `gate_${b}`, kind: 'gate', pos: meadowSide, radius: 3.4, data: b, active: true });
    }
  }

  private buildChambers() {
    for (const b of BIOME_ORDER) {
      const [x, z] = CHAMBERS[b];
      const st = this.staticGroup(b);
      const c = b === 'meadow' ? '#a8a296' : b === 'crystal' ? '#5a6a9a' : b === 'ember' ? '#3a3438' : '#3d4f80';
      // 6×6 enclosure, door facing biome center
      const [bx, bz] = BIOMES[b].center;
      const dirX = Math.sign(bx - x), dirZ = Math.sign(bz - z);
      const doorOnX = Math.abs(bx - x) > Math.abs(bz - z);
      const walls: [number, number, number, number][] = [];
      const hw = 3;
      // four walls; the door wall has a 2 m gap
      const sides: { nx: number; nz: number }[] = [{ nx: 1, nz: 0 }, { nx: -1, nz: 0 }, { nx: 0, nz: 1 }, { nx: 0, nz: -1 }];
      for (const s of sides) {
        const isDoor = doorOnX ? s.nx === dirX : s.nz === dirZ;
        if (s.nx !== 0) {
          const wx = x + s.nx * hw;
          if (isDoor) { walls.push([wx, z - hw, wx, z - 1], [wx, z + 1, wx, z + hw]); }
          else walls.push([wx, z - hw, wx, z + hw]);
        } else {
          const wz = z + s.nz * hw;
          if (isDoor) { walls.push([x - hw, wz, x - 1, wz], [x + 1, wz, x + hw, wz]); }
          else walls.push([x - hw, wz, x + hw, wz]);
        }
      }
      for (const [x0, z0, x1, z1] of walls) {
        const len = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
        add(st, rb(Math.abs(x1 - x0) + 0.6, 3, Math.abs(z1 - z0) + 0.6, 0.15), lam(c, undefined, true), (x0 + x1) / 2, 1.5, (z0 + z1) / 2);
        void len;
        this.boxes.push({ minX: Math.min(x0, x1) - 0.3, minZ: Math.min(z0, z1) - 0.3, maxX: Math.max(x0, x1) + 0.3, maxZ: Math.max(z0, z1) + 0.3, h: 3, enabled: true });
      }
      add(st, rb(6.8, 0.4, 6.8, 0.15), lam(shade(c, 0.05), undefined, true), x, 3.1, z);
      const door = new THREE.Mesh(rb(doorOnX ? 0.4 : 2, 2.8, doorOnX ? 2 : 0.4, 0.08), lam('#6a4630'));
      const dx = doorOnX ? x + dirX * hw : x, dz = doorOnX ? z : z + dirZ * hw;
      door.position.set(dx, 1.4, dz);
      this.biomeGroups[b].add(door);
      this.chamberDoors.set(b, door);
      this.boxes.push({ minX: dx - (doorOnX ? 0.3 : 1.1), minZ: dz - (doorOnX ? 1.1 : 0.3), maxX: dx + (doorOnX ? 0.3 : 1.1), maxZ: dz + (doorOnX ? 1.1 : 0.3), h: 3, id: `door_${b}`, enabled: true });
      const ped = buildPedestal('#ffbd38');
      ped.position.set(x, 0, z);
      st.add(ped);
      const chest = buildChest('relic');
      chest.position.set(x, 0.95, z);
      chest.name = 'chamberChest';
      this.biomeGroups[b].add(chest);
      const outside = new THREE.Vector3(dx + (doorOnX ? dirX * 1.5 : 0), 0, dz + (doorOnX ? 0 : dirZ * 1.5));
      const lbl = makeLabel('Secret Chamber', { sub: `Complete the ${BIOMES[b].name} relic display`, size: 0.42 });
      lbl.position.set(outside.x, 3.8, outside.z);
      lbl.name = `chamberLabel_${b}`;
      this.biomeGroups[b].add(lbl);
      this.interactables.push({ id: `chamber_${b}`, kind: 'chamber', pos: new THREE.Vector3(x, 0, z), radius: 2.2, data: b, active: true });
      this.interactables.push({ id: `chamberDoor_${b}`, kind: 'chamber', pos: outside, radius: 2.4, data: b, active: true });
      this.circles.push({ x, z, r: 0.85, h: 1.2 });
    }
  }

  private buildSiteMarkers(site: VoxelSite) {
    const st = new THREE.Group();
    const { ox, oz } = site;
    const W = SITE.w;
    for (let i = 0; i <= W; i += 2) {
      for (const [x, z] of [[ox + i, oz - 0.4], [ox + i, oz + W + 0.4], [ox - 0.4, oz + i], [ox + W + 0.4, oz + i]] as [number, number][]) {
        const p = buildFencePost();
        p.position.set(x, 0.5, z);
        st.add(p);
      }
    }
    const rope = lam('#e2cf9e');
    add(st, rb(W + 0.8, 0.1, 0.1, 0.04), rope, ox + W / 2, 0.8, oz - 0.4, 0, 0, 0, false);
    add(st, rb(W + 0.8, 0.1, 0.1, 0.04), rope, ox + W / 2, 0.8, oz + W + 0.4, 0, 0, 0, false);
    add(st, rb(0.1, 0.1, W + 0.8, 0.04), rope, ox - 0.4, 0.8, oz + W / 2, 0, 0, 0, false);
    add(st, rb(0.1, 0.1, W + 0.8, 0.04), rope, ox + W + 0.4, 0.8, oz + W / 2, 0, 0, 0, false);
    const roman = ['I', 'II', 'III'][site.index];
    const sign = buildSign(`Dig Site ${roman}`, BIOMES[site.biome].name);
    // put the sign on the side facing the biome center
    const [cx, cz] = BIOMES[site.biome].center;
    const sx = ox + W / 2, sz = oz + W / 2;
    const dx = cx - sx, dz = cz - sz;
    if (Math.abs(dx) > Math.abs(dz)) sign.position.set(dx > 0 ? ox + W + 1.6 : ox - 1.6, 0, sz);
    else sign.position.set(sx + 3, 0, dz > 0 ? oz + W + 1.6 : oz - 1.6);
    sign.lookAt(sx, 0, sz);
    sign.rotateY(Math.PI);
    this.circles.push({ x: sign.position.x, z: sign.position.z, r: 0.3, h: 2 });
    st.add(sign);
    this.staticGroup(site.biome).add(st);
  }

  // ───────── State-driven visuals ─────────
  refresh(save: SaveData) {
    for (const b of ['crystal', 'ember', 'aurora'] as const) {
      const open = save.unlocked.includes(b);
      const barrier = this.gateBarriers.get(b)!;
      barrier.visible = !open;
      const box = this.boxes.find((x) => x.id === `gate_${b}`)!;
      box.enabled = !open;
      const lbl = this.gateLabels.get(b)!;
      const it = this.interactables.find((i) => i.id === `gate_${b}`)!;
      it.active = !open;
      lbl.visible = !open;
    }
    for (const b of BIOME_ORDER) {
      const open = save.displaysClaimed.includes(b);
      const door = this.chamberDoors.get(b)!;
      door.visible = !open;
      const dbox = this.boxes.find((x) => x.id === `door_${b}`)!;
      dbox.enabled = !open;
      const chest = this.biomeGroups[b].getObjectByName('chamberChest');
      if (chest) chest.visible = !save.chambersClaimed.includes(b);
      const lbl = this.biomeGroups[b].getObjectByName(`chamberLabel_${b}`);
      if (lbl) lbl.visible = !open;
      const inner = this.interactables.find((i) => i.id === `chamber_${b}`)!;
      inner.active = open && !save.chambersClaimed.includes(b);
      const outer = this.interactables.find((i) => i.id === `chamberDoor_${b}`)!;
      outer.active = !open;
    }
    for (const c of COLLECTIBLES) {
      const shard = this.museumShards.get(c.id);
      if (shard) shard.material = (save.collection[c.id] ?? 0) > 0 ? lam(c.color, shade(c.color, -0.35), true) : lam('#2a2a33');
    }
    for (const e of this.shrineEggs) {
      const def = EGGS.find((x) => x.id === e.id)!;
      const open = save.unlocked.includes(def.biome);
      e.lock.visible = !open;
      (e.rig.root.userData.nameLabel as THREE.Sprite).visible = open;
    }
    const starterVisible = !save.starterHatched && save.stats.cells >= 5;
    if (this.starterEgg) this.starterEgg.root.visible = !save.starterHatched;
    if (this.starterLabel) this.starterLabel.visible = starterVisible;
    const sit = this.interactables.find((i) => i.id === 'starterEgg')!;
    sit.active = starterVisible;
    this.finalBarrier.visible = save.displaysClaimed.length < 4;
    this.finalCrystal.visible = !save.finalClaimed;
  }

  setQuality(q: QualityLevel) {
    this.quality = q;
    const cfg = QUALITY[q];
    this.sun.castShadow = cfg.shadows;
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); (this.sun.shadow as any).map = null; }
  }

  // ───────── Queries ─────────
  siteAtCell(ix: number, iz: number): VoxelSite | null {
    for (const s of this.sites) if (ix >= s.ox && ix < s.ox + SITE.w && iz >= s.oz && iz < s.oz + SITE.d) return s;
    return null;
  }

  /** Unified solid grid: everything below y=0 is ground unless inside a site. */
  solidAt(ix: number, iy: number, iz: number): boolean {
    if (iy >= 0) return false;
    const s = this.siteAtCell(ix, iz);
    if (!s) return true;
    return s.isSolidLocal(ix - s.ox, iy - s.oy, iz - s.oz);
  }

  /** Highest walkable surface at (x,z) at or below `fromY`. */
  groundY(x: number, z: number, fromY: number): number {
    const ix = Math.floor(x), iz = Math.floor(z);
    let iy = Math.min(Math.floor(fromY), -1);
    if (fromY >= 0) return 0;
    for (let k = 0; k < 12; k++, iy--) if (this.solidAt(ix, iy, iz)) return iy + 1;
    return -SITE.h;
  }

  biomeAt(x: number, z: number): BiomeId {
    if (z < -41) return 'crystal';
    if (x > 41) return 'ember';
    if (z > 41) return 'aurora';
    return 'meadow';
  }

  /** Amanatides–Woo voxel traversal. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null {
    let ix = Math.floor(origin.x), iy = Math.floor(origin.y), iz = Math.floor(origin.z);
    const sx = dir.x > 0 ? 1 : -1, sy = dir.y > 0 ? 1 : -1, sz = dir.z > 0 ? 1 : -1;
    const tdx = Math.abs(1 / (dir.x || 1e-9)), tdy = Math.abs(1 / (dir.y || 1e-9)), tdz = Math.abs(1 / (dir.z || 1e-9));
    let tmx = (sx > 0 ? ix + 1 - origin.x : origin.x - ix) * tdx;
    let tmy = (sy > 0 ? iy + 1 - origin.y : origin.y - iy) * tdy;
    let tmz = (sz > 0 ? iz + 1 - origin.z : origin.z - iz) * tdz;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 256 && t <= maxDist; i++) {
      if (this.solidAt(ix, iy, iz)) {
        const site = this.siteAtCell(ix, iz);
        const ly = iy - (site?.oy ?? 0);
        const inSite = !!site && ly >= 0 && ly < SITE.h;
        return {
          ix, iy, iz, nx, ny, nz, dist: t,
          site: inSite ? site : null,
          cell: inSite ? (ix - site!.ox) + (iz - site!.oz) * SITE.w + ly * SITE.w * SITE.d : -1,
          point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
        };
      }
      if (tmx < tmy && tmx < tmz) { ix += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { iy += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { iz += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  /** Is the segment from a→b blocked by static props (2D colliders with height)? */
  propBlocks(a: THREE.Vector3, b: THREE.Vector3): number {
    let best = 1;
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
    for (const c of this.circles) {
      // ray-circle in XZ
      const fx = a.x - c.x, fz = a.z - c.z;
      const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - c.r * c.r;
      const disc = B * B - 4 * A * C;
      if (A < 1e-6 || disc < 0) continue;
      const t = (-B - Math.sqrt(disc)) / (2 * A);
      if (t > 0 && t < best && a.y + dy * t < c.h) best = t;
    }
    for (const bx of this.boxes) {
      if (!bx.enabled || bx.h > 20) continue;
      let t0 = 0, t1 = 1;
      const clip = (p: number, d: number, mn: number, mx: number) => {
        if (Math.abs(d) < 1e-9) return p >= mn && p <= mx;
        let ta = (mn - p) / d, tb = (mx - p) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        return t0 <= t1;
      };
      if (clip(a.x, dx, bx.minX, bx.maxX) && clip(a.z, dz, bx.minZ, bx.maxZ) && t0 > 0 && t0 < best && a.y + dy * t0 < bx.h) best = t0;
    }
    return best;
  }

  // ───────── Per-frame ─────────
  update(dt: number, time: number, player: THREE.Vector3) {
    this.grassUniform.value = time;
    for (const m of this.waterMats) m.uniforms.uTime.value = time;
    for (const f of this.flags) f.rotation.y = Math.sin(time * 2 + f.id) * 0.25;
    for (let i = 0; i < this.fireFlames.length; i++) {
      const f = this.fireFlames[i];
      f.scale.set(1 + Math.sin(time * 9 + i) * 0.12, 1 + Math.sin(time * 11 + i * 2) * 0.2, 1);
      f.rotation.y += dt * (1 + i);
    }
    this.fireLight.intensity = 16 + Math.sin(time * 13) * 2 + Math.sin(time * 7.3) * 2;
    for (const c of this.clouds) { c.position.x += dt * 1.2; if (c.position.x > 180) c.position.x = -180; }
    for (const s of this.sites) s.animateTreasures(time);
    for (const e of this.shrineEggs) {
      e.rig.egg.rotation.y = time * 0.5;
      e.rig.egg.position.y = 0.06 + Math.sin(time * 1.6 + e.pos.x) * 0.06;
      for (const sp of e.rig.spinners) sp.rotation.y += dt * 0.6;
    }
    if (this.starterEgg?.root.visible) {
      this.starterEgg.egg.rotation.z = Math.sin(time * 3) * 0.06;
      for (const sp of this.starterEgg.spinners) sp.rotation.y += dt * 1.5;
    }
    this.finalCrystal.rotation.y = time * 0.4;
    for (const f of this.floaters) {
      f.position.y = f.userData.baseY + Math.sin(time * 0.8 + f.userData.phase) * 0.5;
      f.rotation.y += dt * 0.2;
    }
    for (const r of this.auroraRibbons) {
      const pos = r.geometry.attributes.position as THREE.BufferAttribute;
      const base = r.userData.base as Float32Array;
      if (!this.biomeGroups.aurora.visible) continue;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        pos.setY(i, base[i * 3 + 1] + Math.sin(x * 0.08 + time * 0.6) * 2.5);
        pos.setZ(i, Math.sin(x * 0.05 + time * 0.4) * 4);
      }
      pos.needsUpdate = true;
    }
    for (const n of this.npcs) {
      const dx = player.x - n.home.x, dz = player.z - n.home.z;
      const d = Math.hypot(dx, dz);
      n.rig.body.position.y = Math.sin(time * 2 + n.phase) * 0.02;
      n.rig.armL.rotation.x = Math.sin(time * 1.3 + n.phase) * 0.06;
      n.rig.armR.rotation.x = d < 4 ? -0.6 + Math.sin(time * 6) * 0.4 : Math.sin(time * 1.3 + n.phase + 1) * 0.06;
      if (d < 7) {
        const target = Math.atan2(dx, dz);
        n.rig.root.rotation.y += angleDiff(n.rig.root.rotation.y, target) * Math.min(1, dt * 4);
      }
    }
    // label LOD: distant name tags are skipped (layer 1 is never rendered)
    for (const l of this.labels) {
      l.getWorldPosition(this.labelPos);
      l.layers.set(this.labelPos.distanceToSquared(player) < 34 * 34 ? 0 : 1);
    }
    // biome visibility & environment blend
    const cur = this.biomeAt(player.x, player.z);
    for (const b of BIOME_ORDER) {
      const [cx, cz] = BIOMES[b].center;
      const d = Math.max(Math.abs(player.x - cx), Math.abs(player.z - cz)) - BIOMES[b].half;
      this.biomeGroups[b].visible = b === cur || d < 30;
    }
    const def = BIOMES[cur];
    const k = Math.min(1, dt * 1.5);
    this.fog.color.lerp(this.fogTarget.set(def.fog), k);
    this.skyBottom.lerp(this.fogTarget.set(def.fog), k);
    this.skyTop.lerp(this.fogTarget.set(def.sky), k);
    (this.scene.userData.sky as THREE.Mesh).position.copy(player);
    const hemiSky = cur === 'aurora' ? '#7f9fff' : cur === 'ember' ? '#ffd0b0' : cur === 'crystal' ? '#c8c8ff' : '#eaf6ff';
    this.hemi.color.lerp(this.fogTarget.set(hemiSky), k);
    this.hemi.intensity += ((cur === 'aurora' ? 1.15 : cur === 'meadow' ? 1.45 : 1.5) - this.hemi.intensity) * k;
    this.sun.intensity += ((cur === 'aurora' ? 1.3 : cur === 'ember' ? 2.0 : cur === 'meadow' ? 2.7 : 2.4) - this.sun.intensity) * k;
    // shadow camera follows the player
    this.sun.position.set(player.x + 18, player.y + 30, player.z + 12);
    this.sun.target.position.copy(player);
    for (const s of this.sites) if (s.dirty) s.rebuild();
  }
}

export function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function cachedCyl(rt: number, rbt: number, h: number, s = 10) {
  return new THREE.CylinderGeometry(rt, rbt, h, s);
}
function buildRockGeo() {
  return new THREE.DodecahedronGeometry(0.6, 0);
}
function octa(r: number) {
  return new THREE.OctahedronGeometry(r, 0);
}

/**
 * Bake a static group into one merged mesh per material (world transforms
 * applied). Sprites/lights are kept as-is.
 */
export function mergeStatic(group: THREE.Group, chunk = 32): THREE.Group {
  group.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; shadow: boolean; geos: THREE.BufferGeometry[] }>();
  const keep: THREE.Object3D[] = [];
  const wp = new THREE.Vector3();
  const matIds = new Map<THREE.Material, number>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material)) {
      const shared = sharedVertexMaterial(m.material);
      const mat = shared ?? m.material;
      const g = prepGeo(m.geometry, m.matrixWorld, shared ? (m.material as THREE.MeshLambertMaterial).color : null);
      m.getWorldPosition(wp);
      if (!matIds.has(mat)) matIds.set(mat, matIds.size);
      const shadow = m.castShadow && !m.userData.noShadow;
      // spatial chunks keep frustum culling (main + shadow pass) effective
      const key = `${matIds.get(mat)}|${shadow ? 1 : 0}|${Math.floor(wp.x / chunk)}|${Math.floor(wp.z / chunk)}`;
      const b = buckets.get(key) ?? { mat, shadow, geos: [] };
      b.geos.push(g);
      buckets.set(key, b);
    } else if ((o as THREE.Sprite).isSprite) {
      keep.push(o);
    }
  });
  const out = new THREE.Group();
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  for (const s of keep) {
    const p = new THREE.Vector3();
    s.getWorldPosition(p);
    s.removeFromParent();
    s.position.copy(p);
    out.add(s);
  }
  return out;
}

let groundTex: THREE.Texture | null = null;
/** Tileable painted-grass detail map (multiplies the per-tile vertex colors). */
export function groundTexture(): THREE.Texture {
  if (groundTex) return groundTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(232,232,232)';
  g.fillRect(0, 0, 256, 256);
  const rnd = mulberry32(99);
  const blot = (x: number, y: number, r: number, col: string) => {
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, col);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  };
  for (let i = 0; i < 26; i++) blot(rnd() * 256, rnd() * 256, 20 + rnd() * 50, rnd() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(150,150,150,0.28)');
  // tiny blade strokes
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * 256, y = rnd() * 256, l = 2 + rnd() * 4;
    const v = rnd() < 0.55 ? 255 : 175;
    g.strokeStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.35})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 2, y - l);
    g.stroke();
  }
  groundTex = new THREE.CanvasTexture(c);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = 4;
  return groundTex;
}
