// Repo-root ownership mutex for ALL e2e entry scripts (setup/record/smoke/fixtures).
// Two Foundry servers must never share one test-data/ LevelDB dir, and two chrome launches must
// never share one profile: every e2e script acquires this BEFORE touching anything.
// (Historical race that motivated it: the boot gate's stale-lock purge saw a free port while
// another run's server was still BOOTING — spawn -> lock-acquire -> listen takes ~2 s — and
// purged that run's active options.json.lock. The port probe cannot distinguish "booting" from
// "absent", hence ownership bookkeeping instead of probing.)
//
// Placement: repo root (`<repo>/.e2e-spawn.lock/`, git-ignored). Each worktree owns its own
// test-data/ and chrome profile, so the mutex only needs to serialize runs of the SAME worktree;
// the shared sibling clone (FoundryVTT-Node + dice extension) is read-only to e2e runs.
//
// Liveness protocol (review 2, findings B-1/B-2):
// - The owner writes its PID into <mutex>/pid.
// - A second acquirer that finds the mutex checks age FIRST (fresh -> simply held), and only in
//   the stale window probes the PID: a LIVE owner (long legitimate run) blocks self-healing; a
//   dead owner's lock is purged. Bounded retries — no unbounded recursion on stat hiccups.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* global process */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MUTEX_PATH = path.join(REPO_ROOT, '.e2e-spawn.lock');
const PID_FILE = path.join(MUTEX_PATH, 'pid');
const STALE_MS = 15 * 60 * 1000;

function heldError(detail) {
  return new Error(
    `another e2e run owns the test data (${MUTEX_PATH}) — ${detail}; if a previous run crashed, ` +
      'delete .e2e-spawn.lock manually',
  );
}

function ownerAlive() {
  try {
    const pid = Number.parseInt(readFileSync(PID_FILE, 'utf8'), 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0); // signal 0 = liveness probe only
    return true;
  } catch {
    return false;
  }
}

export function acquireSpawnMutex() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      mkdirSync(MUTEX_PATH);
      writeFileSync(PID_FILE, String(process.pid), 'utf8');
      process.once('exit', () => rmSync(MUTEX_PATH, { recursive: true, force: true }));
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let ageMs;
      try {
        ageMs = Date.now() - statSync(MUTEX_PATH).mtimeMs;
      } catch {
        continue; // vanished mid-race (or transient stat hiccup): retry mkdir, bounded attempts
      }
      if (ageMs < STALE_MS) throw heldError(`held for ${Math.round(ageMs / 1000)}s`);
      if (ownerAlive())
        throw heldError(
          `owner pid still alive after ${Math.round(ageMs / 60000)}min — a legitimately long run needs STALE_MS raised`,
        );
      rmSync(MUTEX_PATH, { recursive: true, force: true }); // stale AND owner dead: self-heal, retry once
    }
  }
  throw heldError('lock keeps reappearing between attempts — concurrent e2e launch?');
}
