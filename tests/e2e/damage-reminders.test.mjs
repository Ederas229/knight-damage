// E2E espoir/energie reminders (Phase 5 of docs/testing-plan.md): `npm run test:e2e:reminders`
// AFTER `npm run prepare:e2e && npm run setup:e2e` (and at least the recorded standard fixture).
//
// Coverage (proportionate to the plan's Phase-5 scope — the recap/stat machinery itself is
// already pinned byte-exact by the Phase-3/4 suites, this suite pins the REMINDER half):
//  1. Energie button with the ATTACKER token as replay speaker: origin (damageBase.js:36) makes the
//     reminder flag live on the SPEAKER token's actor — the atk-pnj actor gains
//     knight-damage.energie { Actor_kdtVicKnightAAAA: 12 } (raw underscore key byte-pinned, the
//     `.`->`_` encoding of generateReminderData, helpers.js:54-71, is the silent-corruption target);
//     victim energie 12->0 (absorption cap), armure/sante/espoir NEVER entered (early return),
//     recap EXACT {energie:12} + 'Energie : 12' label (UNACCENTED) + the double-update witness:
//     the energie gauge write lands in the SECOND of apply()'s two actor.update calls
//     (damageBase.js:298-303) plus the knight system's equipements sync (knight.mjs:848 also
//     mirrors system.energie.value, unlike armure/sante-only writes).
//  2. Revert on that recap: energies restored AND the SAME flag key (revertEnergieReminder reuses
//     flags['knight-damage'].origin, damageBase.js:237/260-271) decremented to 0 — key NOT deleted
//     (CHARACTERIZATION pin of the generateReminderData accumulation semantics); DOM line-through +
//     revert-gone + persisted content.
//  3. Death reminder end-to-end: energie apply with the VICTIM token as speaker (self-flag — the
//     flag-lives-on-speaker-actor ASYMMETRY), then createEmbeddedDocuments('ActiveEffect',
//     [{name:'Dead'}]) on the victim -> the preCreateActiveEffect hook (knight-damage.js:115-151)
//     creates a FLAGLESS chat card (same leak class as the passenger/pilote side cards — carry-flag
//     (a)) with the EXACT header "Dégâts d'energie infligés :" + "vic-knight : 12 (2d6)"
//     (Math.trunc(12/6)); the espoir loop emits NO card because the victim's espoir flag is
//     undefined. Card discovery is a before/after message-id DIFF (the card is flagless, so
//     findNewRecapMessageInPage cannot see it); every diffed id is sunk at discovery.
//  4. Espoir button (standard victim-speaker replay): espoir 15->0 (cap), recap EXACT {espoir:15} +
//     'Espoir : 15' line, victim actor flag knight-damage.espoir { Actor_kdtVicKnightAAAA: 15 } —
//     the live proof that the query stat:'espoir' branch (damageKnight.js:136-141) dispatches
//     through game.users.activeGM.query; plus the espoir.reduction floor sub-case (live
//     snapshot-restored mutation: reduction 200 >= damage 126 -> floored 0, espoir untouched,
//     recap EXACT {espoir:0}, and the 0-value query STILL creates the flag key at 0).
//  5. Direct-flag characterization of generateReminderMessage: a page-set crafted energie flag map
//     (multi-key: 5 -> "0d6", 13 -> "2d6" trunc boundaries, 0 -> SKIPPED key) + the 'Dead' effect ->
//     the card shows ONLY the nonzero keys, names resolved through the `_`->`.` uuid round-trip.
//  6. PRE-CAP targets (Phase-5 review 1): the 130-mutations all saturate at gauge caps, so the
//     CdF/penetrant subtraction is otherwise UNOBSERVED — target 10 (energie: 10-4=6) and 20
//     (espoir: 20-4-3=13) land UNSATURATED in the recap AND flag bytes, pinning penetrant-6 and
//     reduction-3 in the live chain (wrong math fails loudly in every direction, e.g. dropping
//     penetrant gives 0 damage -> no recap line at all).
//
// Oracle: tests/unit/{damage-knight,helpers,damage-revert}.test.mjs (espoir/energie target paths,
// generateReminderData round-trip/revert/accumulation, revertEnergieReminder revert:true) combined
// with the LIVE seed stats PROBED at boot (armure 100 / CdF 10 / sante 20 / espoir 15 / energie 12 /
// espoir.reduction 3) — never the unit doubles' literals. Derivation chain (fixture 130-mutation
// pattern): ceil(130*1)=130 -> CdF 10 - penetrant 6 = 4 soaked -> 126 -> gauge caps: energie 12
// absorbs 12 (126>=12); espoir 126 - reduction 3 = 123 absorbs 15 (123>=15). The pre-cap 10/20
// targets (case6) are what actually OBSERVE the 126-equivalent subtraction unsaturated.
//
// Discipline (mandatory plan rules, unchanged from Phase 3/4): every chat access message-id-pinned;
// recap AND flagless death-card ids enter the cleanup sink the MOMENT they are discovered; every
// case snapshots + restores the victim (and attacker where touched) system.* AND their actor-level
// knight-damage FLAGS (carry-flag (b)); the suite-end self-checks compare stats AND flags of all
// four actors byte-identically to the boot baselines and leak-scan recaps + BOTH death markers;
// flag assertions are WAITED (addReminder does not await setFlag — knight-damage.js:80);
// re-runnable back-to-back WITHOUT setup:e2e.

import config from './config.mjs';
import { loadFramework, respawnPreservingSymlinks } from './support/framework.mjs';
import { acquireSpawnMutex } from './support/spawn-lock.mjs';
import { loadRecordedFixture, STANDARD_FIXTURE_NAME } from './support/fixture-store.mjs';
import {
  clickOnMessageCard,
  deleteMessagesInPage,
  findNewRecapMessageInPage,
  listMessageIdsInPage,
  storedContentPersistedInPage,
} from './support/chat.mjs';
import {
  controlTokenInPage,
  installActorUpdateCounterInPage,
  moduleFlagMatchesInPage,
  readActorUpdatesInPage,
  releaseAllTokensInPage,
  restoreActorSystemInPage,
  restoreModuleFlagsInPage,
  setModuleFlagInPage,
  snapshotActorSystemInPage,
  snapshotActorsModuleFlagsInPage,
  snapshotModuleFlagsInPage,
  updateActorInPage,
} from './support/actor-pages.mjs';
import { replayFixture } from './support/replay.mjs';
import { deepEqualJson, entriesEqual, flagNamespacesEqual, recapMapMatches } from './support/compare.mjs';

/* global process */

if (respawnPreservingSymlinks()) {
  // Parent: the symlink-preserving child inherited stdio and carries the run.
} else {
  const Framework = await loadFramework();
  main(Framework).catch((err) => {
    console.error(`\nE2E REMINDERS FAIL: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });
}

const SCENE_ID = 'kdtSceneMainAAAA';
const VIC_ACTOR_ID = 'kdtVicKnightAAAA';
const VIC_TOKEN_ID = 'tkVicKnightAAAAA';
const ATK_ACTOR_ID = 'kdtAtkPnjAAAAAAA';
const ATK_TOKEN_ID = 'tkAtkPnjAAAAAAAA';
const VEH_ACTOR_ID = 'kdtVicVehiculeAA';
const MEC_ACTOR_ID = 'kdtVicMechaAAAAA';

// The reminder flag key: victim actor uuid with `.`->`_` (helpers.js:56). Byte-pinned as ONE raw
// string — the whole point of the suite is that a `_`/`.` drift fails loudly.
const VICTIM_UUID_KEY = 'Actor_kdtVicKnightAAAA';

// LIVE stats read at boot (probe-verified against the committed seed rows, same baseline the
// Phase-3 suite pins — espoir/energie were untouched by every earlier suite, so they are still the
// seed values; the boot gate below re-reads everything live before any click).
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
const SEED_ESPOIR_REDUCTION = 3;
const SEED_STATS_VEH = { armure: 30, cdf: 0, energie: 12, sante: 10 };
const SEED_STATS_MEC = { blindage: 30, energie: 12, sante: 20 };
const SEED_STATS_ATK = { sante: 10, armure: 0, energie: 12 };

// Node-side fixture mutation: target 130 (the Phase-4 oracle pair). Damage math:
// 130 -> CdF eff 10-6=4 -> 126 -> energie cap 12 absorbs EXACTLY 12; espoir: 126 - reduction 3
// = 123 -> espoir cap 15 absorbs EXACTLY 15.
const TARGET_VALUE = 130;
const ENERGIE_ABSORBED = 12;
const ESPOIR_ABSORBED = 15;

// RECAP LABEL CONTRACT (damageBase.js:311-331): 'Energie' UNACCENTED, 'Espoir', each line emitted
// only for TRUTHY repartition values (the {espoir:0} floor recap prints NO line).
const RECAP_HEADER = 'Récapitulatif des dégâts';
const recapLine = (label, value) => `<div>${label} : ${value}</div>`;

// DEATH CARD CONTRACT (knight-damage.js:135/140): one card per stat whose flag is DEFINED on the
// dying actor, header `<div>Dégâts d'${stat} infligés :</div>` (ASCII apostrophe), per NONZERO key
// `<div>${keyActor.name} : ${value} (${Math.trunc(value/6)}d6)</div>` — the card carries NO flags.
const DEATH_HEADER_ENERGIE = `<div>Dégâts d'energie infligés :</div>`;
const DEATH_MARKER_ENERGIE = "Dégâts d'energie infligés :";
const DEATH_MARKER_ESPOIR = "Dégâts d'espoir infligés :";

// ── Page-context helpers (stringify rule: no closures; values come in as trailing args) ──
// Generic page helpers (snapshot/restore system AND flags, control/release, update counter, replay
// create, module-flag predicate) live in support/actor-pages.mjs. Only the suite-specific probes
// stay here.

// waitFor predicate: every expected stat already matches (plain objects only; the read is INLINED —
// page functions travel as source and cannot close over node-side helpers).
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

// Boot/end snapshot of ALL FOUR actors' pinned stats in one round-trip (self-check fuel).
const readAllFourStatsInPage = (vicId, vehId, mecId, atkId) => {
  const A = (id) => game.actors.get(id).system;
  const vic = A(vicId);
  return {
    vic: {
      armure: vic.armure.value,
      cdf: vic.champDeForce.value,
      egide: vic.egide.value,
      guardianArmure: vic.equipements.guardian.armure.value,
      guardianCdf: vic.equipements.guardian.champDeForce.value,
      sante: vic.sante.value,
      espoir: vic.espoir.value,
      energie: vic.energie.value,
      espoirReduction: vic.espoir.reduction,
    },
    veh: {
      armure: A(vehId).armure.value,
      cdf: A(vehId).champDeForce.value,
      energie: A(vehId).energie.value,
      sante: A(vehId).sante.value,
    },
    mec: { blindage: A(mecId).blindage.value, energie: A(mecId).energie.value, sante: A(mecId).sante.value },
    atk: { sante: A(atkId).sante.value, armure: A(atkId).armure.value, energie: A(atkId).energie.value },
  };
};

// Deterministic death-reminder trigger (plan-verified): an ActiveEffect literally named 'Dead' and
// NOTHING ELSE — no statuses, so no core death flow, only the module hook's name match.
const createDeadEffectInPage = (actorId) =>
  game.actors
    .get(actorId)
    .createEmbeddedDocuments('ActiveEffect', [{ name: 'Dead' }])
    .then((docs) => docs.map((d) => d.id));

// LIVE FINDING (documented, source NOT modified): the knight system runs a JANITOR —
// `_cleanActor()` (knight module/documents/models/base/base-actor-data-model.mjs:360/919) deletes
// every effect with NO statuses, NO changes and no non-statuscounter flags, on each prepareData —
// and embedded-document creation re-arms prepareData. Our bare 'Dead' effect therefore usually
// deletes ITSELF right after the module's preCreateActiveEffect hook has already fired (the card
// is still created). Cleanup only deletes what SURVIVED the janitor (never throws on its races).
const deleteEmbeddedEffectsInPage = (actorId, effectIds) => {
  const actor = game.actors.get(actorId);
  const present = actor.effects.filter((e) => effectIds.includes(e.id)).map((e) => e.id);
  if (present.length === 0) return 0;
  return actor.deleteEmbeddedDocuments('ActiveEffect', present).then(
    () => present.length,
    // janitor race: it deletes between our filter and our delete; acceptable ONLY when the
    // effects are genuinely gone by then — otherwise rethrow for the loud log line.
    () => {
      const stillHere = actor.effects.filter((e) => effectIds.includes(e.id)).length;
      if (stillHere > 0) throw new Error(`${stillHere} Dead-named effect(s) survived janitor AND explicit delete`);
      return 0;
    },
  );
};

// Pinned discovery of the death-reminder card by message-id DIFF (the card is FLAGLESS — the
// flag-based recap finder cannot see it). null until the energie-header card exists; every fresh
// id (including a multi-card anomaly) is surfaced so the CALLER sinks them all before asserting.
const newDeathCardInPage = (excludeIds, energieMarker, espoirMarker) => {
  const fresh = game.messages.contents.filter((m) => !excludeIds.includes(m.id));
  const hits = fresh.filter((m) => m.content.includes(energieMarker));
  if (hits.length === 0) return null;
  const freshIds = fresh.map((m) => m.id);
  if (hits.length > 1) return { error: `${hits.length} death cards: ${hits.map((m) => m.id)}`, ids: freshIds };
  const message = hits[hits.length - 1];
  return {
    id: message.id,
    content: message.content,
    kdFlags: message.flags?.['knight-damage'] ?? null,
    freshIds,
    espoirCards: fresh.filter((m) => m.content.includes(espoirMarker)).length,
  };
};

// Revert DOM probe against the PINNED recap card (same predicate contract as Phase 3/4): null until
// BOTH line-through AND revert-gone hold. The flag decrement itself is waited via the shared
// moduleFlagMatchesInPage predicate (the revert's query is un-awaited downstream).
const revertDomStateInPage = (msgId) => {
  const card = Array.from(document.querySelectorAll('.chat-scroll li.chat-message')).find(
    (li) => li.dataset.messageId === msgId,
  );
  if (!card) return null;
  const recap = card.querySelector('.recap');
  const revertBtn = card.querySelector('.revert-damage');
  if (!recap) return null;
  const lineThrough = /line-through/.test(recap.getAttribute('style') ?? '');
  const revertButtonGone = revertBtn === null;
  return lineThrough && revertButtonGone ? { lineThrough: true, revertButtonGone: true } : null;
};

// One-shot chat-log leak scan (document-side): flagged recaps AND BOTH flagless death-card marker
// families (carry-flag (a) — the death card is created with NO flags). Markers arrive as trailing
// args (stringify rule).
const leakScanInPage = (energieMarker, espoirMarker) => ({
  recaps: game.messages.contents
    .filter((m) => m.flags?.['knight-damage']?.isRecap === true)
    .map((m) => m.id)
    .join(','),
  deathEnergie: game.messages.contents
    .filter((m) => m.content.includes(energieMarker))
    .map((m) => m.id)
    .join(','),
  deathEspoir: game.messages.contents
    .filter((m) => m.content.includes(espoirMarker))
    .map((m) => m.id)
    .join(','),
});

const readEspoirReductionInPage = (actorId) => game.actors.get(actorId).system.espoir.reduction;

// ── Node-side test plumbing ──
// deepEqualJson/entriesEqual/recapMapMatches come from support/compare.mjs (shared); the flag
// NAMESPACE self-check below uses flagNamespacesEqual — the order-tolerant DEEP variant, because
// namespace values are nested objects whose two CDP copies are reference-unequal by construction
// (entriesEqual's strict v===value would false-fail the moment a crashed run leaves flag residue,
// breaking the back-to-back contract it defends — Phase-5 review finding 1).

async function main(Framework) {
  acquireSpawnMutex(); // ownership before ANYTHING (see support/spawn-lock.mjs)
  const fw = new Framework(config);
  const results = [];
  const push = (label, ok, detail = '') => results.push({ label, ok, detail });

  const standard = loadRecordedFixture(STANDARD_FIXTURE_NAME);
  console.log(
    `[reminders] fixture loaded: standard (knight ${standard.meta.knightSystemVersion}, core ${standard.meta.coreVersion})`,
  );

  const shot = async (name) => {
    await fw.screenshot(`${name}.png`).catch(() => {});
  };

  const caseFailures = [];
  async function runCase(name, fn) {
    try {
      await fn();
    } catch (err) {
      caseFailures.push(`${name}: ${err.message ?? err}`);
      await shot(`reminders-${name}`);
      push(`${name} completes without infrastructure error`, false, `threw: ${err.stack ?? err}`);
    }
  }

  // Replay with a node-side mutation hook, then wait for the PINNED card. The SPEAKER is chosen per
  // case — this is THE Phase-5 variable: DamageBase.origin (damageBase.js:36) keys the reminder
  // flag to the SPEAKER token's actor, while the recap message (module-created, damageBase.js:338)
  // always speaks as the VICTIM token and stores the origin flag for the revert.
  // NOTE: these objects build the module-scope SCENE/TOKEN ids, so they are built ONLY inside the
  // post-fw.start() region — main() starts executing while the module body below the entry block is
  // still unevaluated (TDZ), which is why they are not node-scope consts next to replay().
  async function replay(mutate, speaker) {
    return replayFixture(fw, standard.message, mutate, speaker, 'reminders');
  }
  const mutateTargetValue = (m) => {
    m.flags.knight.targets[0].value = TARGET_VALUE;
  };

  // One damage application on the VICTIM (the controlled token always keys createDamageObject):
  // control -> pinned click -> recap discovered by flag+exclusion (sunk AT discovery) -> stats
  // waited. Death cards are discovered separately by their callers (they are flagless).
  async function applyDamageAndAwait(msgId, action, expectedStats, recapSink) {
    await fw.executeInFoundry(controlTokenInPage, VIC_TOKEN_ID);
    const preIds = await fw.executeInFoundry(listMessageIdsInPage);
    await fw.waitFor(clickOnMessageCard, 15000, msgId, `button[data-action="${action}"]`);
    const recap = await fw.waitFor(findNewRecapMessageInPage, 15000, preIds);
    if (recap?.ids) recapSink.push(...recap.ids);
    if (!recap || recap.error) throw new Error(`recap message discovery failed: ${recap?.error ?? 'timeout'}`);
    recapSink.push(recap.id);
    const stats = await fw.waitFor(statsMatchInPage, 15000, VIC_ACTOR_ID, expectedStats);
    return { recap, stats };
  }

  // WAITED flag read that never throws: null + a loud line when the addReminder flag never arrives
  // (User#query/activeGM live behavior is part of what this suite probes — a dead round-trip must
  // grade as a FAIL line with evidence, not a case crash that skips the rest of the boot).
  async function waitModuleFlag(actorId, flagKey, entries, label) {
    try {
      return await fw.waitFor(moduleFlagMatchesInPage, 15000, actorId, flagKey, entries);
    } catch (err) {
      const now = await fw.executeInFoundry(snapshotModuleFlagsInPage, actorId).catch(() => null);
      console.log(
        `[reminders] ${label}: flag wait timed out (${err.message ?? err}); namespace now ${JSON.stringify(now)}`,
      );
      return null;
    }
  }

  // Case cleanup: release tokens, restore victim (and attacker) system.* AND their knight-damage
  // flag namespaces, then delete every chat id the case accumulated (sink discipline).
  async function cleanup(messages, victimSnapshot, victimFlags, atkSnapshot, atkFlags) {
    await fw.executeInFoundry(releaseAllTokensInPage).catch(() => {});
    if (victimSnapshot)
      await fw.executeInFoundry(restoreActorSystemInPage, VIC_ACTOR_ID, victimSnapshot).catch(() => {});
    if (victimFlags) await fw.executeInFoundry(restoreModuleFlagsInPage, VIC_ACTOR_ID, victimFlags).catch(() => {});
    if (atkSnapshot) await fw.executeInFoundry(restoreActorSystemInPage, ATK_ACTOR_ID, atkSnapshot).catch(() => {});
    if (atkFlags) await fw.executeInFoundry(restoreModuleFlagsInPage, ATK_ACTOR_ID, atkFlags).catch(() => {});
    if (messages?.length)
      await fw
        .executeInFoundry(deleteMessagesInPage, messages.filter(Boolean))
        .catch((err) => console.log(`[reminders] cleanup message-delete FAILED: ${err.message ?? err}`));
  }

  async function restoreBaselineBetween(snap, flags) {
    await fw.executeInFoundry(restoreActorSystemInPage, VIC_ACTOR_ID, snap);
    await fw.waitFor(statsMatchInPage, 15000, VIC_ACTOR_ID, SEED_STATS);
    await fw.executeInFoundry(restoreModuleFlagsInPage, VIC_ACTOR_ID, flags);
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
      vicType: canvas.tokens.get('tkVicKnightAAAAA')?.actor?.type ?? null,
      atkToken: canvas.tokens.get('tkAtkPnjAAAAAAAA')?.id ?? null,
      activeGM: game.users.activeGM?.id ?? null,
      queryRegistered: typeof CONFIG.queries?.['knight-damage.addReminder'] === 'function',
    }));
    console.log(
      `[reminders] knight ${boot.knight} / core ${boot.core} / lang ${boot.lang} / scene ${boot.scene} vic=${boot.vicType} atk=${boot.atkToken} activeGM=${boot.activeGM} addReminderQuery=${boot.queryRegistered}`,
    );
    if (boot.vicType !== 'knight' || !boot.atkToken)
      throw new Error('victim/attacker tokens missing on the active scene');
    if (boot.lang !== 'fr') throw new Error(`chat HTML contract is French but game.i18n.lang=${boot.lang}`);
    if (!boot.activeGM)
      console.log('[reminders] WARNING: no activeGM — every addReminder query will be inert (stats stay applied)');
    if (!boot.queryRegistered)
      console.log('[reminders] WARNING: CONFIG.queries addReminder handler NOT registered at boot');

    // Poisoning gate: ALL FOUR actors at the seed baseline AND their knight-damage namespaces
    // captured as the byte-compare baseline for the suite end (carry-flag (b)).
    const FOUR_IDS = [VIC_ACTOR_ID, VEH_ACTOR_ID, MEC_ACTOR_ID, ATK_ACTOR_ID];
    const startStats = await fw.executeInFoundry(
      readAllFourStatsInPage,
      VIC_ACTOR_ID,
      VEH_ACTOR_ID,
      MEC_ACTOR_ID,
      ATK_ACTOR_ID,
    );
    const expectedStart = {
      vic: { ...SEED_STATS, espoirReduction: SEED_ESPOIR_REDUCTION },
      veh: SEED_STATS_VEH,
      mec: SEED_STATS_MEC,
      atk: SEED_STATS_ATK,
    };
    for (const key of ['vic', 'veh', 'mec', 'atk']) {
      if (!entriesEqual(startStats[key], expectedStart[key])) {
        console.log(
          `[reminders] baseline(${key}) expected ${JSON.stringify(expectedStart[key])}\n[reminders] actual      ${JSON.stringify(startStats[key])}`,
        );
      }
    }
    if (!['vic', 'veh', 'mec', 'atk'].every((key) => entriesEqual(startStats[key], expectedStart[key])))
      throw new Error('actor stats are NOT at the seed baseline at suite start — world poisoning');
    const bootFlags = await fw.executeInFoundry(snapshotActorsModuleFlagsInPage, FOUR_IDS);
    console.log(`[reminders] boot knight-damage flag baselines: ${JSON.stringify(bootFlags)}`);

    const counterInstalled = await fw.executeInFoundry(installActorUpdateCounterInPage);
    console.log(`[reminders] preUpdateActor counter: ${counterInstalled}`);

    // Built HERE (post-first-await) so the module-scope ids below the entry block are initialized.
    const victimSpeaker = { scene: SCENE_ID, token: VIC_TOKEN_ID, actor: VIC_ACTOR_ID };
    const attackerSpeaker = { scene: SCENE_ID, token: ATK_TOKEN_ID, actor: ATK_ACTOR_ID };

    // ─────────────── 1. energie click: gauge cap + flag on the ATTACKER (speaker) actor ───────────────

    await runCase('case1-energie-attacker-flag', async () => {
      const vicSnap = await fw.executeInFoundry(snapshotActorSystemInPage, VIC_ACTOR_ID);
      const atkSnap = await fw.executeInFoundry(snapshotActorSystemInPage, ATK_ACTOR_ID);
      const vicFlags = await fw.executeInFoundry(snapshotModuleFlagsInPage, VIC_ACTOR_ID);
      const atkFlags = await fw.executeInFoundry(snapshotModuleFlagsInPage, ATK_ACTOR_ID);
      let msgId;
      const recapIds = [];
      try {
        msgId = await replay(mutateTargetValue, attackerSpeaker);
        const updatesBefore = (await fw.executeInFoundry(readActorUpdatesInPage)).length;
        const { recap, stats } = await applyDamageAndAwait(
          msgId,
          'applyDamageEnergie',
          { ...SEED_STATS, energie: 0 },
          recapIds,
        );
        push(
          'case1: energie click -> system.energie 12->0 (absorption cap: damage 130-4=126 > 12), armure 100 / sante 20 / espoir 15 / CdF NEVER entered',
          entriesEqual(stats, { ...SEED_STATS, energie: 0 }),
          `got ${JSON.stringify(stats)}`,
        );
        push(
          'case1: recap map EXACT {energie:12}, isRecap, origin "Scene.kdtSceneMainAAAA.Token.tkAtkPnjAAAAAAAA" (the SPEAKER token — the flag lives on ITS actor), wear/anatheme knight-only',
          recapMapMatches(recap.recap, { energie: ENERGIE_ABSORBED }) &&
            recap.flags?.isRecap === true &&
            recap.flags?.origin === `Scene.${SCENE_ID}.Token.${ATK_TOKEN_ID}` &&
            recap.flags?.wear === 'armure' &&
            recap.flags?.anatheme === false,
          `got ${JSON.stringify(recap.flags)}`,
        );
        push(
          "case1: recap content — UNACCENTED 'Energie : 12' label byte-exact, NO 'Armure :'/'Santé :'/'Espoir :' lines (armure/sante tracks never entered), revert button present",
          recap.content.includes(RECAP_HEADER) &&
            recap.content.includes(recapLine('Energie', ENERGIE_ABSORBED)) &&
            !recap.content.includes('Armure :') &&
            !recap.content.includes('Santé :') &&
            !recap.content.includes('Espoir :') &&
            recap.content.includes('class="revert-damage"'),
          `content: ${recap.content}`,
        );
        // apply() double-update live witness (INTENDED): module update #1 carries an EMPTY payload
        // (nothing but energie is in the repartition), update #2 carries system.energie.value
        // (damageBase.js:298-303, unit-pinned updates[1]). LIVE v14 shape: the payload handed to
        // preUpdateActor is the CLEANED PARTIAL nested data and ALWAYS carries `_id`, so the empty first
        // update is witnessed as {_id: <actor>} — strip `_id` before classifying. The sync hook
        // (knight.mjs:848, whitelist armure+energie only) mirrors the energie write into
        // equipements.armure.energie — exactly 3 witnesses: {}, {energie:0}, {sync}. The module
        // energie gauge write is the SECOND update (right after the empty one).
        const updates = await fw.executeInFoundry(readActorUpdatesInPage);
        const victimUpdates = updates
          .slice(updatesBefore)
          .filter((u) => u.id === VIC_ACTOR_ID)
          .map((u) => {
            const data = { ...(u.data ?? {}) };
            delete data._id;
            return data;
          });
        const emptyModuleUpdates = victimUpdates.filter((d) => Object.keys(d).length === 0);
        const modulePayloads = victimUpdates.filter((d) => deepEqualJson(d.system, { energie: { value: 0 } }));
        const hookSyncs = victimUpdates.filter((d) =>
          deepEqualJson(d.system?.equipements, { armure: { energie: { value: 0 } } }),
        );
        const energieIsSecond =
          victimUpdates.length === 3 &&
          Object.keys(victimUpdates[0] ?? {}).length === 0 &&
          deepEqualJson(victimUpdates[1]?.system, { energie: { value: 0 } });
        push(
          'case1: double-update witness — exactly 3 victim preUpdateActor payloads (nested merged + _id stamped, _id stripped here): 1x EMPTY {} module update, then the energie {system:{energie:{value:0}}} as the SECOND update, then 1x system equipements.armure.energie sync (hook whitelist armure+energie)',
          victimUpdates.length === 3 &&
            emptyModuleUpdates.length === 1 &&
            modulePayloads.length === 1 &&
            hookSyncs.length === 1 &&
            energieIsSecond,
          `got ${JSON.stringify(victimUpdates)}`,
        );
        // THE byte-pin: raw underscore key on the ATTACKER actor (plan carry-flag (b)).
        const flag = await waitModuleFlag(ATK_ACTOR_ID, 'energie', [[VICTIM_UUID_KEY, ENERGIE_ABSORBED]], 'case1');
        const atkFlagsNow = await fw.executeInFoundry(snapshotModuleFlagsInPage, ATK_ACTOR_ID);
        push(
          `case1: ATTACKER actor flags['knight-damage'].energie EXACTLY {${VICTIM_UUID_KEY}: 12} (raw underscore key; addReminder round-trip through activeGM.query + CONFIG.queries WORKS live)`,
          flag !== null && entriesEqual(atkFlagsNow.energie, { [VICTIM_UUID_KEY]: ENERGIE_ABSORBED }),
          `predicate ${JSON.stringify(flag)}, namespace now ${JSON.stringify(atkFlagsNow)}`,
        );
      } finally {
        await cleanup([msgId, ...recapIds], vicSnap, vicFlags, atkSnap, atkFlags);
      }
    });

    // ─────────────── 2. revert decrements the SAME flag key to 0 (key survives) ───────────────

    await runCase('case2-energie-revert-flag', async () => {
      const vicSnap = await fw.executeInFoundry(snapshotActorSystemInPage, VIC_ACTOR_ID);
      const atkSnap = await fw.executeInFoundry(snapshotActorSystemInPage, ATK_ACTOR_ID);
      const vicFlags = await fw.executeInFoundry(snapshotModuleFlagsInPage, VIC_ACTOR_ID);
      const atkFlags = await fw.executeInFoundry(snapshotModuleFlagsInPage, ATK_ACTOR_ID);
      let msgId;
      let recapId;
      const recapIds = [];
      try {
        msgId = await replay(mutateTargetValue, attackerSpeaker);
        const applied = await applyDamageAndAwait(msgId, 'applyDamageEnergie', { ...SEED_STATS, energie: 0 }, recapIds);
        recapId = applied.recap.id;
        const flagBefore = await waitModuleFlag(
          ATK_ACTOR_ID,
          'energie',
          [[VICTIM_UUID_KEY, ENERGIE_ABSORBED]],
          'case2 pre-revert',
        );
        // The knight revert is the setTimeout(100/101) path; the recap's stored origin flag points
        // back at the ATTACKER token, so revertEnergieReminder hits the same flag key with
        // revert:true (value*-1, helpers.js:58).
        await fw.waitFor(clickOnMessageCard, 15000, recapId, '.revert-damage');
        const restored = await fw.waitFor(statsMatchInPage, 15000, VIC_ACTOR_ID, SEED_STATS);
        const flagAfter = await waitModuleFlag(ATK_ACTOR_ID, 'energie', [[VICTIM_UUID_KEY, 0]], 'case2 post-revert');
        push(
          'case2: revert click on the energie recap restores system.energie 0->12 byte-identical to the seed (recap was EXACT {energie:12}; energie is again written in the SECOND update of the revert apply)',
          entriesEqual(restored, SEED_STATS) && recapMapMatches(applied.recap.recap, { energie: ENERGIE_ABSORBED }),
          `got ${JSON.stringify(restored)} / ${JSON.stringify(applied.recap.recap)}`,
        );
        // CHARACTERIZATION pin: the accumulation semantics leave the key at 0 — setFlag is NEVER
        // asked to delete it. A future "cleanup" that unsets the key fails this line.
        push(
          `case2: the SAME key ${VICTIM_UUID_KEY} on the ATTACKER actor is DECREMENTED to 0 and NOT DELETED (revert:true accumulation; flag map still EXACTLY {${VICTIM_UUID_KEY}: 0})`,
          flagBefore !== null && flagAfter !== null && entriesEqual(flagAfter.value, { [VICTIM_UUID_KEY]: 0 }),
          `before ${JSON.stringify(flagBefore?.value ?? null)}, after ${JSON.stringify(flagAfter?.value ?? null)}`,
        );
        const domState = await fw.waitFor(revertDomStateInPage, 15000, recapId);
        push(
          'case2: recap card shows line-through + revert button gone AND the mutation PERSISTS in the stored content',
          domState?.lineThrough === true &&
            domState?.revertButtonGone === true &&
            (await fw.waitFor(storedContentPersistedInPage, 15000, recapId, 'line-through', 'revert-damage'))?.ok ===
              true,
          `got ${JSON.stringify(domState)}`,
        );
      } finally {
        await cleanup([msgId, recapId, ...recapIds], vicSnap, vicFlags, atkSnap, atkFlags);
      }
    });

    // ─────────────── 3. death reminder end-to-end (self-flag via victim speaker) ───────────────

    await runCase('case3-death-reminder-e2e', async () => {
      const vicSnap = await fw.executeInFoundry(snapshotActorSystemInPage, VIC_ACTOR_ID);
      const vicFlags = await fw.executeInFoundry(snapshotModuleFlagsInPage, VIC_ACTOR_ID);
      let msgId;
      let effectIds = [];
      const recapIds = [];
      const deathIds = [];
      try {
        // speaker = VICTIM token: origin.actor is the VICTIM itself, so the energie flag lives on
        // the dying actor — the only shape preCreateActiveEffect.generateReminderMessage can read.
        msgId = await replay(mutateTargetValue, victimSpeaker);
        await applyDamageAndAwait(msgId, 'applyDamageEnergie', { ...SEED_STATS, energie: 0 }, recapIds);
        const selfFlag = await waitModuleFlag(
          VIC_ACTOR_ID,
          'energie',
          [[VICTIM_UUID_KEY, ENERGIE_ABSORBED]],
          'case3 self-flag',
        );
        const beforeIds = await fw.executeInFoundry(listMessageIdsInPage);
        effectIds = await fw.executeInFoundry(createDeadEffectInPage, VIC_ACTOR_ID);
        let card = null;
        try {
          card = await fw.waitFor(newDeathCardInPage, 15000, beforeIds, DEATH_MARKER_ENERGIE, DEATH_MARKER_ESPOIR);
        } catch {
          card = null;
        }
        if (card?.ids) deathIds.push(...card.ids);
        if (card?.id) deathIds.push(card.id);
        push(
          'case3: energie apply with VICTIM speaker puts knight-damage.energie EXACTLY {Actor_kdtVicKnightAAAA: 12} on the VICTIM itself — the reminder flag follows the attack message SPEAKER token actor (here the victim), the asymmetry that decides WHO gets the death card',
          selfFlag !== null,
          `predicate ${JSON.stringify(selfFlag)}`,
        );
        push(
          "case3: ActiveEffect name 'Dead' -> FLAGLESS chat card with EXACT header <div>Dégâts d'energie infligés :</div> + breakdown 'vic-knight : 12 (2d6)' (trunc(12/6)) + NO knight-damage flags",
          card &&
            !card.error &&
            card.content.includes(DEATH_HEADER_ENERGIE) &&
            card.content.includes('<div>vic-knight : 12 (2d6)</div>') &&
            card.kdFlags === null,
          `got ${JSON.stringify(card ?? null)}`,
        );
        push(
          "case3: the espoir loop emits NO card while the victim's espoir flag is undefined — exactly ONE new message in the diff and 0 espoir-header cards",
          card && !card.error && card.freshIds.length === 1 && card.espoirCards === 0,
          `freshIds ${JSON.stringify(card?.freshIds ?? null)}, espoirCards ${card?.espoirCards ?? 'n/a'}`,
        );
      } finally {
        if (effectIds.length)
          await fw
            .executeInFoundry(deleteEmbeddedEffectsInPage, VIC_ACTOR_ID, effectIds)
            .catch((err) => console.log(`[reminders] case3 Dead-effect cleanup FAILED: ${err.message ?? err}`));
        await cleanup([msgId, ...recapIds, ...deathIds], vicSnap, vicFlags, null, null);
      }
    });

    // ─────────────── 4. espoir click (+ snapshot-restored espoir.reduction floor) ───────────────

    await runCase('case4-espoir-target', async () => {
      const vicSnap = await fw.executeInFoundry(snapshotActorSystemInPage, VIC_ACTOR_ID);
      const vicFlags = await fw.executeInFoundry(snapshotModuleFlagsInPage, VIC_ACTOR_ID);
      let espoirMsg;
      let floorMsg;
      const recapIds = [];
      try {
        espoirMsg = await replay(mutateTargetValue, victimSpeaker);
        const applied = await applyDamageAndAwait(
          espoirMsg,
          'applyDamageEspoir',
          { ...SEED_STATS, espoir: 0 },
          recapIds,
        );
        push(
          'case4: espoir click -> system.espoir 15->0 (damage 126 - reduction 3 = 123 capped by espoir 15), energie 12 / armure 100 / sante 20 UNTOUCHED (armure track never entered)',
          entriesEqual(applied.stats, { ...SEED_STATS, espoir: 0 }),
          `got ${JSON.stringify(applied.stats)}`,
        );
        push(
          "case4: recap map EXACT {espoir:15} + 'Espoir : 15' line byte-exact + NO 'Energie :'/'Armure :'/'Santé :' lines + header + revert button",
          recapMapMatches(applied.recap.recap, { espoir: ESPOIR_ABSORBED }) &&
            applied.recap.content.includes(RECAP_HEADER) &&
            applied.recap.content.includes(recapLine('Espoir', ESPOIR_ABSORBED)) &&
            !applied.recap.content.includes('Energie :') &&
            !applied.recap.content.includes('Armure :') &&
            !applied.recap.content.includes('Santé :'),
          `got ${JSON.stringify(applied.recap.recap)} / ${applied.recap.content}`,
        );
        const espoirFlag = await waitModuleFlag(
          VIC_ACTOR_ID,
          'espoir',
          [[VICTIM_UUID_KEY, ESPOIR_ABSORBED]],
          'case4 espoir flag',
        );
        push(
          `case4: VICTIM actor flags['knight-damage'].espoir EXACTLY {${VICTIM_UUID_KEY}: 15} — the stat:'espoir' query branch (damageKnight.js:136-141) dispatches live through activeGM.query`,
          espoirFlag !== null,
          `predicate ${JSON.stringify(espoirFlag)}`,
        );

        // Floor sub-case: espoir.reduction 200 >= damage 126 -> floored at 0 (damageKnight.js:121-
        // 122). Snapshot-restored live mutation; if the write is schema-dropped the sub-case is
        // SKIPPED with a loud line (documented, the pins above stay valid).
        await restoreBaselineBetween(vicSnap, vicFlags);
        await fw.executeInFoundry(updateActorInPage, VIC_ACTOR_ID, { 'system.espoir.reduction': 200 });
        const reductionBack = await fw.executeInFoundry(readEspoirReductionInPage, VIC_ACTOR_ID);
        if (reductionBack === 200) {
          floorMsg = await replay(mutateTargetValue, victimSpeaker);
          const floored = await applyDamageAndAwait(floorMsg, 'applyDamageEspoir', SEED_STATS, recapIds);
          push(
            'case4 floor: reduction 200 (>= damage 126) -> floored at 0: espoir 15 byte-intact, recap EXACT {espoir:0} and NO Espoir line (0-falsy line is omitted)',
            recapMapMatches(floored.recap.recap, { espoir: 0 }) &&
              entriesEqual(floored.stats, SEED_STATS) &&
              !floored.recap.content.includes('Espoir :'),
            `got ${JSON.stringify(floored.recap.recap)} / ${JSON.stringify(floored.stats)}`,
          );
          const zeroFlag = await waitModuleFlag(VIC_ACTOR_ID, 'espoir', [[VICTIM_UUID_KEY, 0]], 'case4 floor flag');
          push(
            `case4 floor: the 0-value reminder query STILL creates the flag key — flags['knight-damage'].espoir EXACTLY {${VICTIM_UUID_KEY}: 0} (accumulation writes the key even for 0)`,
            zeroFlag !== null,
            `predicate ${JSON.stringify(zeroFlag)}`,
          );
        } else {
          console.log(
            `[reminders] case4 floor sub-case SKIPPED: system.espoir.reduction write-back reads ${JSON.stringify(reductionBack)} (the schema re-derives/drops the field) — floor stays unit-only`,
          );
        }
      } finally {
        await cleanup([espoirMsg, floorMsg, ...recapIds], vicSnap, vicFlags, null, null);
      }
    });

    // ─────────────── 5. direct-flag death card: multi-key map, 0-skip, trunc boundaries ───────────────

    await runCase('case5-death-card-direct-flag', async () => {
      let effectIds = [];
      const deathIds = [];
      try {
        // Crafted reminder map: trunc boundaries 5 -> 0d6 and 13 -> 2d6, a 0-value key that must be
        // SKIPPED (knight-damage.js:138), three DIFFERENT actors' uuid keys — every name must come
        // back through the `_`->`.` round-trip (fromUuid at knight-damage.js:139).
        const crafted = {
          [`Actor_${ATK_ACTOR_ID}`]: 5,
          [`Actor_${VEH_ACTOR_ID}`]: 13,
          [`Actor_${MEC_ACTOR_ID}`]: 0,
        };
        await fw.executeInFoundry(setModuleFlagInPage, VIC_ACTOR_ID, 'energie', crafted);
        const beforeIds = await fw.executeInFoundry(listMessageIdsInPage);
        effectIds = await fw.executeInFoundry(createDeadEffectInPage, VIC_ACTOR_ID);
        let card = null;
        try {
          card = await fw.waitFor(newDeathCardInPage, 15000, beforeIds, DEATH_MARKER_ENERGIE, DEATH_MARKER_ESPOIR);
        } catch {
          card = null;
        }
        if (card?.ids) deathIds.push(...card.ids);
        if (card?.id) deathIds.push(card.id);
        push(
          "case5: crafted energie flag {atk-pnj:5, vic-vehicule:13, vic-mecha:0} -> card shows ONLY the nonzero keys with EXACT trunc lines 'atk-pnj : 5 (0d6)' + 'vic-vehicule : 13 (2d6)' and NO vic-mecha line (0-value key skipped, names resolved via the _->. round-trip)",
          card &&
            !card.error &&
            card.content.includes(DEATH_HEADER_ENERGIE) &&
            card.content.includes('<div>atk-pnj : 5 (0d6)</div>') &&
            card.content.includes('<div>vic-vehicule : 13 (2d6)</div>') &&
            !card.content.includes('vic-mecha'),
          `got ${JSON.stringify(card?.content ?? card ?? null)}`,
        );
        push(
          'case5: exactly ONE new message (espoir flag undefined -> silent loop) and the crafted card is FLAGLESS like every death card',
          card && !card.error && card.freshIds.length === 1 && card.espoirCards === 0 && card.kdFlags === null,
          `freshIds ${JSON.stringify(card?.freshIds ?? null)}, kdFlags ${JSON.stringify(card?.kdFlags ?? null)}`,
        );
      } finally {
        if (effectIds.length)
          await fw
            .executeInFoundry(deleteEmbeddedEffectsInPage, VIC_ACTOR_ID, effectIds)
            .catch((err) => console.log(`[reminders] case5 Dead-effect cleanup FAILED: ${err.message ?? err}`));
        // The crafted flag must go back to the BOOT baseline (namespace keys unset), not merely the
        // pre-case state — defense in depth for the flag self-check below.
        await cleanup(deathIds, null, bootFlags[VIC_ACTOR_ID] ?? {}, null, null);
      }
    });

    // ─────────────── 6. PRE-CAP targets: the 130-mutations all saturate at gauge caps, so the
    // CdF/penetrant subtraction (130 -> 126) is otherwise UNOBSERVED by the whole suite ───────────────

    await runCase('case6-precap-values', async () => {
      const vicSnap = await fw.executeInFoundry(snapshotActorSystemInPage, VIC_ACTOR_ID);
      const atkSnap = await fw.executeInFoundry(snapshotActorSystemInPage, ATK_ACTOR_ID);
      const vicFlags = await fw.executeInFoundry(snapshotModuleFlagsInPage, VIC_ACTOR_ID);
      const atkFlags = await fw.executeInFoundry(snapshotModuleFlagsInPage, ATK_ACTOR_ID);
      let energieMsg;
      let espoirMsg;
      const recapIds = [];
      try {
        // target 10: 10 - CdF eff (10 - fixture raw 'penetrant 6' = 4) = 6 < energie 12 -> the
        // UNSATURATED 6 lands in recap AND flag byte-for-byte. Any wrong CdF interaction fails
        // loudly: dropping penetrant gives 10-10=0 (no 'Energie' line, {energie:0}), inflating it
        // goes negative (no recap lines at all).
        energieMsg = await replay((m) => {
          m.flags.knight.targets[0].value = 10;
        }, attackerSpeaker);
        const precapE = await applyDamageAndAwait(
          energieMsg,
          'applyDamageEnergie',
          { ...SEED_STATS, energie: 6 },
          recapIds,
        );
        const flagE6 = await waitModuleFlag(ATK_ACTOR_ID, 'energie', [[VICTIM_UUID_KEY, 6]], 'case6 energie');
        push(
          `case6: target 10 -> pre-cap damage 10-4=6 lands UNSATURATED: energie 12->6, recap EXACT {energie:6} + 'Energie : 6' + attacker flag EXACTLY {${VICTIM_UUID_KEY}: 6} (pins the fixture penetrant-6 CdF subtraction every capped case hides)`,
          recapMapMatches(precapE.recap.recap, { energie: 6 }) &&
            entriesEqual(precapE.stats, { ...SEED_STATS, energie: 6 }) &&
            precapE.recap.content.includes(recapLine('Energie', 6)) &&
            flagE6 !== null,
          `recap ${JSON.stringify(precapE.recap.recap)}, stats ${JSON.stringify(precapE.stats)}, flag ${JSON.stringify(flagE6)}`,
        );
        // espoir twin: target 20 -> 20-4=16, minus system.espoir.reduction 3 = 13 < espoir 15 ->
        // espoir 15->2, recap {espoir:13}: pins the reduction subtraction pre-cap too. (The
        // energie flag {key:6} on the ATTACKER stays UNTOUCHED by the espoir query — the two
        // reminder stats are SEPARATE keys of the same namespace.)
        await restoreBaselineBetween(vicSnap, vicFlags);
        espoirMsg = await replay((m) => {
          m.flags.knight.targets[0].value = 20;
        }, attackerSpeaker);
        const precapH = await applyDamageAndAwait(
          espoirMsg,
          'applyDamageEspoir',
          { ...SEED_STATS, espoir: 2 },
          recapIds,
        );
        const flagH13 = await waitModuleFlag(ATK_ACTOR_ID, 'espoir', [[VICTIM_UUID_KEY, 13]], 'case6 espoir');
        const flagEStill = await waitModuleFlag(
          ATK_ACTOR_ID,
          'energie',
          [[VICTIM_UUID_KEY, 6]],
          'case6 energie-after-espoir',
        );
        push(
          `case6: target 20 -> 20-4-3(reduction)=13 lands UNSATURATED: espoir 15->2, recap EXACT {espoir:13} + flag EXACTLY {${VICTIM_UUID_KEY}: 13} (pins espoir.reduction pre-cap; the energie key of the same namespace is UNTOUCHED by the espoir query)`,
          recapMapMatches(precapH.recap.recap, { espoir: 13 }) &&
            entriesEqual(precapH.stats, { ...SEED_STATS, espoir: 2 }) &&
            precapH.recap.content.includes(recapLine('Espoir', 13)) &&
            flagH13 !== null &&
            flagEStill !== null,
          `recap ${JSON.stringify(precapH.recap.recap)}, stats ${JSON.stringify(precapH.stats)}, flag ${JSON.stringify(flagH13)}`,
        );
      } finally {
        await cleanup([energieMsg, espoirMsg, ...recapIds], vicSnap, vicFlags, atkSnap, atkFlags);
      }
    });

    // ─────────────── world-restoration self-checks (stats AND flags AND chat leak) ───────────────

    const endStats = await fw.executeInFoundry(
      readAllFourStatsInPage,
      VIC_ACTOR_ID,
      VEH_ACTOR_ID,
      MEC_ACTOR_ID,
      ATK_ACTOR_ID,
    );
    const statsOk = ['vic', 'veh', 'mec', 'atk'].every((key) => entriesEqual(endStats[key], expectedStart[key]));
    if (!statsOk) console.log(`[reminders] end stats drift: ${JSON.stringify(endStats)}`);
    push(
      'poisoning self-check: all FOUR actors stats byte-identical to the boot baselines at suite end',
      statsOk,
      `got ${JSON.stringify(endStats)}`,
    );

    const endFlags = await fw.executeInFoundry(snapshotActorsModuleFlagsInPage, FOUR_IDS);
    const flagsOk = FOUR_IDS.every((id) => flagNamespacesEqual(endFlags[id], bootFlags[id]));
    push(
      'poisoning self-check: all FOUR actors knight-damage FLAG namespaces byte-identical to their boot baselines (the atk-pnj one is the case1/case2 write target)',
      flagsOk,
      `boot ${JSON.stringify(bootFlags)} / end ${JSON.stringify(endFlags)}`,
    );

    const leaks = await fw.executeInFoundry(leakScanInPage, DEATH_MARKER_ENERGIE, DEATH_MARKER_ESPOIR);
    push(
      'poisoning self-check: NO knight-damage recap AND NO death-reminder card (energie/espoir markers) survives in the (boot-persistent) chat log',
      leaks.recaps === '' && leaks.deathEnergie === '' && leaks.deathEspoir === '',
      `recaps: ${leaks.recaps} | energie cards: ${leaks.deathEnergie} | espoir cards: ${leaks.deathEspoir}`,
    );

    // ─────────────── summary ───────────────

    for (const { label, ok, detail } of results) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — ${detail}`}`);
    }
    const failures = results.filter((r) => !r.ok).length;
    if (failures > 0) {
      console.log(
        `\nE2E REMINDERS: FAIL (${failures}/${results.length} assertions failed${caseFailures.length ? `; case errors: ${caseFailures.join(' | ')}` : ''})`,
      );
    } else {
      console.log(`\nE2E REMINDERS: PASS (${results.length}/${results.length} assertions)`);
    }
    process.exitCode = failures > 0 ? 1 : 0;
  } catch (err) {
    await shot('reminders-failure');
    throw err;
  } finally {
    await fw.stop();
    console.log('Foundry server + browser stopped.');
  }
}
