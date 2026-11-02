// Shared e2e bootstrap (hoisted verbatim from the Phase-1 smoke.test.mjs).
//
// Why each entry script must call `respawnPreservingSymlinks()` before touching the framework:
// npm installs the `file:../foundryvtt-test-framework` devDependency as a Windows JUNCTION into the
// sibling clone. Node realpaths junctioned module paths by default, so the framework's own
// `playwright` import would resolve relative to the CLONE (no node_modules up its tree) and fail.
// Respawn the entry script once with --preserve-symlinks so resolution stays inside
// node_modules/foundryvtt-test-framework and finds the repo-hoisted playwright devDependency.
// NOTE: framework imports must stay DYNAMIC (inside the preserved branch) — a static import at an
// entry file's top would be evaluated by the initial, un-preserved process before the respawn runs.
//
// Why `loadFramework()` returns a SUBCLASS (all three workarounds are framework v2.0.0 bugs,
// verified in Phase 1; upstream issues to file):
// 1. _spawnServer: its plain arg set leaves external IP-discovery probes pending on this network,
//    Express.addresses stays null, and the socket JOIN crashes server-side in getInvitationLinks()
//    ("Cannot read properties of null (reading 'local')") — the client hangs on the black loading
//    screen. --noipdiscovery=true makes getIPAddresses() return a local-only address set.
// 2. _login: upstream selector is `select[name="userid"]` but v14 renders `name="userId"`
//    (capital D) — login was skipped and game.ready never flipped.
// 3. _launchBrowser: headless:true maps to Playwright's rejected `headless: "new"` value, so
//    headless:false is the only working mode today (kept as-is). The override also pins the
//    browser locale to fr-FR: the knight system localizes its chat HTML through game.i18n and the
//    module under test regexes on FRENCH fragments (`Dégâts</div>`); with an en-US locale the
//    system renders `Damage</div>` and the whole message contract would drift.
// Upstream issue candidate #4 (kept verbatim, NOT diverged): the base _spawnServer throws inside
// the ChildProcess 'error' listener, which surfaces as an uncaught exception instead of rejecting
// start() — our override copies the same pattern so the issue batch sees it unchanged.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { acquireSpawnMutex } from './spawn-lock.mjs';

/* global process */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => {
      sock.destroy();
      resolve(false);
    });
  });
}

export const PRESERVE_SYMLINKS_ENV = 'KDT_E2E_PRESERVE_SYMLINKS';

/**
 * If this process is NOT yet symlink-preserving, respawn itself once and return true
 * (the caller must then do nothing else — the child inherits stdio and carries the run).
 * Returns false inside the preserved child, where framework imports are allowed.
 */
export function respawnPreservingSymlinks() {
  if (process.env[PRESERVE_SYMLINKS_ENV]) return false;

  const child = spawn(process.execPath, ['--preserve-symlinks', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, [PRESERVE_SYMLINKS_ENV]: '1' },
  });
  child.on('exit', (code) => process.exit(code ?? 1));
  return true;
}

/**
 * Load the framework (call ONLY from the symlink-preserving branch) and return the patched
 * subclass. The chrome-profile lives in the framework clone; its path is derived from
 * config.foundryNodePath so no absolute machine path enters the repo.
 */
export async function loadFramework() {
  const { FoundryTestFramework } = await import('foundryvtt-test-framework');
  const { chromium } = await import('playwright');

  return class KnightDamageTestFramework extends FoundryTestFramework {
    async _spawnServer() {
      const { foundryNodePath, testDataPath, foundryServerPort } = this.config;
      const port = foundryServerPort ?? 30000;

      // Ownership first (see support/spawn-lock.mjs): the port probe below only proves no server is
      // LISTENING yet — a booting server from a concurrent e2e run would slip through, so the
      // repo-root mutex is what makes purging options.json.lock safe.
      acquireSpawnMutex();

      // Gate against back-to-back runs: stop() sends SIGTERM, and on Windows the data-dir lock
      // (Foundry proper-lockfiles Config/options.json -> options.json.lock/ for up to `stale: 1e4`ms)
      // plus the LISTEN socket can briefly outlive the kill. Wait for the port to free, then
      // clear any stale lock so the fresh boot never hits "already locked by another process".
      const deadline = Date.now() + 15000;
      while (await portInUse(port)) {
        if (Date.now() > deadline) throw new Error(`port ${port} still in use after 15s — stale Foundry server?`);
        await sleep(250);
      }
      rmSync(path.join(testDataPath, 'Config', 'options.json.lock'), { recursive: true, force: true });

      const args = ['main.js', `--dataPath=${testDataPath}`];
      if (port !== 30000) args.push(`--port=${port}`);
      if (this.config.world) args.push(`--world=${this.config.world}`);
      args.push('--noipdiscovery=true');

      console.log(`[foundryvtt-test-framework] Starting Foundry server on port ${port}...`);
      this.serverProcess = spawn('node', args, {
        cwd: foundryNodePath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.serverProcess.stdout.on('data', (d) => process.stdout.write(`[foundry] ${d}`));
      this.serverProcess.stderr.on('data', (d) => process.stderr.write(`[foundry] ${d}`));
      this.serverProcess.on('error', (err) => {
        throw new Error(`Foundry server failed to start: ${err.message}`);
      });
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

    async _launchBrowser() {
      const { diceOverrideExtensionPath, headless, foundryNodePath } = this.config;
      // Same persistent profile the upstream base uses (chrome-profile/ at the framework clone
      // root, next to FoundryVTT-Node/), but computed from config so no absolute path is hardcoded.
      const chromeProfilePath = path.resolve(foundryNodePath, '..', 'chrome-profile');

      console.log('[foundryvtt-test-framework] Launching browser...');
      this.context = await chromium.launchPersistentContext(chromeProfilePath, {
        headless: headless === true ? 'new' : false,
        viewport: null,
        locale: 'fr-FR', // see header: the knight chat HTML contract is French
        args: [
          `--disable-extensions-except=${diceOverrideExtensionPath}`,
          `--load-extension=${diceOverrideExtensionPath}`,
          '--window-size=1920,1080',
        ],
      });
    }
  };
}
