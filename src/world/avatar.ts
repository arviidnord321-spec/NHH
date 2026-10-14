/**
 * Smooth, customizable avatar (R15-style proportions): rounded torso with a
 * painted outfit, capsule limbs, mitten hands, rounded head with a painted
 * face decal, layered hair, hats, scarf and backpack. Returns the same
 * HumanRig interface the animation code already drives.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { add, cachedGeo, compactRig, HumanRig, mat } from './models';

import { type AvatarLook, type FaceStyle, type Outfit } from '../core/avatarData';
export { AVATAR_OPTIONS, DEFAULT_AVATAR, type AvatarLook } from '../core/avatarData';

const smooth = (color: string, rough = 0.55) => mat(color, { rough });

function capsule(r: number, len: number) {
  return cachedGeo(`cap${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 5, 14));
}
function rbox(w: number, h: number, d: number, r: number, seg = 4) {
  return cachedGeo(`rbox${w},${h},${d},${r},${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, r));
}

// ───────── painted textures ─────────
const texCache = new Map<string, THREE.Texture>();
function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

export function faceTexture(face: FaceStyle): THREE.Texture {
  return canvasTex(`face:${face}`, 256, 256, (g) => {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const ink = '#1d1a22';
    const eye = (x: number, y: number, lid: boolean, w = 26, h = 30) => {
      g.fillStyle = '#ffffff';
      g.beginPath(); g.ellipse(x, y, w, h * 0.62, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = ink;
      g.beginPath(); g.ellipse(x + 4, y + 2, w * 0.42, h * 0.42, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(x + 9, y - 4, 4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = ink; g.lineWidth = 5;
      if (lid) {
        // heavy, relaxed upper lid
        g.fillStyle = 'rgba(0,0,0,0)';
        g.beginPath(); g.moveTo(x - w - 2, y - 2); g.quadraticCurveTo(x, y - h * 0.5, x + w + 2, y - 4); g.stroke();
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(x - w + 4, y + h * 0.55); g.quadraticCurveTo(x, y + h * 0.75, x + w - 2, y + h * 0.5); g.stroke();
      } else {
        g.beginPath(); g.ellipse(x, y, w, h * 0.62, 0, 0, Math.PI * 2); g.stroke();
      }
    };
    const brow = (x0: number, y0: number, x1: number, y1: number, cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - 8) => {
      g.strokeStyle = ink; g.lineWidth = 7;
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
    };
    if (face === 'smirk') {
      eye(84, 104, true, 30, 30);
      eye(172, 104, true, 30, 30);
      // fill top half of eyes with lid shade
      brow(52, 74, 112, 70);
      brow(146, 68, 206, 76);
      g.strokeStyle = ink; g.lineWidth = 6;
      g.beginPath(); g.moveTo(70, 176); g.bezierCurveTo(110, 196, 160, 194, 196, 160); g.stroke();
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(190, 150); g.quadraticCurveTo(204, 158, 200, 172); g.stroke();
      g.beginPath(); g.moveTo(124, 132); g.quadraticCurveTo(130, 146, 140, 140); g.stroke();
    } else if (face === 'smile') {
      g.fillStyle = ink;
      g.beginPath(); g.ellipse(92, 104, 13, 20, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(164, 104, 13, 20, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = ink; g.lineWidth = 7;
      g.beginPath(); g.arc(128, 140, 46, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    } else if (face === 'happy') {
      g.strokeStyle = ink; g.lineWidth = 8;
      g.beginPath(); g.arc(90, 112, 20, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.beginPath(); g.arc(166, 112, 20, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.fillStyle = '#5a1f24';
      g.beginPath(); g.moveTo(88, 150); g.quadraticCurveTo(128, 214, 168, 150); g.closePath(); g.fill();
      g.fillStyle = '#ff7a8a';
      g.beginPath(); g.ellipse(128, 178, 18, 10, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,120,140,.45)';
      g.beginPath(); g.ellipse(58, 150, 16, 9, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(198, 150, 16, 9, 0, 0, Math.PI * 2); g.fill();
    } else if (face === 'determined') {
      eye(88, 112, false, 22, 26);
      eye(168, 112, false, 22, 26);
      brow(58, 76, 116, 92, 88, 78);
      brow(140, 92, 198, 76, 168, 78);
      g.strokeStyle = ink; g.lineWidth = 7;
      g.beginPath(); g.moveTo(100, 178); g.lineTo(158, 172); g.stroke();
    } else {
      // cool shades
      g.fillStyle = ink;
      g.beginPath(); g.roundRect(46, 82, 72, 46, 14); g.fill();
      g.beginPath(); g.roundRect(138, 82, 72, 46, 14); g.fill();
      g.fillRect(110, 92, 36, 8);
      g.fillStyle = 'rgba(160,220,255,.6)';
      g.fillRect(58, 90, 22, 8);
      g.fillRect(150, 90, 22, 8);
      g.strokeStyle = ink; g.lineWidth = 6;
      g.beginPath(); g.moveTo(96, 174); g.quadraticCurveTo(140, 190, 170, 164); g.stroke();
    }
  });
}

/** Torso front / back paint for each outfit (main + inner colors). */
function outfitTexture(o: Outfit, top: string, inner: string, back = false): THREE.Texture {
  return canvasTex(`outfit:${o}:${top}:${inner}:${back}`, 256, 256, (g) => {
    g.fillStyle = top;
    g.fillRect(0, 0, 256, 256);
    // soft fabric shading
    const sh = g.createLinearGradient(0, 0, 0, 256);
    sh.addColorStop(0, 'rgba(255,255,255,.10)');
    sh.addColorStop(1, 'rgba(0,0,0,.18)');
    g.fillStyle = sh;
    g.fillRect(0, 0, 256, 256);
    if (back) {
      if (o === 'hoodie') { g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(128, 30, 80, 46, 0, 0, Math.PI); g.fill(); }
      return;
    }
    if (o === 'vest') {
      // open vest over a shirt, with a jagged hem
      g.fillStyle = inner;
      g.beginPath();
      g.moveTo(88, 0); g.lineTo(168, 0); g.lineTo(158, 150);
      const pts = [[150, 210], [140, 170], [130, 236], [120, 176], [108, 214], [100, 160]];
      for (const [x, y] of pts) g.lineTo(x, y);
      g.lineTo(96, 150); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(92, 0); g.lineTo(98, 160); g.moveTo(164, 0); g.lineTo(158, 160); g.stroke();
      g.fillStyle = 'rgba(0,0,0,.2)';
      g.fillRect(24, 120, 44, 6); g.fillRect(188, 120, 44, 6);
    } else if (o === 'jacket') {
      g.fillStyle = 'rgba(0,0,0,.16)';
      g.fillRect(30, 150, 66, 44); g.fillRect(160, 150, 66, 44);
      g.fillStyle = inner;
      g.fillRect(124, 0, 8, 256);
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.fillRect(30, 150, 66, 5); g.fillRect(160, 150, 66, 5);
      g.fillStyle = '#5a3a24';
      g.fillRect(0, 226, 256, 22);
      g.fillStyle = '#ffbd38';
      g.fillRect(116, 228, 24, 18);
    } else if (o === 'hoodie') {
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.beginPath(); g.roundRect(56, 150, 144, 70, 18); g.fill();
      g.strokeStyle = inner; g.lineWidth = 6;
      g.beginPath(); g.moveTo(104, 0); g.lineTo(98, 90); g.moveTo(152, 0); g.lineTo(158, 90); g.stroke();
      g.fillStyle = inner;
      g.beginPath(); g.arc(98, 94, 7, 0, Math.PI * 2); g.arc(158, 94, 7, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = inner;
      g.fillRect(0, 96, 256, 26);
      g.beginPath(); g.ellipse(128, 0, 46, 24, 0, 0, Math.PI); g.fill();
    }
  });
}

// ───────── builder ─────────
export function buildAvatar(look: AvatarLook): HumanRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const skin = smooth(look.skin, 0.5);
  const sleeve = smooth(look.outfit === 'vest' || look.outfit === 'tee' ? look.inner : look.top);
  const pantsM = smooth(look.pants, 0.7);

  // legs (pivot at hip)
  const mkLeg = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0.92, 0);
    add(g, capsule(0.17, 0.32), pantsM, 0, -0.26, 0);
    add(g, capsule(0.16, 0.3), pantsM, 0, -0.56, 0);
    add(g, rbox(0.34, 0.2, 0.46, 0.08), smooth(look.shoes, 0.6), 0, -0.82, 0.05);
    body.add(g);
    return g;
  };
  const legL = mkLeg(-0.2);
  const legR = mkLeg(0.2);
  // hips + torso
  add(body, rbox(0.78, 0.26, 0.42, 0.11), pantsM, 0, 0.95, 0);
  const torsoMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: outfitTexture(look.outfit, look.top, look.inner), roughness: 0.62 });
  const torsoBack = new THREE.MeshStandardMaterial({ color: '#ffffff', map: outfitTexture(look.outfit, look.top, look.inner, true), roughness: 0.62 });
  const torso = new THREE.Mesh(rbox(0.88, 0.8, 0.46, 0.17), smooth(look.top, 0.62));
  torso.position.set(0, 1.33, 0);
  torso.castShadow = true;
  body.add(torso);
  const front = new THREE.Mesh(cachedGeo('torsoFront', () => new THREE.PlaneGeometry(0.74, 0.7)), torsoMat);
  front.position.set(0, 1.33, 0.232);
  body.add(front);
  const backP = new THREE.Mesh(cachedGeo('torsoFront', () => new THREE.PlaneGeometry(0.74, 0.7)), torsoBack);
  backP.position.set(0, 1.33, -0.232);
  backP.rotation.y = Math.PI;
  body.add(backP);
  if (look.outfit === 'hoodie') {
    const hood = add(body, cachedGeo('hood', () => new THREE.TorusGeometry(0.26, 0.1, 10, 24)), smooth(look.top), 0, 1.72, -0.12, Math.PI / 2 - 0.3, 0, 0);
    void hood;
  }
  // arms (pivot at shoulder)
  const mkArm = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 1.62, 0);
    add(g, capsule(0.155, 0.36), sleeve, 0, -0.2, 0);
    add(g, capsule(0.14, 0.26), look.outfit === 'tee' ? skin : sleeve, 0, -0.54, 0);
    const hand = new THREE.Group();
    hand.position.set(0, -0.8, 0.02);
    add(hand, cachedGeo('palm', () => new THREE.SphereGeometry(0.135, 16, 12)), skin, 0, 0, 0).scale.set(0.95, 1.1, 0.85);
    add(hand, capsule(0.045, 0.08), skin, -Math.sign(x) * 0.1, 0.02, 0.06, 0.4, 0, -Math.sign(x) * 0.5);
    g.add(hand);
    body.add(g);
    return g;
  };
  const armL = mkArm(-0.6);
  const armR = mkArm(0.6);
  const toolHolder = new THREE.Group();
  toolHolder.position.set(0, -0.8, 0.04);
  armR.add(toolHolder);
  // backpack + straps
  if (look.backpack) {
    const packM = smooth('#8a5a32', 0.7);
    add(body, rbox(0.62, 0.62, 0.28, 0.12), packM, 0, 1.3, -0.36);
    add(body, rbox(0.64, 0.2, 0.3, 0.09), smooth('#6e4526', 0.7), 0, 1.56, -0.36);
    add(body, cachedGeo('bedroll', () => new THREE.CylinderGeometry(0.12, 0.12, 0.7, 16)), smooth('#d8c9a3', 0.8), 0, 1.72, -0.38, 0, 0, Math.PI / 2);
    for (const s of [-1, 1]) add(body, rbox(0.08, 0.62, 0.04, 0.02, 2), packM, s * 0.22, 1.42, 0.235);
  }
  // scarf
  const scarf: THREE.Mesh[] = [];
  if (look.scarf) {
    const sm = smooth(look.scarf, 0.75);
    const ring = add(body, cachedGeo('scarfRing', () => new THREE.TorusGeometry(0.27, 0.12, 12, 28)), sm, 0, 1.73, 0, Math.PI / 2, 0, 0);
    ring.scale.set(1.1, 0.95, 1);
    const tail = add(body, rbox(0.17, 0.42, 0.09, 0.05, 3), sm, 0.2, 1.5, 0.27, 0.12, 0, 0.12);
    scarf.push(ring, tail);
  }
  // head
  const head = new THREE.Group();
  head.position.set(0, 1.74, 0);
  body.add(head);
  add(head, cachedGeo('neck', () => new THREE.CylinderGeometry(0.13, 0.14, 0.12, 14)), skin, 0, 0.03, 0);
  add(head, rbox(0.64, 0.6, 0.6, 0.18, 5), skin, 0, 0.36, 0);
  const faceM = new THREE.MeshStandardMaterial({ map: faceTexture(look.face), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const face = new THREE.Mesh(cachedGeo('facePlane', () => new THREE.PlaneGeometry(0.56, 0.56)), faceM);
  face.position.set(0, 0.34, 0.302);
  face.renderOrder = 2;
  face.userData.keep = true;
  head.add(face);
  buildHair(head, look);
  // hats
  let helmet: THREE.Mesh;
  let lamp: THREE.Mesh;
  const lampMat = mat('#fff7c2', { emissive: '#ffd27a', emissiveIntensity: 1.4 });
  if (look.hat === 'helmet') {
    helmet = add(head, cachedGeo('helmetDome', () => new THREE.SphereGeometry(0.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), mat(look.hatColor, { rough: 0.3 }), 0, 0.56, 0);
    helmet.scale.set(1, 0.72, 1);
    add(head, cachedGeo('helmetBrim', () => new THREE.CylinderGeometry(0.46, 0.46, 0.05, 28)), mat(look.hatColor, { rough: 0.3 }), 0, 0.56, 0.02);
    add(head, cachedGeo('lampBase', () => new THREE.CylinderGeometry(0.09, 0.09, 0.08, 14)), mat('#3b3a40'), 0, 0.7, 0.33, Math.PI / 2, 0, 0);
    lamp = add(head, cachedGeo('lampLens', () => new THREE.CylinderGeometry(0.07, 0.07, 0.04, 14)), lampMat, 0, 0.7, 0.38, Math.PI / 2, 0, 0, false);
  } else {
    if (look.hat === 'cap') {
      helmet = add(head, cachedGeo('capDome', () => new THREE.SphereGeometry(0.37, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2)), smooth(look.hatColor), 0, 0.6, 0);
      helmet.scale.set(1, 0.62, 1);
      add(head, rbox(0.44, 0.04, 0.3, 0.02, 2), smooth(look.hatColor), 0, 0.61, 0.33);
    } else if (look.hat === 'beanie') {
      helmet = add(head, cachedGeo('beanie', () => new THREE.SphereGeometry(0.37, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), smooth(look.hatColor, 0.9), 0, 0.58, 0);
      helmet.scale.set(1.02, 0.85, 1.02);
      add(head, cachedGeo('beanieCuff', () => new THREE.TorusGeometry(0.34, 0.06, 8, 28)), smooth(look.hatColor, 0.9), 0, 0.6, 0, Math.PI / 2, 0, 0);
      add(head, cachedGeo('pom', () => new THREE.SphereGeometry(0.08, 12, 8)), smooth('#ffffff', 0.9), 0, 0.92, 0);
    } else {
      helmet = new THREE.Mesh();
      helmet.visible = false;
      head.add(helmet);
    }
    lamp = new THREE.Mesh();
    lamp.visible = false;
    head.add(lamp);
  }
  const crown = new THREE.Group();
  crown.position.set(0, 0.86, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(crown, cachedGeo('crownGem', () => new THREE.OctahedronGeometry(0.07, 0)), mat('#6ff5e6', { emissive: '#16cdbb', emissiveIntensity: 0.8, flat: true }), Math.cos(a) * 0.22, 0.04, Math.sin(a) * 0.22).scale.set(0.8, 1.8, 0.8);
  }
  add(crown, cachedGeo('crownRing', () => new THREE.TorusGeometry(0.24, 0.035, 8, 24)), mat('#ffbd38', { metal: 0.6, rough: 0.3 }), 0, -0.04, 0, Math.PI / 2, 0, 0);
  crown.visible = false;
  head.add(crown);
  for (const m of [helmet, ...scarf]) m.userData.keep = true;
  front.userData.keep = true;
  backP.userData.keep = true;
  compactRig(root);
  return { root, body, head, armL, armR, legL, legR, toolHolder, helmet, scarf, crown, lamp };
}

function buildHair(head: THREE.Group, look: AvatarLook) {
  if (look.hair === 'bald') return;
  const c = new THREE.Color(look.hairColor);
  const light = smooth('#' + c.clone().offsetHSL(0, 0.02, 0.12).getHexString(), 0.45);
  const dark = smooth('#' + c.clone().offsetHSL(0, 0, -0.1).getHexString(), 0.5);
  const base = smooth(look.hairColor, 0.5);
  const strand = (len: number, r = 0.055) => capsule(r, len);
  const shell = (cover: number, frontLift: number, ridges: number, puff: number) => {
    const key = `hairShell${cover},${frontLift},${ridges},${puff},${look.hairColor}`;
    const geo = cachedGeo(key, () => {
      const g = new THREE.SphereGeometry(0.4, 56, 24, 0, Math.PI * 2, 0, Math.PI * cover);
      const p = g.attributes.position;
      const col = new Float32Array(p.count * 3);
      const lc = new THREE.Color(look.hairColor).offsetHSL(0, 0.02, 0.13);
      const dc = new THREE.Color(look.hairColor).offsetHSL(0, 0, -0.12);
      const tmp = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const phi = Math.atan2(x, z);
        const front = Math.max(0, Math.cos(phi));
        const band = 0.5 + 0.5 * Math.sin(phi * ridges + y * 6);
        const k = 1 + puff * (0.4 + 0.6 * band) * (y > -0.1 ? 1 : 0.6);
        x *= k * 0.97; z *= k; y *= 1 + puff * 0.3;
        // raise the front hairline so the face stays clear
        const lift = frontLift * front * front;
        if (y < 0.4 * (1 - 1.25 * lift)) y = y + (0.4 * (1 - 1.25 * lift) - y) * lift * 1.6;
        p.setXYZ(i, x, y, z);
        tmp.copy(dc).lerp(lc, band * (0.6 + 0.4 * Math.min(1, (y + 0.2) / 0.6)));
        col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      return g;
    });
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide }));
    m.position.set(0, 0.42, -0.015);
    m.castShadow = true;
    m.userData.keep = true;
    head.add(m);
    return m;
  };
  const curl = (r: number, t: number) => cachedGeo(`curl${r},${t}`, () => new THREE.TorusGeometry(r, t, 8, 18, Math.PI * 1.1));
  if (look.hair === 'swoop') {
    shell(0.66, 0.55, 14, 0.09);
    // side-swept fringe locks lying on the forehead
    for (let i = 0; i < 4; i++) {
      const m = add(head, strand(0.2, 0.06), i % 2 ? light : dark, -0.18 + i * 0.1, 0.63 - i * 0.015, 0.33 - Math.abs(i - 1.5) * 0.02, 0.25, 0, 1.05);
      m.scale.set(1.25, 1, 0.6);
    }
    // curled locks on top and at the side (like the layered style)
    add(head, curl(0.13, 0.05), light, 0.12, 0.82, 0.1, 0.2, 0.6, 0.3);
    add(head, curl(0.11, 0.045), dark, -0.14, 0.84, -0.06, -0.3, -0.5, 0.2);
    add(head, curl(0.12, 0.05), light, 0.36, 0.55, -0.05, 0, Math.PI / 2, 0.4);
  } else if (look.hair === 'short') {
    shell(0.5, 0.35, 18, 0.04);
  } else if (look.hair === 'spiky') {
    shell(0.48, 0.3, 12, 0.03);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      add(head, cachedGeo('spike', () => new THREE.ConeGeometry(0.09, 0.3, 10)), i % 2 ? light : base, Math.cos(a) * 0.22, 0.72, Math.sin(a) * 0.22 - 0.03, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    }
  } else if (look.hair === 'bob') {
    shell(0.78, 0.6, 10, 0.1);
  } else if (look.hair === 'ponytail') {
    shell(0.58, 0.45, 16, 0.05);
    add(head, cachedGeo('tail', () => new THREE.SphereGeometry(0.16, 16, 12)), base, 0, 0.4, -0.38).scale.set(0.9, 1.4, 0.9);
    add(head, cachedGeo('tie', () => new THREE.TorusGeometry(0.07, 0.03, 8, 16)), smooth('#e23d74'), 0, 0.56, -0.33, 0.3, 0, 0);
  }
}

