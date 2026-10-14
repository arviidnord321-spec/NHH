/** Avatar appearance data (no rendering code; safe for tests and saves). */
export type HairStyle = 'swoop' | 'short' | 'spiky' | 'bob' | 'ponytail' | 'bald';
export type FaceStyle = 'smirk' | 'smile' | 'happy' | 'determined' | 'cool';
export type Outfit = 'vest' | 'jacket' | 'hoodie' | 'tee';
export type Hat = 'none' | 'helmet' | 'cap' | 'beanie';

export interface AvatarLook {
  skin: string;
  face: FaceStyle;
  hair: HairStyle;
  hairColor: string;
  outfit: Outfit;
  top: string; // main garment
  inner: string; // shirt / sleeves
  pants: string;
  shoes: string;
  scarf: string; // '' = none
  hat: Hat;
  hatColor: string;
  backpack: boolean;
}

export const AVATAR_OPTIONS = {
  skin: ['#f4f2ee', '#ffdcb5', '#f0c08f', '#d29a6a', '#a8714a', '#6e4630', '#ffd23f'],
  face: ['smirk', 'smile', 'happy', 'determined', 'cool'] as FaceStyle[],
  hair: ['swoop', 'short', 'spiky', 'bob', 'ponytail', 'bald'] as HairStyle[],
  hairColor: ['#c8641e', '#e8a33a', '#5a3218', '#2a2024', '#f4e2a0', '#d8483a', '#5a8ef0', '#b07af5'],
  outfit: ['vest', 'jacket', 'hoodie', 'tee'] as Outfit[],
  top: ['#1c2a44', '#f07a2a', '#2f78ec', '#3fb52e', '#e23d74', '#7b3fe4', '#f4f2ee', '#333338'],
  inner: ['#f4f2ee', '#ffe27a', '#9fe0ff', '#ffb3c8', '#c8f0a0', '#333338'],
  pants: ['#1d2438', '#3a3f4f', '#5a3a24', '#2f6fd0', '#8a8f9a', '#2a5a30'],
  shoes: ['#2a2430', '#5a3a24', '#f4f2ee', '#d8483a'],
  scarf: ['#1f3d55', '#16cdbb', '#ffbd38', '#e23d74', '#9462f5', ''],
  hat: ['none', 'helmet', 'cap', 'beanie'] as Hat[],
  hatColor: ['#ffbd38', '#2f78ec', '#e23d74', '#3fb52e', '#f4f2ee', '#333338'],
};

export const DEFAULT_AVATAR: AvatarLook = {
  skin: '#f4f2ee', face: 'smirk', hair: 'swoop', hairColor: '#c8641e', outfit: 'vest', top: '#1c2a44', inner: '#f4f2ee',
  pants: '#1d2438', shoes: '#2a2430', scarf: '#1f3d55', hat: 'none', hatColor: '#ffbd38', backpack: true,
};


/** Validate an untrusted avatar object field-by-field against the options. */
export function sanitizeAvatar(raw: unknown): AvatarLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hex = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);
  const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
  const d = DEFAULT_AVATAR;
  return {
    skin: hex(r.skin, d.skin), face: pick(r.face, AVATAR_OPTIONS.face, d.face), hair: pick(r.hair, AVATAR_OPTIONS.hair, d.hair),
    hairColor: hex(r.hairColor, d.hairColor), outfit: pick(r.outfit, AVATAR_OPTIONS.outfit, d.outfit), top: hex(r.top, d.top),
    inner: hex(r.inner, d.inner), pants: hex(r.pants, d.pants), shoes: hex(r.shoes, d.shoes),
    scarf: r.scarf === '' ? '' : hex(r.scarf, d.scarf), hat: pick(r.hat, AVATAR_OPTIONS.hat, d.hat), hatColor: hex(r.hatColor, d.hatColor),
    backpack: typeof r.backpack === 'boolean' ? r.backpack : d.backpack,
  };
}
