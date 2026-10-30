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
  return makeMessage({
    content,
    speaker: { scene, token: initiatorTokenId },
    flags: {
      knight: {
        targets,
        weapon: { effets: { raw: weaponRaw } },
        actor: {
          _id: initiatorActorId,
          type: initiatorType,
          items: initiatorItems,
          system: { origin: initiatorSystemOrigin },
        },
      },
    },
  });
}

// The knight chat HTML fragment extractTraitValue regexes over:
// <span class="label">Label</span><span class="value">+N</span>
export function traitSpan(label, value) {
  return `<span class="label">${label}</span><span class="value">+${value}</span>`;
}
