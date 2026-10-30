# Test plan — unit (vitest) + e2e (foundryvtt-test-framework)

Two layers, kept strictly separate:

- **Unit suite (vitest, plain node env)** — pure logic in `src/module/`: damage calculation combinatorics, message parsing, flag helpers. Fast, no Foundry needed, **runs in CI**. This is where the damage-math regressions get caught.
- **E2E suite (foundryvtt-test-framework)** — real Foundry instance driven by Playwright with a dice-override extension (`clickInLastChatMessage`, `queueDiceOverride`, `waitFor`, …). Covers Hooks, chat-button DOM, canvas token control, sheets, sockets. **Local-only** (licensed Foundry install), never in CI.

CI order becomes `lint -> test:unit -> build`. The e2e suite stays local (`test:e2e`).

## Phase U — Unit suite with vitest (do this first; it's cheaper than e2e)

The damage classes touch **no Foundry APIs at module top-level** — `foundry.*`, `game`, `ChatMessage`, `fromUuidSync` are only called inside methods — so they are unit-testable with plain object doubles.

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
4. **Characterization rule**: pin *current* behavior first (including suspected bugs below); each pinned oddity gets a `// CHARACTERIZATION:` comment. Fixes come later as deliberate commits with tests updated.

Test targets, per file:

- **Standard fixtures (use these values everywhere unless a case needs otherwise):** weapon `weapon.effets.raw` containing `percearmure 40` + `penetrant 6`; victim knight with **normal `armure` 100**, CdF fixtures straddling 6 (`cdf 4` → CdF fully zeroed by pénétrant; `cdf 10` → effective CdF 4 via `applyTraitCdf`). Against *full* 100 armor, perce-armure 40 changes nothing: `100 ≤ 40` is false so `isArmorIgnored()` stays false, and the subtractive `applyTraitArmure()` is commented out in `DamageKnight.calculate` and uncalled in vehicule/mecha — pin that no-op. The armor-**bypass** branch (`isArmorIgnored()` true) requires a **worn-armor fixture** (`armure` ≤ 40, e.g. 30): there the armure track is skipped and post-CdF damage goes straight to sante math. `cuirDuTaureau` and `instinct-du-loup → percearmure: 'active'` are the two documented flips on that worn-armor fixture — each needs a paired case (taureau re-engages the armure track; loup zeroes `perceArmure` so full-armor behavior is restored for the worn victim).
- `helpers.test.mjs` — `getTraitValue` (e.g. `'Perce-armure 40'` → 40, `'Pénétrant 6'` → 6), `extractTraitValue` (the French HTML `<span class="label">…<span class="value">+N` regex), `hasStatusEffect`, `generateReminderData` (uuid `.`→`_` key encoding, revert negation, accumulation).
- `damage-base.test.mjs` — damage extraction: `flags.knight.targets[].value × mult` with `Math.ceil`; the `Débordement`/`Mode Oriflamme` content-regex fallback (which also auto-adds `ignorearmure`/`ignorechampdeforce`/`antivehicule` to `weapon.effets.raw` when the initiator has the matching item); `percearmure 40`/`penetrant 6` parsed from `weapon.effets.raw` into `perceArmure`/`penetrant`; `calculateDamageStat` overflow arithmetic; `calculateArmureVersSante` tranche 5; /10 colosse with `antivehicule` defeating it; `apply()` update-payload mapping.
- `damage-knight.test.mjs` — order Egide → CdF → armure → guardian branch (`armure <= 0`, not `folde`, `wear != 'guardian'`, `apply-guardian-cdf` status) → sante; `infatigable` skipping the armure→sante carry; `cuirDuTaureau` forcing armor despite ignorearmure; `destructeur`/`meurtrier` insertion points; espoir path with `system.espoir.reduction` floor 0; `instinct-du-loup` item flag neutralizing `percearmure`/`ignorearmure`/`ignorecdf`; `Rire du corbeau` energie split (DialogV2 stubbed); energie/espoir reminder `user.query` payload (stub `game.users.activeGM.query`).
- `damage-vehicule-mecha.test.mjs` — vehicule `/10` colosse, `antivehicule` bypass, passenger carry `/5`; mecha blindage track and passenger carry `/10` tranche.
- `recap-message.test.mjs` — with `ChatMessage.create` stubbed via `vi.fn()`, assert recap HTML lines and `flags['knight-damage']` = `{ recap, isRecap, origin }` (+ `wear`/`anatheme` on knight).

Known code quirks the unit suite must pin (verify, don't silently "fix"):

- ~~`damageVehicule.js` missing `()` on `isColosseApplied`~~ — **fixed** (both call sites now invoke it). Phase U should instead *lock the fix in*: a test with an `antivehicule` attack vs a vehicule with `armure > 0` must show Destructeur applied via the armor branch (`!isColosseApplied()` true), and must not be gated on the `/10` number; plus the normal non-antivehicule case keeping line-19 gating. This is the regression the bug hid for months.
- `DamageKnight.revertDamage` restores stats via `setTimeout(100/101)` — use `vi.useFakeTimers()` + `vi.advanceTimersByTime()`; the base `revertDamage` has no timers.
- `apply()` maps `cohesion` damage onto `system.sante.value` (`damageBase.js:286`) — assert the exact update key the current code emits.
- `askModifier`/`askDamageEnergie` need `foundry.applications.api.DialogV2.prompt` stubbed to resolve values; `switchArmure` (sheet DOM + more timers) stays **out of unit scope** — e2e only.

CI: add unit tests to `.github/workflows/checks.yml` (`npm ci` → `npm run lint` → `npm test` → build), same Node 20 setup as existing jobs. Keep husky pre-commit lint-only unless `vitest run` stays under ~2s.

Unit scope boundary: anything touching `Hooks`, `canvas`, `renderXxx` handlers, jQuery `html` chaining, or sockets/`CONFIG.queries` wiring stays e2e. Unit tests instantiate `Damage*` classes directly and call `calculate()` / `apply()` / `generateRecapMessage()` themselves.

## Phase 0 — E2E prerequisites (verify by hand first)

- [ ] Local Foundry VTT install with a valid license, **v14**, and the **`knight` system installed** in `Data/systems/knight` (the module hard-depends on the system's chat-message flags — see Risks).
- [ ] Unpack Foundry's **Node.js server** as `FoundryVTT-Node/` inside the framework package dir (not in git; download from foundryvtt.com).
- [ ] A manually authored **test world** (e.g. `knight-damage-test`) with one scene containing:
  - a `pnj` attacker token (damage source),
  - a `knight` victim token with known `armure` (**normal 100**) / `champDeForce` / `egide` / guardian gear / `sante` / `espoir` / `energie`,
  - a `vehicule` victim token (blindage/cohesion, resilience stat),
  - a `mechaarmure` victim token.
  Token display names are used by `selectTokensByName`, so keep them stable and ASCII.
- [ ] Node 18+ (repo uses `lts/*`, CI uses 20).

## Phase 1 — Scaffold (make a smoke test pass)

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
4. **Build-then-copy flow**: `modulesToCopy` copies from `Data/modules/knight-damage`, so the module must be current in the *source* data folder before `setup:e2e`. Add scripts:
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

## Phase 2 — Getting a *knight* damage message into chat (shared fixture problem)

Every core feature keys off the knight system's message output: `flags.knight.targets[].value`, `flags.knight.weapon.effets.raw`, `flags.knight.actor.*`, and regexes over French HTML (`Dégâts</div>`, `Débordement</div>`). Two ways to produce a message:

- **A. Real attack rolls** (end-to-end, but couples tests to the knight system's UI): GM attack action from the attacker token, `queueDiceOverride(faces, count, value)` to pin every die in the pool (FIFO by die type/count — order matters, knight rolls consume pools in system order).
- **B. Recorded fixtures** (recommended for logic tests): record a real message once — run a live attack manually, then dump it:
  ```js
  await fw.executeInFoundry(() => game.messages.contents.at(-1).toObject(true))
  ```
  save to `tests/e2e/fixtures/*.json`, and in tests recreate with `ChatMessage.create(fixture)` (removing `_id`/`id`/`timestamp`). **Record the reference weapon with `percearmure 40` + `penetrant 6` effects** so the recorded fixture *is* the standard weapon used across unit and e2e suites. Re-record fixtures after any knight system upgrade. **These fixture JSONs double as input for the unit suite's `makeMessage`** (Phase U) — one source of truth for the knight message contract.

Use A for one integration test per actor type; use B for the combinatorics (traits, multiplier, armor interactions).

## Phase 3 — Core damage pipeline (`damage-knight.test.mjs`)

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

> **Gotcha:** `handleClickApplyDamage` early-returns unless `canvas.activeLayer.controlled.length > 0`. The framework's `selectTokensByName` sets *targets*, which is not the same as *controlled/selected* — verify which one it leaves behind; if it's only targeting, control tokens explicitly as above.

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

- Vehicule: `blindage` track; `isColosseApplied()` is always true for `vehicule` → incoming damage `trunc(damage/10)` — the single most regression-prone rule; overflow to santé via /5.
- `antivehicule` weapon effect defeats the /10 colosse rule → test both with and without.
- Mechaarmure: its stat track (blindage/cohesion mapping in `apply()` — `cohesion` writes to `system.sante.value`; assert the actual system field name).

## Phase 5 — Espoir / Energie reminders

- Click **Energie** button → `system.energie.value` drops AND attacker actor flag `knight-damage.energie` gains a key = victim uuid with `.` → `_` (e.g. `Scene_X_token_Y_actor_Z` style) incrementing by the damage dealt. Assert the raw flag keys — the `_`↔`.` encoding in `generateReminderData`/`generateReminderMessage` is a silent-corruption risk if regressed.
- **Espoir** target button → `system.espoir.value` drops; flag `knight-damage.espoir` updated.
- **Death reminder**: add an ActiveEffect named `Dead` to the victim (`executeInFoundry`) → a new chat message appears containing `Dégâts d'energie infligés` and the per-origin breakdown (`waitForChatMessage(m => m.content.includes(...))`).

## Phase 6 — Hook & sheet edge cases

- **Anti-anathème**: give the victim the `anti-anatheme` status; update an attack message whose `weapon.effets.raw` lacks `antianatheme` → after update, raw contains it (`preUpdateChatMessage`).
- **Instinct du loup**: open the knight actor's `Instinct du loup` *module-item* sheet (hook is `renderModuleSheet` — a knight system item type, not a Foundry module) → injected buttons exist; click one → item flag `knight-damage.loup.<option>` toggles `'active'`/`'unactive'` (flag value is literally the button's className — assert exact strings).
- **Instinct du loup damage interaction**: with `percearmure: 'active'` flag, an attack *against* that knight still has its perce-armure neutralized (`applyInstinctDuLoup` runs first in `calculate`).
- (Optional) `shrine` / `shrine-ameliore` status effects add +6 / +8 to `system.champDeForce.base` (mode 2) — assert via preparedCdF after granting the effect.

## E2E test style rules (from the framework's README + CLAUDE.md)

- `waitFor` predicates run **in the browser** and must return plain serializable objects — never Foundry Documents; look docs up by id/uuid inside the page function.
- **Stringify rule:** every function handed to `executeInFoundry` / `waitFor` / `waitForChatMessage` is stringified and re-evaluated page-side (`helpers.mjs:buildEvaluator`). No closures over test variables — pass values as trailing args. Worse, predicate exceptions are **swallowed as "not ready yet"**: a `ReferenceError` from a leaked closure variable surfaces as a full-timeout hang with no error. When a `waitFor` mysteriously times out, suspect a closure leak first.
- **Stale-code trap**: the module under test is a *copy* inside `testDataPath`. After any `src/` change, re-run `prepare:e2e && setup:e2e` (re-copying overwrites) before `test:e2e`; never debug a behavior change against a non-rebuilt copy. `runSetup` only *warns* about missing assets, so check its log — a typo'd module id won't abort it.
- Install the framework as a **sibling clone** consumed via `file:../foundryvtt-test-framework` (this is what `config.example.mjs`'s `../../../foundryvtt-test-framework/...` paths assume): `FoundryVTT-Node/` lives inside the package dir, and installing into `node_modules` means every `npm ci` wipes your manually downloaded server.
- Click helpers already `_pause(100)` internally — don't add extra sleeps; the knight module's injected buttons live in the last `li.chat-message` under `.chat-scroll`, which is exactly what `clickInLastChatMessage*` scopes to.
- Dice override mechanics: FIFO match on `faces` + `count` (`null` count = wildcard); the extension is inert outside `http://localhost`; **success-counting dice (`r.count !== undefined`) are intentionally *not* overridable** — if a knight roll form counts successes instead of summing, it can't be pinned this way (note it and use fixture messages for that path). Don't read `window.__diceOverrideQueue` back from Playwright — the extension owns it.
- One `fw.start()`/`fw.stop()` per test file (start is slow: server + browser + world load). Group cases per file; reset state between cases (heal the victim, delete recap messages, clear flags via `executeInFoundry` helpers).
- Prefer `waitFor` over fixed sleeps; on failure call `fw.screenshot('case-name.png')` then `fw.stop()` — screenshots land in `test-data/screenshots/` (gitignore it).
- Keep French strings in assertions (`'Dégâts'`, `'Récapitulatif des dégâts'`, `'Normal'`) — they are load-bearing selectors, not incidental.
- Framework's own style (only if contributing helpers upstream): 4-space indent, no semicolons in `src/`, minimal single-purpose helpers that throw errors naming the failed selector.

## Risks / open questions to resolve during Phase 1

- The **`knight` system is a hard runtime dependency** and the module also regex-parses its chat HTML; fixtures encode that coupling. Pin the system version in the fixture filenames (`message-pnj-attack-v1.x.json`).
- Whether the knight system's own chat flow is scriptable enough for Phase 2-A; if not, fall back entirely to fixtures + button clicks.
- Framework needs `FoundryVTT-Node/` which is git-ignored and licensed — document the manual download step in the plan/README; nothing in this repo can automate it legally.
- `handleClickApplyDamage` iterates `canvas.activeLayer.controlled` — clicking a button while several tokens are controlled applies to all of them; release control between cases.

## Out of scope

- CI for e2e (impossible with a licensed Foundry), multi-user/websocket behavior beyond the `CONFIG.queries` round-trip, sheet HTML beyond the injected buttons.
- Headless browser infra for unit tests — Foundry globals are stubbed, never a real Foundry (that's the e2e layer's job).
