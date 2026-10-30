# AGENTS.md

Foundry VTT **module** (`knight-damage`) that adds damage-apply tooling on top of the French *Knight* TTRPG system (`relationships.systems: knight`, Foundry V14 min/verified). Built from the League FoundryVTT Module Template (gulp + rollup). No tests, no TypeScript.

## Commands

- `npm run build` — clean + rollup bundle + styles + static copy into `dist/`. `npm run build:watch` for watch mode.
- `npm run lint` (eslint flat config) and `npm run format` (prettier). **Lint runs automatically on pre-commit via husky** and in CI (`lint` + `build` jobs). There is no test or typecheck script *yet* — lint + build are the current verification steps, in that order. A two-layer test plan (vitest unit suite, runnable in CI once added; foundryvtt-test-framework e2e, local-only) lives in `docs/testing-plan.md`.
- `npm run link-project` — symlinks `dist/` into Foundry User Data. `foundryconfig.json` is gitignored and per-machine: the local one points at the portable v14 install (`Desktop\Foundry v14`); recreate it in fresh worktrees. Linking needs **admin privileges on Windows** (or Developer Mode). `npm run clean:link` removes the link.
- Node: `lts/*` per `.nvmrc`; CI uses Node 20.

## Build layout (non-obvious)

- Rollup input is `src/module/knight-damage.js`; output is `dist/module/knight-damage.js`. `src/module.json` `esmodules` must keep matching this path.
- Only `src/styles/knight-damage.css` is copied (filename must equal the package id); static copies are limited to `assets, fonts, lang, packs, templates, module.json` (see `staticFiles` in `gulpfile.mjs`) — anything else in `src/` is silently not built.
- In `src/module.json`, the `version`/`url`/`manifest`/`download` fields are literal `"This is auto replaced"` placeholders substituted by `.github/workflows/release.yml` on GitHub release publish. Don't hand-edit them; releases are cut by publishing a tagged GitHub release.

## Architecture

- Entrypoint `src/module/knight-damage.js` wires everything through Foundry `Hooks` (`init` registers status effects and `CONFIG.queries['knight-damage.addReminder']`; `renderChatMessageHTML` injects the damage buttons).
- Damage handling is class-per-actor-type: `DamageBase` subclasses (`DamageKnight`, `DamageVehicule`, `DamageMecha`) dispatched by `createDamageObject()` keyed on actor type (`knight`, `vehicule`, `mechaarmure`). `damageBande.js`, `damageCreature.js`, `damageNpc.js`, `damageBaseNpc.js` exist but are **commented out of dispatch and dead code** — don't assume they're live.
- Damage classes read data out of *knight* system chat messages: `message.flags.knight.*` **and regexes over French HTML fragments** (`Dégâts</div>`, `Débordement</div>`, `<span class="label">…`). Changing knight system chat output breaks these silently.
- All persistent data lives under `knight-damage` document flags (actor, module). Actor UUIDs are stored in flags with `.` replaced by `_` (`generateReminderData` / `generateReminderMessage` rely on this round-trip).
- Debug logging: use `log()` from `src/module/helpers.js`, gated by a `devMode` constant at the top of that file — plain `console.log` is not filtered.
- UI/domain strings are French; commit messages are written in French.

## Conventions

- Prettier: single quotes, semicolons, trailing commas, print width 120. ESLint extends `@typhonjs-fvtt/eslint-config-foundry.js/0.8.0`; Foundry globals (`Hooks`, `game`, `canvas`, `foundry`, …) come from that config — browser-only symbols used in `src/` need `/*global …*/` comments; node globals only allowed in root `*.mjs`/`*.cjs` files.
- To check real Foundry core behaviour/signatures instead of guessing, use the `foundry-vtt-source-access` skill (core source is available locally on this machine).
