/**
 * Third-person orbit camera (~7 m behind, ~4 m above), bounded zoom, collision
 * avoidance against voxels and props, instant pull-in, smooth recovery.
 */
import * as THREE from 'three';
import { World } from './World';

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0; // camera sits at +z of target when yaw = 0
  pitch = 0.44;
  distance = Math.hypot(7, 4);
  private current = Math.hypot(7, 4);
  private target = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();
  shake = 0;
  /** set when a scroll changed the view mode (consumed by the game) */
  zoomedIn = false;
  zoomedOut = false;
  private autoPitch = 0.44;
  /** true when the camera is so close the avatar should be hidden */
  tooClose = false;
  shakeEnabled = true;
  readonly minDist = 3.5;
  /** first-person view from the avatar's eyes */
  firstPerson = false;
  private fpYawFix = 0;
  readonly maxDist = 13;

  constructor(private world: World, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 500);
  }

  snap(p: THREE.Vector3) {
    this.target.set(p.x, p.y + 1.5, p.z);
    this.current = this.distance;
    this.apply(0, true);
  }

  /** Switch views; returns the new mode. */
  setFirstPerson(on: boolean) {
    if (on === this.firstPerson) return on;
    this.firstPerson = on;
    this.pitch = on ? 0.18 : 0.44;
    this.autoPitch = this.pitch;
    if (!on) this.distance = Math.max(this.distance, this.minDist + 1.5);
    void this.fpYawFix;
    return on;
  }

  /** base field of view in first person (wide so more of the world is visible) */
  baseFov = 85;
  private fovKick = 0;
  private bobT = 0;
  private bobAmt = 0;
  private landDip = 0;
  private wasGrounded = true;
  private punch = 0;

  /** Per-frame first-person feel: walk bob, sprint FOV kick, landing dip. */
  feel(dt: number, speed: number, sprinting: boolean, grounded: boolean, reduced: boolean) {
    const moving = grounded && speed > 0.5;
    this.bobAmt += ((moving && !reduced ? Math.min(1, speed / 6) : 0) - this.bobAmt) * Math.min(1, dt * 8);
    this.bobT += dt * (5.5 + speed * 0.9);
    if (grounded && !this.wasGrounded && !reduced) this.landDip = 0.12;
    this.wasGrounded = grounded;
    this.landDip = Math.max(0, this.landDip - dt * 0.6);
    const kick = sprinting && moving && !reduced ? 7 : 0;
    this.fovKick += (kick - this.fovKick) * Math.min(1, dt * 6);
    const fov = this.baseFov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
  /** small view punch on dig contact */
  addPunch(a: number) { if (this.shakeEnabled) this.punch = Math.min(0.06, this.punch + a); }

  update(dt: number, player: THREE.Vector3, lookDx: number, lookDy: number, zoom: number) {
    this.yaw -= lookDx * 0.006;
    if (this.firstPerson) {
      void zoom;
      this.pitch = Math.min(1.45, Math.max(-1.45, this.pitch + lookDy * 0.005));
      const cam = this.camera;
      const bob = Math.sin(this.bobT * 2) * 0.045 * this.bobAmt;
      const sway = Math.cos(this.bobT) * 0.03 * this.bobAmt;
      this.punch = Math.max(0, this.punch - dt * 0.4);
      cam.position.set(player.x + Math.cos(this.yaw) * sway, player.y + 1.82 + bob - this.landDip * 0.5, player.z - Math.sin(this.yaw) * sway);
      const pitch = this.pitch + this.punch;
      const cp = Math.cos(pitch);
      this.dir.set(-Math.sin(this.yaw) * cp, -Math.sin(pitch), -Math.cos(this.yaw) * cp);
      cam.lookAt(cam.position.x + this.dir.x, cam.position.y + this.dir.y, cam.position.z + this.dir.z);
      this.tooClose = true;
      this.target.set(player.x, player.y + 1.5, player.z);
      return;
    }
    this.pitch = Math.min(1.25, Math.max(0.05, this.pitch + lookDy * 0.005));
    if (zoom < 0 && this.distance <= this.minDist + 0.01) { this.setFirstPerson(true); this.zoomedIn = true; return; }
    if (zoom) this.distance = Math.min(this.maxDist, Math.max(this.minDist, this.distance + zoom * 0.8));
    const ty = player.y + 1.5;
    this.target.x = player.x;
    this.target.z = player.z;
    this.target.y += (ty - this.target.y) * Math.min(1, dt * 10);
    this.apply(dt, false);
  }

  /** Unobstructed camera distance along a pitch (voxel ray + props). */
  private clearance(pitch: number): number {
    this.dir.set(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
    let allowed = this.distance;
    const hit = this.world.raycast(this.target, this.dir, this.distance + 0.4);
    if (hit) allowed = Math.min(allowed, Math.max(0.5, hit.dist - 0.35));
    const far = this.tmp.copy(this.target).addScaledVector(this.dir, this.distance);
    const t = this.world.propBlocks(this.target, far);
    if (t < 1) allowed = Math.min(allowed, Math.max(0.5, this.distance * t - 0.35));
    return allowed;
  }

  private apply(dt: number, instant: boolean) {
    // In pits the view tilts up to look down into the hole instead of
    // clipping into the avatar; recovers smoothly once clear.
    let pitch = this.pitch;
    let allowed = this.clearance(pitch);
    if (allowed < Math.min(4, this.distance)) {
      for (let p = pitch + 0.15; p <= 1.4; p += 0.15) {
        const a = this.clearance(p);
        if (a > allowed + 0.4) { allowed = a; pitch = p; }
        if (a >= Math.min(6.5, this.distance)) break;
      }
    }
    this.autoPitch += (pitch - this.autoPitch) * (instant ? 1 : Math.min(1, dt * 6));
    allowed = this.clearance(this.autoPitch);
    if (instant || allowed < this.current) this.current = allowed;
    else this.current += (allowed - this.current) * Math.min(1, dt * 3);
    const cam = this.camera;
    cam.position.copy(this.target).addScaledVector(this.dir, this.current);
    this.tooClose = this.current < 1.3;
    if (this.shake > 0 && this.shakeEnabled) {
      this.shake = Math.max(0, this.shake - dt);
      const s = this.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.target);
  }

  addShake(amount: number) {
    if (this.shakeEnabled) this.shake = Math.min(0.3, this.shake + amount);
  }
}
