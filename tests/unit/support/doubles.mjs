// Object doubles for the knight system's message/actor contract.
// Flags are built from the same JSON fixture shape as the e2e plan
// (flags.knight.targets / weapon / actor) so both suites agree.

export function makeMessage({ content = '', flags = {}, speaker = { scene: 'scene-1', token: 'token-atk' } } = {}) {
  const updates = [];
  return {
    content,
    flags,
    speaker,
    updates,
    getFlag(pack, key) {
      return flags[pack]?.[key];
    },
    update(data) {
      updates.push({ ...data });
      return Promise.resolve({ ...this, ...data });
    },
  };
}

export function makeItem(name, { type = 'item', system = {}, flags = {} } = {}) {
  const flagStore = structuredClone(flags);
  return {
    name,
    type,
    system,
    getFlag(pack, key) {
      return flagStore[pack]?.[key];
    },
    setFlag(pack, key, value) {
      (flagStore[pack] ??= {})[key] = value;
    },
  };
}

export function makeActor(
  type,
  system = {},
  { id = null, uuid = null, name = 'double', items = [], flags = {}, temporaryEffects = [] } = {},
) {
  const flagStore = structuredClone(flags);
  const updates = [];
  return {
    id,
    uuid,
    name,
    type,
    system,
    temporaryEffects,
    updates,
    // Foundry's Actor#items behaves like the contents array: items.find(fn) and
    // items.contents.find(fn) both work.
    items: {
      contents: items,
      find(fn) {
        return items.find(fn);
      },
    },
    getFlag(pack, key) {
      return flagStore[pack]?.[key];
    },
    setFlag(pack, key, value) {
      (flagStore[pack] ??= {})[key] = value;
    },
    update(data) {
      updates.push({ ...data });
      return Promise.resolve();
    },
  };
}

// The live dispatch (knight-damage.js handleClickApplyDamage) passes
// `e.document` — a TokenDocument exposing at least `id` and `actor`.
export function makeToken(actor, { id = 'token-def', uuid = 'Scene.scene-1.Token.token-def' } = {}) {
  return { id, uuid, actor };
}

// A knight-system attack message: flags.knight.targets/weapon/actor.
export function makeKnightMessage({
  content = '<div class="knight-roll"><div>Dégâts</div></div>',
  scene = 'scene-1',
  initiatorTokenId = 'token-atk',
  initiatorActorId = 'actor-atk',
  initiatorType = 'pnj',
  initiatorItems = [],
  initiatorSystemOrigin = null,
  weaponRaw = [],
  targets = [],
} = {}) {
  // Shallow-copy the caller's arrays: the source MUTATES weapon.effets.raw
  // (the Débordement path auto-adds ignorearmure/ignorechampdeforce/
  // antivehicule via addWeaponEffects), so sharing the caller's array would
  // leak those pushes back into module-level fixture constants. Item objects
  // themselves are shared (they carry flag closures) but are never mutated
  // structurally by the damage classes.
  return makeMessage({
    content,
    speaker: { scene, token: initiatorTokenId },
    flags: {
      knight: {
        targets: [...targets],
        weapon: { effets: { raw: [...weaponRaw] } },
        actor: {
          _id: initiatorActorId,
          type: initiatorType,
          items: [...initiatorItems],
          system: { origin: initiatorSystemOrigin },
        },
      },
    },
  });
}

// Recorder for the jQuery-like `html` argument of revertDamage: the source
// calls html.find(sel).css(...), html.find(sel).remove() and
// html.find('.message-content').html(). Every selector/action is recorded.
//
// html() returns a DISTINCT canned string PER SELECTOR (defaults below, the
// caller overrides with `{ html: { '.message-content': '...' } }`), so the
// content the source writes back into message.update is proven to have been
// read from .message-content BY VALUE: reading any other selector returns a
// different, obviously wrong string. Asking a selector that has no canned
// value throws instead of quietly returning ''.
export function makeHtmlRecorder({ html = {} } = {}) {
  const canned = {
    '.recap': '<div class="recap">CANNED HTML FOR .recap</div>',
    '.revert-damage': '<button class="revert-damage">CANNED HTML FOR .revert-damage</button>',
    '.message-content': '<div class="message-content">CANNED HTML FOR .message-content</div>',
    ...html,
  };
  const calls = [];
  const chainFor = (selector) => ({
    css(property, value) {
      calls.push({ selector, action: 'css', property, value });
      return this;
    },
    remove() {
      calls.push({ selector, action: 'remove' });
      return this;
    },
    html() {
      calls.push({ selector, action: 'html' });
      if (!(selector in canned)) {
        throw new Error(`makeHtmlRecorder: no canned html() value for selector "${selector}"`);
      }
      return canned[selector];
    },
  });
  return {
    calls,
    selectorsUsed: () => calls.map((c) => c.selector),
    find: (selector) => chainFor(selector),
  };
}

// The knight chat HTML fragment extractTraitValue regexes over:
// <span class="label">Label</span><span class="value">+N</span>
export function traitSpan(label, value) {
  return `<span class="label">${label}</span><span class="value">+${value}</span>`;
}
