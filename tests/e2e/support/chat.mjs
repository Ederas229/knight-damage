// Shared chat-card helpers for the e2e suites (mandatory lookup pattern for Phase 3+, per
// docs/testing-plan.md: every card access is pinned to a specific message id — the suites must
// NEVER sample "the last message"/"the last card", and the world chat log is persistent across runs).
//
// IMPORTANT (Phase 3 finding, verified live): the framework's fw.page targets the PRIMARY
// Playwright window, but Foundry renders its sidebar (chat log, cards, dialogs) inside the separate
// APP WINDOW (game.windows.app — its own Playwright page in the persistent context, URL ends with
// #hud). DOM reads/clicks for chat cards MUST go through clickOnMessageCardReal / the app page —
// fw.page sees no chat DOM at all, and executeInFoundry runs in the primary window's Foundry
// context (documents are shared, DOM is not). Every helper below takes the app page or fw.

/** Message-id-pinned card selector (the only sanctioned way to address a card in the DOM). */
export const cardSelector = (msgId) => `li.chat-message[data-message-id="${msgId}"]`;

/** Document-level (executeInFoundry): every current chat message id — baseline for "which id is NEW". */
export const listMessageIdsInPage = () => game.messages.contents.map((m) => m.id);

/**
 * Page-function (executeInFoundry / waitFor): click a button inside the PINNED card. Returns false
 * while the card or button is not rendered yet so callers can waitFor the DOM first. `modifiers`
 * rides on the dispatched MouseEvent (the module handler contract reads ev.shiftKey; a plain
 * button.click() carries none, so shift-cases must pass modifiers: ['Shift']).
 */
export const clickOnMessageCard = (msgId, selector, modifiers = []) => {
  const card = document.querySelector(`li.chat-message[data-message-id="${msgId}"]`);
  if (!card) return false;
  const button = card.querySelector(selector);
  if (!button) return false;
  const rect = button.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    shiftKey: modifiers.includes('Shift'),
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
    buttons: 1,
  };
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    const event = type.startsWith('pointer')
      ? new PointerEvent(type, { ...init, pointerId: 1, isPrimary: true })
      : new MouseEvent(type, init);
    button.dispatchEvent(event);
  }
  return true;
};

/**
 * Page-function: is the PINNED card rendered in the DOM yet? (null while absent -> waitFor retries).
 * The selector is INLINED: page.evaluate transports this function's SOURCE, so referencing the
 * module-scope cardSelector helper would ReferenceError in-page on every poll (and waitForCondition
 * swallows those errors — the wait then silently spins to its timeout).
 */
export const cardRenderedInPage = (msgId) =>
  document.querySelector(`li.chat-message[data-message-id="${msgId}"]`) ? true : null;

/** Node-side: wait until the PINNED card is in the DOM (fw.waitFor throws on timeout). */
export async function waitForCard(fw, msgId, timeout = 15000) {
  await fw.waitFor(cardRenderedInPage, timeout, msgId);
  return msgId;
}

/** Page-function: the PINNED card's innerHTML (null while the card is not rendered yet). INLINED selector (page-source transport rule). */
export const messageContentInPage = (msgId) =>
  document.querySelector(`li.chat-message[data-message-id="${msgId}"]`)?.innerHTML ?? null;

/** Page-function: the module's damage buttons on the PINNED card (null until injection happened). */
export const damageButtonsOnCardInPage = (msgId) => {
  const card = document.querySelector(`li.chat-message[data-message-id="${msgId}"]`);
  if (!card) return null;
  const found = Array.from(card.querySelectorAll('.damageButton button')).map((b) => ({
    label: b.textContent.trim(),
    action: b.dataset.action,
  }));
  // null (not []) while injection is still pending: an empty array is truthy and would satisfy a
  // waitFor predicate before the renderChatMessageHTML hook has run.
  return found.length > 0 ? found : null;
};

/**
 * Page-function: the PINNED card's damage-button COUNT (null = card absent; 0 = card rendered but
 * NO injection — the conclusive shape for negative button-injection assertions, which the
 * null-until-injection contract of damageButtonsOnCardInPage cannot express).
 */
export const damageButtonCountOnCardInPage = (msgId) => {
  const card = document.querySelector(`li.chat-message[data-message-id="${msgId}"]`);
  if (!card) return null;
  // count wrapped in an object: 0 is falsy and waitForCondition would treat it as "not satisfied".
  return { count: card.querySelectorAll('.damageButton button').length };
};

/** Page-function: the system's own Dégâts button on the PINNED attack card (null until rendered). */
export const degatsButtonOnCardInPage = (msgId) => {
  const card = document.querySelector(`li.chat-message[data-message-id="${msgId}"]`);
  if (!card) return null;
  return card.querySelector('.knight-roll button.degats') ? true : null;
};

/**
 * Page-function: the NEWEST message created after `excludeIds` was sampled that carries the
 * knight-damage recap flag — pinned discovery, never "last message". Multiple candidates are
 * surfaced as { error } (the damage flow must produce exactly one recap per application).
 */
export const findNewRecapMessageInPage = (excludeIds) => {
  const fresh = game.messages.contents.filter(
    (m) => !excludeIds.includes(m.id) && m.flags?.['knight-damage']?.isRecap === true,
  );
  if (fresh.length === 0) return null; // waitFor retries
  if (fresh.length > 1)
    return { error: `${fresh.length} new recap messages from one application: ${fresh.map((m) => m.id)}` };
  const message = fresh[fresh.length - 1];
  const kd = message.flags['knight-damage'];
  return {
    id: message.id,
    recap: kd.recap ?? null,
    // The FULL knight-damage flag namespace is handed back so callers can pin every recap flag
    // (isRecap/origin/wear/anatheme and anything the module adds later) without page changes.
    flags: kd,
    content: message.content,
  };
};

/**
 * Page-function: read document flag(s) of a PINNED message (dot-path flagKey like
 * "knight.weapon.effets.raw"; no flagKey = the whole knight-damage namespace).
 */
export const messageFlagsInPage = (msgId, flagKey) => {
  const message = game.messages.get(msgId);
  if (!message) return { missing: true };
  if (!flagKey) return { value: message.flags?.['knight-damage'] ?? null };
  const [scope, ...path] = flagKey.split('.');
  let value = message.flags?.[scope];
  for (const part of path) {
    if (value == null) break;
    value = value[part];
  }
  return { value: value ?? null };
};

/** Page-function: does a fragment occur in the PINNED card's rendered HTML? ({found, contains}). INLINED selector. */
export const cardHtmlContainsInPage = (msgId, fragment) => {
  const card = document.querySelector(`li.chat-message[data-message-id="${msgId}"]`);
  if (!card) return { found: false, contains: false };
  return { found: true, contains: card.innerHTML.includes(fragment) };
};

/**
 * Page-function cleanup: delete the given chat messages by PINNED id (case isolation; the world
 * chat log is persistent across runs, so every case removes exactly what it created).
 */
export const deleteMessagesInPage = (ids) => {
  const present = game.messages.contents.filter((m) => ids.includes(m.id)).map((m) => m.id);
  if (present.length === 0) return 0;
  void ChatMessage.delete(present);
  return present.length;
};
