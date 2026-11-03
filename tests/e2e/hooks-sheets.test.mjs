// E2E hook & sheet edge cases (Phase 6 of docs/testing-plan.md): `npm run test:e2e:hooks-sheets`
// AFTER `npm run prepare:e2e && npm run setup:e2e` (and at least the recorded standard fixture).
//
// Coverage (proportionate to the plan's Phase-6 scope -- the damage REPARTITION math itself is
// already pinned byte-exact by the Phase-3/4/5 suites; this suite pins the SHEET/DOM/AUTOMATION
// half, and never clones a Phase-3 case):
//  A  the COLD-RACE LOSS, pinned live (target 104: effective CdF 10-6=4 -> damage 100 absorbed
//     EXACTLY by the 100 armor -> armure 0 && damage 0, carry trunc(100/5)=20 = sante exactly 0):
//     apply()'s gate (damageKnight.js:236-241) fires switchArmure('guardian') at +10ms, opening
//     the victim sheet and arming a +1ms click / +10ms auto-close. On a COLD first render of the
//     knight sheet BOTH timers miss: at +1ms the v1 Application element is still EMPTY (_render
//     defers past the timers), and the +10ms close() is a NO-OP while the app is in RENDERING
//     state (appv1/api/application-v1.mjs:826) -- the sheet is left OPEN and nothing wears. The
//     untouched gen-4 seed ALSO makes the guardian button unrenderable anyway (mirror finding
//     below), so the chain is doubly inert: the timed-out flip wait + the left-open window + the
//     zero guardian-button count are the pinned LIVE TRUTH (positive control: A2; pre-opened
//     negative control: A3).
//  A2 the deterministic POSITIVE switch pin: the gen-3 ITEM lever + a PRE-OPENED sheet. The
//     module's +1ms click lands on the rendered `.armure[data-type=guardian]`; the system's switch
//     handler (knight-sheet.mjs:274-326) flips wear (prepared AND _source) and sets system.armure.
//     value := the guardian stored 15; sante stays 0. The module NEVER closes a sheet it did not
//     open (opened=false branch). The system's leave-armure ITEM write (knight-sheet.mjs:324
//     armor.update of system.armure.value) is SILENTLY DROPPED by the v14 armure-item data model:
//     the schema declares ONLY armure.base -- the armure.value leaf never materializes in prepared
//     data NOR in _source, and armure.base stays 100 (this is WHY the plan's old "ITEM write
//     70/0" pin never existed to pin).
//  A3 the gen-4 NEGATIVE control with the SAME pre-opened sheet: NO button rendered (the ITEM
//     mirror pins jauges.sante false) -> the gate fires switchArmure but the click hits an EMPTY
//     jQuery set -> NO flip. Isolates the lever finding from the render-race finding.
//  B  folde blocks the auto-switch. ONLY the DURATION-EFFECT path qualifies: the bare
//     duration-less status toggle is INVISIBLE to Actor#temporaryEffects (probe-pinned: the toggle
//     creates a persistent 'Bloque folde' effect row while tempStatuses stays []), and the
//     module's hasStatusEffect (helpers.js) reads temporaryEffects ONLY -- so the plan's
//     "toggleStatusEffect(folde)" recipe is inert against the MODULE gate; the plan's own
//     system-level pin (wear forced back) is a different mechanism. With the lever ON (button
//     present!) and folde in temporaryEffects, apply()'s `!hasStatusEffect(...folde)` clause
//     blocks switchArmure ENTIRELY: repartition byte-identical to A2, wear stays armure BOTH
//     sides, the module opens/closes NOTHING, and the ITEM never sees a leaf write.
//  C  revert-damage with a re-stamped recap wear flag (the ONLY way the damageKnight.js:200-204
//     revert-switch branch is reachable in this world): apply(34) -> recap {armure:30, sante:6},
//     armure 70 / sante 14, NO switch (armure != 0 gate); the recap wear flag is then re-stamped
//     to 'guardian' (document read-back pinned BEFORE the click); the revert click switchArmure-
//     back lands on the PRE-OPENED sheet BEFORE the +100/+101ms stat-restore timers, so the
//     +100ms setActorStats re-reads the POST-SWITCH actor (system.armure.value := guardian stored
//     15 via the system handler) and adds the recap back on top: armure 15+30=45, sante 14+6=20,
//     wear guardian BOTH sides; revert's own apply() gate (armure now 45 != 0) never re-fires.
//     The leave-armure ITEM write is again schema-DROPPED (ITEM byte-intact).
//  D  loup module-sheet DOM half (the unit suite pins the flag-contract half): a FRESH module
//     item defaults system.active.base = false; renderModuleSheet creates the knight-damage.loup
//     8-key 'unactive' map on the FIRST pass (pass1: no flag, 0 buttons, DOM untouched) and the
//     flag-write auto re-render injects the 8 option buttons into .niveau_n1 -- the container
//     EXISTS from the schema-initial details.n1, so the module's buttons ARE live (an earlier
//     static "never renders" guess is hereby REJECTED); the buttons render with className == the
//     flag value, and ONE real click on the percearmure button flips the flag map entry to the
//     literal 'active' (className written LITERALLY, the other 7 keys untouched).
//  E  the loup DAMAGE half as a byte-exact PAIR on target 14 with a FULL-BYPASS weapon
//     (raw = ignorearmure + ignorechampdeforce; victim speaker; loup ITEM flags as the ONLY
//     delta): (i) all 8 loup keys 'unactive' -> the bypass stands: CdF ignored (recap.sante = 14
//     DIRECT, no CdF bite), the whole armure track skipped -> recap EXACT {armure:0, sante:14},
//     armure 100 intact, sante 6 -- and the 'Armure : 0' line is NEVER printed (recap lines are
//     truthy-only); (ii) percearmure/ignorearmure/ignorecdf 'active' -> BOTH weapon traits
//     NEUTRALISED -> the victim's FULL CdF 10 applies (the module never bypasses CdF -- 14-10=4)
//     and the armor absorbs the rest -> recap EXACT {armure:4, sante:0}, armure 96, sante 20.
//  F  shrine / shrine-ameliore pushed as module-style mode-2 ActiveEffects: prepared CdF 16 / 18
//     while _source champDeForce.base stays 10 (derived-vs-_source shape only -- the Phase-4
//     suite already pins the shrine AMOUNT byte-exact).
//
// THE GEN-4 WEAR PIN + THE GUARDIAN-SWITCH LEVER (the plan's Phase-6 item, fully resolved live):
// the seed victim-knight's gen-4 armor ITEM hard-pins its prepared jauges.sante=false
// (armure-data-model prepareBaseData defineProperty when generation===4 -- EVERY write-back to
// that ITEM leaf is DEAD, probe-pinned: a true write reads back false), and the knight system
// forces the actor's prepared wear to 'armure' (#checkArmor, generation>=4 -- the actor-level
// system.wear write is equally dead while gen 4 holds). The ACTOR's prepared jauges.sante (which
// is what gates the module's switchArmure AND renders the template's guardian button) MIRRORS the
// armor ITEM's prepared jauges under wear 'armure' (#setJauges) -- the actor-level system.jauges
// write is NOT the lever either. THE WORKING LEVER IS THE ITEM: updating it to
// {'system.generation': 3, 'system.jauges.sante': true} (both schema-declared, both writable)
// makes the ITEM prepared jauges.sante true, and the mirror finally opens BOTH the module gate
// AND the guardian button (A2 renders exactly one; A3 under gen 4 renders zero).
//
// Discipline (identical to the Phase-3/4/5 suites, local-only, NEVER in CI):
//   - the spawn mutex serializes every Foundry boot (repo-root .e2e-spawn.lock);
//   - every case snapshots the victim system + knight-damage flags + the armor ITEM's system
//     subtree + effect statuses + item inventory, and cleanup closes every *Sheet* window,
//     releases tokens, deletes its own chat messages / effects / items, restores
//     system+flags+ITEM subtree, then WAITS the SEED stats (incl. wear re-pinned to armure and
//     the gen-4 ITEM mirror back to jauges.sante=false) before the next case -- back-to-back runs
//     WITHOUT setup:e2e are valid;
//   - case ORDER is deliberate: A runs FIRST (cold first-render truth), every later case
//     pre-opens its sheets or needs no sheet at all;
//   - recap cards are sunk (deleted) AT discovery; the suite-end self-checks (four actors' system
//     bytes, four actors' knight-damage flag namespaces, the armor ITEM's system+flags bytes,
//     effect statuses + item inventory, no leftover *Sheet* window, zero surviving recap, and an
//     EMPTY Hooks 'error' recorder) must ALL pass even though cases probe-and-restore;
//   - screenshots ONLY on failure (never auto-opened).
import config from './config.mjs';
import { loadFramework, respawnPreservingSymlinks } from './support/framework.mjs';
import { acquireSpawnMutex } from './support/spawn-lock.mjs';
import { loadRecordedFixture, STANDARD_FIXTURE_NAME } from './support/fixture-store.mjs';
import {
  clickOnMessageCard,
  deleteMessagesInPage,
  findNewRecapMessageInPage,
  listMessageIdsInPage,
  messageFlagsInPage,
} from './support/chat.mjs';
import {
  controlTokenInPage,
  installActorUpdateCounterInPage,
  readActorUpdatesInPage,
  releaseAllTokensInPage,
  restoreActorSystemInPage,
  restoreModuleFlagsInPage,
  snapshotActorSystemInPage,
  snapshotActorsModuleFlagsInPage,
  snapshotModuleFlagsInPage,
} from './support/actor-pages.mjs';
import {
  closeWindowsMatchingInPage,
  createItemsInPage,
  createStatusEffectWithSecondsInPage,
  deleteEffectsByIdsInPage,
  deleteItemsByIdsInPage,
  guardianSwitchStateInPage,
  installHookErrorRecorderInPage,
  installModuleSheetRenderRecorderInPage,
  preparedPathNumberInPage,
  itemFlagMatchesInPage,
  clickLoupButtonInPage,
  loupButtonInPage,
  noWindowMatchesInPage,
  openActorSheetInPage,
  openItemSheetInPage,
  readHookErrorsInPage,
  readItemInventoryInPage,
  readItemPathsInPage,
  readModuleSheetPassesInPage,
  readPreparedAndSourceInPage,
  restoreItemSystemInPage,
  setItemFlagInPage,
  sheetRenderedInPage,
  snapshotEffectStatusesInPage,
  strayRecapIdsInPage,
  snapshotItemFlagsInPage,
  snapshotItemSystemInPage,
  toggleStatusInPage,
  updateItemInPage,
} from './support/sheet-pages.mjs';
import { replayFixture } from './support/replay.mjs';
import { deepEqualJson, flagNamespacesEqual } from './support/compare.mjs';

/* global process */

if (respawnPreservingSymlinks()) {
  // Parent: the symlink-preserving child inherited stdio and carries the run.
} else {
  const Framework = await loadFramework();
  main(Framework).catch((err) => {
    console.error(`\nE2E HOOKS/SHEETS FAIL: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });
}

const SCENE_ID = 'kdtSceneMainAAAA';
const VIC_ACTOR_ID = 'kdtVicKnightAAAA';
const VIC_TOKEN_ID = 'tkVicKnightAAAAA';
const ATK_ACTOR_ID = 'kdtAtkPnjAAAAAAA';
const VEH_ACTOR_ID = 'kdtVicVehiculeAA';
const MEC_ACTOR_ID = 'kdtVicMechaAAAAA';
const ARMOR_ITEM_ID = 'kdtArmKnightAAAA'; // the victim's embedded gen-4 armor ITEM (armure.base 100)

const FOUR_IDS = [VIC_ACTOR_ID, VEH_ACTOR_ID, MEC_ACTOR_ID, ATK_ACTOR_ID];

// LIVE seed facts (same baseline the Phase-3/4/5 suites gate on -- the boot gate re-reads them
// before any click).
const SEED_STATS = {
  armure: 100,
  sante: 20,
  cdf: 10,
  guardianArmure: 15, // equipements.guardian.armure.value
  wear: 'armure',
  jaugesSante: false, // gen-4 ITEM mirror pin
};

// Number derivations for this suite's mutations (standard fixture: percearmure 40, penetrant 6 ->
// EFFECTIVE CdF 10-6 = 4; victim armure 100, sante 20, guardian stored 15):
//   target 104: damage 104-4=100 -> armure absorbs EXACTLY 100 (armure 0 AND damage 0 -> the
//     guardian track never even applies) -> carry trunc(100/5)=20 = sante EXACTLY 0. recap EXACT
//     {armure:100, sante:20} + both lines printed; apply()'s ==0 gate fires.
//   target 34: damage 30 -> armure 70, carry trunc(30/5)=6 -> sante 14. recap EXACT {armure:30,
//     sante:6}. C revert on top of the guardian switch (system.armure.value := stored 15 FIRST):
//     armure 15+30=45, sante 14+6=20.
//   target 14 + full-bypass weapon (E pair): bypass stands -> CdF ignored, armure skipped ->
//     recap {armure:0, sante:14}, sante 6; loup-neutralised -> CdF 10 bites, armor absorbs 4 ->
//     recap {armure:4, sante:0}, armure 96.
const RECAP_HEADER = 'Récapitulatif des dégâts';

// ── Page-context helpers (stringify rule: no closures; values arrive as trailing args) ──

// waitFor predicate: every expected stat matches (subset-pinned; the read is INLINED). wear and
// jaugesSante are Phase-6 first-class state.
const statsMatchInPage = (actorId, expected) => {
  const src = game.actors.get(actorId).system;
  const s = {
    armure: src.armure?.value ?? null,
    sante: src.sante?.value ?? null,
    cdf: src.champDeForce?.value ?? null,
    guardianArmure: src.equipements?.guardian?.armure?.value ?? null,
    wear: src.wear ?? null,
    jaugesSante: src.jauges?.sante ?? null,
  };
  for (const [key, value] of Object.entries(expected)) if (s[key] !== value) return null;
  return s;
};

// Node-side deep diff: the first differing leaf PATHS (boot -> end) when a byte-level system
// self-check fails -- the self-diagnosing channel that turns a byte mismatch into a named field.
function jsonDiffPaths(a, b, prefix = '', out = []) {
  if (out.length >= 60) return out;
  if (a === b) return out;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    out.push(`${prefix}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    return out;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (!(key in a)) out.push(`${p}: <absent> -> ${JSON.stringify(b[key])}`);
    else if (!(key in b)) out.push(`${p}: ${JSON.stringify(a[key])} -> <absent>`);
    else jsonDiffPaths(a[key], b[key], p, out);
    if (out.length >= 60) break;
  }
  return out;
}

// One-shot diagnostic read (self-diagnosing waits: every waitForStats failure embeds the ACTUAL
// victim+ITEM state in the error text -- the live-debug channel that replaces screenshot reading).
const statsProbeInPage = (actorId) => {
  const src = game.actors.get(actorId).system;
  const item = game.actors.get(actorId).items?.get('kdtArmKnightAAAA');
  return {
    armure: src.armure?.value ?? null,
    sante: src.sante?.value ?? null,
    cdf: src.champDeForce?.value ?? null,
    guardianArmure: src.equipements?.guardian?.armure?.value ?? null,
    wear: src.wear ?? null,
    jaugesSante: src.jauges?.sante ?? null,
    itemGen: item?.system?.generation ?? null,
    itemJaugesSante: item?.system?.jauges?.sante ?? null,
    tempStatuses: game.actors.get(actorId).temporaryEffects.map((e) => Array.from(e.statuses ?? [])),
  };
};

// The suite-end chat leak scan (boot-persistent journal).
const recapCountInPage = () =>
  game.messages.contents.filter((m) => m.flags?.['knight-damage']?.isRecap === true).length;

// Flip wait predicate (wear==guardian) shared by the negative cases.
const wearGuardianInPage = (actorId) =>
  game.actors.get(actorId)?.system.wear === 'guardian' ? { wear: 'guardian' } : null;

async function main(Framework) {
  acquireSpawnMutex(); // ownership before ANYTHING (see support/spawn-lock.mjs)
  const fw = new Framework(config);
  const results = [];
  const push = (label, ok, detail = '') => {
    results.push({ label, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  };

  const standard = loadRecordedFixture(STANDARD_FIXTURE_NAME);
  console.log(
    `[hooks] fixture loaded: standard (knight ${standard.meta.knightSystemVersion}, core ${standard.meta.coreVersion})`,
  );

  const shot = async (name) => {
    await fw.screenshot(`${name}.png`).catch(() => {});
  };

  const caseFailures = [];

  // ── shared node-side plumbing (closures over fw) ──
  async function replay(mutate, speaker) {
    return replayFixture(fw, standard.message, mutate, speaker, 'hooks');
  }
  const mutateTarget = (value) => (m) => {
    m.flags.knight.targets[0].value = value;
  };
  const mutateRawEffects = (raw) => (m) => {
    m.flags.knight.weapon.effets.raw = raw;
  };

  async function waitForStats(expected, tag) {
    try {
      return await fw.waitFor(statsMatchInPage, 15000, VIC_ACTOR_ID, expected);
    } catch {
      const actual = await fw.executeInFoundry(statsProbeInPage, VIC_ACTOR_ID).catch(() => null);
      throw new Error(
        `${tag}: victim stats never reached ${JSON.stringify(expected)} -- actual ${JSON.stringify(actual)}`,
      );
    }
  }

  // One damage application on the VICTIM (the controlled token keys createDamageObject), recap
  // discovered by flag+exclusion (sunk AT discovery), stats waited to the expected shape.
  async function applyDamageAndAwait(msgId, action, expectedStats, recapSink, tag) {
    await fw.executeInFoundry(controlTokenInPage, VIC_TOKEN_ID);
    const preIds = await fw.executeInFoundry(listMessageIdsInPage);
    await fw.waitFor(clickOnMessageCard, 15000, msgId, `button[data-action="${action}"]`);
    const recap = await fw.waitFor(findNewRecapMessageInPage, 15000, preIds);
    if (recap?.ids) recapSink.push(...recap.ids);
    if (!recap || recap.error) throw new Error(`recap message discovery failed: ${recap?.error ?? 'timeout'}`);
    recapSink.push(recap.id);
    const stats = await waitForStats(expectedStats, `${tag} apply`);
    return { recap, stats };
  }

  // null on timeout (the EXPECTED end of every auto-switch NEGATIVE pin -- the timeout itself is
  // evidence, never a case error).
  async function flipWaitOrNot(ms = 4000) {
    try {
      return await fw.waitFor(wearGuardianInPage, ms, VIC_ACTOR_ID);
    } catch {
      return null;
    }
  }

  // THE guardian-switch lever: the armor ITEM generation=3 + stored jauges.sante=true. (gen 4
  // defineProperty-kills the leaf every prepare AND re-forces the actor wear pin; the actor-level
  // system.jauges write is NOT the lever -- #setJauges MIRRORS the ITEM under wear 'armure'.)
  // WAITED on ITEM gen + ITEM jauges + ACTOR mirror.
  async function setGuardianLever(on) {
    await fw.executeInFoundry(
      updateItemInPage,
      VIC_ACTOR_ID,
      ARMOR_ITEM_ID,
      on ? { 'system.generation': 3, 'system.jauges.sante': true } : { 'system.generation': 4 },
    );
    await fw.waitFor(
      (aid, iid, wantGen, wantSante) => {
        const item = game.actors.get(aid)?.items?.get(iid);
        const actor = game.actors.get(aid);
        if (item?.system?.generation !== wantGen) return null;
        if (item?.system?.jauges?.sante !== wantSante) return null;
        if (actor?.system?.jauges?.sante !== wantSante) return null;
        return { gen: wantGen, mirrored: true };
      },
      15000,
      VIC_ACTOR_ID,
      ARMOR_ITEM_ID,
      on ? 3 : 4,
      on,
    );
  }

  async function openVicSheet() {
    await fw.executeInFoundry(openActorSheetInPage, VIC_ACTOR_ID);
    await fw.waitFor(sheetRenderedInPage, 15000, 'actor', VIC_ACTOR_ID);
  }

  async function probeSwitch(tag) {
    const state = await fw.executeInFoundry(guardianSwitchStateInPage, VIC_ACTOR_ID, ARMOR_ITEM_ID);
    console.log(`[hooks] PROBE ${tag}: ${JSON.stringify(state)}`);
    return state;
  }

  // The A-mechanism discriminator: EVERY victim preUpdateActor payload since boot (apply's own
  // writes AND the knight system's unawaited equipements-leaf mirror, knight.mjs:848-858). hs2 saw
  // the prepared armure bounce 0 -> 100 after the exact-0 apply under the gen-4 seed while hs1 saw
  // 0 stick -- the payload ORDER/KEYS decide whether the mirror or the gen-4 ITEM re-pin won.
  async function dumpActorUpdates(tag, victimOnly = true) {
    const updates = await fw.executeInFoundry(readActorUpdatesInPage);
    const vic = victimOnly ? updates.filter((u) => u.id === VIC_ACTOR_ID) : updates;
    console.log(
      `[hooks] PROBE actor-updates ${tag}: ${vic.length}/${updates.length} preUpdateActor payload(s) since boot (last 14):`,
    );
    const flat = (obj, prefix, out) => {
      for (const [k, v] of Object.entries(obj ?? {})) {
        if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, `${prefix}${k}.`, out);
        else out[`${prefix}${k}`] = JSON.stringify(v).slice(0, 80);
      }
      return out;
    };
    for (const u of vic.slice(-14)) {
      console.log(`[hooks]   payload: ${JSON.stringify(flat(u.data, '', {}))}`);
    }
  }

  async function snapshotCaseBaseline() {
    return {
      system: await fw.executeInFoundry(snapshotActorSystemInPage, VIC_ACTOR_ID),
      flags: await fw.executeInFoundry(snapshotModuleFlagsInPage, VIC_ACTOR_ID),
      itemSystem: await fw.executeInFoundry(snapshotItemSystemInPage, VIC_ACTOR_ID, ARMOR_ITEM_ID),
      effects: await fw.executeInFoundry(snapshotEffectStatusesInPage, VIC_ACTOR_ID),
      inventory: await fw.executeInFoundry(readItemInventoryInPage, VIC_ACTOR_ID),
    };
  }

  // THE Phase-6 poisoning half: windows AND tokens AND messages AND effects AND items AND the
  // armor ITEM's whole system subtree are restored, and the SEED stats + the gen-4 ITEM mirror
  // are WAITED before the next case starts (back-to-back validity).
  async function cleanupCase(baseline, ctx) {
    await fw.executeInFoundry(closeWindowsMatchingInPage, 'Sheet', '').catch(() => {});
    await fw.executeInFoundry(releaseAllTokensInPage).catch(() => {});
    if (ctx.msgIds.length) {
      await fw
        .executeInFoundry(deleteMessagesInPage, ctx.msgIds.filter(Boolean))
        .catch((err) => console.log(`[hooks] cleanup message-delete FAILED: ${err.message ?? err}`));
    }
    if (ctx.effectIds.length) {
      await fw
        .executeInFoundry(deleteEffectsByIdsInPage, VIC_ACTOR_ID, ctx.effectIds)
        .catch((err) => console.log(`[hooks] cleanup effect-delete FAILED: ${err.message ?? err}`));
    }
    if (ctx.itemIds.length) {
      await fw
        .executeInFoundry(deleteItemsByIdsInPage, VIC_ACTOR_ID, ctx.itemIds)
        .catch((err) => console.log(`[hooks] cleanup item-delete FAILED: ${err.message ?? err}`));
    }
    // ITEM subtree FIRST (gen 4 + stored jauges): the actor prepare then re-pins wear AND the
    // jauges mirror through the system's own defineProperty machinery.
    await fw
      .executeInFoundry(restoreItemSystemInPage, VIC_ACTOR_ID, ARMOR_ITEM_ID, baseline.itemSystem)
      .catch((err) => console.log(`[hooks] cleanup ITEM-restore FAILED: ${err.message ?? err}`));
    await fw
      .executeInFoundry(restoreActorSystemInPage, VIC_ACTOR_ID, baseline.system)
      .catch((err) => console.log(`[hooks] cleanup actor-restore FAILED: ${err.message ?? err}`));
    await fw
      .executeInFoundry(restoreModuleFlagsInPage, VIC_ACTOR_ID, baseline.flags)
      .catch((err) => console.log(`[hooks] cleanup flag-restore FAILED: ${err.message ?? err}`));
    await waitForStats(SEED_STATS, 'cleanup');
    await fw.waitFor(
      (aid, iid) => {
        const item = game.actors.get(aid)?.items?.get(iid);
        return item?.system?.generation === 4 && item?.system?.jauges?.sante === false ? { gen: 4 } : null;
      },
      10000,
      VIC_ACTOR_ID,
      ARMOR_ITEM_ID,
    );
  }

  // Snapshot -> body -> cleanup, with cleanup ALWAYS running (even after a case throw) and its
  // own failures recorded separately.
  async function runCase(name, fn) {
    const ctx = { msgIds: [], effectIds: [], itemIds: [], _baselineEffectIds: [] };
    let baseline = null;
    try {
      baseline = await snapshotCaseBaseline();
      ctx._baselineEffectIds = baseline.effects.map((e) => e.id);
      await fn(ctx, baseline);
    } catch (err) {
      caseFailures.push(`${name}: ${err.message ?? err}`);
      await shot(`hooks-${name}`);
      push(`${name} completes without infrastructure error`, false, `threw: ${err.stack ?? err}`);
    }
    // A case that THREW mid-apply may have already created its recap (never discovered => never
    // sunk into ctx.msgIds). Sweep EVERY still-living isRecap message BEFORE the restore (this
    // also pre-deletes the correctly-sunk ones, whose delete cleanup would otherwise redo as a
    // tolerated no-op) so a failed case can never poison the boot-persistent journal for the
    // NEXT case or the next run (the suite-end zero-recap self-check stays meaningful).
    try {
      const strays = await fw.executeInFoundry(strayRecapIdsInPage);
      if (strays?.length) {
        console.log(
          `[hooks] ${name}: sweeping ${strays.length} still-living recap(s) before restore: ${strays.join(',')}`,
        );
        await fw.executeInFoundry(deleteMessagesInPage, strays);
      }
    } catch (err) {
      console.log(`[hooks] ${name}: recap stray sweep FAILED: ${err.message ?? err}`);
    }
    try {
      if (baseline) await cleanupCase(baseline, ctx);
    } catch (err) {
      caseFailures.push(`${name}-cleanup: ${err.message ?? err}`);
      push(`${name} cleanup restores the seed state`, false, `threw: ${err.stack ?? err}`);
    }
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
      activeGM: game.users.activeGM?.id ?? null,
    }));
    console.log(
      `[hooks] knight ${boot.knight} / core ${boot.core} / lang ${boot.lang} / scene ${boot.scene} vic=${boot.vicType} activeGM=${boot.activeGM}`,
    );
    if (boot.vicType !== 'knight') throw new Error('victim token missing or not a knight on the active scene');
    if (boot.lang !== 'fr') throw new Error(`chat HTML contract is French but game.i18n.lang=${boot.lang}`);

    await fw.executeInFoundry(installHookErrorRecorderInPage);
    await fw.executeInFoundry(installModuleSheetRenderRecorderInPage);
    await fw.executeInFoundry(installActorUpdateCounterInPage); // idempotent per boot (support/actor-pages.mjs:55)

    // Poisoning gate: boot baselines (system bytes, flag namespaces, ITEM bytes, effects, items)
    // + the live SEED stats.
    const bootSystems = [];
    for (const id of FOUR_IDS) bootSystems.push(await fw.executeInFoundry(snapshotActorSystemInPage, id));
    const bootFlags = await fw.executeInFoundry(snapshotActorsModuleFlagsInPage, FOUR_IDS);
    const bootItemSystem = await fw.executeInFoundry(snapshotItemSystemInPage, VIC_ACTOR_ID, ARMOR_ITEM_ID);
    const bootItemFlags = await fw.executeInFoundry(snapshotItemFlagsInPage, VIC_ACTOR_ID, ARMOR_ITEM_ID);
    const bootEffects = await fw.executeInFoundry(snapshotEffectStatusesInPage, VIC_ACTOR_ID);
    const bootInventory = await fw.executeInFoundry(readItemInventoryInPage, VIC_ACTOR_ID);
    await waitForStats(SEED_STATS, 'boot gate');
    console.log(`[hooks] boot baselines captured (${FOUR_IDS.length} actors + ITEM ${ARMOR_ITEM_ID})`);

    // Built HERE (post-fw.start) so the module-scope consts below the entry block are initialized.
    const victimSpeaker = { scene: SCENE_ID, token: VIC_TOKEN_ID, actor: VIC_ACTOR_ID };

    // ══════════════ case A: armure EXACTLY 0, COLD render (must run FIRST) ══════════════
    await runCase('caseA-armure-exactly-0-cold-race', async (ctx) => {
      console.log('=== hooks-sheets: A armure EXACTLY 0 (target 104) under the gen-4 seed, cold sheet ===');
      const preGate = await fw.executeInFoundry(
        readPreparedAndSourceInPage,
        VIC_ACTOR_ID,
        ['wear', 'jauges.sante', 'armure.value', 'sante.value'],
        ['system.wear', 'system.jauges.sante'],
      );
      const preItem = await fw.executeInFoundry(readItemPathsInPage, VIC_ACTOR_ID, ARMOR_ITEM_ID, [
        'system.generation',
        'system.jauges.sante',
        'system.armure.base',
        'system.armure.value',
      ]);
      console.log(
        `[hooks] PROBE A gen-4 pin before damage: ${JSON.stringify(preGate)} | ITEM ${JSON.stringify(preItem)}`,
      );
      push(
        'casA: pin gen-4 du SEED avant degats : wear PREPARE arrete a armure ET _source.system.wear = armure, ITEM prepare jauges.sante = FALSE (defineProperty gen-4 infalsifiable), armure.base = 100 sans feuille armure.value',
        preGate.prepared.wear === 'armure' &&
          preGate.source['system.wear'] === 'armure' &&
          preGate.prepared['jauges.sante'] === false &&
          preItem['system.generation'] === 4 &&
          preItem['system.jauges.sante'] === false &&
          preItem['system.armure.base'] === 100 &&
          preItem['system.armure.value'] === null,
      );

      const msg = await replay(mutateTarget(104), victimSpeaker);
      ctx.msgIds.push(msg);
      // The armure leaf is DELIBERATELY absent from the waited stats: under the gen-4 seed the
      // knight model re-pins the equipements.armure leaf from the ITEM base 100 at every prepare
      // (the exact-0 write is the ONE damage outcome that erases itself), while sante/cdf/wear
      // writes stick. hs2 live proof: actual {armure:100, sante:0}. The stored-vs-prepared truth
      // is decided by the sides probe + the preUpdateActor payload dump below.
      const { recap, stats } = await applyDamageAndAwait(
        msg,
        'applyDamage',
        { sante: 0, cdf: 10, wear: 'armure', jaugesSante: false },
        ctx.msgIds,
        'A-104',
      );
      push(
        'casA: cible 104 -> recap EXACT {armure:100, sante:20} (absorption EXACTEMENT 100, damage 0 -> piste guardian jamais appliquee, puis retombee trunc(100/5)=20 = sante PILE 0) + lignes « Armure : 100 »/« Santé : 20 » + flag wear du recap = armure',
        JSON.stringify(recap.recap) === JSON.stringify({ armure: 100, sante: 20 }) &&
          recap.content.includes(RECAP_HEADER) &&
          recap.content.includes('Armure : 100') &&
          recap.content.includes('Santé : 20') &&
          recap.flags.wear === 'armure' &&
          stats.wear === 'armure',
      );

      // apply()'s ==0 gate FIRED switchArmure (damageKnight.js:238-239). THE race, pinned AS a
      // race (live runs disagree on purpose): the gate proof is the payload chain (apply x2,
      // mirror x2, then the module-opened sheet's own CLOSE-SUBMIT writing name+form+leaf). The
      // cold-open aftermath is timing-dependent: hs1 left the sheet OPEN (+10ms close no-op while
      // RENDERING), hs3 closed it INSIDE the body (+10ms close landed after the render completed
      // -> the v14 close SUBMITTED the just-rendered knight form). What IS deterministic: zero
      // flip (gen-4 mirror => no guardian button to click) and wear armure.
      const flip = await flipWaitOrNot(4000);
      const after = await probeSwitch('A post-apply switch state');
      const windowsClosed = (await fw.executeInFoundry(noWindowMatchesInPage, 'Sheet', ''))?.closed === true;
      push(
        `casA: course-froide epinglee LIVE : AUCUN basculement DETERMINISTE (flip = ${flip === null ? 'timeout ATTENDU' : JSON.stringify(flip)}, wear armure) ; etat de fenetre NON epingle car RACIAL live (windowsClosed=${windowsClosed}, feuille rendue=${after.sheetRendered}, boutons guardian=${after.guardianButtonCount} : -1=fermee, 0=ouverte mais gen-4 vide) -- la porte ==0 a BIEN ouvert la feuille via switchArmure (preuve au dump de payloads) et le click +1ms du module n'a RIEN trouve ; controle positif deterministe = A2`,
        flip === null &&
          after.actorWear === 'armure' &&
          (after.guardianButtonCount === -1 || after.guardianButtonCount === 0),
      );

      const sides = await fw.executeInFoundry(
        readPreparedAndSourceInPage,
        VIC_ACTOR_ID,
        ['armure.value', 'sante.value'],
        ['system.armure.value', 'system.sante.value'],
      );
      console.log(`[hooks] PROBE A stored-vs-prepared after exact-0 apply: ${JSON.stringify(sides)}`);
      await dumpActorUpdates('A');
      push(
        "casA: etat final exact-0 cote RACE : sante 0 des DEUX cotes (partout persiste), armure stockee+preparee dans [0,100] (live hs3 : 0/0 -- la re-soumission du formulaire a la fermeture a elle aussi ecrit la feuille a 0 ; le 100 d'une ancienne inter-rotation venait d'une ecriture derivee complete) -- le dump preUpdateActor epingle la CHAINE complete apply x2 -> miroir equipements x2 -> SUBMIT DE CLOTURE du sheet ouvert par le module",
        sides.prepared['sante.value'] === 0 &&
          sides.source['system.sante.value'] === 0 &&
          sides.prepared['armure.value'] >= 0 &&
          sides.prepared['armure.value'] <= 100 &&
          sides.source['system.armure.value'] >= 0 &&
          sides.source['system.armure.value'] <= 100,
      );
    });

    // ══════════════ case A2: gen-3 lever + PRE-OPENED sheet (positive) ══════════════
    await runCase('caseA2-presheet-switch', async (ctx) => {
      console.log('=== hooks-sheets: A2 exact-0 switch, gen-3 ITEM lever + pre-opened sheet ===');
      await setGuardianLever(true);
      await openVicSheet();
      const before = await probeSwitch('A2 pre-damage switch state');
      push(
        'casA2: le levier ITEM {generation:3, jauges.sante:true} rend lITEM jauges.sante = true ET le MIROIR acteur jauges.sante = true, et la feuille PRE-OUVERTE render exactement UN bouton .armure[data-type=guardian]',
        before.guardianButtonCount === 1 && before.actorJaugesSante === true && before.itemJaugesSante === true,
      );

      const msg = await replay(mutateTarget(104), victimSpeaker);
      ctx.msgIds.push(msg);
      // The waited end-state IS the positive flip pin: wear guardian, system.armure.value := the
      // guardian stored 15, sante stays 0.
      const { stats } = await applyDamageAndAwait(
        msg,
        'applyDamage',
        { wear: 'guardian', armure: 15, sante: 0 },
        ctx.msgIds,
        'A2-104',
      );
      const sides = await fw.executeInFoundry(
        readPreparedAndSourceInPage,
        VIC_ACTOR_ID,
        ['wear', 'armure.value', 'sante.value'],
        ['system.wear', 'system.armure.value', 'system.sante.value'],
      );
      push(
        'casA2: feuille PRE-OUVERTE + porte armure==0 : le click +1ms du module TOMBE, basculement guardian DETERMINISTE des deux cotes (prepare ET _source wear guardian), system.armure.value = 15 = la valeur guardian stockee par le handler sortant, sante 0 intact',
        stats.wear === 'guardian' &&
          sides.prepared.wear === 'guardian' &&
          sides.source['system.wear'] === 'guardian' &&
          sides.prepared['armure.value'] === 15 &&
          sides.prepared['sante.value'] === 0,
      );

      // opened=false branch: a sheet the module did NOT open is never auto-closed.
      const after = await probeSwitch('A2 post-switch switch state');
      push(
        "casA2: opened=false respecte : la feuille ouverte par le TEST reste rendue apres le switch (le module n'a PAS ferme une feuille qu'il n'a pas ouverte)",
        after.sheetRendered === true && after.actorWear === 'guardian',
      );

      // The system's leave-armure ITEM write (knight-sheet.mjs:324) is schema-DROPPED.
      const itemPaths = await fw.executeInFoundry(readItemPathsInPage, VIC_ACTOR_ID, ARMOR_ITEM_ID, [
        'system.armure.value',
        '_source.system.armure.value',
        'system.armure.base',
      ]);
      console.log(`[hooks] PROBE A2 post-switch ITEM paths: ${JSON.stringify(itemPaths)}`);
      push(
        "casA2: l'ECRITURE SORTANTE du systeme sur l'ITEM d'armure (knight-sheet.mjs:324, system.armure.value) est ANNULEE PAR LE SCHEMA v14 : cle absente du prepare ET du _source, armure.base intact a 100 (l'ITEM n'a JAMAIS porte la feuille -- la cle du pin « ITEM 70/0 » du plan n'existait pas)",
        itemPaths['system.armure.value'] === null &&
          itemPaths['_source.system.armure.value'] === null &&
          itemPaths['system.armure.base'] === 100,
      );
    });

    // ══════════════ case A3: gen-4 + PRE-OPENED sheet (negative) ══════════════
    await runCase('caseA3-gen4-negative', async (ctx) => {
      console.log('=== hooks-sheets: A3 exact-0, gen-4 seed, sheet PRE-OPENED (negative control) ===');
      await openVicSheet();
      const before = await probeSwitch('A3 pre-damage switch state');
      if (before.guardianButtonCount !== 0 || before.actorJaugesSante !== false) {
        throw new Error(`precondition: gen-4 sheet must render NO guardian button, got ${JSON.stringify(before)}`);
      }
      const msg = await replay(mutateTarget(104), victimSpeaker);
      ctx.msgIds.push(msg);
      await applyDamageAndAwait(msg, 'applyDamage', { sante: 0, cdf: 10, wear: 'armure' }, ctx.msgIds, 'A3-104');
      const flip = await flipWaitOrNot(4000);
      const after = await probeSwitch('A3 post-apply switch state');
      push(
        "casA3: gen-4 avec feuille PRE-OUVERTE ET sous la main : zero bouton guardian (miroir ITEM gen-4) donc AUCUN basculement malgre la porte armure==0 declenchee -- le click +1ms du module frappe un set jQuery VIDE; le levier est BIEN lITEM (generation), pas les jauges de l'acteur",
        flip === null && after.actorWear === 'armure' && after.guardianButtonCount === 0,
      );
      const sides = await fw.executeInFoundry(
        readPreparedAndSourceInPage,
        VIC_ACTOR_ID,
        ['armure.value', 'sante.value'],
        ['system.armure.value', 'system.sante.value'],
      );
      console.log(`[hooks] PROBE A3 stored-vs-prepared after exact-0 apply: ${JSON.stringify(sides)}`);
      await dumpActorUpdates('A3');
      push(
        "casA3: DISCRIMINANT de la course (feuille DEJA ouverte avant les degats : le module n'en ouvre aucune, donc AUCUN submit de cloture pendant le corps du cas -- dump = apply x2 + miroir x2 seulement) : armure 0 des DEUX cotes ET preparee 0 (le 0 persiste la ou A l'a vu re-ecrit par sa course), sante 0 -- la feuille ouverte sous la main ne re-epingle RIEN ; l'ecart de final d'armure entre A et A3 vient de la fenetre PROPRE du module (submit de cloture), pas du prepare gen-4",
        sides.prepared['armure.value'] === 0 &&
          sides.source['system.armure.value'] === 0 &&
          sides.prepared['sante.value'] === 0 &&
          sides.source['system.sante.value'] === 0,
      );
    });

    // ══════════════ case B: folde (duration effect) blocks the switch ══════════════
    await runCase('caseB-folde-blocks-switch', async (ctx) => {
      console.log('=== hooks-sheets: B folde via ActiveEffect DUREE bloque la porte (levier ON, bouton present) ===');
      const toggled = await fw.executeInFoundry(toggleStatusInPage, VIC_ACTOR_ID, 'folde', true);
      console.log(`[hooks] PROBE B bare-toggle folde -> effectStatuses/tempStatuses: ${JSON.stringify(toggled)}`);
      const created = await fw.executeInFoundry(createStatusEffectWithSecondsInPage, VIC_ACTOR_ID, 'folde', 300);
      if (!created?.ids?.length) throw new Error(`folde duration-effect creation failed: ${JSON.stringify(created)}`);
      ctx.effectIds.push(...created.ids);
      console.log(`[hooks] PROBE B duration-effect -> ids/tempStatuses: ${JSON.stringify(created)}`);
      // the bare toggle is INVISIBLE to temporaryEffects (it even surfaces as a persistent
      // 'Bloque folde' row) -- only the DURATION effect lands the status where hasStatusEffect
      // (helpers.js: active && isTemporary) actually looks; cleanup deletes the toggle residue via
      // the end-of-case effect-baseline diff below.
      push(
        "casB: toggle SANS DUREE = preuve systeme seulement (invisible a temporaryEffects) : l'ActiveEffect avec duree expliCITE est seul a placer folde dans temporaryEffects (tempStatuses contient folde)",
        JSON.stringify(created.tempStatuses).includes('folde'),
      );

      await setGuardianLever(true); // the ONLY difference vs A2 is folde -- the button EXISTS
      await openVicSheet(); // MUST precede the gate probe: guardianButtonCount is a SHEET-DOM read
      const gate = await probeSwitch('B post-lever+folde switch state');
      if (gate.foldeTemporary !== true || gate.guardianButtonCount !== 1) {
        throw new Error(`precondition: folde in temporaryEffects + guardian button, got ${JSON.stringify(gate)}`);
      }

      const msg = await replay(mutateTarget(104), victimSpeaker);
      ctx.msgIds.push(msg);
      const { recap, stats } = await applyDamageAndAwait(
        msg,
        'applyDamage',
        { armure: 0, sante: 0 },
        ctx.msgIds,
        'B-104',
      );
      push(
        'casB: repartition octet-identique a A2 (recap EXACT {armure:100, sante:20}, armure 0 / sante 0) -- la SEULE difference est la porte folde',
        JSON.stringify(recap.recap) === JSON.stringify({ armure: 100, sante: 20 }) && stats.wear === 'armure',
      );
      const flip = await flipWaitOrNot(4000);
      const after = await probeSwitch('B post-apply switch state');
      const itemPaths = await fw.executeInFoundry(readItemPathsInPage, VIC_ACTOR_ID, ARMOR_ITEM_ID, [
        'system.armure.value',
        'system.generation',
      ]);
      push(
        "casB: porte folde = AUCUN switchArmure (clause !hasStatusEffect(folde) de apply()) : flip absent (timeout attendu), wear armure malgre le levier ON et le bouton present, ITEM jamais touchee (gen 3 du levier intact, armure.value toujours absent) -- le module n'a RIEN ouvert ni ferme",
        flip === null &&
          after.actorWear === 'armure' &&
          itemPaths['system.armure.value'] === null &&
          itemPaths['system.generation'] === 3,
      );

      // the bare-toggle residue: delete every effect the case ADDED vs its baseline (the toggle
      // creates a persistent 'Bloque folde' effect whose id the toggle API never returns).
      const nowEffects = await fw.executeInFoundry(snapshotEffectStatusesInPage, VIC_ACTOR_ID);
      const strays = nowEffects.filter((e) => !ctx._baselineEffectIds.includes(e.id)).map((e) => e.id);
      if (strays.length) {
        await fw
          .executeInFoundry(deleteEffectsByIdsInPage, VIC_ACTOR_ID, strays)
          .catch((err) => console.log(`[hooks] B stray-toggle delete FAILED: ${err.message ?? err}`));
      }
    });

    // ══════════════ case C: revert with re-stamped wear flag ══════════════
    await runCase('caseC-revert-wear-switch', async (ctx) => {
      console.log(
        '=== hooks-sheets: C revert avec flag wear re-appose guardian -> switch systeme PUIS recap dessus ===',
      );
      await setGuardianLever(true); // the revert's switchArmure needs the button rendered
      const msg = await replay(mutateTarget(34), victimSpeaker);
      ctx.msgIds.push(msg);
      const { recap } = await applyDamageAndAwait(msg, 'applyDamage', { armure: 70, sante: 14 }, ctx.msgIds, 'C-34');
      push(
        'casC: application 34 -> recap EXACT {armure:30, sante:6}, armure 70 / sante 14, AUCUN basculement (porte armure==0 non satisfaite), flag wear du recap = armure',
        JSON.stringify(recap.recap) === JSON.stringify({ armure: 30, sante: 6 }) && recap.flags.wear === 'armure',
      );

      // Re-stamp the recap wear flag to 'guardian' (the ONLY way the damageKnight.js:202 revert
      // branch is reachable in this world) and read the DOCUMENT back BEFORE the click.
      await fw.executeInFoundry(
        (id) => game.messages.get(id)?.update({ flags: { 'knight-damage': { wear: 'guardian' } } }),
        recap.id,
      );
      const restamp = await fw.executeInFoundry(messageFlagsInPage, recap.id, 'knight-damage.wear');
      console.log(`[hooks] PROBE C recap wear re-stamp readback: ${JSON.stringify(restamp)}`);
      push(
        'casC: re-apposition du flag wear du recap (update flags) RELUE = guardian sur le document avant tout click',
        restamp.value === 'guardian',
      );

      await openVicSheet();
      const before = await probeSwitch('C pre-revert switch state');
      if (before.guardianButtonCount !== 1) {
        throw new Error(`precondition: guardian button must be rendered before revert, got ${JSON.stringify(before)}`);
      }

      // The revert: switchArmure('guardian') lands its +1ms click on the PRE-RENDERED sheet, and
      // the +100ms setActorStats then re-reads the POST-switch actor (system.armure.value := the
      // guardian stored 15 -- the system handler overwrite knight-sheet.mjs:308-309) and re-adds
      // the recap: STORED armure 15+30=45, sante 14+6=20. But every prepare re-clamps the prepared
      // armure to the ACTIVE equipment leaf (knight-data-model #derived/setValue: value :=
      // min(equipements[wear][name].value, max)) -- under wear guardian that leaf caps at 15, so
      // the PREPARED end-state is armure 15 over stored 45, and the switch to guardian also drags
      // prepared CdF to the guardian leaf's 5. revert's own apply() gate (armure 45) NEVER
      // re-fires, so the end state is the single pinned set below.
      await fw.executeInFoundry(controlTokenInPage, VIC_TOKEN_ID);
      await fw.waitFor(clickOnMessageCard, 15000, recap.id, 'button.revert-damage');
      const reverted = await waitForStats(
        { wear: 'guardian', armure: 15, sante: 20, cdf: 5, jaugesSante: true },
        'C-revert',
      );
      const sides = await fw.executeInFoundry(
        readPreparedAndSourceInPage,
        VIC_ACTOR_ID,
        ['wear', 'armure.value', 'sante.value', 'champDeForce.value'],
        ['system.wear', 'system.armure.value', 'system.sante.value'],
      );
      console.log(`[hooks] PROBE C stored-vs-prepared after revert: ${JSON.stringify(sides)}`);
      push(
        'casC: revert (wear re-appose guardian) : switchArmure du module clique sur la feuille PRE-OUVERTE AVANT ses timers +100/+101ms, puis le recap est restaure PAR-DESSUS la piste guardian : STORED system.armure.value = 45 (15+30) MAIS prepare ramene 15 = clamp min(45, max guardian 15) re-applique a chaque prepare, sante 14+6=20 des DEUX cotes, CdF PREPARE 5 (feuille guardian), wear guardian des deux cotes',
        reverted.wear === 'guardian' &&
          sides.prepared['armure.value'] === 15 &&
          sides.source['system.armure.value'] === 45 &&
          sides.prepared['sante.value'] === 20 &&
          sides.source['system.sante.value'] === 20 &&
          sides.prepared['champDeForce.value'] === 5 &&
          sides.source['system.wear'] === 'guardian' &&
          sides.prepared.wear === 'guardian',
      );
      const itemPaths = await fw.executeInFoundry(readItemPathsInPage, VIC_ACTOR_ID, ARMOR_ITEM_ID, [
        'system.armure.value',
        '_source.system.armure.value',
        'system.armure.base',
      ]);
      console.log(
        `[hooks] PROBE C post-revert ITEM paths (the 70 armure exit-write target): ${JSON.stringify(itemPaths)}`,
      );
      push(
        "casC: cote ITEM du revert : l'ecriture sortante knight-sheet.mjs:324 (valeur d'armure 70 -> ITEM) est EGALEMENT annulee par le schema : armure.value absent du prepare ET du _source, armure.base = 100 intact",
        itemPaths['system.armure.value'] === null &&
          itemPaths['_source.system.armure.value'] === null &&
          itemPaths['system.armure.base'] === 100,
      );
    });

    // ══════════════ case D: loup module-sheet DOM half ══════════════
    await runCase('caseD-loup-sheet', async (ctx) => {
      console.log(
        '=== hooks-sheets: D module sheet loup : drapeau cree au 1er passe, 8 boutons live, click -> flag ===',
      );
      const created = await fw.executeInFoundry(createItemsInPage, VIC_ACTOR_ID, [
        { name: 'Instinct du loup', type: 'module' },
      ]);
      if (!created?.[0]?.id) throw new Error(`loup module-item creation failed: ${JSON.stringify(created)}`);
      const loupId = created[0].id;
      ctx.itemIds.push(loupId);
      push(
        'casD: un module-item FRAIS default system.active.base = FALSE (le point de depart du contract « actif quand falsy » du module, confirme live)',
        created[0].activeBase === false,
      );

      await fw.executeInFoundry(openItemSheetInPage, VIC_ACTOR_ID, loupId);
      await fw.waitFor(sheetRenderedInPage, 15000, 'item', VIC_ACTOR_ID, loupId);
      await new Promise((r) => setTimeout(r, 500)); // let the flag-write auto-rerender settle
      const passes = await fw.executeInFoundry(readModuleSheetPassesInPage);
      console.log(`[hooks] PROBE D renderModuleSheet passes: ${JSON.stringify(passes)}`);
      if (passes.length < 2) throw new Error(`expected >= 2 module-sheet render passes, got ${JSON.stringify(passes)}`);
      push(
        "casD: renderModuleSheet : passe 1 SANS flag et 0 bouton (cree la carte 8-cles unactive puis RETURN sans toucher le DOM), passe 2 (auto re-render du a l'ecriture du drapeau) AVEC le drapeau et les 8 boutons data-option reinjetes dans .niveau_n1 (le conteneur EXISTE des le schema details.n1 -> les boutons du module sont BIEN rendus live)",
        passes[0].hasFlag === false &&
          passes[0].optionButtons === 0 &&
          passes.some((p) => p.hasFlag === true && p.optionButtons === 8 && p.niveauN1 >= 1),
      );

      const btn = await fw.waitFor(loupButtonInPage, 15000, VIC_ACTOR_ID, loupId, 'percearmure');
      push(
        'casD: le bouton module button[data-option=percearmure] est rendu avec className = unactive (le drapeau miroir EXACT du className)',
        btn?.className === 'unactive',
      );
      const coexist = await fw.executeInFoundry(
        (aid, iid) => {
          const root = game.actors.get(aid).items.get(iid).sheet.element?.[0] ?? null;
          if (!root) return { moduleButtons: -1, systemRadios: -1, niveauN1: -1 };
          return {
            moduleButtons: root.querySelectorAll('button[data-option]').length,
            systemRadios: root.querySelectorAll('input[type="radio"]').length,
            niveauN1: root.querySelectorAll('.niveau_n1').length,
          };
        },
        VIC_ACTOR_ID,
        loupId,
      );
      console.log(`[hooks] PROBE D module/system coexist: ${JSON.stringify(coexist)}`);
      push(
        'casD: etat DOM final de la feuille module-item (live) : .niveau_n1 est rendu VIDE par le systeme pour un module-item frais (AUCUN input[type=radio] active.base : zero radio dans toute la feuille) et le module y PREPEND ses 8 boutons data-option, qui sont donc les seuls controles reels du conteneur',
        coexist.moduleButtons === 8 && coexist.niveauN1 >= 1 && coexist.systemRadios === 0,
      );

      const clicked = await fw.waitFor(clickLoupButtonInPage, 15000, VIC_ACTOR_ID, loupId, 'percearmure');
      if (!clicked?.found) throw new Error(`loup button click failed: ${JSON.stringify(clicked)}`);
      const flag = await fw.waitFor(itemFlagMatchesInPage, 15000, VIC_ACTOR_ID, loupId, 'loup', [
        ['choc', 'unactive'],
        ['degatscontinus', 'unactive'],
        ['percearmure', 'active'],
        ['peur', 'unactive'],
        ['ignorearmure', 'unactive'],
        ['ignorecdf', 'unactive'],
        ['drainenergie', 'unactive'],
        ['domination', 'unactive'],
      ]);
      push(
        'casD: UN seul click reel sur le bouton percearmure -> flag loup.percearmure = la chaine LITTERALE active (le className courant ecrit tel quel), les 7 autres cles restent unactive (moitie DOM live du contract epingle en unitaire)',
        flag?.value?.percearmure === 'active' &&
          Object.entries(flag?.value ?? {}).filter(([, v]) => v === 'active').length === 1,
      );
    });

    // ══════════════ case E: loup damage half, bypass-vs-neutralised pair ══════════════
    await runCase('caseE-loup-damage-pair', async (ctx, baseline) => {
      console.log('=== hooks-sheets: E la paire bypass / neutralise (cible 14, SEUL delta: les drapeaux loup) ===');
      const created = await fw.executeInFoundry(createItemsInPage, VIC_ACTOR_ID, [
        { name: 'Instinct du loup', type: 'module', system: { active: { base: false } } },
      ]);
      if (!created?.[0]?.id) throw new Error(`loup module-item creation failed: ${JSON.stringify(created)}`);
      const loupId = created[0].id;
      ctx.itemIds.push(loupId);

      const bypassMutate = (m) => {
        mutateTarget(14)(m);
        mutateRawEffects(['ignorearmure', 'ignorechampdeforce'])(m);
      };

      // (i) BYPASS stands: the loup item exists (applyInstinctDuLoup RUNS: name matches and
      // system.active.base falsy) but all 8 keys are 'unactive' -> every neutralization gated off.
      // CdF IGNORED (no subtraction at all -> recap.sante = the FULL 14), armure track skipped ->
      // {armure:0, sante:14}; sante 20-14=6, armor 100 intact.
      await fw.executeInFoundry(setItemFlagInPage, VIC_ACTOR_ID, loupId, 'loup', {
        choc: 'unactive',
        degatscontinus: 'unactive',
        percearmure: 'unactive',
        peur: 'unactive',
        ignorearmure: 'unactive',
        ignorecdf: 'unactive',
        drainenergie: 'unactive',
        domination: 'unactive',
      });
      const bypass = await replay(bypassMutate, victimSpeaker);
      ctx.msgIds.push(bypass);
      const b = await applyDamageAndAwait(bypass, 'applyDamage', { armure: 100, sante: 6 }, ctx.msgIds, 'E-bypass-14');
      push(
        'casE1: bypass complet (ignorearmure+ignorechampdeforce, loup unactive partout) : piste armure SAUTEE et CdF IGNORE -> recap EXACT {armure:0, sante:14} (aucune ligne « Armure : » imprimee : lignes truthy-only), armure intacte 100, sante 6',
        JSON.stringify(b.recap.recap) === JSON.stringify({ armure: 0, sante: 14 }) &&
          !b.recap.content.includes('Armure :') &&
          b.recap.content.includes('Santé : 14') &&
          b.stats.armure === 100 &&
          b.stats.sante === 6,
      );
      const rawProbe = await fw.executeInFoundry(messageFlagsInPage, bypass, 'knight.weapon.effets.raw');
      console.log(`[hooks] PROBE E bypass replayed message weapon raw: ${JSON.stringify(rawProbe)}`);

      // INTER-RUN RESTORE (live run 2: without it E2 starts on E1's damaged body -- sante 6 -- and
      // its recap+stat pins are poisoned by the leftover). The CASE baseline (snapshot taken before
      // E1) is written back whole; E never touches the armor ITEM or the gen lever, so the SEED
      // stats wait is the full gate before the neutralised replay.
      await fw.executeInFoundry(restoreActorSystemInPage, VIC_ACTOR_ID, baseline.system);
      await waitForStats(SEED_STATS, 'E-midcase');

      // (ii) NEUTRALISED: the SAME weapon, but percearmure/ignorearmure/ignorecdf are 'active' ->
      // applyInstinctDuLoup forces ignoreArmure/ignoreCdf back to FALSE (and perceArmure to 0):
      // the victim's FULL CdF 10 bites (the module never bypasses CdF: 14-10=4) and the armor
      // absorbs the rest -> recap {armure:4, sante:0}, armure 96, sante 20 intact.
      await fw.executeInFoundry(setItemFlagInPage, VIC_ACTOR_ID, loupId, 'loup', {
        choc: 'unactive',
        degatscontinus: 'unactive',
        percearmure: 'active',
        peur: 'unactive',
        ignorearmure: 'active',
        ignorecdf: 'active',
        drainenergie: 'unactive',
        domination: 'unactive',
      });
      const plain = await replay(bypassMutate, victimSpeaker);
      ctx.msgIds.push(plain);
      const p = await applyDamageAndAwait(plain, 'applyDamage', { armure: 96, sante: 20 }, ctx.msgIds, 'E-loup-14');
      push(
        "casE2: meme arme, drapeaux loup percearmure/ignorearmure/ignorecdf = active : les DEUX traits d'arme sont NEUTRALISEs, le CdF PLEIN 10 du porteur mord (14-10=4, jamais contourné par le module) puis l'armure absorbe -> recap EXACT {armure:4, sante:0} (aucune ligne « Santé : »), armure 96, sante intacte 20",
        JSON.stringify(p.recap.recap) === JSON.stringify({ armure: 4, sante: 0 }) &&
          !p.recap.content.includes('Santé :') &&
          p.recap.content.includes('Armure : 4') &&
          p.stats.armure === 96 &&
          p.stats.sante === 20,
      );
    });

    // ══════════════ case F: shrine derived-vs-source ══════════════
    await runCase('caseF-shrine-derived-not-source', async (ctx) => {
      console.log(
        '=== hooks-sheets: F effet shape du module (cle system.*.base mode 2) : bonus seulement DERIVE, _source intact ===',
      );
      // The change KEY is the module's OWN registered Shrine shape (src/module/knight-damage.js:40-70
      // uses key system.champDeForce.base, mode 2): the knight model folds effect changes into the
      // BASE leaves during prepareBaseData, while the derived champDeForce.value row is re-defined
      // every prepare (knight-data-model #derived/setValue) and does NOT reliably carry a raw
      // `.value`-keyed change. The effect CARRIES a status: the knight janitor
      // (base-actor-data-model.mjs:919 #cleanActor) only deletes effects with an EMPTY status set
      // AND statuscounter-only flags, so a status-carrying effect survives prepareData.
      const probeStatus = async (statusId, add, wantBase) => {
        // ids MUST be read inside the page function (Document getters do not survive the
        // executeInFoundry serialization — mapping .id node-side silently yields [undefined] and
        // the janitor-tolerant delete then no-ops, leaving the +6/+8 bonuses stacked; live-run-3
        // proof: prepared CdF 24 = +6 AND +8 both still active at cleanup).
        const ids =
          (await fw.executeInFoundry(
            (aid, sid, value) =>
              game.actors
                .get(aid)
                .createEmbeddedDocuments('ActiveEffect', [
                  {
                    name: `kdt-${sid}`,
                    statuses: [sid],
                    changes: [{ key: 'system.champDeForce.base', mode: 2, value }],
                  },
                ])
                .then((docs) => docs.map((d) => d.id)),
            VIC_ACTOR_ID,
            statusId,
            add,
          )) ?? [];
        if (ids.length !== 1 || !ids[0]) throw new Error(`F effect creation returned no id: ${JSON.stringify(ids)}`);
        ctx.effectIds.push(...ids);
        const cdf = await fw.waitFor(preparedPathNumberInPage, 15000, VIC_ACTOR_ID, 'champDeForce.base', wantBase);
        const src = await fw.executeInFoundry(
          (aid) => game.actors.get(aid)?._source?.system?.champDeForce?.base ?? null,
          VIC_ACTOR_ID,
        );
        const survivor = await fw.executeInFoundry(
          (aid, label) => game.actors.get(aid)?.effects?.some((e) => e.name === label) ?? false,
          VIC_ACTOR_ID,
          `kdt-${statusId}`,
        );
        // delete BEFORE the next probe so the two +N bonuses never stack; surviving THIS long is
        // itself the janitor contrast vs case B's swept status-less effect.
        await fw
          .executeInFoundry(deleteEffectsByIdsInPage, VIC_ACTOR_ID, ids)
          .catch((err) => console.log(`[hooks] F effect delete FAILED: ${err.message ?? err}`));
        ctx.effectIds.splice(-ids.length, ids.length);
        console.log(
          `[hooks] PROBE F ${statusId}: prepared champDeForce ${JSON.stringify(cdf?.cdf)} _source champDeForce.base=${src} survived=${survivor}`,
        );
        return cdf?.cdf?.base === wantBase && src === 10 && survivor;
      };
      push(
        "casF: effet a la SHAPE du module (change cle system.champDeForce.base mode 2, statut porte) : le +6 ne vit QUE dans le DERIVE (prepare champDeForce.base 10->16, feuille complete loggee) pendant que _source.system.champDeForce.base RESTE 10 -- et l'effet PORTANT statut SURVIT au janitor (contraste direct avec l'effet sans statut balaye au cas B)",
        await probeStatus('shrine', 6, 16),
      );
      push(
        'casF: deuxieme effet (shape shrine-ameliore, +8) apres SUPPRESSION du premier (jamais de cumul) : prepare champDeForce.base 10->18, _source toujours 10 -- la supression entre les deux probes reussit, les bonus ne se sont jamais empiles',
        await probeStatus('shrine-ameliore', 8, 18),
      );
    });

    // ─────────────── world-restoration self-checks ───────────────
    const endSystems = [];
    for (const id of FOUR_IDS) endSystems.push(await fw.executeInFoundry(snapshotActorSystemInPage, id));
    const systemDiffs = endSystems.map((s, i) => jsonDiffPaths(bootSystems[i], s));
    for (const [i, d] of systemDiffs.entries()) {
      if (d.length) console.log(`[hooks] DIFF system ${FOUR_IDS[i]} (boot -> end): ${d.slice(0, 40).join(' ; ')}`);
    }
    push(
      'auto-controle empoisonnement : les systemes PREPARES des QUATRE acteurs octet-identiques aux bases du boot (toutes mutations restaurees)',
      systemDiffs.every((d) => d.length === 0),
    );
    const endFlags = await fw.executeInFoundry(snapshotActorsModuleFlagsInPage, FOUR_IDS);
    push(
      'auto-controle empoisonnement : namespaces de flags knight-damage des QUATRE acteurs identiques a leurs bases de boot',
      flagNamespacesEqual(endFlags, bootFlags),
    );
    const endItemSystem = await fw.executeInFoundry(snapshotItemSystemInPage, VIC_ACTOR_ID, ARMOR_ITEM_ID);
    const endItemFlags = await fw.executeInFoundry(snapshotItemFlagsInPage, VIC_ACTOR_ID, ARMOR_ITEM_ID);
    push(
      "auto-controle empoisonnement : le systeme de l'ITEM d'armure embarque (kdtArmKnightAAAA, le porteur du pin gen-4) et ses flags knight-damage sont octet-identiques a leur base de boot (ni la cle armure.value du systeme sortant ni les leviers generation/jauges ne survivent)",
      deepEqualJson(endItemSystem, bootItemSystem) && deepEqualJson(endItemFlags, bootItemFlags),
    );
    const endEffects = await fw.executeInFoundry(snapshotEffectStatusesInPage, VIC_ACTOR_ID);
    const endInventory = await fw.executeInFoundry(readItemInventoryInPage, VIC_ACTOR_ID);
    push(
      "auto-controle empoisonnement : statuts d'effets embarques du vic-knight + inventaire d'objets identiques au boot (aucun folde/shrine/loup survivant)",
      deepEqualJson(endEffects, bootEffects) && deepEqualJson(endInventory, bootInventory),
    );
    const windowsGone = await fw.executeInFoundry(noWindowMatchesInPage, 'Sheet', '');
    const recapsGone = await fw.executeInFoundry(recapCountInPage);
    push(
      'auto-controle empoisonnement : AUCUNE fenetre de feuille restee ouverte ET aucun recap de degats survivant dans le journal de chat persistant',
      windowsGone?.closed === true && recapsGone === 0,
    );
    const hookErrors = await fw.executeInFoundry(readHookErrorsInPage);
    console.log(`[hooks] PROBE hook-error recorder (Hooks.onError broadcasts): ${JSON.stringify(hookErrors)}`);
    push(
      "auto-controle Hooks.onError : AUCUNE erreur de hook/handler notifiee pendant toute la suite (recorder d'erreurs vide)",
      hookErrors.length === 0,
    );

    const failed = results.filter((r) => !r.ok);
    console.log('');
    if (failed.length === 0 && caseFailures.length === 0) {
      console.log(`E2E HOOKS/SHEETS: PASS (${results.length}/${results.length} assertions)`);
    } else {
      console.log(
        `\nE2E HOOKS/SHEETS: FAIL (${failed.length}/${results.length} assertions failed${caseFailures.length ? `; case errors: ${caseFailures.join(' | ')}` : ''})`,
      );
      process.exitCode = 1;
    }
  } finally {
    await fw.stop();
    console.log('Foundry server + browser stopped.');
  }
}
