/**
 * Shared PAGE-context helpers for the damage suites (Phase 3+). Stringify rule: these are
 * transported as source and re-evaluated page-side — NO closures over test variables; every
 * test value arrives as a trailing arg. Hoisted from the per-suite near-copies (review of
 * Phase 4) so the orphan/self-delete and snapshot/restore discipline is fixed in ONE place
 * for Phases 5-6.
 */

/** Page-function: create a chat message document, { id } on success, { error } on failure. */
export const replayMessageInPage = (data) =>
  ChatMessage.create(data)
    .then((m) => ({ id: m.id }))
    .catch((err) => ({ error: `${err.name}: ${err.message}` }));

/** Page-function: deep-copy an actor's ENTIRE system subtree (plain JSON, transportable). */
export const snapshotActorSystemInPage = (actorId) => JSON.parse(JSON.stringify(game.actors.get(actorId).system));

/** Page-function: merge a snapshot back — restore == what a full system update guarantees. */
export const restoreActorSystemInPage = (actorId, snapshot) =>
  game.actors
    .get(actorId)
    .update({ system: snapshot })
    .then(() => true);

/** Page-function: arbitrary partial actor update (e.g. one stat mutation for an off-switch case). */
export const updateActorInPage = (actorId, data) =>
  game.actors
    .get(actorId)
    .update(data)
    .then(() => true);

/**
 * Page-function: control ONE token (handleClickApplyDamage early-returns unless the active layer
 * controls tokens; framework selectTokens sets TARGETS, which is NOT controlled).
 */
export const controlTokenInPage = (tokenId) => {
  for (const token of [...canvas.tokens.controlled]) token.release();
  const token = canvas.tokens.get(tokenId);
  if (!token) throw new Error(`token ${tokenId} not on the active scene`);
  token.control({ releaseOthers: true });
  return { controlled: canvas.activeLayer?.controlled?.length ?? 0, layer: canvas.activeLayer?.name ?? null };
};

/** Page-function: release every controlled token (case cleanup). */
export const releaseAllTokensInPage = () => {
  for (const token of [...canvas.tokens.controlled]) token.release();
  return canvas.tokens.controlled.length;
};

/**
 * Page-function: clear the LOCAL user's TARGET set (review-6 D6, additive helper) —
 * game.user.targets is a distinct set from the activeLayer's CONTROLLED tokens that
 * releaseAllTokensInPage handles; the live-attack cases (case10 / the recorder) target the
 * victim via setTarget and must not leak that selection into the next case or run.
 */
export const clearUserTargetsInPage = () => {
  for (const token of Array.from(game.user.targets)) token.setTarget(false);
  return game.user.targets.size;
};

/**
 * INTENDED (author) double-update witness: apply() ALWAYS issues exactly two actor.update calls
 * (damageBase.js:296+303) — counted live via a preUpdateActor listener. Idempotent per boot
 * (re-installing in the same page would double-count).
 */
export const installActorUpdateCounterInPage = () => {
  if (window.__kdtActorUpdates) return 'already installed';
  window.__kdtActorUpdates = [];
  Hooks.on('preUpdateActor', (doc, data) => {
    window.__kdtActorUpdates.push({ id: doc.id, data: JSON.parse(JSON.stringify(data ?? {})) });
  });
  return 'installed';
};

/** Page-function: the accumulated preUpdateActor payloads (per-boot window state). */
export const readActorUpdatesInPage = () => window.__kdtActorUpdates ?? [];

/** Page-function: delete embedded Item documents of an actor (pinned weapon cleanup). */
export const deleteItemsInPage = (actorId, itemIds) =>
  game.actors
    .get(actorId)
    .deleteEmbeddedDocuments('Item', itemIds)
    .then(() => itemIds.length);

/**
 * Page-function: an actor's embedded-state baseline (review-6 D3) — effect status rows +
 * embedded item-id list. The damage suites capture this at boot and byte-compare at suite
 * end (mirroring the Phase-6 end-checks): none of those suites grants the VICTIMS statuses
 * or items, so a drift is cross-run poisoning.
 */
export const actorEmbeddedStateInPage = (actorId) => ({
  effects: game.actors.get(actorId).effects.map((e) => Array.from(e.statuses)),
  items: game.actors.get(actorId).items.map((i) => i.id),
});

/*
 * ── Actor-level `knight-damage` FLAG helpers (Phase 5, additive) ──
 * The reminder flags (knight-damage.energie / knight-damage.espoir on the ORIGIN token's actor,
 * generateReminderData keys) live in the actor flag namespace, OUTSIDE system.* — the system
 * snapshot/restore above can never clean them, and addReminder's setFlag is unawaited
 * (knight-damage.js:80), so flag assertions always go through a waitFor predicate.
 */

/** Page-function: deep-copy one actor's ENTIRE knight-damage flag namespace (absent namespace = {}). */
export const snapshotModuleFlagsInPage = (actorId) =>
  JSON.parse(JSON.stringify(game.actors.get(actorId).flags?.['knight-damage'] ?? {}));

/**
 * Page-function: snapshot several actors' knight-damage namespaces at once — { actorId: namespace }.
 * The suite captures these at boot and byte-compares them at suite end (poisoning self-check).
 */
export const snapshotActorsModuleFlagsInPage = (actorIds) => {
  const out = {};
  for (const id of actorIds) out[id] = JSON.parse(JSON.stringify(game.actors.get(id).flags?.['knight-damage'] ?? {}));
  return out;
};

/**
 * Page-function: restore a knight-damage namespace snapshot KEY-BY-KEY — unsetFlag for keys the
 * snapshot does not hold (a flag key the module left at 0 is NOT baseline), setFlag for every
 * snapshot key. Never writes the namespace wholesale, so absent-vs-empty drift stays invisible.
 */
export const restoreModuleFlagsInPage = async (actorId, snapshot) => {
  const actor = game.actors.get(actorId);
  const current = actor.flags?.['knight-damage'] ?? {};
  for (const key of Object.keys(current)) if (!(key in snapshot)) await actor.unsetFlag('knight-damage', key);
  for (const [key, value] of Object.entries(snapshot)) await actor.setFlag('knight-damage', key, value);
  return true;
};

/** Page-function: write ONE knight-damage flag wholesale (direct-flag characterization cases). */
export const setModuleFlagInPage = (actorId, flagKey, value) =>
  game.actors
    .get(actorId)
    .setFlag('knight-damage', flagKey, value)
    .then(() => true);

/**
 * Page-function WAIT predicate: null until the actor's knight-damage flag at flagKey is an object
 * with EXACTLY `entries` ([key, value] pairs — the byte-pinned underscore keys ride in as args,
 * stringify rule). Extra keys fail the length gate, so this pins the WHOLE map, not just membership.
 */
export const moduleFlagMatchesInPage = (actorId, flagKey, entries) => {
  const data = game.actors.get(actorId).flags?.['knight-damage']?.[flagKey];
  if (data === undefined || data === null || typeof data !== 'object') return null;
  const keys = Object.keys(data);
  if (keys.length !== entries.length) return null;
  for (const [key, value] of entries) if (data[key] !== value) return null;
  return { value: JSON.parse(JSON.stringify(data)) };
};
