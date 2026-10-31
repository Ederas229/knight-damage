// Foundry global stubs for the unit suite (vitest setupFiles).
// Only what the damage classes touch *inside methods*: foundry.utils,
// foundry.applications.api.DialogV2, fromUuidSync, game, canvas, ChatMessage —
// plus the entrypoint's import-time surface (Hooks) and its method-time
// globals (fromUuid, $) for the dispatch/revert pins in entrypoint-dispatch.

const uuidRegistry = new Map();

const messageCreations = [];
const queryCalls = [];
const dialogPrompts = [];

let dialogPromptImpl = async () => {
  throw new Error('foundry.applications.api.DialogV2.prompt called without a programmed stub');
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Minimal recursive merge matching the semantics the source relies on:
// merge into plain objects, 2nd argument merged into the 1st, returns target.
//
// DIVERGENCE from the real foundry.utils.mergeObject (kept deliberately simple):
// this stub does NOT implement Foundry v14 merge semantics. Missing:
//   - dot-key expansion (e.g. { 'a.b': 1 } is stored as the literal key 'a.b',
//     not merged into a.b);
//   - throwing when target or source is not an object;
//   - the special operator objects (foundry.utils.ForcedDeletion,
//     foundry.utils.Replacement, and the @@modify/@@expand sentinels).
// None of the source call sites (generateRecapMessage + generateReminderData)
// use those features. If a future test needs them, extend this stub — do not
// import the real one.
function mergeObject(target, source) {
  if (source === undefined || source === null) return target;
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeObject(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

globalThis.foundry = {
  utils: {
    deepClone: (object) => structuredClone(object),
    mergeObject: (target, source) => mergeObject(target, source),
    fromUuid: async (uuid) => uuidRegistry.get(uuid) ?? null,
  },
  applications: {
    api: {
      // DIVERGENCE from the real core v14 DialogV2.prompt (stub kept thin on
      // purpose): the real _onSubmit resolves the prompt with
      //   `const result = (await button?.callback?.(event, target, this)) ?? button?.action;`
      // so a callback returning null/undefined resolves with the button's ACTION
      // STRING (e.g. 'ok'), NOT with undefined. This stub (and
      // setDialogPromptCallback below) resolves with the RAW callback return and
      // omits the ?? fallback. Reason against the real oracle when writing
      // callback pins: a hypothetical undefined-returning askModifier callback
      // would in real core hand back the string 'ok' and `this.damage +=
      // mod.damage` would still poison to NaN — the production finite guard
      // (damageBase.js:87) is what prevents ever reaching that case.
      DialogV2: {
        prompt: (options) => {
          dialogPrompts.push(options);
          return dialogPromptImpl(options);
        },
      },
    },
  },
};

globalThis.fromUuidSync = (uuid) => uuidRegistry.get(uuid);

// Bare-global twin of foundry.utils.fromUuid: the module entrypoint
// (knight-damage.js) calls the GLOBAL fromUuid (handleClickRevertDamage,
// generateReminderMessage), not the namespaced one. Same registry semantics
// (null for unresolvable uuids — the G4 guard pin depends on that).
globalThis.fromUuid = async (uuid) => uuidRegistry.get(uuid) ?? null;

// Hooks recorder: importing src/module/knight-damage.js executes its
// top-level Hooks.once('init') + Hooks.on(...) registrations. The stub only
// RECORDS the handlers (never invokes them), so CONFIG is never needed — the
// init callback body stays unrun. Registrations are import-time and one-shot
// per worker: resetRecorders() deliberately does NOT clear this list.
const hookRegistrations = [];
globalThis.Hooks = {
  once: (hook, fn) => hookRegistrations.push({ hook, once: true, fn }),
  on: (hook, fn) => hookRegistrations.push({ hook, once: false, fn }),
};

// DIVERGENCE from real core: the renderChatMessageHTML handler does
// `html = $(html)`, and the real jQuery wrapper is what carries .find/.on.
// The unit stub is the identity pass-through — the doubles' html recorder
// already implements the exact chained API the source uses
// (.find(sel).on(event, data, handler), .css, .remove, .html).
globalThis.$ = (argument) => argument;

const DEFAULT_ACTIVE_GM = {
  id: 'user-unit-test',
  name: 'GM de test',
  query: async (queryName, queryData) => {
    queryCalls.push({ queryName, data: structuredClone(queryData) });
    return {};
  },
};

// activeGM is a GETTER over a mutable binding (was a fixed object property):
// the committed src guards (damageBase.js:226 / damageKnight.js:134) read
// `game.users.activeGM` and must be able to see null — the no-GM guard pins
// need it clearable. resetRecorders() restores the default GM, so a nulled
// activeGM can never leak into the next test.
let activeGM = DEFAULT_ACTIVE_GM;

globalThis.game = {
  userId: 'user-unit-test',
  users: {
    get activeGM() {
      return activeGM;
    },
  },
};

globalThis.canvas = {
  scene: { id: 'scene-1', name: 'Scène de test', uuid: 'Scene.scene-1' },
};

globalThis.ChatMessage = class ChatMessage {
  static create(data) {
    messageCreations.push(data);
    return Promise.resolve({ ...data });
  }
};

// --- test-facing helpers -------------------------------------------------

export function registerUuid(uuid, object) {
  uuidRegistry.set(uuid, object);
}

export function clearUuidRegistry() {
  uuidRegistry.clear();
}

export function recordedMessages() {
  return [...messageCreations];
}

export function recordedQueries() {
  return [...queryCalls];
}

// The raw options object each DialogV2.prompt call received (in call order),
// so tests can pin window.title / content of the real dialogs.
export function recordedDialogPrompts() {
  return [...dialogPrompts];
}

// Hook handlers recorded at import time from src/module/knight-damage.js.
// Pass a hook name to filter ('renderChatMessageHTML'), or omit for all
// registrations, in registration order: [{ hook, once, fn }].
export function registeredHooks(hookName) {
  return hookName ? hookRegistrations.filter((r) => r.hook === hookName) : [...hookRegistrations];
}

// Clears (or replaces) the active GM the src reminder paths read; null
// simulates "no active GM" for the guard pins (damageBase.js:226).
export function setActiveGM(user) {
  activeGM = user;
}

export function resetActiveGM() {
  activeGM = DEFAULT_ACTIVE_GM;
}

// Also folds in resetDialogPrompt() so a stray programmed stub can never leak
// into the next test (the existing afterEach(resetDialogPrompt) calls in the test
// files stay harmless and idempotent).
export function resetRecorders() {
  messageCreations.length = 0;
  queryCalls.length = 0;
  dialogPrompts.length = 0;
  resetDialogPrompt();
  resetActiveGM();
}

export function setDialogPrompt(handler) {
  dialogPromptImpl = handler;
}

// Instead of programming a result, this runs the REAL options.ok.callback(event,
// button) with a fake form button (button.form.elements.value.valueAsNumber =
// valueAsNumber), so tests go through the production validation/clamp code of
// askModifier and askDamageEnergie. The prompt promise resolves with whatever
// that callback returns. Which pins actually depend on it (source-oracle):
//   - damage-knight.test.mjs "clamp is load-bearing": requested 15 >= the
//     trunc(20/2) = 10 bound comes back CLAMPED to 10, and the energie/armure/
//     sante repartition proves the clamp changed the numbers (15/5/1 unclamped);
//   - damage-knight.test.mjs + damage-base.test.mjs NaN cases: a non-finite
//     valueAsNumber comes back as the guard's 0 (resp. { damage: 0 });
//   - damage-base.test.mjs finite -5: the -5 really is read off valueAsNumber.
// The bound itself (the dialog's default input value) is pinned separately via
// recordedDialogPrompts() content.
export function setDialogPromptCallback(valueAsNumber) {
  dialogPromptImpl = async (options) =>
    options.ok.callback({ type: 'click' }, { form: { elements: { value: { valueAsNumber } } } });
}

// Restores the default "no stub programmed" impl. Already covered by
// resetRecorders(); kept exported for explicit use inside a test.
export function resetDialogPrompt() {
  dialogPromptImpl = async () => {
    throw new Error('foundry.applications.api.DialogV2.prompt called without a programmed stub');
  };
}
