import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DamageBase } from '../../src/module/damageBase.js';
import { makeActor, makeToken, makeKnightMessage, traitSpan } from './support/doubles.mjs';
import {
  registerUuid,
  clearUuidRegistry,
  resetRecorders,
  recordedDialogPrompts,
  setDialogPrompt,
  setDialogPromptCallback,
  resetDialogPrompt,
} from './support/foundry-globals.mjs';

const ATTACKER_UUID = 'Scene.scene-1.Token.token-atk';

function baseFixture({
  weaponRaw = [],
  targets = [{ id: 'token-def', value: 60 }],
  content,
  actorType = 'knight',
  system = {},
} = {}) {
  registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
  registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });

  const actor = makeActor(actorType, system, {
    id: 'actor-def',
    uuid: 'Scene.scene-1.Token.token-def.Actor.actor-def',
  });
  const token = makeToken(actor, { id: 'token-def' });
  const message = makeKnightMessage({ content, weaponRaw, targets });
  const damage = new DamageBase(token, message, 1, false);
  return { damage, actor, token, message };
}

beforeEach(() => {
  resetRecorders();
  clearUuidRegistry();
});

afterEach(() => {
  resetDialogPrompt();
});

describe('damage extraction from flags.knight.targets', () => {
  it('multiplies the target value by mult and applies Math.ceil', () => {
    registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const build = (value, mult) => {
      const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
      const message = makeKnightMessage({ targets: [{ id: 'token-def', value }] });
      return new DamageBase(token, message, mult, false).damage;
    };
    expect(build(11, 0.5)).toBe(6);
    expect(build(12, 0.5)).toBe(6);
    expect(build(30, 2)).toBe(60);
    expect(build(60, 1)).toBe(60);
  });

  it('matches the target entry by token.id', () => {
    const { damage } = baseFixture({ targets: [{ id: 'someone-else', value: 99 }] });
    expect(damage.damage).toBe(0);
  });

  it('with a two-entry targets list, picks the entry whose id matches whatever its position', () => {
    const first = baseFixture({
      targets: [
        { id: 'token-def', value: 40 },
        { id: 'other-token', value: 99 },
      ],
    });
    expect(first.damage.damage).toBe(40);
    const second = baseFixture({
      targets: [
        { id: 'other-token', value: 99 },
        { id: 'token-def', value: 40 },
      ],
    });
    expect(second.damage.damage).toBe(40);
  });

  it('ceil-vs-round discriminator: value 7 x mult 0.2 (= 1.4000000000000001 in floats) becomes Math.ceil 2, not Math.round 1', () => {
    registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const message = makeKnightMessage({ targets: [{ id: 'token-def', value: 7 }] });
    const damage = new DamageBase(token, message, 0.2, false);
    expect(damage.damage).toBe(2);
  });
});

describe('Débordement / Mode Oriflamme content fallback', () => {
  it('reads the damage from the >\\n N \\n< fragment when there is no target entry', () => {
    const content = '<div>Dégâts</div><div>Débordement</div>\n<div>\n 43\n</div>';
    const attacker = makeActor('pnj', {}, { id: 'actor-atk' });
    registerUuid('Actor.actor-atk', attacker);
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const message = makeKnightMessage({ content, targets: [] });
    const damage = new DamageBase(token, message, 0.5, false);
    // FIXED 2026-10-30 (author confirmed oversight): the Débordement fallback
    // now applies Math.ceil like the targets path — 43 * 0.5 = 21.5 -> 22.
    expect(damage.damage).toBe(22);
  });

  it('also triggers on the "Mode Oriflamme :" marker', () => {
    const content = '<div>Mode Oriflamme :</div>\n<div>\n 25\n</div>';
    registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const message = makeKnightMessage({ content, targets: [] });
    const damage = new DamageBase(token, message, 2, false);
    expect(damage.damage).toBe(50);
  });

  // Regex relaxed 2026-10-31 (damageBase.js:53): `>\r?\n\s*\d+\r?\n\s*<`. The
  // old strict-LF pattern `>\n\s*\d+\n\s*<` never matched CRLF content, and the
  // pre-fix code then did `number[0]` on null — a TypeError crash in the constructor.
  it('CRLF content now PARSES (regex relaxed with \\r?): >\\r\\n 43 \\r\\n< x mult 1 = 43 (pre-fix: regex miss then a null[0] TypeError)', () => {
    const content = '<div>Dégâts</div><div>Débordement</div>\r\n<div>\r\n 43\r\n</div>';
    registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const message = makeKnightMessage({ content, targets: [] });
    const damage = new DamageBase(token, message, 1, false);
    expect(damage.damage).toBe(43);
  });

  // Null guard 2026-10-31 (damageBase.js:54): `if (number)` — a Débordement marker
  // with no >\r?\n N \r?\n< fragment at all leaves this.damage at its class-field 0.
  // Pre-fix this construction threw a TypeError (number[0] on null).
  it('Débordement marker with NO numeric fragment: the null-guard keeps damage at its 0 default — construction succeeds, no TypeError', () => {
    const content = '<div>Dégâts</div><div>Débordement</div><div>pas de nombre ici</div>';
    registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const message = makeKnightMessage({ content, targets: [] });
    let damage;
    expect(() => {
      damage = new DamageBase(token, message, 1, false);
    }).not.toThrow();
    expect(damage.damage).toBe(0);
  });

  it('auto-adds initiator item effects to weapon.effets.raw on the Débordement path', () => {
    const content = '<div>Débordement</div>\n<div>\n 40\n</div>';
    registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const message = makeKnightMessage({
      content,
      targets: [],
      initiatorItems: [{ name: 'Ignore Armure' }, { name: 'Ignore CdF' }, { name: 'Anti-véhicule' }],
    });
    const damage = new DamageBase(token, message, 1, false);
    expect(message.flags.knight.weapon.effets.raw).toEqual(
      expect.arrayContaining(['ignorearmure', 'ignorechampdeforce', 'antivehicule']),
    );
    expect(damage.ignoreArmure).toBe(true);
    expect(damage.ignoreCdf).toBe(true);
    expect(damage.antivehicule).toBe(true);
  });

  it('does not add effects when the initiator lacks the items', () => {
    const content = '<div>Débordement</div>\n<div>\n 40\n</div>';
    registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const message = makeKnightMessage({ content, targets: [] });
    new DamageBase(token, message, 1, false);
    expect(message.flags.knight.weapon.effets.raw).toEqual([]);
  });

  it('ceil-vs-round discriminator: Débordement 7 x mult 0.2 becomes Math.ceil 2, not Math.round 1 (same fix as the targets path)', () => {
    const content = '<div>Dégâts</div><div>Débordement</div>\n<div>\n 7\n</div>';
    registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const message = makeKnightMessage({ content, targets: [] });
    const damage = new DamageBase(token, message, 0.2, false);
    expect(damage.damage).toBe(2);
  });

  it('the Débordement auto-adds go into the message flag array, never back into the array the caller passed to makeKnightMessage', () => {
    const content = '<div>Débordement</div>\n<div>\n 40\n</div>';
    registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const callerArray = [];
    const message = makeKnightMessage({
      content,
      targets: [],
      weaponRaw: callerArray,
      initiatorItems: [{ name: 'Ignore Armure' }],
    });
    new DamageBase(token, message, 1, false);
    // makeKnightMessage cloned the array: the auto-add landed in the flag copy only.
    expect(message.flags.knight.weapon.effets.raw).toEqual(['ignorearmure']);
    expect(callerArray).toEqual([]);
  });
});

describe('percearmure / penetrant parsing from weapon.effets.raw', () => {
  it('parses "percearmure 40" and "penetrant 6" entries', () => {
    const { damage } = baseFixture({ weaponRaw: ['percearmure 40', 'penetrant 6'] });
    expect(damage.perceArmure).toBe(40);
    expect(damage.penetrant).toBe(6);
  });

  it('leaves both at 0 when absent', () => {
    const { damage } = baseFixture({ weaponRaw: ['antivehicule'] });
    expect(damage.perceArmure).toBe(0);
    expect(damage.penetrant).toBe(0);
  });

  // Guard applied 2026-10-31 (helpers.js getTraitValue): the keyword matched but
  // the entry has no trailing number -> 0 instead of NaN. Without the guard both
  // fields below would be NaN and every downstream CdF/armure subtraction NaN-poisoned.
  it('malformed raw entries WITHOUT a number ("percearmure" / "penetrant" bare) parse to 0, not NaN', () => {
    const { damage } = baseFixture({ weaponRaw: ['percearmure', 'penetrant'] });
    expect(damage.perceArmure).toBe(0);
    expect(damage.penetrant).toBe(0);
  });

  // Clamp added 2026-10-31 (helpers.js getTraitValue): negative entries clamp to 0 at
  // parse time. Without the clamp (pre-existing hazard, review 4 F2), 'penetrant -6'
  // would make applyTraitCdf compute effectiveStats.cdf = 10 - (-6) = 16 — the knight's
  // CdF INFLATED by its own weapon (damage 60 would drop to 44, defender-favoring).
  it('negative raw entries ("percearmure -5" / "penetrant -6") clamp to 0: applyTraitCdf leaves CdF at 10, not inflated to 16', () => {
    const { damage } = baseFixture({ weaponRaw: ['percearmure -5', 'penetrant -6'] });
    expect(damage.perceArmure).toBe(0);
    expect(damage.penetrant).toBe(0);
    damage.actorStats.cdf = 10;
    damage.effectiveStats.cdf = 10;
    damage.applyTraitCdf();
    expect(damage.effectiveStats.cdf).toBe(10);
  });
});

describe('boolean traits (setBooleanTraits)', () => {
  it('exact raw membership enables the boolean traits', () => {
    const { damage } = baseFixture({
      weaponRaw: ['antianatheme', 'ignorearmure', 'ignorechampdeforce', 'antivehicule', 'destructeur'],
      content: traitSpan('Destructeur', 12),
    });
    expect(damage.antianatheme).toBe(true);
    expect(damage.ignoreArmure).toBe(true);
    expect(damage.ignoreCdf).toBe(true);
    expect(damage.antivehicule).toBe(true);
    expect(damage.damageTraits.destructeur).toEqual({ bool: true, result: 12 });
    expect(damage.damageTraits.meurtrier).toEqual({ bool: false, result: 0 });
  });

  it('falls back to the anti-anatheme status on the message actor when raw lacks antianatheme', () => {
    const attacker = makeActor(
      'pnj',
      {},
      {
        id: 'actor-atk',
        temporaryEffects: [{ statuses: new Set(['anti-anatheme']) }],
      },
    );
    registerUuid('Actor.actor-atk', attacker);
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const message = makeKnightMessage({});
    const damage = new DamageBase(token, message, 1, false);
    expect(damage.antianatheme).toBe(true);
  });

  it('isRecap short-circuits boolean traits and perce/penetrant parsing', () => {
    // Empty uuid registry: if setBooleanTraits ran, fromUuidSync would return
    // undefined and hasStatusEffect(undefined, ...) would throw.
    registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const message = makeKnightMessage({
      weaponRaw: ['percearmure 40', 'penetrant 6'],
      targets: [{ id: 'token-def', value: 60 }],
    });
    message.flags['knight-damage'] = { isRecap: true };
    const damage = new DamageBase(token, message, 1, false);
    expect(damage.damage).toBe(60);
    expect(damage.perceArmure).toBe(0);
    expect(damage.penetrant).toBe(0);
    expect(damage.damageTraits.destructeur.bool).toBe(false);
  });
});

describe('applyTraitCdf', () => {
  function withCdf(cdf, penetrant, ignoreCdf = false) {
    const { damage } = baseFixture();
    damage.actorStats.cdf = cdf;
    damage.effectiveStats.cdf = cdf;
    damage.penetrant = penetrant;
    damage.ignoreCdf = ignoreCdf;
    damage.applyTraitCdf();
    return damage.effectiveStats.cdf;
  }

  it('subtracts penetrant when cdf is above it', () => {
    expect(withCdf(10, 6)).toBe(4);
  });

  it('zeroes cdf when it is at or below penetrant', () => {
    expect(withCdf(4, 6)).toBe(0);
    expect(withCdf(6, 6)).toBe(0);
  });

  it('zeroes cdf when ignorechampdeforce is set', () => {
    expect(withCdf(10, 0, true)).toBe(0);
  });
});

describe('isArmorIgnored', () => {
  it('full 100 armor vs perce-armure 40 is NOT a bypass', () => {
    const { damage } = baseFixture({ weaponRaw: ['percearmure 40'] });
    damage.actorStats.armure = 100;
    expect(damage.isArmorIgnored()).toBe(false);
  });

  it('worn 30 armor vs perce-armure 40 IS a bypass', () => {
    const { damage } = baseFixture({ weaponRaw: ['percearmure 40'] });
    damage.actorStats.armure = 30;
    expect(damage.isArmorIgnored()).toBe(true);
  });

  it('ignorearmure forces a bypass regardless of armor value', () => {
    const { damage } = baseFixture({ weaponRaw: ['ignorearmure'] });
    damage.actorStats.armure = 100;
    expect(damage.isArmorIgnored()).toBe(true);
  });

  it('boundary pair pinning the `<=`: armure 40 exactly EQUAL to perce-armure 40 IS a bypass, 41 is not', () => {
    const { damage } = baseFixture({ weaponRaw: ['percearmure 40'] });
    damage.actorStats.armure = 40;
    expect(damage.isArmorIgnored()).toBe(true);
    damage.actorStats.armure = 41;
    expect(damage.isArmorIgnored()).toBe(false);
  });

  // getTraitValue guard (2026-10-31): a bare 'percearmure' entry parses to 0, so the
  // value clause stays false for a full-armor victim and the normal soak path runs.
  // Without the guard perceArmure would be NaN: isArmorIgnored() still reads false
  // (100 <= NaN is false) but applyTraitArmure's `armure <= NaN` is false too and
  // `effectiveStats.armure -= NaN` would poison the armor math to NaN.
  it('malformed bare "percearmure" (no number) parses perceArmure to 0: full armure 100 vs 0 is NOT a bypass (normal soak path)', () => {
    const { damage } = baseFixture({ weaponRaw: ['percearmure'] });
    expect(damage.perceArmure).toBe(0);
    damage.actorStats.armure = 100;
    expect(damage.isArmorIgnored()).toBe(false);
    damage.effectiveStats.armure = 100;
    damage.applyTraitArmure();
    expect(damage.effectiveStats.armure).toBe(100);
  });
});

describe('calculateDamageStat', () => {
  function statFixture({ stat = 'armure', damage, statValue }) {
    const { damage: dmg } = baseFixture();
    dmg.damage = damage;
    dmg.actorStats[stat] = statValue;
    dmg.effectiveStats[stat] = statValue;
    dmg.damageRepartition[stat] = 0;
    dmg.calculateDamageStat(stat);
    return dmg;
  }

  it('overflow: stat fully absorbs, remainder stays in damage', () => {
    const dmg = statFixture({ damage: 37, statValue: 30 });
    expect(dmg.damage).toBe(7);
    expect(dmg.actorStats.armure).toBe(0);
    expect(dmg.effectiveStats.armure).toBe(0);
    expect(dmg.damageRepartition.armure).toBe(30);
  });

  it('partial: damage is fully absorbed and stat drops', () => {
    const dmg = statFixture({ damage: 10, statValue: 30 });
    expect(dmg.damage).toBe(0);
    expect(dmg.actorStats.armure).toBe(20);
    expect(dmg.damageRepartition.armure).toBe(10);
  });

  it('exact boundary: damage equal to the stat takes the else branch (damage fully absorbed)', () => {
    const dmg = statFixture({ damage: 30, statValue: 30 });
    expect(dmg.damage).toBe(0);
    expect(dmg.actorStats.armure).toBe(0);
    expect(dmg.damageRepartition.armure).toBe(30);
    // effectiveStats stays untouched on equality — the dead `- 0` leftover in
    // the else branch was removed 2026-10-30 (author confirmed), behavior
    // unchanged: the partial branch never decremented effectiveStats anyway.
    expect(dmg.effectiveStats.armure).toBe(30);
  });

  it('on the partial branch effectiveStats is not decremented (dead `- 0` leftover removed; no observable change)', () => {
    const dmg = statFixture({ damage: 10, statValue: 30 });
    expect(dmg.effectiveStats.armure).toBe(30);
  });
});

describe('calculateArmureVersSante', () => {
  it('tranche 5: carries trunc(armureDamage / 5) into sante', () => {
    const { damage: dmg } = baseFixture();
    dmg.actorStats.sante = 20;
    dmg.effectiveStats.sante = 20;
    dmg.damageRepartition.sante = 0;
    dmg.calculateArmureVersSante(45);
    expect(dmg.actorStats.sante).toBe(11);
    expect(dmg.damageRepartition.sante).toBe(9);
  });

  it('tranche 5: caps at the remaining stat when carry exceeds it', () => {
    const { damage: dmg } = baseFixture();
    dmg.actorStats.sante = 20;
    dmg.effectiveStats.sante = 20;
    dmg.damageRepartition.sante = 0;
    dmg.calculateArmureVersSante(200);
    expect(dmg.actorStats.sante).toBe(0);
    expect(dmg.damageRepartition.sante).toBe(20);
  });

  it('tranche 10 (mecha form): carries trunc(armureDamage / 10)', () => {
    const { damage: dmg } = baseFixture();
    dmg.actorStats.sante = 20;
    dmg.effectiveStats.sante = 20;
    dmg.damageRepartition.sante = 0;
    dmg.calculateArmureVersSante(26, 'sante', 10);
    expect(dmg.actorStats.sante).toBe(18);
    expect(dmg.damageRepartition.sante).toBe(2);
  });
});

describe('calculateDamageStatWithColosse / isColosseApplied', () => {
  function colosseFixture({ system = {}, weaponRaw = [], actorType = 'knight' } = {}) {
    const { damage } = baseFixture({ weaponRaw, actorType, system });
    damage.damage = 65;
    damage.calculateDamageStatWithColosse();
    return damage;
  }

  it('trunc / 10 when colosse applies', () => {
    const dmg = colosseFixture({ system: { resilience: { value: 3 } } });
    expect(dmg.damage).toBe(6);
  });

  it('no division when resilience.value is 0', () => {
    const dmg = colosseFixture({ system: { resilience: { value: 0 } } });
    expect(dmg.damage).toBe(65);
  });

  it('antivehicule defeats the colosse rule', () => {
    const dmg = colosseFixture({ system: { resilience: { value: 3 } }, weaponRaw: ['antivehicule'] });
    expect(dmg.antivehicule).toBe(true);
    expect(dmg.damage).toBe(65);
  });

  it('vehicule type is always colosse (even without a resilience stat)', () => {
    const dmg = colosseFixture({ actorType: 'vehicule' });
    expect(dmg.damage).toBe(6);
  });

  it('INTENDED (author): an actor WITHOUT a resilience stat has colosse on (undefined !== 0)', () => {
    const dmg = colosseFixture({ actorType: 'mechaarmure' });
    expect(dmg.isColosseApplied()).toBe(true);
    expect(dmg.damage).toBe(6);
  });
});

describe('askModifier (DialogV2 stub)', () => {
  it('adds the dialog damage to the base damage', async () => {
    setDialogPrompt(async () => ({ damage: 7 }));
    const { damage } = baseFixture();
    expect(damage.damage).toBe(60);
    await damage.askModifier();
    expect(damage.damage).toBe(67);
  });

  // The two callback-path cases below route a fake form button through the REAL
  // options.ok.callback (see setDialogPromptCallback), so they pin the
  // production input validation of damageBase.js:87 rather than a programmed
  // return value.
  it('callback path, valueAsNumber NaN (empty/invalid number input): the finite guard returns {damage:0} — base damage stays 60 (it would become NaN without the guard)', async () => {
    setDialogPromptCallback(Number.NaN);
    const { damage } = baseFixture();
    await damage.askModifier();
    expect(damage.damage).toBe(60);
    const [prompt] = recordedDialogPrompts();
    expect(prompt.window.title).toBe('Damage modifier');
    expect(prompt.content).toContain('name="value" type="number"');
  });

  it('callback path, finite valueAsNumber -5: the real callback reads -5 off the form and returns {damage:-5} — 60 - 5 = 55 (proves the value routing, not a programmed result)', async () => {
    setDialogPromptCallback(-5);
    const { damage } = baseFixture();
    await damage.askModifier();
    expect(damage.damage).toBe(55);
    expect(recordedDialogPrompts()).toHaveLength(1);
  });

  // Same guard as the NaN pin above (damageBase.js:87), now on the +Infinity side:
  // Number.isFinite(+Infinity) is false -> {damage:0}. Without the guard the prompt
  // would resolve {damage:Infinity} and `this.damage += mod.damage` would leave
  // this.damage at Infinity — no later clamp or comparison anywhere in askModifier
  // can rescue it (unlike askDamageEnergie, there is no clamp here to fall back on).
  it('callback path, valueAsNumber +Infinity: the finite guard returns {damage:0} — base damage stays 60 (it would become Infinity without the guard)', async () => {
    setDialogPromptCallback(Number.POSITIVE_INFINITY);
    const { damage } = baseFixture();
    await damage.askModifier();
    expect(damage.damage).toBe(60);
  });
});

describe('apply() update payload mapping', () => {
  function applyFixture({ repartition, stats, actorType = 'knight' }) {
    const { damage, actor } = baseFixture({ actorType });
    damage.damageRepartition = repartition;
    damage.actorStats = stats;
    damage.apply();
    return actor;
  }

  it('maps each repartition entry to its system path', () => {
    const actor = applyFixture({
      repartition: { armure: 10, blindage: 5, armureGuardian: 3, sante: 7, espoir: 1 },
      stats: { armure: 90, blindage: 45, armureGuardian: 12, sante: 13, espoir: 14 },
    });
    expect(actor.updates[0]).toEqual({
      'system.armure.value': 90,
      'system.blindage.value': 45,
      'system.equipements.guardian.armure.value': 12,
      'system.sante.value': 13,
      'system.espoir.value': 14,
    });
  });

  it('energie is written in a second update call', () => {
    const actor = applyFixture({
      repartition: { sante: 7, energie: 4 },
      stats: { sante: 13, energie: 11 },
    });
    expect(actor.updates[0]).toEqual({ 'system.sante.value': 13 });
    expect(actor.updates[1]).toEqual({ 'system.energie.value': 11 });
  });

  it('INTENDED (author): cohesion damage is written to "system.sante.value"', () => {
    const actor = applyFixture({
      repartition: { cohesion: 2 },
      stats: { cohesion: 8 },
    });
    expect(actor.updates[0]).toEqual({ 'system.sante.value': 8 });
  });

  it('INTENDED (consequence of the cohesion mapping): when both sante and cohesion are in the repartition, the cohesion entry overwrites the sante one', () => {
    const actor = applyFixture({
      repartition: { sante: 7, cohesion: 2 },
      stats: { sante: 13, cohesion: 8 },
    });
    expect(actor.updates[0]).toEqual({ 'system.sante.value': 8 });
  });

  it('INTENDED (author): apply() always calls actor.update twice; without an energie repartition the second call repeats the first payload', () => {
    const actor = applyFixture({
      repartition: { sante: 7 },
      stats: { sante: 13 },
    });
    expect(actor.updates).toHaveLength(2);
    expect(actor.updates[1]).toEqual({ 'system.sante.value': 13 });
  });

  it('INTENDED (author): an empty repartition still emits update({}) twice', () => {
    const actor = applyFixture({ repartition: {}, stats: {} });
    expect(actor.updates).toEqual([{}, {}]);
  });
});
