// Node-side loader for the recorded knight-message fixtures (tests/e2e/fixtures/*.json).
// Shared by the e2e validation suite AND the unit suite (tests/unit/support/knight-fixtures.mjs)
// — one source of truth for the knight message contract. Deliberately fs+JSON.parse (no `import
// ... with { type: 'json' }`): works identically under vitest and plain node, and no import
// attributes/cross-directory glob surprises.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures', import.meta.url));

// The knight system version the committed fixtures were recorded against. Fixture filenames embed
// the recording-time system version (Risks section of the plan); after a system upgrade, re-record
// (`npm run record:e2e`) and bump this pin.
export const PINNED_KNIGHT_VERSION = '3.58.38';
export const STANDARD_FIXTURE_NAME = `attack-pnj-on-knight-standard-knight-${PINNED_KNIGHT_VERSION}.json`;

// Phase 3 (third review (b)): the TRAIT-bearing weapon recording — the live witness for the
// real `<span class="label">…</span><span class="value">+N` HTML the module's
// extractTraitValue regexes over (the standard weapon only ever renders label-only spans).
export const TRAIT_FIXTURE_NAME = `attack-pnj-on-knight-trait-knight-${PINNED_KNIGHT_VERSION}.json`;

export function listFixtureNames() {
  return readdirSync(FIXTURES_DIR).filter((name) => name.endsWith('.json'));
}

/**
 * Loads one recorded fixture and splits it into { meta, message }:
 * meta = the embedded `fixtureMeta` header, message = the stripped ChatMessage source object
 * ready for `ChatMessage.create(...)` replay (or for the unit suite's doubles).
 */
export function loadRecordedFixture(fileName = STANDARD_FIXTURE_NAME) {
  const filePath = path.join(FIXTURES_DIR, fileName);
  if (!existsSync(filePath)) {
    throw new Error(
      `recorded fixture missing: ${fileName} (expected in ${FIXTURES_DIR}) — run \`npm run record:e2e\` to (re)record`,
    );
  }
  const { fixtureMeta, ...message } = JSON.parse(readFileSync(filePath, 'utf8'));
  return { meta: fixtureMeta, message };
}
