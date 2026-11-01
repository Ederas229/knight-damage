// Copies the built `dist/` into `<dataPath>/Data/modules/knight-damage` as a REAL recursive file
// copy, so `npm run setup:e2e` can copy the module into the isolated test-data folder without ever
// traversing a `npm run link-project` symlink (which points at some checkout's dist/ and would need
// admin rights to recreate). If the destination is a symlink/junction, only the LINK itself is
// removed — never its target.
//
// The data path comes from the gitignored `foundryconfig.json` (same resolution as the gulp `link`
// task, first entry wins) — no machine-specific paths in this committed script.

import { cp, lstat, readFile, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* global process */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_ID = 'knight-damage';

async function getDataPath() {
  const configPath = path.join(repoRoot, 'foundryconfig.json');
  let config;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Could not read foundryconfig.json (${err.message}) — recreate it per-machine with a "dataPath" key`,
    );
  }
  const dataPath = Array.isArray(config?.dataPath) ? config.dataPath[0] : config?.dataPath;
  if (typeof dataPath !== 'string' || !dataPath) {
    throw new Error('Property dataPath in foundryconfig.json must be a string or an array of strings');
  }
  return path.resolve(dataPath);
}

async function main() {
  const dataPath = await getDataPath();
  const distDir = path.join(repoRoot, 'dist');

  const distStat = await stat(distDir).catch(() => null);
  if (!distStat?.isDirectory()) {
    throw new Error(`dist/ not found at ${distDir} — run \`npm run build\` first (or use \`npm run prepare:e2e\`)`);
  }

  const dest = path.join(dataPath, 'Data', 'modules', MODULE_ID);

  const destStat = await lstat(dest).catch(() => null);
  if (destStat) {
    if (destStat.isSymbolicLink()) {
      // Unlink the symlink/junction itself. Deliberately NOT a recursive rm: that would follow the
      // link and delete the checkout's dist/ (or whatever it points at).
      await unlink(dest);
      console.log(`Removed symlink ${dest} (target left untouched)`);
    } else {
      await rm(dest, { recursive: true, maxRetries: 3 });
      console.log(`Removed existing directory ${dest}`);
    }
  }

  await cp(distDir, dest, { recursive: true });
  console.log(`Copied ${distDir} -> ${dest} (real file copy)`);
}

main().catch((err) => {
  console.error(`copy-dist-to-foundry failed: ${err.message}`);
  process.exit(1);
});
