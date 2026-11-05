// E2E smoke test (Phase 1 of docs/testing-plan.md): boot a real Foundry v14 with the knight system
// + the built knight-damage module and assert the init-hook wiring:
//   1. the knight-damage module is active in the test world,
//   2. CONFIG.statusEffects contains the five module status ids,
//   3. CONFIG.queries['knight-damage.addReminder'] is registered.
//
// Run with `npm run test:e2e` AFTER `npm run prepare:e2e && npm run setup:e2e`.
// The --preserve-symlinks respawn guard and the three framework v2.0.0 workarounds now live in
// tests/e2e/support/framework.mjs (shared with record-fixtures.mjs / fixtures.test.mjs).

import config from './config.mjs';
import { loadFramework, respawnPreservingSymlinks } from './support/framework.mjs';
import { acquireSpawnMutex } from './support/spawn-lock.mjs';
import { installQuietConsole, terminalLine } from './support/quiet-console.mjs';

/* global process */

// NOTE: the framework import must stay DYNAMIC (inside the preserved branch) — a static import at
// this file's top would be evaluated by the initial, un-preserved process before the respawn runs.
if (respawnPreservingSymlinks()) {
  // Parent: the symlink-preserving child inherited stdio and carries the run.
} else {
  const Framework = await loadFramework();

  main(Framework).catch((err) => {
    console.error(`\nE2E SMOKE FAIL: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });
}

async function main(Framework) {
  acquireSpawnMutex(); // ownership before ANYTHING (see support/spawn-lock.mjs)
  // Quiet-terminal policy (support/quiet-console.mjs): framework/progress logging goes to
  // test-data/e2e-logs/smoke.log; the terminal keeps only the PASS/FAIL assertion lines and the
  // E2E summary (this suite is a single case - the 3 assertions ARE the case state).
  // KDT_E2E_VERBOSE=1 restores the full live terminal.
  installQuietConsole({ testDataPath: config.testDataPath, name: 'smoke' });
  const fw = new Framework(config);
  const results = [];

  try {
    await fw.start();

    // Page functions below are stringified into the browser (framework stringify rule): they touch
    // only Foundry globals and return plain serializable values — no closures over test variables.

    const moduleActive = await fw.executeInFoundry(() => game.modules.get('knight-damage')?.active === true);
    results.push(['game.modules.get("knight-damage").active === true', moduleActive === true, `got ${moduleActive}`]);

    const statusIds = await fw.executeInFoundry(() => CONFIG.statusEffects.map((effect) => effect.id));
    const wanted = ['anti-anatheme', 'folde', 'apply-guardian-cdf', 'shrine', 'shrine-ameliore'];
    const missingStatus = wanted.filter((id) => !statusIds.includes(id));
    results.push([
      `CONFIG.statusEffects contains ${wanted.join(', ')}`,
      missingStatus.length === 0,
      `missing: ${missingStatus.join(', ')}`,
    ]);

    const queryType = await fw.executeInFoundry(() => typeof CONFIG.queries['knight-damage.addReminder']);
    results.push([
      "CONFIG.queries['knight-damage.addReminder'] is a function",
      queryType === 'function',
      `typeof = ${queryType}`,
    ]);

    for (const [label, ok, detail] of results) {
      terminalLine(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — ${detail}`}`);
    }

    const failures = results.filter(([, ok]) => !ok).length;
    if (failures > 0) {
      await fw.screenshot('smoke-failure.png').catch(() => {});
      terminalLine(
        `\nE2E SMOKE: FAIL (${failures}/${results.length} assertions failed; screenshot in test-data/screenshots/)`,
      );
    } else {
      terminalLine(`\nE2E SMOKE: PASS (${results.length}/${results.length} assertions)`);
    }
    process.exitCode = failures > 0 ? 1 : 0;
  } catch (err) {
    await fw.screenshot('smoke-failure.png').catch(() => {});
    throw err;
  } finally {
    await fw.stop();
    console.log('Foundry server + browser stopped.');
  }
}
