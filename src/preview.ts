// Dev-only model gallery (not part of the production build): /preview.html?m=pets|variants|eggs|avatars
import * as THREE from 'three';
import { buildPet, buildEgg, buildShovel } from './world/models';
import { buildAvatar, DEFAULT_AVATAR } from './world/avatar';
import { PET_ENTRIES } from './data/balance';

const r = new THREE.WebGLRenderer({ antialias: true });
r.setSize(innerWidth, innerHeight);
r.outputColorSpace = THREE.SRGBColorSpace;
r.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(r.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#7fc4f5');
scene.add(new THREE.HemisphereLight('#ffffff', '#b09070', 1.6));
const sun = new THREE.DirectionalLight('#fff4dc', 2.2);
sun.position.set(3, 6, 5);
scene.add(sun);
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
const mode = new URLSearchParams(location.search).get('m') ?? 'avatars';
if (mode === 'pets' || mode === 'variants') {
  const list = mode === 'pets' ? PET_ENTRIES.slice(0, 8) : PET_ENTRIES.slice(8);
  list.forEach((e, i) => {
    const p = buildPet(e.id);
    p.root.position.set((i % 4) * 2 - 3, i < 4 ? 1.7 : -0.3, 0);
    p.root.rotation.y = 0.5;
    scene.add(p.root);
  });
  cam.position.set(0, 2.5, 13); cam.lookAt(0, 0.6, 0);
} else if (mode === 'eggs') {
  ['meadow', 'geode', 'ember', 'aurora', 'starter'].forEach((id, i) => {
    const e = buildEgg(id);
    e.root.position.set(i * 2 - 4, 0, 0); scene.add(e.root);
  });
  cam.position.set(0, 3, 12); cam.lookAt(0, 0.8, -1);
} else {
  const looks = [
    DEFAULT_AVATAR,
    { ...DEFAULT_AVATAR, face: 'happy', hair: 'ponytail', hairColor: '#5a3218', outfit: 'hoodie', top: '#e23d74', skin: '#f0c08f', hat: 'none', scarf: '' },
    { ...DEFAULT_AVATAR, face: 'determined', hair: 'spiky', hairColor: '#e8a33a', outfit: 'jacket', top: '#f07a2a', inner: '#ffe27a', skin: '#d29a6a', hat: 'helmet', scarf: '#16cdbb' },
    { ...DEFAULT_AVATAR, face: 'cool', hair: 'short', hairColor: '#2a2024', outfit: 'tee', top: '#2f78ec', skin: '#6e4630', hat: 'cap', hatColor: '#e23d74', backpack: false },
  ] as const;
  looks.forEach((l, i) => {
    const a = buildAvatar(l as any);
    const sh = buildShovel(0); sh.rotation.set(1.05, 0, -0.15); sh.scale.setScalar(1.25); a.toolHolder.add(sh);
    a.root.position.set(i * 1.6 - 2.4, 0, 0);
    a.root.rotation.y = i === 0 ? 0.25 : 0.5;
    scene.add(a.root);
  });
  cam.position.set(0, 1.8, 7.5); cam.lookAt(0, 1.2, 0);
  if (mode === 'face') { cam.fov = 18; cam.position.set(-2.1, 1.9, 4.2); cam.lookAt(-2.4, 1.8, 0); }
}
cam.updateProjectionMatrix();
r.render(scene, cam);
(window as any).__ready = true;
