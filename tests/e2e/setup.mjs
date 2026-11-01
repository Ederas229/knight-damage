// Runs the framework's runSetup() (copies license + knight system + knight-damage + socketlib +
// the test world from sourceDataPath into the gitignored test-data/ folder), but fails loudly:
// runSetup only WARNS about missing assets, so we pre-verify every asset it is about to copy and
// also fail on any warning it emits.

import { access } from 'node:fs/promises';
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

  console.log('setup:e2e OK — all requested assets present and copied.');
}

main().catch((err) => {
  console.error(`setup:e2e FAILED: ${err.message}`);
  process.exit(1);
});
