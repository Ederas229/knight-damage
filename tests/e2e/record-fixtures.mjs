// E2E fixture recorder (Phase 2 of docs/testing-plan.md).
//
// Starts the framework ONCE in the test world, creates the standard weapon on atk-pnj, performs a
// real attack from token atk-pnj targeting token vic-knight THROUGH THE KNIGHT SYSTEM'S OWN FLOW
// (RollKnight.doRoll → attack message → real click on the system's `Dégâts` chat button →
// rollDamage → damage message), then saves the damage message as a JSON fixture under
// tests/e2e/fixtures/. The filename pins the knight system version.
//
// Run with `npm run record:e2e` AFTER `npm run prepare:e2e && npm run setup:e2e`.
// Pass KDT_E2E_RAW_DUMP=1 to also dump the unstripped message object under test-data/recordings/
// (gitignored) for debugging.

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import config from './config.mjs';
import { acquireSpawnMutex } from './support/spawn-lock.mjs';
import { loadFramework, respawnPreservingSymlinks } from './support/framework.mjs';
import { listFixtureNames, loadRecordedFixture } from './support/fixture-store.mjs';
import {
  ATTACKER_ACTOR_ID,
  ATTACKER_TOKEN_NAME,
  ATTACK_DICE,
  DAMAGE_DICE,
  EXPECTED_TARGET_VALUE,
  FIXTURES_DIR,
  STANDARD_WEAPON,
  VICTIM_TOKEN_ID,
  VICTIM_TOKEN_NAME,
  buildFixtureMeta,
  createWeaponInPage,
  diceQueueStateInPage,
  dumpLastDamageMessageInPage,
  fixtureFileName,
  moduleButtonsInPage,
  normalizeForWrite,
  runAttackInPage,
  stripVolatileKeys,
  targetVictimInPage,
} from './support/attack-run.mjs';

/* global process */

if (respawnPreservingSymlinks()) {
  // Parent: the symlink-preserving child inherited stdio and carries the run.
} else {
  const Framework = await loadFramework();
  main(Framework).catch((err) => {
    console.error(`\nE2E RECORD FAIL: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });
}

async function main(Framework) {
  acquireSpawnMutex(); // ownership before ANYTHING (see support/spawn-lock.mjs)
  const fw = new Framework(config);

  try {
    await fw.start();

    // Page console passthrough: knight-system errors during the scripted flow surface here
    // instead of vanishing (waitFor predicates swallow exceptions — see the stringify rule).
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

    // 1. The standard weapon, live-created on the attacker (the world seeds no items).
    const weaponInfo = await fw.executeInFoundry(
      createWeaponInPage,
      ATTACKER_ACTOR_ID,
      structuredClone(STANDARD_WEAPON),
    );
    console.log(
      `[record] weapon item id=${weaponInfo.itemId} pinnedId=${weaponInfo.keptRequestedId} effets.raw=${JSON.stringify(weaponInfo.raw)}`,
    );
    // HARD guard (belt after the braces): v14 REJECTS a keepId create whose _id already exists
    // (test-data persists between records — running record:e2e twice without setup:e2e in
    // between hits this), and createWeaponInPage now lets that rejection throw. This guard
    // additionally catches any future path where a non-pinned id sneaks through: a drifted weapon
    // id would corrupt the byte-stable fixture contract (meta.weaponItemId +
    // flags.knight.weapon.id + the actor item snapshot would all differ).
    if (!weaponInfo.keptRequestedId)
      throw new Error(
        `weapon _id "${STANDARD_WEAPON._id}" could not be pinned (got "${weaponInfo.itemId}") — the test world likely already holds a weapon from an earlier record:e2e run; re-run \`npm run setup:e2e\` first (fixture byte-stability requires a fresh world copy)`,
      );
    if (weaponInfo.itemId !== STANDARD_WEAPON._id)
      throw new Error(`unexpected weapon id ${weaponInfo.itemId} (expected ${STANDARD_WEAPON._id})`);

    // 2. Deterministic dice: two pools total (attack + damage), both plain d6 via Foundry's Roll.
    await fw.queueDiceOverride(ATTACK_DICE.faces, ATTACK_DICE.count, ATTACK_DICE.total);
    await fw.queueDiceOverride(DAMAGE_DICE.faces, DAMAGE_DICE.count, DAMAGE_DICE.total);

    // 3. Target the victim token — the only targeting the system flow reads (roll.mjs:1210).
    const targeted = await fw.executeInFoundry(targetVictimInPage, VICTIM_TOKEN_ID);
    if (targeted !== 1) throw new Error(`expected exactly 1 targeted token, got ${targeted}`);

    // 4. Real attack roll (system's own RollKnight.doRoll weapon branch), rolled from the
    //    attacker TOKEN's actor like a live GM would (see runAttackInPage docs).
    const attackInfo = await fw.executeInFoundry(runAttackInPage, sceneOk.atk, weaponInfo.itemId, ATTACK_DICE.formula);
    console.log(
      `[record] attack message ${attackInfo.attackMessageId}, targets=${JSON.stringify(attackInfo.attackTargets)}`,
    );

    // 5. Real DOM click on the system's own damage button inside that attack message
    //    (hooks.mjs:205 wires .knight-roll button.degats -> rollDamage).
    await fw.waitFor(() => {
      const cards = document.querySelectorAll('.chat-scroll li.chat-message');
      const last = cards[cards.length - 1];
      return last?.querySelector('.knight-roll button.degats') ? true : null;
    }, 15000);
    await fw.clickInLastChatMessage('button.degats');

    // 6. Wait for the damage message with per-target value pinned, then dump it.
    const dumped = await fw.waitFor(dumpLastDamageMessageInPage, 15000, VICTIM_TOKEN_ID);
    const target = dumped.object.flags.knight.targets.find((t) => t.id === VICTIM_TOKEN_ID);
    const diceOverrideApplied = target.value === EXPECTED_TARGET_VALUE;
    console.log(
      `[record] damage message ${dumped.damageMessageId}: targets[0].value=${target.value} (expected ${EXPECTED_TARGET_VALUE}, diceOverrideApplied=${diceOverrideApplied})`,
    );

    // 7. Live proof that the module acts on this exact message (its buttons got injected).
    //    waitFor-style: moduleButtonsInPage returns null until the renderChatMessageHTML hook has
    //    added .damageButton buttons to the last card (sampling the DOM without a wait would be a
    //    false "buttons missing" failure under timing skew).
    const liveButtons = await fw.waitFor(moduleButtonsInPage, 15000);
    console.log(`[record] module buttons on the live damage message: ${JSON.stringify(liveButtons)}`);

    // 7b. Proof the dice-override extension was installed and consumed BOTH planned pools.
    const queueState = await fw.executeInFoundry(diceQueueStateInPage);
    console.log(`[record] dice-override queue: ${JSON.stringify(queueState)}`);

    // 8. Strip volatiles, attach metadata, gate, THEN write. The integrity gate runs BEFORE the
    //    write on purpose: the fixture file is the shared source of truth for BOTH suites (the
    //    unit suite imports it) — a failed/drifted recording must never overwrite the known-good
    //    baseline; exit code alone would leave a polluted file that the unit contract test then
    //    adapts to (its value pin softens when diceOverrideApplied is false).
    // Normalize ONCE before every gate and the drift comparison (review 3: comparing a
    // pre-normalize object against a post-normalize baseline only works while no Date/Set/
    // undefined-valued key appears inside the compared subtrees — normalize-first removes
    // that class of false positive entirely; normalizeForWrite is an idempotent JSON round-trip).
    const clean = normalizeForWrite(stripVolatileKeys(dumped.object));
    const fixture = normalizeForWrite({
      ...buildFixtureMeta({
        knightVersion: versions.knight,
        coreVersion: versions.core,
        worldId: config.world,
        weaponItemId: weaponInfo.itemId,
        diceOverrideApplied,
      }),
      ...clean,
    });

    const fileName = fixtureFileName(versions.knight);
    const outPath = path.join(FIXTURES_DIR, fileName);

    const failures = [];
    if (!diceOverrideApplied) failures.push(`target value ${target.value} != expected ${EXPECTED_TARGET_VALUE}`);
    if (!/Dégâts<\/div>/.test(clean.content)) failures.push('content lacks the French Dégâts</div> fragment');
    if (JSON.stringify(clean.flags.knight.weapon.effets.raw) !== JSON.stringify(STANDARD_WEAPON.system.effets.raw))
      failures.push(`weapon.effets.raw drifted: ${JSON.stringify(clean.flags.knight.weapon.effets.raw)}`);
    if (!liveButtons || liveButtons.length < 5)
      failures.push(`module buttons missing on the live message: ${liveButtons}`);

    // Queue-consumption gate: every planned pool must have been CONSUMED by a roll (proves the
    // extension patch was installed and no pool went random).
    const plannedQueue = [
      { faces: ATTACK_DICE.faces, number: ATTACK_DICE.count, value: ATTACK_DICE.total },
      { faces: DAMAGE_DICE.faces, number: DAMAGE_DICE.count, value: DAMAGE_DICE.total },
    ];
    if (
      queueState.length !== plannedQueue.length ||
      queueState.some(
        (e, i) =>
          !e.consumed ||
          e.faces !== plannedQueue[i].faces ||
          e.number !== plannedQueue[i].number ||
          e.value !== plannedQueue[i].value,
      )
    )
      failures.push(`dice-override queue not fully consumed as planned: ${JSON.stringify(queueState)}`);

    // PIP-level determinism gate (review 3): target value 14 alone is NOT determinism. The knight
    // system can roll an EXTRA exploit pool with the SAME 3D6 formula (roll.mjs:1008-1019, gated
    // by ~12.5% all-even attack), and the extension matches pools by faces+number first-unconsumed
    // (content.js:22-27) — so the extra pool would steal the damage queue entry and the real
    // damage pool would roll genuinely random dice. ~4.6% of random 3d6 sums equal 12, silently
    // baking random pips into the baseline the 155-test unit suite consumes. Pin the POOL COUNT
    // (an exploit pool => 2 entries in rolls[]/attaque[]), the die shape, and the extension's exact
    // base/remainder pips (content.js:45-51: last active die carries the remainder).
    const planPips = (plan) => {
      const base = Math.floor(plan.total / plan.count);
      return Array.from(
        { length: plan.count },
        (_, i) => base + (i === plan.count - 1 ? plan.total - base * plan.count : 0),
      );
    };
    // v14 stores ChatMessage.rolls as serialized JSON STRINGS but flags.knight.attaque as live
    // Roll OBJECTS inside the flag — accept both shapes (JSON.parse only on strings).
    const asRoll = (e) => (typeof e === 'string' ? JSON.parse(e) : e);
    const checkPool = (label, entries, plan) => {
      let pools;
      try {
        pools = entries.map(asRoll);
      } catch (err) {
        failures.push(`${label}: roll entries unparseable: ${err.message}`);
        return;
      }
      if (pools.length !== 1) {
        failures.push(
          `${label}: expected exactly 1 serialized roll pool, got ${pools.length} (an extra pool means an exploit re-roll hijacked the dice queue)`,
        );
        return;
      }
      const roll = pools[0];
      const dice = (roll.terms ?? []).filter((t) => t.class === 'Die');
      if (dice.length !== 1 || dice[0].faces !== plan.faces || dice[0].number !== plan.count) {
        failures.push(
          `${label}: die shape ${JSON.stringify(dice.map((d) => [d.faces, d.number]))} != plan ${plan.faces}d${plan.count}`,
        );
      } else {
        const pips = (dice[0].results ?? []).filter((r) => r.active === true).map((r) => r.result);
        if (JSON.stringify(pips) !== JSON.stringify(planPips(plan)))
          failures.push(`${label}: pips ${JSON.stringify(pips)} != pinned plan pips ${JSON.stringify(planPips(plan))}`);
      }
      if (roll.total !== plan.total) failures.push(`${label}: roll total ${roll.total} != plan total ${plan.total}`);
    };
    checkPool('damage rolls', clean.rolls ?? [], DAMAGE_DICE);
    checkPool('flags.knight.attaque', clean.flags?.knight?.attaque ?? [], ATTACK_DICE);

    // Drift guard (review 2): the fresh-world assumption only protects against WEAPON residue —
    // a Phase-3 damage case that does not revert mutates the victim actor (embedded snapshot
    // flags.knight.actor + targets[].aspects), and the weapon-pin guard cannot see that. If a
    // baseline fixture already exists, its victim/attacker subtrees must match or nothing writes.
    if (existsSync(outPath)) {
      const { message: baseline } = loadRecordedFixture(fileName);
      const driftKey = (msg) =>
        JSON.stringify({
          victimAspects: msg.flags.knight.targets.find((t) => t.id === VICTIM_TOKEN_ID)?.aspects ?? null,
          attackerSnapshot: msg.flags.knight.actor,
        });
      if (driftKey(clean) !== driftKey(baseline))
        failures.push(
          'world state drifted from the committed baseline (victim aspects / attacker snapshot changed — ' +
            'a previous run mutated the actors); run `npm run setup:e2e` first',
        );
    }

    if (process.env.KDT_E2E_RAW_DUMP) {
      // Raw dumps are gitignored test-data artifacts: useful even for a FAILED recording.
      const rawDir = path.join(config.testDataPath, 'recordings');
      mkdirSync(rawDir, { recursive: true });
      writeFileSync(path.join(rawDir, `raw-${fileName}`), `${JSON.stringify(dumped.object, null, 2)}\n`, 'utf8');
      console.log(`[record] raw (unstripped) dump in ${rawDir}`);
    }

    if (failures.length) {
      await fw.screenshot('record-failure.png').catch(() => {});
      console.log(`\nE2E RECORD: FAIL — baseline fixture NOT touched (${failures.join('; ')})`);
      process.exitCode = 1;
    } else {
      // ATOMIC publish: write beside + rename over. The unit suite reads this file at import
      // time (fixture-store), and the mutex only guards e2e scripts — a concurrent `npm test` /
      // pre-commit vitest must never observe a half-written JSON.
      mkdirSync(FIXTURES_DIR, { recursive: true });
      const tmpPath = `${outPath}.tmp`;
      rmSync(tmpPath, { force: true }); // clear a leftover from a crashed earlier write
      writeFileSync(tmpPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
      renameSync(tmpPath, outPath);
      console.log(`[record] wrote ${path.relative(process.cwd(), outPath)}`);

      // Version-bump hygiene (review 3): bumping PINNED_KNIGHT_VERSION renames the standard
      // fixture; prune the old-version ones so the shared baseline is always exactly one file.
      for (const stale of listFixtureNames().filter(
        (n) => n !== fileName && n.startsWith('attack-pnj-on-knight-standard-knight-'),
      )) {
        rmSync(path.join(FIXTURES_DIR, stale));
        console.log(`[record] removed stale fixture ${stale} (older knight version)`);
      }

      console.log(`\nE2E RECORD: PASS (${fileName})`);
      process.exitCode = 0;
    }
  } catch (err) {
    await fw.screenshot('record-failure.png').catch(() => {});
    throw err;
  } finally {
    await fw.stop();
    console.log('Foundry server + browser stopped.');
  }
}
