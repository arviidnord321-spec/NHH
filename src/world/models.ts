/**
 * Procedural chunky 3D models in an approachable blocky style.
 * Everything is built from shared, cached geometries and materials so many
 * instances stay cheap. Swap any builder for a loaded GLTF later without
 * touching gameplay — systems only depend on the returned rig objects.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EGG_BY_ID, PET_ENTRY_BY_ID, PetPalette, STARTER_EGG, TOOLS } from '../data/balance';

// ───────── caches ─────────
const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

export function rb(w: number, h: number, d: number, r = 0.07, seg = 2): THREE.BufferGeometry {
  const k = `rb${w},${h},${d},${r},${seg}`;
  let g = geoCache.get(k);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
    geoCache.set(k, g);
  }
  return g;
}
export function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

export interface MatOpts { emissive?: string; emissiveIntensity?: number; flat?: boolean; rough?: number; metal?: number; transparent?: boolean; opacity?: number }
/** Standard material for characters/pets/eggs (soft plastic look). */
export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const k = `s${color}|${o.emissive ?? ''}|${o.emissiveIntensity ?? 1}|${o.flat ? 1 : 0}|${o.rough ?? 0.62}|${o.metal ?? 0}|${o.opacity ?? 1}`;
  let m = matCache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? 0.62, metalness: o.metal ?? 0, flatShading: !!o.flat,
      emissive: o.emissive ? new THREE.Color(o.emissive) : new THREE.Color(0),
      emissiveIntensity: o.emissiveIntensity ?? 1,
      transparent: !!o.transparent || (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1,
    });
    matCache.set(k, m);
  }
  return m;
}
/** Cheaper Lambert material for static scenery. */
export function lam(color: string, emissive?: string, flat = false): THREE.MeshLambertMaterial {
  const k = `l${color}|${emissive ?? ''}|${flat}`;
  let m = matCache.get(k) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive: emissive ? new THREE.Color(emissive) : new THREE.Color(0), flatShading: flat });
    matCache.set(k, m);
  }
  return m;
}
export function basic(color: string, opacity = 1, additive = false): THREE.MeshBasicMaterial {
  const k = `b${color}|${opacity}|${additive}`;
  let m = matCache.get(k) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1 || additive, opacity, depthWrite: !(opacity < 1 || additive), blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    matCache.set(k, m);
  }
  return m;
}

export function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, shadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = shadow;
  parent.add(mesh);
  return mesh;
}

const sphere = (r: number, ws = 10, hs = 8) => cachedGeo(`sph${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const halfSphere = (r: number, ws = 12) => cachedGeo(`hs${r},${ws}`, () => new THREE.SphereGeometry(r, ws, 6, 0, Math.PI * 2, 0, Math.PI / 2));
const cone = (r: number, h: number, s = 4) => cachedGeo(`cone${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
const cyl = (rt: number, rbt: number, h: number, s = 8) => cachedGeo(`cyl${rt},${rbt},${h},${s}`, () => new THREE.CylinderGeometry(rt, rbt, h, s));
const octa = (r: number) => cachedGeo(`oct${r}`, () => new THREE.OctahedronGeometry(r, 0));
const torus = (r: number, t: number, rs = 6, ts = 20, arc = Math.PI * 2) => cachedGeo(`tor${r},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
const dodeca = (r: number) => cachedGeo(`dod${r}`, () => new THREE.DodecahedronGeometry(r, 0));

const BLACK = '#1b1a22';
const WHITE = '#ffffff';

/** Big glossy cartoon eyes on a face plane facing +z. */
function eyes(parent: THREE.Object3D, y: number, z: number, spacing: number, size: number): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * spacing, y, z);
    add(g, rb(size, size * 1.25, size * 0.5, size * 0.22), mat(BLACK, { rough: 0.25 }), 0, 0, 0, 0, 0, 0, false);
    add(g, rb(size * 0.38, size * 0.38, size * 0.2, size * 0.1), mat(WHITE, { emissive: '#ffffff', emissiveIntensity: 0.4 }), -size * 0.18, size * 0.25, size * 0.2, 0, 0, 0, false);
    parent.add(g);
    out.push(g);
  }
  return out;
}

// ───────── Player / NPC ─────────
export interface HumanRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  toolHolder: THREE.Group;
  helmet: THREE.Mesh;
  scarf: THREE.Mesh[];
  crown: THREE.Group;
  lamp: THREE.Mesh;
}

export interface HumanLook { jacket: string; pants: string; skin: string; helmet: string | null; scarf: string; backpack: boolean; hat?: 'none' | 'cap' | 'wide'; hair?: string }

export function buildHuman(look: HumanLook): HumanRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // Legs (pivot at hip)
  const mkLimb = (x: number, y: number, w: number, h: number, d: number, color: string, shoe?: string) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    add(g, rb(w, h, d, 0.07), mat(color), 0, -h / 2, 0);
    if (shoe) add(g, rb(w + 0.04, 0.16, d + 0.08, 0.05), mat(shoe), 0, -h + 0.06, 0.03);
    body.add(g);
    return g;
  };
  const legL = mkLimb(-0.2, 0.82, 0.34, 0.82, 0.36, look.pants, '#3b2b22');
  const legR = mkLimb(0.2, 0.82, 0.34, 0.82, 0.36, look.pants, '#3b2b22');
  // Torso
  const torso = add(body, rb(0.86, 0.78, 0.46, 0.09), mat(look.jacket), 0, 1.2, 0);
  void torso;
  add(body, rb(0.06, 0.6, 0.02, 0.01), mat('#ffffff', { rough: 0.4 }), 0, 1.18, 0.235); // zipper
  add(body, rb(0.22, 0.14, 0.04, 0.03), mat(shade(look.jacket, -0.18)), -0.22, 1.02, 0.235); // pockets
  add(body, rb(0.22, 0.14, 0.04, 0.03), mat(shade(look.jacket, -0.18)), 0.22, 1.02, 0.235);
  add(body, rb(0.9, 0.12, 0.5, 0.04), mat('#5a3a24'), 0, 0.86, 0); // belt
  add(body, rb(0.14, 0.1, 0.04, 0.02), mat('#ffbd38', { metal: 0.5, rough: 0.3 }), 0, 0.86, 0.26);
  // Scarf
  const scarf: THREE.Mesh[] = [];
  scarf.push(add(body, rb(0.7, 0.16, 0.54, 0.07), mat(look.scarf), 0, 1.6, 0));
  scarf.push(add(body, rb(0.16, 0.42, 0.08, 0.04), mat(look.scarf), 0.2, 1.38, 0.27, 0.15, 0, 0.12));
  // Backpack
  if (look.backpack) {
    add(body, rb(0.66, 0.66, 0.3, 0.08), mat('#8a5a32'), 0, 1.22, -0.36);
    add(body, rb(0.68, 0.22, 0.32, 0.06), mat('#6e4526'), 0, 1.5, -0.36);
    add(body, cyl(0.12, 0.12, 0.7, 8), mat('#d8c9a3'), 0, 1.66, -0.38, 0, 0, Math.PI / 2);
    add(body, rb(0.3, 0.22, 0.06, 0.04), mat('#a8743f'), 0, 1.08, -0.53);
  }
  // Arms (pivot at shoulder)
  const mkArm = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 1.52, 0);
    add(g, rb(0.3, 0.7, 0.32, 0.07), mat(look.jacket), 0, -0.33, 0);
    add(g, rb(0.26, 0.18, 0.28, 0.07), mat(look.skin), 0, -0.74, 0);
    body.add(g);
    return g;
  };
  const armL = mkArm(-0.6);
  const armR = mkArm(0.6);
  const toolHolder = new THREE.Group();
  toolHolder.position.set(0, -0.76, 0.02);
  armR.add(toolHolder);
  // Head
  const head = new THREE.Group();
  head.position.set(0, 1.62, 0);
  body.add(head);
  add(head, rb(0.56, 0.52, 0.52, 0.12), mat(look.skin), 0, 0.3, 0);
  // face
  for (const s of [-1, 1]) {
    add(head, rb(0.08, 0.13, 0.04, 0.03), mat(BLACK, { rough: 0.25 }), s * 0.12, 0.34, 0.26, 0, 0, 0, false);
    add(head, rb(0.03, 0.03, 0.02, 0.01), mat(WHITE), s * 0.12 - 0.015, 0.38, 0.28, 0, 0, 0, false);
  }
  add(head, rb(0.16, 0.04, 0.03, 0.015), mat('#7a3b2a'), 0, 0.2, 0.26, 0, 0, 0, false);
  add(head, rb(0.08, 0.04, 0.02, 0.01), mat('#ff9a8a', { opacity: 0.7 }), -0.2, 0.25, 0.26, 0, 0, 0, false);
  add(head, rb(0.08, 0.04, 0.02, 0.01), mat('#ff9a8a', { opacity: 0.7 }), 0.2, 0.25, 0.26, 0, 0, 0, false);
  if (look.hair) add(head, rb(0.6, 0.14, 0.56, 0.06), mat(look.hair), 0, 0.55, -0.02);
  // Helmet
  let helmet: THREE.Mesh;
  const lampMat = mat('#fff7c2', { emissive: '#ffd27a', emissiveIntensity: 1.4 });
  let lamp: THREE.Mesh;
  if (look.helmet) {
    helmet = add(head, halfSphere(0.36, 14), mat(look.helmet, { rough: 0.35 }), 0, 0.5, 0);
    helmet.scale.set(1, 0.72, 1);
    add(head, cyl(0.42, 0.42, 0.05, 16), mat(look.helmet, { rough: 0.35 }), 0, 0.5, 0.02);
    add(head, cyl(0.09, 0.09, 0.08, 10), mat('#3b3a40'), 0, 0.64, 0.3, Math.PI / 2, 0, 0);
    lamp = add(head, cyl(0.07, 0.07, 0.04, 10), lampMat, 0, 0.64, 0.35, Math.PI / 2, 0, 0, false);
  } else {
    helmet = add(head, rb(0.62, 0.12, 0.6, 0.05), mat(look.hair ?? '#5a3a24'), 0, 0.58, 0);
    if (look.hat === 'wide') {
      add(head, cyl(0.55, 0.55, 0.05, 16), mat('#8a6a42'), 0, 0.6, 0);
      add(head, cyl(0.3, 0.33, 0.28, 12), mat('#8a6a42'), 0, 0.74, 0);
      add(head, cyl(0.335, 0.335, 0.06, 12), mat('#c44a3a'), 0, 0.66, 0);
    } else if (look.hat === 'cap') {
      add(head, halfSphere(0.33, 12), mat('#2f6fd0'), 0, 0.55, 0).scale.set(1, 0.6, 1);
      add(head, rb(0.4, 0.04, 0.26, 0.02), mat('#2f6fd0'), 0, 0.56, 0.3);
    }
    lamp = add(head, rb(0.01, 0.01, 0.01, 0.002), lampMat, 0, 0.5, 0, 0, 0, 0, false);
    lamp.visible = false;
  }
  const crown = new THREE.Group();
  crown.position.set(0, 0.78, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(crown, octa(0.07), mat('#6ff5e6', { emissive: '#16cdbb', emissiveIntensity: 0.8, flat: true }), Math.cos(a) * 0.22, 0.04, Math.sin(a) * 0.22).scale.set(0.8, 1.8, 0.8);
  }
  add(crown, torus(0.24, 0.035, 6, 20), mat('#ffbd38', { metal: 0.6, rough: 0.3 }), 0, -0.04, 0, Math.PI / 2, 0, 0);
  crown.visible = false;
  head.add(crown);
  return { root, body, head, armL, armR, legL, legR, toolHolder, helmet, scarf, crown, lamp };
}

export function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return '#' + c.getHexString();
}

/** Shovel model: tier colors the blade. Origin = grip (hand). */
export function buildShovel(tier: number): THREE.Group {
  const g = new THREE.Group();
  const bladeColor = TOOLS[Math.min(tier, TOOLS.length - 1)].color;
  const glow = tier >= 3 ? { emissive: bladeColor, emissiveIntensity: 0.35 } : {};
  add(g, cyl(0.045, 0.045, 1.25, 8), mat('#9a6a3a'), 0, 0.15, 0);
  add(g, rb(0.26, 0.08, 0.08, 0.03), mat('#5a3a24'), 0, 0.78, 0);
  add(g, cyl(0.07, 0.06, 0.16, 8), mat('#6e737c', { metal: 0.6, rough: 0.35 }), 0, -0.48, 0);
  const blade = add(g, rb(0.36, 0.42, 0.06, 0.05), mat(bladeColor, { metal: 0.55, rough: 0.3, ...glow }), 0, -0.74, 0.03);
  blade.rotation.x = 0.12;
  add(g, cone(0.18, 0.16, 4), mat(bladeColor, { metal: 0.55, rough: 0.3, ...glow }), 0, -1.02, 0.045, Math.PI, Math.PI / 4, 0).scale.set(1, 1, 0.18);
  if (tier >= 3) add(g, octa(0.06), mat('#ffffff', { emissive: bladeColor, emissiveIntensity: 1.2, flat: true }), 0, -0.6, 0.08);
  return g;
}

export function buildPickaxe(tier: number): THREE.Group {
  const g = new THREE.Group();
  const c = TOOLS[Math.min(tier, TOOLS.length - 1)].color;
  add(g, cyl(0.045, 0.05, 1.1, 8), mat('#9a6a3a'), 0, -0.25, 0);
  const headG = new THREE.Group();
  headG.position.set(0, -0.82, 0);
  g.add(headG);
  add(headG, rb(0.14, 0.14, 0.18, 0.04), mat('#5d5a63', { metal: 0.5 }), 0, 0, 0);
  add(headG, cone(0.08, 0.5, 4), mat(c, { metal: 0.6, rough: 0.3 }), 0, 0, 0.3, Math.PI / 2, 0, 0);
  add(headG, cone(0.08, 0.5, 4), mat(c, { metal: 0.6, rough: 0.3 }), 0, 0, -0.3, -Math.PI / 2, 0, 0);
  return g;
}

export function buildLanternTool(): THREE.Group {
  const g = new THREE.Group();
  add(g, rb(0.2, 0.26, 0.2, 0.04), mat('#3b3a40', { metal: 0.4 }), 0, -0.2, 0);
  add(g, rb(0.16, 0.18, 0.16, 0.03), mat('#fff3b0', { emissive: '#ffbd38', emissiveIntensity: 1.5 }), 0, -0.2, 0, 0, 0, 0, false);
  add(g, torus(0.07, 0.015, 4, 10), mat('#3b3a40'), 0, -0.02, 0);
  return g;
}

// ───────── Pets ─────────
// Faceted low-poly look following the pet reference sheet: big glossy eyes,
// chunky bodies, stone/crystal accents.
export interface PetRig {
  root: THREE.Group;
  body: THREE.Group; // bobbing group
  head: THREE.Object3D;
  eyes: THREE.Object3D[];
  ears: THREE.Object3D[];
  tail: THREE.Object3D | null;
  wings: THREE.Object3D[];
  legs: THREE.Object3D[];
  hover: boolean;
  height: number;
}

const pm = (c: string, o: MatOpts = {}) => mat(c, { flat: true, rough: 0.72, ...o });
const gemMat = (c: string, glow?: string, k = 0.55) => mat(c, { flat: true, emissive: glow ?? c, emissiveIntensity: k, rough: 0.18 });

function face(head: THREE.Object3D, y: number, z: number, spacing: number, size: number, mouth: 'open' | 'smile' | 'none', mouthY = -0.12): THREE.Object3D[] {
  const out = eyes(head, y, z, spacing, size);
  if (mouth === 'open') {
    add(head, rb(size * 0.9, size * 0.55, 0.03, 0.02), mat('#5a1f1f'), 0, y + mouthY, z + 0.005, 0, 0, 0, false);
    add(head, rb(size * 0.55, size * 0.25, 0.03, 0.02), mat('#ff7a8a'), 0, y + mouthY - size * 0.12, z + 0.012, 0, 0, 0, false);
  } else if (mouth === 'smile') {
    add(head, rb(size * 0.8, size * 0.16, 0.03, 0.01), mat('#3b2a2a'), 0, y + mouthY, z + 0.005, 0, 0, 0, false);
  }
  // blush
  for (const s of [-1, 1]) add(head, rb(size * 0.6, size * 0.28, 0.02, 0.01), mat('#ff9aa8', { opacity: 0.55 }), s * (spacing + size * 0.55), y - size * 0.75, z - 0.01, 0, 0, 0, false);
  return out;
}

export function buildPet(entryId: string, shiny = false): PetRig {
  const entry = PET_ENTRY_BY_ID[entryId];
  const pal = entry.palette;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const rig: PetRig = { root, body, head: body, eyes: [], ears: [], tail: null, wings: [], legs: [], hover: false, height: 1 };
  switch (entry.species) {
    case 'pup': buildPup(rig, pal); break;
    case 'bunny': buildBunny(rig, pal); break;
    case 'mole': buildMole(rig, pal, entryId === 'forge_mole'); break;
    case 'fox': buildFox(rig, pal); break;
    case 'turtle': buildTurtle(rig, pal); break;
    case 'axolotl': buildAxolotl(rig, pal); break;
    case 'golem': buildGolem(rig, pal); break;
    case 'dragon': buildDragon(rig, pal); break;
  }
  if (shiny) {
    const sparkle = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      add(sparkle, octa(0.05), mat('#fff6c0', { emissive: '#ffd84a', emissiveIntensity: 1.5, flat: true }), Math.cos(a) * 0.55, rig.height * 0.9, Math.sin(a) * 0.55, 0, 0, 0, false);
    }
    sparkle.name = 'shinySparkle';
    body.add(sparkle);
  }
  return rig;
}

function leg(rig: PetRig, x: number, z: number, w: number, h: number, color: string, foot?: string, footGeo?: 'rock') {
  const g = new THREE.Group();
  g.position.set(x, h, z);
  add(g, rb(w, h, w, w * 0.25, 1), pm(color), 0, -h / 2, 0);
  if (foot) {
    if (footGeo === 'rock') add(g, dodeca(w * 0.62), pm(foot, { rough: 0.9 }), 0, -h + w * 0.35, 0.02).scale.set(1, 0.75, 1.1);
    else add(g, rb(w * 1.1, w * 0.45, w * 1.2, w * 0.15, 1), pm(foot), 0, -h + w * 0.2, 0.03);
  }
  rig.body.add(g);
  rig.legs.push(g);
  return g;
}

function buildPup(rig: PetRig, P: PetPalette) {
  const b = rig.body;
  add(b, rb(0.56, 0.46, 0.78, 0.14), pm(P.body), 0, 0.5, -0.08);
  add(b, rb(0.42, 0.3, 0.2, 0.08), pm(P.belly), 0, 0.5, 0.26);
  for (const [x, z] of [[-0.18, 0.18], [0.18, 0.18], [-0.18, -0.34], [0.18, -0.34]] as [number, number][]) leg(rig, x, z, 0.17, 0.32, P.body, P.detail, 'rock');
  const head = new THREE.Group();
  head.position.set(0, 0.98, 0.26);
  b.add(head);
  rig.head = head;
  add(head, rb(0.7, 0.6, 0.58, 0.16), pm(P.body), 0, 0, 0);
  add(head, rb(0.34, 0.42, 0.06, 0.08), pm(P.belly), 0.12, 0.05, 0.28); // cream face patch
  add(head, rb(0.38, 0.24, 0.24, 0.08), pm(P.belly), 0, -0.13, 0.32); // muzzle
  add(head, rb(0.14, 0.09, 0.08, 0.035), mat(BLACK, { rough: 0.2 }), 0, -0.04, 0.45);
  rig.eyes = face(head, 0.08, 0.3, 0.17, 0.13, 'open', -0.29);
  add(head, dodeca(0.13), pm(shade(P.body, 0.05), { rough: 0.9 }), 0.02, 0.33, -0.02).scale.set(1.1, 0.75, 1); // pebble tuft
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.36, 0.22, -0.02);
    add(ear, rb(0.16, 0.48, 0.32, 0.07, 1), pm(shade(P.body, -0.28)), s * 0.02, -0.2, 0);
    ear.rotation.z = s * 0.3;
    head.add(ear);
    rig.ears.push(ear);
  }
  // bandana
  add(b, rb(0.6, 0.12, 0.5, 0.05, 1), pm(P.accent), 0, 0.72, 0.18);
  add(b, cone(0.2, 0.26, 3), pm(P.accent), 0, 0.58, 0.4, Math.PI, 0, 0).scale.set(1, 1, 0.35);
  add(b, cone(0.05, 0.06, 3), mat('#ffffff'), 0, 0.6, 0.44, 0, 0, 0, false).scale.set(1, 1, 0.3);
  const tail = new THREE.Group();
  tail.position.set(0, 0.62, -0.46);
  add(tail, rb(0.16, 0.16, 0.2, 0.06, 1), pm(shade(P.body, -0.28)), 0, 0.02, -0.04, -0.7, 0, 0);
  add(tail, rb(0.24, 0.24, 0.26, 0.09, 1), pm(P.body), 0, 0.18, -0.16, -0.9, 0, 0);
  b.add(tail);
  rig.tail = tail;
  rig.height = 1.35;
}

function buildBunny(rig: PetRig, P: PetPalette) {
  const b = rig.body;
  add(b, rb(0.56, 0.5, 0.6, 0.18), pm(P.body), 0, 0.36, -0.06);
  add(b, rb(0.4, 0.32, 0.12, 0.1), pm(P.belly), 0, 0.34, 0.23);
  // leaf collar
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI - Math.PI / 2;
    add(b, cone(0.07, 0.2, 3), pm(P.accent), Math.sin(a) * 0.24, 0.56, 0.12 + Math.cos(a) * 0.1, Math.PI, 0, Math.sin(a) * 0.5).scale.set(1, 1, 0.35);
  }
  leg(rig, -0.15, 0.2, 0.13, 0.12, P.belly);
  leg(rig, 0.15, 0.2, 0.13, 0.12, P.belly);
  add(b, rb(0.18, 0.12, 0.34, 0.06, 1), pm(P.body), -0.21, 0.08, -0.14);
  add(b, rb(0.18, 0.12, 0.34, 0.06, 1), pm(P.body), 0.21, 0.08, -0.14);
  const head = new THREE.Group();
  head.position.set(0, 0.84, 0.1);
  b.add(head);
  rig.head = head;
  add(head, rb(0.58, 0.52, 0.5, 0.18), pm(P.body), 0, 0, 0);
  add(head, rb(0.28, 0.18, 0.12, 0.06), pm(P.belly), 0, -0.13, 0.24);
  add(head, rb(0.08, 0.06, 0.04, 0.02), mat('#ff8fa3'), 0, -0.07, 0.31);
  rig.eyes = face(head, 0.06, 0.25, 0.15, 0.12, 'smile', -0.24);
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.15, 0.22, -0.02);
    const leaf = add(ear, octa(0.22), pm(P.accent, { rough: 0.5 }), 0, 0.34, 0);
    leaf.scale.set(0.75, 1.9, 0.22);
    add(ear, rb(0.03, 0.55, 0.03, 0.01), pm(shade(P.accent, -0.15)), 0, 0.32, 0.05, 0, 0, 0, false);
    ear.rotation.z = s * -0.38;
    head.add(ear);
    rig.ears.push(ear);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.36, -0.38);
  add(tail, octa(0.14), pm(P.accent), 0, 0.05, -0.05, -0.6, 0, 0).scale.set(0.8, 1.4, 0.3);
  b.add(tail);
  rig.tail = tail;
  rig.height = 1.55;
}

function buildMole(rig: PetRig, P: PetPalette, forge: boolean) {
  const b = rig.body;
  add(b, rb(0.86, 0.6, 0.9, 0.24), pm(P.body), 0, 0.4, -0.1);
  // stones embedded in the back
  for (const [x, y, z, s] of [[-0.3, 0.62, -0.2, 0.12], [0.28, 0.66, -0.3, 0.1], [0.05, 0.72, -0.42, 0.11], [-0.18, 0.7, 0.02, 0.09]] as number[][])
    add(b, dodeca(s), pm('#8e8a86', { rough: 0.9 }), x, y, z).scale.set(1, 0.7, 1);
  const head = new THREE.Group();
  head.position.set(0, 0.68, 0.32);
  b.add(head);
  rig.head = head;
  add(head, rb(0.6, 0.48, 0.44, 0.18), pm(P.body), 0, 0, 0);
  add(head, rb(0.3, 0.2, 0.18, 0.08), pm(P.detail), 0, -0.1, 0.22);
  add(head, sphere(0.06, 6, 5), mat('#ff8fa3', { flat: true }), 0, -0.05, 0.32);
  for (const s of [-1, 1]) for (const d of [-0.03, 0.03]) add(head, rb(0.2, 0.012, 0.012, 0.004), mat('#3b2a2a'), s * 0.22, -0.1 + d, 0.26, 0, 0, s * d * 4, false);
  rig.eyes = face(head, 0.06, 0.22, 0.13, 0.1, 'open', -0.25);
  const hm = add(head, halfSphere(0.33, 10), pm(P.accent, { rough: 0.35, metal: forge ? 0.5 : 0 }), 0, 0.16, -0.02);
  hm.scale.set(1, 0.7, 1);
  add(head, cyl(0.36, 0.36, 0.04, 12), pm(P.accent, { metal: forge ? 0.5 : 0 }), 0, 0.16, 0.0);
  add(head, cyl(0.08, 0.08, 0.06, 10), mat('#3b3a40'), 0, 0.3, 0.26, Math.PI / 2, 0, 0);
  add(head, cyl(0.065, 0.065, 0.03, 10), mat('#fff7c2', { emissive: P.glow ?? '#ffd27a', emissiveIntensity: 2 }), 0, 0.3, 0.3, Math.PI / 2, 0, 0, false);
  // big digging paws with cream claws
  for (const s of [-1, 1]) {
    const paw = new THREE.Group();
    paw.position.set(s * 0.42, 0.18, 0.3);
    add(paw, rb(0.3, 0.16, 0.3, 0.06, 1), pm(shade(P.body, -0.05)), 0, 0, 0);
    for (let c = -1; c <= 1; c++) add(paw, cone(0.05, 0.24, 4), pm('#f2e6cc'), c * 0.09, -0.03, 0.22, Math.PI / 2 + 0.3, 0, 0);
    b.add(paw);
    rig.legs.push(paw);
  }
  leg(rig, -0.26, -0.36, 0.18, 0.12, P.body);
  leg(rig, 0.26, -0.36, 0.18, 0.12, P.body);
  rig.height = 1.15;
}

function buildFox(rig: PetRig, P: PetPalette) {
  const b = rig.body;
  add(b, rb(0.48, 0.42, 0.78, 0.13), pm(P.body), 0, 0.56, -0.06);
  add(b, rb(0.34, 0.36, 0.16, 0.08), pm(P.belly), 0, 0.56, 0.3);
  const paw = shade(P.body, -0.22);
  for (const [x, z] of [[-0.15, 0.2], [0.15, 0.2], [-0.15, -0.32], [0.15, -0.32]] as [number, number][]) leg(rig, x, z, 0.13, 0.36, P.body, paw);
  const head = new THREE.Group();
  head.position.set(0, 0.98, 0.3);
  b.add(head);
  rig.head = head;
  add(head, rb(0.56, 0.46, 0.46, 0.14), pm(P.body), 0, 0, 0);
  add(head, rb(0.5, 0.2, 0.3, 0.07), pm(P.belly), 0, -0.14, 0.12); // cheeks
  add(head, rb(0.22, 0.16, 0.24, 0.06), pm(P.belly), 0, -0.1, 0.28);
  add(head, rb(0.08, 0.06, 0.05, 0.02), mat(BLACK), 0, -0.04, 0.41);
  rig.eyes = face(head, 0.07, 0.235, 0.14, 0.12, 'smile', -0.22);
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.18, 0.22, -0.02);
    add(ear, cone(0.15, 0.42, 4), pm(P.body), 0, 0.2, 0, 0, Math.PI / 4, s * -0.15);
    add(ear, cone(0.08, 0.26, 4), pm(P.belly), 0, 0.15, 0.05, 0, Math.PI / 4, s * -0.15);
    head.add(ear);
    rig.ears.push(ear);
  }
  // big crystal tail cluster
  const tail = new THREE.Group();
  tail.position.set(0, 0.66, -0.44);
  const cm = gemMat(P.accent, P.glow ?? P.accent, 0.45);
  const cm2 = gemMat(shade(P.body, 0.1), P.glow ?? P.accent, 0.3);
  const shards: [number, number, number, number, number, number][] = [
    [0, 0.1, -0.15, 0.16, 0.5, -0.9], [0.1, 0.3, -0.32, 0.2, 0.3, -0.6], [-0.1, 0.32, -0.3, 0.18, -0.3, -0.6],
    [0, 0.52, -0.4, 0.22, 0, -0.3], [0.13, 0.55, -0.26, 0.14, 0.6, -0.2], [-0.12, 0.6, -0.3, 0.15, -0.6, -0.2],
  ];
  shards.forEach(([x, y, z, r, rz, rx], i) => add(tail, octa(r), i % 2 ? cm : cm2, x, y, z, rx, 0, rz).scale.set(0.8, 1.6, 0.8));
  b.add(tail);
  rig.tail = tail;
  rig.height = 1.45;
}

function buildTurtle(rig: PetRig, P: PetPalette) {
  const b = rig.body;
  for (const [x, z] of [[-0.32, 0.26], [0.32, 0.26], [-0.32, -0.28], [0.32, -0.28]] as [number, number][]) leg(rig, x, z, 0.22, 0.22, P.body, '#7f8a72', 'rock');
  add(b, rb(0.82, 0.14, 0.92, 0.06), pm(P.belly), 0, 0.3, 0);
  const shell = add(b, halfSphere(0.52, 8), pm(P.accent, { rough: 0.9 }), 0, 0.32, 0);
  shell.scale.set(1, 0.85, 1.1);
  // boulder plates with moss
  const plates: [number, number, number, number][] = [[0, 0.76, 0, 0.17], [0.3, 0.6, 0.2, 0.14], [-0.3, 0.6, 0.2, 0.14], [0.28, 0.58, -0.26, 0.14], [-0.28, 0.6, -0.24, 0.14], [0, 0.62, 0.36, 0.12], [0, 0.6, -0.4, 0.12]];
  plates.forEach(([x, y, z, r], i) => add(b, dodeca(r), pm(shade('#8e8a86', (i % 3) * 0.04), { rough: 0.95 }), x, y, z).scale.set(1, 0.65, 1));
  for (const [x, z] of [[0.15, 0.1], [-0.2, -0.1], [0.1, -0.25], [-0.1, 0.25]] as [number, number][]) add(b, dodeca(0.1), pm('#5fa83a'), x, 0.8, z).scale.set(1.3, 0.35, 1.1);
  const mush = (x: number, y: number, z: number, s: number) => {
    add(b, cyl(0.03 * s, 0.04 * s, 0.16 * s, 6), pm('#f3ead2'), x, y + 0.08 * s, z);
    add(b, halfSphere(0.1 * s, 7), pm('#ff8a3d'), x, y + 0.15 * s, z).scale.set(1, 0.7, 1);
  };
  mush(0.1, 0.84, 0.0, 1.3);
  mush(0.22, 0.78, -0.12, 1.0);
  mush(-0.15, 0.8, 0.12, 0.8);
  add(b, cone(0.03, 0.12, 3), pm('#5fa83a'), -0.25, 0.84, -0.05);
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.56);
  b.add(head);
  rig.head = head;
  add(head, rb(0.42, 0.36, 0.38, 0.13), pm(P.body), 0, 0, 0);
  rig.eyes = face(head, 0.06, 0.19, 0.1, 0.1, 'smile', -0.15);
  const tail = new THREE.Group();
  tail.position.set(0, 0.32, -0.52);
  add(tail, cone(0.07, 0.18, 4), pm(P.body), 0, 0, -0.06, -Math.PI / 2, 0, 0);
  b.add(tail);
  rig.tail = tail;
  rig.height = 1.05;
}

function buildAxolotl(rig: PetRig, P: PetPalette) {
  const b = rig.body;
  add(b, rb(0.52, 0.4, 0.8, 0.15), pm(P.body), 0, 0.36, -0.1);
  add(b, rb(0.42, 0.3, 0.4, 0.1), pm(P.belly), 0, 0.33, 0.06); // dark belly patch
  const toe = shade(P.accent, -0.05);
  for (const [x, z] of [[-0.25, 0.14], [0.25, 0.14], [-0.25, -0.32], [0.25, -0.32]] as [number, number][]) {
    const l = leg(rig, x, z, 0.13, 0.22, P.body);
    for (const t of [-1, 0, 1]) add(l, cone(0.03, 0.09, 3), pm(toe), t * 0.04, -0.21, 0.08, Math.PI / 2, 0, 0, false);
  }
  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.36);
  b.add(head);
  rig.head = head;
  add(head, rb(0.74, 0.5, 0.5, 0.18), pm(P.body), 0, 0, 0);
  rig.eyes = face(head, 0.06, 0.25, 0.19, 0.12, 'open', -0.22);
  // crystal gills: three per side, fanned
  for (const s of [-1, 1]) {
    const gill = new THREE.Group();
    gill.position.set(s * 0.36, 0.04, -0.06);
    for (let i = 0; i < 3; i++) {
      const ang = s * (0.35 + i * 0.55) - (s > 0 ? 0 : 0);
      const g2 = new THREE.Group();
      g2.rotation.z = -ang + s * 0.2;
      add(g2, octa(0.1), gemMat(i === 1 ? P.accent : shade(P.accent, 0.08), P.accent, 0.35), 0, 0.22, 0).scale.set(0.7, 2.4, 0.5);
      gill.add(g2);
    }
    head.add(gill);
    rig.ears.push(gill);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.42, -0.5);
  add(tail, rb(0.16, 0.24, 0.42, 0.06), pm(P.body), 0, 0, -0.18);
  add(tail, octa(0.18), gemMat(P.accent, P.accent, 0.3), 0, 0.06, -0.42, 0, 0, 0).scale.set(0.3, 1.2, 1.6);
  b.add(tail);
  rig.tail = tail;
  rig.height = 1.05;
}

function buildGolem(rig: PetRig, P: PetPalette) {
  const b = rig.body;
  const stone = pm(P.body, { rough: 0.95 });
  const dark = pm(P.detail, { rough: 0.95 });
  const moss = pm('#6f9a3a');
  for (const s of [-1, 1]) {
    const l = leg(rig, s * 0.26, 0, 0.3, 0.3, P.detail);
    add(l, dodeca(0.2), dark, 0, -0.28, 0.04).scale.set(1, 0.7, 1.15);
  }
  add(b, rb(1.0, 0.86, 0.68, 0.16), stone, 0, 0.74, 0);
  // geode chest cavity
  add(b, rb(0.56, 0.5, 0.12, 0.08), mat('#3b2a5a', { flat: true }), 0, 0.76, 0.3);
  const cm = gemMat(P.accent, P.glow ?? P.accent, 0.8);
  for (const [x, y, r, rz] of [[0, 0.8, 0.14, 0], [-0.14, 0.7, 0.1, 0.4], [0.14, 0.72, 0.1, -0.4], [-0.06, 0.62, 0.08, 0.2], [0.08, 0.92, 0.08, -0.2]] as number[][])
    add(b, octa(r), cm, x, y, 0.36, 0, 0, rz).scale.set(0.9, 1.6, 0.9);
  // boulder shoulders + crystals
  add(b, dodeca(0.26), stone, -0.52, 1.05, 0);
  add(b, dodeca(0.26), stone, 0.52, 1.05, 0);
  add(b, octa(0.09), cm, -0.55, 1.32, 0, 0, 0, 0.3).scale.set(0.8, 1.8, 0.8);
  add(b, octa(0.07), cm, 0.5, 1.3, -0.05, 0, 0, -0.3).scale.set(0.8, 1.8, 0.8);
  add(b, dodeca(0.12), moss, -0.3, 1.12, 0.12).scale.set(1.3, 0.35, 1);
  add(b, dodeca(0.1), moss, 0.35, 0.5, 0.3).scale.set(1.3, 0.35, 0.5);
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.66, 1.0, 0);
    add(arm, dodeca(0.2), stone, 0, -0.25, 0).scale.set(1, 1.3, 1);
    add(arm, dodeca(0.24), dark, 0, -0.62, 0.03).scale.set(1, 0.9, 1.1);
    b.add(arm);
    rig.ears.push(arm);
  }
  const head = new THREE.Group();
  head.position.set(0, 1.3, 0.08);
  b.add(head);
  rig.head = head;
  add(head, dodeca(0.28), stone, 0, 0, 0).scale.set(1.1, 0.85, 0.95);
  rig.eyes = face(head, 0.02, 0.23, 0.11, 0.09, 'none');
  add(head, octa(0.07), cm, 0.16, 0.24, 0).scale.set(1, 1.8, 1);
  rig.height = 1.7;
}

function buildDragon(rig: PetRig, P: PetPalette) {
  const b = rig.body;
  rig.hover = true;
  add(b, rb(0.52, 0.48, 0.72, 0.16), pm(P.body), 0, 0.52, -0.05);
  add(b, rb(0.36, 0.36, 0.12, 0.08), pm(P.belly), 0, 0.5, 0.27);
  // star specks
  const speck = mat('#cfe8ff', { emissive: '#9fd8ff', emissiveIntensity: 1 });
  for (const [x, y, z] of [[0.27, 0.6, 0], [-0.27, 0.5, -0.2], [0.27, 0.45, -0.25], [-0.27, 0.65, 0.1]] as number[][]) add(b, rb(0.02, 0.03, 0.03, 0.005), speck, x, y, z, 0, 0, 0, false);
  for (const [x, z] of [[-0.17, 0.14], [0.17, 0.14], [-0.17, -0.26], [0.17, -0.26]] as [number, number][]) leg(rig, x, z, 0.14, 0.26, P.body, P.belly);
  // back spikes
  for (let i = 0; i < 4; i++) add(b, cone(0.06, 0.16, 4), gemMat(P.detail, P.detail, 0.3), 0, 0.82 - i * 0.02, 0.15 - i * 0.18, -0.3, 0, 0);
  const head = new THREE.Group();
  head.position.set(0, 0.96, 0.26);
  b.add(head);
  rig.head = head;
  add(head, rb(0.52, 0.46, 0.46, 0.15), pm(P.body), 0, 0, 0);
  add(head, rb(0.34, 0.22, 0.26, 0.08), pm(P.belly), 0, -0.1, 0.24);
  add(head, rb(0.05, 0.03, 0.02, 0.01), mat(BLACK), -0.07, -0.04, 0.38, 0, 0, 0, false);
  add(head, rb(0.05, 0.03, 0.02, 0.01), mat(BLACK), 0.07, -0.04, 0.38, 0, 0, 0, false);
  rig.eyes = face(head, 0.07, 0.235, 0.14, 0.12, 'smile', -0.24);
  for (const s of [-1, 1]) {
    const horn = new THREE.Group();
    horn.position.set(s * 0.15, 0.22, -0.08);
    add(horn, octa(0.08), gemMat(P.detail, P.detail, 0.4), 0, 0.14, 0, -0.35, 0, s * -0.3).scale.set(0.8, 2.4, 0.8);
    head.add(horn);
    rig.ears.push(horn);
  }
  // crystal wings
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(0.75, 0.32);
  wingShape.lineTo(0.68, -0.02);
  wingShape.lineTo(0.5, 0.02);
  wingShape.lineTo(0.42, -0.2);
  wingShape.lineTo(0.22, -0.1);
  wingShape.lineTo(0, -0.2);
  const wingGeo = cachedGeo('dragonWing', () => new THREE.ExtrudeGeometry(wingShape, { depth: 0.04, bevelEnabled: false }));
  const wingMat = mat(P.accent, { emissive: P.accent, emissiveIntensity: 0.45, transparent: true, opacity: 0.85, flat: true, rough: 0.2 });
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(s * 0.2, 0.74, -0.06);
    wing.rotation.z = s * 0.55;
    const m = add(wing, wingGeo, wingMat, 0, 0, 0, Math.PI / 2, 0, 0);
    m.scale.set(s, 1, 1);
    b.add(wing);
    rig.wings.push(wing);
  }
  // curled tail with glowing star
  const tail = new THREE.Group();
  tail.position.set(0, 0.46, -0.4);
  add(tail, rb(0.22, 0.2, 0.3, 0.07), pm(P.body), 0, 0, -0.1);
  add(tail, rb(0.16, 0.16, 0.26, 0.05), pm(P.body), 0, 0.1, -0.32, 0.4, 0, 0);
  add(tail, rb(0.11, 0.11, 0.22, 0.04), pm(P.body), 0, 0.28, -0.44, 1.0, 0, 0);
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.07 : 0.17;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeo = cachedGeo('star', () => { const g = new THREE.ExtrudeGeometry(starShape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }); g.center(); return g; });
  add(tail, starGeo, mat('#9ff6ff', { emissive: P.accent, emissiveIntensity: 1.1, flat: true }), 0, 0.5, -0.5, 0, Math.PI / 2, 0);
  b.add(tail);
  rig.tail = tail;
  rig.height = 1.4;
}

// ───────── Eggs ─────────
// Faceted shells with themed bases, following the eggs reference sheet.
export interface EggRig {
  root: THREE.Group;
  egg: THREE.Group; // the egg itself (rocks during hatch)
  top: THREE.Group;
  bottom: THREE.Group;
  cracks: THREE.Group;
  base: THREE.Group;
  spinners: THREE.Object3D[];
}

const EGG_SPLIT = 0.56;
function eggRadius(t: number): number {
  return 0.55 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.72) * (1 - 0.2 * t);
}
function eggGeo(from: number, to: number, segs: number): THREE.BufferGeometry {
  return cachedGeo(`egg${from},${to},${segs}`, () => {
    const pts: THREE.Vector2[] = [];
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      pts.push(new THREE.Vector2(Math.max(0.001, eggRadius(t)), t * 1.3));
    }
    return new THREE.LatheGeometry(pts, segs);
  });
}
function eggSurface(t: number, a: number, push = 0): THREE.Vector3 {
  const r = eggRadius(t) + push;
  return new THREE.Vector3(Math.sin(a) * r, t * 1.3, Math.cos(a) * r);
}
/** Place a flat patch on the shell, oriented to the surface. */
function onShell(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, t: number, a: number, push: number, sx: number, sy: number, sz: number, roll = 0) {
  const p = eggSurface(t, a, push);
  const mesh = add(parent, geo, m, p.x, p.y, p.z, 0, a, roll, false);
  mesh.scale.set(sx, sy, sz);
  return mesh;
}

export function buildEgg(eggId: string, withBase = true): EggRig {
  const root = new THREE.Group();
  const egg = new THREE.Group();
  const top = new THREE.Group();
  const bottom = new THREE.Group();
  const cracks = new THREE.Group();
  const base = new THREE.Group();
  root.add(base, egg);
  egg.add(bottom, top, cracks);
  const spinners: THREE.Object3D[] = [];
  const isStarter = eggId === 'starter';
  const def = isStarter ? null : EGG_BY_ID[eggId];
  const shellC = isStarter ? STARTER_EGG.shell : def!.shell;
  const segs = 10;
  const shell = mat(shellC, { flat: true, rough: 0.55 });
  add(bottom, eggGeo(0, EGG_SPLIT, segs), shell, 0, 0, 0);
  add(top, eggGeo(EGG_SPLIT, 1, segs), shell, 0, 0, 0);
  const crackColor = eggId === 'ember' ? '#ff9a3d' : eggId === 'geode' ? '#c9a8ff' : eggId === 'aurora' ? '#6ff5e6' : '#fff4dc';
  const crackMat = mat(crackColor, { emissive: crackColor, emissiveIntensity: 1.8 });
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * Math.PI * 2 + 0.4;
    let prev = eggSurface(0.4, a0, 0.012);
    for (let i = 1; i <= 4; i++) {
      const t = 0.4 + i * 0.065;
      const p = eggSurface(t, a0 + (i % 2 ? 0.2 : -0.14), 0.012);
      const mid = prev.clone().add(p).multiplyScalar(0.5);
      const seg = add(cracks, rb(0.035, prev.distanceTo(p) + 0.03, 0.035, 0.01), crackMat, mid.x, mid.y, mid.z, 0, 0, 0, false);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().sub(prev).normalize());
      prev = p;
    }
  }
  cracks.visible = false;

  const band = (g: THREE.Group, t: number, color: string, thick: number, o: MatOpts = {}) => {
    const r = eggRadius(t) + thick * 0.3;
    add(g, cachedGeo(`band${r},${thick}`, () => new THREE.CylinderGeometry(r, r, thick * 2.2, 10, 1, true)), mat(color, { ...o, flat: true }), 0, t * 1.3, 0);
    add(g, cachedGeo(`bandin${r},${thick}`, () => new THREE.CylinderGeometry(r - 0.01, r - 0.01, thick * 2.2, 10, 1, true)), mat(color, { ...o, flat: true }), 0, t * 1.3, 0).scale.set(-1, 1, 1);
  };
  const emblem = (g: THREE.Group, t: number, color: string, gem: string, glow = false) => {
    const p = eggSurface(t, 0, 0.06);
    add(g, octa(0.13), mat(color, { flat: true, metal: 0.3 }), p.x, p.y, p.z).scale.set(1, 1.1, 0.4);
    add(g, octa(0.075), mat(gem, { flat: true, emissive: glow ? gem : '#000000', emissiveIntensity: 0.9 }), p.x, p.y, p.z + 0.04).scale.set(1, 1.1, 0.4);
  };

  if (isStarter) {
    band(bottom, 0.42, STARTER_EGG.accent, 0.05, { rough: 0.4 });
    emblem(bottom, 0.42, '#fff4dc', '#ffbd38', true);
    for (let i = 0; i < 6; i++) onShell(top, sphere(0.07, 5, 4), pm(STARTER_EGG.detail), 0.7, (i / 6) * Math.PI * 2, 0, 1, 1, 0.4);
    const star = add(top, octa(0.14), mat('#ffbd38', { emissive: '#ffbd38', emissiveIntensity: 0.7, flat: true }), 0, 1.4, 0);
    star.scale.set(1, 1.3, 0.5);
    spinners.push(star);
    if (withBase) {
      add(base, cyl(0.7, 0.8, 0.3, 8), pm('#d8cdb8'), 0, -0.12, 0);
      add(base, cyl(0.72, 0.72, 0.06, 8), pm('#16cdbb', { emissive: '#0a6e64', emissiveIntensity: 0.5 }), 0, 0.03, 0);
    }
  } else if (eggId === 'meadow') {
    const leaf = pm(def!.accent);
    for (let i = 0; i < 14; i++) {
      const t = 0.12 + ((i * 0.37) % 1) * 0.78;
      onShell(t < EGG_SPLIT ? bottom : top, octa(0.1), leaf, t, i * 1.31, -0.015, 1.2, 0.95, 0.35, i);
    }
    band(bottom, 0.43, def!.detail, 0.06, { rough: 0.9 });
    for (let i = 0; i < 8; i++) onShell(bottom, rb(0.13, 0.15, 0.06, 0.02), pm(shade(def!.detail, (i % 2) * 0.06)), 0.43, (i / 8) * Math.PI * 2 + 0.39, 0.075, 1, 1, 1);
    emblem(bottom, 0.43, '#9a968f', '#78ae48');
    add(top, cyl(0.03, 0.035, 0.2, 5), pm('#4f8a2e'), 0, 1.38, 0);
    add(top, octa(0.11), leaf, -0.1, 1.48, 0, 0, 0, 0.9).scale.set(1, 0.4, 0.5);
    add(top, octa(0.11), leaf, 0.1, 1.5, 0, 0, 0, -0.9).scale.set(1, 0.4, 0.5);
    if (withBase) {
      add(base, cyl(0.78, 0.6, 0.38, 8), pm('#865637'), 0, -0.16, 0);
      add(base, cyl(0.8, 0.8, 0.1, 8), pm('#78ae48'), 0, 0.04, 0);
      for (let i = 0; i < 6; i++) { const a = i * 1.05; add(base, dodeca(0.13), pm('#8e8a86'), Math.cos(a) * 0.68, 0.06, Math.sin(a) * 0.68); }
      for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.5; add(base, octa(0.05), pm('#ffffff'), Math.cos(a) * 0.62, 0.12, Math.sin(a) * 0.62).scale.set(1, 0.4, 1); }
    }
  } else if (eggId === 'geode') {
    const seam = gemMat('#b48aff', def!.accent, 0.9);
    const plate = pm('#6c6872', { rough: 0.9 });
    for (let i = 0; i < 16; i++) {
      const t = 0.1 + ((i * 0.41) % 1) * 0.82;
      onShell(t < EGG_SPLIT ? bottom : top, dodeca(0.13), plate, t, i * 1.17, -0.02, 1.2, 1, 0.45);
    }
    band(bottom, 0.46, '#4a4652', 0.055, { rough: 0.8 });
    const rune = mat(def!.detail, { emissive: def!.detail, emissiveIntensity: 1.3 });
    for (let i = 0; i < 9; i++) onShell(bottom, octa(0.035), rune, 0.46, (i / 9) * Math.PI * 2 + 0.35, 0.075, 1, 1.2, 0.4);
    emblem(bottom, 0.46, '#8e8a96', def!.detail, true);
    if (withBase) {
      add(base, cyl(0.8, 0.7, 0.32, 7), pm('#4a4652'), 0, -0.14, 0);
      add(base, cachedGeo('ringGlow', () => new THREE.TorusGeometry(0.78, 0.025, 4, 28)), mat(def!.detail, { emissive: def!.detail, emissiveIntensity: 1.4 }), 0, 0.03, 0, Math.PI / 2, 0, 0, false);
      for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.3; add(base, octa(0.1), seam, Math.cos(a) * 0.62, 0.15, Math.sin(a) * 0.62, Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3).scale.set(0.8, 2, 0.8); }
      for (let i = 0; i < 5; i++) { const a = i * 1.26; add(base, dodeca(0.12), plate, Math.cos(a) * 0.78, 0.04, Math.sin(a) * 0.78); }
    }
    // violet light peeking between plates
    add(bottom, eggGeo(0.08, EGG_SPLIT, 10), mat('#7a48e0', { emissive: '#5a28c0', emissiveIntensity: 0.6, flat: true }), 0, 0, 0).scale.set(0.97, 1, 0.97);
  } else if (eggId === 'ember') {
    const glow = mat('#ffb04a', { emissive: '#ff6a1a', emissiveIntensity: 1.5 });
    // hex-ish crack network
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      for (let i = 0; i < 6; i++) {
        const t = 0.1 + i * 0.14;
        onShell(t < EGG_SPLIT ? bottom : top, rb(0.03, 0.17, 0.02, 0.008), glow, t, a + (i % 2 ? 0.16 : -0.16), 0.002, 1, 1, 1, i % 2 ? 0.6 : -0.6);
      }
      onShell(bottom, rb(0.2, 0.03, 0.02, 0.008), glow, 0.3, a + 0.5, 0.002, 1, 1, 1);
      onShell(top, rb(0.16, 0.03, 0.02, 0.008), glow, 0.75, a + 0.5, 0.002, 1, 1, 1);
    }
    band(bottom, 0.4, def!.detail, 0.065, { metal: 0.65, rough: 0.35 });
    for (let i = 0; i < 10; i++) onShell(bottom, sphere(0.028, 5, 4), mat('#ffd08a', { metal: 0.8, rough: 0.25 }), 0.4, (i / 10) * Math.PI * 2 + 0.31, 0.085, 1, 1, 1);
    emblem(bottom, 0.4, def!.detail, '#ff7a2e', true);
    if (withBase) {
      add(base, cyl(0.8, 0.65, 0.38, 7), pm('#2e2b33'), 0, -0.16, 0);
      add(base, cyl(0.6, 0.6, 0.06, 7), mat('#ff7a2e', { emissive: '#ff4a00', emissiveIntensity: 1.1 }), 0, 0.04, 0);
      for (let i = 0; i < 7; i++) { const a = i * 0.9; add(base, dodeca(0.15), pm('#3a3640'), Math.cos(a) * 0.7, 0.08, Math.sin(a) * 0.7); }
    }
  } else if (eggId === 'aurora') {
    const teal = mat(def!.accent, { emissive: def!.accent, emissiveIntensity: 1.1 });
    onShell(bottom, torus(0.16, 0.035, 4, 14, Math.PI * 1.25), teal, 0.5, 0, 0.0, 1, 1, 1, 0.9);
    onShell(top, torus(0.1, 0.025, 4, 12, Math.PI * 1.25), teal, 0.72, Math.PI, 0.0, 1, 1, 1, 0.9);
    const starM = mat('#ffd36a', { emissive: '#ffbd38', emissiveIntensity: 0.9 });
    for (let i = 0; i < 9; i++) {
      const t = 0.15 + ((i * 0.53) % 1) * 0.75;
      onShell(t < EGG_SPLIT ? bottom : top, octa(0.035), i % 3 ? mat('#cfe8ff', { emissive: '#9fd8ff', emissiveIntensity: 1 }) : starM, t, i * 1.9 + 0.8, 0.005, 1, 1, 0.4);
    }
    for (let i = 0; i < 5; i++) {
      const t = 0.2 + (i % 3) * 0.24;
      onShell(t < EGG_SPLIT ? bottom : top, octa(0.08), gemMat(def!.detail, def!.detail, 0.4), t, i * 1.26 + 0.6, 0.02, 0.8, 1.6, 0.6);
    }
    const ringG = new THREE.Group();
    ringG.position.y = 0.65;
    for (const tilt of [0.45, -0.6]) {
      const ring = new THREE.Group();
      ring.rotation.set(Math.PI / 2 + tilt, 0, tilt * 0.6);
      add(ring, torus(0.72, 0.016, 4, 40), mat('#ffd36a', { metal: 0.85, rough: 0.25, emissive: '#5a4210' }), 0, 0, 0, 0, 0, 0, false);
      add(ring, octa(0.06), starM, 0.72, 0, 0, 0, 0, 0, false);
      ringG.add(ring);
      spinners.push(ring);
    }
    egg.add(ringG);
    if (withBase) {
      const fl = new THREE.Group();
      fl.position.y = -0.2;
      add(fl, cyl(0.62, 0.3, 0.3, 7), pm('#8e8a86'), 0, -0.05, 0);
      add(fl, cyl(0.64, 0.64, 0.06, 7), mat('#6ff5e6', { emissive: '#16cdbb', emissiveIntensity: 1.1 }), 0, 0.12, 0);
      for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.4; add(fl, octa(0.09), pm('#6c6872'), Math.cos(a) * 0.9, -0.1 + (i % 2) * 0.3, Math.sin(a) * 0.9).scale.set(1, 1.5, 1); }
      base.add(fl);
      spinners.push(fl);
      egg.position.y = 0.05;
    }
  }
  if (withBase && eggId !== 'aurora') egg.position.y = 0.06;
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  return { root, egg, top, bottom, cracks, base, spinners };
}

// ───────── Labels ─────────
const labelCache = new Map<string, THREE.SpriteMaterial>();
export function makeLabel(text: string, opts: { color?: string; bg?: string; size?: number; sub?: string } = {}): THREE.Sprite {
  const key = `${text}|${opts.color}|${opts.bg}|${opts.sub}`;
  let m = labelCache.get(key);
  const fontPx = 40;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d')!;
  ctx.font = `800 ${fontPx}px "Trebuchet MS", system-ui, sans-serif`;
  const w1 = ctx.measureText(text).width;
  ctx.font = `700 ${fontPx * 0.62}px "Trebuchet MS", system-ui, sans-serif`;
  const w2 = opts.sub ? ctx.measureText(opts.sub).width : 0;
  const w = Math.ceil(Math.max(w1, w2) + 48);
  const h = opts.sub ? 104 : 64;
  if (!m) {
    cv.width = w; cv.height = h;
    ctx.fillStyle = opts.bg ?? 'rgba(20,36,61,0.85)';
    const r = 22;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, r);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${fontPx}px "Trebuchet MS", system-ui, sans-serif`;
    ctx.fillStyle = opts.color ?? '#fff4dc';
    ctx.fillText(text, w / 2, opts.sub ? 36 : h / 2 + 2);
    if (opts.sub) {
      ctx.font = `700 ${fontPx * 0.62}px "Trebuchet MS", system-ui, sans-serif`;
      ctx.fillStyle = '#16cdbb';
      ctx.fillText(opts.sub, w / 2, 76);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 2;
    m = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
    labelCache.set(key, m);
  }
  const s = new THREE.Sprite(m);
  const scale = (opts.size ?? 0.55) / 64;
  const img = m.map!.image as HTMLCanvasElement;
  s.scale.set(img.width * scale, img.height * scale, 1);
  s.renderOrder = 5;
  return s;
}

// ───────── Props ─────────
export function buildTree(kind: 'oak' | 'pine' | 'crystal' | 'ember' | 'aurora', seed: number): THREE.Group {
  const g = new THREE.Group();
  const r = (n: number) => ((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  const h = 1.6 + r(1) * 1.2;
  if (kind === 'oak') {
    add(g, rb(0.45, h, 0.45, 0.08), lam('#7a5236'), 0, h / 2, 0);
    const leaf = lam(r(2) > 0.5 ? '#5d9e3a' : '#6aae44');
    add(g, rb(2.0, 1.4, 2.0, 0.3), leaf, 0, h + 0.5, 0);
    add(g, rb(1.4, 1.0, 1.4, 0.25), lam('#7cc457'), 0.2, h + 1.3, 0.1);
    add(g, rb(1.0, 0.8, 1.0, 0.2), leaf, -0.6, h + 0.2, 0.5);
  } else if (kind === 'pine') {
    add(g, rb(0.35, h, 0.35, 0.06), lam('#6a4630'), 0, h / 2, 0);
    for (let i = 0; i < 3; i++) add(g, cone(1.3 - i * 0.3, 1.3, 6), lam(i % 2 ? '#3f7f3a' : '#4a8f42', undefined, true), 0, h + i * 0.75, 0);
  } else if (kind === 'crystal') {
    const c = r(3) > 0.5 ? '#9462f5' : '#5fd0ff';
    for (let i = 0; i < 4; i++) {
      const a = r(i + 4) * Math.PI * 2;
      const hh = 1 + r(i + 8) * 2.2;
      const m = add(g, cyl(0, 0.32, hh, 6), lam(c, shade(c, -0.25), true), Math.cos(a) * 0.4 * i * 0.5, hh / 2, Math.sin(a) * 0.4 * i * 0.5, (r(i) - 0.5) * 0.5, 0, (r(i + 1) - 0.5) * 0.5);
      void m;
    }
  } else if (kind === 'ember') {
    add(g, rb(0.4, h, 0.4, 0.06), lam('#2e2b33'), 0, h / 2, 0);
    add(g, rb(0.2, 0.9, 0.2, 0.04), lam('#2e2b33'), 0.3, h * 0.7, 0, 0, 0, -0.7);
    add(g, octa(0.25), lam('#ff7a2e', '#a03000', true), 0, h + 0.2, 0);
  } else {
    add(g, cyl(0.15, 0.25, h, 6), lam('#3d4f80', undefined, true), 0, h / 2, 0);
    add(g, octa(0.6), lam('#16cdbb', '#0a6e64', true), 0, h + 0.6, 0).scale.set(0.8, 1.4, 0.8);
  }
  return g;
}

export function buildRock(color: string, scale: number): THREE.Mesh {
  const m = new THREE.Mesh(dodeca(0.6), lam(color, undefined, true));
  m.scale.set(scale * 1.2, scale * 0.8, scale);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildCrystalCluster(color: string, n = 5, size = 1): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const h = (0.6 + ((i * 37) % 10) / 10) * size;
    add(g, cyl(0, 0.16 * size, h, 6), lam(color, shade(color, -0.2), true), Math.cos(a) * 0.18 * size, h / 2, Math.sin(a) * 0.18 * size, Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35, false);
  }
  return g;
}

export function buildTent(color: string): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-1.6, 0);
  shape.lineTo(0, 2.0);
  shape.lineTo(1.6, 0);
  shape.lineTo(-1.6, 0);
  const geo = cachedGeo('tent', () => { const t = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false }); t.translate(0, 0, -1.5); return t; });
  add(g, geo, lam(color), 0, 0, 0);
  add(g, cachedGeo('tentDoor', () => new THREE.ShapeGeometry((() => { const s = new THREE.Shape(); s.moveTo(-0.6, 0); s.lineTo(0, 1.3); s.lineTo(0.6, 0); return s; })())), lam('#3b2b22'), 0, 0.01, 1.52);
  add(g, cyl(0.05, 0.05, 2.3, 6), lam('#7a5236'), 0, 1.1, 1.55);
  add(g, rb(0.05, 0.05, 3.2, 0.01), lam('#7a5236'), 0, 2.0, 0);
  return g;
}

export function buildLanternPost(): THREE.Group {
  const g = new THREE.Group();
  add(g, rb(0.16, 2.2, 0.16, 0.04), lam('#5a3a24'), 0, 1.1, 0);
  add(g, rb(0.7, 0.12, 0.12, 0.03), lam('#5a3a24'), 0.25, 2.15, 0);
  add(g, rb(0.34, 0.08, 0.34, 0.03), lam('#3b3a40'), 0.5, 2.06, 0);
  add(g, rb(0.3, 0.08, 0.3, 0.03), lam('#3b3a40'), 0.5, 1.72, 0);
  add(g, rb(0.26, 0.28, 0.26, 0.05), basic('#ffe08a'), 0.5, 1.89, 0, 0, 0, 0, false);
  return g;
}

export function buildFlag(color: string): THREE.Group {
  const g = new THREE.Group();
  add(g, cyl(0.05, 0.05, 3.2, 6), lam('#d8c9a3'), 0, 1.6, 0);
  const flag = add(g, rb(0.9, 0.55, 0.03, 0.01), lam(color), 0.47, 2.85, 0);
  flag.name = 'flagCloth';
  return g;
}

export function buildSign(text: string, sub?: string): THREE.Group {
  const g = new THREE.Group();
  add(g, rb(0.14, 1.4, 0.14, 0.03), lam('#7a5236'), -0.7, 0.7, 0);
  add(g, rb(0.14, 1.4, 0.14, 0.03), lam('#7a5236'), 0.7, 0.7, 0);
  add(g, rb(1.9, 0.8, 0.1, 0.04), lam('#a8743f'), 0, 1.3, 0);
  const label = makeLabel(text, { sub, bg: 'rgba(90,58,36,0.0)', color: '#fff4dc', size: 0.42 });
  label.position.set(0, 1.32, 0.08);
  g.add(label);
  return g;
}

export function buildFencePost(): THREE.Mesh {
  const m = new THREE.Mesh(rb(0.18, 0.9, 0.18, 0.04), lam('#8a5a32'));
  m.castShadow = true;
  return m;
}

export function buildPedestal(color: string): THREE.Group {
  const g = new THREE.Group();
  add(g, cyl(0.75, 0.9, 0.35, 8), lam('#d8cdb8', undefined, true), 0, 0.175, 0);
  add(g, cyl(0.6, 0.7, 0.5, 8), lam('#ece3cf', undefined, true), 0, 0.6, 0);
  add(g, cyl(0.68, 0.68, 0.08, 8), lam(color, shade(color, -0.3)), 0, 0.88, 0);
  return g;
}

export function buildChest(kind: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'coins') {
    add(g, rb(0.8, 0.5, 0.56, 0.06), mat('#9a6a3a'), 0, 0.25, 0);
    add(g, rb(0.84, 0.24, 0.6, 0.08), mat('#7a5236'), 0, 0.6, 0);
    add(g, rb(0.86, 0.08, 0.62, 0.02), mat('#ffbd38', { metal: 0.6, rough: 0.3 }), 0, 0.48, 0);
    add(g, rb(0.14, 0.18, 0.06, 0.02), mat('#ffbd38', { metal: 0.6, rough: 0.3 }), 0, 0.45, 0.3);
  } else if (kind === 'geode') {
    add(g, dodeca(0.4), mat('#6c6872', { flat: true }), 0, 0.4, 0);
    add(g, octa(0.18), mat('#c9a8ff', { emissive: '#9462f5', emissiveIntensity: 0.8, flat: true }), 0, 0.55, 0.28).scale.set(1, 1.5, 1);
  } else if (kind === 'fossil') {
    add(g, rb(0.9, 0.24, 0.6, 0.08), mat('#c8b48e', { flat: true }), 0, 0.12, 0);
    for (let i = 0; i < 4; i++) add(g, rb(0.08, 0.06, 0.4, 0.02), mat('#fff4dc'), -0.25 + i * 0.16, 0.26, 0);
    add(g, rb(0.6, 0.06, 0.08, 0.02), mat('#fff4dc'), 0, 0.27, 0);
  } else if (kind === 'token') {
    add(g, cyl(0.32, 0.32, 0.08, 16), mat('#16cdbb', { emissive: '#0a6e64', metal: 0.4 }), 0, 0.4, 0, Math.PI / 2, 0, 0);
    add(g, sphere(0.14, 10, 8), mat('#fff4dc'), 0, 0.42, 0.04).scale.set(0.8, 1.05, 0.4);
  } else {
    // decor + relic: ornate shard on a small plinth
    add(g, rb(0.5, 0.18, 0.5, 0.05), mat('#c8b48e'), 0, 0.09, 0);
    add(g, octa(0.26), mat(kind === 'relic' ? '#ffd36a' : '#e0c0a0', { emissive: kind === 'relic' ? '#a07010' : '#000000', emissiveIntensity: 0.6, flat: true, metal: 0.3 }), 0, 0.48, 0).scale.set(0.8, 1.3, 0.5);
  }
  return g;
}

export function buildCoinIconMesh(): THREE.Mesh {
  return new THREE.Mesh(cyl(0.2, 0.2, 0.06, 14), mat('#ffbd38', { metal: 0.6, rough: 0.3, emissive: '#5a3a00' }));
}

export function buildScanner(): THREE.Group {
  const g = new THREE.Group();
  add(g, rb(0.34, 0.5, 0.16, 0.06), mat('#14243d'), 0, 0, 0);
  add(g, rb(0.26, 0.2, 0.04, 0.03), mat('#16cdbb', { emissive: '#16cdbb', emissiveIntensity: 0.9 }), 0, 0.08, 0.08);
  add(g, torus(0.06, 0.015, 4, 12), mat('#ffbd38', { emissive: '#7a5a10' }), 0, 0.08, 0.1);
  add(g, cyl(0.02, 0.02, 0.3, 6), mat('#9aa3ad', { metal: 0.6 }), 0.1, 0.38, 0);
  add(g, sphere(0.04, 6, 5), mat('#16cdbb', { emissive: '#16cdbb', emissiveIntensity: 1.2 }), 0.1, 0.54, 0);
  add(g, rb(0.08, 0.06, 0.03, 0.01), mat('#ffbd38'), -0.08, -0.14, 0.08);
  return g;
}

export function buildGemIcon(): THREE.Group {
  const g = new THREE.Group();
  add(g, octa(0.32), mat('#a46bff', { flat: true, emissive: '#5a28c0', emissiveIntensity: 0.6, rough: 0.15 }), 0, 0.35, 0).scale.set(0.8, 1.25, 0.8);
  add(g, octa(0.09), mat('#c9a8ff', { flat: true, emissive: '#6a38d0', emissiveIntensity: 0.5 }), 0.3, 0.1, 0.1);
  return g;
}

export function buildCoinStack(): THREE.Group {
  const g = new THREE.Group();
  const cm = mat('#ffbd38', { metal: 0.55, rough: 0.3, emissive: '#5a3a00', emissiveIntensity: 0.6 });
  for (let i = 0; i < 3; i++) add(g, cyl(0.3, 0.3, 0.08, 18), cm, (i % 2) * 0.05, i * 0.085, 0);
  const top = add(g, cyl(0.3, 0.3, 0.08, 18), cm, 0.1, 0.45, 0.15, Math.PI / 2 - 0.3, 0, 0);
  add(top, rb(0.12, 0.03, 0.18, 0.01), mat('#c98a10', { metal: 0.6 }), 0, 0.045, 0);
  return g;
}

export function buildBackpackIcon(): THREE.Group {
  const g = new THREE.Group();
  add(g, rb(0.6, 0.66, 0.36, 0.1), mat('#e07a2a'), 0, 0.33, 0);
  add(g, rb(0.62, 0.24, 0.38, 0.08), mat('#b85a1a'), 0, 0.6, 0.01);
  add(g, rb(0.08, 0.6, 0.04, 0.02), mat('#16cdbb'), -0.16, 0.36, 0.19);
  add(g, rb(0.08, 0.6, 0.04, 0.02), mat('#16cdbb'), 0.16, 0.36, 0.19);
  add(g, cyl(0.1, 0.1, 0.66, 8), mat('#d8c9a3'), 0, 0.76, -0.05, 0, 0, Math.PI / 2);
  return g;
}

export function buildScrollIcon(): THREE.Group {
  const g = new THREE.Group();
  add(g, rb(0.6, 0.04, 0.44, 0.02), mat('#f2e2c0'), 0, 0.3, 0, 0.9, 0, 0);
  add(g, cyl(0.06, 0.06, 0.7, 8), mat('#a8743f'), 0, 0.48, -0.13, 0, 0, Math.PI / 2);
  add(g, cyl(0.06, 0.06, 0.7, 8), mat('#a8743f'), 0, 0.12, 0.13, 0, 0, Math.PI / 2);
  add(g, rb(0.3, 0.02, 0.02, 0.005), mat('#865637'), 0, 0.33, 0.03, 0.9, 0, 0);
  return g;
}
