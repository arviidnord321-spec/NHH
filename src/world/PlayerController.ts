/**
 * Player avatar: time-based movement with acceleration, jump, gravity,
 * axis-separated AABB collision against the same voxel grid the terrain is
 * rendered from, 2D prop colliders, 1-cell step-up, vents and recovery.
 */
import * as THREE from 'three';
import { MOVE } from '../data/balance';
import { buildLanternTool, buildPickaxe, buildShovel, HumanRig } from './models';
import { buildAvatar, DEFAULT_AVATAR, type AvatarLook } from './avatar';
import { angleDiff, World } from './World';

const SUB = 0.05;

export class PlayerController {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  grounded = false;
  yaw = Math.PI; // facing −z
  rig: HumanRig;
  private toolModel: THREE.Object3D | null = null;
  private toolKey = '';
  walkPhase = 0;
  /** 0..1 progress of the current dig swing (−1 = none). */
  swing = -1;
  celebrate = 0;
  lantern: THREE.PointLight;
  lanternOn = false;
  private stepSmooth = 0;
  readonly visualPos = new THREE.Vector3();

  constructor(private world: World) {
    this.lantern = new THREE.PointLight('#ffd27a', 0, 9, 1.4);
    this.lantern.position.set(0, 2.2, 0.6);
    this.rig = this.makeRig(DEFAULT_AVATAR);
  }

  private makeRig(look: AvatarLook): HumanRig {
    const rig = buildAvatar(look);
    rig.root.scale.setScalar(MOVE.height / 2.0);
    rig.root.add(this.lantern);
    this.world.scene.add(rig.root);
    return rig;
  }

  /** Rebuild the avatar (keeps position, facing and held tool). */
  applyAvatar(look: AvatarLook, crown: boolean) {
    const old = this.rig;
    old.root.removeFromParent();
    this.rig = this.makeRig(look);
    this.rig.root.position.copy(old.root.position);
    this.rig.root.rotation.copy(old.root.rotation);
    this.rig.crown.visible = crown;
    const key = this.toolKey;
    this.toolKey = '';
    this.toolModel = null;
    if (key) this.setTool(key.replace(/\d+$/, '') as 'shovel' | 'pickaxe' | 'lantern', +(key.match(/\d+$/)?.[0] ?? 0));
  }

  setTool(kind: 'shovel' | 'pickaxe' | 'lantern', tier: number) {
    const key = `${kind}${tier}`;
    if (key === this.toolKey) return;
    this.toolKey = key;
    if (this.toolModel) this.rig.toolHolder.remove(this.toolModel);
    this.toolModel = kind === 'pickaxe' ? buildPickaxe(tier) : kind === 'lantern' ? buildLanternTool() : buildShovel(tier);
    // held low and angled toward the ground, blade forward
    this.toolModel.rotation.set(1.05, 0, -0.15);
    this.toolModel.scale.setScalar(1.25);
    this.toolModel.position.set(0.04, 0, 0.12);
    this.rig.toolHolder.add(this.toolModel);
  }

  teleport(p: THREE.Vector3, yaw?: number) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.stepSmooth = 0;
    this.visualPos.copy(p);
  }

  /** Overlap test of the player box at (x,y,z) against grid + props. */
  collides(x: number, y: number, z: number): boolean {
    const r = MOVE.radius, h = MOVE.height - 0.05;
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r - 1e-4);
    const z0 = Math.floor(z - r), z1 = Math.floor(z + r - 1e-4);
    const y0 = Math.floor(y + 1e-4), y1 = Math.floor(y + h);
    for (let iy = y0; iy <= y1; iy++) {
      if (iy >= 0) break;
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (this.world.solidAt(ix, iy, iz)) return true;
    }
    for (const c of this.world.circles) {
      if (y >= c.h) continue;
      const dx = x - c.x, dz = z - c.z;
      const rr = c.r + r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    for (const b of this.world.boxes) {
      if (!b.enabled || y >= b.h) continue;
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
    }
    return false;
  }

  update(dt: number, move: { x: number; y: number }, camYaw: number, sprint: boolean, jump: boolean, speedMul: number, facing: number | null) {
    // desired horizontal velocity relative to camera
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = -fz, rz = fx;
    let dx = rx * move.x + fx * move.y;
    let dz = rz * move.x + fz * move.y;
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }
    const speed = (sprint ? MOVE.sprint : MOVE.walk) * speedMul;
    const tx = dx * speed, tz = dz * speed;
    const accel = MOVE.accel * (this.grounded ? 1 : 0.55);
    const ax = tx - this.vel.x, az = tz - this.vel.z;
    const al = Math.hypot(ax, az);
    const maxDv = accel * dt;
    if (al > maxDv) { this.vel.x += (ax / al) * maxDv; this.vel.z += (az / al) * maxDv; }
    else { this.vel.x = tx; this.vel.z = tz; }

    if (jump && this.grounded) {
      this.vel.y = Math.sqrt(2 * MOVE.gravity * MOVE.jumpHeight);
      this.grounded = false;
    }
    this.vel.y -= MOVE.gravity * dt;
    if (this.vel.y < -30) this.vel.y = -30;

    // warm vents: gentle, readable push
    for (const v of this.world.vents) {
      const d = Math.hypot(this.pos.x - v.x, this.pos.z - v.z);
      if (d < v.r && this.pos.y < 1.5) {
        this.vel.y = Math.max(this.vel.y, 6.5);
        this.vel.x += ((this.pos.x - v.x) / (d || 1)) * 8 * dt;
        this.vel.z += ((this.pos.z - v.z) / (d || 1)) * 8 * dt;
      }
    }

    this.moveHorizontal('x', this.vel.x * dt);
    this.moveHorizontal('z', this.vel.z * dt);
    this.moveVertical(this.vel.y * dt);

    // recovery: never permanently trapped
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z) || this.pos.y < -14) return 'oob';
    if (this.collides(this.pos.x, this.pos.y, this.pos.z)) {
      // embedded (e.g. after a terrain change): nudge upward
      for (let k = 1; k <= 10; k++) if (!this.collides(this.pos.x, this.pos.y + k * 0.25, this.pos.z)) { this.pos.y += k * 0.25; break; }
    }

    // facing
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (facing !== null) this.yaw += angleDiff(this.yaw, facing) * Math.min(1, dt * 14);
    else if (hs > 0.3) this.yaw += angleDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, dt * 12);
    this.animate(dt, hs);
    return null;
  }

  private moveHorizontal(axis: 'x' | 'z', delta: number) {
    const steps = Math.ceil(Math.abs(delta) / SUB);
    if (!steps) return;
    const d = delta / steps;
    for (let i = 0; i < steps; i++) {
      const nx = axis === 'x' ? this.pos.x + d : this.pos.x;
      const nz = axis === 'z' ? this.pos.z + d : this.pos.z;
      if (!this.collides(nx, this.pos.y, nz)) { this.pos.x = nx; this.pos.z = nz; continue; }
      // step up one cell when grounded
      if (this.grounded) {
        const up = Math.ceil(this.pos.y + 0.001) + (Math.ceil(this.pos.y + 0.001) - this.pos.y < 0.05 ? 1 : 0);
        const lift = up - this.pos.y;
        if (lift > 0 && lift <= 1.05 && !this.collides(this.pos.x, up + 0.001, this.pos.z) && !this.collides(nx, up + 0.001, nz)) {
          this.stepSmooth -= lift;
          this.pos.y = up + 0.001;
          this.pos.x = nx; this.pos.z = nz;
          continue;
        }
      }
      if (axis === 'x') this.vel.x = 0; else this.vel.z = 0;
      break;
    }
  }

  private moveVertical(delta: number) {
    const steps = Math.ceil(Math.abs(delta) / SUB);
    this.grounded = false;
    if (!steps) { this.grounded = this.collides(this.pos.x, this.pos.y - 0.06, this.pos.z); return; }
    const d = delta / steps;
    for (let i = 0; i < steps; i++) {
      const ny = this.pos.y + d;
      if (!this.collides(this.pos.x, ny, this.pos.z)) { this.pos.y = ny; continue; }
      if (d < 0) {
        this.grounded = true;
        // snap onto cell tops
        const snap = Math.floor(this.pos.y + 1e-3);
        if (this.pos.y - snap < 0.06 && !this.collides(this.pos.x, snap + 0.001, this.pos.z)) this.pos.y = snap + 0.001;
      }
      this.vel.y = 0;
      break;
    }
    if (!this.grounded && this.vel.y <= 0) this.grounded = this.collides(this.pos.x, this.pos.y - 0.06, this.pos.z);
  }

  private animate(dt: number, hs: number) {
    const r = this.rig;
    this.stepSmooth += (0 - this.stepSmooth) * Math.min(1, dt * 12);
    this.visualPos.set(this.pos.x, this.pos.y + this.stepSmooth, this.pos.z);
    r.root.position.copy(this.visualPos);
    r.root.rotation.y = this.yaw;
    const moving = this.grounded && hs > 0.4;
    this.walkPhase += dt * (moving ? 2 + hs * 1.5 : 0);
    const sw = moving ? Math.sin(this.walkPhase) * Math.min(0.9, 0.25 + hs * 0.1) : 0;
    r.legL.rotation.x += (sw - r.legL.rotation.x) * Math.min(1, dt * 15);
    r.legR.rotation.x += (-sw - r.legR.rotation.x) * Math.min(1, dt * 15);
    r.body.position.y = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : 0;
    if (!this.grounded) {
      r.legL.rotation.x = -0.5; r.legR.rotation.x = 0.3;
    }
    if (this.swing >= 0) {
      // anticipation (0–0.45) → contact (0.45) → recovery
      const s = this.swing;
      let a: number;
      if (s < 0.45) a = -2.6 * easeOut(s / 0.45);
      else if (s < 0.6) a = -2.6 + 3.3 * easeIn((s - 0.45) / 0.15);
      else a = 0.7 - 0.7 * ((s - 0.6) / 0.4);
      r.armR.rotation.x = a;
      r.armL.rotation.x = a * 0.85;
      r.armR.rotation.z = 0.12;
      r.armL.rotation.z = -0.35;
      r.body.rotation.x = s > 0.45 && s < 0.7 ? 0.18 : 0.05;
    } else if (this.celebrate > 0) {
      this.celebrate -= dt;
      r.armR.rotation.x = -2.8 + Math.sin(this.celebrate * 20) * 0.3;
      r.armL.rotation.x = -2.8 - Math.sin(this.celebrate * 20) * 0.3;
      r.body.position.y = Math.abs(Math.sin(this.celebrate * 10)) * 0.25;
    } else {
      r.armR.rotation.x += (-sw * 0.8 - r.armR.rotation.x) * Math.min(1, dt * 12);
      r.armL.rotation.x += (sw * 0.8 - r.armL.rotation.x) * Math.min(1, dt * 12);
      r.armR.rotation.z += (0 - r.armR.rotation.z) * Math.min(1, dt * 10);
      r.armL.rotation.z += (0 - r.armL.rotation.z) * Math.min(1, dt * 10);
      r.body.rotation.x += (0 - r.body.rotation.x) * Math.min(1, dt * 10);
    }
    this.lantern.intensity += ((this.lanternOn ? 14 : 0) - this.lantern.intensity) * Math.min(1, dt * 8);
  }
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeIn = (t: number) => t * t;
