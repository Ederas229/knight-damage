// Foundry global stubs for the unit suite (vitest setupFiles).
// Only what the damage classes touch *inside methods*: foundry.utils,
// foundry.applications.api.DialogV2, fromUuidSync, game, canvas, ChatMessage.

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

globalThis.game = {
  userId: 'user-unit-test',
  users: {
    activeGM: {
      id: 'user-unit-test',
      name: 'GM de test',
      query: async (queryName, queryData) => {
        queryCalls.push({ queryName, data: structuredClone(queryData) });
        return {};
      },
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

export function resetRecorders() {
  messageCreations.length = 0;
  queryCalls.length = 0;
  dialogPrompts.length = 0;
}

export function setDialogPrompt(handler) {
  dialogPromptImpl = handler;
}

// Runs the REAL options.ok.callback(event, button) with a fake form button
// (button.form.elements.value.valueAsNumber = valueAsNumber), so tests
// exercise the production clamp/validation logic instead of programming a
// result. The prompt promise resolves with whatever the callback returns.
export function setDialogPromptCallback(valueAsNumber) {
  dialogPromptImpl = async (options) =>
    options.ok.callback({ type: 'click' }, { form: { elements: { value: { valueAsNumber } } } });
}

export function resetDialogPrompt() {
  dialogPromptImpl = async () => {
    throw new Error('foundry.applications.api.DialogV2.prompt called without a programmed stub');
  };
}
