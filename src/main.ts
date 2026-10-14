import './styles.css';
import { Game } from './Game';
import { createPlatform } from './systems/PlatformAdapter';
import { SaveManager } from './systems/SaveManager';
import { createDefaultSave, type SaveData } from './core/state';

async function boot() {
  const bootEl = document.getElementById('boot')!;
  const msg = document.getElementById('bootmsg')!;
  const platform = await createPlatform();
  const saves = new SaveManager(platform.storage);
  // read & validate existing progress BEFORE any default is written
  const outcome = await saves.load();
  let data: SaveData;
  if (outcome.kind === 'problem') {
    data = await new Promise<SaveData>((resolve) => {
      document.getElementById('bootspin')!.remove();
      const reason = outcome.reason === 'newer'
        ? 'Your saved progress was made by a newer version of DIGBOUND. To protect it, this version will not overwrite it.'
        : outcome.reason === 'unavailable'
          ? 'Saved progress could not be read right now (storage unavailable).'
          : 'Your saved progress appears to be damaged and could not be loaded.';
      msg.innerHTML = `<div class="dialog"><h2>Save problem</h2><p>${reason}</p>
        <p class="note">Play without saving keeps the stored data untouched. Start fresh first copies the old data to a backup key.</p>
        <div class="row" style="justify-content:center">
          <button class="btn primary" id="b-play">Play without saving</button>
          ${outcome.reason !== 'unavailable' ? '<button class="btn danger" id="b-fresh">Back up &amp; start fresh</button>' : ''}
        </div></div>`;
      document.getElementById('b-play')!.addEventListener('click', async () => {
        saves.keepReadOnly();
        resolve(createDefaultSave());
      });
      document.getElementById('b-fresh')?.addEventListener('click', async () => resolve(await saves.backupAndReset(outcome.raw)));
    });
  } else {
    data = outcome.data;
  }
  const game = new Game(
    document.getElementById('game') as HTMLCanvasElement,
    document.getElementById('ui')!,
    document.getElementById('touch')!,
    platform,
    saves,
  );
  await game.start(data);
  if (saves.locked) game.ui.saveStatus(null);
  bootEl.remove();
  (window as any).__game = import.meta.env.DEV || location.search.includes('debug') ? game : undefined;
}

boot().catch((e) => {
  console.error(e);
  const msg = document.getElementById('bootmsg');
  if (msg) msg.innerHTML = `<div class="dialog"><h2>Something went wrong</h2><p>${String(e?.message ?? e)}</p><p class="note">Try reloading. Your saved progress has not been modified.</p></div>`;
});
