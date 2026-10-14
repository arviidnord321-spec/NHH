/**
 * In-world pet companions: only the equipped team is animated. Pets follow
 * in a loose staggered formation (no collision with the player), hop/hover
 * over terrain, re-position if far behind, assist digging visually, celebrate
 * discoveries and idle (blink, bob, wag, flap). AI targets update at a lower
 * rate; visuals interpolate every frame.
 */
import * as THREE from 'three';
import { PET_ENTRY_BY_ID } from '../data/balance';
import type { PetInstance } from '../core/state';
import { buildPet, makeLabel, PetRig } from './models';
import { ParticlePool } from './ParticlePool';
import { angleDiff, World } from './World';

// beside and slightly ahead of the player so the team stays in view in first person
const SLOTS: [number, number][] = [[-2.6, 0.5], [2.6, 0.5], [-3.4, -0.8], [3.4, -0.8]];

interface Follower {
  pet: PetInstance;
  rig: PetRig;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  hop: number;
  phase: number;
  blink: number;
  assist: number;
  celebrate: number;
  label: THREE.Sprite;
  key: string;
}

const THEME: Record<string, string> = {
  pup: '#d9b07a', bunny: '#9ad86a', mole: '#ffd27a', fox: '#c9a8ff', turtle: '#7cc457', axolotl: '#ff8a5e', golem: '#b68aff', dragon: '#6ff5e6',
};

export class PetFollowers {
  private list: Follower[] = [];
  private aiTimer = 0;
  private tmp = new THREE.Vector3();

  constructor(private world: World, private particles: ParticlePool) {}

  sync(team: PetInstance[], playerPos: THREE.Vector3) {
    const keyOf = (p: PetInstance) => `${p.id}:${p.entry}:${p.shiny}`;
    const next: Follower[] = [];
    for (const p of team) {
      const ex = this.list.find((f) => f.key === keyOf(p));
      if (ex) { ex.pet = p; next.push(ex); continue; }
      const rig = buildPet(p.entry, p.shiny);
      rig.root.scale.setScalar(0.72);
      const pos = playerPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, 1.5));
      rig.root.position.copy(pos);
      const label = makeLabel(`${PET_ENTRY_BY_ID[p.entry].name.split(' ').slice(-1)[0]} · Lv ${p.level}`, { size: 0.36 });
      label.position.y = rig.height + 0.45;
      label.visible = false;
      rig.root.add(label);
      this.world.scene.add(rig.root);
      next.push({ pet: p, rig, pos, target: pos.clone(), yaw: 0, hop: 0, phase: Math.random() * 6, blink: 2 + Math.random() * 3, assist: 0, celebrate: 0, label, key: keyOf(p) });
    }
    for (const f of this.list) if (!next.includes(f)) this.world.scene.remove(f.rig.root);
    this.list = next;
  }

  /** Visual assist at strike contact (damage already included in formula). */
  assist(cell: THREE.Vector3) {
    for (const f of this.list) {
      f.assist = 0.35;
      if (f.pos.distanceTo(cell) < 6) {
        const sp = PET_ENTRY_BY_ID[f.pet.entry].species;
        this.tmp.copy(f.pos).lerp(cell, 0.6);
        this.tmp.y += 0.5;
        this.particles.sparkle(this.tmp, THEME[sp] ?? '#ffffff', 1, 0.3, 0.8, 0.16, 0, 0.4);
      }
    }
  }

  celebrate() {
    for (const f of this.list) {
      f.celebrate = 1.2;
      const sp = PET_ENTRY_BY_ID[f.pet.entry].species;
      this.tmp.copy(f.pos);
      this.tmp.y += f.rig.height * 0.7;
      this.particles.sparkle(this.tmp, THEME[sp] ?? '#ffffff', 4, 0.6, 1.5, 0.22, 1, 0.6);
    }
  }

  teleportAll(p: THREE.Vector3) {
    for (const f of this.list) { f.pos.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, 1.5)); f.target.copy(f.pos); }
  }

  update(dt: number, time: number, player: THREE.Vector3, playerYaw: number, digTarget: THREE.Vector3 | null, showLabels: boolean) {
    this.aiTimer -= dt;
    const think = this.aiTimer <= 0;
    if (think) this.aiTimer = 0.15;
    const sin = Math.sin(playerYaw), cos = Math.cos(playerYaw);
    this.list.forEach((f, i) => {
      if (think) {
        const [sx, sz] = SLOTS[i % SLOTS.length];
        // slot relative to player facing (forward = +z in local)
        f.target.set(player.x + sx * cos + sz * sin, player.y, player.z - sx * sin + sz * cos);
        const g = this.world.groundY(f.target.x, f.target.z, player.y + 1.2);
        f.target.y = g;
      }
      const d = f.pos.distanceTo(player);
      if (d > 15) {
        f.pos.copy(f.target);
        this.particles.puff(f.pos, '#ffffff', 3, 0.5);
      }
      const dx = f.target.x - f.pos.x, dz = f.target.z - f.pos.z;
      const dist = Math.hypot(dx, dz);
      const speed = Math.min(9, 2 + dist * 3);
      if (dist > 0.15) {
        const k = Math.min(1, (speed * dt) / dist);
        f.pos.x += dx * k;
        f.pos.z += dz * k;
        f.hop += dt * 10;
      }
      f.pos.y += (f.target.y - f.pos.y) * Math.min(1, dt * 8);
      // facing
      let face = dist > 0.3 ? Math.atan2(dx, dz) : playerYaw;
      if (digTarget && f.pos.distanceTo(digTarget) < 8) face = Math.atan2(digTarget.x - f.pos.x, digTarget.z - f.pos.z);
      f.yaw += angleDiff(f.yaw, face) * Math.min(1, dt * 8);
      const r = f.rig;
      r.root.position.copy(f.pos);
      r.root.rotation.y = f.yaw;
      // animation
      const moving = dist > 0.3;
      let by = r.hover ? 0.55 + Math.sin(time * 2.5 + f.phase) * 0.12 : 0;
      if (moving && !r.hover) by += Math.abs(Math.sin(f.hop)) * 0.25;
      else if (!r.hover) by += Math.sin(time * 2 + f.phase) * 0.02;
      if (f.celebrate > 0) {
        f.celebrate -= dt;
        by += Math.abs(Math.sin(f.celebrate * 9)) * 0.5;
        r.body.rotation.y = Math.sin(f.celebrate * 6) * 0.4;
      } else r.body.rotation.y = 0;
      r.body.position.y = by;
      if (f.assist > 0) {
        f.assist -= dt;
        r.head.rotation.x = Math.sin((0.35 - f.assist) / 0.35 * Math.PI) * 0.5;
      } else r.head.rotation.x = Math.sin(time * 1.3 + f.phase) * 0.05;
      // blink
      f.blink -= dt;
      const closed = f.blink < 0.12;
      if (f.blink < 0) f.blink = 2.5 + Math.random() * 3;
      for (const e of r.eyes) e.scale.y = closed ? 0.15 : 1;
      if (r.tail) r.tail.rotation.y = Math.sin(time * (moving ? 12 : 4) + f.phase) * 0.35;
      r.ears.forEach((e, k) => { e.rotation.x = Math.sin(time * 3 + f.phase + k) * 0.08; });
      r.wings.forEach((w, k) => { const s = k === 0 ? -1 : 1; w.rotation.z = s * (0.55 + Math.sin(time * (moving ? 14 : 6) + f.phase) * 0.45); });
      r.legs.forEach((l, k) => { l.rotation.x = moving ? Math.sin(f.hop + k * Math.PI) * 0.6 : 0; });
      const sp = r.body.getObjectByName('shinySparkle');
      if (sp) sp.rotation.y = time * 2;
      f.label.visible = showLabels;
    });
  }

  positions() {
    return this.list.map((f) => f.pos);
  }
}
