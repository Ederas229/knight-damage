// Repo-root mutex guarding ALL e2e entry scripts (setup/record/smoke/fixtures) — review finding:
// the boot gate's stale-lock purge is only safe when no OTHER e2e run is active. Two scripts
// launched concurrently (two terminals) could otherwise race: script B's TCP port probe sees the
// port free while script A's server is still booting (spawn -> lock-acquire -> listen takes ~2 s),
// B then purges the lock A just took, and two Foundry servers share one test-data/ LevelDB dir.
//
// The mutex lives at the REPO ROOT (`<repo>/.e2e-spawn.lock/`, git-ignored), NOT inside
// testDataPath — runSetup wipes test-data mid-run, which would sweep a mutex placed there.
// mkdir() is atomic; a crashed run leaves the mutex behind, so it self-heals after STALE_MS.

import { mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* global process */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MUTEX_PATH = path.join(REPO_ROOT, '.e2e-spawn.lock');
const STALE_MS = 15 * 60 * 1000;

export function acquireSpawnMutex() {
  try {
    mkdirSync(MUTEX_PATH);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let mtimeMs = null;
    try {
      mtimeMs = statSync(MUTEX_PATH).mtimeMs;
    } catch {
      return acquireSpawnMutex(); // vanished between EEXIST and stat: another run just released
    }
    const ageMs = Date.now() - mtimeMs;
    if (ageMs < STALE_MS)
      throw new Error(
        `another e2e run owns the test data (lock at ${MUTEX_PATH}, age ${Math.round(ageMs / 1000)}s) — ` +
          'e2e scripts must not run concurrently; if a previous run crashed, delete .e2e-spawn.lock manually',
      );
    rmSync(MUTEX_PATH, { recursive: true, force: true }); // crashed run older than STALE_MS: self-heal
    mkdirSync(MUTEX_PATH);
  }
  process.once('exit', () => rmSync(MUTEX_PATH, { recursive: true, force: true }));
}
