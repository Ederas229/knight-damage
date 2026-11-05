// Terminal policy for the e2e suites (paired with the Foundry server-log redirect in
// support/framework.mjs): the suites log heavily — framework progress lines, PROBE dumps,
// payload dumps, per-assertion PASS/FAIL lines. installQuietConsole() keeps ALL of that
// verbatim in a per-suite detail file (test-data/e2e-logs/<name>.log, truncated per run,
// inside the gitignored test-data dir) while the terminal shows ONLY what terminalLine()
// promotes — one PASS/FAIL verdict per case, one per self-check block, and the final
// E2E summary line. console.error stays on the terminal (hard-crash reports must be seen).
// Opt out of the whole policy with KDT_E2E_VERBOSE=1 (legacy full-live terminal).
/* global process */

import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';

let realLog = console.log.bind(console);
let sink = null;

const format = (args) => args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ');

/**
 * Install the quiet-terminal policy for one suite run. Call in the entry script's main()
 * right AFTER acquireSpawnMutex() and BEFORE any framework/suite logging.
 * Returns { quiet, detailPath } — quiet=false (no filter installed) under KDT_E2E_VERBOSE=1.
 */
export function installQuietConsole({ testDataPath, name }) {
  if (process.env.KDT_E2E_VERBOSE) return { quiet: false, detailPath: null };

  const detailPath = path.join(testDataPath, 'e2e-logs', `${name}.log`);
  mkdirSync(path.dirname(detailPath), { recursive: true });
  sink = createWriteStream(detailPath);

  const announce = realLog; // the ORIGINAL console.log, bound before the swap
  const originalError = console.error.bind(console);
  console.log = (...args) => sink.write(`${format(args)}\n`);
  console.error = (...args) => {
    sink.write(`${format(args)}\n`);
    originalError(...args);
  };
  announce(`[e2e] terminal quiet: only case verdicts + summary here; full log -> ${detailPath}`);
  announce('[e2e] set KDT_E2E_VERBOSE=1 to restore the full live terminal.');
  return { quiet: true, detailPath };
}

/**
 * Write a line to the TERMINAL (and, when quiet is installed, also into the detail file
 * so it stays chronological with the suppressed context). Under KDT_E2E_VERBOSE this is
 * just console.log — case verdicts then appear alongside the full stream.
 */
export function terminalLine(text) {
  realLog(text);
  if (sink) sink.write(`${text}\n`);
}
