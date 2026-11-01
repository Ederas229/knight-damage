// Copy to config.mjs (gitignored) and adjust sourceDataPath for your machine — it is the same value
// as the gitignored foundryconfig.json "dataPath" (licensed Foundry user-data root, portable installs
// included). The knight system version this suite is pinned against: 3.58.38 (core 14.369).

import { fileURLToPath } from 'node:url';

export default {
  // Existing Foundry data folder to copy test assets from
  // (license.json is picked up automatically from <sourceDataPath>/Config/).
  sourceDataPath: 'C:\\Users\\<you>\\AppData\\Local\\FoundryVTT',

  systemsToCopy: ['knight'],
  // socketlib is NOT optional: the knight system declares it in relationships.requires.
  modulesToCopy: ['knight-damage', 'socketlib'],
  worldsToCopy: ['knight-damage-test'],

  // Run via `npm run prepare:e2e` first: it rebuilds dist/ and file-copies it into
  // <sourceDataPath>/Data/modules/knight-damage (modulesToCopy copies from there).
  world: 'knight-damage-test',

  testDataPath: fileURLToPath(new URL('../../test-data', import.meta.url)),

  // The sibling foundryvtt-test-framework clone that the `file:../foundryvtt-test-framework`
  // devDependency junctions to. FoundryVTT-Node/ (the licensed node server, gitignored inside the
  // clone — npm's junction never copies it) and dice-override/ live in the CLONE, not in node_modules.
  foundryNodePath: fileURLToPath(new URL('../../../foundryvtt-test-framework/FoundryVTT-Node', import.meta.url)),
  diceOverrideExtensionPath: fileURLToPath(
    new URL('../../../foundryvtt-test-framework/dice-override', import.meta.url),
  ),

  // Server and browser settings
  foundryServerPort: 30001, // avoid clashing with a dev server on 30000
  loginUser: 'Gamemaster', // the test world has no users.db — Foundry auto-creates this passwordless GM
  // false = headed Chromium: the window shows up (good for debugging). Keep false for now: the
  // framework maps headless:true to Playwright `headless: "new"` (framework.mjs:_launchBrowser),
  // which Playwright's option validator rejects ("headless: expected boolean, got string") on every
  // version >= the framework's own 1.60 lock — a known upstream framework bug.
  headless: false,

  // Timeouts — the first boot of the test world also runs the NeDB -> LevelDB migration.
  serverReadyTimeout: 60000,
  foundryReadyTimeout: 120000,
};
