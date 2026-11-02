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
