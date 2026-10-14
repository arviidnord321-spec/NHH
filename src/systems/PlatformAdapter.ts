/**
 * PlatformAdapter: one interface, two implementations.
 *  - CrazyGamesAdapter: wraps the CrazyGames HTML5 SDK v3 (lifecycle, mute
 *    setting, Data module for saves, auth changes, rewarded ads).
 *  - LocalAdapter: off-platform development (localStorage, no ads).
 * Lifecycle calls are de-duplicated so gameplayStart/Stop fire once per
 * transition. NOTE: the official docs could not be fetched while building
 * this; API names follow SDK v3 and are feature-detected. Re-verify against
 * https://docs.crazygames.com/sdk/ before submission.
 */
export interface StorageBackend {
  name: string;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** true when data is synced off-device by the backend */
  cloud: boolean;
}

export interface Platform {
  name: 'crazygames' | 'local';
  storage: StorageBackend;
  muted: boolean;
  init(): Promise<void>;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  onMuteChange(cb: (muted: boolean) => void): void;
  onAuthChange(cb: () => void): void;
  /** Rewarded ad. Resolves true ONLY on successful completion. Disabled in this build. */
  rewardedAd(hooks: { started: () => void }): Promise<boolean>;
  adsEnabled: boolean;
}

class LocalStorageBackend implements StorageBackend {
  name = 'localStorage';
  cloud = false;
  async getItem(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
  async setItem(k: string, v: string) { localStorage.setItem(k, v); }
  async removeItem(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
}

class LocalAdapter implements Platform {
  name = 'local' as const;
  storage = new LocalStorageBackend();
  muted = false;
  adsEnabled = false;
  private playing = false;
  async init() {}
  loadingStop() {}
  gameplayStart() { if (!this.playing) { this.playing = true; if (import.meta.env.DEV) console.debug('[platform] gameplayStart'); } }
  gameplayStop() { if (this.playing) { this.playing = false; if (import.meta.env.DEV) console.debug('[platform] gameplayStop'); } }
  onMuteChange() {}
  onAuthChange() {}
  async rewardedAd() { return false; }
}

class CrazyGamesAdapter implements Platform {
  name = 'crazygames' as const;
  muted = false;
  adsEnabled = false; // first playable milestone: no ads
  private playing = false;
  private sdk: any;
  storage: StorageBackend;
  private muteCbs: ((m: boolean) => void)[] = [];
  private authCbs: (() => void)[] = [];

  constructor(sdk: any) {
    this.sdk = sdk;
    const data = sdk.data;
    this.storage = {
      name: 'CrazyGames Data',
      cloud: true,
      getItem: async (k) => { const v = await data.getItem(k); return v ?? null; },
      setItem: async (k, v) => { await data.setItem(k, v); },
      removeItem: async (k) => { await data.removeItem(k); },
    };
  }

  async init() {
    try { this.sdk.game?.loadingStart?.(); } catch { /* optional */ }
    const s = this.sdk.game?.settings;
    this.muted = !!s?.muteAudio;
    this.sdk.game?.addSettingsChangeListener?.((ns: any) => {
      this.muted = !!ns?.muteAudio;
      this.muteCbs.forEach((cb) => cb(this.muted));
    });
    this.sdk.user?.addAuthListener?.(() => this.authCbs.forEach((cb) => cb()));
  }
  loadingStop() { try { this.sdk.game?.loadingStop?.(); } catch { /* optional */ } }
  gameplayStart() { if (!this.playing) { this.playing = true; try { this.sdk.game.gameplayStart(); } catch { /* */ } } }
  gameplayStop() { if (this.playing) { this.playing = false; try { this.sdk.game.gameplayStop(); } catch { /* */ } } }
  onMuteChange(cb: (m: boolean) => void) { this.muteCbs.push(cb); }
  onAuthChange(cb: () => void) { this.authCbs.push(cb); }
  rewardedAd(hooks: { started: () => void }): Promise<boolean> {
    if (!this.adsEnabled) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
      try {
        this.sdk.ad.requestAd('rewarded', {
          adStarted: () => hooks.started(),
          adFinished: () => done(true),
          adError: () => done(false),
        });
      } catch {
        done(false);
      }
      setTimeout(() => done(false), 120000);
    });
  }
}

function loadScript(src: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    s.onload = () => { clearTimeout(t); resolve(); };
    s.onerror = () => { clearTimeout(t); reject(new Error('load error')); };
    document.head.appendChild(s);
  });
}

/** Use the CrazyGames SDK only when hosted there (or forced with ?cg=1). */
export async function createPlatform(): Promise<Platform> {
  const params = new URLSearchParams(location.search);
  const host = location.hostname + ' ' + document.referrer;
  const wantCG = params.get('cg') === '1' || /crazygames/i.test(host);
  if (wantCG) {
    try {
      await loadScript('https://sdk.crazygames.com/crazygames-sdk-v3.js', 8000);
      const sdk = (window as any).CrazyGames?.SDK;
      if (sdk) {
        await sdk.init();
        if (sdk.environment !== 'disabled') {
          const p = new CrazyGamesAdapter(sdk);
          await p.init();
          return p;
        }
      }
    } catch (e) {
      console.warn('[platform] CrazyGames SDK unavailable, using local adapter', e);
    }
  }
  const p = new LocalAdapter();
  await p.init();
  return p;
}
