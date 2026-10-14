// Dev-only model gallery (not part of the production build): /preview.html
import * as THREE from 'three';
import { buildPet, buildEgg, buildHuman, buildShovel } from './world/models';
import { PET_ENTRIES } from './data/balance';

const r = new THREE.WebGLRenderer({ antialias: true });
r.setSize(innerWidth, innerHeight);
r.outputColorSpace = THREE.SRGBColorSpace;
r.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(r.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f3ead8');
scene.add(new THREE.HemisphereLight('#ffffff', '#b09070', 1.6));
const sun = new THREE.DirectionalLight('#fff4dc', 2.2);
sun.position.set(3, 6, 5);
scene.add(sun);
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
const mode = new URLSearchParams(location.search).get('m') ?? 'pets';
const rigs: { root: THREE.Object3D }[] = [];
if (mode === 'pets') {
  PET_ENTRIES.slice(0, 8).forEach((e, i) => {
    const p = buildPet(e.id);
    p.root.position.set((i % 4) * 2 - 3, i < 4 ? 1.7 : -0.3, 0);
    p.root.rotation.y = 0.5;
    scene.add(p.root); rigs.push(p);
  });
  cam.position.set(0, 2.5, 13); cam.lookAt(0, 0.6, 0);
} else if (mode === 'variants') {
  PET_ENTRIES.slice(8).forEach((e, i) => {
    const p = buildPet(e.id, i === 0);
    p.root.position.set(i * 2 - 3, 0, 0); p.root.rotation.y = 0.5; scene.add(p.root);
  });
  cam.position.set(0, 2.5, 10); cam.lookAt(0, 0.6, 0);
} else {
  ['meadow', 'geode', 'ember', 'aurora', 'starter'].forEach((id, i) => {
    const e = buildEgg(id);
    e.root.position.set(i * 2 - 4, 0, 0); scene.add(e.root);
  });
  const h = buildHuman({ jacket: '#f07a2a', pants: '#3a3f4f', skin: '#ffd9a8', helmet: '#ffbd38', scarf: '#16cdbb', backpack: true });
  h.toolHolder.add(buildShovel(0));
  h.root.position.set(0, 0, -3); h.root.rotation.y = 0.6; h.root.scale.setScalar(0.9);
  scene.add(h.root);
  cam.position.set(0, 3, 12); cam.lookAt(0, 0.8, -1);
}
r.render(scene, cam);
(window as any).__ready = true;
