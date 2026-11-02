# Test plan — unit (vitest) + e2e (foundryvtt-test-framework)

Two layers, kept strictly separate:

- **Unit suite (vitest, plain node env)** — pure logic in `src/module/`: damage calculation combinatorics, message parsing, flag helpers. Fast, no Foundry needed, **runs in CI**. This is where the damage-math regressions get caught.
- **E2E suite (foundryvtt-test-framework)** — real Foundry instance driven by Playwright with a dice-override extension (`clickInLastChatMessage`, `queueDiceOverride`, `waitFor`, …). Covers Hooks, chat-button DOM, canvas token control, sheets, sockets. **Local-only** (licensed Foundry install), never in CI.

CI order becomes `lint -> test:unit -> build`. The e2e suite stays local (`test:e2e`).

## Phase U — Unit suite with vitest (do this first; it's cheaper than e2e)

> **Status (2026-10-31): COMPLETE.** The suite is in `tests/unit/` (7 files, 145 tests, runs in CI after lint and in the husky pre-commit hook). The review-5 follow-up batch is pinned too: the four uuid-resolution guards committed in `5fbba11` (G1-G4), the destructeur/cuir-du-taureau gate positive control, vehicule/mecha trait non-application, the mecha energie path, and the `createDamageObject` dispatch + revert-click handler via the `renderChatMessageHTML` registration.

The damage classes touch **no Foundry APIs at module top-level** — `foundry.*`, `game`, `ChatMessage`, `fromUuidSync` are only called inside methods — so they are unit-testable with plain object doubles. (Update since review 5: importing the _entrypoint_ is also unit-safe — its only top-level effect is `Hooks.once/on` registration, which the stubs record; `tests/unit/entrypoint-dispatch.test.mjs` uses that.)

1. `npm i -D vitest`; scripts:
   ```json
   "test": "vitest run",
   "test:unit": "vitest run",
   "test:watch": "vitest"
   ```
   Default config works (`type: module` already set); keep tests in `tests/unit/**/*.test.mjs`. Import `{ describe, it, expect, vi }` from `vitest` — don't enable vitest globals, so eslint needs no changes.
2. Global stubs in `tests/unit/support/foundry-globals.mjs` (a `vitest.config.mjs` `setupFiles` entry): set `globalThis.foundry = { utils: { deepClone, mergeObject, fromUuid }, applications: { api: { DialogV2 } } }`, `globalThis.fromUuidSync`, `globalThis.game`, `globalThis.ChatMessage`. Implement `deepClone` with `structuredClone` and `mergeObject` with a minimal recursive merge — small and honest; the code depends on merge-into-flags semantics.
3. Object doubles in `tests/unit/support/doubles.mjs`:
   - `makeMessage({ content, flags })` — plain `{ content, flags, getFlag, update }`; **build flags from the same JSON fixtures as e2e** (`flags.knight.targets/weapon/actor`), so unit and e2e agree on the system contract.
   - `makeActor(type, systemTree, items, flags)` — nested `system.*` tree exactly as the system stores it, `items.contents`, `getFlag/setFlag`, `temporaryEffects`, `update()` recording calls, `uuid`.
   - `makeToken(actor)` — the dispatch passes `e.document` (a TokenDocument with `.actor`); the JSDoc in `createDamageObject` says otherwise. Construct with the token-document shape and pin it in a test.
4. **Characterization rule**: pin _current_ behavior first (including suspected bugs below); each pinned oddity gets a `// CHARACTERIZATION:` comment. Fixes come later as deliberate commits with tests updated.

Test targets, per file:

- **Standard fixtures (use these values everywhere unless a case needs otherwise):** weapon `weapon.effets.raw` containing `percearmure 40` + `penetrant 6`; victim knight with **normal `armure` 100**, CdF fixtures straddling 6 (`cdf 4` → CdF fully zeroed by pénétrant; `cdf 10` → effective CdF 4 via `applyTraitCdf`). Against _full_ 100 armor, perce-armure 40 changes nothing: `100 ≤ 40` is false so `isArmorIgnored()` stays false, and the subtractive `applyTraitArmure()` is commented out in `DamageKnight.calculate` and uncalled in vehicule/mecha — pin that no-op. The armor-**bypass** branch (`isArmorIgnored()` true) requires a **worn-armor fixture** (`armure` ≤ 40, e.g. 30): there the armure track is skipped and post-CdF damage goes straight to sante math. `cuirDuTaureau` and `instinct-du-loup → percearmure: 'active'` are the two documented flips on that worn-armor fixture — each needs a paired case (taureau re-engages the armure track; loup zeroes `perceArmure` so full-armor behavior is restored for the worn victim).
- `helpers.test.mjs` — `getTraitValue` (e.g. `'Perce-armure 40'` → 40, `'Pénétrant 6'` → 6), `extractTraitValue` (the French HTML `<span class="label">…<span class="value">+N` regex), `hasStatusEffect`, `generateReminderData` (uuid `.`→`_` key encoding, revert negation, accumulation).
- `damage-base.test.mjs` — damage extraction: `flags.knight.targets[].value × mult` with `Math.ceil`; the `Débordement`/`Mode Oriflamme` content-regex fallback (which also auto-adds `ignorearmure`/`ignorechampdeforce`/`antivehicule` to `weapon.effets.raw` when the initiator has the matching item); `percearmure 40`/`penetrant 6` parsed from `weapon.effets.raw` into `perceArmure`/`penetrant`; `calculateDamageStat` overflow arithmetic; `calculateArmureVersSante` tranche 5; /10 colosse with `antivehicule` defeating it; `apply()` update-payload mapping.
- `damage-knight.test.mjs` — order Egide → CdF → armure → guardian branch (`armure <= 0`, not `folde`, `wear != 'guardian'`, `apply-guardian-cdf` status) → sante; `infatigable` skipping the armure→sante carry; `cuirDuTaureau` forcing armor despite ignorearmure; `destructeur`/`meurtrier` insertion points; espoir path with `system.espoir.reduction` floor 0; `instinct-du-loup` item flag neutralizing `percearmure`/`ignorearmure`/`ignorecdf`; `Rire du corbeau` energie split (DialogV2 stubbed); energie/espoir reminder `user.query` payload (stub `game.users.activeGM.query`).
- `damage-vehicule-mecha.test.mjs` — vehicule `/10` colosse, `antivehicule` bypass, passenger carry `/5`; mecha blindage track and passenger carry `/10` tranche.
- `recap-message.test.mjs` — with `ChatMessage.create` stubbed via `vi.fn()`, assert recap HTML lines and `flags['knight-damage']` = `{ recap, isRecap, origin }` (+ `wear`/`anatheme` on knight).

Known code quirks the unit suite must pin (verify, don't silently "fix"):

- ~~`damageVehicule.js` missing `()` on `isColosseApplied`~~ — **fixed** (both call sites now invoke it). Phase U should instead _lock the fix in_: a test with an `antivehicule` attack vs a vehicule with `armure > 0` must show Destructeur applied via the armor branch (`!isColosseApplied()` true), and must not be gated on the `/10` number; plus the normal non-antivehicule case keeping line-19 gating. This is the regression the bug hid for months.
- `DamageKnight.revertDamage` restores stats via `setTimeout(100/101)` — use `vi.useFakeTimers()` + `vi.advanceTimersByTime()`; the base `revertDamage` has no timers.
- `apply()` maps `cohesion` damage onto `system.sante.value` (`damageBase.js:286`) — assert the exact update key the current code emits.
- `askModifier`/`askDamageEnergie` need `foundry.applications.api.DialogV2.prompt` stubbed to resolve values; `switchArmure` (sheet DOM + more timers) stays **out of unit scope** — e2e only.

CI: add unit tests to `.github/workflows/checks.yml` (`npm ci` → `npm run lint` → `npm test` → build), same Node 20 setup as existing jobs. Keep husky pre-commit lint-only unless `vitest run` stays under ~2s.

Unit scope boundary: anything touching `Hooks`, `canvas`, `renderXxx` handlers, jQuery `html` chaining, or sockets/`CONFIG.queries` wiring stays e2e. Unit tests instantiate `Damage*` classes directly and call `calculate()` / `apply()` / `generateRecapMessage()` themselves.

Known honest limits of the unit layer (review 5): the stubbed `actor.update` performs **no data-model validation**, the uuid **grammar** is never verified by the stub registry, and the `mergeObject` stub lacks the v14 **operator objects** — so the three uuid null-resolution crash sites review 5 found are guarded in src (commit `5fbba11`) and pinned unit-side, but only the e2e layer can exercise **real** uuid resolution.

## Phase 0 — E2E prerequisites (verify by hand first)

> **Status (2026-11-01): all 4 boxes closed — environment verified, test world created AND booted for real, and `FoundryVTT-Node/` in place without the account-gated download.** Machine-specific locations (Foundry data root, framework clone path) deliberately stay OUT of this doc — resolve them per machine (the gitignored `foundryconfig.json` carries the local data path). Fixture expectations below are portable.

- [x] Local Foundry VTT install with a valid license, **v14**, and the **`knight` system installed** in `Data/systems/knight` (the module hard-depends on the system's chat-message flags — see Risks).
  - Verified on a **portable** install (user-data root = install root) at core **14.369** (`App/resources/app/package.json` version `14.369.0`). `Config/license.json` present and activated (encrypted payload + signature present; nothing sensitive in this doc).
  - `knight` **3.58.38** installed (`compatibility: min 13 / verified 14`). Actor types in `system.json` `documentTypes.Actor`: `knight`, `ia`, `pnj`, `creature`, `bande`, `vehicule`, `mechaarmure` — `pnj` is the module's attacker type; `createDamageObject` returns no handler for it.
  - **Hard dependency found:** the knight system's `relationships.requires` names the **`socketlib`** module (installed, v1.1.4) — it must be active in the test world. `knight-compendium` is installed but _not_ required; it stays inactive.
  - Caveat seen on the verification machine: `Data/modules/knight-damage` may be a **symlink** (leftover `npm run link-project`) pointing at a local checkout's `dist/`. Phase 1's `tools/copy-dist-to-foundry.mjs` must replace it with a real file copy (recursive copies through symlinks are the risky path; linking needs admin).
- [x] Foundry's **Node.js server** in place as `FoundryVTT-Node/` inside the framework package dir (git-ignored by the framework's own `.gitignore`). **Solved 2026-11-01 WITHOUT the account-gated download:** the portable/Electron install's `App/resources/app/` directory IS the same server code — its `main.js`/`main.mjs` bootstrap has a plain-node entry (Electron usage is guarded by `process.versions.electron`) and the only native module (`classic-level`) loads its `prebuilds/win32-x64` binary under plain Node. Procedure (licensed local install required; otherwise fall back to the official Node.js build from foundryvtt.com): robocopy `App/resources/app` → `<sibling>/foundryvtt-test-framework/FoundryVTT-Node/` (300 MB), confirm `main.js` at the root, probe `node -e "require('classic-level')"` under the repo's Node (24 OK), then smoke-launch. **Smoke result:** `node main.js --dataPath=<minimal copy: Config/license.json + Data/{systems/knight, modules/socketlib, worlds/knight-damage-test}> --port=30001 --world=knight-damage-test` → NEDB→LevelDB migrations ran for actors/scenes/settings, passwordless GM user auto-created, `Launching World | Complete` (first real validation that the Phase-0 world boots), Express serving HTTP 200 on 30001. Node-version floor: `package.json` `release.node_version` (24 for core 14.369) — the repo's `lts/*`/CI-20 is fine for unit work but the e2e host Node must match.
- [x] A manually authored **test world** — created 2026-11-01 in the local data path at `Data/worlds/knight-damage-test/` (details in the fixture subsections below).
- [x] Node 18+ — verified at **v24** (repo `lts/*`, CI 20).

### World fixture: `knight-damage-test` (knight 3.58.38, core 14.369)

Layout (v14 stores world documents as one **LevelDB per collection** under `data/<collection>/`; the folder is seeded with legacy NeDB files — newline-delimited JSON — which v14's `_migrateNEDBToLevelDB` migrates automatically on first connect, so the whole world is hand-authorable text):

```
world.json                      knight-pinned, coreVersion 14.369, compatibility {minimum "14", verified "14.369"}
data/actors.db                  NeDB: 4 actors
data/scenes.db                  NeDB: 1 scene (embedded levels+tokens inline, v12-style — migration writes sublevels)
data/settings.db                NeDB: core.moduleConfiguration = {"socketlib": true, "knight-damage": true}
```

No `users.db`: with no GM user, Foundry auto-creates a passwordless **`Gamemaster`** at launch — exactly the framework's default `loginUser`. v14 world.json has **no `modules` field** (module activation lives only in the `core.moduleConfiguration` setting row above). Every document `_id` must match `/^[a-zA-Z0-9]{16}$/` (Foundry `isValidId`), so readable labels live in `name`, not `_id`; ids below are fixed and stable.

Actors (stats mirror the unit-suite standard fixture `knightSystem()` in `tests/unit/support/knight-fixtures.mjs`; each stat was written as `value = base = max` so the knight system's prepare/derived recalculation cannot drift the fixtures):

| Actor `name`   | type          | `_id`              | fixture stats                                                                                                                                                                                                               |
| -------------- | ------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atk-pnj`      | `pnj`         | `kdtAtkPnjAAAAAAA` | damage _source_ only: sante 10, armure 0, energie 12                                                                                                                                                                        |
| `vic-knight`   | `knight`      | `kdtVicKnightAAAA` | **armure 100, CdF 10, egide 0, guardian gear (armure 15 / CdF 5 via `system.equipements.guardian.*`), sante 20, espoir 15 with `espoir.reduction` 3, energie 12, `wear` `"normal"`** — exactly the Phase U standard fixture |
| `vic-vehicule` | `vehicule`    | `kdtVicVehiculeAA` | **armure 30** (Phase 4 erratum: `system.armure`, not `blindage`), CdF 0, energie 12, sante 10, equipage 1/2                                                                                                                 |
| `vic-mecha`    | `mechaarmure` | `kdtVicMechaAAAAA` | **blindage 30, resilience 3, CdF 0, energie 12, sante 20**                                                                                                                                                                  |

Schema caveat for Phase 4–6 authors: `resilience`/`cohesion` from the old Phase-0 wording are **not top-level system fields** for these actor types in knight 3.58.38 (`cohesion` exists only on items like armure-legende; vehicule has no `resilience` at all — its colosse `/10` is type-gated, `isColosseApplied()` is always true for `vehicule`). Mecha _does_ have `system.resilience.{value,base,max}`. The "cohesion" pool in the module is a repartition key that `apply()` writes onto `system.sante.value` (pinned INTENDED in the unit suite), so the victims pin **sante** instead. `wear: "normal"` is a plain string field (system default `"tenueCivile"`, no enum) — the module only compares `wear != 'guardian'`, so the unit fixture value is schema-legal.

Scene `kdt-main` (`_id kdtSceneMainAAAA`): 4000×3000 px, grid size 100 px with the knight system's 5 m distance, `active: true`, no background image (null), default level `defaultLevel0000` (v14.369 scenes/tokens use `levels`). Four **linked** tokens (`actorLink: true` + `actorId`), display `name`s ASCII-stable for `selectTokensByName`:

| Token `name`   | `_id`              | token `actorId`    | x, y (px)  | w×h (grid) |
| -------------- | ------------------ | ------------------ | ---------- | ---------- |
| `atk-pnj`      | `tkAtkPnjAAAAAAAA` | `kdtAtkPnjAAAAAAA` | 1000, 1000 | 2×2        |
| `vic-knight`   | `tkVicKnightAAAAA` | `kdtVicKnightAAAA` | 1300, 1000 | 1×2        |
| `vic-vehicule` | `tkVicVehiculeAAA` | `tkVicVehiculeAA`  | 1600, 1000 | 3×2        |
| `vic-mecha`    | `tkVicMechaAAAAAA` | `kdtVicMechaAAAAA` | 1900, 1000 | 2×2        |

**Linked-vs-unlinked adjudication:** tokens are _linked_. Existing v14 worlds built by other systems (pf2e notably) use unlinked tokens with `delta`s, but that is a pf2e convention; it breaks this module's and the plan's assumptions instead — Phase 3's `game.actors.get(actorId)` sees only _world_ actors (unlinked tokens yield synthetic delta actors absent from `game.actors`), and `DamageBase`'s `fromUuidSync('Actor.' + flags.knight.actor._id)` fallback plus flag keys `Scene_<scene>.Token_<token>` need stable world-level actor/token ids anyway. With `actorLink: true`, `token.actor === game.actors.get(actorId)` and every uuid the module builds (`Scene.kdtSceneMainAAAA.Token.tkVicKnightAAAAA`) resolves.

All four `.db`/`.json` files parse with `JSON.parse`, load through the exact `nedb-promises` code path Foundry's migration uses, pass the `_id` regex, and the scene/setting key sets match reference v14 documents dumped read-only from an existing v14 world's LevelDB; tokens omit only keys that carry schema defaults (`disposition`, bars, light/sight, …).

### Framework clone + Phase 1 assumption verification (2026-11-01)

Cloned (public repo, not installed) as the sibling the plan's `file:../foundryvtt-test-framework` resolves to — clone location is machine-local; keep ONE canonical copy next to whichever checkout runs the suite. Verified at commit `f455406e1433b7fc3b89d6d9e5cb840e1d36d8bb` (2026-05-24), package version **2.0.0**, dep `playwright ^1.49`.

Checked against the actual sources (plan claim → verdict): `waitFor(fn, timeout, ...args)` trailing-args passing → **correct** (`src/framework.mjs:67`, `src/helpers.mjs:40` `buildEvaluator`: 0/1 args pass through `page.evaluate`, ≥2 args are stringified and re-`eval`'d page-side to spread them back); stringified-function/closure-leak rule and swallowed predicate errors → **correct** (CLAUDE.md documents the swallow); `executeInFoundry(fn, ...args)`, `queueDiceOverride(faces, count, value)` (FIFO, `null` count wildcard, success-counting dice skipped, queue owned by the extension), `waitForChatMessage`, `clickInLastChatMessage*`, `screenshot` → **all exist** as instance methods; `start/stop` → **class-based**: `new FoundryTestFramework(config)`, named import `{ FoundryTestFramework }` from `'foundryvtt-test-framework'` — the plan's `fw` shorthand implies an instance, keep it that way in Phase 1; `runSetup(config)` from `'foundryvtt-test-framework/setup'` → exists, copies license/systems/modules/worlds, **missing assets warn only** (plan's warning is right); `FoundryVTT-Node/` at the package dir with the server spawned as `node main.js --dataPath=… [--port=…] [--world=…]` → correct (entry filename `main.js` confirmed by the Linux archive; verify flat unpack); `diceOverrideExtensionPath` → `<pkg>/dice-override` (MV3, matches `http://localhost/*` only) → correct; extension patch target `Roll.prototype._evaluateASTAsync` → **exists in core 14.369** (`client/dice/roll.mjs:355`), so dice override works on v14; click helpers' scope `.chat-scroll li.chat-message` → **valid v14 DOM** (chat message root is literally `li.chat-message`, `templates/sidebar/chat-message.hbs:1`; core chat tab queries `.chat-scroll`, `client/applications/sidebar/tabs/chat.mjs:747`); `submitDialog()` selector `footer.form-footer button[type='submit']` → **matches v14 DialogV2** (`client/applications/api/dialog.mjs:211` renders `<footer class="form-footer">` and buttons default to `type="submit"`) — Phase 3 case 8 is safe; `selectTokensByName(names)` calls `token.setTarget(true, …)` → **targets only, not controlled** — the Phase 3 gotcha is confirmed, control tokens explicitly. No v14-incompatible assumption found in the framework itself.

## Phase 1 — Scaffold (make a smoke test pass)

> **Status (2026-11-01): COMPLETE.** `prepare:e2e` → `setup:e2e` → `test:e2e` green on this machine (world boots, GM auto-join works, all 3 smoke assertions PASS as-registered). Files: `tools/copy-dist-to-foundry.mjs`, `tests/e2e/{config.example,config,setup,smoke.test}.mjs`, scripts in `package.json`, gitignore + eslint-ignore entries. Findings that deviate from the plan: (1) **`file:` install on Windows = JUNCTION, as hoped** — `node_modules/foundryvtt-test-framework` → sibling clone (`FoundryVTT-Node/` never duplicated, `npm ci`-safe) — but **npm never installs a linked package's own deps** and Node *realpaths* junctioned modules, so the framework's `playwright` import resolves outside the repo tree; fixed by adding `playwright` as a repo devDependency (the framework's own range is `^1.49`; the repo pins its own newer version) and having the e2e entry scripts respawn themselves once with `node --preserve-symlinks` (its framework import must stay a dynamic `import()` inside the preserved branch — a top-level `import` would be evaluated by the un-preserved parent first). (2) `runSetup` **does** wipe+re-copy `testDataPath` worlds each run, so the NeDB→LevelDB migration re-runs per `setup:e2e` (~instant on this world; whole cold chain ≈ 8 s). (3) Three **framework bugs** surfaced, all patched locally via a `SmokeFramework` subclass in `smoke.test.mjs` (upstream issues to file): its login selector is `select[name="userid"]` but v14 renders **`name="userId"`** (capital D) → login was skipped and `game.ready` never flipped; `headless: true` maps to Playwright `headless: "new"`, which Playwright's validator rejects ("expected boolean") at least back to the framework's own 1.60 lock → **`headless: false` is the only working mode today**; `_spawnServer`'s plain arg set leaves external IP-discovery probes pending on this network, `Express.addresses` stays null, and the socket JOIN crashes server-side in `getInvitationLinks()` → client hangs on a black loading screen; fixed by passing **`--noipdiscovery=true`** (v14 reads `config.options.noipdiscovery`). `loginUser: 'Gamemaster'` works as-is (passwordless GM auto-created per fresh world copy); port 30001 was free. `npm i` also pulled `playwright` → `npx playwright install chromium` (~chromium-1248). The chrome-profile lands inside the framework clone (via the junction) — harmless, git-ignored there.

1. `npm i -D foundryvtt-test-framework`
2. `tests/e2e/config.example.mjs` (committed) / `config.mjs` (gitignored):
   ```js
   export default {
     sourceDataPath: 'C:\\Users\\<you>\\AppData\\Local\\FoundryVTT',
     systemsToCopy: ['knight'],
     modulesToCopy: ['knight-damage'],
     worldsToCopy: ['knight-damage-test'],
     world: 'knight-damage-test',
     testDataPath: fileURLToPath(new URL('../../test-data', import.meta.url)),
     foundryNodePath: ..., diceOverrideExtensionPath: ...,
     foundryServerPort: 30001, // avoid clashing with a dev server on 30000
     headless: false,
   };
   ```
3. `tests/e2e/setup.mjs` → `runSetup(config)` (copies license from `sourceDataPath/Config/`).
4. **Build-then-copy flow**: `modulesToCopy` copies from `Data/modules/knight-damage`, so the module must be current in the _source_ data folder before `setup:e2e`. Add scripts:
   ```json
   "prepare:e2e": "npm run build && node tools/copy-dist-to-foundry.mjs",
   "setup:e2e": "node tests/e2e/setup.mjs",
   "test:e2e": "node tests/e2e/smoke.test.mjs"
   ```
   (`tools/copy-dist-to-foundry.mjs` = real file copy, not symlink — `npm run link-project` symlinks may not copy cleanly into `testDataPath`, and linking needs admin. Keep the copy step in the repo.)
5. `.gitignore`: `test-data/`, `tests/e2e/config.mjs`.
6. Smoke test `smoke.test.mjs`: `fw.start()` → assert via `executeInFoundry`:
   - `game.modules.get('knight-damage').active === true`
   - `CONFIG.statusEffects` contains `anti-anatheme`, `folde`, `apply-guardian-cdf`, `shrine`, `shrine-ameliore`
   - `typeof CONFIG.queries['knight-damage.addReminder'] === 'function'`

Acceptance: `npm run prepare:e2e && npm run setup:e2e && npm run test:e2e` green.

## Phase 2 — Getting a _knight_ damage message into chat (shared fixture problem)

Every core feature keys off the knight system's message output: `flags.knight.targets[].value`, `flags.knight.weapon.effets.raw`, `flags.knight.actor.*`, and regexes over French HTML (`Dégâts</div>`, `Débordement</div>`). Two ways to produce a message:

- **A. Real attack rolls** (end-to-end, but couples tests to the knight system's UI): GM attack action from the attacker token, `queueDiceOverride(faces, count, value)` to pin every die in the pool (FIFO by die type/count — order matters, knight rolls consume pools in system order).
- **B. Recorded fixtures** (recommended for logic tests): record a real message once — run a live attack manually, then dump it:
  ```js
  await fw.executeInFoundry(() => game.messages.contents.at(-1).toObject(true));
  ```
  save to `tests/e2e/fixtures/*.json`, and in tests recreate with `ChatMessage.create(fixture)` (removing `_id`/`id`/`timestamp`). **Record the reference weapon with `percearmure 40` + `penetrant 6` effects** so the recorded fixture _is_ the standard weapon used across unit and e2e suites. Re-record fixtures after any knight system upgrade. **These fixture JSONs double as input for the unit suite's `makeMessage`** (Phase U) — one source of truth for the knight message contract.

Use A for one integration test per actor type; use B for the combinatorics (traits, multiplier, armor interactions).

> **Phase 2 note (shared fixture problem, resolved direction):** once the recorded fixture JSONs exist, they must **REPLACE** the hand-built standard fixture (`STANDARD_RAW` / `knightSystem` in `tests/unit/support/knight-fixtures.mjs`) as the shared source of truth for both suites — the hand-built fixture is the stand-in until recording lands.
>
> **Status (2026-11-01): COMPLETE.** Recorded fixture `tests/e2e/fixtures/attack-pnj-on-knight-standard-knight-3.58.38.json` (filename pins the system version; loader strips the embedded `fixtureMeta` header) via `npm run record:e2e` (after `prepare:e2e` + `setup:e2e`), replayed live by `npm run test:e2e:fixtures` — 9/9 PASS (live system/core versions match the recorded meta, module injects its 5 damage buttons on the replayed message, `weapon.effets.raw` round-trips to `['percearmure 40','penetrant 6']`, the five module French-HTML regex expectations each match the fixture content with the expected polarity, and flags/targets/speaker match the fixture verbatim). No damage is applied by the replay. The recording is a scripted-but-real system flow (not a hand-built message): weapon live-created on `atk-pnj` (`createEmbeddedDocuments('Item', …, {keepId:true})`, pinned `_id` honored), `game.knight.RollKnight.doRoll()` weapon branch (the system's own attack-message pipeline incl. `addFlags`), then a real DOM click on the system's own `button.degats` chat handler → `rollDamage` → damage message. **Dice override hit the intended case:** attack pool 3D6 pinned to total 7 (hit vs difficulty 1), damage pool 3D6 pinned to 12 → `flags.knight.targets[0].value = 12 + fixe 2 = 14`, and every die pip in the recorded serialized `rolls[]` is deterministic. **Byte-stability proven:** clean `setup:e2e && record:e2e` chains produce byte-identical fixture files after volatiles are stripped (re-recorded repeatedly, independently reproduced by a second verification pass comparing SHA-256 digests, and re-confirmed stable across the post-review recorder refactor — a re-record under the new code rewrites a blob identical to the committed one) — volatile set beyond the planned `_id/id/timestamp/userId`: `author` (fresh-world GM user id) and deep `*_stats.{createdTime,modifiedTime,lastModifiedBy}` + per-user `ownership` keys anywhere in the document (the actor/weapon flag snapshots embed them); the serialized `rolls[]`/`flags.knight.attaque` strings carry no volatile fields under the dice plan; world-fixture ids (token/actor `_id`s inside flags) are deliberately kept. Unit merge landed without touching a single consumer expectation: `STANDARD_RAW` is now derived from the recorded fixture (still frozen), `standardKnightMessageFixture()` hands out deep clones, and `tests/unit/fixture-contract.test.mjs` pins the fixture↔unit contract (8 guard pins; suite now 155 tests, vitest include still only `tests/unit/**`).
>
> Findings that deviate from the plan: (1) **language** — a fresh `test-data/` boots Foundry in `en` and the knight chat HTML contract is French; in v14.369 the effective lever is the SERVER options file (`Config/options.json` → `language: "fr"`, merged into the server-vended `game.data.options` the client `Localization` is built from); neither a browser locale flag, nor a `--language=` argv (argv merge ignores it in 14.369), nor world `options.language` alone flips it. `setup:e2e` now forces both (options.json + the copied world's `options.language`) on the gitignored test-data copies only. (2) **`doRoll()`'s weapon branch does NOT await `#sendRollWeapon`** (knight roll.mjs:163) — the attack message and its flags appear asynchronously; any recorder must poll for `messages.size` growth + `flags.knight` presence. (3) v14 API drift hit head-on: `actor.items.create` is gone (`createEmbeddedDocuments` + `keepId`), and `ChatMessage#toObject().rolls` entries are serialized JSON **strings** (no `_id` inside them; pips live under `terms[].results`). (4) **speaker of recorded damage messages has `token`/`scene` = null** — the atk-pnj token is `actorLink:true` (Phase 0 adjudication), so `this.actor?.token` in the system's speaker builder yields null; this is faithful live behaviour and means the module's `origin` (`damageBase.js:36`) resolves to `Scene.null.Token.null` on such messages (reminder queries inert, hover/revert never get a token object) — pinned in fixture-contract. (5) **Live module bug found during recording:** the module's `preUpdateChatMessage` listener (`knight-damage.js:86`) reads `data.flags.knight.actor.statuses.has(…)` but the knight flag's actor snapshot has NO `statuses` property in v14 → the listener throws on every attack/damage flag update (Foundry swallows it; the `antianatheme` injection never runs on v14 — reproduced in the page console as `TypeError: Cannot read properties of undefined (reading 'has')`). Phase 3 must decide: fix the guard in `src/` or pin the broken behaviour as CHARACTERIZATION. Framework workarounds from Phase 1 (login selector, `headless:false`, `--noipdiscovery`, symlink respawn) all still required; the bootstrap lives in `tests/e2e/support/framework.mjs` shared by smoke/record/fixtures. (6) **Back-to-back e2e runs raced on Foundry's data-dir lock** (verified 2026-11-02): the server proper-lockfiles `Config/options.json` (lock artifact `options.json.lock/`, `stale: 10 s`), and `fw.stop()` SIGTERM-kills it, so the lock briefly outlives the process — a second e2e script launched within ~10 s died with "directory which is already locked by another process" and its client timed out on the black loading screen. The shared `_spawnServer` gate now waits for the port to free, then deletes the stale lock; `setup:e2e` clears it up front as hygiene (framework v2.0.0's `runSetup` itself never boots a server — validate + copy only). A follow-up review (2026-11-02) hardened the gate further: a port probe cannot distinguish a server that is still *booting* from no server, so a concurrently launched second e2e run could purge the first one's just-acquired lock — every e2e **entry script** now first acquires a repo-root ownership mutex (`tests/e2e/support/spawn-lock.mjs`; `.e2e-spawn.lock/` at the repo root, git-ignored; acquiring inside `_spawnServer` would be skipped by `serverAlreadyRunning` mode). A second review pass hardened it: the owner writes its **PID** and self-healing only purges a lock that is both older than the stale window (15 min) AND whose owner PID is dead (a legitimately long run's live lock is never purged); the bounded retry loop replaced an unbounded recursion; and the **chrome profile moved from the shared framework-clone root into the worktree-local `test-data/chrome-profile`** (two worktrees pointing at one canonical clone would otherwise `launchPersistentContext` the same profile twice — the clone itself is read-only and safe to share). (7) **`record:e2e` needs a fresh `setup:e2e` every time** — test-data is NOT re-wiped between records, so a second record collides with the pinned weapon `_id`: v14 **rejects** the `keepId` create ("`_id` already exists within the parent collection") — the silent re-id used to come from the recorder's OWN auto-id fallback catch, since removed, so the rejection now throws with an actionable message (`keptRequestedId` remains the belt); re-record discipline: always `setup:e2e && record:e2e` as one chain (verified: two clean chains produced byte-identical fixtures, SHA-256 reproducible). The same review pass moved the recorder's integrity gate BEFORE the write — a failed recording must never overwrite the known-good baseline fixture, which the unit suite imports as its shared source of truth (its contract-test value pin softens when `diceOverrideApplied` is false, so a polluted baseline could otherwise commit behind a green suite).

## Phase 3 — Core damage pipeline (`damage-knight.test.mjs`)

> **Poisoning rule (second review, mandatory for every case):** the test world's LevelDB is persistent and the recorded fixture embeds full actor/target snapshots — a case that APPLIES damage and does not restore the victim mutates the world, and a later `record:e2e` would then bake drifted stats into the shared baseline the 155-test unit suite consumes. Every damage-applying case must snapshot the victim actor's `system.*` first and restore it after the assertions (or run `setup:e2e` again before any `record:e2e` — never trust a used world). The recorder additionally refuses to write when the recorded victim-aspects/attacker-snapshot subtrees drift from the committed baseline fixture (`record-fixtures.mjs` drift guard).

Shared helper per test case: place the fixture message, **control** the victim token, click the injected button, `waitFor` on plain stats objects:

```js
// NOTE: functions passed to waitFor/executeInFoundry are STRINGIFIED into page
// context — closures over test vars are lost. Pass test values as trailing args
// (waitFor(fn, timeout, ...args) spreads them back via helpers.mjs:buildEvaluator).
await fw.executeInFoundry(
  (uuid) => canvas.tokens.placeables.find((t) => t.document.uuid === uuid)?.control(),
  victimTokenUuid,
);
await fw.clickInLastChatMessageByText('Normal'); // button rendered by the module
const stats = await fw.waitFor(
  (actorId, wantSante) => {
    const a = game.actors.get(actorId);
    return a.system.sante.value === wantSante ? { sante: a.system.sante.value } : null;
  },
  10000,
  victimActorId,
  expected.sante,
);
```

> **Gotcha:** `handleClickApplyDamage` early-returns unless `canvas.activeLayer.controlled.length > 0`. The framework's `selectTokensByName` sets _targets_, which is not the same as _controlled/selected_ — verify which one it leaves behind; if it's only targeting, control tokens explicitly as above.

Test cases (knight victim, DamageKnight math order: Egide → CdF → … → armure→sante /5):

1. Button injection: buttons `Normal / Demi / Double / Espoir / Energie` appear on a pnj-origin message containing `Dégâts`; **negative**: no buttons when `flags.knight.actor.type === 'knight'` (module skips PC-made attacks).
2. Normal apply: `damage - cdf` absorbed, overflow splits (`armure` full → `sante` takes `trunc(armureDamage/5)`, tranche 5). Assert each stat AND the recap message: `flags['knight-damage'].isRecap` and the exact `recap` repartition map.
3. `Demi` (mult 0.5, `Math.ceil`) and `Double` (mult 2).
4. CdF ≥ damage → no stat change, recap still created (verify against code path: `calculate` returns before apply — confirm recap contents and adjust).
5. Egide: fixture with `flags.knight.actor.system.origin === 'anatheme'` → damage reduced by `system.egide.value`.
6. Perce-armure / pénétrant / `ignorearmure` / `ignorechampdeforce` in `weapon.effets.raw` (Débordement path auto-adds these when the initiator has the matching item). Standard fixture: `percearmure 40` — pin both sides of the threshold: full 100 armor (no-op, armure track absorbs) vs worn 30 armor (`isArmorIgnored()` bypass); and `penetrant 6` (CdF fixtures straddle 6).
7. Damage traits: `destructeur/meurtrier/fureur/ultraviolence` bool + numeric value extracted from `<span class="label">…</span><span class="value">+N` HTML.
8. Shift+click opens the "Damage modifier" dialog → fill input, `fw.submitDialog()` → damage adjusted. (Verify the framework can target DialogV2 — `askModifier` uses `foundry.applications.api.DialogV2.prompt`.)
9. **Revert**: on the recap message click `.revert-damage` → all stats restored to pre-damage values, recap text gets `line-through`, revert button removed.

## Phase 4 — Vehicule / Mecha (`damage-vehicule-mecha.test.mjs`)

- Vehicule: ~~`blindage` track~~ — **ERRATUM (2026-10-31):** the vehicule damage class tracks `system.armure`, not `blindage`; `blindage` is the **mecha** stat. See `DamageVehicule.setActorStats` (`system.armure.value`) and the suite's documentation comment in `tests/unit/damage-vehicule-mecha.test.mjs` (vehicule describe). `isColosseApplied()` is always true for `vehicule` → incoming damage `trunc(damage/10)` — the single most regression-prone rule; overflow to santé via /5.
- `antivehicule` weapon effect defeats the /10 colosse rule → test both with and without.
- Mechaarmure: its stat track (blindage/cohesion mapping in `apply()` — `cohesion` writes to `system.sante.value`; assert the actual system field name).

## Phase 5 — Espoir / Energie reminders

- Click **Energie** button → `system.energie.value` drops AND attacker actor flag `knight-damage.energie` gains a key = victim uuid with `.` → `_` (e.g. `Scene_X_token_Y_actor_Z` style) incrementing by the damage dealt. Assert the raw flag keys — the `_`↔`.` encoding in `generateReminderData`/`generateReminderMessage` is a silent-corruption risk if regressed.
- **Espoir** target button → `system.espoir.value` drops; flag `knight-damage.espoir` updated.
- **Death reminder**: add an ActiveEffect named `Dead` to the victim (`executeInFoundry`) → a new chat message appears containing `Dégâts d'energie infligés` and the per-origin breakdown (`waitForChatMessage(m => m.content.includes(...))`).

## Phase 6 — Hook & sheet edge cases

- **Anti-anathème**: give the victim the `anti-anatheme` status; update an attack message whose `weapon.effets.raw` lacks `antianatheme` → after update, raw contains it (`preUpdateChatMessage`).
- **Instinct du loup**: open the knight actor's `Instinct du loup` _module-item_ sheet (hook is `renderModuleSheet` — a knight system item type, not a Foundry module) → injected buttons exist; click one → item flag `knight-damage.loup.<option>` toggles `'active'`/`'unactive'` (flag value is literally the button's className — assert exact strings).
- **Instinct du loup damage interaction**: with `percearmure: 'active'` flag, an attack _against_ that knight still has its perce-armure neutralized (`applyInstinctDuLoup` runs first in `calculate`).
- (Optional) `shrine` / `shrine-ameliore` status effects add +6 / +8 to `system.champDeForce.base` (mode 2) — assert via preparedCdF after granting the effect.

## E2E test style rules (from the framework's README + CLAUDE.md)

- `waitFor` predicates run **in the browser** and must return plain serializable objects — never Foundry Documents; look docs up by id/uuid inside the page function.
- **Stringify rule:** every function handed to `executeInFoundry` / `waitFor` / `waitForChatMessage` is stringified and re-evaluated page-side (`helpers.mjs:buildEvaluator`). No closures over test variables — pass values as trailing args. Worse, predicate exceptions are **swallowed as "not ready yet"**: a `ReferenceError` from a leaked closure variable surfaces as a full-timeout hang with no error. When a `waitFor` mysteriously times out, suspect a closure leak first.
- **Stale-code trap**: the module under test is a _copy_ inside `testDataPath`. After any `src/` change, re-run `prepare:e2e && setup:e2e` (re-copying overwrites) before `test:e2e`; never debug a behavior change against a non-rebuilt copy. `runSetup` only _warns_ about missing assets, so check its log — a typo'd module id won't abort it.
- Install the framework as a **sibling clone** consumed via `file:../foundryvtt-test-framework` (this is what `config.example.mjs`'s `../../../foundryvtt-test-framework/...` paths assume): `FoundryVTT-Node/` lives inside the package dir, and installing into `node_modules` means every `npm ci` wipes your manually downloaded server.
- Click helpers already `_pause(100)` internally — don't add extra sleeps; the knight module's injected buttons live in the last `li.chat-message` under `.chat-scroll`, which is exactly what `clickInLastChatMessage*` scopes to.
- Dice override mechanics: FIFO match on `faces` + `count` (`null` count = wildcard); the extension is inert outside `http://localhost`; **success-counting dice (`r.count !== undefined`) are intentionally _not_ overridable** — if a knight roll form counts successes instead of summing, it can't be pinned this way (note it and use fixture messages for that path). Don't read `window.__diceOverrideQueue` back from Playwright — the extension owns it.
- One `fw.start()`/`fw.stop()` per test file (start is slow: server + browser + world load). Group cases per file; reset state between cases (heal the victim, delete recap messages, clear flags via `executeInFoundry` helpers).
- Prefer `waitFor` over fixed sleeps; on failure call `fw.screenshot('case-name.png')` then `fw.stop()` — screenshots land in `test-data/screenshots/` (gitignore it).
- Keep French strings in assertions (`'Dégâts'`, `'Récapitulatif des dégâts'`, `'Normal'`) — they are load-bearing selectors, not incidental.
- Framework's own style (only if contributing helpers upstream): 4-space indent, no semicolons in `src/`, minimal single-purpose helpers that throw errors naming the failed selector.

## Risks / open questions to resolve during Phase 1

- The **`knight` system is a hard runtime dependency** and the module also regex-parses its chat HTML; fixtures encode that coupling. Pin the system version in the fixture filenames (`message-pnj-attack-v1.x.json`).
- Whether the knight system's own chat flow is scriptable enough for Phase 2-A; if not, fall back entirely to fixtures + button clicks.
- Framework needs `FoundryVTT-Node/` which is git-ignored and licensed — nothing in this repo can automate the **download** legally; on a machine with a licensed local install, copying its `App/resources/app` works (Phase 0, verified 2026-11-01); otherwise the manual download step in the plan applies.
- `handleClickApplyDamage` iterates `canvas.activeLayer.controlled` — clicking a button while several tokens are controlled applies to all of them; release control between cases.

## Out of scope

- CI for e2e (impossible with a licensed Foundry), multi-user/websocket behavior beyond the `CONFIG.queries` round-trip, sheet HTML beyond the injected buttons.
- Headless browser infra for unit tests — Foundry globals are stubbed, never a real Foundry (that's the e2e layer's job).
