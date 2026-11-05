// Shared e2e bootstrap (hoisted verbatim from the Phase-1 smoke.test.mjs).
//
// HISTORY (2026-11-05): the framework devDependency switched from `file:../foundryvtt-test-framework`
// (a sibling clone; npm installed it as a Windows JUNCTION, which forced every entry script to
// respawn once with --preserve-symlinks so the clone-side playwright import resolved) to a PINNED
// GitHub npm install: node_modules/foundryvtt-test-framework is now a REAL directory whose deps
// resolve normally, so the respawn workaround was REMOVED. The framework's FoundryVTT-Node/ server
// code deliberately lives OUTSIDE node_modules (survives npm ci) - see config.example.mjs.
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
import { createWriteStream, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

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

/**
 * Load the framework (dynamic import keeps resolution inside node_modules/... — trivially safe
 * now that the dependency is a real installed directory) and return the patched subclass. The
 * chrome-profile lives in the worktree-local test-data dir (derived from config.testDataPath) so
 * no absolute machine path enters the repo and concurrent worktrees never share a profile; the
 * machine-local server app (config.foundryNodePath) is only ever read.
 * Entry scripts acquire the ownership mutex (support/spawn-lock.mjs) BEFORE calling start().
 */
export async function loadFramework() {
  const { FoundryTestFramework } = await import('foundryvtt-test-framework');
  const { chromium } = await import('playwright');

  return class KnightDamageTestFramework extends FoundryTestFramework {
    async _spawnServer() {
      const { foundryNodePath, testDataPath, foundryServerPort } = this.config;
      const port = foundryServerPort ?? 30000;

      // Precondition: the ENTRY SCRIPT already acquired the ownership mutex (support/spawn-lock.mjs)
      // — acquiring here would be skipped by start() in serverAlreadyRunning mode.
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
      // Server-log policy: the raw Foundry boot chatter (~1k lines/run) is REDIRECTED to
      // test-data/server.log (truncated per boot, gitignored) instead of flooding the terminal.
      // Set KDT_E2E_SERVER_LOG=1 to stream it live ([foundry]-prefixed) again. Our own suite
      // output (PASS/FAIL lines, PROBE dumps, pageerror echoes) is never affected.
      let serverLog = null;
      if (!process.env.KDT_E2E_SERVER_LOG) {
        serverLog = createWriteStream(path.join(testDataPath, 'server.log'));
        console.log(
          `[foundryvtt-test-framework] Foundry server log redirected to ${path.join(testDataPath, 'server.log')} (set KDT_E2E_SERVER_LOG=1 to stream it live).`,
        );
      }
      this.serverProcess = spawn('node', args, {
        cwd: foundryNodePath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.serverProcess.stdout.on('data', (d) =>
        serverLog ? serverLog.write(d) : process.stdout.write(`[foundry] ${d}`),
      );
      this.serverProcess.stderr.on('data', (d) =>
        serverLog ? serverLog.write(d) : process.stderr.write(`[foundry] ${d}`),
      );
      this.serverProcess.on('error', (err) => {
        throw new Error(`Foundry server failed to start: ${err.message}`);
      });
      // Last-resort orphan cleanup (review 3): the upstream throw-inside-'error'-listener pattern
      // (kept verbatim for the issue batch) surfaces as an UNCAUGHT exception, so the entry
      // scripts' finally-cleanup (fw.stop) may never run — without this the spawned server would
      // outlive us holding port 30001 AND test-data's options.json.lock, poisoning the next run.
      process.once('exit', () => {
        try {
          this.serverProcess?.kill();
        } catch {
          /* already dead */
        }
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
      const { diceOverrideExtensionPath, headless, testDataPath } = this.config;
      // Per-WORKTREE profile inside the (gitignored) test-data dir — deliberately NOT the upstream
      // location (chrome-profile/ at the shared framework-clone root): two checkouts running the
      // suite against the ONE canonical clone would launch two launchPersistentContext calls on one
      // profile ("profile in use"). runSetup does NOT wipe test-data wholesale, so setup:e2e
      // explicitly DELETES this profile — without that, Chrome's persistent cache could serve a
      // stale knight-damage.js after prepare:e2e rebuilt dist/. The clone itself (FoundryVTT-Node,
      // dice extension) stays read-only and is safe to share. NOTE: the framework's openAsUser()
      // still defaults to a clone-root profile — override it before any multi-user Phase-3 case.
      const chromeProfilePath = path.join(testDataPath, 'chrome-profile');

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
