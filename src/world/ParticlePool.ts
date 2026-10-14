/**
 * Pooled lightweight particles: instanced chips (ballistic fragments) plus
 * point-sprite sparkles and dust. Fixed capacity per quality level; when full
 * the oldest low-priority particle is recycled so important feedback always
 * has room. No allocations in the update loop.
 */
import * as THREE from 'three';

interface Store {
  cap: number;
  alive: number;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; max: Float32Array; size: Float32Array;
  r: Float32Array; g: Float32Array; b: Float32Array;
  grav: Float32Array; prio: Uint8Array; born: Float32Array; spin: Float32Array;
}

function makeStore(cap: number): Store {
  const f = () => new Float32Array(cap);
  return {
    cap, alive: 0, px: f(), py: f(), pz: f(), vx: f(), vy: f(), vz: f(), life: f(), max: f(), size: f(),
    r: f(), g: f(), b: f(), grav: f(), prio: new Uint8Array(cap), born: f(), spin: f(),
  };
}

const tmpColor = new THREE.Color();
const dummy = new THREE.Object3D();

export class ParticlePool {
  readonly group = new THREE.Group();
  private chips!: Store;
  private sparks!: Store;
  private dust!: Store;
  private chipMesh!: THREE.InstancedMesh;
  private sparkPts!: THREE.Points;
  private dustPts!: THREE.Points;
  private time = 0;
  enabled = true;
  scale = 1;

  constructor(private budget: number) {
    this.build();
  }

  setBudget(budget: number) {
    if (budget === this.budget) return;
    this.budget = budget;
    this.group.clear();
    this.chipMesh.dispose();
    this.build();
  }

  activeCount() {
    return this.chips.alive + this.sparks.alive + this.dust.alive;
  }

  private build() {
    const chipCap = Math.floor(this.budget * 0.6);
    const sparkCap = Math.floor(this.budget * 0.25);
    const dustCap = this.budget - chipCap - sparkCap;
    this.chips = makeStore(chipCap);
    this.sparks = makeStore(sparkCap);
    this.dust = makeStore(dustCap);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.chipMesh = new THREE.InstancedMesh(geo, m, chipCap);
    this.chipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chipMesh.count = 0;
    this.chipMesh.frustumCulled = false;
    this.chipMesh.setColorAt(0, tmpColor.set(1, 1, 1));
    this.sparkPts = this.makePoints(sparkCap, true);
    this.dustPts = this.makePoints(dustCap, false);
    this.group.add(this.chipMesh, this.sparkPts, this.dustPts);
  }

  private makePoints(cap: number, additive: boolean): THREE.Points {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 } },
      vertexShader: `
        attribute vec4 color; attribute float psize; varying vec4 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = psize * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: additive
        ? `varying vec4 vC; void main(){ vec2 p = gl_PointCoord-0.5; float d = abs(p.x)+abs(p.y);
            float a = smoothstep(0.5,0.0,d) + smoothstep(0.12,0.0,length(p))*0.6; if(a<0.02) discard; gl_FragColor = vec4(vC.rgb*a, vC.a*a); }`
        : `varying vec4 vC; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.2,d); if(a<0.02) discard; gl_FragColor = vec4(vC.rgb, vC.a*a*0.75); }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    return p;
  }

  setViewportHeight(h: number) {
    for (const p of [this.sparkPts, this.dustPts]) (p.material as THREE.ShaderMaterial).uniforms.uScale.value = h * 0.5;
  }

  private alloc(s: Store, prio: number): number {
    if (s.alive < s.cap) return s.alive++;
    // recycle oldest with priority <= requested
    let best = -1, bestBorn = Infinity;
    for (let i = 0; i < s.alive; i++) {
      if (s.prio[i] <= prio && s.born[i] < bestBorn) { best = i; bestBorn = s.born[i]; }
    }
    return best;
  }

  private spawn(s: Store, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: THREE.Color, grav: number, prio: number) {
    if (!this.enabled && prio === 0) return;
    const i = this.alloc(s, prio);
    if (i < 0) return;
    s.px[i] = x; s.py[i] = y; s.pz[i] = z;
    s.vx[i] = vx; s.vy[i] = vy; s.vz[i] = vz;
    s.life[i] = life; s.max[i] = life; s.size[i] = size;
    s.r[i] = color.r; s.g[i] = color.g; s.b[i] = color.b;
    s.grav[i] = grav; s.prio[i] = prio; s.born[i] = this.time;
    s.spin[i] = (Math.random() - 0.5) * 12;
  }

  private n(count: number) {
    return Math.max(1, Math.round(count * this.scale));
  }

  /** Material-colored chips flying out from a face. */
  chipsBurst(pos: THREE.Vector3, normal: THREE.Vector3, color: THREE.Color | string, count: number, speed = 3.5, size = 0.09, prio = 0) {
    const c = typeof color === 'string' ? tmpColor.set(color) : color;
    const cc = c.clone();
    for (let k = 0, n = this.n(count); k < n; k++) {
      const vx = normal.x * speed * (0.4 + Math.random()) + (Math.random() - 0.5) * speed;
      const vy = Math.abs(normal.y) * speed * 0.6 + Math.random() * speed * 0.9 + 1;
      const vz = normal.z * speed * (0.4 + Math.random()) + (Math.random() - 0.5) * speed;
      const shade = 0.75 + Math.random() * 0.35;
      tmpColor.copy(cc).multiplyScalar(shade);
      this.spawn(this.chips, pos.x, pos.y, pos.z, vx, vy, vz, 0.35 + Math.random() * 0.35, size * (0.6 + Math.random() * 0.8), tmpColor, 16, prio);
    }
  }

  sparkle(pos: THREE.Vector3, color: string, count: number, spread = 0.6, rise = 1.5, size = 0.25, prio = 0, life = 0.6) {
    const c = new THREE.Color(color);
    for (let k = 0, n = this.n(count); k < n; k++) {
      this.spawn(this.sparks, pos.x + (Math.random() - 0.5) * spread, pos.y + (Math.random() - 0.5) * spread, pos.z + (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * 2, rise * (0.4 + Math.random()), (Math.random() - 0.5) * 2, life * (0.5 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), c, -0.5, prio);
    }
  }

  burstRing(pos: THREE.Vector3, color: string, count: number, speed = 3, size = 0.22, prio = 0) {
    const c = new THREE.Color(color);
    for (let k = 0, n = this.n(count); k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.spawn(this.sparks, pos.x, pos.y, pos.z, Math.cos(a) * speed, 0.6, Math.sin(a) * speed, 0.35, size, c, 0, prio);
    }
  }

  puff(pos: THREE.Vector3, color: string, count: number, size = 0.5) {
    const c = new THREE.Color(color);
    for (let k = 0, n = this.n(count); k < n; k++) {
      this.spawn(this.dust, pos.x + (Math.random() - 0.5) * 0.3, pos.y, pos.z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2, 0.45 + Math.random() * 0.25, size, c, -0.3, 0);
    }
  }

  update(dt: number) {
    this.time += dt;
    this.step(this.chips, dt);
    this.step(this.sparks, dt);
    this.step(this.dust, dt);
    // chips → instanced mesh
    const s = this.chips;
    for (let i = 0; i < s.alive; i++) {
      const t = s.life[i] / s.max[i];
      const sc = s.size[i] * Math.min(1, t * 3);
      dummy.position.set(s.px[i], s.py[i], s.pz[i]);
      const rot = (s.max[i] - s.life[i]) * s.spin[i];
      dummy.rotation.set(rot, rot * 0.7, 0);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      this.chipMesh.setMatrixAt(i, dummy.matrix);
      this.chipMesh.setColorAt(i, tmpColor.setRGB(s.r[i], s.g[i], s.b[i]));
    }
    this.chipMesh.count = s.alive;
    this.chipMesh.instanceMatrix.needsUpdate = true;
    if (this.chipMesh.instanceColor) this.chipMesh.instanceColor.needsUpdate = true;
    this.writePoints(this.sparks, this.sparkPts);
    this.writePoints(this.dust, this.dustPts);
  }

  private writePoints(s: Store, pts: THREE.Points) {
    const g = pts.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const sz = g.getAttribute('psize') as THREE.BufferAttribute;
    const pa = pos.array as Float32Array, ca = col.array as Float32Array, sa = sz.array as Float32Array;
    for (let i = 0; i < s.alive; i++) {
      pa[i * 3] = s.px[i]; pa[i * 3 + 1] = s.py[i]; pa[i * 3 + 2] = s.pz[i];
      const t = s.life[i] / s.max[i];
      ca[i * 4] = s.r[i]; ca[i * 4 + 1] = s.g[i]; ca[i * 4 + 2] = s.b[i]; ca[i * 4 + 3] = Math.min(1, t * 2.2);
      sa[i] = s.size[i] * (0.5 + 0.5 * Math.min(1, (1 - t) * 6));
    }
    g.setDrawRange(0, s.alive);
    pos.needsUpdate = true; col.needsUpdate = true; sz.needsUpdate = true;
  }

  private step(s: Store, dt: number) {
    let i = 0;
    while (i < s.alive) {
      s.life[i] -= dt;
      if (s.life[i] <= 0) {
        const last = --s.alive;
        if (i !== last) this.move(s, last, i);
        continue;
      }
      s.vy[i] -= s.grav[i] * dt;
      s.px[i] += s.vx[i] * dt;
      s.py[i] += s.vy[i] * dt;
      s.pz[i] += s.vz[i] * dt;
      const drag = 1 - Math.min(1, dt * 1.5);
      s.vx[i] *= drag; s.vz[i] *= drag;
      i++;
    }
  }

  private move(s: Store, from: number, to: number) {
    s.px[to] = s.px[from]; s.py[to] = s.py[from]; s.pz[to] = s.pz[from];
    s.vx[to] = s.vx[from]; s.vy[to] = s.vy[from]; s.vz[to] = s.vz[from];
    s.life[to] = s.life[from]; s.max[to] = s.max[from]; s.size[to] = s.size[from];
    s.r[to] = s.r[from]; s.g[to] = s.g[from]; s.b[to] = s.b[from];
    s.grav[to] = s.grav[from]; s.prio[to] = s.prio[from]; s.born[to] = s.born[from]; s.spin[to] = s.spin[from];
  }
}
