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
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.9, t, 0.05);
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

  /** Per-frame: schedule the lo-fi music ahead of time + ambience accents. */
  update(dt: number) {
    if (!this.ready) return;
    const c = this.ctx!;
    if (!this.musicIn) this.buildMusicChain();
    if (this.nextStepTime < c.currentTime) this.nextStepTime = c.currentTime + 0.05;
    while (this.nextStepTime < c.currentTime + 0.25) {
      this.musicStepAt(this.musicStep, this.nextStepTime);
      // swung 8ths at ~76 BPM
      const eighth = 60 / 76 / 2;
      this.nextStepTime += this.musicStep % 2 === 0 ? eighth * 1.16 : eighth * 0.84;
      this.musicStep++;
    }
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 4 + Math.random() * 7;
      if (this.biome === 'meadow') this.chirp();
      else if (this.biome === 'crystal' || this.biome === 'aurora') this.tone(1400 + Math.random() * 800, 0.6, 'sine', 0.04, this.ambBus);
    }
  }

  // ───────── lo-fi music ─────────
  private musicIn: GainNode | null = null;
  private nextStepTime = 0;

  /** music bus → warm low-pass → dry + small generated-impulse reverb; plus faint vinyl crackle */
  private buildMusicChain() {
    const c = this.ctx!;
    const input = c.createGain();
    const warm = c.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 2600;
    warm.Q.value = 0.4;
    input.connect(warm);
    warm.connect(this.musicBus);
    const len = Math.floor(c.sampleRate * 2.4);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const verb = c.createConvolver();
    verb.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.32;
    warm.connect(verb).connect(wet).connect(this.musicBus);
    // vinyl crackle: sparse clicks through a band-pass
    const cl = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const cd = cl.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.8 : (Math.random() * 2 - 1) * 0.012;
    const crackle = c.createBufferSource();
    crackle.buffer = cl;
    crackle.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    const cg = c.createGain();
    cg.gain.value = 0.18;
    crackle.connect(bp).connect(cg).connect(this.musicBus);
    crackle.start();
    this.musicIn = input;
  }

  private static readonly PROG: Record<string, { root: number; chords: number[][]; scale: number[] }> = {
    // semitone offsets from root; 4 bars of 7th chords
    meadow: { root: 57, chords: [[5, 9, 12, 16], [4, 7, 11, 14], [2, 5, 9, 12], [0, 4, 7, 11]], scale: [0, 2, 4, 7, 9] },
    crystal: { root: 55, chords: [[0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14], [8, 12, 15, 19]], scale: [0, 3, 5, 7, 10] },
    ember: { root: 52, chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-2, 2, 5, 9], [-5, -1, 2, 5]], scale: [0, 3, 5, 7, 10] },
    aurora: { root: 59, chords: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]], scale: [0, 2, 4, 7, 9] },
  };

  private midi(n: number) { return 440 * Math.pow(2, (n - 69) / 12); }

  private musicStepAt(step: number, t: number) {
    const P = AudioManager.PROG[this.biome] ?? AudioManager.PROG.meadow;
    const bar = Math.floor(step / 8) % 4;
    const pos = step % 8;
    const chord = P.chords[bar];
    const base = P.root - 12;
    if (pos === 0) {
      // soft electric-piano chord, gently strummed
      chord.forEach((n, i) => this.keys(this.midi(base + 12 + n), t + i * 0.025, 3.0, 0.05));
      this.bass(this.midi(base - 12 + chord[0]), t, 1.4, 0.16);
    }
    if (pos === 4) {
      this.bass(this.midi(base - 12 + chord[0] + (bar % 2 ? 7 : 0)), t, 1.0, 0.12);
      if (Math.random() < 0.5) chord.slice(1).forEach((n, i) => this.keys(this.midi(base + 12 + n), t + i * 0.03, 1.6, 0.03));
    }
    // drums: kick on 1 & 3, brush on 2 & 4, quiet hats
    if (pos === 0 || pos === 4 || (pos === 7 && Math.random() < 0.25)) this.kick(t, pos === 7 ? 0.25 : 0.42);
    if (pos === 2 || pos === 6) this.brush(t, 0.14);
    this.hat(t, pos % 2 ? 0.035 : 0.055);
    // sparse pentatonic melody with an echo
    if ((pos === 1 || pos === 3 || pos === 6) && Math.random() < 0.38) {
      const deg = P.scale[Math.floor(Math.random() * P.scale.length)];
      const f = this.midi(P.root + 12 + deg + (Math.random() < 0.3 ? 12 : 0));
      this.lead(f, t, 0.045);
      this.lead(f, t + 0.395 * 1.5, 0.018);
    }
  }

  private env(g: GainNode, t: number, a: number, peak: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private keys(f: number, t: number, dur: number, vol: number) {
    const c = this.ctx!;
    const g = c.createGain();
    this.env(g, t, 0.012, vol, dur);
    const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2.001;
    const g2 = c.createGain(); g2.gain.value = 0.18;
    const trem = c.createOscillator(); trem.frequency.value = 4.5;
    const tg = c.createGain(); tg.gain.value = vol * 0.25;
    trem.connect(tg).connect(g.gain);
    o1.connect(g); o2.connect(g2).connect(g);
    g.connect(this.musicIn!);
    for (const o of [o1, o2, trem]) { o.start(t); o.stop(t + dur + 0.05); }
  }

  private bass(f: number, t: number, dur: number, vol: number) {
    const c = this.ctx!;
    const g = c.createGain();
    this.env(g, t, 0.02, vol, dur);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    o.connect(g).connect(this.musicIn!);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private lead(f: number, t: number, vol: number) {
    const c = this.ctx!;
    const g = c.createGain();
    this.env(g, t, 0.01, vol, 0.9);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const vib = c.createOscillator(); vib.frequency.value = 5;
    const vg = c.createGain(); vg.gain.value = f * 0.004;
    vib.connect(vg).connect(o.frequency);
    o.connect(g).connect(this.musicIn!);
    for (const x of [o, vib]) { x.start(t); x.stop(t + 1); }
  }

  private kick(t: number, vol: number) {
    const c = this.ctx!;
    const g = c.createGain();
    this.env(g, t, 0.004, vol, 0.32);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.18);
    o.connect(g).connect(this.musicIn!);
    o.start(t); o.stop(t + 0.35);
  }

  private noiseHit(t: number, vol: number, dur: number, type: BiquadFilterType, freq: number) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain();
    this.env(g, t, 0.006, vol, dur);
    src.connect(f).connect(g).connect(this.musicIn!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
  private brush(t: number, vol: number) { this.noiseHit(t, vol, 0.22, 'bandpass', 1900); }
  private hat(t: number, vol: number) { this.noiseHit(t, vol, 0.05, 'highpass', 7500); }

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
