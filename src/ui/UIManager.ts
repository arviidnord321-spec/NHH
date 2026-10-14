/**
 * UIManager: responsive HTML/CSS interface over the WebGL canvas.
 * HUD hierarchy follows the gameplay mockup (navy rounded panels, teal
 * primary actions, amber rewards). Every visible control is functional.
 * Icons are real-time 3D renders of the game models (Showcase).
 */
import * as THREE from 'three';
import {
  ACHIEVEMENTS, BAGS, BIOMES, BIOME_ORDER, BiomeId, CAPS, COLLECTIBLES, COSMETICS, EGGS, LANTERN, MATERIAL_BY_ID,
  PET_ENTRIES, PET_ENTRY_BY_ID, PICKAXE, QUEST_CHAIN, RARITY_INFO, Rarity, SPECIES, STARTER_EGG, TOOLS, EGG_BY_ID,
} from '../data/balance';
import * as L from '../core/logic';
import type { PetInstance } from '../core/state';
import type { Game } from '../Game';
import type { Interactable } from '../world/World';
import type { HatchOptions, HatchPhase } from './Showcase';
import { UI_ART } from './assets';
import { buildAvatar, faceTexture } from '../world/avatar';
import { AVATAR_OPTIONS, DEFAULT_AVATAR, type AvatarLook } from '../core/avatarData';
import {
  buildBackpackIcon, buildChest, buildCoinFace, buildTent, buildGemIcon, buildLanternTool, buildPickaxe, buildScanner, buildScrollIcon, buildShovel,
} from '../world/models';

type PanelName = 'avatar' | 'pets' | 'eggs' | 'upgrades' | 'museum' | 'quests' | 'settings' | 'sell' | 'gate' | 'contracts' | 'surveyor' | 'cosmetics' | 'confirm' | 'help';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
const pct = (f: number) => `${(f * 100).toFixed(1).replace(/\.0$/, '')}%`;

export class UIManager {
  private hud: HTMLElement;
  private modal: HTMLElement;
  private panel: PanelName | null = null;
  private panelData: any = null;
  private els: Record<string, HTMLElement> = {};
  private shownCoins = 0;
  private shownGems = 0;
  private toastTimer = 0;
  showPetLabels = false;
  private petSort: 'best' | 'level' | 'newest' | 'species' = 'best';
  private petFilter = 'all';
  private inspectId: number | null = null;
  private mergeSel: number[] = [];
  private hatchActive = false;
  private confirmCb: (() => void) | null = null;
  private signalDepth = '';
  private scanMsgT = 0;
  private icons: Record<string, string> = {};
  private justOpened = false;
  private hudZoom = 1;

  constructor(private root: HTMLElement, private g: Game) {
    this.root.innerHTML = '';
    this.hud = div('hud');
    this.modal = div('modal-layer hidden');
    this.root.append(this.hud, this.modal);
    this.makeIcons();
    this.buildHud();
    this.onResize();
    this.modal.addEventListener('click', (e) => this.onModalClick(e));
    this.modal.addEventListener('change', (e) => this.onModalChange(e));
    this.modal.addEventListener('input', (e) => this.onModalInput(e));
    this.root.addEventListener('pointerover', (e) => { if ((e.target as HTMLElement).closest('button:not([disabled])')) this.g.audio.play('hover'); });
  }

  private makeIcons() {
    const sc = this.g.showcase;
    this.icons.coin = sc.iconOf('coin', buildCoinFace, 1.55, 0.4, 128, 0.3);
    this.icons.gem = sc.iconOf('gem', buildGemIcon, 1.5, 0.38, 128, 0.3);
    this.icons.shovel = sc.iconOf(`shovel${this.g.s.toolTier}`, () => { const o = buildShovel(this.g.s.toolTier); o.rotation.z = 0.7; const w = new THREE.Group(); w.add(o); o.position.y = 0.4; return w; }, 3.2, 0.1, 96, 0.4);
    this.icons.pickaxe = sc.iconOf(`pick${this.g.s.toolTier}`, () => { const o = buildPickaxe(this.g.s.toolTier); o.rotation.z = -0.6; const w = new THREE.Group(); w.add(o); o.position.y = 0.7; return w; }, 3.0, 0.1, 96, 0.9);
    this.icons.lantern = sc.iconOf('lantern', () => { const o = buildLanternTool(); o.scale.setScalar(2.2); o.position.y = 0.6; const w = new THREE.Group(); w.add(o); return w; }, 2.4, 0.3, 96, 0.4);
    this.icons.scanner = sc.iconOf('scanner', () => { const o = buildScanner(); o.scale.setScalar(1.6); o.position.y = 0.2; const w = new THREE.Group(); w.add(o); return w; }, 2.4, 0.35, 96, 0.5);
    this.icons.pets = sc.icon('pet', 'pup', false, 128);
    this.icons.eggs = sc.icon('egg', 'meadow', false, 128);
    this.icons.upgrades = sc.iconOf('upg', () => { const o = buildPickaxe(2); o.rotation.z = -0.7; o.position.y = 0.6; const w = new THREE.Group(); w.add(o); return w; }, 2.8, 0.15, 128, 0.9);
    this.icons.museum = sc.iconOf('museum', () => buildChest('relic'), 2.0, 0.4, 128, 0.5);
    this.icons.quests = sc.iconOf('quests', buildScrollIcon, 2.0, 0.3, 128, 0.3);
    this.icons.avatar = sc.iconOf('avatarHead', () => buildAvatar(DEFAULT_AVATAR).root, 1.7, 2.02, 160, 0.35);
    this.icons.bag = sc.iconOf('bag', buildBackpackIcon, 2.6, 0.45, 128, 0.5);
    this.icons.tent = sc.iconOf('tent', () => { const t = buildTent('#ff7a2a'); t.scale.setScalar(0.42); return t; }, 3.4, 0.45, 128, 0.7);
    this.icons.fossil = sc.iconOf('fossil', () => buildChest('fossil'), 2.0, 0.2, 96, 0.4);
    this.icons.coins = sc.iconOf('chestCoins', () => buildChest('coins'), 2.4, 0.35, 96, 0.5);
    this.icons.geode = sc.iconOf('geodeChest', () => buildChest('geode'), 2.2, 0.4, 96, 0.5);
    this.icons.token = sc.iconOf('token', () => buildChest('token'), 2.0, 0.4, 96, 0.3);
    this.icons.relic = this.icons.museum;
    this.icons.decor = sc.iconOf('decor', () => buildChest('decor'), 2.0, 0.4, 96, 0.4);
  }

  private petIcon(entry: string, shiny = false) { return this.g.showcase.icon('pet', entry, shiny, 160); }
  private eggIcon(id: string) { return this.g.showcase.icon('egg', id, false, 160); }

  // ───────── HUD ─────────
  private buildHud() {
    const h = this.hud;
    const A = UI_ART;
    h.innerHTML = `
      <div class="tl">
        <div class="bar9 pill coins" title="Coins" style="border-image-source:url(${A.coinBar})"><span id="coins">0</span></div>
        <div class="bar9 pill gems" title="Gems" style="border-image-source:url(${A.gemBar})"><span id="gems">0</span></div>
      </div>
      <div class="tc">
        <button class="bar9 quest" id="quest" aria-label="Open quests" style="border-image-source:url(${A.questBar})"><span class="qtext" id="qtext"></span><span class="qprog" id="qprog"></span><span class="qbar"><i id="qbar"></i></span></button>
        <div class="scan-hud hidden" id="scanhud"><div class="arrow" id="scanarrow">➤</div><div class="scan-info"><div id="scandepth"></div><div class="meter"><i id="scanmeter"></i></div></div></div>
      </div>
      <div class="tr">
        <button class="bubble-btn small" id="btn-view" aria-label="Toggle first person view (V)" title="First / third person (V)">${SVG_EYE}</button>
        <button class="art-btn small" id="btn-sound" aria-label="Toggle sound"><img alt="" id="soundimg" src="${A.btnSoundOn}"></button>
        <button class="art-btn small" id="btn-settings" aria-label="Settings"><img alt="" src="${A.btnSettings}"></button>
      </div>
      <div class="side" id="side">
        <div class="side-list">
          <button class="art-btn menu" data-open="pets" aria-label="Pets"><img alt="" src="${A.btnPets}"><kbd>P</kbd></button>
          <button class="art-btn menu" data-open="eggs" aria-label="Eggs"><img alt="" src="${A.btnEggs}"></button>
          <button class="art-btn menu" data-open="upgrades" aria-label="Upgrades"><img alt="" src="${A.btnUpgrades}"></button>
          <button class="art-btn menu" data-open="museum" aria-label="Museum"><img alt="" src="${A.btnMuseum}"></button>
          <button class="art-btn menu" data-open="quests" aria-label="Quests"><img alt="" src="${A.btnQuests}"></button>
          <button class="bubble-btn menu teal" data-open="avatar" aria-label="Avatar"><img alt="" src="${this.icons.avatar}"><span>AVATAR</span><kbd>C</kbd></button>
        </div>
      </div>
      <div class="bc">
        <div class="prompt hidden" id="prompt"><span id="prompttext"></span><i id="promptbar"></i></div>
        <button class="sell-quick hidden" id="sellquick"></button>
        <div class="bar9 bagbar" id="bagbar" style="border-image-source:url(${A.bagBar})"><div class="bagfill"><i id="bagfill"></i></div><span class="baglbl"><b>BACKPACK</b> <span id="bagtext">0 / 20</span></span></div>
        <div class="hotbar" id="hotbar">
          ${['Shovel', 'Pickaxe', 'Lantern', 'Scanner'].map((k, i) => `<button class="art-btn slot" data-slot="${i}" aria-label="${k}"><img alt="" class="slotimg" src="${A.slots[i].off}"><kbd>${i + 1}</kbd><span>${k}</span><i class="cd" id="cd-${k.toLowerCase()}"></i></button>`).join('')}
        </div>
      </div>
      <button class="bar9 camp-btn" id="campbtn" style="border-image-source:url(${A.campBtn})"><span class="lbl">RETURN TO CAMP</span><kbd>R</kbd></button>
      <div class="target-card hidden" id="target" style="background-image:url(${A.targetCard})"><b id="tname"></b><div class="hp"><i id="thp"></i></div><small id="tsub"></small></div>
      <div class="hint hidden" id="hint"></div>
      <div class="crosshair hidden" id="crosshair"></div>
      <div class="banner hidden" id="banner"></div>
      <div class="toasts" id="toasts" aria-live="polite"></div>
      <div class="floaters" id="floaters"></div>
      <div class="reward hidden" id="reward"></div>
      <div class="fade" id="fade"></div>
      <div class="debug hidden" id="debug"></div>
      <div class="save-warn hidden" id="savewarn"></div>`;
    h.querySelectorAll<HTMLElement>('[id]').forEach((e) => (this.els[e.id] = e));
    h.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', () => { this.open(b.dataset.open as PanelName); }));
    h.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) => b.addEventListener('click', () => this.g.selectTool(+b.dataset.slot!)));
    this.els.campbtn.addEventListener('click', () => this.g.returnToCamp());
    this.els['btn-settings'].addEventListener('click', () => this.open('settings'));
    this.els['btn-view'].addEventListener('click', () => this.g.setView(!this.g.cam.firstPerson));
    this.els['btn-sound'].addEventListener('click', () => {
      this.g.s.settings.muted = !this.g.s.settings.muted;
      this.g.applySettings();
      this.updateHud();
      this.g.persist();
    });
    this.els.quest.addEventListener('click', () => this.open('quests'));
    this.els.sellquick.addEventListener('click', () => this.g.sell());
  }

  onResize() {
    const w = this.root.clientWidth || window.innerWidth, h = this.root.clientHeight || window.innerHeight;
    const z = Math.max(0.45, Math.min(1.15, Math.min(w / 1500, h / 800)));
    document.documentElement.style.setProperty('--hudz', z.toFixed(3));
    this.hudZoom = z;
  }

  updateAll() {
    this.shownCoins = this.g.s.coins;
    this.shownGems = this.g.s.gems;
    this.updateHud();
  }

  updateHud() {
    const s = this.g.s;
    const team = L.teamStats(s);
    const cap = L.bagCapacity(s, team);
    const n = L.bagCount(s);
    this.els.bagtext.textContent = `${n} / ${cap}`;
    this.els.bagfill.style.width = `${Math.min(100, (n / cap) * 100)}%`;
    this.els.bagbar.classList.toggle('full', n >= cap);
    const q = L.currentQuest(s);
    if (q) {
      this.els.qtext.textContent = q.text;
      this.els.qprog.textContent = q.target > 1 ? `${Math.min(s.questProgress, q.target)}/${q.target}` : '';
      this.els.qbar.style.width = `${(Math.min(s.questProgress, q.target) / q.target) * 100}%`;
    } else if (s.contract) {
      const c = s.contract;
      this.els.qtext.textContent = contractText(c);
      this.els.qprog.textContent = `${c.progress}/${c.target}`;
      this.els.qbar.style.width = `${(c.progress / c.target) * 100}%`;
    } else {
      const missing = BIOME_ORDER.find((b) => L.relicCount(s, b) < 3 && s.unlocked.includes(b));
      this.els.qtext.textContent = missing ? `Find ${BIOMES[missing].name} relic shards` : s.unlocked.length < 4 ? 'Open the next biome gate' : 'Collect every find for the museum';
      this.els.qprog.textContent = missing ? `${L.relicCount(s, missing)}/3` : '';
      this.els.qbar.style.width = missing ? `${(L.relicCount(s, missing) / 3) * 100}%` : '100%';
    }
    const snd = this.g.audio.muted ? UI_ART.btnSoundOff : UI_ART.btnSoundOn;
    if (this.els.soundimg.getAttribute('src') !== snd) (this.els.soundimg as HTMLImageElement).src = snd;
    this.els['btn-sound'].setAttribute('aria-pressed', String(s.settings.muted));
    // hotbar
    const slots = this.els.hotbar.querySelectorAll<HTMLElement>('.slot');
    slots.forEach((el, i) => {
      const on = i === this.g.selectedSlot || (i === 2 && this.g.player.lanternOn);
      el.classList.toggle('active', on);
      el.classList.toggle('locked', (i === 1 && !s.hasPickaxe) || (i === 2 && !s.hasLantern));
      const img = el.querySelector('img') as HTMLImageElement;
      const src = on ? UI_ART.slots[i].on : UI_ART.slots[i].off;
      if (img.getAttribute('src') !== src) img.src = src;
    });
    this.updateHint();
    if (this.panel && !this.hatchActive) this.render();
  }

  private updateHint() {
    const s = this.g.s;
    let hint = '';
    if (s.stats.cells === 0) hint = this.g.input.isTouch ? 'Aim the reticle at the dig site and hold <kbd>Dig</kbd>' : this.g.cam?.firstPerson ? 'Click to look around &nbsp;•&nbsp; <kbd>LMB</kbd> dig &nbsp;•&nbsp; <kbd>WASD</kbd> move &nbsp;•&nbsp; <kbd>V</kbd> third person' : 'Hold <kbd>LMB</kbd> to dig &nbsp;•&nbsp; <kbd>WASD</kbd> move &nbsp;•&nbsp; <kbd>Right-drag</kbd> look &nbsp;•&nbsp; <kbd>V</kbd> first person';
    else if (s.stats.cells < 5) hint = `Keep digging! ${5 - s.stats.cells} more cell${5 - s.stats.cells === 1 ? '' : 's'}`;
    else if (!s.starterHatched) hint = 'A <b>Starter Egg</b> appeared beside the dig site — walk over and press <b>E</b>';
    else if (s.stats.sells === 0) hint = L.bagCount(s) >= L.bagCapacity(s) ? 'Bag full! Press <b>R</b> to return to camp, then sell to <b>Mara</b>' : 'Fill your bag, then sell to <b>Mara</b> at camp (<b>R</b> returns to camp)';
    else if (s.toolTier === 0) hint = s.coins >= TOOLS[1].price ? 'Visit <b>Bram</b> the Smith to upgrade your shovel' : `Earn ${TOOLS[1].price} coins for a better shovel`;
    else if (s.stats.scans === 0) hint = 'Press <b>Q</b> (Echo Scan) at a dig site to locate buried treasure';
    else if (s.stats.hatches === 0 && s.coins >= 150) hint = 'Buy a <b>Meadow Egg</b> at the shrine (north of camp)';
    this.els.hint.innerHTML = hint;
    this.els.hint.classList.toggle('hidden', !hint);
  }

  frame(dt: number) {
    const s = this.g.s;
    // count-up animation
    const ease = (cur: number, target: number) => {
      if (cur === target) return cur;
      const d = target - cur;
      const step = Math.max(1, Math.abs(d) * Math.min(1, dt * 6));
      return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
    };
    const nc = ease(this.shownCoins, s.coins), ng = ease(this.shownGems, s.gems);
    if (nc !== this.shownCoins) { this.shownCoins = nc; this.els.coins.textContent = fmt(nc); }
    else if (this.els.coins.textContent === '0' && s.coins) this.els.coins.textContent = fmt(s.coins);
    if (ng !== this.shownGems) { this.shownGems = ng; this.els.gems.textContent = fmt(ng); }
    // scanner cooldown
    const cd = this.g.scanCd / Math.max(0.01, L.scanCooldown(s));
    this.els['cd-scanner'].style.height = `${Math.max(0, Math.min(1, cd)) * 100}%`;
    // target card
    const t = this.g.target;
    if (t && this.g.running) {
      const p = this.g.projectToScreen(t.center.clone().add(new THREE.Vector3(0, 0.8, 0)));
      const card = this.els.target;
      card.classList.remove('hidden');
      card.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%) scale(${this.hudZoom})`;
      if (t.treasure) {
        this.els.tname.textContent = t.site.isExposed(t.cell) ? 'Buried find' : 'Hidden';
        this.els.thp.style.width = '100%';
        this.els.tsub.textContent = t.inReach ? 'Hold E nearby to uncover' : 'Move closer';
      } else {
        const m = MATERIAL_BY_ID[matId(t.site.materialIndex(t.cell))];
        const max = L.cellMaxHp(m, t.site.biome, s.stats.cells);
        const hp = t.site.damage.get(t.cell) ?? max;
        this.els.tname.textContent = m.name + (m.units > 1 ? ` ×${m.units}` : '');
        this.els.thp.style.width = `${(hp / max) * 100}%`;
        let sub = m.indestructible ? 'Boundary — cannot dig' : `${Math.ceil(hp)}/${Math.ceil(max)} HP`;
        if (m.minToolTier > s.toolTier && !m.indestructible) sub = `Requires ${TOOLS[m.minToolTier].name}`;
        else if (m.units > 1) sub += ` · fills ${m.units} bag slots`;
        if (!t.inReach) sub = 'Out of reach — move closer';
        this.els.tsub.textContent = sub;
      }
      card.classList.toggle('far', !t.inReach);
    } else this.els.target.classList.add('hidden');
    if (this.scanMsgT > 0) { this.scanMsgT -= dt; if (this.scanMsgT <= 0 && !this.signalDepth) this.els.scanhud.classList.add('hidden'); }
    this.toastTimer += dt;
  }

  setFirstPerson(fp: boolean) {
    this.updateHint();
    this.els.crosshair.classList.toggle('hidden', !fp);
    this.els['btn-view'].classList.toggle('on', fp);
    this.els['btn-view'].setAttribute('aria-pressed', String(fp));
  }

  setDebug(text: string) {
    this.els.debug.classList.remove('hidden');
    this.els.debug.textContent = text;
  }

  saveStatus(err: string | null) {
    const w = this.els.savewarn;
    if (this.g.saves.locked) { w.textContent = 'Progress is not being saved (see Settings)'; w.classList.remove('hidden'); return; }
    if (err) { w.textContent = `Couldn't save progress: ${err}`; w.classList.remove('hidden'); }
    else w.classList.add('hidden');
  }

  setPrompt(text: string | null, progress: number) {
    const p = this.els.prompt;
    if (!text || !this.g.running) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    if (this.els.prompttext.textContent !== text) this.els.prompttext.textContent = text;
    this.els.promptbar.style.width = progress >= 0 ? `${Math.min(1, progress) * 100}%` : '0';
  }

  setSellShortcut(show: boolean) {
    const b = this.els.sellquick;
    if (show) {
      const s = this.g.s;
      b.textContent = `Sell ${L.bagCount(s)} items · ${fmt(L.bagSaleValue(s))} coins`;
    }
    b.classList.toggle('hidden', !show);
  }

  pulseBag() {
    this.els.bagbar.classList.remove('pulse');
    void this.els.bagbar.offsetWidth;
    this.els.bagbar.classList.add('pulse');
  }

  toast(text: string, kind: 'good' | 'warn' | 'info' | 'quest' = 'info') {
    const t = div(`toast ${kind}`);
    t.textContent = text;
    const box = this.els.toasts;
    // de-duplicate identical consecutive toasts
    if (box.lastElementChild?.textContent === text) return;
    box.appendChild(t);
    while (box.children.length > 4) box.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), kind === 'warn' ? 2600 : 3400);
    setTimeout(() => t.remove(), kind === 'warn' ? 3000 : 3800);
  }

  banner(text: string) {
    const b = this.els.banner;
    b.textContent = text;
    b.classList.remove('hidden', 'show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  fade() {
    const f = this.els.fade;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  floatText(pos: THREE.Vector3, text: string, color: string) {
    const p = this.g.projectToScreen(pos);
    if (!p.visible) return;
    const el = div('float');
    el.textContent = text;
    el.style.color = color;
    el.style.left = `${p.x + (Math.random() - 0.5) * 30}px`;
    el.style.top = `${p.y}px`;
    this.els.floaters.appendChild(el);
    if (this.els.floaters.children.length > 12) this.els.floaters.firstElementChild?.remove();
    setTimeout(() => el.remove(), 900);
  }

  flyCoins(from: THREE.Vector3 | null, n: number) {
    const target = this.els.coins.getBoundingClientRect();
    const rootR = this.root.getBoundingClientRect();
    let sx = rootR.width / 2, sy = rootR.height * 0.6;
    if (from) { const p = this.g.projectToScreen(from); sx = p.x; sy = p.y; }
    for (let i = 0; i < n; i++) {
      const c = document.createElement('img');
      c.src = this.icons.coin;
      c.className = 'flycoin';
      c.style.left = `${sx}px`;
      c.style.top = `${sy}px`;
      this.els.floaters.appendChild(c);
      const dx = target.left - rootR.left - sx + 10, dy = target.top - rootR.top - sy + 4;
      const delay = i * 60;
      c.animate([
        { transform: 'translate(0,0) scale(0.6)', opacity: 0 },
        { transform: `translate(${(Math.random() - 0.5) * 80}px, ${-30 - Math.random() * 40}px) scale(1)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.7)`, opacity: 1 },
      ], { duration: 750, delay, easing: 'cubic-bezier(.5,0,.6,1)', fill: 'forwards' });
      setTimeout(() => { c.remove(); if (i === n - 1) this.els.coins.parentElement!.classList.add('bump'); setTimeout(() => this.els.coins.parentElement!.classList.remove('bump'), 250); }, 800 + delay);
    }
  }

  rewardCard(kind: string, title: string, detail: string, color: string) {
    const r = this.els.reward;
    r.innerHTML = `<div class="rays" style="--c:${color}"></div><img alt="" src="${this.icons[kind] ?? this.icons.museum}"><b>${esc(title)}</b><span>${esc(detail)}</span>`;
    r.classList.remove('hidden', 'show');
    void r.offsetWidth;
    r.classList.add('show');
    clearTimeout((r as any)._t);
    (r as any)._t = setTimeout(() => r.classList.add('hidden'), 2600);
  }

  scanResult(depth: string | null) {
    const h = this.els.scanhud;
    h.classList.remove('hidden');
    this.scanMsgT = 2.5;
    if (!depth) {
      this.signalDepth = '';
      this.els.scandepth.textContent = 'No signal nearby';
      this.els.scanarrow.style.visibility = 'hidden';
      this.els.scanmeter.style.width = '0';
    }
  }

  setSignal(sig: { angle: number; strength: number; depth: string; exposed: boolean } | null) {
    const h = this.els.scanhud;
    if (!sig) {
      if (this.signalDepth) { this.signalDepth = ''; if (this.scanMsgT <= 0) h.classList.add('hidden'); }
      return;
    }
    h.classList.remove('hidden');
    this.signalDepth = sig.depth;
    this.els.scanarrow.style.visibility = 'visible';
    this.els.scanarrow.style.transform = `rotate(${-sig.angle - Math.PI / 2}rad)`;
    const depthText = sig.exposed ? 'Exposed — uncover it!' : sig.depth === 'shallow' ? 'Signal: shallow' : sig.depth === 'below' ? 'Signal: below' : 'Signal: deep';
    this.els.scandepth.textContent = depthText;
    this.els.scanmeter.style.width = `${Math.round(sig.strength * 100)}%`;
  }

  interactLabel(it: Interactable): string {
    const s = this.g.s;
    switch (it.kind) {
      case 'trader': return L.bagCount(s) ? `Sell to Mara (${L.bagCount(s)} items)` : 'Talk to Mara (Trader)';
      case 'smith': return 'Upgrades at Bram\'s Smithy';
      case 'eggs': return `View ${EGG_BY_ID[it.data!].name}`;
      case 'museum': return 'Museum';
      case 'contracts': return 'Expedition contracts';
      case 'surveyor': return 'Renew dig sites';
      case 'cosmetics': return 'Outfitter — design your avatar';
      case 'gate': return `${BIOMES[it.data as BiomeId].name} gate`;
      case 'chamber': return s.displaysClaimed.includes(it.data as BiomeId) ? 'Open the secret cache' : 'Sealed chamber';
      case 'final': return 'Star Monument';
      case 'starterEgg': return 'Hatch the free Starter Egg';
    }
  }

  interact(it: Interactable) {
    const s = this.g.s;
    switch (it.kind) {
      case 'trader': this.open('sell'); break;
      case 'smith': this.open('upgrades'); break;
      case 'eggs': this.open('eggs', it.data); break;
      case 'museum': this.open('museum'); break;
      case 'contracts': this.open('contracts'); break;
      case 'surveyor': this.open('surveyor'); break;
      case 'cosmetics': this.open('avatar'); break;
      case 'gate': this.open('gate', it.data); break;
      case 'starterEgg': this.g.hatchStarter(); break;
      case 'chamber': {
        const b = it.data as BiomeId;
        if (!s.displaysClaimed.includes(b)) { this.toast(`Sealed. Complete the ${BIOMES[b].name} relic display (${L.relicCount(s, b)}/3 shards) to open it.`, 'info'); break; }
        const r = L.claimChamber(s, b);
        if (r.ok) { this.g.audio.play('treasure'); this.rewardCard('relic', 'Secret Cache', `+${r.gems} gems`, '#ffd36a'); this.g.changed(); }
        else this.toast(r.reason, 'info');
        break;
      }
      case 'final': {
        if (s.finalClaimed) { this.toast('The Star Monument shines for you, Explorer.', 'info'); break; }
        const r = L.claimFinal(s);
        if (r.ok) {
          this.g.audio.play('unlock');
          this.rewardCard('relic', 'Aurora Explorer Crown', 'Permanent cosmetic + 100 gems', '#6ff5e6');
          this.g.refreshPlayerLook();
          this.g.changed();
        } else this.toast(`${r.reason} (${s.displaysClaimed.length}/4)`, 'info');
        break;
      }
    }
  }

  // ───────── panels ─────────
  open(name: PanelName, data?: any) {
    if (this.hatchActive) return;
    if (this.panel === 'avatar' && name !== 'avatar') this.g.showcase.detachPreview();
    this.panel = name;
    this.panelData = data ?? null;
    if (name === 'pets') { this.mergeSel = []; }
    this.modal.classList.remove('hidden');
    this.justOpened = true;
    this.g.setPause('menu', true);
    this.g.audio.play('click');
    this.render();
    const first = this.modal.querySelector<HTMLElement>('.close');
    first?.focus({ preventScroll: true });
  }

  close() {
    if (!this.panel) return;
    if (this.panel === 'avatar') this.g.showcase.detachPreview();
    this.panel = null;
    this.inspectId = null;
    this.modal.classList.add('hidden');
    this.modal.innerHTML = '';
    this.g.setPause('menu', false);
    this.g.audio.play('click');
  }

  handleMenuKeys() {
    const inp = this.g.input;
    if (this.hatchActive) return;
    if (inp.wasPressed('pause')) { if (this.panel === 'confirm') this.open(this.panelData?.back ?? 'settings'); else this.close(); }
    else if (inp.wasPressed('pets') && this.panel === 'pets') this.close();
  }

  private render() {
    if (!this.panel) return;
    const scroll = this.modal.querySelector('.body')?.scrollTop ?? 0;
    const html = this.renderPanel(this.panel);
    this.modal.innerHTML = `<div class="panel panel-${this.panel}${this.justOpened ? ' enter' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    this.justOpened = false;
    const body = this.modal.querySelector('.body');
    if (body) body.scrollTop = scroll;
    if (this.panel === 'avatar') {
      const stage = this.modal.querySelector('#avstage') as HTMLElement | null;
      if (stage) this.g.showcase.attachPreview(stage, this.g.s.avatar, this.g.s.cosmetics.crown);
    }
  }

  private head(title: string, sub = '') {
    return `<header><h2>${title}</h2>${sub ? `<span class="sub">${sub}</span>` : ''}<button class="close" data-act="close" aria-label="Close">✕</button></header>`;
  }

  private renderPanel(p: PanelName): string {
    switch (p) {
      case 'avatar': return this.renderAvatar();
      case 'pets': return this.renderPets();
      case 'eggs': return this.renderEggs();
      case 'upgrades': return this.renderUpgrades();
      case 'museum': return this.renderMuseum();
      case 'quests': return this.renderQuests();
      case 'settings': return this.renderSettings();
      case 'sell': return this.renderSell();
      case 'gate': return this.renderGate();
      case 'contracts': return this.renderContracts();
      case 'surveyor': return this.renderSurveyor();
      case 'cosmetics': return this.renderCosmetics();
      case 'confirm': return this.renderConfirm();
      case 'help': return this.renderHelp();
    }
  }

  // ── Avatar designer ──
  private renderAvatar(): string {
    const s = this.g.s;
    const a = s.avatar;
    const O = AVATAR_OPTIONS;
    const label: Record<string, string> = { swoop: 'Swoop', short: 'Short', spiky: 'Spiky', bob: 'Bob', ponytail: 'Ponytail', bald: 'None', vest: 'Vest', jacket: 'Jacket', hoodie: 'Hoodie', tee: 'Tee', none: 'None', helmet: 'Miner helmet', cap: 'Cap', beanie: 'Beanie' };
    const sw = (k: keyof AvatarLook, list: string[]) => list.map((c) => `<button class="sw-btn ${a[k] === c ? 'on' : ''}" data-act="av" data-k="${k}" data-v="${c}" style="--c:${c || 'transparent'}" aria-label="${k} ${c || 'none'}">${c ? '' : '✕'}</button>`).join('');
    const chips = (k: keyof AvatarLook, list: string[]) => list.map((v) => `<button class="chip ${a[k] === v ? 'on' : ''}" data-act="av" data-k="${k}" data-v="${v}">${label[v] ?? v}</button>`).join('');
    const faces = O.face.map((f) => `<button class="face-btn ${a.face === f ? 'on' : ''}" data-act="av" data-k="face" data-v="${f}" aria-label="Face ${f}"><img alt="" src="${(faceTexture(f).image as HTMLCanvasElement).toDataURL()}"></button>`).join('');
    // gem-unlocked colours
    const gem = COSMETICS.filter((c) => c.purchasable && c.gems > 0).map((c) => {
      const own = s.cosmetics.owned.includes(c.id);
      const k = c.slot === 'helmet' ? 'hatColor' : 'scarf';
      return `<button class="sw-btn gem ${(a as any)[k] === c.color ? 'on' : ''}" data-act="${own ? 'av' : 'avbuy'}" data-k="${k}" data-v="${c.color}" data-id="${c.id}" style="--c:${c.color}" title="${esc(c.name)}${own ? '' : ` · ${c.gems} gems`}">${own ? '' : `<em>${c.gems}</em>`}</button>`;
    }).join('');
    const crown = s.cosmetics.owned.includes('crown_aurora') ? `<label class="srow"><span>Aurora crown</span><input type="checkbox" data-act="avcrown" ${s.cosmetics.crown ? 'checked' : ''}></label>` : '';
    return `${this.head('AVATAR', 'Design your explorer · changes save instantly')}
      <div class="avatar-layout">
        <div class="av-left"><div class="av-stage" id="avstage" title="Drag to spin"></div>
          <div class="row" style="justify-content:center"><button class="btn" data-act="avrand">🎲 Randomize</button><button class="btn" data-act="avreset">Reset</button></div></div>
        <div class="body av-opts">
          <h3>Face</h3><div class="opt">${faces}</div>
          <h3>Skin</h3><div class="opt">${sw('skin', O.skin)}</div>
          <h3>Hair</h3><div class="opt">${chips('hair', O.hair)}</div><div class="opt">${sw('hairColor', O.hairColor)}</div>
          <h3>Outfit</h3><div class="opt">${chips('outfit', O.outfit)}</div>
          <div class="opt lbl"><span>Top</span>${sw('top', O.top)}</div>
          <div class="opt lbl"><span>Shirt</span>${sw('inner', O.inner)}</div>
          <div class="opt lbl"><span>Pants</span>${sw('pants', O.pants)}</div>
          <div class="opt lbl"><span>Shoes</span>${sw('shoes', O.shoes)}</div>
          <div class="opt lbl"><span>Scarf</span>${sw('scarf', O.scarf)}</div>
          <h3>Hat</h3><div class="opt">${chips('hat', O.hat)}</div><div class="opt">${sw('hatColor', O.hatColor)}</div>
          <h3>Gem styles</h3><p class="note">Special hat and scarf colours bought with gems (${fmt(s.gems)} gems).</p><div class="opt">${gem}</div>
          <h3>Gear</h3><label class="srow"><span>Backpack</span><input type="checkbox" data-act="avpack" ${a.backpack ? 'checked' : ''}></label>${crown}
        </div>
      </div>`;
  }

  private setAvatar(patch: Partial<AvatarLook>) {
    Object.assign(this.g.s.avatar, patch);
    this.g.refreshPlayerLook();
    this.g.persist();
  }

  // ── Pets ──
  private sortedPets(): PetInstance[] {
    const s = this.g.s;
    let list = [...s.pets];
    const f = this.petFilter;
    if (f === 'equipped') list = list.filter((p) => s.equipped.includes(p.id));
    else if (f === 'favorites') list = list.filter((p) => p.locked);
    else if (f !== 'all') list = list.filter((p) => PET_ENTRY_BY_ID[p.entry].species === f);
    const by = {
      best: (a: PetInstance, b: PetInstance) => L.petDigBonus(b) - L.petDigBonus(a) || b.level - a.level || a.id - b.id,
      level: (a: PetInstance, b: PetInstance) => b.level - a.level || b.xp - a.xp || a.id - b.id,
      newest: (a: PetInstance, b: PetInstance) => b.id - a.id,
      species: (a: PetInstance, b: PetInstance) => a.entry.localeCompare(b.entry) || a.id - b.id,
    }[this.petSort];
    list.sort(by);
    // equipped first
    list.sort((a, b) => (s.equipped.includes(b.id) ? 1 : 0) - (s.equipped.includes(a.id) ? 1 : 0));
    return list;
  }

  private rarityOf(entry: string): Rarity {
    for (const e of EGGS) { const o = e.outcomes.find((x) => x.pet === entry); if (o) return o.rarity; }
    return 'common';
  }

  private renderPets(): string {
    const s = this.g.s;
    const slots = L.equipSlots(s);
    const team = L.teamStats(s);
    const total = Math.min(CAPS.petDigBonus, team.digSum);
    const list = this.sortedPets();
    const merging = this.panelData === 'merge';
    const insp = this.inspectId !== null ? s.pets.find((p) => p.id === this.inspectId) : null;
    const speciesOpts = Object.values(SPECIES).map((sp) => `<option value="${sp.id}" ${this.petFilter === sp.id ? 'selected' : ''}>${sp.name}</option>`).join('');
    const cards = list.map((p) => {
      const e = PET_ENTRY_BY_ID[p.entry];
      const r = RARITY_INFO[this.rarityOf(p.entry)];
      const eq = s.equipped.includes(p.id);
      const sel = merging && this.mergeSel.includes(p.id);
      return `<button class="pet-card ${eq ? 'equipped' : ''} ${sel ? 'selected' : ''} ${insp?.id === p.id ? 'inspected' : ''}" data-act="${merging ? 'mergepick' : 'inspect'}" data-id="${p.id}" style="--rc:${r.color}">
        <img alt="" src="${this.petIcon(p.entry, p.shiny)}">
        ${p.locked ? '<span class="lock" title="Favorite (locked)">★</span>' : ''}${eq ? '<span class="eqb">Equipped</span>' : ''}
        <b>${p.shiny ? '✨ ' : ''}${esc(e.name)}</b>
        <small><span class="rar">${r.icon} ${r.label}</span> · Lv ${p.level}</small>
        <small class="dig">+${pct(L.petDigBonus(p))} dig</small>
      </button>`;
    }).join('');
    const empty = s.pets.length === 0 ? `<div class="empty"><img alt="" src="${this.eggIcon('starter')}"><p>No pets yet. Break 5 cells at the first dig site to reveal your free <b>Starter Egg</b>, then hatch more at the Egg Shrine.</p></div>` : list.length === 0 ? '<div class="empty"><p>No pets match this filter.</p></div>' : '';
    const utilities = team.utilities.length ? team.utilities.map((u) => Object.values(SPECIES).find((x) => x.utility === u)!.utilityText).join(' · ') : 'none';
    let detail = '';
    if (insp && !merging) {
      const e = PET_ENTRY_BY_ID[insp.entry];
      const sp = SPECIES[e.species];
      const r = RARITY_INFO[this.rarityOf(insp.entry)];
      const eq = s.equipped.includes(insp.id);
      const need = L.xpToNext(insp.level);
      const dupes = L.mergeCandidates(s, insp.entry).length;
      detail = `<aside class="inspect">
        <img alt="" src="${this.petIcon(insp.entry, insp.shiny)}">
        <h3>${insp.shiny ? '✨ Shiny ' : ''}${esc(e.name)}</h3>
        <div class="tag" style="--rc:${r.color}">${r.icon} ${r.label}${e.variant ? ' · Variant' : ''}</div>
        <div class="xp"><span>Level ${insp.level}${insp.level >= CAPS.petMaxLevel ? ' (max)' : ''}</span>${insp.level < CAPS.petMaxLevel ? `<div class="bar"><i style="width:${(insp.xp / need) * 100}%"></i></div><small>${insp.xp}/${need} XP</small>` : ''}</div>
        <dl>
          <dt>Dig bonus</dt><dd>+${pct(L.petDigBonus(insp))} <small>(base ${pct(sp.digBonus)} + ${((insp.level - 1) * CAPS.levelBonusPP).toFixed(1)} pp from levels${insp.shiny ? ` + ${CAPS.shinyBonusPP} pp shiny` : ''})</small></dd>
          <dt>Utility</dt><dd>${esc(sp.utilityText)}</dd>
        </dl>
        <p class="note">Utility effects from the same species apply once (highest-level copy); variants share their base species' limit. Material-specific bonuses add to the dig bonus before its 75% cap.</p>
        <div class="row">
          ${eq ? `<button class="btn" data-act="unequip" data-id="${insp.id}">Unequip</button>` : `<button class="btn primary" data-act="equip" data-id="${insp.id}" ${s.equipped.length >= slots ? 'disabled' : ''}>${s.equipped.length >= slots ? 'Team full' : 'Equip'}</button>`}
          <button class="btn" data-act="lock" data-id="${insp.id}" aria-pressed="${insp.locked}">${insp.locked ? '★ Unfavorite' : '☆ Favorite'}</button>
          <button class="btn danger" data-act="release" data-id="${insp.id}" ${insp.locked || eq ? 'disabled' : ''} title="${insp.locked ? 'Favorites are locked' : eq ? 'Unequip first' : 'Release for coins'}">Release</button>
        </div>
        ${!insp.shiny ? `<button class="btn wide" data-act="mergemode" data-entry="${insp.entry}" ${dupes < 3 ? 'disabled' : ''}>Merge 3 → Shiny ${dupes < 3 ? `(${dupes}/3 unlocked, unequipped copies)` : ''}</button>` : '<p class="note">Shiny pets cannot be merged again.</p>'}
      </aside>`;
    } else if (merging) {
      const entry = this.panelData2;
      const cands = L.mergeCandidates(s, entry);
      detail = `<aside class="inspect"><h3>Merge into Shiny</h3>
        <p>Select exactly three unlocked, unequipped ${esc(PET_ENTRY_BY_ID[entry].name)} copies. They are consumed and replaced by one ✨ Shiny copy (+${CAPS.shinyBonusPP} pp dig bonus) keeping the highest level/XP.</p>
        <p><b>Selected ${this.mergeSel.length}/3</b> · ${cands.length} eligible</p>
        <div class="row"><button class="btn primary" data-act="mergedo" ${this.mergeSel.length !== 3 ? 'disabled' : ''}>Merge</button><button class="btn" data-act="mergecancel">Cancel</button></div></aside>`;
    }
    return `${this.head('PETS', `${s.pets.length}/${CAPS.petInventory} · Team ${s.equipped.length}/${slots}`)}
      <div class="toolbar">
        <button class="btn primary" data-act="equipbest" title="Equips the pets with the highest dig bonus. Situational utilities are not considered.${s.settings.keepFavorites ? ' Equipped favorites stay.' : ''}">🐾 Equip Best</button>
        <label>Sort <select data-act="sort"><option value="best" ${this.petSort === 'best' ? 'selected' : ''}>Dig bonus</option><option value="level" ${this.petSort === 'level' ? 'selected' : ''}>Level</option><option value="newest" ${this.petSort === 'newest' ? 'selected' : ''}>Newest</option><option value="species" ${this.petSort === 'species' ? 'selected' : ''}>Species</option></select></label>
        <label>Show <select data-act="filter"><option value="all">All</option><option value="equipped" ${this.petFilter === 'equipped' ? 'selected' : ''}>Equipped</option><option value="favorites" ${this.petFilter === 'favorites' ? 'selected' : ''}>Favorites</option>${speciesOpts}</select></label>
      </div>
      <div class="teamline">Team dig bonus <b>+${pct(total)}</b>${team.digSum > CAPS.petDigBonus ? ' (capped at 75%)' : ''} · Utilities: ${esc(utilities)}</div>
      <div class="split"><div class="body grid">${empty}${cards}</div>${detail}</div>`;
  }
  private get panelData2(): string { return (this as any)._mergeEntry; }

  // ── Eggs ──
  private renderEggs(): string {
    const s = this.g.s;
    const full = s.pets.length >= CAPS.petInventory;
    const focus = this.panelData as string | null;
    const cards = EGGS.map((e) => {
      const open = s.unlocked.includes(e.biome);
      const pity = s.pity[e.id] ?? 0;
      const tokens = s.eggTokens[e.id] ?? 0;
      const featured = e.outcomes[e.featuredIndex];
      const guaranteedNext = pity >= CAPS.pityCount - 1;
      const odds = e.outcomes.map((o) => {
        const r = RARITY_INFO[o.rarity];
        const seen = s.seenEntries.includes(o.pet);
        return `<li style="--rc:${r.color}"><img alt="" class="${seen ? '' : 'unseen'}" src="${this.petIcon(o.pet)}"><span>${esc(PET_ENTRY_BY_ID[o.pet].name)}</span><em>${r.icon} ${o.weight}%</em></li>`;
      }).join('');
      return `<section class="egg-card ${focus === e.id ? 'focus' : ''} ${open ? '' : 'locked'}">
        <img class="egg-img" alt="" src="${this.eggIcon(e.id)}">
        <div class="egg-info">
          <h3>${e.name}</h3>
          ${open ? '' : `<p class="req">🔒 Unlock ${BIOMES[e.biome].name} to hatch</p>`}
          <ul class="odds">${odds}</ul>
          <div class="pity">${guaranteedNext ? `<b class="glow">★ Featured pet guaranteed next!</b>` : `Featured ${esc(PET_ENTRY_BY_ID[featured.pet].name)} guaranteed within <b>${CAPS.pityCount - pity}</b> hatches`}<div class="bar"><i style="width:${(pity / (CAPS.pityCount - 1)) * 100}%"></i></div><small>${pity}/${CAPS.pityCount - 1} hatches without it</small></div>
          <div class="row">
            <button class="btn primary" data-act="hatch" data-egg="${e.id}" ${!open || full ? 'disabled' : ''}>${s.coins >= e.cost ? '' : '🔒 '}Hatch · ${fmt(e.cost)} <img class="ci" alt="coins" src="${this.icons.coin}"></button>
            ${tokens > 0 ? `<button class="btn" data-act="hatchtoken" data-egg="${e.id}" ${!open || full ? 'disabled' : ''}>Use token (${tokens})</button>` : ''}
          </div>
          ${open && s.coins < e.cost ? `<small class="short">Need ${fmt(e.cost - s.coins)} more coins</small>` : ''}
        </div></section>`;
    }).join('');
    const starter = !s.starterHatched ? `<section class="egg-card starter"><img class="egg-img" alt="" src="${this.eggIcon('starter')}"><div class="egg-info"><h3>${STARTER_EGG.name} <span class="tagfree">FREE · Tutorial</span></h3><p>A one-time gift: always hatches a <b>Pebble Pup</b>. It is not a normal random egg and does not affect guarantee counters.</p>${s.stats.cells >= 5 ? '<button class="btn primary" data-act="starter">Hatch Starter Egg</button>' : `<p class="req">Break ${5 - s.stats.cells} more cells at the first dig site to reveal it.</p>`}</div></section>` : '';
    return `${this.head('EGGS', 'Base odds shown · each egg has its own guarantee counter')}
      ${full ? `<div class="warnbar">Pet inventory full (${CAPS.petInventory}). Release or merge pets before hatching.</div>` : ''}
      <div class="body eggs">${starter}${cards}</div>`;
  }

  // ── Upgrades ──
  private renderUpgrades(): string {
    const s = this.g.s;
    const tab = (this.panelData as string) || 'tools';
    const t = TOOLS[s.toolTier], nt = TOOLS[s.toolTier + 1];
    const b = BAGS[s.bagTier], nb = BAGS[s.bagTier + 1];
    const team = L.teamStats(s);
    let body = '';
    if (tab === 'tools') {
      body = `<div class="upg">
        <img alt="" src="${this.icons.shovel}">
        <div><h3>${t.name}</h3><p>Power <b>${t.power}</b> · Interval <b>${t.interval}s</b></p>
        ${nt ? `<p class="next">Next: <b>${nt.name}</b> — Power <b>${nt.power}</b> (+${nt.power - t.power}) · Interval <b>${nt.interval}s</b></p>
          <button class="btn primary" data-act="buytool" ${s.coins < nt.price ? 'disabled' : ''}>Upgrade · ${fmt(nt.price)} coins</button>${s.coins < nt.price ? `<small class="short">Need ${fmt(nt.price - s.coins)} more</small>` : ''}` : '<p class="next">Maximum tier reached!</p>'}
        </div></div>
        <div class="tiers">${TOOLS.map((x, i) => `<span class="${i <= s.toolTier ? 'own' : ''}" style="--tc:${x.color}">${x.name}<small>${x.power} pw</small></span>`).join('')}</div>
        <p class="note">Damage = tool power × material modifier × (1 + pet dig bonus, max +75%). Upgrades are permanent and equip immediately.</p>`;
    } else if (tab === 'bags') {
      body = `<div class="upg"><img alt="" src="${this.icons.bag}"><div><h3>${b.name}</h3><p>Capacity <b>${b.capacity}</b>${team.bag ? ` + ${team.bag} from Moss Turtle` : ''}</p>
        ${nb ? `<p class="next">Next: <b>${nb.name}</b> — Capacity <b>${nb.capacity}</b> (+${nb.capacity - b.capacity})</p><button class="btn primary" data-act="buybag" ${s.coins < nb.price ? 'disabled' : ''}>Upgrade · ${fmt(nb.price)} coins</button>${s.coins < nb.price ? `<small class="short">Need ${fmt(nb.price - s.coins)} more</small>` : ''}` : '<p class="next">Biggest bag owned!</p>'}
        </div></div><p class="note">Prices are the cost of that tier only. Treasures and relics never use bag space.</p>`;
    } else {
      const pickOpen = s.unlocked.includes(PICKAXE.requiresBiome);
      body = `<div class="upg"><img alt="" src="${this.icons.pickaxe}"><div><h3>Pickaxe</h3><p>Uses your tool tier's power and cadence: <b>+25%</b> vs mineral &amp; basalt cells, <b>−25%</b> vs soil. The shovel stays useful everywhere.</p>
          ${s.hasPickaxe ? '<p class="own">Owned · select with 2</p>' : `<button class="btn primary" data-act="buypick" ${!pickOpen || s.coins < PICKAXE.price ? 'disabled' : ''}>${pickOpen ? `Buy · ${fmt(PICKAXE.price)} coins` : '🔒 Unlocks with Crystal Hollow'}</button>`}</div></div>
        <div class="upg"><img alt="" src="${this.icons.lantern}"><div><h3>Lantern</h3><p>Toggle a warm light around you (slot 3). Areas stay readable without it.</p>
          ${s.hasLantern ? '<p class="own">Owned · toggle with 3</p>' : `<button class="btn primary" data-act="buylantern" ${s.coins < LANTERN.price ? 'disabled' : ''}>Buy · ${LANTERN.price} coins</button>`}</div></div>
        <div class="upg"><img alt="" src="${this.icons.scanner}"><div><h3>Echo Scanner</h3><p>Radius <b>${L.scanRadius(s, team)} m</b> · Cooldown <b>${L.scanCooldown(s, team).toFixed(1)} s</b>. Lantern Mole adds +2 m; Aurora Dragon cuts cooldown 20%.</p><p class="own">Always equipped · Q or slot 4</p></div></div>`;
    }
    return `${this.head('UPGRADES', `${fmt(s.coins)} coins`)}
      <nav class="tabs">${['tools', 'bags', 'gear'].map((x) => `<button class="tab ${tab === x ? 'on' : ''}" data-act="tab" data-tab="${x}">${x === 'tools' ? 'Shovel' : x === 'bags' ? 'Backpack' : 'Gear'}</button>`).join('')}</nav>
      <div class="body">${body}</div>`;
  }

  // ── Museum ──
  private renderMuseum(): string {
    const s = this.g.s;
    const sections = BIOME_ORDER.map((b) => {
      const items = COLLECTIBLES.filter((c) => c.biome === b);
      const relics = L.relicCount(s, b);
      const done = s.displaysClaimed.includes(b);
      const cells = items.map((c) => {
        const have = (s.collection[c.id] ?? 0) > 0;
        return `<div class="find ${have ? 'have' : 'missing'} ${c.kind}" title="${have ? esc(c.name) : 'Undiscovered'}"><img alt="" src="${this.icons[c.kind === 'relic' ? 'relic' : c.kind]}"><span>${have ? esc(c.name) : '???'}</span>${have && s.collection[c.id] > 1 ? `<em>×${s.collection[c.id]}</em>` : ''}</div>`;
      }).join('');
      return `<section class="museum-biome ${s.unlocked.includes(b) ? '' : 'dim'}"><h3>${BIOMES[b].name} <small>Relic display ${relics}/3 ${done ? '· ✔ Complete' : ''}</small></h3>
        <div class="finds">${cells}</div>
        <p class="note">${done ? (s.chambersClaimed.includes(b) ? 'Secret chamber cache claimed.' : 'Secret chamber is open — find it in the biome!') : 'Complete all 3 relic shards to earn 25 gems + coins and open this biome’s secret chamber.'}</p></section>`;
    }).join('');
    return `${this.head('MUSEUM', `${s.displaysClaimed.length}/4 displays`)}
      <div class="body">${sections}<p class="note">${s.finalClaimed ? '★ The Star Monument has crowned you an Aurora Explorer.' : 'Complete all four displays to awaken the Star Monument near camp.'}</p></div>`;
  }

  // ── Quests ──
  private renderQuests(): string {
    const s = this.g.s;
    const chain = QUEST_CHAIN.map((q, i) => `<li class="${i < s.questIndex ? 'done' : i === s.questIndex ? 'cur' : ''}">${i < s.questIndex ? '✔' : i === s.questIndex ? '▶' : '•'} ${esc(q.text)}${i === s.questIndex && q.target > 1 ? ` <b>${s.questProgress}/${q.target}</b>` : ''}<small>${[q.reward.coins ? `${q.reward.coins} coins` : '', q.reward.gems ? `${q.reward.gems} gems` : ''].filter(Boolean).join(' · ')}</small></li>`).join('');
    const ach = ACHIEVEMENTS.map((a) => {
      const v = Math.min(a.target, L.achievementStat(s, a.stat));
      const got = s.achievements.includes(a.id);
      return `<li class="${got ? 'done' : ''}"><b>${got ? '🏆' : '○'} ${a.name}</b> — ${a.text} <small>${got ? 'Earned' : `${fmt(v)}/${fmt(a.target)}`} · ${a.gems} gems</small></li>`;
    }).join('');
    const c = s.contract;
    return `${this.head('QUESTS')}<div class="body">
      <h3>Explorer's path</h3><ol class="chain">${chain}</ol>
      <h3>Expedition contract</h3>${c ? `<p>${esc(contractText(c))} — <b>${c.progress}/${c.target}</b></p>` : '<p class="note">No active contract. Pick one from Pip at camp.</p>'}
      <h3>Achievements</h3><ul class="ach">${ach}</ul></div>`;
  }

  // ── Settings ──
  private renderSettings(): string {
    const st = this.g.s.settings;
    const slider = (k: 'master' | 'music' | 'sfx', label: string) => `<label class="srow">${label}<input type="range" min="0" max="1" step="0.05" value="${st[k]}" data-set="${k}" aria-label="${label}"></label>`;
    const toggle = (k: keyof typeof st, label: string, dis = false) => `<label class="srow">${label}<input type="checkbox" data-set="${k}" ${st[k] ? 'checked' : ''} ${dis ? 'disabled' : ''}></label>`;
    const sm = this.g.saves;
    const saveInfo = sm.locked ? '⚠ Saving is paused because existing data could not be read safely.' : sm.lastError ? `⚠ Last save failed: ${esc(sm.lastError)}` : sm.lastSavedAt ? `Saved ${this.g.saves.backend.cloud ? 'via ' + esc(sm.backend.name) : 'locally on this device'} at ${new Date(sm.lastSavedAt).toLocaleTimeString()}` : 'Not saved yet';
    const canFast = this.g.s.starterHatched || this.g.s.stats.hatches > 0;
    return `${this.head('SETTINGS')}<div class="body settings">
      <h3>Audio</h3>${toggle('muted', 'Mute all sound')}${slider('master', 'Master volume')}${slider('music', 'Music')}${slider('sfx', 'Effects')}
      ${this.g.platform.muted ? '<p class="note">The platform has muted audio; that setting is respected separately.</p>' : ''}
      <h3>Graphics</h3>
      <label class="srow">Quality<select data-set="quality"><option value="low" ${st.quality === 'low' ? 'selected' : ''}>Low</option><option value="medium" ${st.quality === 'medium' ? 'selected' : ''}>Medium</option><option value="high" ${st.quality === 'high' ? 'selected' : ''}>High</option></select></label>
      ${toggle('particles', 'Decorative particles (important feedback always shows)')}${toggle('shake', 'Screen shake')}${toggle('reducedMotion', 'Reduced motion')}
      <h3>Gameplay</h3>${toggle('fastHatch', canFast ? 'Fast hatching (0.6 s)' : 'Fast hatching (after your first reveal)', !canFast)}${toggle('keepFavorites', 'Equip Best keeps equipped favorites')}
      ${import.meta.env.DEV || location.search.includes('debug') ? toggle('showFps', 'Performance overlay (dev)') : ''}
      <h3>Help</h3><button class="btn" data-act="help">Controls</button>
      <h3>Progress</h3><p class="note">${saveInfo}</p>
      <div class="danger-zone"><p>Erase all progress on this ${sm.backend.cloud ? 'account' : 'device'}. This cannot be undone.</p><button class="btn danger" data-act="resetask">Reset save…</button></div>
      <p class="note credits">DIGBOUND: Pet Explorers · original game · all models, sounds and music generated procedurally.</p></div>`;
  }

  private renderHelp(): string {
    const rows = [
      ['Move', 'WASD / Arrows', 'Left stick'], ['Look', 'Right-mouse drag · wheel zoom', 'Drag right side'], ['Dig', 'Hold left mouse on terrain', 'Hold Dig (center reticle)'],
      ['Jump', 'Space', 'Jump'], ['Sprint', 'Shift', 'Push stick far'], ['Interact / Uncover', 'E (hold to uncover)', 'Use'], ['Echo Scan', 'Q', 'Scan'],
      ['Return to camp', 'R', 'Camp button'], ['First / third person', 'V or scroll all the way in', 'Eye button'], ['Avatar designer', 'C', 'Avatar button'], ['Tools', '1–4', 'Tap hotbar'], ['Pets', 'P', 'Pets button'], ['Close / Settings', 'Esc', '✕ / ⚙'],
    ];
    return `${this.head('CONTROLS')}<div class="body"><table class="controls"><tr><th>Action</th><th>Desktop</th><th>Touch</th></tr>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</table>
      <button class="btn" data-act="back" data-to="settings">Back</button></div>`;
  }

  private renderConfirm(): string {
    const d = this.panelData as { title: string; text: string; ok: string; danger?: boolean };
    return `${this.head(esc(d.title))}<div class="body"><p>${d.text}</p><div class="row"><button class="btn ${d.danger ? 'danger' : 'primary'}" data-act="confirmok">${esc(d.ok)}</button><button class="btn" data-act="confirmno">Cancel</button></div></div>`;
  }

  confirm(title: string, text: string, ok: string, cb: () => void, danger = false, back: PanelName | null = null) {
    this.confirmCb = cb;
    this.open('confirm', { title, text, ok, danger, back });
  }

  // ── Sell ──
  private renderSell(): string {
    const s = this.g.s;
    const team = L.teamStats(s);
    const rows = Object.entries(s.bag).filter(([, n]) => n > 0).map(([id, n]) => {
      const m = MATERIAL_BY_ID[id];
      return `<tr><td><i class="sw" style="background:${m.color}"></i>${esc(m.name)}</td><td>${n}</td><td>${L.unitValue(m)}</td><td>${fmt(L.unitValue(m) * n)}</td></tr>`;
    }).join('');
    const base = Object.entries(s.bag).reduce((a, [id, n]) => a + L.unitValue(MATERIAL_BY_ID[id]) * n, 0);
    const total = L.bagSaleValue(s, team);
    return `${this.head("MARA'S TRADING POST")}<div class="body">
      ${rows ? `<table class="sell"><tr><th>Resource</th><th>Units</th><th>Each</th><th>Value</th></tr>${rows}</table>
      <p>Subtotal ${fmt(base)}${team.sale ? ` · Pebble Pup bonus +${pct(Math.min(0.5, team.sale))}` : ''}</p>
      <p class="total">Total: <b>${fmt(total)}</b> <img class="ci" alt="coins" src="${this.icons.coin}"></p>
      <p class="note">Only bag resources are sold. Tools, pets, eggs and relics are never included.</p>
      <button class="btn primary big" data-act="sell">Sell ${L.bagCount(s)} items</button>` : `<div class="empty"><img alt="" src="${this.icons.bag}"><p>Your backpack is empty. Dig at a site, then come back to sell.</p></div>`}
      </div>`;
  }

  // ── Gate ──
  private renderGate(): string {
    const s = this.g.s;
    const b = this.panelData as BiomeId;
    const def = BIOMES[b];
    const req = L.gateRequirement(s, b);
    const idx = BIOME_ORDER.indexOf(b);
    const prevOpen = s.unlocked.includes(BIOME_ORDER[idx - 1]);
    const rr = def.relicReq!;
    return `${this.head(def.name.toUpperCase())}<div class="body gate">
      <ul class="checks">
        <li class="${req.coinsOk ? 'ok' : ''}">${req.coinsOk ? '✔' : '✖'} ${fmt(def.unlockCost)} coins <small>(you have ${fmt(s.coins)})</small></li>
        <li class="${req.relicOk ? 'ok' : ''}">${req.relicOk ? '✔' : '✖'} ${rr.count >= 3 ? `Complete ${BIOMES[rr.biome].name} relic display` : `${rr.count} ${BIOMES[rr.biome].name} relic shard`} <small>(${L.relicCount(s, rr.biome)}/${rr.count})</small></li>
        ${!prevOpen ? `<li>✖ Open ${BIOMES[BIOME_ORDER[idx - 1]].name} first</li>` : ''}
      </ul>
      <p class="note">Coins are charged once; relics are never consumed. New egg: ${EGG_BY_ID[def.egg].name}.${b === 'crystal' ? ' Also unlocks a 3rd pet slot and the pickaxe.' : ''}</p>
      <button class="btn primary big" data-act="unlock" data-biome="${b}" ${req.missing.length || !prevOpen ? 'disabled' : ''}>${req.missing.length ? 'Needs ' + esc(req.missing.join(' + ')) : `Open gate · ${fmt(def.unlockCost)} coins`}</button></div>`;
  }

  // ── Contracts ──
  private renderContracts(): string {
    const s = this.g.s;
    const c = s.contract;
    if (c) {
      const r = L.contractReward(c);
      return `${this.head('EXPEDITION CONTRACT')}<div class="body"><p class="big">${esc(contractText(c))}</p><div class="bar"><i style="width:${(c.progress / c.target) * 100}%"></i></div><p>${c.progress}/${c.target}</p><p>Reward: <b>${fmt(r.coins)} coins</b> + <b>${r.gems} gems</b></p><button class="btn danger" data-act="abandon">Abandon contract</button></div>`;
    }
    const offers = L.contractOffers(s).map((o, i) => {
      const r = L.contractReward(o);
      return `<li><b>${esc(contractText(o))}</b><small>${fmt(r.coins)} coins + ${r.gems} gems</small><button class="btn primary" data-act="accept" data-i="${i}">Accept</button></li>`;
    }).join('');
    return `${this.head('EXPEDITION CONTRACTS', 'Pick one · repeatable')}<div class="body"><ul class="offers">${offers}</ul><p class="note">${s.contractsDone} contracts completed. Contract progress is tracked from the moment you accept.</p></div>`;
  }

  // ── Surveyor ──
  private renderSurveyor(): string {
    const s = this.g.s;
    const rows = this.g.world.sites.filter((x) => s.unlocked.includes(x.biome)).map((site) => {
      const touched = site.isTouched();
      const left = site.layout.treasures.filter((t) => !site.treasureClaimed(t)).length;
      return `<li><b>${BIOMES[site.biome].name} · Site ${['I', 'II', 'III'][site.index]}</b><small>${touched ? `Excavated · ${left} finds left` : 'Untouched'}</small>
        <button class="btn" data-act="renew" data-site="${site.id}" ${touched ? '' : 'disabled'}>${touched ? 'Renew' : 'Fresh'}</button></li>`;
    }).join('');
    return `${this.head("JUNO'S SURVEY OFFICE")}<div class="body"><p>Renewing refills a site with new soil and a <b>new set of buried finds</b> (a new seed). Untouched sites are left as they are. Missing relic shards always reappear in their site.</p><ul class="offers">${rows}</ul></div>`;
  }

  // ── Cosmetics ──
  private renderCosmetics(): string {
    const s = this.g.s;
    const items = COSMETICS.filter((c) => c.slot !== 'crown' || s.cosmetics.owned.includes(c.id)).map((c) => {
      const own = s.cosmetics.owned.includes(c.id);
      const worn = c.slot === 'crown' ? s.cosmetics.crown : s.cosmetics[c.slot] === c.id;
      return `<li><i class="sw big" style="background:${c.color}"></i><b>${esc(c.name)}</b><small>${c.slot}</small>
        ${own ? `<button class="btn ${worn ? '' : 'primary'}" data-act="wear" data-id="${c.id}">${worn ? (c.slot === 'crown' ? 'Hide' : 'Wearing') : 'Wear'}</button>` : `<button class="btn primary" data-act="buycos" data-id="${c.id}" ${s.gems < c.gems ? 'disabled' : ''}>${c.gems} gems</button>`}</li>`;
    }).join('');
    return `${this.head('OUTFITTER', `${fmt(s.gems)} gems`)}<div class="body"><p class="note">Gems come from discoveries, contracts and achievements. Cosmetics are purely visual.</p><ul class="offers">${items}</ul></div>`;
  }

  // ───────── hatch overlay ─────────
  showHatch(eggId: string, entry: string, isNew: boolean, rarity: Rarity, o: HatchOptions, onPhase: (p: HatchPhase) => void) {
    this.close();
    this.hatchActive = true;
    const e = PET_ENTRY_BY_ID[entry];
    const r = RARITY_INFO[rarity];
    const sp = SPECIES[e.species];
    const wrap = div('hatch');
    wrap.innerHTML = `<div class="stage" id="hstage"></div><div class="card hidden" id="hcard" style="--rc:${r.color}">
      ${isNew ? '<span class="new">New!</span>' : ''}<h2>${esc(e.name)}</h2><div class="tag">${r.icon} ${r.label}${e.variant ? ' · Variant' : ''}</div>
      <p>+${pct(sp.digBonus)} dig · ${esc(sp.utilityText)}</p>
      <div class="row"><button class="btn primary" id="hequip">Equip</button><button class="btn" id="hcont">Continue</button></div></div>`;
    this.root.appendChild(wrap);
    const stage = wrap.querySelector('#hstage') as HTMLElement;
    this.g.showcase.mount(stage);
    const card = wrap.querySelector('#hcard') as HTMLElement;
    const finish = (equip: boolean) => {
      if (!this.hatchActive) return;
      this.hatchActive = false;
      this.g.showcase.unmount();
      wrap.remove();
      this.g.finishHatch(equip);
    };
    const s = this.g.s;
    const ph = s.pendingHatch;
    const already = ph ? s.equipped.includes(ph.petId) : false;
    const eqBtn = wrap.querySelector('#hequip') as HTMLButtonElement;
    if (already) { eqBtn.textContent = 'Equipped ✓'; eqBtn.disabled = true; }
    else if (s.equipped.length >= L.equipSlots(s)) { eqBtn.textContent = 'Team full'; eqBtn.disabled = true; }
    eqBtn.addEventListener('click', () => finish(true));
    (wrap.querySelector('#hcont') as HTMLButtonElement).addEventListener('click', () => finish(false));
    this.g.showcase.playHatch(eggId, entry, false, r.color, o, onPhase).then(() => {
      card.classList.remove('hidden');
      (already || eqBtn.disabled ? wrap.querySelector('#hcont') as HTMLElement : eqBtn).focus();
    });
  }

  // ───────── panel events ─────────
  private onModalClick(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) { if (e.target === this.modal && this.panel !== 'confirm') this.close(); return; }
    if ((t as HTMLButtonElement).disabled) return;
    const s = this.g.s;
    const act = t.dataset.act!;
    const id = t.dataset.id ? +t.dataset.id : NaN;
    const fail = (r: { ok: boolean; reason?: string }) => { if (!r.ok) { this.toast(r.reason!, 'warn'); this.g.audio.play('deny'); return true; } return false; };
    switch (act) {
      case 'close': this.close(); return;
      case 'av': { const k = t.dataset.k as keyof AvatarLook; this.setAvatar({ [k]: t.dataset.v } as Partial<AvatarLook>); this.g.audio.play('pop'); break; }
      case 'avbuy': {
        const r = L.buyCosmetic(s, t.dataset.id!);
        if (!fail(r)) { this.g.audio.play('unlock'); this.setAvatar({ [t.dataset.k as keyof AvatarLook]: t.dataset.v } as Partial<AvatarLook>); this.g.changed(); }
        break;
      }
      case 'avrand': {
        const O = AVATAR_OPTIONS;
        const r = <T,>(l: readonly T[]) => l[Math.floor(Math.random() * l.length)];
        this.setAvatar({ skin: r(O.skin), face: r(O.face), hair: r(O.hair), hairColor: r(O.hairColor), outfit: r(O.outfit), top: r(O.top), inner: r(O.inner), pants: r(O.pants), shoes: r(O.shoes), scarf: r(O.scarf), hat: r(O.hat), hatColor: r(O.hatColor) });
        this.g.audio.play('pop');
        break;
      }
      case 'avreset': this.setAvatar({ ...DEFAULT_AVATAR }); break;
      case 'inspect': this.inspectId = id; this.g.audio.play('click'); break;
      case 'equip': if (!fail(L.equipPet(s, id))) { this.g.syncPets(); this.g.changed(); } break;
      case 'unequip': L.unequipPet(s, id); this.g.syncPets(); this.g.changed(); break;
      case 'lock': L.toggleLock(s, id); this.g.changed(); break;
      case 'equipbest': L.equipBest(s); this.g.syncPets(); this.g.audio.play('levelup'); this.g.changed(); break;
      case 'release': {
        const p = s.pets.find((x) => x.id === id);
        if (!p) break;
        this.confirm('Release pet?', `Release <b>${esc(PET_ENTRY_BY_ID[p.entry].name)}</b> (Lv ${p.level}) for ${10 * p.level} coins? This cannot be undone.`, 'Release', () => { const r = L.releasePet(s, id); if (!fail(r)) { this.inspectId = null; this.g.changed(); } this.open('pets'); }, true, 'pets');
        return;
      }
      case 'mergemode': (this as any)._mergeEntry = t.dataset.entry; this.panelData = 'merge'; this.mergeSel = []; break;
      case 'mergepick': {
        const p = s.pets.find((x) => x.id === id);
        if (!p) break;
        const ok = L.mergeCandidates(s, (this as any)._mergeEntry).some((c) => c.id === id);
        if (!ok) { this.toast('Only unlocked, unequipped, non-shiny copies of this pet can be merged.', 'warn'); break; }
        this.mergeSel = this.mergeSel.includes(id) ? this.mergeSel.filter((x) => x !== id) : this.mergeSel.length < 3 ? [...this.mergeSel, id] : this.mergeSel;
        break;
      }
      case 'mergedo': {
        const ids = [...this.mergeSel];
        const names = ids.map((x) => s.pets.find((p) => p.id === x)).map((p) => `${PET_ENTRY_BY_ID[p!.entry].name} Lv ${p!.level}`).join(', ');
        this.confirm('Merge into Shiny?', `These will be consumed: <b>${esc(names)}</b>. You get one ✨ Shiny copy with the highest level/XP.`, 'Merge', () => {
          const r = L.mergePets(s, ids);
          if (!fail(r) && r.ok) { this.g.audio.play('reveal'); this.inspectId = r.petId; this.toast('✨ Shiny pet created!', 'good'); this.g.changed(); }
          this.mergeSel = [];
          this.open('pets');
        }, false, 'pets');
        return;
      }
      case 'mergecancel': this.panelData = null; this.mergeSel = []; break;
      case 'hatch': this.close(); this.g.hatch(t.dataset.egg!, false); return;
      case 'hatchtoken': this.close(); this.g.hatch(t.dataset.egg!, true); return;
      case 'starter': this.close(); this.g.hatchStarter(); return;
      case 'tab': this.panelData = t.dataset.tab; break;
      case 'buytool': if (!fail(L.buyTool(s))) { this.g.audio.play('unlock'); this.g.refreshTool(); this.toast(`${TOOLS[s.toolTier].name} equipped!`, 'good'); this.g.changed(); } break;
      case 'buybag': if (!fail(L.buyBag(s))) { this.g.audio.play('unlock'); this.g.changed(); } break;
      case 'buypick': if (!fail(L.buyPickaxe(s))) { this.g.audio.play('unlock'); this.g.changed(); } break;
      case 'buylantern': if (!fail(L.buyLantern(s))) { this.g.audio.play('unlock'); this.g.changed(); } break;
      case 'sell': this.g.sell(); break;
      case 'unlock': if (this.g.unlockGate(t.dataset.biome as BiomeId)) { this.close(); return; } break;
      case 'accept': if (!fail(L.acceptContract(s, +t.dataset.i!))) { this.g.audio.play('click'); this.g.changed(); } break;
      case 'abandon': this.confirm('Abandon contract?', 'Progress on this contract will be lost.', 'Abandon', () => { L.abandonContract(s); this.g.changed(); this.open('contracts'); }, true, 'contracts'); return;
      case 'renew': {
        const sid = t.dataset.site!;
        this.confirm('Renew this site?', 'All digging there resets and its buried finds change to a new set.', 'Renew', () => { this.g.renewSite(sid); this.open('surveyor'); }, false, 'surveyor');
        return;
      }
      case 'buycos': if (!fail(L.buyCosmetic(s, t.dataset.id!))) { this.g.audio.play('unlock'); this.wear(t.dataset.id!); this.g.changed(); } break;
      case 'wear': this.wear(t.dataset.id!); this.g.changed(); break;
      case 'help': this.open('help'); return;
      case 'back': this.open(t.dataset.to as PanelName); return;
      case 'resetask': this.confirm('Reset all progress?', 'This permanently erases coins, pets, eggs, museum finds and settings. There is no undo.', 'Erase everything', () => this.g.resetSave(), true, 'settings'); return;
      case 'confirmok': { const cb = this.confirmCb; this.confirmCb = null; cb?.(); return; }
      case 'confirmno': { const back = this.panelData?.back; this.confirmCb = null; if (back) this.open(back); else this.close(); return; }
    }
    this.render();
  }

  private wear(id: string) {
    const c = COSMETICS.find((x) => x.id === id)!;
    const s = this.g.s;
    if (c.slot === 'crown') s.cosmetics.crown = !s.cosmetics.crown;
    else s.cosmetics[c.slot] = id;
    this.g.refreshPlayerLook();
  }

  private onModalChange(e: Event) {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const act = t.dataset.act;
    if (act === 'avpack') { this.setAvatar({ backpack: (t as HTMLInputElement).checked }); this.render(); return; }
    if (act === 'avcrown') { this.g.s.cosmetics.crown = (t as HTMLInputElement).checked; this.g.refreshPlayerLook(); this.g.persist(); this.render(); return; }
    if (act === 'sort') { this.petSort = t.value as any; this.render(); return; }
    if (act === 'filter') { this.petFilter = t.value; this.render(); return; }
    const key = t.dataset.set as keyof typeof this.g.s.settings | undefined;
    if (!key) return;
    const st = this.g.s.settings as any;
    if (t instanceof HTMLInputElement && t.type === 'checkbox') st[key] = t.checked;
    else if (t instanceof HTMLInputElement && t.type === 'range') st[key] = +t.value;
    else st[key] = t.value;
    this.g.applySettings();
    if (key === 'showFps' && !st.showFps) this.els.debug.classList.add('hidden');
    this.g.persist();
    this.updateHud();
  }

  private onModalInput(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.type === 'range' && t.dataset.set) {
      (this.g.s.settings as any)[t.dataset.set] = +t.value;
      this.g.applySettings();
    }
  }
}

const SVG_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="#fff"/><circle cx="12" cy="12" r="3.6" fill="#2563d4"/><circle cx="13.2" cy="10.8" r="1.2" fill="#fff"/></svg>';

function div(cls: string) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

import { MATERIALS } from '../data/balance';
function matId(i: number) { return MATERIALS[i].id; }

export function contractText(c: { kind: string; biome: BiomeId; material?: string; target: number }) {
  if (c.kind === 'resource') return `Collect ${c.target} ${MATERIAL_BY_ID[c.material!].name} (${BIOMES[c.biome].name})`;
  if (c.kind === 'cache') return `Uncover ${c.target} buried finds in ${BIOMES[c.biome].name}`;
  return `Recover a ${BIOMES[c.biome].name} relic duplicate`;
}

void PET_ENTRIES;
