// Runs the framework's runSetup() (copies license + knight system + knight-damage + socketlib +
// the test world from sourceDataPath into the gitignored test-data/ folder), but fails loudly:
// runSetup only WARNS about missing assets, so we pre-verify every asset it is about to copy and
// also fail on any warning it emits.

import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSetup } from 'foundryvtt-test-framework/setup';
import config from './config.mjs';
import { acquireSpawnMutex } from './support/spawn-lock.mjs';

/* global process */

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // One e2e actor at a time (repo-root .e2e-spawn.lock) — wiping test-data while another run's
  // Foundry server holds it is exactly the corruption class this mutex prevents.
  acquireSpawnMutex();

  const checks = [
    ['license.json', path.join(config.sourceDataPath, 'Config', 'license.json')],
    ...(config.systemsToCopy ?? []).map((id) => [
      `system "${id}"`,
      path.join(config.sourceDataPath, 'Data', 'systems', id),
    ]),
    ...(config.modulesToCopy ?? []).map((id) => [
      `module "${id}"`,
      path.join(config.sourceDataPath, 'Data', 'modules', id),
    ]),
    ...(config.worldsToCopy ?? []).map((id) => [
      `world "${id}"`,
      path.join(config.sourceDataPath, 'Data', 'worlds', id),
    ]),
  ];

  const missing = [];
  for (const [label, p] of checks) {
    if (!(await exists(p))) missing.push(`${label} — expected at ${p}`);
  }
  if (missing.length) {
    console.error('setup:e2e FAILED, source assets missing:\n' + missing.map((m) => `  ${m}`).join('\n'));
    console.error(
      'Hint: run `npm run prepare:e2e` first (builds dist/ and file-copies it into Data/modules/knight-damage).',
    );
    process.exit(1);
  }

  // runSetup warns (does not throw) when it skips an asset — treat any warning as fatal.
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(' '));
    originalWarn(...args);
  };
  try {
    await runSetup(config);
  } finally {
    console.warn = originalWarn;
  }

  if (warnings.length) {
    console.error(`setup:e2e FAILED, runSetup reported ${warnings.length} warning(s) while copying:`);
    for (const w of warnings) console.error(`  ${w}`);
    process.exit(1);
  }

  // World-seed overlay (review 3): runSetup copies the world from sourceDataPath — but that is
  // untracked, machine-specific state. The REPO-COMMITTED seed (tests/e2e/world-seed/<id>/) is
  // the reproducible source of truth, so when it exists it OVERWRITES the runSetup copy and the
  // fixture chain becomes re-runnable on any machine with a licensed Foundry install. Pre-seed
  // checkouts (or custom worlds without a seed) fall back to the runSetup copy — loudly noted.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (const id of config.worldsToCopy ?? []) {
    const seedDir = path.join(repoRoot, 'tests', 'e2e', 'world-seed', id);
    const targetDir = path.join(config.testDataPath, 'Data', 'worlds', id);
    if (await exists(seedDir)) {
      await rm(targetDir, { recursive: true, force: true });
      await cp(seedDir, targetDir, { recursive: true });
      console.log(`setup:e2e: world "${id}" overlaid with the repo-committed seed (source of truth).`);
    } else {
      console.warn(
        `setup:e2e: WARNING — no repo seed at tests/e2e/world-seed/${id}/; using the machine-local ` +
          'Data copy (untracked state — record:e2e reproducibility depends on it surviving intact)',
      );
    }
  }

  // The framework copies world.json verbatim, and a fresh test-data boots in Foundry's "en"
  // default. This module's damage regexes (and the recorded chat fixtures) are anchored on the
  // knight system's FRENCH chat HTML, so the test world must boot in fr.
  //
  // In v14.369 the effective lever is the SERVER options file (test-data/Config/options.json,
  // read by ServerSettings.load at boot; the client Game builds Localization from the server-
  // vended game.data.options.language — command-line args do not merge "language" in this build).
  // We also pin world options.language=fr to mirror what the Foundry setup UI would write.
  // Both files are gitignored test-data artifacts — the live Foundry Data dir is never touched.
  const optionsPath = path.join(config.testDataPath, 'Config', 'options.json');
  let options = {};
  if (await exists(optionsPath)) {
    try {
      options = JSON.parse(await readFile(optionsPath, 'utf8'));
    } catch (err) {
      console.error(`setup:e2e FAILED: could not parse ${optionsPath}: ${err.message}`);
      process.exit(1);
    }
  }
  options.language = 'fr';
  await mkdir(path.dirname(optionsPath), { recursive: true });
  await writeFile(optionsPath, JSON.stringify(options, null, 2) + '\n', 'utf8');
  console.log('setup:e2e: set Config/options.json language=fr (chat HTML contract is French).');

  // Hygiene: a previous e2e run killed with SIGTERM leaves Foundry's proper-lockfile lock
  // directory (options.json.lock/) behind for up to its 10 s stale window. Framework v2.0.0
  // runSetup itself never boots a server (validate + copy only — and it wipes/re-copies only
  // Data/systems|modules|worlds + license, NOT the whole test-data tree) — the boot-time
  // port-wait + stale-lock purge lives in support/framework.mjs:_spawnServer — but clearing the
  // artifact here keeps the copied tree clean for whichever script boots next.
  await rm(path.join(optionsPath + '.lock'), { recursive: true, force: true });

  // The persistent chrome-profile (test-data/chrome-profile, see support/framework.mjs) is NOT
  // re-copied by runSetup, so it SURVIVES setup — and with it Chrome's HTTP/disk cache: after
  // prepare:e2e rebuilds dist/, the page could serve yesterday's knight-damage.js and the suite
  // would silently grade a stale bundle (review 3). Delete it here so every session boots with
  // a provably fresh profile against the freshly copied module.
  await rm(path.join(config.testDataPath, 'chrome-profile'), { recursive: true, force: true });
  console.log('setup:e2e: removed persistent chrome-profile (forces fresh cache per session).');

  for (const id of config.worldsToCopy ?? []) {
    const worldJsonPath = path.join(config.testDataPath, 'Data', 'worlds', id, 'world.json');
    if (!(await exists(worldJsonPath))) {
      console.error(`setup:e2e FAILED: expected copied world manifest at ${worldJsonPath}`);
      process.exit(1);
    }
    const world = JSON.parse(await readFile(worldJsonPath, 'utf8'));
    world.options = { ...(world.options ?? {}), language: 'fr' };
    await writeFile(worldJsonPath, JSON.stringify(world, null, 2) + '\n', 'utf8');
    console.log(`setup:e2e: forced world "${id}" options.language=fr (chat HTML contract is French).`);
  }

  console.log('setup:e2e OK — all requested assets present and copied.');
}

main().catch((err) => {
  console.error(`setup:e2e FAILED: ${err.message}`);
  process.exit(1);
});
