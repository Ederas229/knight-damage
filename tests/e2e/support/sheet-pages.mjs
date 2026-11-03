/**
 * Shared PAGE-context helpers for the hook/sheet suites (Phase 6). Strictly ADDITIVE (review rule):
 * the Phase-3/4/5 suites keep using support/{actor-pages,chat,compare,replay}.mjs byte-identically;
 * everything here is NEW surface for sheet windows, embedded ITEM documents, actor `_source`
 * reads, status toggles and hook render/error recorders. Stringify rule as always: these travel to
 * the page as SOURCE — no closures over node scope, every test value arrives as a trailing arg.
 */

/* global $ */

// ── Application windows (v1 registry) ──

/**
 * Page-function WAIT predicate: null while ANY open window's className OR title matches the
 * (string-delivered) regex source+flags — the sheet-left-open negative pin, and the suite-end
 * "no window leaked" self-check. Pattern arrives as SOURCE TEXT because page functions cannot
 * close over node regexes (stringify rule).
 */
export const noWindowMatchesInPage = (patternSource, patternFlags) => {
  const re = new RegExp(patternSource, patternFlags);
  const hits = [];
  for (const w of Object.values(ui.windows ?? {}))
    if (re.test(w.constructor?.name ?? '') || re.test(String(w.title ?? ''))) hits.push(w.constructor?.name);
  for (const w of Array.from(foundry.applications?.instances?.values() ?? []))
    if (re.test(w.constructor?.name ?? '') || re.test(String(w.title ?? ''))) hits.push(w.constructor?.name);
  return hits.length === 0 ? { closed: true } : null;
};

/** Page-function: render (without blocking) an actor sheet / embedded item sheet; {scheduled} back. */
export const openActorSheetInPage = (actorId) => {
  game.actors.get(actorId).sheet.render(true);
  return { scheduled: true };
};

export const openItemSheetInPage = (actorId, itemId) => {
  game.actors.get(actorId).items.get(itemId).sheet.render(true);
  return { scheduled: true };
};

/** Page-function: is the actor/item sheet's app currently rendered (Application#rendered)? */
export const sheetRenderedInPage = (kind, actorId, itemId) => {
  const actor = game.actors.get(actorId);
  const sheet = kind === 'item' ? actor?.items?.get(itemId)?.sheet : actor?.sheet;
  return sheet?.rendered ? { rendered: true } : null;
};

/**
 * Page-function: close every open window whose className OR title matches the delivered regex
 * SOURCE (case-cleanup for sheets the test itself opened; module-owned auto-closes are asserted,
 * never driven, from here). NOTE: v1 knight sheets live in ui.windows and their class names all
 * end in 'Sheet' — the pattern source must be a PLAIN 'Sheet', never a slashed literal.
 */
export const closeWindowsMatchingInPage = (patternSource, patternFlags) => {
  const re = new RegExp(patternSource, patternFlags);
  const all = [...Object.values(ui.windows ?? {}), ...Array.from(foundry.applications?.instances?.values() ?? [])];
  const hits = all.filter((w) => re.test(w.constructor?.name ?? '') || re.test(String(w.title ?? '')));
  // AWAIT every close(): v1 close() is async (CLOSING -> CLOSED). Returning while windows are still
  // CLOSING leaves the NEXT case's sheet render(true) queued behind a half-closed instance — the
  // exact A3 "sheet never rendered" stall (probe-pinned: render after an un-awaited close times out).
  const closes = hits.map((w) =>
    Promise.resolve(w.close()).catch(() => {
      /* best effort — teardown never throws */
    }),
  );
  return Promise.all(closes).then(() => ({ closed: hits.length }));
};

// ── Embedded ITEM documents (the armor item / the loup module item) ──

/** Page-function: deep-copy an embedded item's ENTIRE system subtree (transportable plain JSON). */
export const snapshotItemSystemInPage = (actorId, itemId) =>
  JSON.parse(JSON.stringify(game.actors.get(actorId).items.get(itemId).system));

/** Page-function: deep-copy an embedded item's knight-damage flag namespace (absent = {}). */
export const snapshotItemFlagsInPage = (actorId, itemId) =>
  JSON.parse(JSON.stringify(game.actors.get(actorId).items.get(itemId).flags?.['knight-damage'] ?? {}));

/**
 * Page-function: BYTE-EXACT restore of an actor's stored system subtree. A plain merge update of
 * the snapshot CANNOT remove keys the current data has but the baseline never had — and the knight
 * sheet's close-SUBMIT re-submits the WHOLE rendered form, which materialises empty form fields as
 * stored nulls (live hs1 proof: `system.sante.bonus.user: <absent> -> null` surviving every
 * merge-restore, caught only by the byte self-check). v14.369 REAL deletion semantics (core source,
 * byte-checked in the portable/Node install): a nested {k: null} payload is a SET to null —
 * mergeObject deletes ONLY via ForcedDeletion operators (helpers.mjs:1206-1211) and diffObject
 * emits deletion markers only with bidirectional:true, which _updateDiff never requests
 * (fields.mjs:1973-2003 diff path, helpers.mjs:312,350-354). The honored lever is the legacy
 * forced-deletion SIBLING key `{['-=' + k]: null}` — converted to a real
 * foundry.data.operators.ForcedDeletion by SchemaField#_cleanKeys (fields.mjs:1118-1128) and
 * ObjectField#_cleanType (fields.mjs:1924-1932), which ObjectField#_updateDiff then applies through
 * mergeObject({applyOperators:true}) (fields.mjs:1988-1990). So this walks the CURRENT stored
 * subtree (`JSON.parse(JSON.stringify(actor.system))`, byte-identical channel to
 * snapshotActorSystemInPage, so prepared getters never masquerade as deletable rows), emits one
 * `-=` sibling marker (null-valued, opaque leaf — never recursed into) for every baseline-absent
 * key, and merges the markers over the snapshot in one update. Baseline-present keys keep the
 * plain value-restore (the snapshot row simply overwrites). The payload's first flattened key is
 * reported back: it must stay OUTSIDE system.armure/system.energie or the knight.mjs:848 first-key
 * mirror could fire mid-restore — the snapshot's key order is preserved and markers only APPEND at
 * their own level, so the first flat key is the snapshot's own first leaf (live dump: system.version).
 */
export const restoreActorSystemExactInPage = (actorId, snapshot) => {
  const actor = game.actors.get(actorId);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const prune = (cur, base) => {
    const out = {};
    for (const [k, v] of Object.entries(cur ?? {})) {
      if (k.startsWith('-=')) continue; // operator sibling, never a data row in a stored subtree
      const b = base ? base[k] : undefined;
      if (b === undefined)
        out['-=' + k] = null; // forced-deletion marker (null-valued leaf)
      else if (isObj(v) && isObj(b)) {
        const inner = prune(v, b);
        if (Object.keys(inner).length) out[k] = inner;
      }
    }
    return out;
  };
  const deep = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (k.startsWith('-='))
        out[k] = v; // opaque operator leaf: NEVER recursed into
      else out[k] = isObj(v) && isObj(out[k]) ? deep(out[k], v) : v;
    }
    return out;
  };
  const firstFlatKey = (obj, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}${k}` : k;
      if (!isObj(v)) return p;
      const inner = firstFlatKey(v, `${p}.`);
      if (inner !== null) return inner;
    }
    return null;
  };
  const current = JSON.parse(JSON.stringify(actor.system));
  const deletions = prune(current, snapshot);
  const n = Object.keys(deletions).length;
  const system = n ? deep(snapshot, deletions) : snapshot;
  const firstFlat = firstFlatKey({ system });
  return actor.update({ system }).then(() => ({ deleted: n, firstFlat }));
};

/** Page-function: merge-partial update of an embedded item ({'system.generation': 3} etc). */
export const updateItemInPage = (actorId, itemId, data) =>
  game.actors
    .get(actorId)
    .items.get(itemId)
    .update(data)
    .then(() => true);

/** Page-function: restore an embedded item's system subtree wholesale (== full update contract). */
export const restoreItemSystemInPage = (actorId, itemId, snapshot) =>
  game.actors
    .get(actorId)
    .items.get(itemId)
    .update({ system: snapshot })
    .then(() => true);

/** Page-function: read a LIST of dot-paths off the embedded item, walking `system` from the DOC root
 *  ('system.jauges.sante', '_source.system.armure.value', ...; absent -> null). */
export const readItemPathsInPage = (actorId, itemId, paths) => {
  const item = game.actors.get(actorId).items.get(itemId);
  const out = {};
  for (const path of paths) {
    let value = item;
    for (const part of path.split('.')) {
      if (value == null) break;
      value = value[part];
    }
    out[path] = value === undefined ? null : JSON.parse(JSON.stringify(value));
  }
  return out;
};

/** Page-function: create embedded items; returns [{id, name, type, activeBase}] for defaults. */
export const createItemsInPage = (actorId, itemDataList) =>
  game.actors
    .get(actorId)
    .createEmbeddedDocuments('Item', itemDataList)
    .then((docs) =>
      docs.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        // fresh module-item default lever for applyInstinctDuLoup (module-data-model initial:false)
        activeBase: d.system?.active?.base ?? null,
      })),
    );

/** Page-function: the actor's embedded item inventory (id/name/type) — loup-residue self-check. */
export const readItemInventoryInPage = (actorId) =>
  game.actors.get(actorId).items.map((i) => ({ id: i.id, name: i.name, type: i.type }));

/** Page-function: delete embedded ITEMS by id (loup cleanup; never throws on absent ids). */
export const deleteItemsByIdsInPage = (actorId, itemIds) => {
  const actor = game.actors.get(actorId);
  const present = actor.items.filter((i) => itemIds.includes(i.id)).map((i) => i.id);
  if (present.length === 0) return 0;
  return actor.deleteEmbeddedDocuments('Item', present).then(() => present.length);
};

/** Page-function: set one ITEM flag (the loup map) wholesale. */
export const setItemFlagInPage = (actorId, itemId, flagKey, value) =>
  game.actors
    .get(actorId)
    .items.get(itemId)
    .setFlag('knight-damage', flagKey, value)
    .then(() => true);

/**
 * Page-function WAIT predicate: null until the ITEM flag map at flagKey has EXACTLY `entries`
 * ([key, raw-string-value] pairs, byte-pinned — the loup contract value is literally the button
 * className 'active'/'unactive').
 */
export const itemFlagMatchesInPage = (actorId, itemId, flagKey, entries) => {
  const data = game.actors.get(actorId).items.get(itemId).flags?.['knight-damage']?.[flagKey];
  if (data === undefined || data === null || typeof data !== 'object') return null;
  const keys = Object.keys(data);
  if (keys.length !== entries.length) return null;
  for (const [key, value] of entries) if (data[key] !== value) return null;
  return { value: JSON.parse(JSON.stringify(data)) };
};

// ── PREPARED vs `_source` reads (the gen-4 wear-pin asymmetry) ──

/**
 * Page-function: one bundle carrying BOTH sides of the wear/jauges state — prepared system values
 * and raw `_source` rows. `preparedPaths` are dot-paths against actor.system, `sourcePaths`
 * against actor._source (absent -> null).
 */
export const readPreparedAndSourceInPage = (actorId, preparedPaths, sourcePaths) => {
  const actor = game.actors.get(actorId);
  const pick = (root, paths) => {
    const out = {};
    for (const path of paths) {
      let value = root;
      for (const part of path.split('.')) {
        if (value == null) break;
        value = value[part];
      }
      out[path] = value === undefined ? null : value instanceof Set ? Array.from(value) : value;
    }
    return out;
  };
  return { prepared: pick(actor.system, preparedPaths), source: pick(actor._source, sourcePaths) };
};

// ── Statuses / effects (folde, shrine, and the effect-statuses baseline) ──

/** Page-function: actor.toggleStatusEffect (same mechanism as Phase-3 case10's anti-anatheme). */
export const toggleStatusInPage = async (actorId, statusId, active) => {
  const actor = game.actors.get(actorId);
  if (!actor) throw new Error(`actor ${actorId} not found`);
  await actor.toggleStatusEffect(statusId, { active });
  return {
    effectStatuses: actor.effects.map((e) => ({ name: e.name, statuses: Array.from(e.statuses) })),
    tempStatuses: actor.temporaryEffects.map((e) => Array.from(e.statuses)),
  };
};

/**
 * Page-function: create an embedded status effect WITH an explicit finite duration — the fallback
 * lever when a plain toggle does NOT land the status in Actor#temporaryEffects (hasStatusEffect,
 * helpers.js:41-43, filters active && isTemporary; a duration-LESS toggle may never qualify).
 */
export const createStatusEffectWithSecondsInPage = (actorId, statusId, seconds) =>
  game.actors
    .get(actorId)
    .createEmbeddedDocuments('ActiveEffect', [
      {
        // v14 ACTIVE-EFFECT SCHEMA FACT (probed live: bare creates fail preCreateDocumentArray
        // validation with "name: may not be undefined") — a status name must be carried.
        name: statusId,
        statuses: [statusId],
        duration: { type: 'seconds', seconds, start: game.time.worldTime },
      },
    ])
    .then((docs) => ({
      ids: docs.map((d) => d.id),
      tempStatuses: game.actors.get(actorId).temporaryEffects.map((e) => Array.from(e.statuses)),
    }));

/** Page-function: snapshot every embedded ActiveEffect (id/name/statuses) — baseline + cleanup. */
export const snapshotEffectStatusesInPage = (actorId) =>
  game.actors.get(actorId).effects.map((e) => ({ id: e.id, name: e.name, statuses: Array.from(e.statuses) }));

/**
 * Page-function: EVERY still-living knight-damage recap id in the boot-persistent journal — the
 * strays sweep (a case that threw between "recap created" and "recap discovered" would otherwise
 * leak its card into every later run).
 */
export const strayRecapIdsInPage = () =>
  game.messages.contents.filter((m) => m.flags?.['knight-damage']?.isRecap === true).map((m) => m.id);

/**
 * Page-function: WAIT predicate — null until the prepared system path holds the expected number;
 * returns the WHOLE champDeForce leaf (base/max/value/mod) so a failed wait still surfaces every
 * derived row (the self-diagnosing channel for the system's derived-stat clamps).
 */
export const preparedPathNumberInPage = (actorId, path, want) => {
  const parts = path.split('.');
  let v = game.actors.get(actorId)?.system;
  for (const p of parts) {
    if (v == null) break;
    v = v[p];
  }
  if (v !== want) return null;
  const cdf = game.actors.get(actorId)?.system?.champDeForce ?? null;
  return {
    cdf: cdf ? { base: cdf.base ?? null, max: cdf.max ?? null, value: cdf.value ?? null, mod: cdf.mod ?? null } : null,
  };
};

/** Page-function: janitor-race-tolerant embedded-effect deletion (same contract as reminders). */
export const deleteEffectsByIdsInPage = (actorId, effectIds) => {
  const actor = game.actors.get(actorId);
  const present = actor.effects.filter((e) => effectIds.includes(e.id)).map((e) => e.id);
  if (present.length === 0) return 0;
  return actor.deleteEmbeddedDocuments('ActiveEffect', present).then(
    () => present.length,
    () => {
      const stillHere = actor.effects.filter((e) => effectIds.includes(e.id)).length;
      if (stillHere > 0) throw new Error(`${stillHere} effect(s) survived delete`);
      return 0;
    },
  );
};

// ── Hook recorders (evidence for live-only behaviors) ──

/**
 * Page-function: record every Hooks 'error' broadcast — the knight system's _safePrepareData
 * wrapper routes prepare aborts (e.g. a re-run defineProperty pin throwing) through Hooks.onError
 * -> Hooks.callAll("error", ...) (core Hooks.onError). Idempotent per boot.
 */
export const installHookErrorRecorderInPage = () => {
  if (window.__kdtHookErrors) return 'already installed';
  window.__kdtHookErrors = [];
  Hooks.on('error', (location, error) => {
    if (window.__kdtHookErrors.length < 50)
      window.__kdtHookErrors.push({ location: String(location ?? ''), message: String(error?.message ?? error) });
  });
  return 'installed';
};

/** Page-function: drain-free read of the accumulated hook errors. */
export const readHookErrorsInPage = () => window.__kdtHookErrors ?? [];

/**
 * Page-function: record EVERY renderModuleSheet pass as one row (the module's own hook registers at
 * init — i.e. BEFORE this recorder, so a row reflects what the module hook already did to `html`:
 * first pass = flag-map creation + early return (no buttons), later passes = the injected map).
 * Each row carries the rendered item's OWN id so consumers can filter their item's passes instead
 * of indexing the boot-global array positionally.
 */
export const installModuleSheetRenderRecorderInPage = () => {
  if (window.__kdtModuleSheetPasses) return 'already installed';
  window.__kdtModuleSheetPasses = [];
  Hooks.on('renderModuleSheet', (app, html) => {
    if (window.__kdtModuleSheetPasses.length >= 20) return;
    const $html = $(html);
    window.__kdtModuleSheetPasses.push({
      id: app.object?.id ?? null,
      name: app.object?.name ?? null,
      hasFlag: app.object?.flags?.['knight-damage']?.loup !== undefined,
      niveauN1: $html?.find?.('.niveau_n1')?.length ?? -1,
      optionButtons: $html?.find?.('button[data-option]')?.length ?? -1,
    });
  });
  return 'installed';
};

/**
 * Page-function WAIT predicate: null until the recorder holds at least `min` renderModuleSheet
 * passes for the delivered ITEM id — then {rows} (the item's own passes, in order). The fixed
 * boot-position read + blind sleep this replaces could never tell WHICH sheet produced a row.
 */
export const readModuleSheetPassesInPage = (itemId, min) => {
  const rows = (window.__kdtModuleSheetPasses ?? []).filter((p) => p.id === itemId);
  return rows.length >= min ? { rows } : null;
};

/**
 * Page-function: is the loup BUTTON for optionKey rendered in the item-sheet DOM yet? null until
 * present (waitFor predicate); returns the button's live className, because the module handler
 * writes the flag FROM `currentTarget.className` LITERALLY (the 'active'/'unactive' contract).
 * Resolution goes through the ITEM's OWN sheet element (v1: Application#element is a jQuery
 * wrapper — [0] is the HTMLElement), never a global selector: several module sheets may coexist.
 */
export const loupButtonInPage = (actorId, itemId, optionKey) => {
  const sheet = game.actors.get(actorId)?.items?.get(itemId)?.sheet;
  const root = sheet?.element?.[0] ?? null;
  if (!root) return null;
  const btn = root.querySelector(`button[data-option="${optionKey}"]`);
  if (!btn) return null;
  return { className: btn.className };
};

/** Page-function: dispatch real pointer+click events on the rendered loup button (class toggles
 * run through the module's jQuery-bound handler, exactly like a user click). */
export const clickLoupButtonInPage = (actorId, itemId, optionKey) => {
  const sheet = game.actors.get(actorId)?.items?.get(itemId)?.sheet;
  const root = sheet?.element?.[0] ?? null;
  if (!root) return null;
  const btn = root.querySelector(`button[data-option="${optionKey}"]`);
  if (!btn) return null;
  const before = btn.className;
  const rect = btn.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    const event = type.startsWith('pointer')
      ? new PointerEvent(type, { ...init, pointerId: 1, isPrimary: true })
      : new MouseEvent(type, init);
    btn.dispatchEvent(event);
  }
  return { found: true, classNameBefore: before };
};

/**
 * Page-function: the knight sheet's ARMURE-SWITCH state in one probe — the switcher buttons the
 * template actually rendered (knight-sheet.mjs:274 binds 'div.buttonSelectArmure button.armure'
 * and the module clicks `.armure[data-type=guardian]`), the actor's PREPARED wear/armure/jauges
 * gate values, the armor ITEM's prepared generation/jauges (the #setJauges MIRROR source), and
 * whether folde currently qualifies for the module's hasStatusEffect (temporaryEffects only).
 */
export const guardianSwitchStateInPage = (actorId, armorItemId) => {
  const actor = game.actors.get(actorId);
  const sheet = actor?.sheet;
  const root = sheet?.rendered ? (sheet.element?.[0] ?? null) : null;
  const item = actor?.items?.get(armorItemId);
  return {
    sheetRendered: sheet?.rendered === true,
    armureButtonCount: root ? root.querySelectorAll('div.buttonSelectArmure button.armure').length : -1,
    guardianButtonCount: root
      ? root.querySelectorAll('div.buttonSelectArmure button.armure[data-type="guardian"]').length
      : -1,
    actorWear: actor?.system?.wear ?? null,
    actorArmureValue: actor?.system?.armure?.value ?? null,
    actorJaugesSante: actor?.system?.jauges?.sante ?? null,
    itemGeneration: item?.system?.generation ?? null,
    itemJaugesSante: item?.system?.jauges?.sante ?? null,
    foldeTemporary: actor ? actor.temporaryEffects.some((e) => Array.from(e.statuses ?? []).includes('folde')) : null,
  };
};
