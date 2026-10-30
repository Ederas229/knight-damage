import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DamageKnight } from '../../src/module/damageKnight.js';
import { makeActor, makeItem, makeKnightMessage, makeToken, traitSpan } from './support/doubles.mjs';
import { registerUuid, clearUuidRegistry, resetRecorders, recordedQueries } from './support/foundry-globals.mjs';

const ATTACKER_UUID = 'Scene.scene-1.Token.token-atk';
const VICTIM_UUID = 'Scene.scene-1.Token.token-def.Actor.actor-def';
const STANDARD_RAW = ['percearmure 40', 'penetrant 6'];

// Standard fixture per the test plan: full 100 armor, CdF 10 straddling
// penetrant 6, guardian gear, sante 20, espoir 15 (reduction 3), energie 12.
function knightSystem({
  armure = 100,
  cdf = 10,
  egide = 0,
  guardianArmure = 15,
  guardianCdf = 5,
  sante = 20,
  espoir = 15,
  espoirReduction = 3,
  energie = 12,
  wear = 'normal',
} = {}) {
  return {
    armure: { value: armure },
    champDeForce: { value: cdf },
    egide: { value: egide },
    equipements: {
      guardian: { armure: { value: guardianArmure }, champDeForce: { value: guardianCdf } },
    },
    sante: { value: sante },
    espoir: { value: espoir, reduction: espoirReduction },
    energie: { value: energie },
    wear,
  };
}

function knightFixture({
  system,
  weaponRaw = STANDARD_RAW,
  content = '',
  actorItems = [],
  targetValue = 60,
  mult = 1,
  targetStat = false,
  initiatorSystemOrigin = null,
} = {}) {
  registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
  registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });

  const actor = makeActor('knight', system ?? knightSystem(), {
    id: 'actor-def',
    uuid: VICTIM_UUID,
    name: 'Victime',
    items: actorItems,
  });
  const token = makeToken(actor, { id: 'token-def' });
  const message = makeKnightMessage({
    content: `<div class="knight-roll"><div>Dégâts</div>${content}</div>`,
    weaponRaw,
    targets: [{ id: 'token-def', value: targetValue }],
    initiatorSystemOrigin,
  });
  const damage = new DamageKnight(token, message, mult, targetStat);
  return { damage, actor, token, message };
}

beforeEach(() => {
  resetRecorders();
  clearUuidRegistry();
});

describe('constructor / dispatch shape', () => {
  it('is built with a TokenDocument-shaped double (id + actor), as the live dispatch passes e.document', async () => {
    const { damage, token, actor } = knightFixture();
    expect(damage.token).toBe(token);
    expect(damage.actor).toBe(actor);
    expect(token).toHaveProperty('id');
    expect(token).toHaveProperty('actor');
    expect(damage.origin).toBe(ATTACKER_UUID);
    expect(damage.damage).toBe(60);
    expect(damage.actorStats).toEqual({
      armure: 100,
      cdf: 10,
      egide: 0,
      armureGuardian: 15,
      cdfGuardian: 5,
      sante: 20,
      espoir: 15,
      energie: 12,
    });
    expect(damage.perceArmure).toBe(40);
    expect(damage.penetrant).toBe(6);
    expect(damage.cuirDuTaureau).toBe(false);
    expect(damage.anatheme).toBe(false);
    expect(damage.applyEgide).toBe(false);
  });
});

describe('calculate() — standard fixture worked example', () => {
  it('CdF 10 - penetrant 6 = 4, damage 60 - 4 = 56 absorbed by armure, carry trunc(56/5)=11 to sante', async () => {
    const { damage } = knightFixture();
    await damage.calculate();
    expect(damage.effectiveStats.cdf).toBe(4);
    expect(damage.actorStats.armure).toBe(44);
    expect(damage.actorStats.sante).toBe(9);
    expect(damage.damage).toBe(0);
    expect(damage.damageRepartition).toEqual({ armure: 56, sante: 11 });
  });

  it('CHARACTERIZATION: perce-armure 40 against full 100 armor is a no-op — no bypass and no subtraction (applyTraitArmure is commented out in calculate)', async () => {
    const { damage } = knightFixture();
    await damage.calculate();
    expect(damage.isArmorIgnored()).toBe(false);
    // armure was absorbed from its FULL 100 value: 100 - 56 = 44, not 100 - 40 - 56.
    expect(damage.actorStats.armure).toBe(44);
    expect(damage.damageRepartition.armure).toBe(56);
  });
});

describe('destructeur', () => {
  it('adds its value BEFORE the armor soak when the armor track runs', async () => {
    const { damage } = knightFixture({
      weaponRaw: [...STANDARD_RAW, 'destructeur'],
      content: traitSpan('Destructeur', 12),
    });
    expect(damage.damageTraits.destructeur).toEqual({ bool: true, result: 12 });
    await damage.calculate();
    // 56 + 12 = 68 absorbed by the 100 armor, carry trunc(68/5) = 13.
    expect(damage.actorStats.armure).toBe(32);
    expect(damage.actorStats.sante).toBe(7);
    expect(damage.damageRepartition).toEqual({ armure: 68, sante: 13 });
  });
});

describe('armor bypass (worn armor <= perce-armure)', () => {
  it('worn armure 30 vs perce-armure 40: armure track skipped, damage goes straight to sante math', async () => {
    const { damage } = knightFixture({ system: knightSystem({ armure: 30 }) });
    expect(damage.isArmorIgnored()).toBe(true);
    await damage.calculate();
    expect(damage.actorStats.armure).toBe(30);
    expect(damage.actorStats.sante).toBe(0);
    expect(damage.damageRepartition).toEqual({ armure: 0, sante: 20 });
    // CHARACTERIZATION (INTENDED per module author): with the armure track
    // skipped, damage beyond sante (56 - 20 = 36) is left on this.damage and
    // silently dropped, and the guardian branch never runs because
    // actorStats.armure is still > 0. This overflow loss is by design — do not "fix".
    expect(damage.damage).toBe(36);
  });

  it('cuirDuTaureau re-engages the armure track despite the bypass', async () => {
    // CHARACTERIZATION (INTENDED per module author): an item counts as ACTIVE
    // when system.active.base is FALSY (setCuirTaureau early-returns on a
    // truthy base). The inverted-looking guard is the knight system's
    // convention here — do not "fix" it.
    const { damage } = knightFixture({
      system: knightSystem({ armure: 30 }),
      actorItems: [makeItem('Cuir du taureau', { system: { active: { base: false } } })],
    });
    expect(damage.cuirDuTaureau).toBe(true);
    await damage.calculate();
    // armure 30 absorbs first (56-30=26), guardian 15 absorbs next (26-15=11),
    // carry trunc((30+15)/5)=9 then the remaining 11 finishes sante.
    expect(damage.actorStats.armure).toBe(0);
    expect(damage.actorStats.armureGuardian).toBe(0);
    expect(damage.actorStats.sante).toBe(0);
    expect(damage.damageRepartition).toEqual({ armure: 30, armureGuardian: 15, sante: 20 });
  });

  it('instinct-du-loup flag percearmure:"active" zeroes perceArmure, restoring armor behavior for the worn victim', async () => {
    // Same "active when system.active.base is falsy" convention as Cuir du
    // taureau above — INTENDED per module author.
    const loup = makeItem('Instinct du loup', {
      system: { active: { base: false } },
      flags: { 'knight-damage': { loup: { percearmure: 'active' } } },
    });
    const { damage } = knightFixture({ system: knightSystem({ armure: 30 }), actorItems: [loup] });
    await damage.calculate();
    // NB: isArmorIgnored() is re-evaluated live from actorStats — after the
    // armor is depleted it reads 0 <= 0 (true) again; what matters is that
    // the zeroed perceArmure let the armure track run INSIDE calculate.
    expect(damage.perceArmure).toBe(0);
    expect(damage.actorStats.armure).toBe(0);
    expect(damage.actorStats.armureGuardian).toBe(0);
    expect(damage.actorStats.sante).toBe(0);
    expect(damage.damageRepartition).toEqual({ armure: 30, armureGuardian: 15, sante: 20 });
  });
});

describe('champ de force', () => {
  it('CdF 4 with penetrant 6 is fully zeroed, full damage hits the 100 armor', async () => {
    const { damage } = knightFixture({ system: knightSystem({ cdf: 4 }) });
    await damage.calculate();
    expect(damage.effectiveStats.cdf).toBe(0);
    expect(damage.actorStats.armure).toBe(40);
    expect(damage.actorStats.sante).toBe(8);
    expect(damage.damageRepartition).toEqual({ armure: 60, sante: 12 });
  });
});

describe('egide', () => {
  it('damage is reduced by egide BEFORE CdF when the message actor origin is anatheme', async () => {
    const { damage } = knightFixture({
      system: knightSystem({ egide: 8 }),
      initiatorSystemOrigin: 'anatheme',
    });
    expect(damage.applyEgide).toBe(true);
    await damage.calculate();
    // 60 - 8 (egide) - 4 (effective CdF) = 48 absorbed by the 100 armor.
    expect(damage.actorStats.armure).toBe(52);
    expect(damage.actorStats.sante).toBe(11);
    expect(damage.damageRepartition).toEqual({ armure: 48, sante: 9 });
  });
});

describe('espoir target path', () => {
  it('reduction floors the damage, espoir absorbs up to its value, reminder query is recorded', async () => {
    const { damage, actor } = knightFixture({ targetStat: 'espoir' });
    await damage.calculate();
    // 56 - 3 (espoir.reduction) = 53, espoir value 15 absorbs all of it.
    expect(damage.actorStats.espoir).toBe(0);
    expect(damage.damageRepartition).toEqual({ espoir: 15 });

    const [query] = recordedQueries();
    expect(query.queryName).toBe('knight-damage.addReminder');
    expect(query.data).toEqual({
      uuidOrigin: ATTACKER_UUID,
      uuidActor: VICTIM_UUID,
      value: 15,
      stat: 'espoir',
    });

    await damage.apply();
    expect(actor.updates[0]).toEqual({ 'system.espoir.value': 0 });
  });

  it('damage below espoir.reduction is floored at 0 (no espoir lost)', async () => {
    const { damage, actor } = knightFixture({ targetStat: 'espoir', system: knightSystem({ espoirReduction: 60 }) });
    await damage.calculate();
    expect(damage.actorStats.espoir).toBe(15);
    expect(damage.damageRepartition).toEqual({ espoir: 0 });

    const [query] = recordedQueries();
    expect(query.data).toEqual({
      uuidOrigin: ATTACKER_UUID,
      uuidActor: VICTIM_UUID,
      value: 0,
      stat: 'espoir',
    });

    await damage.apply();
    expect(actor.updates[0]).toEqual({});
  });
});

describe('energie target path', () => {
  it('energie absorbs and the addReminder query is recorded', async () => {
    const { damage, actor } = knightFixture({ targetStat: 'energie' });
    await damage.calculate();
    // calculate() calls calculateEnergie() WITHOUT awaiting it; let the async
    // remainder (fromUuid + query) drain before asserting.
    const queries = await vi.waitFor(() => {
      const q = recordedQueries();
      if (q.length < 1) throw new Error('no query recorded yet');
      return q;
    });
    expect(damage.actorStats.energie).toBe(0);
    expect(damage.damageRepartition).toEqual({ energie: 12 });
    expect(queries[0].queryName).toBe('knight-damage.addReminder');
    expect(queries[0].data).toEqual({
      uuidOrigin: ATTACKER_UUID,
      uuidActor: VICTIM_UUID,
      value: 12,
      stat: 'energie',
    });

    await damage.apply();
    // INTENDED (author): apply() always double-updates — the first update
    // carries no stat (armure/sante were never touched on this path), the
    // energie write happens in the second.
    expect(actor.updates[0]).toEqual({});
    expect(actor.updates[1]).toEqual({ 'system.energie.value': 0 });
  });
});
