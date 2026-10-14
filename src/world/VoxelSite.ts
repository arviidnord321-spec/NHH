/**
 * A localized destructible excavation patch (12×12×8 one-metre cells).
 * Only exposed faces are meshed; the whole patch is a single chunk that is
 * rebuilt only when dirty. Collision queries use the same cell data, so what
 * you see is what you collide with.
 */
import * as THREE from 'three';
import { BiomeId, MATERIALS, SITE } from '../data/balance';
import { b64ToBitset, bitsetToB64, SiteState } from '../core/state';
import { BITSET_BYTES, cellIndex, cellXYZ, EMPTY, generateSite, inGrid, NEIGHBORS, SiteLayout, TreasureSpec } from '../core/site';
import { buildChest } from './models';

const MAT_COLORS = MATERIALS.map((m) => new THREE.Color(m.color));
const GLOW = MATERIALS.map((m) => !!m.emissive);
const BOUNDARY_COLOR = new THREE.Color('#5a3d2a');
const BEDROCK_INDEX = MATERIALS.findIndex((m) => m.id === 'bedrock');
const TURF = MATERIALS.map((m) => m.id.endsWith('_turf'));
const TURF_SIDE = new THREE.Color('#9a5f34');

let bevelTex: THREE.Texture | null = null;
export function blockTexture(): THREE.Texture {
  if (bevelTex) return bevelTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  // speckle
  for (let i = 0; i < 140; i++) {
    const v = 225 + Math.floor(Math.random() * 30);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 3, 3);
  }
  // bevel: light top/left, dark bottom/right
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.fillRect(0, 0, 64, 3);
  g.fillRect(0, 0, 3, 64);
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.fillRect(0, 61, 64, 3);
  g.fillRect(61, 0, 3, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  bevelTex = t;
  return t;
}

// face definitions: normal, 4 corner offsets (CCW from outside)
const FACES: { n: [number, number, number]; c: [number, number, number][]; shade: number }[] = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.82 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.78 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.6 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.9 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.74 },
];
const UVS = [0, 0, 1, 0, 1, 1, 0, 1];

export class VoxelSite {
  readonly id: string;
  readonly biome: BiomeId;
  readonly index: number;
  readonly ox: number;
  readonly oy = -SITE.h;
  readonly oz: number;
  layout!: SiteLayout;
  mined: Uint8Array = new Uint8Array(BITSET_BYTES);
  damage = new Map<number, number>();
  claimed = new Set<number>();
  treasureByCell = new Map<number, TreasureSpec>();
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private glowMesh: THREE.Mesh;
  private treasureModels = new Map<number, THREE.Group>();
  dirty = true;

  constructor(biome: BiomeId, index: number, ox: number, oz: number, lambert: THREE.Material, glowMat: THREE.Material) {
    this.id = `${biome}_${index}`;
    this.biome = biome;
    this.index = index;
    this.ox = ox;
    this.oz = oz;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), lambert);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.glowMesh = new THREE.Mesh(new THREE.BufferGeometry(), glowMat);
    this.group.add(this.mesh, this.glowMesh);
  }

  load(state: SiteState | undefined, defaultSeed: number) {
    const seed = state?.seed ?? defaultSeed;
    this.layout = generateSite(this.biome, this.index, seed);
    this.mined = b64ToBitset(state?.mined ?? '', BITSET_BYTES);
    this.claimed = new Set(state?.claimed ?? []);
    this.damage = new Map((state?.damage ?? []).filter(([i]) => i < this.layout.mats.length));
    this.treasureByCell.clear();
    for (const t of this.layout.treasures) this.treasureByCell.set(t.cell, t);
    for (const m of this.treasureModels.values()) this.group.remove(m);
    this.treasureModels.clear();
    this.dirty = true;
  }

  toState(): SiteState {
    return {
      seed: this.layout.seed,
      mined: bitsetToB64(this.mined),
      claimed: [...this.claimed],
      damage: [...this.damage.entries()].slice(0, 64),
    };
  }

  isTouched(): boolean {
    return this.mined.some((b) => b !== 0) || this.claimed.size > 0 || this.damage.size > 0;
  }

  isMined(i: number) { return (this.mined[i >> 3] & (1 << (i & 7))) !== 0; }
  setMined(i: number) { this.mined[i >> 3] |= 1 << (i & 7); }

  treasureClaimed(t: TreasureSpec) { return this.claimed.has(t.index); }

  /** Cell occupied (collision): material present, not mined, and not a claimed treasure. */
  isSolid(i: number): boolean {
    if (this.layout.mats[i] === EMPTY || this.isMined(i)) return false;
    const t = this.treasureByCell.get(i);
    if (t && this.claimed.has(t.index)) return false;
    return true;
  }

  isSolidLocal(x: number, y: number, z: number): boolean {
    if (y >= SITE.h) return false;
    if (!inGrid(x, y, z)) return true; // walls / bedrock beyond the patch
    return this.isSolid(cellIndex(x, y, z));
  }

  /** A treasure is exposed when any face touches open air. */
  isExposed(i: number): boolean {
    const [x, y, z] = cellXYZ(i);
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (ny >= SITE.h) return true;
      if (!inGrid(nx, ny, nz)) continue;
      if (!this.isSolid(cellIndex(nx, ny, nz))) return true;
    }
    return false;
  }

  /** Rendered as a block (hidden treasures look like ordinary ground). */
  private renderSolid(i: number): boolean {
    if (!this.isSolid(i)) return false;
    const t = this.treasureByCell.get(i);
    if (t && this.isExposed(i)) return false;
    return true;
  }

  worldCellCenter(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const [x, y, z] = cellXYZ(i);
    return out.set(this.ox + x + 0.5, this.oy + y + 0.5, this.oz + z + 0.5);
  }

  materialIndex(i: number) { return this.layout.mats[i]; }

  rebuild() {
    if (!this.dirty) return;
    this.dirty = false;
    const P: number[] = [], N: number[] = [], C: number[] = [], U: number[] = [], I: number[] = [];
    const GP: number[] = [], GN: number[] = [], GC: number[] = [], GU: number[] = [], GI: number[] = [];
    const col = new THREE.Color();
    const colB = new THREE.Color();
    const pushQuad = (glow: boolean, x: number, y: number, z: number, f: typeof FACES[number], c: THREE.Color, y0: number, y1: number) => {
      const p = glow ? GP : P, n = glow ? GN : N, cc = glow ? GC : C, u = glow ? GU : U, ii = glow ? GI : I;
      const base = p.length / 3;
      for (let k = 0; k < 4; k++) {
        const o = f.c[k];
        const oy = f.n[1] === 0 ? (o[1] === 0 ? y0 : y1) : o[1];
        p.push(x + o[0], y + oy, z + o[2]);
        n.push(f.n[0], f.n[1], f.n[2]);
        cc.push(c.r, c.g, c.b);
        u.push(UVS[k * 2], f.n[1] === 0 ? oy : UVS[k * 2 + 1]);
      }
      ii.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const pushFace = (glow: boolean, x: number, y: number, z: number, f: typeof FACES[number], c: THREE.Color, cBottom?: THREE.Color) => {
      if (cBottom) {
        // grass cap strip over a dirt side
        pushQuad(glow, x, y, z, f, c, 0.74, 1);
        pushQuad(glow, x, y, z, f, cBottom, 0, 0.74);
      } else pushQuad(glow, x, y, z, f, c, 0, 1);
    };
    const W = SITE.w, D = SITE.d, H = SITE.h;
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
          const i = cellIndex(x, y, z);
          const solid = this.renderSolid(i);
          if (solid) {
            const mi = this.layout.mats[i];
            const glow = GLOW[mi];
            const noise = 0.94 + (((i * 2654435761) >>> 0) % 1000) / 1000 * 0.12;
            const depthDark = 0.78 + (y / H) * 0.22;
            for (const f of FACES) {
              const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
              let open: boolean;
              if (ny >= H) open = true;
              else if (!inGrid(nx, ny, nz)) open = false;
              else open = !this.renderSolid(cellIndex(nx, ny, nz));
              if (!open) continue;
              col.copy(MAT_COLORS[mi]).multiplyScalar((glow ? 1.1 : f.shade * depthDark) * noise);
              // grass blocks: green cap fading into dirt down the sides
              if (TURF[mi] && f.n[1] === 0) {
                colB.copy(TURF_SIDE).multiplyScalar(f.shade * depthDark * noise);
                pushFace(glow, x, y, z, f, col, colB);
              } else pushFace(glow, x, y, z, f, col);
            }
          } else {
            // empty cell: draw walls of the surrounding boundary (outside the grid)
            for (const f of FACES) {
              const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
              if (ny >= H || inGrid(nx, ny, nz)) continue;
              // inward-facing face on the neighbor block: flip normal by placing on neighbor
              const nf = FACES.find((g) => g.n[0] === -f.n[0] && g.n[1] === -f.n[1] && g.n[2] === -f.n[2])!;
              const isFloor = f.n[1] === -1;
              col.copy(isFloor ? MAT_COLORS[BEDROCK_INDEX] : BOUNDARY_COLOR).multiplyScalar(nf.shade * (0.8 + (y / H) * 0.25));
              pushFace(false, nx, ny, nz, nf, col);
            }
          }
        }
      }
    }
    setGeo(this.mesh, P, N, C, U, I);
    setGeo(this.glowMesh, GP, GN, GC, GU, GI);
    this.mesh.position.set(this.ox, this.oy, this.oz);
    this.glowMesh.position.set(this.ox, this.oy, this.oz);
    this.syncTreasureModels();
  }

  private syncTreasureModels() {
    for (const t of this.layout.treasures) {
      const show = !this.claimed.has(t.index) && this.isSolid(t.cell) && this.isExposed(t.cell);
      let m = this.treasureModels.get(t.index);
      if (show && !m) {
        m = buildChest(t.kind);
        const c = this.worldCellCenter(t.cell);
        m.position.set(c.x, c.y - 0.5, c.z);
        m.userData.baseY = c.y - 0.5;
        this.group.add(m);
        this.treasureModels.set(t.index, m);
      } else if (!show && m) {
        this.group.remove(m);
        this.treasureModels.delete(t.index);
      }
    }
  }

  animateTreasures(time: number) {
    for (const m of this.treasureModels.values()) {
      m.rotation.y = time * 0.8;
      m.position.y = m.userData.baseY + 0.05 + Math.sin(time * 2.5) * 0.05;
    }
  }

  treasureModel(index: number) { return this.treasureModels.get(index); }
}

function setGeo(mesh: THREE.Mesh, P: number[], N: number[], C: number[], U: number[], I: number[]) {
  const g = mesh.geometry as THREE.BufferGeometry;
  g.dispose();
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  ng.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  ng.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  ng.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  ng.setIndex(I);
  ng.computeBoundingSphere();
  mesh.geometry = ng;
  mesh.visible = I.length > 0;
}
