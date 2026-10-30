import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DamageBase } from '../../src/module/damageBase.js';
import { makeActor, makeToken, makeKnightMessage, traitSpan } from './support/doubles.mjs';
import {
  registerUuid,
  clearUuidRegistry,
  resetRecorders,
  setDialogPrompt,
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
    // CHARACTERIZATION: the Débordement fallback multiplies by mult WITHOUT
    // Math.ceil (unlike the targets path) — 43 * 0.5 = 21.5 is kept as-is.
    expect(damage.damage).toBe(21.5);
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
    // CHARACTERIZATION: equality is NOT the overflow branch, so effectiveStats
    // stays untouched here as well (the -= 0 quirk, see below).
    expect(dmg.effectiveStats.armure).toBe(30);
  });

  it('CHARACTERIZATION: on the partial branch effectiveStats is NOT decremented (damage is zeroed before the subtraction)', () => {
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

  it('CHARACTERIZATION: an actor WITHOUT a resilience stat has colosse on (undefined !== 0)', () => {
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

  it('CHARACTERIZATION: cohesion damage is written to "system.sante.value" (damageBase.js:286)', () => {
    const actor = applyFixture({
      repartition: { cohesion: 2 },
      stats: { cohesion: 8 },
    });
    expect(actor.updates[0]).toEqual({ 'system.sante.value': 8 });
  });

  it('CHARACTERIZATION: when both sante and cohesion are in the repartition, the cohesion entry overwrites the sante one', () => {
    const actor = applyFixture({
      repartition: { sante: 7, cohesion: 2 },
      stats: { sante: 13, cohesion: 8 },
    });
    expect(actor.updates[0]).toEqual({ 'system.sante.value': 8 });
  });

  it('CHARACTERIZATION: apply() always calls actor.update twice; without an energie repartition the second call repeats the first payload', () => {
    const actor = applyFixture({
      repartition: { sante: 7 },
      stats: { sante: 13 },
    });
    expect(actor.updates).toHaveLength(2);
    expect(actor.updates[1]).toEqual({ 'system.sante.value': 13 });
  });

  it('CHARACTERIZATION: an empty repartition still emits update({}) twice', () => {
    const actor = applyFixture({ repartition: {}, stats: {} });
    expect(actor.updates).toEqual([{}, {}]);
  });
});
