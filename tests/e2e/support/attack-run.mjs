// The scripted "standard attack" used to RECORD the shared knight-message fixtures.
//
// What this runs inside the page, and why it IS the real system flow (knight 3.58.38 sources
// under Data/systems/knight; all line numbers from that tree):
//   1. `game.knight.RollKnight` (module/documents/roll.mjs:23, registered in module/knight.mjs:124)
//      is the system's own roll wrapper. `prepareWpnContact(item)` (roll.mjs:3843) builds the
//      message-side weapon object — `effets.raw` is copied verbatim from the item system
//      (roll.mjs:3883-3887), which is how `['percearmure 40','penetrant 6']` reaches
//      `flags.knight.weapon.effets.raw`.
//   2. `doRoll()` (roll.mjs:88) takes the weapon branch: `new Roll(formula)` (roll.mjs:147) +
//      `#prepareRollWeapon` (roll.mjs:1200) reads targets from `game.user.targets` (roll.mjs:1210)
//      → targeting the victim token is REQUIRED (no combat needed), and `#sendRollWeapon`
//      (roll.mjs:1385) creates the attack chat message and writes flags via `addFlags`
//      (helpers/common.mjs:6106, scope flags.knight) — flags.knight.content[0].targets carries
//      the hit/miss target entries.
//   3. The system's OWN chat handler for the attack message's `Dégâts` button (hooks.mjs:205
//      `.knight-roll button.degats` → `rollDamage(message, ev)` in helpers/common.mjs:5865) is
//      triggered by a real DOM click through the framework; rollDamage calls
//      `doRollDamage` (roll.mjs:667) whose `#handleDamageEffet` (roll.mjs:2045) rolls
//      `new Roll('<degats.dice>D6')` (roll.mjs:3011) and pins `t.value = total` / `t.isValue =
//      true` per target (roll.mjs:3187-3188) BEFORE `addFlags(msg, flags)` (roll.mjs:793) — so
//      the DAMAGE message carries flags.knight.targets[].value exactly as damageBase.js:43 reads
//      it. `percearmure`/`penetrant` produce only label entries (roll.mjs:2419/2422), no sub-rolls,
//      and the attacker has no custom attack effects (roll.mjs:1788-1853) → exactly two dice
//      pools fire per recorded run: the attack pool and the damage pool (both plain d6 pools
//      through Foundry's Roll API, hence dice-override-pinnable).

import { fileURLToPath } from 'node:url';

// World fixture anchors (docs/testing-plan.md Phase 0 tables; stable ids)
export const ATTACKER_ACTOR_ID = 'kdtAtkPnjAAAAAAA';
export const ATTACKER_TOKEN_NAME = 'atk-pnj';
export const VICTIM_TOKEN_NAME = 'vic-knight';
export const VICTIM_TOKEN_ID = 'tkVicKnightAAAAA';

// ── The standard weapon: the same contract the unit-suite STANDARD_RAW pins ──
export const STANDARD_WEAPON = Object.freeze({
  // 16-char alphanumeric _id (Foundry isValidId): pinning it makes the recorded fixture
  // byte-stable across re-recordings (Item embedded create accepts an explicit _id).
  _id: 'kdtWpnStandardAA',
  name: 'Kdt Arme Standard',
  type: 'arme',
  system: Object.freeze({
    degats: Object.freeze({ dice: 3, fixe: 2 }), // damage roll = 3D6 + 2 (added post-roll as bonus)
    violence: Object.freeze({ dice: 2, fixe: 0 }),
    effets: Object.freeze({ raw: Object.freeze(['percearmure 40', 'penetrant 6']), custom: Object.freeze([]) }),
  }),
});

// ── Deterministic dice plan (FIFO per die-type/count in the dice-override extension) ──
// Attack pool  3D6 → total 7 → dice [2,2,3] → 2 successes (knight counts EVEN faces,
//              roll.mjs:949-951), 1 failure so no exploit re-roll (roll.mjs:1008) and no epicfail.
// Damage pool  3D6 → total 12 → dice [4,4,4] → value = 12 + fixe 2 = 14 per target.
export const ATTACK_DICE = Object.freeze({ faces: 6, count: 3, total: 7, formula: '3D6' });
export const DAMAGE_DICE = Object.freeze({ faces: 6, count: 3, total: 12 });
export const EXPECTED_TARGET_VALUE = DAMAGE_DICE.total + STANDARD_WEAPON.system.degats.fixe; // 14

export function fixtureFileName(knightVersion) {
  return `attack-pnj-on-knight-standard-knight-${knightVersion}.json`;
}

// ── Page-context functions (framework STRINGIFY RULE: no closures over test vars; values come
//    in as trailing args) ──

/** Creates the standard weapon on the attacker actor; returns {itemId, keptRequestedId}. */
export const createWeaponInPage = async (actorId, weaponData) => {
  const actor = game.actors.get(actorId);
  if (!actor) throw new Error(`attacker actor ${actorId} not found`);

  // v13+: actor.items is a read-only Collection; creation goes through
  // createEmbeddedDocuments, and {keepId: true} honors our pinned _id (byte-stable
  // re-recordings). If a build still refuses it, fall back to an auto id (then weapon ids
  // drift between runs).
  const seed = { name: weaponData.name, type: weaponData.type, system: weaponData.system };
  let created = [];
  try {
    created = await actor.createEmbeddedDocuments('Item', [{ ...seed, _id: weaponData._id }], { keepId: true });
  } catch {
    created = await actor.createEmbeddedDocuments('Item', [seed]);
  }
  const item = created[0];
  if (!item) throw new Error('createEmbeddedDocuments("Item") returned nothing');

  // Prepare-order sanity: the damage processor dedups raw lines through a Set, keeping order.
  const raw = item.system.effets.raw;
  return {
    itemId: item.id,
    keptRequestedId: item.id === weaponData._id,
    raw,
  };
};

/** Targets the victim token (game.user.targets — the only targeting the system flow reads). */
export const targetVictimInPage = (victimTokenId) => {
  const token = canvas.tokens.get(victimTokenId);
  if (!token) throw new Error(`victim token ${victimTokenId} not on the active scene`);
  token.setTarget(true);
  return game.user.targets.size;
};

/**
 * Runs the real attack roll (system's own RollKnight.doRoll weapon branch) and returns the
 * attack message's id + a compact view of what the system stored in its flags.
 * The actor is resolved THROUGH THE ATTACKER TOKEN (canvas.tokens.get(id).actor), exactly like
 * a live GM clicking from a token. NOTE (fixture world): the atk-pnj token is seeded
 * actorLink:true, so token.actor IS the prototype actor instance and the knight speaker
 * (this.actor?.token) records token/scene = null — the real behaviour for linked tokens.
 * An UNLINKED token would instead yield a synthetic actor whose .token back-reference fills
 * the speaker, after which rollDamage re-resolves via canvas.tokens.get(speaker.token).actor
 * (helpers/common.mjs:5883).
 */
export const runAttackInPage = async (attackerTokenId, weaponItemId, diceFormula) => {
  const actor = canvas.tokens.get(attackerTokenId)?.actor;
  if (!actor) throw new Error(`attacker token ${attackerTokenId} has no linked actor`);
  const item = actor.items.get(weaponItemId);
  if (!item) throw new Error(`weapon ${weaponItemId} not on attacker`);

  const messagesBefore = game.messages.size;
  const roll = new game.knight.RollKnight(
    actor,
    {
      name: `${item.name} : ${game.i18n.localize('KNIGHT.AUTRE.Attaque')}`,
      dices: diceFormula,
    },
    true,
  );
  const weapon = roll.prepareWpnContact(item); // roll.mjs:3843 — copies effets.raw verbatim
  roll.setWeapon(weapon);
  await roll.doRoll(); // roll.mjs:88 — weapon branch does NOT await #sendRollWeapon (roll.mjs:163)

  // #sendRollWeapon is fire-and-forget inside doRoll: poll for the attack message AND its
  // flags (created first via ChatMessage.create, then addFlags awaits — roll.mjs:1461-1465).
  let attackMessage;
  for (let i = 0; i < 60; i++) {
    attackMessage = game.messages.contents.at(-1);
    if (game.messages.size > messagesBefore && attackMessage?.flags?.knight) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!attackMessage || game.messages.size <= messagesBefore) throw new Error('attack message never appeared');

  const targets = (attackMessage.getFlag('knight', 'content') ?? []).flatMap((c) => c.targets ?? []);
  return {
    attackMessageId: attackMessage.id,
    messageCount: game.messages.size,
    attackTargets: targets.map((t) => ({ id: t.id, hit: t.hit === true, difficulty: t.difficulty })),
  };
};

/** Waits for (in page terms) the damage message and returns its full source object. */
export const dumpLastDamageMessageInPage = (mustHaveValueFor) => {
  const message = game.messages.contents.at(-1);
  const flags = message?.flags?.knight;
  const target = flags?.targets?.find((t) => t.id === mustHaveValueFor);
  if (!target || target.isValue !== true || typeof target.value !== 'number') {
    return null; // waitFor retries
  }
  return {
    damageMessageId: message.id,
    messageCount: game.messages.size,
    object: message.toObject(true),
  };
};

/**
 * Reads back whether the MODULE injected its damage buttons on the live damage message
 * (renderChatMessageHTML → .damageButton in knight-damage.js:261-287) — the recording-time
 * proof that what we just recorded is a message the module acts on.
 */
export const moduleButtonsInPage = () => {
  const cards = document.querySelectorAll('.chat-scroll li.chat-message');
  const card = cards[cards.length - 1];
  if (!card) return null;
  return Array.from(card.querySelectorAll('.damageButton button')).map((b) => ({
    label: b.textContent.trim(),
    action: b.dataset.action,
  }));
};

// ── Node-side volatile stripper (applied before the fixture JSON is written) ──
// Kept deliberately explicit (path-scoped), NOT a blanket "delete every id" walk:
// flags.knight.targets[].id (token ids) and flags.knight.actor._id are WORLD-FIXTURE ids and
// must survive — damageBase.js:43 matches targets by token id and :107 resolves the attacker.
export function stripVolatileKeys(messageObject) {
  const obj = structuredClone(messageObject);

  // v14 ChatMessage field volatiles (author = creator user id, regenerated by a fresh test world).
  for (const key of ['_id', 'id', 'timestamp', 'userId', 'author']) delete obj[key];

  // ChatMessage.rolls entries carry a random per-roll _id; their results/pips are deterministic
  // under the dice plan and stay (the module regexes/renders are content-side, not rolls-side).
  for (const rollEntry of obj.rolls ?? []) delete rollEntry._id;

  // flags.knight.attaque = the attack message's rolls (helpers/common.mjs:5897) — same random
  // per-roll _ids.
  for (const attackRoll of obj.flags?.knight?.attaque ?? []) delete attackRoll._id;

  // Deep, NAME-keyed neutralization of core document metadata that embeds run-volatile values:
  // _stats.{createdTime,modifiedTime,lastModifiedBy} and ownership maps keyed by the ephemeral
  // GM user id (they appear inside flags.knight.actor / flags.knight.weapon snapshots too).
  walkAndNeutralizeVolatileMetadata(obj);

  return obj;
}

function walkAndNeutralizeVolatileMetadata(node) {
  if (Array.isArray(node)) {
    for (const item of node) walkAndNeutralizeVolatileMetadata(item);
    return;
  }
  if (!node || typeof node !== 'object') return;

  if (node._stats && typeof node._stats === 'object') {
    for (const key of ['createdTime', 'modifiedTime', 'lastModifiedBy']) {
      if (key in node._stats) node._stats[key] = null;
    }
  }
  if (node.ownership && typeof node.ownership === 'object') {
    const fallback = node.ownership.default ?? 0;
    for (const key of Object.keys(node.ownership)) delete node.ownership[key];
    node.ownership.default = fallback;
  }

  for (const value of Object.values(node)) walkAndNeutralizeVolatileMetadata(value);
}

export function buildFixtureMeta({ knightVersion, coreVersion, worldId, weaponItemId, diceOverrideApplied }) {
  return {
    fixtureMeta: {
      kind: 'knight-damage/attack-damage-message',
      recordedFromWorld: worldId,
      knightSystemVersion: knightVersion,
      coreVersion,
      attackerActorId: ATTACKER_ACTOR_ID,
      victimTokenId: VICTIM_TOKEN_ID,
      weaponItemSeed: STANDARD_WEAPON,
      weaponItemId,
      dicePlan: { attack: ATTACK_DICE, damage: DAMAGE_DICE, expectedTargetValue: EXPECTED_TARGET_VALUE },
      diceOverrideApplied,
      notes:
        'Damage message recorded from a scripted real attack (atk-pnj -> vic-knight) through the ' +
        "knight system's own RollKnight.doRoll + chat .degats button flow. Loaders must strip this " +
        'fixtureMeta key. Re-record after any knight system upgrade.',
    },
  };
}

/** Recursively drops undefined/empty artifacts that JSON.stringify would omit anyway. */
export function normalizeForWrite(value) {
  return JSON.parse(JSON.stringify(value));
}

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures', import.meta.url));
