// Runs the framework's runSetup() (copies license + knight system + knight-damage + socketlib +
// the test world from sourceDataPath into the gitignored test-data/ folder), but fails loudly:
// runSetup only WARNS about missing assets, so we pre-verify every asset it is about to copy and
// also fail on any warning it emits.

import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runSetup } from 'foundryvtt-test-framework/setup';
import config from './config.mjs';

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

  // A previous e2e run killed with SIGTERM leaves Foundry's proper-lockfile lock directory
  // (options.json.lock/) behind for up to its 10 s stale window; runSetup spawns a verification
  // server which would then die with "already locked by another process". Clear it up front.
  await rm(path.join(optionsPath + '.lock'), { recursive: true, force: true });

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
