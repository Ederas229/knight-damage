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

// ── The trait-bearing weapon: the (b) requirement of the plan's third review ──
// The standard weapon's percearmure/penetrant render label-only spans (roll.html:203-205:
// no `value` → `<span class="label merge">`), so extractTraitValue's
// `<span class="label">X</span><span class="value">+N` contract has NO live witness in the
// standard fixture. `destructeur` is value-bearing: the system rolls an EXTRA 2D6 sub-roll
// (roll.mjs:2838-2855) and renders `<span class="label">Destructeur</span>` +
// `<span class="value">+total</span>` (roll.html:198-208, label from lang/fr.json
// KNIGHT.EFFETS.DESTRUCTEUR.Label = "Destructeur" — the exact unaccented label the module's
// const.js pins). Raw keyword stays bare (`'destructeur'`, no number): the value comes from
// the sub-roll, matching how the module reads it (raw keyword for the BOOL, span for the N).
export const TRAIT_WEAPON = Object.freeze({
  _id: 'kdtWpnTraitAAAAA', // 16-char alphanumeric, pinned for byte-stable re-recordings
  name: 'Kdt Arme Trait',
  type: 'arme',
  system: Object.freeze({
    degats: Object.freeze({ dice: 3, fixe: 2 }), // same damage dice as the standard weapon
    violence: Object.freeze({ dice: 2, fixe: 0 }),
    effets: Object.freeze({
      raw: Object.freeze(['percearmure 40', 'penetrant 6', 'destructeur']),
      custom: Object.freeze([]),
    }),
  }),
});

// ── Deterministic dice plan (FIFO per die-type/count in the dice-override extension) ──
// Attack pool  3D6 → total 7 → dice [2,2,3] → 2 successes (knight counts EVEN faces,
//              roll.mjs:949-951), 1 failure so no exploit re-roll (roll.mjs:1008) and no epicfail.
// Damage pool  3D6 → total 12 → dice [4,4,4] → value = 12 + fixe 2 = 14 per target.
export const ATTACK_DICE = Object.freeze({ faces: 6, count: 3, total: 7, formula: '3D6' });
export const DAMAGE_DICE = Object.freeze({ faces: 6, count: 3, total: 12 });
export const EXPECTED_TARGET_VALUE = DAMAGE_DICE.total + STANDARD_WEAPON.system.degats.fixe; // 14

// TRAIT sub-roll: destructeur's extra pool is `2D6` (subdice constant 2 at roll.mjs:2841 via
// doSimpleRoll → new Roll(formula), so it is dice-override-pinnable like everything else).
// The extension matches pools by (faces, number) first-unconsumed, so the plan needs exactly
// one queue entry per (faces, count) PAIR that the run rolls — for the trait weapon that is
// attack 3D6, damage 3D6 and destructeur 2D6 (the 2D6 pool does not collide with the 3D6
// entries: different number).
export const TRAIT_SUBDICE = Object.freeze({ faces: 6, count: 2, total: 6 }); // pips [3,3]
export const EXPECTED_TRAIT_VALUE = TRAIT_SUBDICE.total; // span renders +6, module extracts 6

// PLAN-DRIVEN pool expectations (third review (b): the "exactly one pool per phase" gate is
// the STANDARD plan; the trait plan adds the destructeur sub-roll to the damage message).
export const STANDARD_ATTACK_PLANS = Object.freeze([ATTACK_DICE]);
export const STANDARD_DAMAGE_PLANS = Object.freeze([DAMAGE_DICE]);
export const TRAIT_ATTACK_PLANS = Object.freeze([ATTACK_DICE]);
export const TRAIT_DAMAGE_PLANS = Object.freeze([DAMAGE_DICE, TRAIT_SUBDICE]);

export function fixtureFileName(knightVersion) {
  return `attack-pnj-on-knight-standard-knight-${knightVersion}.json`;
}

export function traitFixtureFileName(knightVersion) {
  return `attack-pnj-on-knight-trait-knight-${knightVersion}.json`;
}

// ── Page-context functions (framework STRINGIFY RULE: no closures over test vars; values come
//    in as trailing args) ──

/** Creates the standard weapon on the attacker actor; returns {itemId, keptRequestedId}. */
export const createWeaponInPage = async (actorId, weaponData) => {
  const actor = game.actors.get(actorId);
  if (!actor) throw new Error(`attacker actor ${actorId} not found`);

  // v13+: actor.items is a read-only Collection; creation goes through
  // createEmbeddedDocuments, and {keepId: true} honors our pinned _id (byte-stable
  // re-recordings). When the world already holds that _id (a record:e2e run without setup:e2e
  // between), v14 REJECTS the create — do NOT swallow it into an auto-id fallback: that is
  // exactly how a stale-world re-record used to drift silently (review 2). Let it throw.
  const seed = { name: weaponData.name, type: weaponData.type, system: weaponData.system };
  let created;
  try {
    created = await actor.createEmbeddedDocuments('Item', [{ ...seed, _id: weaponData._id }], { keepId: true });
  } catch (err) {
    const staleWorld = /already exists within the parent collection/.test(err.message ?? '');
    throw new Error(
      `pinned weapon _id ${weaponData._id} could not be created on ${actorId}: ${err.message} — ` +
        (staleWorld
          ? 'the test world is not fresh; run `npm run setup:e2e` before `npm run record:e2e`'
          : 'unexpected create failure (NOT a stale-world collision: the pinned id was never inserted)'),
    );
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

/** Waits for (in page terms) the damage message and returns its full source object.
 *  MESSAGE-ID-PINNED discovery (third review (a), applied to the recorder too): the damage
 *  message is the ONE message created after `excludeIds` was sampled that carries
 *  flags.knight.targets[tokenId].isValue — "last message" sampling cannot distinguish the
 *  second recording pass from the first, and multiple candidates are surfaced as an error
 *  object instead of silently dumping the wrong one. */
export const dumpNewDamageMessageInPage = (excludeIds, mustHaveValueFor) => {
  const fresh = game.messages.contents.filter((m) => !excludeIds.includes(m.id));
  const ready = fresh.filter((m) =>
    m.flags?.knight?.targets?.some(
      (t) => t.id === mustHaveValueFor && t.isValue === true && typeof t.value === 'number',
    ),
  );
  if (ready.length === 0) return null; // waitFor retries
  if (ready.length > 1)
    return { error: `${ready.length} new damage messages with a pinned target value: ${ready.map((m) => m.id)}` };
  const message = ready[0];
  return {
    damageMessageId: message.id,
    messageCount: game.messages.size,
    object: message.toObject(true),
  };
};

/** Clears every current target then targets exactly the victim token (game.user.targets is the
 *  only targeting the system flow reads, roll.mjs:1210; the FIRST attack can leave the target
 *  set dirty, so the second recording pass must re-pin it). */
export const retargetVictimInPage = (victimTokenId) => {
  for (const token of Array.from(game.user.targets)) token.setTarget(false);
  const token = canvas.tokens.get(victimTokenId);
  if (!token) throw new Error(`victim token ${victimTokenId} not on the active scene`);
  token.setTarget(true);
  return game.user.targets.size;
};

/**
 * Reads back whether the MODULE injected its damage buttons on a PINNED damage-message card
 * (renderChatMessageHTML → .damageButton in knight-damage.js:261-287) — the recording-time
 * proof that what we just recorded is a message the module acts on. Null (not []) while
 * injection is pending: an empty array is truthy and would satisfy a waitFor predicate before
 * the renderChatMessageHTML hook has run.
 */
export const moduleButtonsOnCardInPage = (msgId) => {
  const cards = document.querySelectorAll('.chat-scroll li.chat-message');
  const card = Array.from(cards).find((li) => li.dataset.messageId === msgId);
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
 * Snapshots the dice-override extension queue (dice-override/content.js owns
 * window.__diceOverrideQueue): the recorder gates on every entry being CONSUMED with the
 * planned faces/number/value, proving the override was actually installed and that no pool
 * went un-overridden (the entry-matching is faces+number, first-unconsumed).
 */
/** Page-function: reset the dice-override extension's GLOBAL queue (it survives across passes). */
export const clearDiceQueueInPage = () => {
  if (!Array.isArray(window.__diceOverrideQueue)) window.__diceOverrideQueue = [];
  else window.__diceOverrideQueue.length = 0; // in place: keep any identity the extension captured
  return window.__diceOverrideQueue.length;
};

export const diceQueueStateInPage = () =>
  (window.__diceOverrideQueue ?? []).map((e) => ({
    faces: e.faces,
    number: e.number,
    value: e.value,
    consumed: e.consumed === true,
  }));

// ── Node-side volatile stripper (applied before the fixture JSON is written) ──
// Kept deliberately explicit (path-scoped), NOT a blanket "delete every id" walk:
// flags.knight.targets[].id (token ids) and flags.knight.actor._id are WORLD-FIXTURE ids and
// must survive — damageBase.js:43 matches targets by token id and :107 resolves the attacker.
export function stripVolatileKeys(messageObject) {
  const obj = structuredClone(messageObject);

  // v14 ChatMessage field volatiles (author = creator user id, regenerated by a fresh test world).
  for (const key of ['_id', 'id', 'timestamp', 'userId', 'author']) delete obj[key];

  // rolls / flags.knight.attaque need NO stripping: in v14 rolls[] are serialized JSON STRINGS
  // while flags.knight.attaque[] holds live Roll-shaped OBJECTS (both verified against the
  // committed fixture bytes), and neither carries run-volatile fields (the dice plan pins every
  // pip; the earlier per-roll-_id delete loops here were no-ops and are gone). They stay in the
  // fixture — byte-stability over multiple clean chains plus the pip-level recorder gate prove it.

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

export function buildFixtureMeta({
  knightVersion,
  coreVersion,
  worldId,
  weaponItemSeed,
  weaponItemId,
  diceOverrideApplied,
  dicePlan,
}) {
  return {
    fixtureMeta: {
      kind: 'knight-damage/attack-damage-message',
      recordedFromWorld: worldId,
      knightSystemVersion: knightVersion,
      coreVersion,
      attackerActorId: ATTACKER_ACTOR_ID,
      victimTokenId: VICTIM_TOKEN_ID,
      weaponItemSeed,
      weaponItemId,
      dicePlan,
      diceOverrideApplied,
      notes:
        'Damage message recorded from a scripted real attack (atk-pnj -> vic-knight) through the ' +
        "knight system's own RollKnight.doRoll + chat .degats button flow. Loaders must strip this " +
        'fixtureMeta key. Re-record after any knight system upgrade.',
    },
  };
}

// Recursively drops undefined/empty artifacts that JSON.stringify would omit anyway.
export function normalizeForWrite(value) {
  return JSON.parse(JSON.stringify(value));
}

// ── Shared integrity gate pieces (third review (b): plan-driven pool expectations) ──

// The extension's exact pip layout (dice-override content.js:45-51): every active die carries
// floor(total/count) and the LAST active die carries the remainder.
export function planPips(plan) {
  const base = Math.floor(plan.total / plan.count);
  return Array.from(
    { length: plan.count },
    (_, i) => base + (i === plan.count - 1 ? plan.total - base * plan.count : 0),
  );
}

// v14 stores ChatMessage.rolls as serialized JSON STRINGS but flags.knight.attaque as live
// Roll OBJECTS inside the flag — accept both shapes (JSON.parse only on strings).
function asRoll(entry) {
  return typeof entry === 'string' ? JSON.parse(entry) : entry;
}

/**
 * Gate every planned dice pool of one message: exactly pools.length === plans.length serialized
 * pools, each plan (faces, count, total, pips) matched by EXACTLY ONE pool (order-independent:
 * the knight damage phase can sub-roll BEFORE its main pool — the destructeur 2D6 at
 * roll.mjs:2838-2844 precedes the 3D6 damage roll at :3011 — so pools are matched as a SET,
 * never positionally). A plan matched twice or a pool without a plan means an un-overridden or
 * hijacked pool — random pips sneaking into the shared baseline.
 * Returns an array of human-readable failures (empty = gate passes).
 */
export function checkPools(label, entries, plans) {
  const failures = [];
  let pools;
  try {
    pools = entries.map(asRoll);
  } catch (err) {
    failures.push(`${label}: roll entries unparseable: ${err.message}`);
    return failures;
  }
  if (pools.length !== plans.length) {
    const shapes = pools.map((p) => (p.terms ?? []).filter((t) => t.class === 'Die').map((d) => [d.faces, d.number]));
    failures.push(
      `${label}: expected exactly ${plans.length} serialized roll pool(s) for this plan, got ${pools.length} (shapes ${JSON.stringify(shapes)})`,
    );
    return failures;
  }
  const unconsumed = [...plans];
  for (const roll of pools) {
    const dice = (roll.terms ?? []).filter((t) => t.class === 'Die');
    const planIdx = unconsumed.findIndex(
      (plan) => dice.length === 1 && dice[0].faces === plan.faces && dice[0].number === plan.count,
    );
    if (planIdx === -1) {
      failures.push(
        `${label}: unexpected pool ${JSON.stringify(dice.map((d) => [d.faces, d.number]))} (no unconsumed plan matches its die shape)`,
      );
      continue;
    }
    const plan = unconsumed.splice(planIdx, 1)[0];
    const pips = (dice[0].results ?? []).filter((r) => r.active === true).map((r) => r.result);
    if (JSON.stringify(pips) !== JSON.stringify(planPips(plan)))
      failures.push(`${label}: pips ${JSON.stringify(pips)} != pinned plan pips ${JSON.stringify(planPips(plan))}`);
    if (roll.total !== plan.total) failures.push(`${label}: roll total ${roll.total} != plan total ${plan.total}`);
  }
  for (const plan of unconsumed)
    failures.push(
      `${label}: planned pool ${plan.faces}d${plan.count} (total ${plan.total}) never appeared in the message`,
    );
  return failures;
}

// The exact HTML contract extractTraitValue (helpers.js:26-33) keys on, as the SYSTEM really
// renders it (templates/dices/roll.html:198-208 + the doSimpleRoll callers): value-bearing
// effects produce `<span class="label">LABEL</span>` immediately followed by
// `<span class="value">+<sub-roll total></span>` — the module's own regex shape witnessed
// live, not the fabricated traitSpan() unit shape. One source string per side of the pin.
const traitSpanSource = (label) => `<span class="label">${label}<\\/span>\\s*<span class="value">\\+\\d*`;

/** Same regex source the damage suite pins live against the replayed trait fixture. */
export const TRAIT_SPAN_REGEX_SOURCE = traitSpanSource('Destructeur');

/**
 * Verify a trait VALUE span (label span immediately followed by a `+N` value span) really is
 * present in a recorded message content, and that the extracted value matches the dice plan.
 * Deliberately re-derives the module's own regex source (helpers.js:27-29) rather than a
 * substring shortcut: this is the live witness the unit traitSpan() shape was invented for.
 */
export function checkTraitSpan(content, label, expectedValue) {
  const failures = [];
  const matches = Array.from(content.matchAll(new RegExp(traitSpanSource(label), 'g')));
  if (matches.length !== 1) {
    failures.push(`trait span (${label}): expected exactly 1 label+value span pair, got ${matches.length}`);
    return failures;
  }
  const digits = matches[0][0].match(/\d+/);
  const extracted = digits ? Number(digits[0]) : NaN;
  if (extracted !== expectedValue)
    failures.push(`trait span (${label}): extracted ${extracted} != pinned sub-roll total ${expectedValue}`);
  return failures;
}

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures', import.meta.url));
