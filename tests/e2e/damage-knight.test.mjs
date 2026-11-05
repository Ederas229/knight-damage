// E2E core damage pipeline (Phase 3 of docs/testing-plan.md): `npm run test:e2e:damage` AFTER
// `npm run prepare:e2e && npm run setup:e2e` (and at least one recorded fixture pair).
//
// Coverage (the plan's nine Phase-3 cases, all against the LIVE world with the RECORDED fixtures):
//   1. button injection on the replayed standard message + NEGATIVE (actor.type knight),
//   2. Normal apply: stat math AND the recap message (flags + French lines + INTENDED double
//      actor.update pin via a live preUpdateActor counter),
//   3. Demi (mult 0.5, Math.ceil) and Double (mult 2),
//   4. CdF >= damage: the inert early-return path (recap map stays {}), boundary pair 4/5,
//   5. Egide: message variant with flags.knight.actor.system.origin='anatheme' + egide 8 victim,
//   6. perce-armure threshold straddle (full 100 vs worn 30) and raw-flag variants ignorearmure /
//      ignorechampdeforce,
//   7. damage-trait VALUE extraction against the NEW trait fixture's REAL system HTML,
//   8. Shift+click modifier dialog (DialogV2.prompt driven through the framework),
//   9. revert: recap .revert-damage restores stats (the knight twin's setTimeout(100/101) path),
//      line-through, revert button gone AND persisted,
//  10. the live anti-anatheme STATUS case the fixed preUpdateChatMessage injection needs
//      (attacker token status -> real attack -> damage-message raw gains 'antianatheme').
//
// Discipline (mandatory plan rules):
//   * EVERY chat-message query and click is message-id-pinned (support/chat.mjs); the
//     recorder-style "last message / last card" sampling is never used here.
//   * Poisoning rule: every case snapshots the victim's system.* (and the attacker's
//     effects/items when it mutates them) and restores it in its finally block; created chat
//     messages are deleted (recap ids enter the case's cleanup sink the MOMENT they are
//     discovered, never only via a return value); status effects and created items are removed.
//     A suite-end self-check proves no recap card leaks into the boot-persistent chat log. The
//     suite is order-independent and re-runnable back-to-back WITHOUT a fresh setup:e2e.
//   * Expected numbers derive from the same knight-message shape as the recorded fixture and
//     reproduce the unit suite's INTENDED (author) behaviors (double update; armor-bypass drop).

import config from './config.mjs';
import { loadFramework, respawnPreservingSymlinks } from './support/framework.mjs';
import { acquireSpawnMutex } from './support/spawn-lock.mjs';
import { loadRecordedFixture, STANDARD_FIXTURE_NAME, TRAIT_FIXTURE_NAME } from './support/fixture-store.mjs';
import {
  clickOnMessageCard,
  damageButtonCountOnCardInPage,
  damageButtonsOnCardInPage,
  deleteMessagesInPage,
  degatsButtonOnCardInPage,
  findNewRecapMessageInPage,
  listMessageIdsInPage,
  messageContentInPage,
  messageFlagsInPage,
  revertDomStateInPage,
  storedContentPersistedInPage,
} from './support/chat.mjs';
import {
  actorEmbeddedStateInPage,
  clearUserTargetsInPage,
  controlTokenInPage,
  deleteItemsInPage,
  installActorUpdateCounterInPage,
  readActorUpdatesInPage,
  releaseAllTokensInPage,
  restoreActorSystemInPage,
  snapshotActorSystemInPage,
  updateActorInPage,
} from './support/actor-pages.mjs';
import { replayFixture } from './support/replay.mjs';
import { deepEqualJson, entriesEqual, recapMapMatches } from './support/compare.mjs';
import {
  ATTACKER_ACTOR_ID,
  ATTACK_DICE,
  DAMAGE_DICE,
  EXPECTED_TRAIT_VALUE,
  STANDARD_WEAPON,
  TRAIT_WEAPON,
  VICTIM_TOKEN_ID,
  clearDiceQueueInPage,
  createWeaponInPage,
  runAttackInPage,
} from './support/attack-run.mjs';

/* global process */

if (respawnPreservingSymlinks()) {
  // Parent: the symlink-preserving child inherited stdio and carries the run.
} else {
  const Framework = await loadFramework();
  main(Framework).catch((err) => {
    console.error(`\nE2E DAMAGE FAIL: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });
}

const VICTIM_ACTOR_ID = 'kdtVicKnightAAAA';
const ANTI_ANATHEME_STATUS_ID = 'anti-anatheme';

// The seed victim (tests/e2e/world-seed/.../actors.db): the stats the module reads.
const SEED_STATS = {
  armure: 100,
  cdf: 10,
  egide: 0,
  guardianArmure: 15,
  guardianCdf: 5,
  sante: 20,
  espoir: 15,
  energie: 12,
};

// RECAP LABEL CONTRACT (damageBase.js:312-333, byte-level from the UTF-8 source): the recap stat
// lines are EXACTLY ` <div>${label} : ${value}</div>` with these labels — 'Energie' (UNACCENTED in
// damageBase.js:312), 'Armure',
// 'Blindage', 'Guardian', 'Santé', 'Cohésion', 'Espoir' — each line emitted ONLY when the repartition
// value is truthy (a 0-valued key prints NO line). The header line is
// 'Récapitulatif des dégâts' + the .revert-damage button.
const RECAP_HEADER = 'Récapitulatif des dégâts';
const recapLine = (label, value) => `<div>${label} : ${value}</div>`;

// ── Page-context helpers (stringify rule: no closures; values come in as trailing args) ──
// The GENERIC page helpers (replay create, snapshot/restore/update, control/release, update
// counter, item delete) live in support/actor-pages.mjs — one place fixes discipline for all
// damage suites. Only the knight-specific readers stay here.

const readStatsInPage = (actorId) => {
  const s = game.actors.get(actorId).system;
  return {
    armure: s.armure.value,
    cdf: s.champDeForce.value,
    egide: s.egide.value,
    guardianArmure: s.equipements.guardian.armure.value,
    guardianCdf: s.equipements.guardian.champDeForce.value,
    sante: s.sante.value,
    espoir: s.espoir.value,
    energie: s.energie.value,
  };
};

// waitFor predicate: every expected stat already matches (plain objects only). readStats is a
// STRINGIFIED page function — it cannot close over readStatsInPage, so the read is inlined here.
const statsMatchInPage = (actorId, expected) => {
  const src = game.actors.get(actorId).system;
  const s = {
    armure: src.armure.value,
    cdf: src.champDeForce.value,
    egide: src.egide.value,
    guardianArmure: src.equipements.guardian.armure.value,
    guardianCdf: src.equipements.guardian.champDeForce.value,
    sante: src.sante.value,
    espoir: src.espoir.value,
    energie: src.energie.value,
  };
  for (const [key, value] of Object.entries(expected)) if (s[key] !== value) return null;
  return s;
};

const toggleAttackerStatusInPage = async (actorId, statusId, active) => {
  const actor = game.actors.get(actorId);
  if (!actor) throw new Error(`attacker actor ${actorId} not found`);
  await actor.toggleStatusEffect(statusId, { active });
  return actor.effects.map((e) => Array.from(e.statuses));
};

// Best-effort modal sweep (case8 finally): a stuck DialogV2.prompt is modal + rejectClose, so every
// LATER case's clicks/dialog waits would degrade into 15s timeouts. v14 REGISTRY FACT: ui.windows
// holds ONLY ApplicationV1 popouts (appv1/api/application-v1.mjs:415) while DialogV2 (an
// ApplicationV2) registers in the foundry.applications.instances MAP (applications/_module.mjs:36,
// api/application.mjs:581) — so the sweep walks BOTH. Application.close() bypasses the DOM
// close-button guard that rejectClose protects.
const closeStuckDialogsInPage = () => {
  const windows = [...Object.values(ui.windows ?? {}), ...Array.from(foundry.applications?.instances?.values() ?? [])];
  const stuck = windows.filter((w) => /Dialog/i.test(w.constructor?.name ?? ''));
  for (const w of stuck) {
    try {
      w.close();
    } catch {
      /* best effort: teardown must not throw */
    }
  }
  return stuck.length;
};

// Pinned discovery of the NEW damage message of a live attack (same predicate shape the
// recorder's dump uses, but Phase-3 discipline: by exclusion + flag semantics, never "last").
const newDamageMessageIdInPage = (excludeIds, targetTokenId) => {
  const fresh = game.messages.contents.filter((m) => !excludeIds.includes(m.id));
  const ready = fresh.filter((m) =>
    m.flags?.knight?.targets?.some((t) => t.id === targetTokenId && t.isValue === true && typeof t.value === 'number'),
  );
  if (ready.length === 0) return null;
  // { ids } on the anomaly (chat.mjs findNewRecapMessageInPage shape — review-6 D1): the CALLER
  // sinks every candidate into its cleanup accumulator BEFORE throwing, so a multi-damage-message
  // anomaly leaks zero cards into the boot-persistent chat log.
  if (ready.length > 1)
    return { error: `${ready.length} new damage messages: ${ready.map((m) => m.id)}`, ids: ready.map((m) => m.id) };
  return { id: ready[0].id };
};

// WIDENED leak scan (review-6 D2): the set of message ids carrying the ARRAY flag
// flags.knight.targets — the marker distinguishing SYSTEM attack/damage cards from module
// recap/death/side cards. Byte-verified against the committed fixture: the recorded DAMAGE
// message carries flags.knight.targets[...] (system attack cards nest their targets under
// flags.knight.content[].targets instead, so this scan pins exactly the damage-card family
// this suite replays). A freshly seeded world boots with an EMPTY chat log (the seed carries
// no messages collection at all), so this baseline is empty at start; the suite-end
// self-check requires it UNCHANGED — the old isRecap-only scan could not see a leaked
// replayed damage card.
const attackCardIdsInPage = () =>
  game.messages.contents
    .filter((m) => Array.isArray(m.flags?.knight?.targets) && m.flags.knight.targets.length > 0)
    .map((m) => m.id)
    .sort()
    .join(',');

// DOM probe for the revert case: support/chat.mjs revertDomStateInPage (hoisted — review-6 C1).

// ── Node-side test plumbing ──
// The comparison helpers live in support/compare.mjs (shared by all damage suites).

async function main(Framework) {
  acquireSpawnMutex(); // ownership before ANYTHING (see support/spawn-lock.mjs)
  const fw = new Framework(config);
  const results = [];
  const push = (label, ok, detail = '') => results.push({ label, ok, detail });

  const standard = loadRecordedFixture(STANDARD_FIXTURE_NAME);
  const trait = loadRecordedFixture(TRAIT_FIXTURE_NAME);
  console.log(
    `[damage] fixtures loaded: standard + trait (knight ${standard.meta.knightSystemVersion}, core ${standard.meta.coreVersion})`,
  );

  const shot = async (name) => {
    await fw.screenshot(`${name}.png`).catch(() => {});
  };

  // Per-case runner: a hard failure kills ONLY that case (screenshot + FAIL line + detail),
  // the finally-block cleanup still runs, and the rest of the boot keeps its coverage.
  const caseFailures = [];
  async function runCase(name, fn) {
    try {
      await fn();
    } catch (err) {
      caseFailures.push(`${name}: ${err.message ?? err}`);
      await shot(`damage-${name}`);
      push(`${name} completes without infrastructure error`, false, `threw: ${err.stack ?? err}`);
    }
  }

  // Replay with an optional node-side mutation hook, then wait for the PINNED card. The VICTIM
  // TOKEN is injected as the speaker: DamageBase reads token/actor from the speaker (so recap
  // generation and the revert handler's fromUuid(speaker) resolve for real), and it is the
  // fixture's ONE faithful deviation — the recorded null speaker was a recorder artifact of an
  // unlinked prototype attacker, pinned by the unit contract (fixture-contract.test.mjs:52).
  async function replay(fixtureMessage, mutate) {
    return replayFixture(
      fw,
      fixtureMessage,
      mutate,
      { scene: 'kdtSceneMainAAAA', token: VICTIM_TOKEN_ID, actor: VICTIM_ACTOR_ID },
      'damage',
    );
  }

  // One damage-application: control victim -> pinned click -> recap discovered by flag+exclusion
  // -> stats waited. Returns { recapId, recap, stats } for assertions; caller cleans up.
  // The damage flow ALWAYS creates the recap message and ALWAYS writes the stats (the apply()
  // no-op update on empty data is the INTENDED author behavior pinned by the unit suite).
  // LEAK DISCIPLINE: the recap id goes into the case's `recapSink` accumulator the MOMENT it is
  // discovered — BEFORE the stats wait — so a stats-wait throw can never orphan the recap card in
  // the (boot-persistent) chat log; every call site passes its accumulator to cleanup().
  // Control is NOT released here: handleClickApplyDamage early-returns unless the active layer
  // still controls tokens (knight-damage.js:314), and cleanup() releases for every case.
  async function applyDamageAndAwait(msgId, action, expectedStats, recapSink) {
    await fw.executeInFoundry(controlTokenInPage, VICTIM_TOKEN_ID);
    const preIds = await fw.executeInFoundry(listMessageIdsInPage);
    await fw.waitFor(clickOnMessageCard, 15000, msgId, `button[data-action="${action}"]`);
    const recap = await fw.waitFor(findNewRecapMessageInPage, 15000, preIds);
    if (recap?.ids) recapSink.push(...recap.ids); // multi-recap anomaly: sink every candidate BEFORE throwing
    if (!recap || recap.error) throw new Error(`recap message discovery failed: ${recap?.error ?? 'timeout'}`);
    recapSink.push(recap.id);
    const stats = await fw.waitFor(statsMatchInPage, 15000, VICTIM_ACTOR_ID, expectedStats);
    return { recapId: recap.id, recap, stats };
  }

  async function cleanup(messages, victimSnapshot) {
    await fw.executeInFoundry(releaseAllTokensInPage).catch(() => {});
    if (victimSnapshot)
      await fw.executeInFoundry(restoreActorSystemInPage, VICTIM_ACTOR_ID, victimSnapshot).catch(() => {});
    if (messages?.length)
      await fw
        .executeInFoundry(deleteMessagesInPage, messages.filter(Boolean))
        .catch((err) => console.log(`[damage] cleanup message-delete FAILED: ${err.message ?? err}`));
  }

  // In-case baseline restore: multi-subapplication cases (5/6) would otherwise accumulate damage
  // between their sub-applies and time out on statsMatch. Merges the case snapshot back and WAITS
  // until the live stats are there again (the system equipements sync is fire-and-forget).
  async function restoreBaselineBetween(snap, expected = SEED_STATS) {
    await fw.executeInFoundry(restoreActorSystemInPage, VICTIM_ACTOR_ID, snap);
    await fw.waitFor(statsMatchInPage, 15000, VICTIM_ACTOR_ID, expected);
  }

  async function victimMatchesSeedBaseline() {
    // ORDER-INDEPENDENT comparison via entriesEqual from support/compare.mjs (review-6 D4 — the
    // hand-rolled entries loop was a drift-prone duplicate; a refactor reordering either side
    // must never flip this self-check, review-5 B4 rule).
    const now = await fw.executeInFoundry(readStatsInPage, VICTIM_ACTOR_ID);
    const same = entriesEqual(now, SEED_STATS);
    if (!same)
      console.log(
        `[damage] baseline expected ${JSON.stringify(SEED_STATS)}\n[damage] baseline actual   ${JSON.stringify(now)}`,
      );
    return same;
  }

  try {
    await fw.start();
    fw.page.on('pageerror', (err) => console.log(`[page:uncaught] ${err.stack ?? err.message}`));
    await fw.openChat();

    const boot = await fw.executeInFoundry(() => ({
      knight: game.system.version,
      core: game.version,
      lang: game.i18n.lang,
      scene: canvas.scene?.id ?? null,
      vicToken: canvas.tokens.get('tkVicKnightAAAAA')?.id ?? null,
      atkToken: canvas.tokens.get('tkAtkPnjAAAAAAAA')?.id ?? null,
    }));
    console.log(
      `[damage] knight ${boot.knight} / core ${boot.core} / lang ${boot.lang} / scene ${boot.scene} vic=${boot.vicToken} atk=${boot.atkToken}`,
    );
    if (!boot.vicToken || !boot.atkToken) throw new Error('fixture tokens missing on the active scene');
    if (boot.lang !== 'fr') throw new Error(`chat HTML contract is French but game.i18n.lang=${boot.lang}`);

    // Defensive start-sweep: the pinned fixture _ids must be free for this suite's own create/cleanup
    // cycle (a record run that crashed mid-pass can leave them). Logged loudly so pollution never hides.
    const swept = await fw.executeInFoundry(
      (actorId, pinnedIds) => {
        const actor = game.actors.get(actorId);
        const present = actor.items.filter((i) => pinnedIds.includes(i.id)).map((i) => i.id);
        if (present.length === 0) return 0;
        return actor.deleteEmbeddedDocuments('Item', present).then(() => present.length);
      },
      ATTACKER_ACTOR_ID,
      [STANDARD_WEAPON._id, TRAIT_WEAPON._id],
    );
    if (swept) console.log(`[damage] start-sweep removed ${swept} leftover pinned weapon(s) from the attacker`);
    if (!(await victimMatchesSeedBaseline()))
      throw new Error('victim stats are NOT at the seed baseline at suite start — poisoning from a previous run');
    const bootAttackCards = await fw.executeInFoundry(attackCardIdsInPage);
    const bootVicEmbedded = await fw.executeInFoundry(actorEmbeddedStateInPage, VICTIM_ACTOR_ID);
    console.log(
      `[damage] start baseline: attack/damage cards (flags.knight.targets): [${bootAttackCards}] | victim effects+items: ${JSON.stringify(bootVicEmbedded)}`,
    );

    const counterInstalled = await fw.executeInFoundry(installActorUpdateCounterInPage);
    console.log(`[damage] preUpdateActor counter: ${counterInstalled}`);

    // ───────────────────────── 1. button injection (+ negative) ─────────────────────────

    await runCase('case1-buttons', async () => {
      let msgId;
      let negId;
      try {
        msgId = await replay(standard.message);
        const buttons = await fw.waitFor(damageButtonsOnCardInPage, 15000, msgId);
        const expected = [
          { label: 'Normal', action: 'applyDamage' },
          { label: 'Demi', action: 'applyDamageHalf' },
          { label: 'Double', action: 'applyDamageDouble' },
          { label: 'Espoir', action: 'applyDamageEspoir' },
          { label: 'Energie', action: 'applyDamageEnergie' },
        ];
        push(
          'case1: the five damage buttons are injected on the pinned replayed pnj damage card',
          deepEqualJson(buttons, expected),
          `got ${JSON.stringify(buttons)}`,
        );

        // NEGATIVE: knight-actor-type variant must get ZERO buttons. renderChatMessageHTML fires
        // BEFORE DOM insertion (core 14.369 chat-message.mjs:449), so one immediate read of an
        // already-inserted card is conclusive for absence — no sleep needed.
        negId = await replay(standard.message, (m) => {
          m.flags.knight.actor.type = 'knight';
        });
        // renderChatMessageHTML fires BEFORE DOM insertion (core 14.369 chat-message.mjs:449), so
        // once the card exists the injection decision is final: the COUNT probe reads 0 conclusively
        // (damageButtonsOnCardInPage's null-until-injection contract cannot express this shape).
        const negProbe = await fw.waitFor(damageButtonCountOnCardInPage, 15000, negId);
        push(
          "case1 negative: NO damage buttons when flags.knight.actor.type==='knight' (PC attacks skipped)",
          negProbe.count === 0,
          `got count ${JSON.stringify(negProbe)}`,
        );
      } finally {
        await cleanup([msgId, negId], null);
      }
    });

    // ───────────────────────── 2. Normal apply (math + recap + double update) ─────────────────────────

    await runCase('case2-normal', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, VICTIM_ACTOR_ID);
      let msgId;
      let recapId;
      const recapIds = [];
      try {
        msgId = await replay(standard.message);
        const updatesBefore = (await fw.executeInFoundry(readActorUpdatesInPage)).length;
        // Oracle (unit suite's DamageKnight worked family): base 14 -> egide inert (origin humain)
        // -> applyTraitCdf: cdf eff 10 - penetrant 6 = 4 -> damage 14-4 = 10 -> armure absorbs
        // min(10,100)=10 (armure 90), carry to sante trunc(10/5)=2 (sante 18).
        const { recap, stats } = await applyDamageAndAwait(msgId, 'applyDamage', { armure: 90, sante: 18 }, recapIds);
        recapId = recap.id;
        push(
          'case2: Normal apply -> armure 100->90, sante 20->18 (CdF eff 4 soaked, carry trunc(10/5)=2)',
          entriesEqual(stats, { ...SEED_STATS, armure: 90, sante: 18 }),
          `got ${JSON.stringify(stats)}`,
        );
        push(
          'case2: recap map EXACT keys/values {armure:10, sante:2}',
          recapMapMatches(recap.recap, { armure: 10, sante: 2 }),
          `got ${JSON.stringify(recap.recap)}`,
        );
        // The replayed damage message carries the VICTIM token as speaker (see replay()), so
        // DamageBase.origin (damageBase.js:36) is the token-backed uuid — a live token's recap
        // origin is always real (the 'Scene.null.Token.null' variant is unit-pinned only, on the
        // fixture's null speaker).
        push(
          'case2: recap flags isRecap=true, origin "Scene.kdtSceneMainAAAA.Token.tkVicKnightAAAAA" (token-backed replay), wear "armure" (the seed victim wears armure; damageKnight.js:247 copies system.wear), anatheme false',
          recap.flags?.isRecap === true &&
            recap.flags.origin === 'Scene.kdtSceneMainAAAA.Token.tkVicKnightAAAAA' &&
            recap.flags.wear === 'armure' &&
            recap.flags.anatheme === false,
          `got ${JSON.stringify(recap.flags)}`,
        );
        // RECAP LABEL CONTRACT (damageBase.js:312-333): exact accented header/labels — asserted at
        // byte level so a French-localization drift fails the suite, not a lossy substring.
        const content = await fw.executeInFoundry(messageContentInPage, recapId);
        const linesOk =
          content.includes(RECAP_HEADER) &&
          content.includes(recapLine('Armure', 10)) &&
          content.includes(recapLine('Santé', 2)) &&
          !content.includes('<div>E') && // no Énergie/Espoir line
          !content.includes('Guardian :') &&
          !content.includes('Blindage :') &&
          !content.includes('Cohésion :') &&
          content.includes('class="revert-damage"');
        push(
          'case2: recap content lines exact (header + "Armure : 10" + "Santé : 2"; no other stat lines) with a .revert-damage button',
          linesOk,
          `content: ${content}`,
        );

        // INTENDED (author): apply() ALWAYS issues two actor.update calls (damageBase.js:295+303)
        // — live preUpdateActor witness. With energie NOT in the repartition the SECOND update is a
        // no-op (empty data), so exactly ONE preUpdateActor carries the payload pair.
        const updates = await fw.executeInFoundry(readActorUpdatesInPage);
        const victimUpdates = updates
          .slice(updatesBefore)
          .filter((u) => u.id === VICTIM_ACTOR_ID && Object.keys(u.data ?? {}).length > 0);
        // LIVE wear is 'armure', and two live facts refine the unit-suite picture:
        //  (a) INTENDED (author) double update, live witness: apply() (damageBase.js:296+303) does
        //      NOT reset `data` between the two actor.update calls, so with energie absent the
        //      SECOND call re-sends the SAME armure/sante payload — not an empty one;
        //  (b) the knight system's own preUpdateActor sync hook (knight.mjs:848, first flat key is
        //      system.armure.value) mirrors EACH write into equipements.armure.armure.
        // v14 hands the hook the MERGED nested payload, so the witness is exactly 4 non-empty
        // entries: 2x the module pair + 2x the equipements sync.
        const modulePayloads = victimUpdates.filter((u) =>
          deepEqualJson(u.data?.system, { armure: { value: 90 }, sante: { value: 18 } }),
        );
        const hookSyncs = victimUpdates.filter((u) =>
          deepEqualJson(u.data?.system?.equipements, { armure: { armure: { value: 90 } } }),
        );
        push(
          'case2: INTENDED double update live — exactly 4 non-empty preUpdateActor payloads: 2x module {armure:90, sante:18} + 2x system equipements sync (wear armure)',
          victimUpdates.length === 4 && modulePayloads.length === 2 && hookSyncs.length === 2,
          `got ${JSON.stringify(victimUpdates)}`,
        );
      } finally {
        await cleanup([msgId, recapId, ...recapIds], snap);
      }
    });

    // ───────────────────────── 3. Demi / Double multipliers ─────────────────────────

    await runCase('case3-demi-double', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, VICTIM_ACTOR_ID);
      let demiMsg;
      let demiRecap;
      let doubleMsg;
      let doubleRecap;
      const recapIds = [];
      try {
        // CEIL-DISCRIMINATING target (review-6 D7): the recorded 14 under mult 0.5 lands
        // 7 either way (ceil(7)=trunc(7)=7 — no discrimination). Mutating the replay to 13
        // makes Math.ceil(6.5)=7 vs the trunc mutant's 6: armure 97 / recap {armure:3,sante:0}
        // vs 98 / {armure:2,sante:0}. The double sub-case below keeps the recorded 14 (x2 = 28).
        demiMsg = await replay(standard.message, (m) => {
          m.flags.knight.targets[0].value = 13;
        });
        // ceil(13*0.5)=7 -> -4 CdF = 3 -> armure 97; carry trunc(3/5)=0 -> sante 20.
        const demi = await applyDamageAndAwait(demiMsg, 'applyDamageHalf', { armure: 97, sante: 20 }, recapIds);
        demiRecap = demi.recapId;
        push(
          'case3: Demi target 13 -> Math.ceil(13*0.5)=7 (trunc mutant would land 6 -> armure 98) -> armure 97, sante 20 untouched (carry trunc(3/5)=0)',
          entriesEqual(demi.stats, { ...SEED_STATS, armure: 97 }),
          `got ${JSON.stringify(demi.stats)}`,
        );
        push(
          'case3: Demi recap map EXACT {armure:3, sante:0}',
          recapMapMatches(demi.recap.recap, { armure: 3, sante: 0 }),
          `got ${JSON.stringify(demi.recap.recap)}`,
        );
        const demiContent = await fw.executeInFoundry(messageContentInPage, demiRecap);
        push(
          "case3: Demi recap content shows the 'Armure : 3' line but NO 'Santé' line (0-falsy repartition line is omitted — damageBase.js:323)",
          demiContent.includes(recapLine('Armure', 3)) &&
            !demiContent.includes(recapLine('Santé', 0)) &&
            !demiContent.includes('Santé :'),
          `content: ${demiContent}`,
        );
        // Mid-case baseline restore (review-6 D5): the file's own restoreBaselineBetween — the
        // old cleanup() wrapped the restore in an UNAWAITED .catch, so the Double sub-apply
        // could start while the victim stats were still draining. Sink the Demi ids FIRST, then
        // restore and WAIT for the seed stats before the next replay.
        await fw
          .executeInFoundry(deleteMessagesInPage, [demiMsg, demiRecap, ...recapIds].filter(Boolean))
          .catch((err) => console.log(`[damage] case3 mid-case message-delete FAILED: ${err.message ?? err}`));
        recapIds.length = 0;
        await restoreBaselineBetween(snap);

        doubleMsg = await replay(standard.message);
        // ceil(14*2)=28 -> -4 = 24 -> armure 76; carry trunc(24/5)=4 -> sante 16.
        const dbl = await applyDamageAndAwait(doubleMsg, 'applyDamageDouble', { armure: 76, sante: 16 }, recapIds);
        doubleRecap = dbl.recapId;
        push(
          'case3: Double -> armure 76, sante 16',
          entriesEqual(dbl.stats, { ...SEED_STATS, armure: 76, sante: 16 }),
          `got ${JSON.stringify(dbl.stats)}`,
        );
        push(
          'case3: Double recap map EXACT {armure:24, sante:4}',
          recapMapMatches(dbl.recap.recap, { armure: 24, sante: 4 }),
          `got ${JSON.stringify(dbl.recap.recap)}`,
        );
      } finally {
        await cleanup([doubleMsg, doubleRecap, ...recapIds], snap);
      }
    });

    // ───────────────────────── 4. CdF >= damage: inert early return ─────────────────────────

    await runCase('case4-cdf-inert', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, VICTIM_ACTOR_ID);
      let inertMsg;
      let boundaryMsg;
      const recapIds = [];
      try {
        // targets[0].value 4 == effective CdF (10-6): calculate() returns with EVERYTHING
        // untouched — yet apply() (empty double update) and generateRecapMessage still run.
        inertMsg = await replay(standard.message, (m) => {
          m.flags.knight.targets[0].value = 4;
        });
        const inert = await applyDamageAndAwait(inertMsg, 'applyDamage', SEED_STATS, recapIds);
        push(
          'case4: CdF>=damage (value 4) -> stats byte-identical to seed (no armure/CdF write at all)',
          entriesEqual(inert.stats, SEED_STATS),
          `got ${JSON.stringify(inert.stats)}`,
        );
        push(
          'case4: recap STILL created with EXACT map {} (early return before any repartition key)',
          deepEqualJson(inert.recap.recap, {}) && Object.keys(inert.recap.recap ?? {}).length === 0,
          `got ${JSON.stringify(inert.recap.recap)}`,
        );

        // Boundary pair: value 5 -> damage 1 past the effective CdF 4 -> armure absorbs 1.
        boundaryMsg = await replay(standard.message, (m) => {
          m.flags.knight.targets[0].value = 5;
        });
        const boundary = await applyDamageAndAwait(boundaryMsg, 'applyDamage', { armure: 99, sante: 20 }, recapIds);
        push(
          'case4 boundary: value 5 -> armure 99 (1 unit past CdF 4), recap EXACT {armure:1, sante:0}',
          recapMapMatches(boundary.recap.recap, { armure: 1, sante: 0 }) && boundary.stats.armure === 99,
          `got ${JSON.stringify(boundary.stats)} / ${JSON.stringify(boundary.recap.recap)}`,
        );
      } finally {
        await cleanup([inertMsg, boundaryMsg, ...recapIds], snap);
      }
    });

    // ───────────────────────── 5. Egide (origin anatheme) ─────────────────────────

    await runCase('case5-egide', async () => {
      // World victim ships egide 0 (docs Phase 0 table); the reduction becomes observable by
      // bumping egide to 8 via actor.update (snapshot/restore keeps the world untouched).
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, VICTIM_ACTOR_ID);
      let egideMsg;
      let egideRecap;
      let controlMsg;
      let controlRecap;
      const recapIds = [];
      try {
        await fw.executeInFoundry(updateActorInPage, VICTIM_ACTOR_ID, {
          'system.egide.value': 8,
          'system.egide.base': 8,
        });
        egideMsg = await replay(standard.message, (m) => {
          m.flags.knight.actor.system.origin = 'anatheme';
        });
        // 14 - egide 8 = 6 -> - CdF 4 = 2 -> armure 98; carry trunc(2/5)=0 -> sante 20.
        const egide = await applyDamageAndAwait(egideMsg, 'applyDamage', { armure: 98, sante: 20 }, recapIds);
        egideRecap = egide.recapId;
        push(
          "case5: origin 'anatheme' + egide 8 -> damage reduced BEFORE CdF: armure 98, recap EXACT {armure:2, sante:0}",
          recapMapMatches(egide.recap.recap, { armure: 2, sante: 0 }) && egide.stats.armure === 98,
          `got ${JSON.stringify(egide.stats)} / ${JSON.stringify(egide.recap.recap)}`,
        );

        // Control twin: fresh baseline + same egide 8, UNCHANGED origin (recorded 'humain') -> egide
        // inert, identical to the case-2 standard numbers (armure 90). Proves the egide gate reads
        // the MESSAGE origin flag, not the stat value.
        await restoreBaselineBetween(snap);
        await fw.executeInFoundry(updateActorInPage, VICTIM_ACTOR_ID, {
          'system.egide.value': 8,
          'system.egide.base': 8,
        });
        controlMsg = await replay(standard.message);
        controlRecap = (await applyDamageAndAwait(controlMsg, 'applyDamage', { armure: 90, sante: 18 }, recapIds))
          .recapId;
        const controlStats = await fw.executeInFoundry(readStatsInPage, VICTIM_ACTOR_ID);
        push(
          'case5 control: egide 8 WITHOUT anatheme origin -> egide inert (armure 90, sante 18 — standard numbers)',
          controlStats.armure === 90 && controlStats.sante === 18,
          `got ${JSON.stringify(controlStats)}`,
        );
      } finally {
        await cleanup([egideMsg, egideRecap, controlMsg, controlRecap, ...recapIds], snap);
      }
    });

    // ───────────────────────── 6. raw-flag variants + worn armor threshold ─────────────────────────

    await runCase('case6-threshold-flags', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, VICTIM_ACTOR_ID);
      let ignoreArmureMsg;
      let ignoreArmureRecap;
      let ignoreCdfMsg;
      let ignoreCdfRecap;
      let wornMsg;
      let wornRecap;
      let resilienceMsg;
      let resilienceRecap;
      const recapIds = [];
      try {
        // (a) raw 'ignorearmure' vs FULL armor: armure track fully skipped; 10 straight to
        // sante (20->10); INTENDED (author): armure stays 100 — the bypass drop tail is the
        // unit suite's pin (needs sante drained to 0, which would arm the system's death flow).
        ignoreArmureMsg = await replay(standard.message, (m) => {
          m.flags.knight.weapon.effets.raw.push('ignorearmure');
        });
        const ia = await applyDamageAndAwait(ignoreArmureMsg, 'applyDamage', { armure: 100, sante: 10 }, recapIds);
        ignoreArmureRecap = ia.recapId;
        push(
          "case6: raw 'ignorearmure' -> armure 100/15-guardian UNTOUCHED, sante 20->10, recap EXACT {armure:0, sante:10}",
          recapMapMatches(ia.recap.recap, { armure: 0, sante: 10 }) &&
            ia.stats.armure === 100 &&
            ia.stats.guardianArmure === 15,
          `got ${JSON.stringify(ia.stats)} / ${JSON.stringify(ia.recap.recap)}`,
        );

        await restoreBaselineBetween(snap);

        // (b) raw 'ignorechampdeforce': CdF zeroed WITHOUT the penetrant subtraction — the full
        // 14 hits armure (86), carry trunc(14/5)=2 (sante 18). Discriminates from case2's 90/18.
        ignoreCdfMsg = await replay(standard.message, (m) => {
          m.flags.knight.weapon.effets.raw.push('ignorechampdeforce');
        });
        const ic = await applyDamageAndAwait(ignoreCdfMsg, 'applyDamage', { armure: 86, sante: 18 }, recapIds);
        ignoreCdfRecap = ic.recapId;
        push(
          "case6: raw 'ignorechampdeforce' -> CdF 0 (no penetrant step), armure 86, recap EXACT {armure:14, sante:2}",
          recapMapMatches(ic.recap.recap, { armure: 14, sante: 2 }) && ic.stats.armure === 86,
          `got ${JSON.stringify(ic.stats)} / ${JSON.stringify(ic.recap.recap)}`,
        );

        await restoreBaselineBetween(snap);

        // (c) perce-armure 40 threshold straddle, live side: worn armure 30 (<= 40) flips
        // isArmorIgnored -> armure track skipped, armure 30 intact, 10 straight to sante —
        // the exact discriminating pair against case2 (full 100 absorbs). Wait for the 30 to be
        // LIVE (system equipements sync + value clamp) before any click can read it.
        await fw.executeInFoundry(updateActorInPage, VICTIM_ACTOR_ID, {
          'system.armure.value': 30,
          'system.armure.base': 30,
        });
        await fw.waitFor(statsMatchInPage, 15000, VICTIM_ACTOR_ID, { armure: 30 });
        wornMsg = await replay(standard.message);
        const worn = await applyDamageAndAwait(wornMsg, 'applyDamage', { armure: 30, sante: 10 }, recapIds);
        wornRecap = worn.recapId;
        push(
          'case6: worn armure 30 vs perce-armure 40 -> bypass: armure 30 intact, sante 20->10, recap EXACT {armure:0, sante:10} (INTENDED: bypassed-armor drop tail stays unit-pinned)',
          recapMapMatches(worn.recap.recap, { armure: 0, sante: 10 }) &&
            worn.stats.armure === 30 &&
            worn.stats.guardianArmure === 15,
          `got ${JSON.stringify(worn.stats)} / ${JSON.stringify(worn.recap.recap)}`,
        );

        await restoreBaselineBetween(snap);

        // (d) KNIGHT PATH: NO COLOSSE /10 REGARDLESS OF RESILIENCE (live FINDING):
        // calculateDamageStatWithColosse (damageBase.js:176) is only CALLED by the
        // creature/vehicule/mecha/npc classes — DamageKnight.calculate() never divides by 10, so
        // the knight pipeline takes the standard numbers here. The unit pin "no resilience =>
        // colosse on" (damage-base.test.mjs:522) describes the METHOD in isolation, NOT the knight
        // pipeline. NOTE (v14 schema): the knight actor template has NO resilience field, so the
        // update below is silently DROPPED by v14 — the update is still issued (harmless probe of
        // the write path) and the read-back below logs what actually survived; the pin grades the
        // knight math either way.
        await fw.executeInFoundry(updateActorInPage, VICTIM_ACTOR_ID, { 'system.resilience.value': 3 });
        const resilienceBack = await fw.executeInFoundry(
          (actorId) => game.actors.get(actorId).system.resilience ?? null,
          VICTIM_ACTOR_ID,
        );
        console.log(
          `[damage] case6(d): system.resilience write-back reads ${JSON.stringify(resilienceBack)} (knight schema has no such field)`,
        );
        resilienceMsg = await replay(standard.message);
        const resilience = await applyDamageAndAwait(resilienceMsg, 'applyDamage', { armure: 90, sante: 18 }, recapIds);
        resilienceRecap = resilience.recapId;
        push(
          'case6: knight path — NO colosse /10 regardless of resilience (DamageKnight never calls calculateDamageStatWithColosse): armure 90, recap EXACT {armure:10, sante:2}',
          recapMapMatches(resilience.recap.recap, { armure: 10, sante: 2 }) && resilience.stats.armure === 90,
          `got ${JSON.stringify(resilience.stats)} / ${JSON.stringify(resilience.recap.recap)}`,
        );
      } finally {
        await cleanup(
          [
            ignoreArmureMsg,
            ignoreArmureRecap,
            ignoreCdfMsg,
            ignoreCdfRecap,
            wornMsg,
            wornRecap,
            resilienceMsg,
            resilienceRecap,
            ...recapIds,
          ],
          snap,
        );
      }
    });

    // ───────────────────────── 7. trait VALUE extraction (real recorded HTML) ─────────────────────────

    await runCase('case7-trait-html', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, VICTIM_ACTOR_ID);
      let msgId;
      const recapIds = [];
      try {
        msgId = await replay(trait.message);
        // Raw round-trip of the bare keyword (bool source) and the REAL label+value spans
        // (value source) on the LIVE replay — the unit traitSpan() double finally has a witness.
        const raw = await fw.executeInFoundry(messageFlagsInPage, msgId, 'knight.weapon.effets.raw');
        push(
          "case7: trait fixture raw round-trips to ['percearmure 40','penetrant 6','destructeur']",
          deepEqualJson(raw.value, ['percearmure 40', 'penetrant 6', 'destructeur']),
          `got ${JSON.stringify(raw.value)}`,
        );
        const content = await fw.executeInFoundry(messageContentInPage, msgId);
        const spanMatches = Array.from(
          content.matchAll(new RegExp('<span class="label">Destructeur<\\/span>\\s*<span class="value">\\+\\d*', 'g')),
        );
        push(
          `case7: replayed content carries EXACTLY ONE real label+value span pair for Destructeur (+${EXPECTED_TRAIT_VALUE})`,
          spanMatches.length === 1 && spanMatches[0][0].includes(`<span class="value">+${EXPECTED_TRAIT_VALUE}`),
          `got ${spanMatches.length} match(es)`,
        );

        // The applied number can ONLY come from bool(raw 'destructeur') AND extractTraitValue
        // reading 6 out of the REAL span: gate+soak 14-4=10, +6=16 -> armure 84, carry 3, sante 17.
        const applied = await applyDamageAndAwait(msgId, 'applyDamage', { armure: 84, sante: 17 }, recapIds);
        push(
          'case7: trait extraction lands the +6 BEFORE armor — armure 84 (not 90), sante 17 (not 18), recap EXACT {armure:16, sante:3}',
          recapMapMatches(applied.recap.recap, { armure: 16, sante: 3 }) &&
            applied.stats.armure === 84 &&
            applied.stats.sante === 17,
          `got ${JSON.stringify(applied.stats)} / ${JSON.stringify(applied.recap.recap)}`,
        );
      } finally {
        await cleanup([msgId, ...recapIds], snap);
      }
    });

    // ───────────────────────── 8. Shift+click modifier dialog (DialogV2) ─────────────────────────

    await runCase('case8-modifier-dialog', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, VICTIM_ACTOR_ID);
      let msgId;
      const recapIds = [];
      try {
        msgId = await replay(standard.message);
        await fw.executeInFoundry(controlTokenInPage, VICTIM_TOKEN_ID);
        const preIds = await fw.executeInFoundry(listMessageIdsInPage);

        // Shift+click with REAL modifiers (event.shiftKey reaches the jQuery handler). The click is
        // a STRINGIFIED page function: modifiers ride in as a page arg, never a node-side option.
        await fw.waitFor(clickOnMessageCard, 15000, msgId, '.damageButton button[data-action="applyDamage"]', [
          'Shift',
        ]);

        // DialogV2.prompt drivability check (the plan asked to VERIFY this, framework v2.0.0):
        // if the modal does not appear, the case is BLOCKED — documented, not hacked around.
        let dialogVisible = true;
        try {
          await fw.waitForSelector("footer.form-footer button[type='submit']", 8000);
        } catch {
          dialogVisible = false;
        }
        if (!dialogVisible) {
          push(
            'case8: DialogV2.prompt modifier dialog is drivable by framework v2.0.0',
            false,
            'BLOCKED: the askModifier DialogV2 modal did not surface a footer.form-footer submit button within 8s of the shift+click',
          );
          return;
        }
        push('case8: shift+Normal opens the DialogV2.prompt modifier dialog (framework CAN target it)', true);

        await fw.page.fill('input[name="value"]', '3');
        await fw.submitDialog();

        // askModifier does `damage += value` (damageBase.js:92): 14 + 3 = 17 -> -CdF 4 = 13 ->
        // armure 87; carry trunc(13/5)=2 -> sante 18.
        const recap = await fw.waitFor(findNewRecapMessageInPage, 15000, preIds);
        if (recap?.ids) recapIds.push(...recap.ids); // sink multi-candidate anomaly before throwing
        if (!recap || recap.error)
          throw new Error(`recap discovery after modifier submit failed: ${recap?.error ?? 'timeout'}`);
        recapIds.push(recap.id); // sink NOW: the stats wait below must not orphan the recap card
        const stats = await fw.waitFor(statsMatchInPage, 15000, VICTIM_ACTOR_ID, { armure: 87, sante: 18 });
        push(
          'case8: modifier +3 through the dialog -> damage 17, armure 87, sante 18, recap EXACT {armure:13, sante:2}',
          recapMapMatches(recap.recap, { armure: 13, sante: 2 }) && stats.armure === 87 && stats.sante === 18,
          `got ${JSON.stringify(stats)} / ${JSON.stringify(recap.recap)}`,
        );
      } finally {
        // Best-effort modal sweep BEFORE the message cleanup: a DialogV2.prompt left open (submit
        // throw, BLOCKED branch) is modal + rejectClose and would degrade EVERY later case's
        // waits/clicks into timeouts. Never fatal: the sweep failing must not mask the case error.
        const sweptDialogs = await fw.executeInFoundry(closeStuckDialogsInPage).catch(() => null);
        if (sweptDialogs) console.log(`[damage] case8 finally closed ${sweptDialogs} stuck dialog window(s)`);
        await cleanup([msgId, ...recapIds], snap);
      }
    });

    // ───────────────────────── 9. revert via the recap .revert-damage button ─────────────────────────

    await runCase('case9-revert', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, VICTIM_ACTOR_ID);
      let msgId;
      let recapId;
      const recapIds = [];
      try {
        msgId = await replay(standard.message);
        const applied = await applyDamageAndAwait(msgId, 'applyDamage', { armure: 90, sante: 18 }, recapIds);
        recapId = applied.recapId;

        // The knight revert is the setTimeout(100/101) path (DamageKnight.revertDamage).
        await fw.waitFor(clickOnMessageCard, 15000, recapId, '.revert-damage');
        const restored = await fw.waitFor(statsMatchInPage, 15000, VICTIM_ACTOR_ID, SEED_STATS);
        push(
          'case9: revert restores ALL stats to the seed values (armure 100, sante 20, CdF/egide/energie untouched)',
          entriesEqual(restored, SEED_STATS),
          `got ${JSON.stringify(restored)}`,
        );

        const domState = await fw.waitFor(revertDomStateInPage, 15000, recapId);
        push(
          'case9: recap card shows line-through on .recap AND the .revert-damage button is gone from the DOM',
          domState?.lineThrough === true && domState?.revertButtonGone === true,
          `got ${JSON.stringify(domState)}`,
        );

        // The DOM mutation must have been PERSISTED through message.update({content}) — probe the
        // DOCUMENT (game.messages content field), not the DOM: the knight revert mutates the card
        // DOM directly (jQuery css/remove), so the innerHTML read above cannot observe whether the
        // update landed. Stored content = html.find('.message-content').html() at update time.
        // WAITED (review-5 B1): the update is unawaited and its DB response only *usually* precedes
        // the +101 ms actor write; a latency spike inverts that, so poll until persisted.
        const persisted = await fw.waitFor(
          storedContentPersistedInPage,
          15000,
          recapId,
          'line-through',
          'revert-damage',
        );
        push(
          "case9: revert PERSISTS the mutated recap content (STORED message.content contains 'line-through', no revert-damage button)",
          persisted?.ok === true,
          `got ${JSON.stringify(persisted)}`,
        );
      } finally {
        await cleanup([msgId, recapId, ...recapIds], snap);
      }
    });

    // ───────────────────────── 10. live anti-anatheme status injection ─────────────────────────

    await runCase('case10-antianatheme-status', async () => {
      // The FIXED preUpdateChatMessage injection (b01c572, reads serialized
      // flags.knight.actor.effects[].statuses) needs a live status on the ATTACKER.
      const atkSnap = await fw.executeInFoundry(snapshotActorSystemInPage, ATTACKER_ACTOR_ID);
      let itemId;
      const createdMessages = [];
      try {
        // Hygiene: this case is the suite's ONLY dice-override user (real attack) — start from a
        // clean extension queue, mirroring the recorder's per-pass isolation.
        await fw.executeInFoundry(clearDiceQueueInPage);

        const effects = await fw.executeInFoundry(
          toggleAttackerStatusInPage,
          ATTACKER_ACTOR_ID,
          ANTI_ANATHEME_STATUS_ID,
          true,
        );
        push(
          'case10: atk-pnj actor granted the module anti-anatheme status (effect with statuses [anti-anatheme] present)',
          effects.some((statuses) => statuses.includes(ANTI_ANATHEME_STATUS_ID)),
          `actor effects statuses: ${JSON.stringify(effects)}`,
        );

        const weaponInfo = await fw.executeInFoundry(
          createWeaponInPage,
          ATTACKER_ACTOR_ID,
          structuredClone(STANDARD_WEAPON),
        );
        itemId = weaponInfo.itemId;

        await fw.queueDiceOverride(ATTACK_DICE.faces, ATTACK_DICE.count, ATTACK_DICE.total);
        await fw.queueDiceOverride(DAMAGE_DICE.faces, DAMAGE_DICE.count, DAMAGE_DICE.total);

        const targeted = await fw.executeInFoundry((tokenId) => {
          for (const token of Array.from(game.user.targets)) token.setTarget(false);
          canvas.tokens.get(tokenId).setTarget(true);
          return game.user.targets.size;
        }, VICTIM_TOKEN_ID);
        if (targeted !== 1) throw new Error(`expected exactly 1 targeted token, got ${targeted}`);

        const attackInfo = await fw.executeInFoundry(runAttackInPage, boot.atkToken, itemId, ATTACK_DICE.formula);
        createdMessages.push(attackInfo.attackMessageId);
        await fw.waitFor(degatsButtonOnCardInPage, 15000, attackInfo.attackMessageId);
        await fw.waitFor(clickOnMessageCard, 15000, attackInfo.attackMessageId, '.knight-roll button.degats');

        const preIds = await fw.executeInFoundry(listMessageIdsInPage);
        const damage = await fw.waitFor(newDamageMessageIdInPage, 15000, preIds, VICTIM_TOKEN_ID);
        if (damage?.ids) createdMessages.push(...damage.ids); // multi-message anomaly: sink BEFORE throwing
        if (!damage || damage.error)
          throw new Error(`live damage message discovery failed: ${damage?.error ?? 'timeout'}`);
        createdMessages.push(damage.id);

        const rawAfter = await fw.executeInFoundry(messageFlagsInPage, damage.id, 'knight.weapon.effets.raw');
        push(
          "case10: preUpdateChatMessage injection — the DAMAGE message's weapon.effets.raw gained 'antianatheme' appended (attacker status reached the serialized snapshot)",
          deepEqualJson(rawAfter.value, ['percearmure 40', 'penetrant 6', 'antianatheme']),
          `got ${JSON.stringify(rawAfter.value)}`,
        );

        // And the ATTACK message itself carries it (the injection mutates the flag update that
        // carries the effects[] snapshot — both passes see the same listener).
        const rawAttack = await fw.executeInFoundry(
          messageFlagsInPage,
          attackInfo.attackMessageId,
          'knight.weapon.effets.raw',
        );
        push(
          'case10: the ATTACK message raw also contains antianatheme (injection applied on the flag update)',
          Array.isArray(rawAttack.value) && rawAttack.value.includes('antianatheme'),
          `got ${JSON.stringify(rawAttack.value)}`,
        );
      } finally {
        await fw
          .executeInFoundry(toggleAttackerStatusInPage, ATTACKER_ACTOR_ID, ANTI_ANATHEME_STATUS_ID, false)
          .catch(() => {});
        // Review-6 D6: the live attack left the victim token TARGETED (game.user.targets) —
        // releaseAllTokensInPage never clears that set, so clear it here too.
        await fw.executeInFoundry(clearUserTargetsInPage).catch(() => {});
        if (itemId) await fw.executeInFoundry(deleteItemsInPage, ATTACKER_ACTOR_ID, [itemId]).catch(() => {});
        await fw.executeInFoundry(updateActorInPage, ATTACKER_ACTOR_ID, { system: atkSnap }).catch(() => {});
        if (createdMessages.length)
          await fw
            .executeInFoundry(deleteMessagesInPage, createdMessages)
            .catch((err) => console.log(`[damage] case10 cleanup message-delete FAILED: ${err.message ?? err}`));
      }
    });

    // ───────────────────────── world-restoration self-check ─────────────────────────

    push(
      'poisoning self-check: victim stats byte-identical to the seed baseline at suite end',
      await victimMatchesSeedBaseline(),
    );
    const atkEffects = await fw.executeInFoundry(
      (actorId) => game.actors.get(actorId).effects.map((e) => Array.from(e.statuses)),
      ATTACKER_ACTOR_ID,
    );
    push(
      'poisoning self-check: attacker has no leftover status effects',
      atkEffects.every((s) => s.length === 0),
      `got ${JSON.stringify(atkEffects)}`,
    );
    const atkWeapons = await fw.executeInFoundry(
      (actorId) => game.actors.get(actorId).items.map((i) => i.id),
      ATTACKER_ACTOR_ID,
    );
    const pinnedLeft = atkWeapons.filter((id) => id === STANDARD_WEAPON._id || id === TRAIT_WEAPON._id);
    push(
      'poisoning self-check: attacker holds none of the pinned fixture weapon ids (other items are legal — Phase 4+ seeds more)',
      pinnedLeft.length === 0,
      `leftover pinned ids: ${JSON.stringify(pinnedLeft)} (attacker items: ${JSON.stringify(atkWeapons)})`,
    );
    const recapLeak = await fw.executeInFoundry(() =>
      game.messages.contents.filter((m) => m.flags?.['knight-damage']?.isRecap === true).map((m) => m.id),
    );
    push(
      'poisoning self-check: NO knight-damage recap message survives in the (boot-persistent) chat log',
      recapLeak.length === 0,
      `leftover recap ids: ${JSON.stringify(recapLeak)}`,
    );
    // Review-6 D2: the leak scan WIDENS to the system attack/damage card family — every replayed
    // fixture card carries flags.knight.targets and MUST have been deleted by its case's cleanup.
    const endAttackCards = await fw.executeInFoundry(attackCardIdsInPage);
    push(
      'poisoning self-check: the set of flags.knight.targets attack/damage card ids is UNCHANGED from the boot baseline (no leaked fixture replay card; freshly seeded boot baseline is empty)',
      endAttackCards === bootAttackCards,
      `boot [${bootAttackCards}] -> end [${endAttackCards}]`,
    );
    const endVicEmbedded = await fw.executeInFoundry(actorEmbeddedStateInPage, VICTIM_ACTOR_ID);
    push(
      'poisoning self-check: victim vic-knight embedded effects (status rows) AND item-id list identical to the boot baseline (no stray statuses/items from this suite)',
      deepEqualJson(endVicEmbedded.effects, bootVicEmbedded.effects) &&
        deepEqualJson(endVicEmbedded.items, bootVicEmbedded.items),
      `boot ${JSON.stringify(bootVicEmbedded)} -> end ${JSON.stringify(endVicEmbedded)}`,
    );

    // ───────────────────────── summary ─────────────────────────

    for (const { label, ok, detail } of results) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — ${detail}`}`);
    }
    const failures = results.filter((r) => !r.ok).length;
    if (failures > 0) {
      console.log(
        `\nE2E DAMAGE: FAIL (${failures}/${results.length} assertions failed${caseFailures.length ? `; case errors: ${caseFailures.join(' | ')}` : ''})`,
      );
    } else {
      console.log(`\nE2E DAMAGE: PASS (${results.length}/${results.length} assertions)`);
    }
    process.exitCode = failures > 0 ? 1 : 0;
  } catch (err) {
    await shot('damage-failure');
    throw err;
  } finally {
    await fw.stop();
    console.log('Foundry server + browser stopped.');
  }
}
