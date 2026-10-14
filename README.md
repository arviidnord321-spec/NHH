# DIGBOUND: Pet Explorers

An original 3D digging and pet-collecting browser adventure (working title), built with **TypeScript + Three.js + Vite** for CrazyGames-style web hosting. Chunky faceted 3D characters, pets and eggs in an approachable blocky style; all models, textures, sounds and music are generated procedurally in code.

> Explore → scan → excavate → uncover treasure → sell → upgrade or hatch → equip pets → explore further.

## Run it

```bash
npm ci            # pinned deps + lockfile
npm run dev       # http://localhost:5173  (model gallery: /preview.html?m=pets|variants|eggs)
npm test          # unit tests + economy simulation
npm run build     # production build → dist/ (relative asset paths, ~0.8 MB, 3 files)
npm run preview   # serve the production build
```

Optional browser acceptance checks (needs Playwright + Chromium):

```bash
npm run dev &
node scripts/acceptance.cjs http://localhost:5173/
```

Add `?debug` to the URL for a performance overlay toggle in Settings and `window.__game` access.

## Controls

| Action | Desktop | Touch |
|---|---|---|
| Move | WASD / arrows | Left virtual stick |
| Look | Click the game, then move the mouse (Esc frees it) | Drag the right side |
| Dig | Hold left mouse on a valid cell | Hold **Dig** (center reticle) |
| Jump | Space | Jump |
| Sprint | Shift | Push the stick past its edge |
| Interact / uncover | E (hold 0.8 s to uncover) | Use |
| Echo Scan | Q | Scan |
| Return to camp | R or HUD button | HUD button |
| Tools | 1–4 or click hotbar | Tap hotbar |
| Pets | P or HUD button | HUD button |
| Avatar designer | C or Avatar button | Avatar button |
| Close / settings | Esc | ✕ / ⚙ |

## What's in the game

- **4 biomes around a persistent camp**: Meadow Camp, Crystal Hollow (geode cavities), Ember Quarry (terraced quarries, gentle warm vents), Aurora Depths (ruin pillars, floating stones, aurora sky). Each biome has 3 authored dig sites, a landmark, and a sealed secret chamber.
- **Destructible voxel dig sites** (12×12×8 one-metre cells), with only exposed faces meshed. Collision uses the same cell data. Bedrock and site walls are visibly distinct. Reach is 4 m with line-of-sight checks; cracks show partial damage; multi-unit nodes show their bag cost before you mine them.
- **First person**: the game is always played in first person with a wide, adjustable field of view (Settings → Camera), a held-tool view model, walk bob and a compass bar.
- **Echo Scan**: a teal ring, a direction arrow, a depth category (shallow/below/deep), a signal meter and pings. It shows "No signal nearby" when nothing is in range.
- **Treasures**: coin caches, gem geodes, fossils, curios, egg tokens and **seeded relic shards** (3 per biome, always placed in that biome's sites, never a loot roll).
- **8 pet species + 4 named variants** as faceted 3D models following the reference sheet. Pets follow you, assist when you dig, celebrate finds and idle-animate. Pets level 1–10. You get Equip Best, favorites/lock, sorting, filters, an inspect view, release, and **Shiny merging**.
- **4 themed 3D eggs + a starter egg**: a full 3D hatch sequence (anticipation → rocking → cracks → shell separation → reveal with rarity rays), a 20th-hatch featured guarantee, and an optional fast hatch.
- **Upgrades**: 6 shovel tiers, 5 backpacks, a pickaxe, a lantern and the scanner. Biome gates show the exact missing requirement.
- **Museum** (silhouettes for missing finds), quest chain, 10 achievements, repeatable expedition contracts, site renewal, gem cosmetics, and a final Star Monument crown.
- Responsive HUD styled after the mockup; every icon is a live 3D render of the in-game model.

## Where things live

| Area | File |
|---|---|
| **All balance values** (prices, HP, odds, caps, quests, materials, pets, eggs) | `src/data/balance.ts` |
| Pure rules: damage, sale value, pets, eggs/pity, quests, contracts, museum | `src/core/logic.ts` |
| Save schema, defaults, validation | `src/core/state.ts` |
| Deterministic site generation | `src/core/site.ts` |
| Orchestration, state machine, dig/scan/treasure flow | `src/Game.ts` |
| World, biomes, camp, colliders, raycasts | `src/world/World.ts` |
| Voxel sites (meshing, collision data) | `src/world/VoxelSite.ts` |
| Procedural 3D models (player, pets, eggs, props) | `src/world/models.ts` |
| Player, camera, pets, particles | `src/world/PlayerController.ts`, `CameraController.ts`, `PetFollowers.ts`, `ParticlePool.ts` |
| UI / 3D icons + hatch scene | `src/ui/UIManager.ts`, `src/ui/Showcase.ts` |
| Input, audio, saving, platform | `src/systems/*.ts` |

Swapping in production art: systems only use the rig objects returned by `buildPet`, `buildEgg` and `buildHuman` (root, body, head, legs, …), so a GLTF loader can return the same shape without gameplay changes.

## Platform integration (CrazyGames)

`src/systems/PlatformAdapter.ts` picks the CrazyGames SDK v3 when hosted on CrazyGames (or with `?cg=1`). Otherwise it uses a local development adapter backed by localStorage. There is one save backend per environment, and lifecycle calls (`gameplayStart`/`gameplayStop`) are de-duplicated and driven by independent pause reasons (menu, hatch, hidden tab, ad). The platform mute flag and the user mute setting are tracked separately. Account changes flush the save and reload, so profiles never blend. Ads are **disabled** in this build. The rewarded-ad path (reward only on the completion callback, once) exists but is switched off.

**Must verify before submission.** The CrazyGames docs could not be reached from the build environment, so the SDK calls follow the v3 API as known and are feature-detected. Re-check `SDK.init`, `game.gameplayStart/Stop`, `game.settings.muteAudio`, `game.addSettingsChangeListener`, `data.getItem/setItem/removeItem` and `user.addAuthListener` against https://docs.crazygames.com/sdk/. Also enable Progress Save in the submission settings, then test on-platform with a guest and a signed-in account.

## Test report

Environment: Linux container, Node 22, Chromium (Playwright) with **SwiftShader software WebGL**, so no GPU. All frame rates below come from software rendering and are **not** representative of real devices; no real-device benchmarks were run.

**Unit tests (`npm test`, Vitest): 30/30 pass.** They cover:
- egg odds total 100% and match roughly 55/35/10 over 20k seeded rolls
- the 20th-hatch guarantee and separate per-egg counters
- duplicate confirms rejected, and a pending hatch surviving save/load without a reroll
- full inventory and insufficient funds consuming nothing
- starter egg isolation
- the damage formula and 75% cap, pickaxe modifiers, utility stacking, the golem's every-8th hit
- full bag, multi-unit nodes, the sale cap
- purchases, gates (relics never consumed), XP carry-over
- Equip Best (slot limit, tie-break, favorites), atomic merge, locked pets protected
- quest/contract rewards granted once
- save validation (malformed, newer, NaN, unknown IDs, bounds) and the size budget
- site determinism and relic seeding

**Browser acceptance (`scripts/acceptance.cjs`): 11/11 pass.**
- A returning player keeps coins, bag, pets, quest progress and mined cells.
- Reloading mid-hatch replays the same pet with no second charge.
- A rapid double hatch produces exactly one transaction.
- Movement over 2 s matches at 60/120/144 Hz (17.258 / 17.262 / 17.263 m).
- Particles stay capped at the Medium budget (300).
- A buried or out-of-reach cell is rejected.
- A corrupted save shows the recovery dialog and is never overwritten.
- A newer-version save is protected.
- Closing an ad keeps the menu pause.
- No uncaught page errors.

**Economy simulation (model estimate, not playtest data).**

| Milestone | Without pets | With pets (spends on eggs) |
|---|---|---|
| First sale | 0:40 | 0:40 |
| First upgrade | 0:40 | 0:40 |
| Crystal Hollow open | 5:38 | 9:51 |
| Ember Quarry open | 12:12 | 16:26 |
| Aurora Depths open | 25:07 | 27:17 |

The design targets were: first sale ~45 s, first upgrade ~1 min, first biome ~5–8 min. Treasure income isn't modeled, so real pacing should be faster; tune it in `balance.ts` after playtests.

**Render budget (measured in SwiftShader, both passes counted).**

| Scene | Draw calls | Triangles |
|---|---|---|
| Biomes | ~100–185 | 50–120k |
| Camp (busiest) | ~330 | ~145k |

Draw calls include the shadow pass. Static scenery is merged into spatial chunks with vertex-colored shared materials, rigs are compacted, and distant labels are culled. Production build: ~0.8 MB in 3 files, with relative paths.

**Not yet verified:**
- real-GPU frame rate on desktop, mobile and a low-memory Chromebook
- a 15-minute memory soak on real hardware (the JS heap was ~70–80 MB after loading all biomes)
- on-platform SDK behavior, and a real touch device

## Assets & license note

Every model, texture, sound and music cue is original and generated at runtime by this code, so there are no third-party assets. It doesn't use the reference trailer's music or footage. The trailer could not be viewed during development, so nothing here reproduces its gameplay. The three concept images were used only as visual direction for silhouettes, palettes and HUD hierarchy. "DIGBOUND" is a provisional title and has not been checked for trademark availability. Dependencies: three.js (MIT); dev-only Vite, TypeScript and Vitest (MIT/Apache-2.0).

## Not included yet

Out of scope for v1 per the brief: multiplayer, trading, accounts, leaderboards and a backend. Prestige and live ads are also not included. NPCs at camp are named characters, never labelled as real players.
