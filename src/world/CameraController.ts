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

  update(dt: number, player: THREE.Vector3, lookDx: number, lookDy: number, zoom: number) {
    this.yaw -= lookDx * 0.006;
    if (this.firstPerson) {
      this.pitch = Math.min(1.4, Math.max(-1.35, this.pitch + lookDy * 0.005));
      if (zoom > 0) { this.setFirstPerson(false); this.zoomedOut = true; }
      const cam = this.camera;
      cam.position.set(player.x, player.y + 1.86, player.z);
      const cp = Math.cos(this.pitch);
      this.dir.set(-Math.sin(this.yaw) * cp, -Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
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
