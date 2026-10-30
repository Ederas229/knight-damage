import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DamageVehicule } from '../../src/module/damageVehicule.js';
import { DamageMecha } from '../../src/module/damageMecha.js';
import { makeActor, makeKnightMessage, makeToken, traitSpan } from './support/doubles.mjs';
import { registerUuid, clearUuidRegistry, resetRecorders, recordedQueries } from './support/foundry-globals.mjs';

const ATTACKER_UUID = 'Scene.scene-1.Token.token-atk';

function registerAttacker() {
  registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
  registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
}

beforeEach(() => {
  resetRecorders();
  clearUuidRegistry();
});

describe('vehicule', () => {
  // setActorStats in damageVehicule.js reads system.armure.value (NOT a
  // "blindage" stat), system.champDeForce.value and system.energie.value.
  function vehiculeSystem({ armure = 30, cdf = 3, energie = 12 } = {}) {
    return { armure: { value: armure }, champDeForce: { value: cdf }, energie: { value: energie } };
  }

  function vehiculeFixture({
    system,
    weaponRaw = [],
    content = '',
    targetValue = 60,
    mult = 1,
    targetStat = false,
  } = {}) {
    registerAttacker();
    const actor = makeActor('vehicule', system ?? vehiculeSystem(), {
      id: 'actor-veh',
      uuid: 'Scene.scene-1.Token.token-def.Actor.actor-veh',
    });
    const token = makeToken(actor, { id: 'token-def' });
    const message = makeKnightMessage({
      content: `<div class="knight-roll"><div>Dégâts</div>${content}</div>`,
      weaponRaw,
      targets: [{ id: 'token-def', value: targetValue }],
    });
    const damage = new DamageVehicule(token, message, mult, targetStat);
    return { damage, actor, message };
  }

  it('type vehicule always has colosse on: incoming damage is trunc(damage / 10)', () => {
    // 130 -> /10 -> 13, -3 CdF -> 10 absorbed by the 30 armor (20 left).
    // Without the /10 the full 127 would have drained the armor to 0.
    const { damage } = vehiculeFixture({ targetValue: 130 });
    damage.calculate();
    expect(damage.isColosseApplied()).toBe(true);
    expect(damage.actorStats.armure).toBe(20);
    expect(damage.damageRepartition).toEqual({ armure: 10, passenger: 2 });
  });

  it('CHARACTERIZATION: "passenger" is not a stat on the actor, so calculateArmureVersSante leaves actorStats.passenger as NaN (only the repartition is meaningful)', () => {
    const { damage } = vehiculeFixture({ targetValue: 130 });
    damage.calculate();
    expect(damage.damageRepartition.passenger).toBe(2); // trunc(10 / 5)
    expect(Number.isNaN(damage.actorStats.passenger)).toBe(true);
  });

  it('normal attack: destructeur is applied at gate 1 BEFORE the /10 division (isColosseApplied() && trunc(D/10)-cdf > 0)', () => {
    // (600 + 12) / 10 = 61, -3 CdF -> 58 absorbed by the 65 armor -> 7 left.
    // If destructeur had been applied after the division, the total reaching
    // the armor would have been 60 - 3 + 12 = 69 (> 65), draining it fully.
    const { damage } = vehiculeFixture({
      system: vehiculeSystem({ armure: 65 }),
      weaponRaw: ['destructeur'],
      content: traitSpan('Destructeur', 12),
      targetValue: 600,
    });
    damage.calculate();
    expect(damage.actorStats.armure).toBe(7);
    expect(damage.damageRepartition).toEqual({ armure: 58, passenger: 11 });
  });

  it('normal attack: gate 1 does NOT fire when trunc(D/10) - cdf <= 0, and the attack fizzles with no damage', () => {
    // trunc(30/10) = 3, CdF 5 -> gate 1 false; damage 3 - 5 <= 0 -> early return.
    const { damage, actor } = vehiculeFixture({
      system: vehiculeSystem({ cdf: 5 }),
      weaponRaw: ['destructeur'],
      content: traitSpan('Destructeur', 12),
      targetValue: 30,
    });
    damage.calculate();
    expect(damage.damageTraits.destructeur).toEqual({ bool: true, result: 12 });
    expect(damage.damageRepartition).toEqual({});
    expect(damage.actorStats.armure).toBe(30);
    expect(actor.updates).toEqual([]);
  });

  it('REGRESSION 0f244f0: antivehicule vs vehicule with armor — gate 1 is false but gate 2 (armure > 0 && !isColosseApplied()) applies destructeur exactly once', () => {
    // No /10 with antivehicule: 600 - 3 CdF = 597, +12 destructeur = 609,
    // absorbed by the 610 armor -> 1 left. Double application (621) would
    // have drained the armor to 0.
    const { damage } = vehiculeFixture({
      system: vehiculeSystem({ armure: 610 }),
      weaponRaw: ['antivehicule', 'destructeur'],
      content: traitSpan('Destructeur', 12),
      targetValue: 600,
    });
    expect(damage.isColosseApplied()).toBe(false);
    damage.calculate();
    expect(damage.actorStats.armure).toBe(1);
    expect(damage.damageRepartition).toEqual({ armure: 609, passenger: 121 });
  });

  it('antivehicule alone defeats the /10 colosse rule (no division)', () => {
    // 600 - 3 CdF = 597 against the 610 armor -> 13 left (with colosse it
    // would have been 60 - 3 = 57 absorbed, leaving 553).
    const { damage } = vehiculeFixture({
      system: vehiculeSystem({ armure: 610 }),
      weaponRaw: ['antivehicule'],
      targetValue: 600,
    });
    damage.calculate();
    expect(damage.actorStats.armure).toBe(13);
  });

  it('energie target path: /10 and CdF apply, energie drops, addReminder query is recorded', async () => {
    const { damage, actor } = vehiculeFixture({ targetValue: 60, targetStat: 'energie' });
    damage.calculate();
    const queries = await vi.waitFor(() => {
      const q = recordedQueries();
      if (q.length < 1) throw new Error('no query recorded yet');
      return q;
    });
    // 60 -> /10 -> 6, -3 CdF -> 3 absorbed by the 12 energie -> 9.
    expect(damage.actorStats.energie).toBe(9);
    expect(damage.damageRepartition).toEqual({ energie: 3 });
    expect(queries[0].data).toEqual({
      uuidOrigin: ATTACKER_UUID,
      uuidActor: 'Scene.scene-1.Token.token-def.Actor.actor-veh',
      value: 3,
      stat: 'energie',
    });

    damage.apply();
    // INTENDED (author): apply() always double-updates — first update is
    // empty (no armure/sante repartition), the energie write is the second.
    expect(actor.updates[0]).toEqual({});
    expect(actor.updates[1]).toEqual({ 'system.energie.value': 9 });
  });
});

describe('mechaarmure', () => {
  function mechaSystem({ blindage = 30, cdf = 0, energie = 10, resilience = 1 } = {}) {
    return {
      blindage: { value: blindage },
      champDeForce: { value: cdf },
      energie: { value: energie },
      resilience: { value: resilience },
    };
  }

  function mechaFixture({ system, weaponRaw = [], targetValue = 60, mult = 1, targetStat = false } = {}) {
    registerAttacker();
    const actor = makeActor('mechaarmure', system ?? mechaSystem(), {
      id: 'actor-mecha',
      uuid: 'Scene.scene-1.Token.token-def.Actor.actor-mecha',
    });
    const token = makeToken(actor, { id: 'token-def' });
    const message = makeKnightMessage({
      weaponRaw,
      targets: [{ id: 'token-def', value: targetValue }],
    });
    const damage = new DamageMecha(token, message, mult, targetStat);
    return { damage, actor };
  }

  it('blindage track: /10 colosse with resilience != 0, passenger carry uses tranche 10', () => {
    // 260 -> /10 -> 26 absorbed by the 30 blindage -> 4 left,
    // passenger trunc(26 / 10) = 2 (tranche 10, NOT tranche 5 which gives 5).
    const { damage, actor } = mechaFixture({ targetValue: 260 });
    damage.calculate();
    expect(damage.actorStats.blindage).toBe(4);
    expect(damage.damageRepartition).toEqual({ blindage: 26, passenger: 2 });

    damage.apply();
    expect(actor.updates[0]).toEqual({ 'system.blindage.value': 4 });
    expect(actor.updates[1]).toEqual({ 'system.blindage.value': 4 });
  });

  it('resilience.value 0 turns colosse off (no /10) and the overflow uses tranche 10', () => {
    // 60 against the 30 blindage: absorbed fully (blindage 0),
    // passenger trunc(30 / 10) = 3 (with colosse on: damage 6, blindage 24;
    // with tranche 5: passenger 6).
    const { damage } = mechaFixture({ system: mechaSystem({ resilience: 0 }), targetValue: 60 });
    expect(damage.isColosseApplied()).toBe(false);
    damage.calculate();
    expect(damage.actorStats.blindage).toBe(0);
    expect(damage.damageRepartition).toEqual({ blindage: 30, passenger: 3 });
  });

  it('INTENDED (author): mecha WITHOUT a resilience stat has colosse on (resilience?.value undefined !== 0)', () => {
    const system = mechaSystem();
    delete system.resilience;
    const { damage } = mechaFixture({ system, targetValue: 60 });
    expect(damage.isColosseApplied()).toBe(true);
    damage.calculate();
    expect(damage.actorStats.blindage).toBe(24);
    expect(damage.damageRepartition).toEqual({ blindage: 6, passenger: 0 });
  });
});
