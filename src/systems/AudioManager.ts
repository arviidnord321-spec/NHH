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
    const song = this.song();
    const s16 = 60 / song.bpm / 4;
    while (this.nextStepTime < c.currentTime + 0.2) {
      this.funkStep(this.musicStep, this.nextStepTime, s16);
      // swung 16ths
      this.nextStepTime += this.musicStep % 2 === 0 ? s16 * 1.12 : s16 * 0.88;
      this.musicStep++;
    }
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 4 + Math.random() * 7;
      if (this.biome === 'meadow') this.chirp();
      else if (this.biome === 'crystal' || this.biome === 'aurora') this.tone(1400 + Math.random() * 800, 0.6, 'sine', 0.04, this.ambBus);
    }
  }

  // ───────── funky soundtrack ─────────
  private musicIn: GainNode | null = null;
  private pump: GainNode | null = null;
  private delayIn: GainNode | null = null;
  private wahFilter: BiquadFilterNode | null = null;
  private nextStepTime = 0;

  /** music → pump (sidechain duck) → glue filter → dry + reverb; separate ping-pong delay send */
  private buildMusicChain() {
    const c = this.ctx!;
    const input = c.createGain();
    const pump = c.createGain();
    const glue = c.createBiquadFilter();
    glue.type = 'lowpass';
    glue.frequency.value = 9000;
    input.connect(pump).connect(glue).connect(this.musicBus);
    // short plate-ish reverb
    const len = Math.floor(c.sampleRate * 1.6);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.5);
    }
    const verb = c.createConvolver();
    verb.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.22;
    glue.connect(verb).connect(wet).connect(this.musicBus);
    // ping-pong delay send (dotted 8th)
    const dIn = c.createGain();
    const dl = c.createDelay(1.5), dr = c.createDelay(1.5);
    const fb = c.createGain();
    fb.gain.value = 0.38;
    const dTone = c.createBiquadFilter();
    dTone.type = 'bandpass';
    dTone.frequency.value = 1800;
    dTone.Q.value = 0.6;
    const pl = c.createStereoPanner(), pr = c.createStereoPanner();
    pl.pan.value = -0.7; pr.pan.value = 0.7;
    dIn.connect(dTone).connect(dl);
    dl.connect(pl).connect(this.musicBus);
    dl.connect(dr);
    dr.connect(pr).connect(this.musicBus);
    dr.connect(fb).connect(dl);
    this.delayIn = dIn;
    // auto-wah shared by the clav stabs
    const wah = c.createBiquadFilter();
    wah.type = 'bandpass';
    wah.Q.value = 4;
    wah.frequency.value = 900;
    const wahLfo = c.createOscillator();
    wahLfo.frequency.value = 2.2;
    const wahDepth = c.createGain();
    wahDepth.gain.value = 650;
    wahLfo.connect(wahDepth).connect(wah.frequency);
    wahLfo.start();
    wah.connect(input);
    this.wahFilter = wah;
    this.musicIn = input;
    this.pump = pump;
  }

  private static readonly SONGS: Record<string, { bpm: number; root: number; chords: number[][]; bass: number[]; hook: number[] }> = {
    // chords: 4 bars of stab voicings (semitones from root); bass: 16-step riff (scale degrees in semitones, -99 = rest)
    meadow: { bpm: 104, root: 45, chords: [[7, 10, 14, 17], [5, 9, 12, 16], [7, 10, 14, 17], [2, 5, 9, 12]], bass: [0, -99, 12, 0, -99, 10, -99, 12, 0, -99, 7, -99, 10, 12, -99, 3], hook: [12, -99, 15, 17, -99, 15, 12, -99, 10, 12, -99, -99, 7, -99, 10, -99] },
    crystal: { bpm: 98, root: 43, chords: [[3, 7, 10, 14], [5, 8, 12, 15], [3, 7, 10, 14], [-2, 2, 5, 9]], bass: [0, -99, 0, 12, -99, 10, 7, -99, 0, -99, 12, -99, 10, -99, 7, 5], hook: [19, -99, 17, 15, -99, 14, -99, 15, 12, -99, -99, 10, 12, -99, -99, -99] },
    ember: { bpm: 112, root: 40, chords: [[7, 10, 13, 17], [5, 8, 12, 15], [3, 7, 10, 13], [5, 8, 12, 15]], bass: [0, 0, -99, 12, -99, 0, 10, -99, 0, -99, 7, 8, -99, 10, -99, 12], hook: [12, 13, -99, 12, 10, -99, 7, -99, 12, -99, 15, -99, 13, 12, -99, -99] },
    aurora: { bpm: 96, root: 47, chords: [[4, 7, 11, 14], [2, 5, 9, 12], [0, 4, 7, 11], [2, 5, 9, 12]], bass: [0, -99, -99, 7, -99, 12, -99, 7, 0, -99, -99, 5, -99, 7, 9, -99], hook: [16, -99, 14, -99, 11, -99, 14, 16, -99, -99, 19, -99, 16, -99, 14, -99] },
  };
  private song() { return AudioManager.SONGS[this.biome] ?? AudioManager.SONGS.meadow; }
  private midi(n: number) { return 440 * Math.pow(2, (n - 69) / 12); }

  private funkStep(step: number, t: number, s16: number) {
    const S = this.song();
    const pos = step % 16;
    const bar = Math.floor(step / 16);
    const phrase = bar % 8;
    const chord = S.chords[bar % 4];
    const fill = phrase === 7 && pos >= 12;
    // ── drums
    const kickPat = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
    if (kickPat[pos] || (pos === 15 && bar % 2 === 1)) { this.kick(t, 0.5); this.duck(t); }
    if (pos === 4 || pos === 12) { this.snare(t, 0.28); this.clap(t + 0.004, 0.16); }
    if ((pos === 7 || pos === 9 || pos === 14) && Math.random() < 0.55) this.snare(t, 0.06);
    if (fill && pos % 1 === 0) this.snare(t, 0.08 + (pos - 12) * 0.05);
    const hatVol = pos % 4 === 2 ? 0.07 : pos % 2 ? 0.03 : 0.045;
    if (pos === 6 || pos === 14) this.hat(t, 0.06, 0.22); else this.hat(t, hatVol, 0.04);
    if (pos % 2 === 1) this.shaker(t, 0.025);
    if (phrase === 0 && pos === 0 && step > 0) this.crash(t, 0.16);
    if (phrase === 7 && pos === 0) this.riser(t, s16 * 16);
    // ── slap synth bass
    const bn = S.bass[pos];
    if (bn !== -99 && !(fill && pos > 13)) this.funkBass(this.midi(S.root - 12 + chord[0] - 7 + bn), t, s16 * (S.bass[(pos + 1) % 16] === -99 ? 1.6 : 0.9), bn >= 12 ? 0.22 : 0.26);
    // ── clav stabs on the off-beats
    if (pos === 2 || pos === 7 || pos === 10 || (pos === 15 && bar % 2 === 0)) chord.forEach((n) => this.clav(this.midi(S.root + 12 + n), t, s16 * 0.9, 0.035));
    // ── warm pad on bar starts
    if (pos === 0) chord.forEach((n, i) => this.pad(this.midi(S.root + 12 + n), t + i * 0.01, s16 * 15, 0.018));
    // ── lead hook: plays on bars 3-4 and 7 of each phrase, answered by the delay
    const hookBar = phrase === 2 || phrase === 3 || phrase === 6;
    const hn = S.hook[pos];
    if (hookBar && hn !== -99) this.lead(this.midi(S.root + 24 + hn), t, s16 * 1.8, 0.055);
    // ── sparkle arps in the breakdown bars
    if ((phrase === 4 || phrase === 5) && pos % 2 === 0) {
      const n = chord[(pos / 2) % chord.length];
      this.pluck(this.midi(S.root + 24 + n + (pos >= 8 ? 12 : 0)), t, 0.028);
    }
  }

  private env(g: GainNode, t: number, a: number, peak: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  /** sidechain-style pump on every kick */
  private duck(t: number) {
    const g = this.pump!.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.55, t);
    g.linearRampToValueAtTime(1, t + 0.18);
  }

  private funkBass(f: number, t: number, dur: number, vol: number) {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = f;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 9;
    fl.frequency.setValueAtTime(2400, t);
    fl.frequency.exponentialRampToValueAtTime(260, t + 0.12);
    const g = c.createGain();
    this.env(g, t, 0.004, vol, dur);
    const sg = c.createGain(); sg.gain.value = 0.9;
    o.connect(fl).connect(g);
    sub.connect(sg).connect(g);
    g.connect(this.musicIn!);
    for (const x of [o, sub]) { x.start(t); x.stop(t + dur + 0.05); }
  }

  private clav(f: number, t: number, dur: number, vol: number) {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const g = c.createGain();
    this.env(g, t, 0.003, vol, dur);
    o.connect(g).connect(this.wahFilter!);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private pad(f: number, t: number, dur: number, vol: number) {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const det of [-7, 7]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1400;
      o.connect(fl).connect(g);
      o.start(t); o.stop(t + dur + 0.05);
    }
    g.connect(this.musicIn!);
  }

  private lead(f: number, t: number, dur: number, vol: number) {
    const c = this.ctx!;
    const g = c.createGain();
    this.env(g, t, 0.008, vol, dur + 0.15);
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const g2 = c.createGain(); g2.gain.value = 0.35;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 3200;
    const vib = c.createOscillator(); vib.frequency.value = 5.5;
    const vg = c.createGain(); vg.gain.value = f * 0.006;
    vib.connect(vg).connect(o.frequency);
    // little pitch scoop into each note
    o.frequency.setValueAtTime(f * 0.94, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    o.connect(fl); o2.connect(g2).connect(fl);
    fl.connect(g);
    g.connect(this.musicIn!);
    const send = c.createGain(); send.gain.value = 0.6;
    g.connect(send).connect(this.delayIn!);
    for (const x of [o, o2, vib]) { x.start(t); x.stop(t + dur + 0.2); }
  }

  private pluck(f: number, t: number, vol: number) {
    const c = this.ctx!;
    const g = c.createGain();
    this.env(g, t, 0.002, vol, 0.35);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    o.connect(g).connect(this.musicIn!);
    const send = c.createGain(); send.gain.value = 0.8;
    g.connect(send).connect(this.delayIn!);
    o.start(t); o.stop(t + 0.4);
  }

  private kick(t: number, vol: number) {
    const c = this.ctx!;
    const g = c.createGain();
    this.env(g, t, 0.002, vol, 0.3);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    o.connect(g).connect(this.musicIn!);
    o.start(t); o.stop(t + 0.32);
  }

  private noiseHit(t: number, vol: number, dur: number, type: BiquadFilterType, freq: number, q = 0.8) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, 0.002, vol, dur);
    src.connect(f).connect(g).connect(this.musicIn!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
  private snare(t: number, vol: number) {
    this.noiseHit(t, vol, 0.16, 'bandpass', 1800, 0.7);
    const c = this.ctx!;
    const g = c.createGain();
    this.env(g, t, 0.002, vol * 0.5, 0.09);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    o.connect(g).connect(this.musicIn!);
    o.start(t); o.stop(t + 0.1);
  }
  private clap(t: number, vol: number) { for (let i = 0; i < 3; i++) this.noiseHit(t + i * 0.011, vol * (i === 2 ? 1 : 0.6), i === 2 ? 0.14 : 0.02, 'bandpass', 1300, 1.4); }
  private hat(t: number, vol: number, dur: number) { this.noiseHit(t, vol, dur, 'highpass', 8000); }
  private shaker(t: number, vol: number) { this.noiseHit(t, vol, 0.05, 'bandpass', 6000, 1.2); }
  private crash(t: number, vol: number) { this.noiseHit(t, vol, 1.4, 'highpass', 5000, 0.4); }
  private riser(t: number, dur: number) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    src.connect(f).connect(g).connect(this.musicIn!);
    src.start(t); src.stop(t + dur + 0.1);
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
