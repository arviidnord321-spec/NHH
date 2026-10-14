/**
 * Showcase: a small secondary WebGL renderer used for
 *  (1) real 3D thumbnails of pets and eggs for the UI (rendered once, cached), and
 *  (2) the 3D hatch sequence: anticipation → rocking → cracks → shell
 *      separation → reveal with rarity-colored rays.
 * The hatch result is always resolved BEFORE this plays; this is purely visual.
 */
import * as THREE from 'three';
import { buildEgg, buildPet, EggRig, PetRig } from '../world/models';
import { buildAvatar, type AvatarLook } from '../world/avatar';

export interface HatchOptions { fast: boolean; reduced: boolean }
export type HatchPhase = 'anticipation' | 'rocking' | 'cracks' | 'separate' | 'reveal' | 'done';

export class Showcase {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private iconCache = new Map<string, string>();
  private stage = new THREE.Group();
  private rays: THREE.Mesh;
  private raysMat: THREE.ShaderMaterial;
  private running = false;
  private raf = 0;
  private host: HTMLElement | null = null;
  private pieces: { m: THREE.Mesh; v: THREE.Vector3; s: THREE.Vector3 }[] = [];
  private pieceGeo = new THREE.TetrahedronGeometry(0.09, 0);

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8a7060', 1.7));
    const key = new THREE.DirectionalLight('#fff4dc', 2.4);
    key.position.set(2.5, 4, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#9fe8ff', 1.2);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);
    this.scene.add(this.stage);
    this.raysMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#ffbd38') }, uAlpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
        void main(){ vec2 p = vUv-0.5; float a = atan(p.y,p.x); float r = length(p)*2.0;
          float rays = smoothstep(0.55,1.0, sin(a*9.0+uTime*0.8)*0.5+0.5);
          float glow = smoothstep(1.0,0.0,r);
          float v = (rays*0.7+0.35)*glow*glow;
          gl_FragColor = vec4(uColor*v*1.4, v*uAlpha); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), this.raysMat);
    this.rays.position.set(0, 0.9, -1.5);
    this.scene.add(this.rays);
  }

  // ───────── icons ─────────
  icon(kind: 'pet' | 'egg', id: string, shiny = false, size = 160): string {
    const key = `${kind}:${id}:${shiny}:${size}`;
    const hit = this.iconCache.get(key);
    if (hit) return hit;
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevStage = [...this.stage.children];
    this.stage.clear();
    this.rays.visible = false;
    this.renderer.setSize(size, size, false);
    this.cam.aspect = 1;
    let obj: THREE.Object3D;
    if (kind === 'pet') {
      const rig = buildPet(id, shiny);
      obj = rig.root;
      const h = rig.height;
      obj.rotation.y = 0.55;
      this.cam.fov = 30;
      this.cam.position.set(0, h * 0.75 + 0.6, h * 1.9 + 2.0);
      this.cam.lookAt(0, h * 0.48, 0);
    } else {
      const rig = buildEgg(id, false);
      obj = rig.root;
      obj.rotation.y = 0.35;
      this.cam.fov = 30;
      this.cam.position.set(0, 1.4, 4.1);
      this.cam.lookAt(0, 0.68, 0);
    }
    this.cam.updateProjectionMatrix();
    this.stage.add(obj);
    this.renderer.render(this.scene, this.cam);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.stage.clear();
    for (const c of prevStage) this.stage.add(c);
    this.rays.visible = true;
    this.renderer.setSize(prevSize.x || size, prevSize.y || size, false);
    this.iconCache.set(key, url);
    return url;
  }

  /** Generic 3D icon for any model (tools, coins, gems, chests). */
  iconOf(key: string, build: () => THREE.Object3D, dist = 3.2, lookY = 0.4, size = 128, rotY = 0.6, rotX = 0): string {
    const hit = this.iconCache.get(key);
    if (hit) return hit;
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevStage = [...this.stage.children];
    this.stage.clear();
    this.rays.visible = false;
    this.renderer.setSize(size, size, false);
    const obj = build();
    obj.rotation.y = rotY;
    obj.rotation.x = rotX;
    this.stage.add(obj);
    this.cam.aspect = 1;
    this.cam.fov = 30;
    this.cam.position.set(0, lookY + dist * 0.3, dist);
    this.cam.lookAt(0, lookY, 0);
    this.cam.updateProjectionMatrix();
    this.renderer.render(this.scene, this.cam);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.stage.clear();
    for (const c of prevStage) this.stage.add(c);
    this.rays.visible = true;
    this.renderer.setSize(prevSize.x || size, prevSize.y || size, false);
    this.iconCache.set(key, url);
    return url;
  }

  // ───────── avatar preview (live, drag to spin) ─────────
  private pv: { host: HTMLElement; key: string; obj: THREE.Object3D | null; yaw: number; spin: number; raf: number; drag: number | null } | null = null;

  attachPreview(host: HTMLElement, look: AvatarLook, crown: boolean) {
    const key = JSON.stringify(look) + crown;
    if (!this.pv) {
      this.pv = { host, key: '', obj: null, yaw: 0.45, spin: 0, raf: 0, drag: null };
      const loop = () => {
        const pv = this.pv;
        if (!pv) return;
        if (pv.drag === null) pv.yaw += 0.004 + pv.spin;
        pv.spin *= 0.92;
        if (pv.obj) pv.obj.rotation.y = pv.yaw;
        this.renderer.render(this.scene, this.cam);
        pv.raf = requestAnimationFrame(loop);
      };
      this.pv.raf = requestAnimationFrame(loop);
    }
    const pv = this.pv;
    if (pv.host !== host || !host.contains(this.renderer.domElement)) {
      pv.host = host;
      host.appendChild(this.renderer.domElement);
      host.onpointerdown = (e) => { pv.drag = e.clientX; host.setPointerCapture(e.pointerId); };
      host.onpointermove = (e) => { if (pv.drag !== null) { pv.yaw += (e.clientX - pv.drag) * 0.012; pv.drag = e.clientX; } };
      host.onpointerup = host.onpointercancel = () => { pv.drag = null; };
    }
    const w = host.clientWidth || 300, h = host.clientHeight || 380;
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.cam.aspect = w / h;
    this.cam.fov = 30;
    this.cam.position.set(0, 1.25, 5.6);
    this.cam.lookAt(0, 1.02, 0);
    this.cam.updateProjectionMatrix();
    this.rays.visible = false;
    if (pv.key !== key) {
      pv.key = key;
      if (pv.obj) this.stage.remove(pv.obj);
      const rig = buildAvatar(look);
      rig.crown.visible = crown;
      rig.root.rotation.y = pv.yaw;
      pv.obj = rig.root;
      this.stage.clear();
      this.stage.add(rig.root);
    }
  }

  detachPreview() {
    if (!this.pv) return;
    cancelAnimationFrame(this.pv.raf);
    this.stage.clear();
    this.renderer.domElement.remove();
    this.rays.visible = true;
    this.pv = null;
  }

  // ───────── hatch ─────────
  mount(host: HTMLElement) {
    this.host = host;
    host.appendChild(this.renderer.domElement);
    this.resize();
  }

  resize() {
    if (!this.host) return;
    const w = this.host.clientWidth || 400, h = this.host.clientHeight || 400;
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.cam.aspect = w / h;
    this.cam.fov = 34;
    this.cam.position.set(0, 1.5, 5.2);
    this.cam.lookAt(0, 0.85, 0);
    this.cam.updateProjectionMatrix();
  }

  /**
   * Play the hatch animation. Calls onPhase as phases begin; resolves once
   * the pet is revealed. The pet then idles until stop() is called.
   */
  playHatch(eggId: string, petEntry: string, shiny: boolean, rarityColor: string, o: HatchOptions, onPhase: (p: HatchPhase) => void): Promise<void> {
    this.stop();
    this.stage.clear();
    this.clearPieces();
    const egg: EggRig = buildEgg(eggId);
    egg.root.position.y = 0.15;
    this.stage.add(egg.root);
    const pet: PetRig = buildPet(petEntry, shiny);
    pet.root.visible = false;
    pet.root.position.y = 0.1;
    this.stage.add(pet.root);
    this.raysMat.uniforms.uColor.value.set(rarityColor);
    this.raysMat.uniforms.uAlpha.value = 0;
    const scale = o.fast ? 0.6 / 2.2 : 1;
    const T = { a: 0.4 * scale, r: 0.6 * scale, c: 0.2 * scale, s: 0.3 * scale, v: 0.7 * scale };
    const t1 = T.a, t2 = t1 + T.r, t3 = t2 + T.c, t4 = t3 + T.s, t5 = t4 + T.v;
    let t = 0;
    let phase: HatchPhase | null = null;
    let last = performance.now();
    this.running = true;
    return new Promise((resolve) => {
      let resolved = false;
      const tick = () => {
        if (!this.running) return;
        const now = performance.now();
        const dt = Math.min(0.25, (now - last) / 1000);
        last = now;
        t += dt;
        const set = (p: HatchPhase) => { if (phase !== p) { phase = p; onPhase(p); } };
        const e = egg.egg;
        if (t < t1) {
          set('anticipation');
          const k = t / t1;
          e.scale.set(1 + Math.sin(k * Math.PI) * 0.08, 1 - Math.sin(k * Math.PI) * 0.1, 1 + Math.sin(k * Math.PI) * 0.08);
        } else if (t < t2) {
          set('rocking');
          const k = (t - t1) / T.r;
          e.scale.set(1, 1, 1);
          e.rotation.z = o.reduced ? 0 : Math.sin(k * Math.PI * 4) * 0.22 * (0.5 + k);
          e.position.x = o.reduced ? 0 : Math.sin(k * Math.PI * 4) * 0.05;
        } else if (t < t3) {
          set('cracks');
          e.rotation.z = 0;
          e.position.x = 0;
          egg.cracks.visible = true;
          e.scale.setScalar(1 + ((t - t2) / T.c) * 0.05);
        } else if (t < t4) {
          if (phase !== 'separate') this.spawnPieces(eggId);
          set('separate');
          const k = (t - t3) / T.s;
          egg.top.position.set(-k * 0.6, k * 1.4, 0);
          egg.top.rotation.z = k * 0.9;
          egg.bottom.position.y = -k * 0.25;
          egg.cracks.visible = false;
          pet.root.visible = true;
          pet.root.scale.setScalar(0.3 + k * 0.5);
          this.raysMat.uniforms.uAlpha.value = k;
        } else if (t < t5) {
          set('reveal');
          const k = (t - t4) / T.v;
          egg.root.visible = k < 0.4;
          egg.root.scale.setScalar(Math.max(0.01, 1 - k * 2.5));
          const pop = o.reduced ? 1 : 1 + Math.sin(Math.min(1, k * 1.4) * Math.PI) * 0.15;
          pet.root.scale.setScalar(Math.min(1, 0.8 + k * 0.4) * pop);
          pet.root.position.y = 0.1 + (o.reduced ? 0 : Math.sin(k * Math.PI) * 0.35);
          this.raysMat.uniforms.uAlpha.value = 1;
        } else {
          if (!resolved) { resolved = true; set('done'); resolve(); }
          egg.root.visible = false;
          pet.root.scale.setScalar(1);
          pet.root.position.y = 0.1 + Math.sin(t * 2) * 0.04;
          pet.root.rotation.y = o.reduced ? 0.5 : Math.sin(t * 0.7) * 0.6;
          for (const w of pet.wings) w.rotation.z = (w.position.x < 0 ? -1 : 1) * (0.55 + Math.sin(t * 7) * 0.4);
          if (pet.tail) pet.tail.rotation.y = Math.sin(t * 6) * 0.3;
        }
        this.raysMat.uniforms.uTime.value = o.reduced ? 0 : t;
        this.updatePieces(dt);
        this.renderer.render(this.scene, this.cam);
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  private spawnPieces(eggId: string) {
    const color = eggId === 'geode' ? '#5a34b0' : eggId === 'ember' ? '#2b2629' : eggId === 'aurora' ? '#14243d' : '#fff0d0';
    const m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6 });
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(this.pieceGeo, m);
      mesh.position.set((Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4);
      this.scene.add(mesh);
      this.pieces.push({ m: mesh, v: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 2.5, (Math.random() - 0.2) * 3), s: new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0) });
    }
  }
  private updatePieces(dt: number) {
    for (const p of this.pieces) {
      p.v.y -= 9 * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += p.s.x * dt;
      p.m.rotation.y += p.s.y * dt;
      if (p.m.position.y < 0) { p.m.position.y = 0; p.v.multiplyScalar(0.4); p.v.y = Math.abs(p.v.y) * 0.3; }
    }
  }
  private clearPieces() {
    for (const p of this.pieces) this.scene.remove(p.m);
    this.pieces = [];
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  unmount() {
    this.stop();
    this.clearPieces();
    this.stage.clear();
    this.renderer.domElement.remove();
    this.host = null;
  }
}
