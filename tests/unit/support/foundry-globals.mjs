// Foundry global stubs for the unit suite (vitest setupFiles).
// Only what the damage classes touch *inside methods*: foundry.utils,
// foundry.applications.api.DialogV2, fromUuidSync, game, canvas, ChatMessage.

const uuidRegistry = new Map();

const messageCreations = [];
const queryCalls = [];

let dialogPromptImpl = async () => {
  throw new Error('foundry.applications.api.DialogV2.prompt called without a programmed stub');
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Minimal recursive merge matching the semantics the source relies on:
// merge into plain objects, 2nd argument merged into the 1st, returns target.
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
        prompt: (options) => dialogPromptImpl(options),
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

export function resetRecorders() {
  messageCreations.length = 0;
  queryCalls.length = 0;
}

export function setDialogPrompt(handler) {
  dialogPromptImpl = handler;
}

export function resetDialogPrompt() {
  dialogPromptImpl = async () => {
    throw new Error('foundry.applications.api.DialogV2.prompt called without a programmed stub');
  };
}
