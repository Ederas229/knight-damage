// E2E smoke test (Phase 1 of docs/testing-plan.md): boot a real Foundry v14 with the knight system
// + the built knight-damage module and assert the init-hook wiring:
//   1. the knight-damage module is active in the test world,
//   2. CONFIG.statusEffects contains the five module status ids,
//   3. CONFIG.queries['knight-damage.addReminder'] is registered.
//
// Run with `npm run test:e2e` AFTER `npm run prepare:e2e && npm run setup:e2e`.

import { spawn } from 'node:child_process';
import config from './config.mjs';

/* global process */

// npm installs the `file:../foundryvtt-test-framework` devDependency as a Windows JUNCTION into the
// sibling clone. Node realpaths junctioned module paths by default, so the framework's own
// `playwright` import would resolve relative to the CLONE (no node_modules up its tree) and fail.
// Respawn this script once with --preserve-symlinks so resolution stays inside
// node_modules/foundryvtt-test-framework and finds the repo-hoisted playwright devDependency.
// NOTE: the framework import must stay DYNAMIC (inside the preserved branch) — a static import at
// this file's top would be evaluated by the initial, un-preserved process before the respawn runs.
if (!process.env.KDT_E2E_PRESERVE_SYMLINKS) {
  const child = spawn(process.execPath, ['--preserve-symlinks', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, KDT_E2E_PRESERVE_SYMLINKS: '1' },
  });
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  const { FoundryTestFramework } = await import('foundryvtt-test-framework');

  // Upstream _spawnServer() passes only --dataPath/--port/--world. On this network the v14 server's
  // external IP-discovery probes never settle, so Express.addresses stays null and the socket JOIN
  // payload crashes server-side in getInvitationLinks() ("Cannot read properties of null (reading
  // 'local')") — the client then hangs on the black loading screen forever. --noipdiscovery=true
  // makes getIPAddresses() return a local-only address set, which fixes the join handshake.
  const SmokeFramework = class extends FoundryTestFramework {
    _spawnServer() {
      const { foundryNodePath, testDataPath, foundryServerPort } = this.config;
      const args = ['main.js', `--dataPath=${testDataPath}`];
      if (foundryServerPort !== 30000) args.push(`--port=${foundryServerPort}`);
      if (this.config.world) args.push(`--world=${this.config.world}`);
      args.push('--noipdiscovery=true');

      console.log(`[foundryvtt-test-framework] Starting Foundry server on port ${foundryServerPort ?? 30000}...`);
      this.serverProcess = spawn('node', args, {
        cwd: foundryNodePath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.serverProcess.stdout.on('data', (d) => process.stdout.write(`[foundry] ${d}`));
      this.serverProcess.stderr.on('data', (d) => process.stderr.write(`[foundry] ${d}`));
      this.serverProcess.on('error', (err) => {
        throw new Error(`Foundry server failed to start: ${err.message}`);
      });
      return Promise.resolve();
    }

    async _login() {
      await this.page
        .waitForSelector('select[name="userId"], select[name="userid"]', { timeout: 60000 })
        .catch(() => null);

      const hasLoginForm = await this.page
        .locator('select[name="userId"], select[name="userid"]')
        .count()
        .then(
          (c) => c > 0,
          () => false,
        );
      if (!hasLoginForm) {
        console.log('[foundryvtt-test-framework] No login form — assuming session already active.');
        return;
      }

      console.log(`[foundryvtt-test-framework] Logging in as "${this.config.loginUser ?? 'Gamemaster'}"...`);
      const found = await this.page.evaluate((userName) => {
        const sel = document.querySelector('select[name="userId"], select[name="userid"]');
        const opt = Array.from(sel.options).find((o) => o.text === userName);
        if (!opt) return false;
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, this.config.loginUser ?? 'Gamemaster');

      if (!found)
        throw new Error(
          `[foundryvtt-test-framework] User "${this.config.loginUser ?? 'Gamemaster'}" not found in login select`,
        );

      await this.page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(
          (b) => b.textContent.trim() === 'Join Game Session',
        );
        btn?.click();
      });

      await new Promise((r) => setTimeout(r, 3000));
    }
  };

  main(SmokeFramework).catch((err) => {
    console.error(`\nE2E SMOKE FAIL: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });
}

async function main(Framework) {
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
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — ${detail}`}`);
    }

    const failures = results.filter(([, ok]) => !ok).length;
    if (failures > 0) {
      await fw.screenshot('smoke-failure.png').catch(() => {});
      console.log(
        `\nE2E SMOKE: FAIL (${failures}/${results.length} assertions failed; screenshot in test-data/screenshots/)`,
      );
    } else {
      console.log(`\nE2E SMOKE: PASS (${results.length}/${results.length} assertions)`);
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
