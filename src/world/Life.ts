/**
 * Ambient life: wandering explorer NPCs (clearly labelled as NPCs), butterfly
 * swarms, circling birds and spinning bonus coins you can grab. Everything is
 * instanced or pooled so it stays cheap.
 */
import * as THREE from 'three';
import { BIOMES, BiomeId } from '../data/balance';
import { buildAvatar, DEFAULT_AVATAR, type AvatarLook } from './avatar';
import { buildShovel, HumanRig, makeLabel, mat } from './models';
import { angleDiff, World } from './World';
import { ParticlePool } from './ParticlePool';

interface Walker {
  rig: HumanRig;
  pos: THREE.Vector3;
  route: [number, number][];
  leg: number;
  wait: number;
  digging: number;
  phase: number;
  name: string;
  lines: string[];
}

export interface Talker { name: string; pos: THREE.Vector3; lines: string[] }

const WALKERS: { name: string; look: Partial<AvatarLook>; route: [number, number][]; lines: string[] }[] = [
  {
    name: 'Rowan', look: { face: 'happy', hair: 'spiky', hairColor: '#f4e2a0', outfit: 'hoodie', top: '#3fb52e', inner: '#fff4dc', skin: '#ffdcb5', scarf: '', hat: 'none' },
    route: [[-8, -4], [-8, -14], [-2, -20.5], [6, -14], [3, 2]],
    lines: ['Dig deep — the shiny stuff is down below!', 'Echo Scan (Q) points right at buried caches.', 'Nice shovel! Mine is held together with tape.'],
  },
  {
    name: 'Sunny', look: { face: 'smile', hair: 'ponytail', hairColor: '#d8483a', outfit: 'tee', top: '#ffbd38', inner: '#f4f2ee', skin: '#d29a6a', scarf: '#16cdbb', hat: 'cap', hatColor: '#2f78ec' },
    route: [[-20, -12], [-30, -2.5], [-37, -10], [-22, -24], [-12, -8]],
    lines: ['The fossils here are super old. Like, older than me.', 'Hatched a Moss Turtle yesterday. Best day ever!', 'Sell your bag to Mara before it bursts!'],
  },
  {
    name: 'Kip', look: { face: 'cool', hair: 'short', hairColor: '#2a2024', outfit: 'jacket', top: '#7b3fe4', inner: '#ffe27a', skin: '#6e4630', scarf: '#ffbd38', hat: 'beanie', hatColor: '#e23d74' },
    route: [[16, -10], [26, -12], [34, -20], [22, 4], [12, 0]],
    lines: ['Heard Crystal Hollow glows at night…', 'Pets dig faster when they level up. Fact.', 'Grab the floating coins, they add up!'],
  },
];

const BUTTERFLY_COLORS = ['#ff9ad0', '#ffe36a', '#9fe0ff', '#ffffff', '#c9a8ff', '#ffb070'];

export class Life {
  private walkers: Walker[] = [];
  private flyMesh!: THREE.InstancedMesh;
  private flies: { home: THREE.Vector3; phase: number; speed: number; r: number }[] = [];
  private birdMesh!: THREE.InstancedMesh;
  private birds: { phase: number; r: number; h: number; speed: number; cx: number; cz: number }[] = [];
  private coinMesh!: THREE.InstancedMesh;
  private coins: { pos: THREE.Vector3; alive: boolean; respawn: number; biome: BiomeId }[] = [];
  private dummy = new THREE.Object3D();
  private tmp = new THREE.Vector3();
  onCoin: ((pos: THREE.Vector3, biome: BiomeId) => void) | null = null;

  constructor(private world: World, private particles: ParticlePool) {
    this.buildWalkers();
    this.buildButterflies();
    this.buildBirds();
    this.buildCoins();
  }

  // ───────── NPC explorers ─────────
  private buildWalkers() {
    for (const w of WALKERS) {
      const rig = buildAvatar({ ...DEFAULT_AVATAR, ...w.look });
      rig.root.scale.setScalar(0.9);
      const sh = buildShovel(0);
      sh.rotation.set(1.05, 0, -0.15);
      sh.scale.setScalar(1.25);
      rig.toolHolder.add(sh);
      const label = makeLabel(w.name, { sub: 'NPC Explorer', size: 0.46 });
      label.position.set(0, 2.85, 0);
      rig.root.add(label);
      const [x, z] = w.route[0];
      const pos = new THREE.Vector3(x, 0, z);
      rig.root.position.copy(pos);
      this.world.biomeGroups.meadow.add(rig.root);
      this.walkers.push({ rig, pos, route: w.route, leg: 1, wait: 1 + Math.random() * 2, digging: 0, phase: Math.random() * 6, name: w.name, lines: w.lines });
    }
  }

  talkers(): Talker[] {
    return this.walkers.map((w) => ({ name: w.name, pos: w.pos, lines: w.lines }));
  }

  private updateWalkers(dt: number, time: number, player: THREE.Vector3) {
    for (const w of this.walkers) {
      const r = w.rig;
      const near = w.pos.distanceTo(player) < 4;
      let moving = false;
      if (near) {
        // stop and look at the player while chatting
        const face = Math.atan2(player.x - w.pos.x, player.z - w.pos.z);
        r.root.rotation.y += angleDiff(r.root.rotation.y, face) * Math.min(1, dt * 5);
        w.digging = 0;
      } else if (w.wait > 0) {
        w.wait -= dt;
        if (w.digging > 0) {
          w.digging -= dt;
          // dig emote: swing the shovel, kick up soil
          const s = (time * 2.2 + w.phase) % 1;
          r.armR.rotation.x = s < 0.5 ? -2.4 * (s / 0.5) : -2.4 + 3.0 * Math.min(1, (s - 0.5) / 0.15);
          r.armL.rotation.x = r.armR.rotation.x * 0.8;
          if (s > 0.62 && s < 0.66) {
            this.tmp.set(w.pos.x + Math.sin(r.root.rotation.y) * 1.1, 0.15, w.pos.z + Math.cos(r.root.rotation.y) * 1.1);
            this.particles.chipsBurst(this.tmp, new THREE.Vector3(0, 1, 0), '#8a5530', 3, 2.5, 0.08);
          }
        }
        if (w.wait <= 0) w.leg = (w.leg + 1) % w.route.length;
      } else {
        const [tx, tz] = w.route[w.leg];
        const dx = tx - w.pos.x, dz = tz - w.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.15) {
          w.wait = 2.5 + Math.random() * 3;
          w.digging = Math.random() < 0.5 ? w.wait : 0;
        } else {
          const sp = Math.min(d, 2.6 * dt);
          w.pos.x += (dx / d) * sp;
          w.pos.z += (dz / d) * sp;
          r.root.rotation.y += angleDiff(r.root.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
          moving = true;
        }
      }
      r.root.position.copy(w.pos);
      const walk = moving ? Math.sin(time * 9 + w.phase) : 0;
      r.legL.rotation.x = walk * 0.6;
      r.legR.rotation.x = -walk * 0.6;
      if (w.digging <= 0) {
        r.armL.rotation.x += ((moving ? -walk * 0.5 : Math.sin(time * 1.4 + w.phase) * 0.05) - r.armL.rotation.x) * Math.min(1, dt * 10);
        r.armR.rotation.x += ((moving ? walk * 0.5 : near ? -0.5 + Math.sin(time * 7) * 0.45 : 0) - r.armR.rotation.x) * Math.min(1, dt * 10);
      }
      r.body.position.y = moving ? Math.abs(Math.sin(time * 9 + w.phase)) * 0.05 : Math.sin(time * 2 + w.phase) * 0.015;
    }
  }

  // ───────── butterflies ─────────
  private buildButterflies() {
    const wing = new THREE.CircleGeometry(0.16, 6);
    wing.translate(0.16, 0, 0);
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    const n = 36;
    this.flyMesh = new THREE.InstancedMesh(wing, m, n * 2);
    this.flyMesh.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 30;
      this.flies.push({ home: new THREE.Vector3(Math.cos(a) * r, 0.8 + Math.random() * 1.6, Math.sin(a) * r), phase: Math.random() * 10, speed: 0.6 + Math.random() * 0.6, r: 1 + Math.random() * 2.5 });
      col.set(BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length]);
      this.flyMesh.setColorAt(i * 2, col);
      this.flyMesh.setColorAt(i * 2 + 1, col);
    }
    this.world.biomeGroups.meadow.add(this.flyMesh);
  }

  private updateButterflies(time: number) {
    const d = this.dummy;
    this.flies.forEach((f, i) => {
      const t = time * f.speed + f.phase;
      const x = f.home.x + Math.cos(t) * f.r + Math.sin(t * 2.3) * 0.4;
      const z = f.home.z + Math.sin(t * 0.8) * f.r;
      const y = f.home.y + Math.sin(t * 3.1) * 0.35;
      const heading = Math.atan2(-Math.sin(t) * f.r, Math.cos(t * 0.8) * f.r * 0.8);
      const flap = Math.sin(time * 18 + f.phase * 7) * 1.1;
      for (const side of [1, -1]) {
        d.position.set(x, y, z);
        d.rotation.set(0, heading, 0);
        d.rotateZ(side > 0 ? flap : Math.PI - flap);
        d.rotateX(-Math.PI / 2);
        d.scale.setScalar(1);
        d.updateMatrix();
        this.flyMesh.setMatrixAt(i * 2 + (side > 0 ? 0 : 1), d.matrix);
      }
    });
    this.flyMesh.instanceMatrix.needsUpdate = true;
  }

  // ───────── birds ─────────
  private buildBirds() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -0.9, 0.1, -0.2, 0, 0.05, -0.1, 0, 0, 0.3, 0, 0.05, -0.1, 0.9, 0.1, -0.2], 3));
    g.computeVertexNormals();
    this.birdMesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: '#2a3550', side: THREE.DoubleSide }), 9);
    this.birdMesh.frustumCulled = false;
    for (let i = 0; i < 9; i++) this.birds.push({ phase: (i / 9) * Math.PI * 2, r: 22 + (i % 3) * 9, h: 24 + (i % 4) * 3, speed: 0.12 + (i % 3) * 0.03, cx: (i % 2 ? 1 : -1) * 10, cz: -10 });
    this.world.scene.add(this.birdMesh);
  }

  private updateBirds(time: number, player: THREE.Vector3) {
    const d = this.dummy;
    this.birds.forEach((b, i) => {
      const a = time * b.speed + b.phase;
      d.position.set(player.x * 0.6 + b.cx + Math.cos(a) * b.r, b.h + Math.sin(time * 0.7 + i) * 1.2, player.z * 0.6 + b.cz + Math.sin(a) * b.r);
      d.rotation.set(0, -a, Math.sin(time * 6 + i) * 0.35);
      const flap = 1 + Math.sin(time * 9 + i * 2) * 0.35;
      d.scale.set(1.4, flap * 1.4, 1.4);
      d.updateMatrix();
      this.birdMesh.setMatrixAt(i, d.matrix);
    });
    this.birdMesh.instanceMatrix.needsUpdate = true;
  }

  // ───────── bonus coins ─────────
  private buildCoins() {
    const g = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 18);
    g.rotateX(Math.PI / 2);
    this.coinMesh = new THREE.InstancedMesh(g, mat('#ffbe24', { rough: 0.3, emissive: '#c07a00', emissiveIntensity: 0.55 }), 24);
    this.coinMesh.frustumCulled = false;
    for (let i = 0; i < 24; i++) this.coins.push({ pos: new THREE.Vector3(), alive: false, respawn: i * 0.4, biome: 'meadow' });
    this.world.scene.add(this.coinMesh);
  }

  private placeCoin(c: (typeof this.coins)[number], player: THREE.Vector3) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 26;
      const x = player.x + Math.cos(a) * r, z = player.z + Math.sin(a) * r;
      const b = this.world.biomeAt(x, z);
      const [cx, cz] = BIOMES[b].center;
      if (Math.abs(x - cx) > BIOMES[b].half - 4 || Math.abs(z - cz) > BIOMES[b].half - 4) continue;
      if (this.world.siteAtCell(Math.floor(x), Math.floor(z)) || this.world.siteAtCell(Math.floor(x + 1), Math.floor(z + 1)) || this.world.siteAtCell(Math.floor(x - 1), Math.floor(z - 1))) continue; // keep off dig sites
      if (this.world.circles.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + 0.6)) continue;
      if (this.world.boxes.some((k) => k.enabled && x > k.minX - 0.5 && x < k.maxX + 0.5 && z > k.minZ - 0.5 && z < k.maxZ + 0.5)) continue;
      c.pos.set(x, 0.9, z);
      c.biome = b;
      c.alive = true;
      return;
    }
  }

  private updateCoins(dt: number, time: number, player: THREE.Vector3, unlocked: BiomeId[]) {
    const d = this.dummy;
    this.coins.forEach((c, i) => {
      if (!c.alive) {
        c.respawn -= dt;
        if (c.respawn <= 0) this.placeCoin(c, player);
        if (!c.alive) c.respawn = 2;
      } else {
        const far = c.pos.distanceTo(player) > 48 || !unlocked.includes(c.biome);
        if (far) { c.alive = false; c.respawn = 0.5; }
        else if (Math.hypot(c.pos.x - player.x, c.pos.z - player.z) < 1.3 && Math.abs(player.y + 0.9 - c.pos.y) < 1.6) {
          c.alive = false;
          c.respawn = 14 + Math.random() * 10;
          this.particles.sparkle(c.pos, '#ffd84a', 14, 0.5, 2, 0.28, 1, 0.6);
          this.onCoin?.(c.pos.clone(), c.biome);
        }
      }
      if (c.alive) {
        d.position.set(c.pos.x, c.pos.y + Math.sin(time * 2.5 + i) * 0.15, c.pos.z);
        d.rotation.set(0, time * 3 + i, 0);
        d.scale.setScalar(1);
      } else {
        d.position.set(0, -50, 0);
        d.scale.setScalar(0.001);
      }
      d.updateMatrix();
      this.coinMesh.setMatrixAt(i, d.matrix);
    });
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, time: number, player: THREE.Vector3, unlocked: BiomeId[]) {
    this.updateWalkers(dt, time, player);
    if (this.world.biomeGroups.meadow.visible) this.updateButterflies(time);
    this.updateBirds(time, player);
    this.updateCoins(dt, time, player, unlocked);
  }
}
