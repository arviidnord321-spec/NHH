/** Deterministic excavation-site generation (pure, seed-only). */
import { BIOMES, BiomeId, MATERIAL_INDEX, SITE, TREASURE_WEIGHTS, TreasureKind } from '../data/balance';
import { mulberry32, pickWeighted, randInt } from './rng';

export const EMPTY = 255;
export const CELL_COUNT = SITE.w * SITE.d * SITE.h;
export const BITSET_BYTES = Math.ceil(CELL_COUNT / 8);

export interface TreasureSpec {
  index: number;
  kind: TreasureKind;
  cell: number;
  /** relic fragment id when kind === 'relic' */
  relic?: string;
}

export interface SiteLayout {
  biome: BiomeId;
  siteIndex: number;
  seed: number;
  mats: Uint8Array;
  treasures: TreasureSpec[];
}

export const cellIndex = (x: number, y: number, z: number) => x + z * SITE.w + y * SITE.w * SITE.d;
export const cellXYZ = (i: number): [number, number, number] => {
  const x = i % SITE.w;
  const z = Math.floor(i / SITE.w) % SITE.d;
  const y = Math.floor(i / (SITE.w * SITE.d));
  return [x, y, z];
};
export const inGrid = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < SITE.w && y < SITE.h && z < SITE.d;

export function depthCategory(y: number): 'shallow' | 'below' | 'deep' {
  const depth = SITE.h - 1 - y;
  if (depth <= 2) return 'shallow';
  if (depth <= 4) return 'below';
  return 'deep';
}

export function generateSite(biome: BiomeId, siteIndex: number, seed: number): SiteLayout {
  const rng = mulberry32(seed ^ (siteIndex * 0x85ebca6b));
  const L = BIOMES[biome].layers;
  const mats = new Uint8Array(CELL_COUNT);
  const M = (id: string) => MATERIAL_INDEX[id];
  const bedrock = M('bedrock');

  for (let y = 0; y < SITE.h; y++) {
    for (let z = 0; z < SITE.d; z++) {
      for (let x = 0; x < SITE.w; x++) {
        let id: string;
        if (y === 0) { mats[cellIndex(x, y, z)] = bedrock; continue; }
        if (y === 7) id = L.top;
        else if (y >= 5) id = L.upper;
        else if (y >= 3) id = L.mid;
        else id = L.deep;
        if (y <= 5 && y > 0) {
          const r = rng();
          if (y <= 3 && r < 0.045) id = L.rare;
          else if (r < 0.12) id = L.node;
        }
        mats[cellIndex(x, y, z)] = M(id);
      }
    }
  }

  // Biome-specific arrangement so exploration differs, not just colors.
  if (biome === 'crystal') {
    const cx = randInt(rng, 4, 7), cy = randInt(rng, 3, 4), cz = randInt(rng, 4, 7), r = 2.3;
    for (let i = 0; i < CELL_COUNT; i++) {
      const [x, y, z] = cellXYZ(i);
      if (y === 0) continue;
      const d = Math.hypot(x - cx, (y - cy) * 1.2, z - cz);
      if (d < r) mats[i] = EMPTY;
      else if (d < r + 1.05 && mats[i] !== EMPTY) mats[i] = rng() < 0.15 ? M(L.rare) : M(L.node);
    }
  } else if (biome === 'ember') {
    const axis = rng() < 0.5 ? 'x' : 'z';
    const flip = rng() < 0.5;
    for (let i = 0; i < CELL_COUNT; i++) {
      const [x, y, z] = cellXYZ(i);
      let c = axis === 'x' ? x : z;
      if (flip) c = SITE.w - 1 - c;
      const cut = Math.floor(c / 4); // 0,1,2 terraces
      if (y > SITE.h - 1 - cut) mats[i] = EMPTY;
      else if (y === SITE.h - 1 - cut && cut > 0) mats[i] = M(L.top);
    }
  } else if (biome === 'aurora') {
    const pillars = randInt(rng, 4, 6);
    for (let p = 0; p < pillars; p++) {
      const px = randInt(rng, 1, SITE.w - 2), pz = randInt(rng, 1, SITE.d - 2);
      for (let y = 1; y < SITE.h; y++) mats[cellIndex(px, y, pz)] = bedrock;
    }
  }

  // Treasures: relic fragment (seeded, guaranteed per site) + random finds.
  const treasures: TreasureSpec[] = [];
  const used = new Set<number>();
  const pickCell = (minY: number, maxY: number): number => {
    for (let tries = 0; tries < 200; tries++) {
      const x = randInt(rng, 1, SITE.w - 2), z = randInt(rng, 1, SITE.d - 2), y = randInt(rng, minY, maxY);
      const i = cellIndex(x, y, z);
      if (used.has(i) || mats[i] === EMPTY || mats[i] === bedrock) continue;
      // must not touch structural empties at creation (keeps finds buried)
      let buried = true;
      for (const [dx, dy, dz] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (!inGrid(nx, ny, nz)) { if (ny >= SITE.h) buried = false; continue; }
        if (mats[cellIndex(nx, ny, nz)] === EMPTY) buried = false;
      }
      if (!buried) continue;
      // keep ±1 spacing between finds
      used.add(i);
      return i;
    }
    return -1;
  };
  const deepBias = biome === 'aurora' ? 1 : 2;
  const relicCell = pickCell(deepBias, 5);
  if (relicCell >= 0) treasures.push({ index: 0, kind: 'relic', cell: relicCell, relic: `${biome}_r${siteIndex + 1}` });
  const count = biome === 'meadow' ? 5 : 4;
  for (let n = 0; n < count; n++) {
    const kind = pickWeighted(rng, TREASURE_WEIGHTS).kind;
    const cell = n === 0 && biome === 'meadow' ? pickCell(5, 6) : pickCell(deepBias, 6);
    if (cell >= 0) treasures.push({ index: treasures.length, kind, cell });
  }
  return { biome, siteIndex, seed, mats, treasures };
}

export const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
