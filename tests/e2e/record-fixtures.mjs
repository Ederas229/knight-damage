// E2E fixture recorder (Phase 2 flow, extended for Phase 3's trait fixture).
//
// Boots the real Foundry v14 test world (docs/testing-plan.md Phase-0 seed) and runs TWO scripted
// real attacks through the knight system's own roll pipeline (RollKnight.doRoll, the same weapon
// branch the chat cards use), each followed by the system's OWN chat handler for the attack card's
// `Dégâts` button (hooks.mjs:205 — triggered through a real DOM click, per the plan). The dumped
// damage message becomes the shared fixture (source of truth for the e2e AND unit suites):
//   pass 1: standard weapon (label-only traits)      -> attack-pnj-on-knight-standard-knight-X.json
//   pass 2: trait weapon (percearmure/penetrant + VALUE-BEARING destructeur sub-roll)
//                                                    -> attack-pnj-on-knight-trait-knight-X.json
//
// PASS ORDER IS A HARD CONSTRAINT (third review (b)): pass 1 first, so the standard fixture's
// embedded attacker snapshot (flags.knight.actor carries the attacker's weapon list) never sees the
// trait weapon. Pass 2 only ADDS a weapon. Both weapons are created up-front with PINNED _ids so
// every re-record reproduces the same bytes.
//
// Determinism: the dice-override extension queue is pre-seeded with the plan and the run is GATED
// on every entry being consumed with the planned faces/number/value, plus pip-level pool gates via
// checkPools (plan-driven: the standard plan has exactly one damage pool; the trait plan adds the
// 2D6 destructeur sub-roll). A failed gate NEVER touches the committed files.
//
// ANTI-DRIFT (before any write): the candidate fixture JSON is byte-compared to the committed file
// (if present) — a drift is a hard failure; the baseline is never silently rebased.

import config from './config.mjs';
import { loadFramework } from './support/framework.mjs';
import { acquireSpawnMutex } from './support/spawn-lock.mjs';
import {
  PINNED_KNIGHT_VERSION,
  STANDARD_FIXTURE_NAME,
  TRAIT_FIXTURE_NAME,
  loadRecordedFixture,
  listFixtureNames,
} from './support/fixture-store.mjs';
import {
  ATTACKER_ACTOR_ID,
  ATTACKER_TOKEN_NAME,
  ATTACK_DICE,
  DAMAGE_DICE,
  EXPECTED_TARGET_VALUE,
  EXPECTED_TRAIT_VALUE,
  STANDARD_DAMAGE_PLANS,
  STANDARD_WEAPON,
  TRAIT_DAMAGE_PLANS,
  TRAIT_SUBDICE,
  TRAIT_WEAPON,
  VICTIM_TOKEN_ID,
  VICTIM_TOKEN_NAME,
  buildFixtureMeta,
  checkPools,
  checkTraitSpan,
  clearDiceQueueInPage,
  createWeaponInPage,
  diceQueueStateInPage,
  dumpNewDamageMessageInPage,
  moduleButtonsOnCardInPage,
  normalizeForWrite,
  retargetVictimInPage,
  runAttackInPage,
  stripVolatileKeys,
} from './support/attack-run.mjs';
import { clickOnMessageCard, listMessageIdsInPage } from './support/chat.mjs';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* global process */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, 'fixtures');
const QUEUE_FILE = path.join(HERE, 'last-dice-queue.json');
const TRAIT_QUEUE_FILE = path.join(HERE, 'last-dice-queue-trait.json');

// Damage-phase dice plans: imported from support/attack-run.mjs (STANDARD_DAMAGE_PLANS /
// TRAIT_DAMAGE_PLANS) — queue seeding AND the pool gates share that one source (the attack pool is
// always ATTACK 3D6 total 7: two successes, one failure -> no exploit re-roll hijacking the queue,
// roll.mjs:1008).

const Framework = await loadFramework();
main(Framework).catch((err) => {
  console.error(`\nE2E RECORD FAIL: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});

async function main(Framework) {
  acquireSpawnMutex(); // ownership before ANYTHING (see support/spawn-lock.mjs)
  const fw = new Framework(config);

  try {
    await fw.start();

    fw.page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[page:${msg.type()}] ${msg.text()}`);
    });
    fw.page.on('pageerror', (err) => console.log(`[page:uncaught] ${err.stack ?? err.message}`));

    const versions = await fw.executeInFoundry(() => ({
      knight: game.system.version,
      core: game.version,
      lang: game.i18n.lang,
      moduleActive: game.modules.get('knight-damage')?.active === true,
    }));
    console.log(
      `[record] knight ${versions.knight} / core ${versions.core} / lang ${versions.lang} / knight-damage active=${versions.moduleActive}`,
    );
    if (versions.lang !== 'fr')
      throw new Error(`chat HTML contract is French but game.i18n.lang=${versions.lang} — check browser locale`);
    if (versions.knight !== PINNED_KNIGHT_VERSION)
      throw new Error(`knight system ${versions.knight} != pinned fixture version ${PINNED_KNIGHT_VERSION}`);

    // World-fixture precondition check (tokens must be on the ACTIVE scene for the flow).
    const sceneOk = await fw.executeInFoundry(
      (attackerTokenName, victimTokenName) => {
        const scene = canvas.scene;
        const atk = scene.tokens.getName(attackerTokenName);
        const vic = scene.tokens.getName(victimTokenName);
        return {
          scene: scene?.id ?? null,
          atk: atk?.id ?? null,
          atkActor: atk?.actor?.id ?? null,
          vic: vic?.id ?? null,
        };
      },
      ATTACKER_TOKEN_NAME,
      VICTIM_TOKEN_NAME,
    );
    console.log(
      `[record] scene=${sceneOk.scene} atkToken=${sceneOk.atk} (actor ${sceneOk.atkActor}) vicToken=${sceneOk.vic}`,
    );
    if (!sceneOk.atk || !sceneOk.vic) throw new Error('fixture tokens missing on the active scene');
    if (sceneOk.atkActor !== ATTACKER_ACTOR_ID) throw new Error(`attacker token not linked to ${ATTACKER_ACTOR_ID}`);

    // 1. BOTH weapons, live-created up-front with pinned _ids (the world seeds no items). Creating
    //    the trait weapon before pass 1 is safe: the system puts only the ATTACKED-WITH weapon in
    //    flags.knight.weapon, and flags.knight.actor embeds the attacker snapshot the standard
    //    baseline already recorded with this exact weapon pair present? NO — the baseline was
    //    recorded with only the standard weapon present, so pass 1 must run with ONLY that weapon
    //    on the attacker. The trait weapon is created AFTER pass 1 (below).
    const weaponInfo = await fw.executeInFoundry(
      createWeaponInPage,
      ATTACKER_ACTOR_ID,
      structuredClone(STANDARD_WEAPON),
    );
    guardPinnedId(weaponInfo, STANDARD_WEAPON);
    console.log(
      `[record] weapon id=${weaponInfo.itemId} pinned=${weaponInfo.keptRequestedId} raw=${JSON.stringify(weaponInfo.raw)}`,
    );

    // 2. Pass 1 (standard): attack dice queue + target + real roll + pinned real Dégâts click + dump.
    const pass1 = await runAttackPass(fw, {
      label: 'standard',
      atkTokenId: sceneOk.atk,
      weaponItemId: weaponInfo.itemId,
      attackDice: { faces: 6, count: 3, total: 7 },
      damagePlan: STANDARD_DAMAGE_PLANS,
      formula: '3D6',
    });

    // 3. Build + gate the standard fixture, compare to the committed baseline BEFORE writing.
    const standardFixture = buildFixture(pass1, {
      family: 'standard',
      versions,
      weaponItemSeed: STANDARD_WEAPON,
      weaponItemId: weaponInfo.itemId,
      dicePlan: {
        attack: { faces: 6, count: 3, total: 7, formula: '3D6' },
        damage: { faces: DAMAGE_DICE.faces, count: DAMAGE_DICE.count, total: DAMAGE_DICE.total },
        expectedTargetValue: EXPECTED_TARGET_VALUE,
      },
      extraMeta: {},
    });
    const standardJson = `${JSON.stringify(standardFixture, null, 2)}\n`;
    compareAgainstBaseline(STANDARD_FIXTURE_NAME, standardJson); // hard fail on drift, never writes
    publishFixture(STANDARD_FIXTURE_NAME, standardJson);
    writeFileSync(QUEUE_FILE, JSON.stringify(pass1.queueState, null, 2), 'utf8');
    console.log(`[record] pass 1 OK: ${STANDARD_FIXTURE_NAME}`);

    // 4. Pass 2 (trait weapon): created only NOW, so the standard fixture's embedded attacker
    //    snapshot (flags.knight.actor weapon list) stays byte-identical across re-records.
    const traitInfo = await fw.executeInFoundry(createWeaponInPage, ATTACKER_ACTOR_ID, structuredClone(TRAIT_WEAPON));
    guardPinnedId(traitInfo, TRAIT_WEAPON);
    console.log(
      `[record] trait weapon id=${traitInfo.itemId} pinned=${traitInfo.keptRequestedId} raw=${JSON.stringify(traitInfo.raw)}`,
    );

    const pass2 = await runAttackPass(fw, {
      label: 'trait',
      atkTokenId: sceneOk.atk,
      weaponItemId: traitInfo.itemId,
      attackDice: { faces: 6, count: 3, total: 7 },
      damagePlan: TRAIT_DAMAGE_PLANS,
      formula: '3D6',
    });

    const traitFixture = buildFixture(pass2, {
      family: 'trait',
      versions,
      weaponItemSeed: TRAIT_WEAPON,
      weaponItemId: traitInfo.itemId,
      dicePlan: {
        attack: { faces: 6, count: 3, total: 7, formula: '3D6' },
        damage: { faces: DAMAGE_DICE.faces, count: DAMAGE_DICE.count, total: DAMAGE_DICE.total },
        traitSubRoll: { faces: TRAIT_SUBDICE.faces, count: TRAIT_SUBDICE.count, total: TRAIT_SUBDICE.total },
        expectedTargetValue: EXPECTED_TARGET_VALUE,
        expectedTraitValue: EXPECTED_TRAIT_VALUE,
      },
      extraMeta: {
        weaponTraits: TRAIT_WEAPON.system.effets.raw,
        expectedTraitValue: EXPECTED_TRAIT_VALUE,
      },
    });
    const traitJson = `${JSON.stringify(traitFixture, null, 2)}\n`;
    compareAgainstBaseline(TRAIT_FIXTURE_NAME, traitJson);
    publishFixture(TRAIT_FIXTURE_NAME, traitJson);
    writeFileSync(TRAIT_QUEUE_FILE, JSON.stringify(pass2.queueState, null, 2), 'utf8');
    console.log(`[record] pass 2 OK: ${TRAIT_FIXTURE_NAME}`);

    // Version-bump hygiene: prune stale fixtures of OTHER versions (never touched fixtures of THIS
    // version that are not one of our two families).
    const current = new Set([STANDARD_FIXTURE_NAME, TRAIT_FIXTURE_NAME]);
    for (const stale of listFixtureNames().filter(
      (n) => !current.has(n) && /^attack-pnj-on-knight-(standard|trait)-knight-/.test(n),
    )) {
      rmSync(path.join(FIXTURES_DIR, stale));
      console.log(`[record] removed stale fixture ${stale} (older knight version)`);
    }

    // (Self-cleanup lives in the finally-block sweepPinnedWeapons call: it runs on EVERY exit, so
    // pinned-weapon creations never survive a mid-run throw into the next consumer.)

    console.log('\nE2E RECORD: PASS (both fixtures gated + published)');
    process.exitCode = 0;
  } catch (err) {
    await fw.screenshot('record-failure.png').catch(() => {});
    throw err;
  } finally {
    // Runs on EVERY exit (success, gate throw, guardPinnedId stale-world hard-fail): the attacker
    // never keeps the pinned weapons after this process stops, so the next consumer starts clean
    // and the failure log proves the sweep happened.
    await sweepPinnedWeapons(fw);
    await fw.stop();
    console.log('Foundry server + browser stopped.');
  }
}

/**
 * Remove this recorder's PINNED weapons from the attacker (best-effort: a page that never booted,
 * or a delete that fails at teardown, must not mask the run's real error). Logged with the count
 * either way so success and failure paths are both auditable in the run log.
 */
async function sweepPinnedWeapons(fw) {
  if (!fw.page) return;
  try {
    const leftover = await fw.executeInFoundry(
      (actorId, pinnedIds) => {
        const actor = game.actors.get(actorId);
        const present = actor.items.filter((i) => pinnedIds.includes(i.id)).map((i) => i.id);
        if (present.length === 0) return 0;
        return actor.deleteEmbeddedDocuments('Item', present).then(() => present.length);
      },
      ATTACKER_ACTOR_ID,
      [STANDARD_WEAPON._id, TRAIT_WEAPON._id],
    );
    console.log(
      `[record] finally-sweep removed ${leftover} pinned weapon(s) from the attacker (published world stays clean)`,
    );
  } catch (err) {
    console.log(`[record] finally-sweep FAILED (pinned weapons may linger on the attacker): ${err.message ?? err}`);
  }
}

function guardPinnedId(info, seed) {
  if (!info.keptRequestedId || info.itemId !== seed._id)
    throw new Error(
      `weapon _id "${seed._id}" could not be pinned (got "${info.itemId}") — the test world likely already ` +
        'holds a weapon from an earlier record:e2e run; re-run `npm run setup:e2e` first (fixture byte-stability ' +
        'requires a fresh world copy)',
    );
}

/**
 * One attack pass: seed the dice queue, target the victim (re-pinned every pass), run the system's
 * own doRoll weapon branch, click the PINNED attack card's Dégâts button (ids snapshotted BEFORE the
 * click — the damage message is born from the click and must be the only new one), dump THE damage
 * message by message-id pinning, and gate the consumed dice queue.
 */
async function runAttackPass(fw, { label, atkTokenId, weaponItemId, attackDice, damagePlan, formula }) {
  await fw.executeInFoundry(clearDiceQueueInPage); // the extension queue is a page GLOBAL: isolate passes
  await fw.queueDiceOverride(attackDice.faces, attackDice.count, attackDice.total);
  for (const plan of damagePlan) await fw.queueDiceOverride(plan.faces, plan.count, plan.total);

  const targeted = await fw.executeInFoundry(retargetVictimInPage, VICTIM_TOKEN_ID);
  if (targeted !== 1) throw new Error(`[${label}] expected exactly 1 targeted token, got ${targeted}`);

  const attackInfo = await fw.executeInFoundry(runAttackInPage, atkTokenId, weaponItemId, formula);
  console.log(
    `[${label}] attack message ${attackInfo.attackMessageId}, targets=${JSON.stringify(attackInfo.attackTargets)}`,
  );
  const hit = attackInfo.attackTargets.find((t) => String(t.id) === String(VICTIM_TOKEN_ID));
  if (!hit || hit.hit !== true)
    throw new Error(`[${label}] victim token was not hit: ${JSON.stringify(attackInfo.attackTargets)}`);

  // Real DOM click, PINNED to the attack card (the framework clickInLastChatMessage pattern, but
  // pinned: with two passes the "last card" is only correct as long as nothing else posted — the
  // pinned variant removes that assumption entirely).
  await fw.waitFor(
    (msgId) => {
      const card = document.querySelector(`li.chat-message[data-message-id="${msgId}"]`);
      return card?.querySelector('.knight-roll button.degats') ? true : null;
    },
    15000,
    attackInfo.attackMessageId,
  );
  const preIds = await fw.executeInFoundry(listMessageIdsInPage);
  await fw.executeInFoundry(clickOnMessageCard, attackInfo.attackMessageId, 'button.degats');

  const dumped = await fw.waitFor(dumpNewDamageMessageInPage, 15000, preIds, VICTIM_TOKEN_ID);
  if (dumped.error) throw new Error(`[${label}] ${dumped.error}`);
  const target = dumped.object.flags.knight.targets.find((t) => t.id === VICTIM_TOKEN_ID);
  console.log(
    `[${label}] damage message ${dumped.damageMessageId}: value=${target.value} (expected ${EXPECTED_TARGET_VALUE})`,
  );

  const liveButtons = await fw.waitFor(moduleButtonsOnCardInPage, 15000, dumped.damageMessageId);
  console.log(`[${label}] module buttons on the pinned damage card: ${JSON.stringify(liveButtons)}`);

  const queueState = await fw.executeInFoundry(diceQueueStateInPage);
  const plannedQueue = [attackDice, ...damagePlan].map((p) => ({ faces: p.faces, number: p.count, value: p.total }));
  if (
    queueState.length !== plannedQueue.length ||
    queueState.some(
      (e, i) =>
        !e.consumed ||
        e.faces !== plannedQueue[i].faces ||
        e.number !== plannedQueue[i].number ||
        e.value !== plannedQueue[i].value,
    )
  ) {
    throw new Error(
      `[${label}] dice-override queue not fully consumed as planned: got ${JSON.stringify(queueState)}, planned ${JSON.stringify(plannedQueue)}`,
    );
  }
  return { ...dumped, target, liveButtons, queueState };
}

/**
 * Assemble one fixture object (same shape as the committed baseline: fixtureMeta header + stripped
 * message). `family` ('standard' | 'trait') is the EXPLICIT discriminator for the trait-branch
 * gates (pool plan set, trait-span witness, baseline filename) — no reliance on weaponItemSeed
 * object identity; weaponItemSeed stays as the data source (raw round-trip compare + fixtureMeta).
 */
function buildFixture(pass, { family, versions, weaponItemSeed, weaponItemId, dicePlan, extraMeta }) {
  if (family !== 'standard' && family !== 'trait') throw new Error(`unknown fixture family: ${family}`);
  const isTrait = family === 'trait';
  const clean = normalizeForWrite(stripVolatileKeys(pass.object));
  const failures = [];

  if (pass.target.value !== EXPECTED_TARGET_VALUE)
    failures.push(`target value ${pass.target.value} != expected ${EXPECTED_TARGET_VALUE}`);
  if (!/Dégâts<\/div>/.test(clean.content)) failures.push('content lacks the French Dégâts</div> fragment');
  if (JSON.stringify(clean.flags.knight.weapon.effets.raw) !== JSON.stringify(weaponItemSeed.system.effets.raw))
    failures.push(`weapon.effets.raw drifted: ${JSON.stringify(clean.flags.knight.weapon.effets.raw)}`);
  if (!pass.liveButtons || pass.liveButtons.length < 5)
    failures.push(`module buttons missing on the pinned damage card: ${pass.liveButtons}`);

  // Plan-driven pool gates (third review (b)): the damage message serializes the damage-phase pools
  // (standard: exactly 1; trait: 2 including the destructeur 2D6 sub-roll), and the attack pool in
  // flags.knight.attaque. Order-independent set matching (the sub-roll precedes the main roll).
  failures.push(...checkPools('damage rolls', clean.rolls ?? [], isTrait ? TRAIT_DAMAGE_PLANS : STANDARD_DAMAGE_PLANS));
  failures.push(...checkPools('flags.knight.attaque', clean.flags?.knight?.attaque ?? [], [ATTACK_DICE]));

  // Raw round-trip of the weapon's traits, and for the trait family the VALUE-BEARING span witness:
  // the module's extractTraitValue regex shape seen live on the SYSTEM's own rendered HTML.
  if (isTrait) {
    failures.push(...checkTraitSpan(clean.content, 'Destructeur', EXPECTED_TRAIT_VALUE));
    if (clean.flags.knight.weapon.effets.raw.includes('destructeur') === false)
      failures.push('trait fixture: destructeur keyword missing from the raw round-trip (bool source for the module)');
  }

  // Drift guard: if the committed fixture exists, victim aspects + attacker snapshot subtrees must
  // match (a previous damage case that did not revert would show up HERE, before anything writes).
  const fixtureName = isTrait ? TRAIT_FIXTURE_NAME : STANDARD_FIXTURE_NAME;
  const baselinePath = path.join(FIXTURES_DIR, fixtureName);
  if (existsSync(baselinePath)) {
    const { message: baseline } = loadRecordedFixture(fixtureName);
    const driftKey = (msg) => ({
      victimAspects: msg.flags.knight.targets.find((t) => t.id === VICTIM_TOKEN_ID)?.aspects ?? null,
      attackerSnapshot: msg.flags.knight.actor,
    });
    if (JSON.stringify(driftKey(clean)) !== JSON.stringify(driftKey(baseline)))
      failures.push(
        'world state drifted from the committed baseline (victim aspects / attacker snapshot changed — ' +
          'a previous run mutated the actors); run `npm run setup:e2e` first. Diff: ' +
          describeDrift(driftKey(baseline), driftKey(clean)),
      );
  }

  if (process.env.KDT_E2E_RAW_DUMP) {
    const rawDir = path.join(config.testDataPath, 'recordings');
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(
      path.join(rawDir, `raw-${weaponItemSeed._id}.json`),
      `${JSON.stringify(pass.object, null, 2)}\n`,
      'utf8',
    );
    console.log(`[record] raw (unstripped) dump in ${rawDir}`);
  }

  if (failures.length) throw new Error(`fixture gates failed (${weaponItemSeed._id}):\n  ${failures.join('\n  ')}`);

  const meta = buildFixtureMeta({
    knightVersion: versions.knight,
    coreVersion: versions.core,
    worldId: config.world,
    weaponItemSeed,
    weaponItemId,
    diceOverrideApplied: true,
    dicePlan,
  });
  // extraMeta (trait pass only) lives INSIDE fixtureMeta: loadRecordedFixture splits
  // {fixtureMeta, ...message} and ChatMessage.create would reject unknown top-level fields.
  meta.fixtureMeta = { ...meta.fixtureMeta, ...extraMeta };
  return normalizeForWrite({ ...meta, ...clean });
}

/**
 * Compact recursive diff of the two driftKey subtrees (baseline vs got) for the drift-gate message:
 * first few differing paths (leaf scalars + array length/item-id mismatches included).
 */
function describeDrift(baseline, got, pathStr = '', out = []) {
  if (out.length >= 8) return out.join('; ');
  if (baseline === got) return out.length ? out.join('; ') : 'no scalar diff (key order?)';
  if (Array.isArray(baseline) && Array.isArray(got)) {
    if (baseline.length !== got.length) out.push(`${pathStr}.length ${baseline.length}->${got.length}`);
    for (let i = 0; i < Math.min(baseline.length, got.length); i++)
      describeDrift(baseline[i], got[i], `${pathStr}[${i}]`, out);
    return out.length ? out.join('; ') : `${pathStr} arrays differ`;
  }
  if (baseline && got && typeof baseline === 'object' && typeof got === 'object') {
    for (const k of new Set([...Object.keys(baseline), ...Object.keys(got)]))
      describeDrift(baseline[k], got[k], pathStr ? `${pathStr}.${k}` : k, out);
    return out.length ? out.join('; ') : `${pathStr} objects differ`;
  }
  out.push(`${pathStr} ${JSON.stringify(baseline ?? null)}->${JSON.stringify(got ?? null)}`);
  return out.length ? out.join('; ') : 'values differ';
}

/** Byte-level anti-drift gate BEFORE any write: a committed baseline must be reproduced exactly. */
function compareAgainstBaseline(fileName, candidateJson) {
  const baselinePath = path.join(FIXTURES_DIR, fileName);
  if (!existsSync(baselinePath)) {
    console.log(`[record] no committed ${fileName} yet: writing a fresh fixture`);
    return;
  }
  const baseline = readFileSync(baselinePath, 'utf8');
  if (baseline === candidateJson) {
    console.log(`[record] ${fileName}: byte-identical to the committed baseline`);
    return;
  }
  let firstDiff = candidateJson.length;
  for (let i = 0; i < Math.min(baseline.length, candidateJson.length); i++) {
    if (baseline[i] !== candidateJson[i]) {
      firstDiff = i;
      break;
    }
  }
  throw new Error(
    `DÉRIVE DU FIXTURE ${fileName} (baseline ${baseline.length} octets, obtenu ${candidateJson.length}, première différence à ${firstDiff}):\n` +
      `      baseline: …${baseline.slice(Math.max(0, firstDiff - 120), firstDiff + 120)}…\n` +
      `      obtenu  : …${candidateJson.slice(Math.max(0, firstDiff - 120), firstDiff + 120)}…\n` +
      '      Ne jamais rebaseur le baseline en silence: comprendre la dérive (seed de monde, plan de dés,\n' +
      '      ordre des passes, state résiduel) AVANT toute réécriture volontaire.',
  );
}

/** ATOMIC publish: write beside + rename over (the unit suite reads fixtures at import time). */
function publishFixture(fileName, json) {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const outPath = path.join(FIXTURES_DIR, fileName);
  const tmpPath = `${outPath}.tmp`;
  rmSync(tmpPath, { force: true });
  writeFileSync(tmpPath, json, 'utf8');
  renameSync(tmpPath, outPath);
  console.log(`[record] wrote ${path.relative(process.cwd(), outPath)}`);
}
