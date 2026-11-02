// E2E vehicule/mecha damage pipeline (Phase 4 of docs/testing-plan.md): `npm run test:e2e:vehicule-mecha`
// AFTER `npm run prepare:e2e && npm run setup:e2e` (and at least one recorded fixture pair).
//
// Coverage (the plan's Phase-4 scope, against the LIVE world with the RECORDED standard fixture
// replayed under mutation — the fixture JSONs themselves are NEVER touched):
//  1. vehicule NORMAL apply: the ALWAYS-ON /10 colosse (damage 130 -> 13), the armure track, the
//     passenger carry /5 (recap-only), recap flags+labels ('Armure', never 'Blindage'), and the
//     INTENDED flagless passenger card;
//  2. vehicule 'antivehicule' raw-mutate: defeats the /10 — the same 130 now lands 130 (30 absorbed,
//     passenger 6): the with/without difference IS the colosse pin;
//  3. mechaarmure NORMAL: the blindage track + 'Blindage' recap label (mecha-only) + the pilot
//     side-card twin; LIVE update payload pins the field name (system.blindage.value) and proves
//     sante is NEVER written by the live mecha flow (the apply() cohesion->sante mapping,
//     damageBase.js:288, is dead for every live class — documented, source NOT modified);
//  4. mecha colosse off-switches: resilience.value 0 (victim-stat mutate, snapshot-restore) AND
//     raw 'antivehicule' — both give the colosse-off numbers at the SAME 130 target;
//  5. vehicule Demi (ceil then /10) and Double multipliers;
//  6. revert on BOTH recap types: .revert-damage restores the gauge stat (base DamageBase path —
//     NO knight setTimeout(100/101)), line-through + revert-gone + PERSISTED content; the
//     passenger/pilote damage was never a document write so revert touches only the gauge;
//  7. NEGATIVE dispatch: a 'pnj'-typed controlled token -> createDamageObject returns false
//     (knight-damage.js:357) — no damage application, no recap.
//
// Oracle: the author-validated unit suite tests/unit/damage-vehicule-mecha.test.mjs (colosse gates,
// /10, tranche-5 vehicule vs tranche-10 mecha carry, passenger-NaN, apply() double update) combined
// with the LIVE seed stats PROBED at boot (vehicule armure 30 / CdF 0 / energie 12 / sante 10;
// mecha blindage 30 / resilience 3 / CdF 0 / energie 12 / sante 20) — never the unit doubles' values.
//
// Discipline (mandatory plan rules): every chat access message-id-pinned; recap AND side-card ids
// enter the cleanup sink the MOMENT they are discovered; every case snapshots + restores the victim
// system.*; the suite-end self-checks prove no recap and no passenger/pilote card leak into the
// boot-persistent chat log; re-runnable back-to-back WITHOUT setup:e2e.

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
  readActorUpdatesInPage,
  releaseAllTokensInPage,
  restoreActorSystemInPage,
  snapshotActorSystemInPage,
  updateActorInPage,
} from './support/actor-pages.mjs';
import { replayFixture } from './support/replay.mjs';
import { deepEqualJson, entriesEqual as statsEqual, recapMapMatches } from './support/compare.mjs';

/* global process */

if (respawnPreservingSymlinks()) {
  // Parent: the symlink-preserving child inherited stdio and carries the run.
} else {
  const Framework = await loadFramework();
  main(Framework).catch((err) => {
    console.error(`\nE2E VEHICULE-MECHA FAIL: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });
}

const SCENE_ID = 'kdtSceneMainAAAA';
const VEH_ACTOR_ID = 'kdtVicVehiculeAA';
const VEH_TOKEN_ID = 'tkVicVehiculeAAA';
const MEC_ACTOR_ID = 'kdtVicMechaAAAAA';
const MEC_TOKEN_ID = 'tkVicMechaAAAAAA';
const ATK_ACTOR_ID = 'kdtAtkPnjAAAAAAA'; // the recorded attacker AND the case7 'pnj' dispatch victim
const ATK_TOKEN_ID = 'tkAtkPnjAAAAAAAA';

// LIVE stats read at boot (probe-verified against the seed rows under tests/e2e/world-seed/):
// vehicule has NO resilience (its colosse /10 is type-gated, isColosseApplied() ALWAYS true unless
// antivehicule); mecha resilience 3 keeps colosse on; sante is seed-pinned for both because the
// passenger/pilote repartition key is NEVER mapped to an actor field by apply().
const SEED_STATS_VEH = { armure: 30, cdf: 0, energie: 12, sante: 10 };
const SEED_STATS_MEC = { blindage: 30, cdf: 0, energie: 12, resilience: 3, sante: 20 };
const SEED_STATS_ATK = { sante: 10, armure: 0, energie: 12 };

// RECAP LABEL CONTRACT (damageBase.js:307-347): header + one `<div>${label} : ${value}</div>` per
// TRUTHY repartition key, labels Energie/Armure/Blindage/Guardian/Santé/Cohésion/Espoir — 'Blindage'
// is MECHA-only (the vehicule track is armure), and 'passenger' has NO label at all: the carry lands
// in the SECOND, flagless card — damageVehicule.js:55-72 'Dégâts sur les passagers :' and
// damageMecha.js:47-64 'Dégâts sur le pilote :'.
const RECAP_HEADER = 'Récapitulatif des dégâts';
const recapLine = (label, value) => `<div>${label} : ${value}</div>`;
const SIDE_MARKER_VEH = 'Dégâts sur les passagers :';
const SIDE_MARKER_MEC = 'Dégâts sur le pilote :';

// ── Page-context helpers (stringify rule: no closures; values come in as trailing args) ──
// Generic page helpers (snapshot/restore/update, control/release, update counter, replay create)
// live in support/actor-pages.mjs — shared with the knight damage suite so the cleanup and
// orphan-handling discipline is fixed in ONE place. Only the type-specific stat readers stay here.

const readVehStatsInPage = (actorId) => {
  const s = game.actors.get(actorId).system;
  return { armure: s.armure.value, cdf: s.champDeForce.value, energie: s.energie.value, sante: s.sante.value };
};

const readMechaStatsInPage = (actorId) => {
  const s = game.actors.get(actorId).system;
  return {
    blindage: s.blindage.value,
    cdf: s.champDeForce.value,
    energie: s.energie.value,
    resilience: s.resilience.value,
    sante: s.sante.value,
  };
};

// waitFor predicates: every expected stat already matches (plain objects only; the reads are
// INLINED — a page function cannot close over readVehStatsInPage/readMechaStatsInPage).
const vehStatsMatchInPage = (actorId, expected) => {
  const s = game.actors.get(actorId).system;
  const got = { armure: s.armure.value, cdf: s.champDeForce.value, energie: s.energie.value, sante: s.sante.value };
  for (const [key, value] of Object.entries(expected)) if (got[key] !== value) return null;
  return got;
};

const mechaStatsMatchInPage = (actorId, expected) => {
  const s = game.actors.get(actorId).system;
  const got = {
    blindage: s.blindage.value,
    cdf: s.champDeForce.value,
    energie: s.energie.value,
    resilience: s.resilience.value,
    sante: s.sante.value,
  };
  for (const [key, value] of Object.entries(expected)) if (got[key] !== value) return null;
  return got;
};

// Pinned discovery of the SECOND (flagless) passenger/pilote card of an application — the INTENDED
// author design (damageVehicule.js/damageMecha.js create it with NO knight-damage flags, so it has
// no revert affordance of its own). Exclusion + exact-UNIQUE content marker, never "last card".
const findNewSideCardInPage = (excludeIds, marker) => {
  const fresh = game.messages.contents.filter(
    (m) => !excludeIds.includes(m.id) && m.flags?.['knight-damage']?.isRecap !== true && m.content.includes(marker),
  );
  if (fresh.length === 0) return null;
  if (fresh.length > 1)
    return { error: `${fresh.length} new ${marker} cards: ${fresh.map((m) => m.id)}`, ids: fresh.map((m) => m.id) };
  const message = fresh[fresh.length - 1];
  return { id: message.id, content: message.content, kdFlags: message.flags?.['knight-damage'] ?? null };
};

// Revert DOM probe against the PINNED recap card (same predicate contract as the Phase-3 suite):
// null until line-through AND revert-gone both hold. The vehicule/mecha revert is the SYNCHRONOUS
// DamageBase.revertDamage path — no knight-style setTimeout.
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

// One-shot chat-log leak scan (document-side): flagged recaps AND the flagless side cards.
// Markers arrive as trailing args (stringify rule) so the constants at the top of the file are
// the ONLY byte source for them (no inlined duplicates in the suite's last line of defense).
const leakScanInPage = (vehMarker, mecMarker) => ({
  recaps: game.messages.contents
    .filter((m) => m.flags?.['knight-damage']?.isRecap === true)
    .map((m) => m.id)
    .join(','),
  sideCards: game.messages.contents
    .filter((m) => m.content.includes(vehMarker) || m.content.includes(mecMarker))
    .map((m) => m.id)
    .join(','),
});

const readAtkStatsInPage = () => {
  const s = game.actors.get('kdtAtkPnjAAAAAAA').system;
  return { sante: s.sante.value, armure: s.armure.value, energie: s.energie.value };
};

// ── Node-side test plumbing ──
// The comparison helpers live in support/compare.mjs (shared by all damage suites);
// entriesEqual keeps the local name statsEqual at the call sites.

async function main(Framework) {
  acquireSpawnMutex(); // ownership before ANYTHING (see support/spawn-lock.mjs)
  const fw = new Framework(config);
  const results = [];
  const push = (label, ok, detail = '') => results.push({ label, ok, detail });

  const standard = loadRecordedFixture(STANDARD_FIXTURE_NAME);
  console.log(
    `[vm] fixture loaded: standard (knight ${standard.meta.knightSystemVersion}, core ${standard.meta.coreVersion})`,
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
      await shot(`vehicule-mecha-${name}`);
      push(`${name} completes without infrastructure error`, false, `threw: ${err.stack ?? err}`);
    }
  }

  // Replay with a node-side mutation hook, then wait for the PINNED card. The VICTIM TOKEN is
  // injected as the speaker (Phase-3 pattern): DamageBase.origin (damageBase.js:36) and every
  // revert click resolve through message.speaker, so the replay deviates from the recorded null
  // speaker deliberately and identically to the knight suite.
  async function replay(mutate, victimTokenId, victimActorId) {
    return replayFixture(
      fw,
      standard.message,
      mutate,
      { scene: SCENE_ID, token: victimTokenId, actor: victimActorId },
      'vm',
    );
  }

  // One damage application on a vehicule/mecha victim: control token -> pinned click -> recap AND
  // the side card discovered by flag/marker + exclusion, BOTH sunk the MOMENT seen -> stats waited.
  async function applyDamageAndAwait({ tokenId, actorId, predicate }, msgId, action, expectedStats, recapSink) {
    await fw.executeInFoundry(controlTokenInPage, tokenId);
    const preIds = await fw.executeInFoundry(listMessageIdsInPage);
    await fw.waitFor(clickOnMessageCard, 15000, msgId, `button[data-action="${action}"]`);
    const recap = await fw.waitFor(findNewRecapMessageInPage, 15000, preIds);
    if (recap?.ids) recapSink.push(...recap.ids);
    if (!recap || recap.error) throw new Error(`recap message discovery failed: ${recap?.error ?? 'timeout'}`);
    recapSink.push(recap.id);
    const side = await fw.waitFor(
      findNewSideCardInPage,
      15000,
      [...preIds, recap.id],
      actorId === VEH_ACTOR_ID ? SIDE_MARKER_VEH : SIDE_MARKER_MEC,
    );
    if (side?.ids) recapSink.push(...side.ids);
    if (!side || side.error) throw new Error(`side-card discovery failed: ${side?.error ?? 'timeout'}`);
    recapSink.push(side.id);
    const stats = await fw.waitFor(predicate, 15000, actorId, expectedStats);
    return { recap, side, stats };
  }

  async function cleanup(victimActorId, messages, victimSnapshot) {
    await fw.executeInFoundry(releaseAllTokensInPage).catch(() => {});
    if (victimSnapshot)
      await fw.executeInFoundry(restoreActorSystemInPage, victimActorId, victimSnapshot).catch(() => {});
    if (messages?.length)
      await fw
        .executeInFoundry(deleteMessagesInPage, messages.filter(Boolean))
        .catch((err) => console.log(`[vm] cleanup message-delete FAILED: ${err.message ?? err}`));
  }

  async function matchBaseline(victimActorId, seed) {
    const now = await fw.executeInFoundry(
      victimActorId === VEH_ACTOR_ID ? readVehStatsInPage : readMechaStatsInPage,
      victimActorId,
    );
    if (!statsEqual(now, seed))
      console.log(
        `[vm] baseline(${victimActorId}) expected ${JSON.stringify(seed)}\n[vm] actual ${JSON.stringify(now)}`,
      );
    return statsEqual(now, seed);
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
      veh: canvas.tokens.get('tkVicVehiculeAAA')?.actor?.type ?? null,
      mec: canvas.tokens.get('tkVicMechaAAAAAA')?.actor?.type ?? null,
      atk: canvas.tokens.get('tkAtkPnjAAAAAAAA')?.id ?? null,
    }));
    console.log(
      `[vm] knight ${boot.knight} / core ${boot.core} / lang ${boot.lang} / scene ${boot.scene} veh=${boot.veh} mec=${boot.mec}`,
    );
    if (boot.veh !== 'vehicule' || boot.mec !== 'mechaarmure' || !boot.atk)
      throw new Error('vehicule/mecha/pnj linked tokens missing on the active scene');
    if (boot.lang !== 'fr') throw new Error(`chat HTML contract is French but game.i18n.lang=${boot.lang}`);

    // Poisoning gate: the seed victims must be at baseline at suite start (the boot probe verified
    // the seed rows re-derive to EXACTLY these values — no knight-style equipements re-derivation
    // exists for these actor types).
    const startVeh = await matchBaseline(VEH_ACTOR_ID, SEED_STATS_VEH);
    const startMec = await matchBaseline(MEC_ACTOR_ID, SEED_STATS_MEC);
    if (!startVeh || !startMec)
      throw new Error('vehicule/mecha stats are NOT at the seed baseline at suite start — world poisoning');

    const counterInstalled = await fw.executeInFoundry(installActorUpdateCounterInPage);
    console.log(`[vm] preUpdateActor counter: ${counterInstalled}`);

    // ───────────────────────── 1. vehicule NORMAL: colosse ALWAYS on ─────────────────────────

    await runCase('case1-vehicule-normal', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, VEH_ACTOR_ID);
      let msgId;
      const recapIds = [];
      try {
        // targets[0].value 130 + id -> vehicule token. Oracle (unit suite 'type vehicule always has
        // colosse on'): damage 130 -> trunc(130/10)=13 (CdF 0, penetrant 6 zeroes it either way)
        // -> armure 30-13=17; passenger carry trunc(13/5)=2 lives ONLY in the recap map + side card.
        msgId = await replay(
          (m) => {
            m.flags.knight.targets[0].id = VEH_TOKEN_ID;
            m.flags.knight.targets[0].value = 130;
          },
          VEH_TOKEN_ID,
          VEH_ACTOR_ID,
        );
        const updatesBefore = (await fw.executeInFoundry(readActorUpdatesInPage)).length;
        const { recap, side, stats } = await applyDamageAndAwait(
          { tokenId: VEH_TOKEN_ID, actorId: VEH_ACTOR_ID, predicate: vehStatsMatchInPage },
          msgId,
          'applyDamage',
          { ...SEED_STATS_VEH, armure: 17 },
          recapIds,
        );
        push(
          'case1: vehicule Normal apply -> armure 30->17 (colosse /10 ALWAYS on for vehicule: 130 becomes 13), sante/energie/CdF untouched',
          statsEqual(stats, { ...SEED_STATS_VEH, armure: 17 }),
          `got ${JSON.stringify(stats)}`,
        );
        push(
          'case1: recap map EXACT {armure:13, passenger:2} (tranche-5 carry), isRecap true, token-backed origin, NO wear/anatheme keys (knight-only flags)',
          recapMapMatches(recap.recap, { armure: 13, passenger: 2 }) &&
            recap.flags?.isRecap === true &&
            recap.flags?.origin === `Scene.${SCENE_ID}.Token.${VEH_TOKEN_ID}` &&
            !('wear' in (recap.flags ?? {})) &&
            !('anatheme' in (recap.flags ?? {})),
          `got ${JSON.stringify(recap.flags)}`,
        );
        push(
          "case1: recap labels per damageBase output — 'Armure : 13' present, 'Blindage'/'Santé' ABSENT (vehicule track is armure; passenger has no recap label)",
          recap.content.includes(RECAP_HEADER) &&
            recap.content.includes(recapLine('Armure', 13)) &&
            !recap.content.includes('Blindage :') &&
            !recap.content.includes('Santé :') &&
            recap.content.includes('class="revert-damage"'),
          `content: ${recap.content}`,
        );
        push(
          'case1: SECOND card is the INTENDED flagless passenger recap (exact byte content, NO knight-damage flags — passenger damage stays manual)',
          side.content.includes(SIDE_MARKER_VEH) &&
            side.content.includes(recapLine('Santé', 2)) &&
            side.kdFlags === null,
          `content: ${side.content} flags: ${JSON.stringify(side.kdFlags)}`,
        );
        // The system-side equipements sync (knight.mjs:848) EARLY-RETURNS for non-knight actor
        // types, so unlike the Phase-3 knight pin (4 witnesses) the vehicule apply is witnessed by
        // EXACTLY 2 identical non-empty payloads (INTENDED double update, armure only).
        const updates = await fw.executeInFoundry(readActorUpdatesInPage);
        const victimUpdates = updates
          .slice(updatesBefore)
          .filter((u) => u.id === VEH_ACTOR_ID && Object.keys(u.data ?? {}).length > 0);
        const modulePayloads = victimUpdates.filter((u) => deepEqualJson(u.data?.system, { armure: { value: 17 } }));
        push(
          'case1: exactly 2 non-empty preUpdateActor payloads, both {armure:{value:17}} (double update; no system equipements sync for non-knight types, no sante key)',
          victimUpdates.length === 2 &&
            modulePayloads.length === 2 &&
            !victimUpdates.some((u) => u.data?.system?.sante !== undefined),
          `got ${JSON.stringify(victimUpdates)}`,
        );
      } finally {
        await cleanup(VEH_ACTOR_ID, [msgId, ...recapIds], snap);
      }
    });

    // ───────────────────────── 2. vehicule antivehicule defeats the /10 ─────────────────────────

    await runCase('case2-vehicule-antivehicule', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, VEH_ACTOR_ID);
      let msgId;
      const recapIds = [];
      try {
        // Same 130 target as case1 + raw 'antivehicule': isColosseApplied() false (damageBase.js:182)
        // -> NO /10 -> the full 130 hits: the 30 armure absorbs all of it (armure 0), carry
        // trunc(30/5)=6. The case1-vs-case2 delta {13,2} vs {30,6} IS the colosse pin.
        msgId = await replay(
          (m) => {
            m.flags.knight.targets[0].id = VEH_TOKEN_ID;
            m.flags.knight.targets[0].value = 130;
            m.flags.knight.weapon.effets.raw.push('antivehicule');
          },
          VEH_TOKEN_ID,
          VEH_ACTOR_ID,
        );
        const { recap, side, stats } = await applyDamageAndAwait(
          { tokenId: VEH_TOKEN_ID, actorId: VEH_ACTOR_ID, predicate: vehStatsMatchInPage },
          msgId,
          'applyDamage',
          { ...SEED_STATS_VEH, armure: 0 },
          recapIds,
        );
        push(
          "case2: raw 'antivehicule' -> NO /10: armure 30->0 (full 130 reaches the track), sante still untouched",
          statsEqual(stats, { ...SEED_STATS_VEH, armure: 0 }),
          `got ${JSON.stringify(stats)}`,
        );
        push(
          'case2: recap map EXACT {armure:30, passenger:6} vs case1 {armure:13, passenger:2} at the SAME 130 target — and the side card shows the passenger carry byte',
          recapMapMatches(recap.recap, { armure: 30, passenger: 6 }) &&
            recap.content.includes(recapLine('Armure', 30)) &&
            side.content.includes(recapLine('Santé', 6)) &&
            side.kdFlags === null,
          `got ${JSON.stringify(recap.recap)} / ${side.content}`,
        );
      } finally {
        await cleanup(VEH_ACTOR_ID, [msgId, ...recapIds], snap);
      }
    });

    // ───────────────────────── 3. mecha NORMAL: blindage + field names ─────────────────────────

    await runCase('case3-mecha-normal', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, MEC_ACTOR_ID);
      let msgId;
      const recapIds = [];
      try {
        // 130 with resilience 3 -> colosse on -> 13 absorbed by the 30 blindage -> 17;
        // mecha carry uses TRANCHE 10: trunc(13/10)=1 (NOT the vehicule tranche 5 which gives 2).
        msgId = await replay(
          (m) => {
            m.flags.knight.targets[0].id = MEC_TOKEN_ID;
            m.flags.knight.targets[0].value = 130;
          },
          MEC_TOKEN_ID,
          MEC_ACTOR_ID,
        );
        const updatesBefore = (await fw.executeInFoundry(readActorUpdatesInPage)).length;
        const { recap, side, stats } = await applyDamageAndAwait(
          { tokenId: MEC_TOKEN_ID, actorId: MEC_ACTOR_ID, predicate: mechaStatsMatchInPage },
          msgId,
          'applyDamage',
          { ...SEED_STATS_MEC, blindage: 17 },
          recapIds,
        );
        push(
          'case3: mecha Normal apply -> blindage 30->17 (/10 with resilience 3), sante/energie/CdF/resilience untouched',
          statsEqual(stats, { ...SEED_STATS_MEC, blindage: 17 }),
          `got ${JSON.stringify(stats)}`,
        );
        push(
          "case3: recap map EXACT {blindage:13, passenger:1} (tranche 10, discriminates from vehicule's tranche 5) + 'Blindage : 13' label + flagless 'Dégâts sur le pilote :' card",
          recapMapMatches(recap.recap, { blindage: 13, passenger: 1 }) &&
            recap.content.includes(recapLine('Blindage', 13)) &&
            !recap.content.includes('Armure :') &&
            recap.content.includes('class="revert-damage"') &&
            side.content.includes(SIDE_MARKER_MEC) &&
            side.content.includes(recapLine('Santé', 1)) &&
            side.kdFlags === null,
          `got ${JSON.stringify(recap.recap)} / ${side.content}`,
        );
        // LIVE FIELD-NAME pin: the ONLY gauge key the mecha flow writes is system.blindage.value —
        // sante is NEVER written, because no live calculate() emits a 'cohesion' repartition key
        // (DamageMecha uses 'passenger', which apply() has NO mapping for). The INTENDED
        // cohesion->system.sante.value write (damageBase.js:288) is unreachable in the live pipeline.
        const updates = await fw.executeInFoundry(readActorUpdatesInPage);
        const victimUpdates = updates
          .slice(updatesBefore)
          .filter((u) => u.id === MEC_ACTOR_ID && Object.keys(u.data ?? {}).length > 0);
        const modulePayloads = victimUpdates.filter((u) => deepEqualJson(u.data?.system, { blindage: { value: 17 } }));
        push(
          'case3: exactly 2 non-empty preUpdateActor payloads, both {blindage:{value:17}} — no sante/cohesion key EVER written by the live mecha flow (apply() cohesion->sante mapping is dead for every live class)',
          victimUpdates.length === 2 &&
            modulePayloads.length === 2 &&
            !victimUpdates.some((u) => u.data?.system?.sante !== undefined),
          `got ${JSON.stringify(victimUpdates)}`,
        );
      } finally {
        await cleanup(MEC_ACTOR_ID, [msgId, ...recapIds], snap);
      }
    });

    // ───────────────────────── 4. mecha colosse OFF switches ─────────────────────────

    await runCase('case4-mecha-colosse-off', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, MEC_ACTOR_ID);
      let resilienceMsg;
      let antivehiculeMsg;
      const recapIds = [];
      try {
        // (a) victim-stat mutate resilience.value 0 -> isColosseApplied() false (the ONLY off lever
        // a mecha stat offers). 130 lands whole: 30 absorbed -> blindage 0, carry trunc(30/10)=3.
        await fw.executeInFoundry(updateActorInPage, MEC_ACTOR_ID, { 'system.resilience.value': 0 });
        await fw.waitFor(mechaStatsMatchInPage, 15000, MEC_ACTOR_ID, { ...SEED_STATS_MEC, resilience: 0 });
        resilienceMsg = await replay(
          (m) => {
            m.flags.knight.targets[0].id = MEC_TOKEN_ID;
            m.flags.knight.targets[0].value = 130;
          },
          MEC_TOKEN_ID,
          MEC_ACTOR_ID,
        );
        const off = await applyDamageAndAwait(
          { tokenId: MEC_TOKEN_ID, actorId: MEC_ACTOR_ID, predicate: mechaStatsMatchInPage },
          resilienceMsg,
          'applyDamage',
          // The mutated resilience stays 0 in the expected LIVE stats (the oracle mutation, not drift).
          { ...SEED_STATS_MEC, blindage: 0, resilience: 0 },
          recapIds,
        );
        push(
          'case4: resilience.value 0 -> colosse OFF at the SAME 130: blindage 30->0 (no /10), recap EXACT {blindage:30, passenger:3} (vs 13/1 with colosse on)',
          statsEqual(off.stats, { ...SEED_STATS_MEC, blindage: 0, resilience: 0 }) &&
            recapMapMatches(off.recap.recap, { blindage: 30, passenger: 3 }),
          `got ${JSON.stringify(off.stats)} / ${JSON.stringify(off.recap.recap)}`,
        );

        // Restore the victim fully before the second sub-application (the blindage 0 write above).
        await fw.executeInFoundry(restoreActorSystemInPage, MEC_ACTOR_ID, snap);
        await fw.waitFor(mechaStatsMatchInPage, 15000, MEC_ACTOR_ID, SEED_STATS_MEC);

        // (b) raw 'antivehicule' with resilience 3 STILL present: the weapon-side off lever gives
        // byte-identical colosse-off numbers.
        antivehiculeMsg = await replay(
          (m) => {
            m.flags.knight.targets[0].id = MEC_TOKEN_ID;
            m.flags.knight.targets[0].value = 130;
            m.flags.knight.weapon.effets.raw.push('antivehicule');
          },
          MEC_TOKEN_ID,
          MEC_ACTOR_ID,
        );
        const av = await applyDamageAndAwait(
          { tokenId: MEC_TOKEN_ID, actorId: MEC_ACTOR_ID, predicate: mechaStatsMatchInPage },
          antivehiculeMsg,
          'applyDamage',
          { ...SEED_STATS_MEC, blindage: 0 },
          recapIds,
        );
        push(
          "case4: raw 'antivehicule' (resilience 3 intact) -> colosse OFF too: identical {blindage:30, passenger:3} numbers and blindage 0 — both off-switches defeat /10",
          statsEqual(av.stats, { ...SEED_STATS_MEC, blindage: 0 }) &&
            recapMapMatches(av.recap.recap, { blindage: 30, passenger: 3 }),
          `got ${JSON.stringify(av.stats)} / ${JSON.stringify(av.recap.recap)}`,
        );
      } finally {
        await cleanup(MEC_ACTOR_ID, [resilienceMsg, antivehiculeMsg, ...recapIds], snap);
      }
    });

    // ───────────────────────── 5. vehicule Demi / Double multipliers ─────────────────────────

    await runCase('case5-vehicule-multipliers', async () => {
      const snap = await fw.executeInFoundry(snapshotActorSystemInPage, VEH_ACTOR_ID);
      let demiMsg;
      let doubleMsg;
      const recapIds = [];
      try {
        // ceil BEFORE the /10: Demi ceil(130*0.5)=65 -> trunc(65/10)=6 -> armure 24, carry trunc(6/5)=1.
        demiMsg = await replay(
          (m) => {
            m.flags.knight.targets[0].id = VEH_TOKEN_ID;
            m.flags.knight.targets[0].value = 130;
          },
          VEH_TOKEN_ID,
          VEH_ACTOR_ID,
        );
        const demi = await applyDamageAndAwait(
          { tokenId: VEH_TOKEN_ID, actorId: VEH_ACTOR_ID, predicate: vehStatsMatchInPage },
          demiMsg,
          'applyDamageHalf',
          { ...SEED_STATS_VEH, armure: 24 },
          recapIds,
        );
        push(
          'case5: Demi -> ceil(65) then /10 trunc(65/10)=6 -> armure 24, recap EXACT {armure:6, passenger:1}',
          statsEqual(demi.stats, { ...SEED_STATS_VEH, armure: 24 }) &&
            recapMapMatches(demi.recap.recap, { armure: 6, passenger: 1 }),
          `got ${JSON.stringify(demi.stats)} / ${JSON.stringify(demi.recap.recap)}`,
        );

        await fw.executeInFoundry(restoreActorSystemInPage, VEH_ACTOR_ID, snap);
        await fw.waitFor(vehStatsMatchInPage, 15000, VEH_ACTOR_ID, SEED_STATS_VEH);

        // Double: ceil(260) -> trunc(260/10)=26 -> armure 4, carry trunc(26/5)=5.
        doubleMsg = await replay(
          (m) => {
            m.flags.knight.targets[0].id = VEH_TOKEN_ID;
            m.flags.knight.targets[0].value = 130;
          },
          VEH_TOKEN_ID,
          VEH_ACTOR_ID,
        );
        const dbl = await applyDamageAndAwait(
          { tokenId: VEH_TOKEN_ID, actorId: VEH_ACTOR_ID, predicate: vehStatsMatchInPage },
          doubleMsg,
          'applyDamageDouble',
          { ...SEED_STATS_VEH, armure: 4 },
          recapIds,
        );
        push(
          'case5: Double -> ceil(260) then /10 -> armure 4, recap EXACT {armure:26, passenger:5}',
          statsEqual(dbl.stats, { ...SEED_STATS_VEH, armure: 4 }) &&
            recapMapMatches(dbl.recap.recap, { armure: 26, passenger: 5 }),
          `got ${JSON.stringify(dbl.stats)} / ${JSON.stringify(dbl.recap.recap)}`,
        );
      } finally {
        await cleanup(VEH_ACTOR_ID, [demiMsg, doubleMsg, ...recapIds], snap);
      }
    });

    // ───────────────────────── 6. revert on both recap types ─────────────────────────

    await runCase('case6-revert', async () => {
      const vehSnap = await fw.executeInFoundry(snapshotActorSystemInPage, VEH_ACTOR_ID);
      const mecSnap = await fw.executeInFoundry(snapshotActorSystemInPage, MEC_ACTOR_ID);
      let vehMsg;
      let vehRecapId;
      let mecMsg;
      let mecRecapId;
      const recapIds = [];
      try {
        // vehicule: apply 130 (armure 17) then click the recap .revert-damage. The revert is the
        // SYNCHRONOUS DamageBase.revertDamage (no knight timers); recap {armure:13, passenger:2}
        // adds back onto the LIVE stats: the passenger key has no apply() mapping (the revert loop
        // makes actorStats.passenger NaN, unit-pinned confined-to-memory), so only armure returns.
        vehMsg = await replay(
          (m) => {
            m.flags.knight.targets[0].id = VEH_TOKEN_ID;
            m.flags.knight.targets[0].value = 130;
          },
          VEH_TOKEN_ID,
          VEH_ACTOR_ID,
        );
        const vehApplied = await applyDamageAndAwait(
          { tokenId: VEH_TOKEN_ID, actorId: VEH_ACTOR_ID, predicate: vehStatsMatchInPage },
          vehMsg,
          'applyDamage',
          { ...SEED_STATS_VEH, armure: 17 },
          recapIds,
        );
        vehRecapId = vehApplied.recap.id;
        await fw.waitFor(clickOnMessageCard, 15000, vehRecapId, '.revert-damage');
        const vehRestored = await fw.waitFor(vehStatsMatchInPage, 15000, VEH_ACTOR_ID, SEED_STATS_VEH);
        push(
          'case6: vehicule revert restores the gauge (armure 17+13=30) byte-identical to the seed — passenger carry (recap key) was never a document write and stays manual (INTENDED)',
          statsEqual(vehRestored, SEED_STATS_VEH),
          `got ${JSON.stringify(vehRestored)}`,
        );
        const domState = await fw.waitFor(revertDomStateInPage, 15000, vehRecapId);
        push(
          'case6: vehicule recap shows line-through + revert button gone AND the mutation PERSISTS in the stored content (base path, no knight setTimeout)',
          domState?.lineThrough === true &&
            domState?.revertButtonGone === true &&
            (await fw.waitFor(storedContentPersistedInPage, 15000, vehRecapId, 'line-through', 'revert-damage'))?.ok ===
              true,
          `got ${JSON.stringify(domState)}`,
        );

        // mecha twin: apply then revert — blindage returns via the base path.
        mecMsg = await replay(
          (m) => {
            m.flags.knight.targets[0].id = MEC_TOKEN_ID;
            m.flags.knight.targets[0].value = 130;
          },
          MEC_TOKEN_ID,
          MEC_ACTOR_ID,
        );
        const mecApplied = await applyDamageAndAwait(
          { tokenId: MEC_TOKEN_ID, actorId: MEC_ACTOR_ID, predicate: mechaStatsMatchInPage },
          mecMsg,
          'applyDamage',
          { ...SEED_STATS_MEC, blindage: 17 },
          recapIds,
        );
        mecRecapId = mecApplied.recap.id;
        await fw.waitFor(clickOnMessageCard, 15000, mecRecapId, '.revert-damage');
        const mecRestored = await fw.waitFor(mechaStatsMatchInPage, 15000, MEC_ACTOR_ID, SEED_STATS_MEC);
        push(
          'case6: mecha revert restores blindage 17+13=30 (pilot carry likewise recap-only — the flagless pilote card has no revert affordance)',
          statsEqual(mecRestored, SEED_STATS_MEC),
          `got ${JSON.stringify(mecRestored)}`,
        );
      } finally {
        await cleanup(VEH_ACTOR_ID, [vehMsg, vehRecapId, mecMsg, mecRecapId, ...recapIds], vehSnap);
        if (mecSnap) await fw.executeInFoundry(restoreActorSystemInPage, MEC_ACTOR_ID, mecSnap).catch(() => {});
      }
    });

    // ───────────────────────── 7. NEGATIVE: pnj-typed controlled token dispatches nothing ─────────

    await runCase('case7-pnj-dispatch-negative', async () => {
      // The button-injection gate keys on the ATTACKER type, so the card gets buttons either way;
      // what must NOT happen is an application: createDamageObject returns false for 'pnj'
      // (knight-damage.js:343-359) and handleClickApplyDamage's forEach skips it. The false return
      // is SYNCHRONOUS relative to the click (nothing awaits before it), so one document-side
      // message-count probe in a later CDP round-trip is conclusive for the absence.
      let msgId;
      try {
        msgId = await replay(
          (m) => {
            m.flags.knight.targets[0].id = ATK_TOKEN_ID;
            m.flags.knight.targets[0].value = 130;
          },
          ATK_TOKEN_ID,
          ATK_ACTOR_ID,
        );
        await fw.executeInFoundry(controlTokenInPage, ATK_TOKEN_ID);
        const before = await fw.executeInFoundry(listMessageIdsInPage);
        await fw.waitFor(clickOnMessageCard, 15000, msgId, 'button[data-action="applyDamage"]');
        const after = await fw.executeInFoundry(listMessageIdsInPage);
        const atkStats = await fw.executeInFoundry(readAtkStatsInPage);
        push(
          "case7 negative: 'pnj'-controlled token + Normal click -> no recap/side card created, no stats touched (createDamageObject returns false for pnj)",
          after.length === before.length && statsEqual(atkStats, SEED_STATS_ATK),
          `new messages ${after.length - before.length}, atk stats ${JSON.stringify(atkStats)}`,
        );
      } finally {
        await cleanup(null, [msgId], null);
      }
    });

    // ───────────────────────── world-restoration self-checks ─────────────────────────

    push(
      'poisoning self-check: vehicule stats byte-identical to the seed baseline at suite end',
      await matchBaseline(VEH_ACTOR_ID, SEED_STATS_VEH),
    );
    push(
      'poisoning self-check: mecha stats byte-identical to the seed baseline at suite end',
      await matchBaseline(MEC_ACTOR_ID, SEED_STATS_MEC),
    );
    const atkEnd = await fw.executeInFoundry(readAtkStatsInPage);
    push(
      'poisoning self-check: atk-pnj stats byte-identical to the seed baseline at suite end',
      statsEqual(atkEnd, SEED_STATS_ATK),
      `got ${JSON.stringify(atkEnd)}`,
    );
    const leaks = await fw.executeInFoundry(leakScanInPage, SIDE_MARKER_VEH, SIDE_MARKER_MEC);
    push(
      'poisoning self-check: NO knight-damage recap AND NO flagless passenger/pilote card survives in the (boot-persistent) chat log',
      leaks.recaps === '' && leaks.sideCards === '',
      `recaps: ${leaks.recaps} | side cards: ${leaks.sideCards}`,
    );

    // ───────────────────────── summary ─────────────────────────

    for (const { label, ok, detail } of results) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — ${detail}`}`);
    }
    const failures = results.filter((r) => !r.ok).length;
    if (failures > 0) {
      console.log(
        `\nE2E VEHICULE-MECHA: FAIL (${failures}/${results.length} assertions failed${caseFailures.length ? `; case errors: ${caseFailures.join(' | ')}` : ''})`,
      );
    } else {
      console.log(`\nE2E VEHICULE-MECHA: PASS (${results.length}/${results.length} assertions)`);
    }
    process.exitCode = failures > 0 ? 1 : 0;
  } catch (err) {
    await shot('vehicule-mecha-failure');
    throw err;
  } finally {
    await fw.stop();
    console.log('Foundry server + browser stopped.');
  }
}
