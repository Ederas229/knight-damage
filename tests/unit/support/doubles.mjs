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
// The entrypoint's addRevertDamageEvent instead calls html.find(sel).on(...)
// (and the recap hover handlers call html.on(...) at the root): both .on
// forms are recorded with their bound data + handler (see onBindings), so a
// test can drive the real click handler honestly.
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
  function recordOn(selector) {
    // jQuery offers both .on(events, handler) and .on(events, data, handler);
    // the entrypoint uses the 3-arg form for the revert click and the 2-arg
    // form for the recap hover handlers. Both are recorded with the handler
    // resolved, so a test can re-invoke the real handler with { data }.
    // Regular function (NOT an arrow): called as a chain member, `this` is the
    // chain object the .on was invoked on, so the jQuery chain stays intact.
    return function (event, dataOrHandler, maybeHandler) {
      const handler = maybeHandler === undefined ? dataOrHandler : maybeHandler;
      const data = maybeHandler === undefined ? undefined : dataOrHandler;
      calls.push({ selector, action: 'on', event, data, handler });
      return this;
    };
  }
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
    on: recordOn(selector),
  });
  return {
    calls,
    selectorsUsed: () => calls.map((c) => c.selector),
    onBindings: (selector) =>
      calls.filter((c) => c.action === 'on' && (selector === undefined || c.selector === selector)),
    find: (selector) => chainFor(selector),
    on: recordOn('<root>'),
  };
}

// The knight chat HTML fragment extractTraitValue regexes over:
// <span class="label">Label</span><span class="value">+N</span>
export function traitSpan(label, value) {
  return `<span class="label">${label}</span><span class="value">+${value}</span>`;
}
