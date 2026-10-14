/**
 * AudioManager: all sounds are synthesized at runtime with WebAudio (original,
 * no external assets → no licensing concerns, zero download). Voice-limited,
 * slight random variation on repeated sounds, light generative music and
 * biome ambience. Starts only after a user gesture; honors both the user mute
 * and the platform mute flag independently.
 */
export type Sfx = 'soil' | 'rock' | 'crystal' | 'break' | 'coin' | 'crack' | 'reveal' | 'hover' | 'click' | 'scan' | 'ping' | 'deny' | 'treasure' | 'levelup' | 'unlock' | 'hatchRumble' | 'pop';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private voices = 0;
  private readonly maxVoices = 14;
  private userMuted = false;
  private platformMuted = false;
  private suspendedByPause = false;
  private vol = { master: 0.8, music: 0.45, sfx: 0.8 };
  private musicTimer = 0;
  private musicStep = 0;
  private biome = 'meadow';
  private ambFilter: BiquadFilterNode | null = null;
  private birdTimer = 3;

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.ambBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.ambBus.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbience();
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended' && !this.suspendedByPause) this.ctx.resume().catch(() => {});
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  setVolumes(master: number, music: number, sfx: number) {
    this.vol = { master, music, sfx };
    this.applyVolumes();
  }
  setUserMuted(m: boolean) { this.userMuted = m; this.applyVolumes(); }
  setPlatformMuted(m: boolean) { this.platformMuted = m; this.applyVolumes(); }
  get muted() { return this.userMuted || this.platformMuted; }

  /** Pause audio for ads / hidden tab; independent of mute flags. */
  setSuspended(s: boolean) {
    this.suspendedByPause = s;
    if (!this.ctx) return;
    if (s) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : this.vol.master;
    this.master.gain.setTargetAtTime(m, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.35, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.sfx * 0.18, t, 0.05);
  }

  setBiome(b: string) {
    if (b === this.biome) return;
    this.biome = b;
    if (this.ambFilter && this.ctx) {
      const f = b === 'ember' ? 500 : b === 'crystal' ? 1800 : b === 'aurora' ? 900 : 1200;
      this.ambFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.5);
    }
  }

  private startAmbience() {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    const g = c.createGain();
    g.gain.value = 0.35;
    src.connect(f).connect(g).connect(this.ambBus);
    src.start();
    this.ambFilter = f;
  }

  /** Per-frame: schedule generative music + occasional ambience accents. */
  update(dt: number) {
    if (!this.ready) return;
    this.musicTimer -= dt;
    if (this.musicTimer <= 0) {
      this.musicTimer = 0.42;
      this.musicNote();
    }
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 4 + Math.random() * 7;
      if (this.biome === 'meadow') this.chirp();
      else if (this.biome === 'crystal' || this.biome === 'aurora') this.tone(1400 + Math.random() * 800, 0.6, 'sine', 0.04, this.ambBus);
    }
  }

  private musicNote() {
    const scales: Record<string, number[]> = {
      meadow: [0, 2, 4, 7, 9, 12, 14],
      crystal: [0, 3, 5, 7, 10, 12, 15],
      ember: [0, 1, 5, 7, 8, 12, 13],
      aurora: [0, 2, 5, 7, 9, 12, 17],
    };
    const root = this.biome === 'ember' ? 196 : this.biome === 'aurora' ? 220 : this.biome === 'crystal' ? 233 : 262;
    const sc = scales[this.biome] ?? scales.meadow;
    const step = this.musicStep++;
    const bar = Math.floor(step / 8) % 4;
    const chordRoots = [0, 5, 3, 4];
    if (step % 8 === 0) {
      const base = root / 2 * Math.pow(2, sc[chordRoots[bar] % sc.length] / 12);
      this.tone(base, 3.0, 'triangle', 0.09, this.musicBus, 0.4);
      this.tone(base * 1.5, 3.0, 'sine', 0.05, this.musicBus, 0.6);
    }
    if (Math.random() < 0.62) {
      const n = sc[(step * 3 + bar * 2 + Math.floor(Math.random() * 3)) % sc.length];
      this.tone(root * Math.pow(2, n / 12), 0.5, 'sine', 0.07, this.musicBus, 0.01);
    }
  }

  private chirp() {
    const c = this.ctx!;
    const t = c.currentTime;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      const o = c.createOscillator();
      const g = c.createGain();
      const f = 2400 + Math.random() * 1200;
      o.frequency.setValueAtTime(f, t + i * 0.12);
      o.frequency.exponentialRampToValueAtTime(f * 1.4, t + i * 0.12 + 0.06);
      g.gain.setValueAtTime(0, t + i * 0.12);
      g.gain.linearRampToValueAtTime(0.05, t + i * 0.12 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.08);
      o.connect(g).connect(this.ambBus);
      o.start(t + i * 0.12);
      o.stop(t + i * 0.12 + 0.1);
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, bus: AudioNode, attack = 0.005, slideTo?: number) {
    const c = this.ctx!;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', delay = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  play(name: Sfx, intensity = 1) {
    if (!this.ready || this.voices >= this.maxVoices) return;
    this.voices++;
    setTimeout(() => this.voices--, 250);
    const v = 0.92 + Math.random() * 0.16; // pitch variation
    switch (name) {
      case 'soil':
        this.noise(0.16, 380 * v, 1.2, 0.55 * intensity, 'lowpass');
        this.tone(90 * v, 0.12, 'sine', 0.35 * intensity, this.sfxBus, 0.002, 55);
        break;
      case 'rock':
        this.noise(0.08, 2200 * v, 3, 0.35 * intensity);
        this.tone(320 * v, 0.09, 'square', 0.05 * intensity, this.sfxBus, 0.001, 200);
        break;
      case 'crystal':
        this.noise(0.05, 4000, 4, 0.2);
        this.tone(1568 * v, 0.35, 'sine', 0.14, this.sfxBus, 0.001);
        this.tone(2349 * v, 0.25, 'sine', 0.07, this.sfxBus, 0.001);
        break;
      case 'break':
        this.noise(0.28, 600 * v, 0.8, 0.6 * intensity, 'lowpass');
        this.tone(140 * v, 0.2, 'triangle', 0.25, this.sfxBus, 0.002, 60);
        this.tone(700 * v, 0.06, 'sine', 0.08, this.sfxBus, 0.001, 1100);
        break;
      case 'coin':
        this.tone(988 * v, 0.08, 'square', 0.06, this.sfxBus, 0.001);
        setTimeout(() => this.ready && this.tone(1319 * v, 0.22, 'square', 0.06, this.sfxBus, 0.001), 70);
        break;
      case 'crack':
        this.noise(0.12, 3000 * v, 2, 0.4);
        this.tone(500 * v, 0.06, 'sawtooth', 0.05, this.sfxBus, 0.001, 300);
        break;
      case 'hatchRumble':
        this.noise(0.5, 200, 1, 0.3, 'lowpass');
        break;
      case 'reveal':
        [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.ready && this.tone(f, 0.5, 'triangle', 0.12, this.sfxBus, 0.005), i * 90));
        this.noise(0.6, 5000, 0.5, 0.12, 'highpass');
        break;
      case 'treasure':
        [659, 784, 988, 1319].forEach((f, i) => setTimeout(() => this.ready && this.tone(f, 0.35, 'sine', 0.13, this.sfxBus, 0.004), i * 70));
        break;
      case 'levelup':
        [523, 784, 1047].forEach((f, i) => setTimeout(() => this.ready && this.tone(f, 0.3, 'triangle', 0.1, this.sfxBus), i * 60));
        break;
      case 'unlock':
        [392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.ready && this.tone(f, 0.6, 'triangle', 0.11, this.sfxBus), i * 110));
        break;
      case 'hover':
        this.tone(1200, 0.04, 'sine', 0.03, this.sfxBus, 0.001);
        break;
      case 'click':
        this.tone(700, 0.06, 'triangle', 0.08, this.sfxBus, 0.001, 900);
        break;
      case 'pop':
        this.tone(400 * v, 0.1, 'sine', 0.12, this.sfxBus, 0.001, 900);
        break;
      case 'deny':
        this.tone(220, 0.14, 'square', 0.05, this.sfxBus, 0.001, 160);
        break;
      case 'scan':
        this.tone(420, 0.9, 'sine', 0.12, this.sfxBus, 0.01, 1300);
        this.tone(630, 0.7, 'sine', 0.05, this.sfxBus, 0.05, 1600);
        break;
      case 'ping':
        this.tone(1600 + intensity * 500, 0.12, 'sine', 0.05 + intensity * 0.06, this.sfxBus, 0.002);
        break;
    }
  }
}
