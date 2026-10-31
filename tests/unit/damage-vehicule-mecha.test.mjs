import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DamageVehicule } from '../../src/module/damageVehicule.js';
import { DamageMecha } from '../../src/module/damageMecha.js';
import { makeActor, makeKnightMessage, makeToken, traitSpan } from './support/doubles.mjs';
import { clearUuidRegistry, resetRecorders, recordedQueries } from './support/foundry-globals.mjs';
import { ATTACKER_UUID, registerAttacker } from './support/knight-fixtures.mjs';

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

  it('applyTraitCdf: CdF 10 vs penetrant 6 lowers effective CdF to 4, and the reduced CdF is subtracted AFTER the /10 colosse division (6 - 4 = 2 absorbed)', () => {
    const { damage } = vehiculeFixture({
      system: vehiculeSystem({ cdf: 10 }),
      weaponRaw: ['penetrant 6'],
      targetValue: 60,
    });
    damage.calculate();
    expect(damage.effectiveStats.cdf).toBe(4);
    // Without applyTraitCdf the subtraction would be 6 - 10 = -4 -> early
    // return with no damage at all, so these values fail on that mutation.
    expect(damage.actorStats.armure).toBe(28);
    expect(damage.damageRepartition).toEqual({ armure: 2, passenger: 0 });
  });

  it('applyTraitCdf zeroing: CdF 4 <= penetrant 6 zeroes the effective CdF (full 6 after /10 reaches the armor)', () => {
    const { damage } = vehiculeFixture({
      system: vehiculeSystem({ cdf: 4 }),
      weaponRaw: ['penetrant 6'],
      targetValue: 60,
    });
    damage.calculate();
    expect(damage.effectiveStats.cdf).toBe(0);
    expect(damage.actorStats.armure).toBe(24);
    expect(damage.damageRepartition).toEqual({ armure: 6, passenger: 1 });
  });

  it("raw 'meurtrier'/'fureur'/'ultraviolence' + matching label spans on a vehicule: bools TRUE and results parsed, but the math is bit-identical to the bare twin — 60 -> /10 -> 6, -3 CdF -> 3 absorbed by the 30 armure (27 left), {armure:3, passenger:0} in both. Source oracle: DamageVehicule.calculate calls applyDamageTrait ONLY for destructeur (gates at damageVehicule.js:19-21 and :32-34); meurtrier is applied only by DamageKnight (damageKnight.js:179), and fureur/ultraviolence are never applied by any live class", () => {
    const spanned = vehiculeFixture({
      weaponRaw: ['meurtrier', 'fureur', 'ultraviolence'],
      content: `${traitSpan('Meurtrier', 9)}${traitSpan('Fureur', 3)}${traitSpan('Ultraviolence', 5)}`,
      targetValue: 60,
    });
    // Parsing side (constructor): every raw-set trait gets bool + span value,
    // destructeur stays the untouched class default.
    expect(spanned.damage.damageTraits).toEqual({
      destructeur: { bool: false, result: 0 },
      meurtrier: { bool: true, result: 9 },
      ultraviolence: { bool: true, result: 5 },
      fureur: { bool: true, result: 3 },
    });
    const bare = vehiculeFixture({ targetValue: 60 });
    spanned.damage.calculate();
    bare.damage.calculate();
    expect(spanned.damage.damageRepartition).toEqual({ armure: 3, passenger: 0 });
    // Twin equality: same actorStats (armure 27 / cdf 3 / energie 12, plus the
    // CHARACTERIZED passenger NaN), same repartition map, same stranded damage.
    expect(spanned.damage.actorStats).toEqual(bare.damage.actorStats);
    expect(spanned.damage.damageRepartition).toEqual(bare.damage.damageRepartition);
    expect(spanned.damage.damage).toBe(bare.damage.damage);
    expect(spanned.damage.actorStats.armure).toBe(27);
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

  function mechaFixture({ system, weaponRaw = [], content = '', targetValue = 60, mult = 1, targetStat = false } = {}) {
    registerAttacker();
    const actor = makeActor('mechaarmure', system ?? mechaSystem(), {
      id: 'actor-mecha',
      uuid: 'Scene.scene-1.Token.token-def.Actor.actor-mecha',
    });
    const token = makeToken(actor, { id: 'token-def' });
    const message = makeKnightMessage({
      // With content empty this is byte-identical to makeKnightMessage's own
      // default content (the Dégâts marker only).
      content: `<div class="knight-roll"><div>Dégâts</div>${content}</div>`,
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

  it('applyTraitCdf: CdF 10 vs penetrant 6 lowers effective CdF to 4 before the subtraction (colosse 6 - 4 = 2 absorbed by the 30 blindage)', () => {
    const { damage } = mechaFixture({
      system: mechaSystem({ cdf: 10 }),
      weaponRaw: ['penetrant 6'],
      targetValue: 60,
    });
    damage.calculate();
    expect(damage.effectiveStats.cdf).toBe(4);
    // Without applyTraitCdf the subtraction would be 6 - 10 = -4 -> early
    // return with an empty repartition, so these values fail on that mutation.
    expect(damage.actorStats.blindage).toBe(28);
    expect(damage.damageRepartition).toEqual({ blindage: 2, passenger: 0 });
  });

  it("raw 'destructeur'/'meurtrier'/'fureur'/'ultraviolence' + matching label spans on a mecha: all four bools TRUE and results parsed, but the math is bit-identical to the bare twin — 60 -> /10 -> 6, CdF 0, the 30 blindage absorbs all 6 (24 left), {blindage:6, passenger:0} in both. Source oracle: DamageMecha.calculate contains NO applyDamageTrait call at all — even destructeur, the single trait DamageVehicule applies (its gates), is dead weight on mecha", () => {
    const spanned = mechaFixture({
      weaponRaw: ['destructeur', 'meurtrier', 'fureur', 'ultraviolence'],
      content: `${traitSpan('Destructeur', 12)}${traitSpan('Meurtrier', 9)}${traitSpan('Fureur', 3)}${traitSpan('Ultraviolence', 5)}`,
      targetValue: 60,
    });
    expect(spanned.damage.damageTraits).toEqual({
      destructeur: { bool: true, result: 12 },
      meurtrier: { bool: true, result: 9 },
      ultraviolence: { bool: true, result: 5 },
      fureur: { bool: true, result: 3 },
    });
    const bare = mechaFixture({ targetValue: 60 });
    spanned.damage.calculate();
    bare.damage.calculate();
    expect(spanned.damage.damageRepartition).toEqual({ blindage: 6, passenger: 0 });
    expect(spanned.damage.actorStats).toEqual(bare.damage.actorStats);
    expect(spanned.damage.damageRepartition).toEqual(bare.damage.damageRepartition);
    expect(spanned.damage.damage).toBe(bare.damage.damage);
    // The +12 destructeur WOULD have made a knight re-armour-soak 12 more
    // (cf. the gate pins in damage-knight.test.mjs); on mecha armure 24 stays.
    expect(spanned.damage.actorStats.blindage).toBe(24);
  });

  it("energie target twin of the vehicule energie pin: /10 colosse applies, CdF 0 changes nothing, the 6 damage is FULLY absorbed by the 10 energie (energie 10 -> 4, damage 0) — the blindage track NEVER runs on this path (blindage stays 30, no blindage key); query {value: 6, stat: 'energie'}, apply() double-writes [{}, {system.energie.value: 4}]", async () => {
    const { damage, actor } = mechaFixture({ targetValue: 60, targetStat: 'energie' });
    damage.calculate();
    const queries = await vi.waitFor(() => {
      const q = recordedQueries();
      if (q.length < 1) throw new Error('no query recorded yet');
      return q;
    });
    expect(damage.actorStats.energie).toBe(4);
    expect(damage.actorStats.blindage).toBe(30);
    expect(damage.damage).toBe(0); // 6 < 10: the partial branch, nothing stranded
    expect(damage.damageRepartition).toEqual({ energie: 6 });
    expect(queries[0].data).toEqual({
      uuidOrigin: ATTACKER_UUID,
      uuidActor: 'Scene.scene-1.Token.token-def.Actor.actor-mecha',
      value: 6,
      stat: 'energie',
    });

    damage.apply();
    // INTENDED (author): apply() always double-updates — the first payload is
    // empty (no blindage/sante/cohesion/espoir repartition), energie is second.
    expect(actor.updates[0]).toEqual({});
    expect(actor.updates[1]).toEqual({ 'system.energie.value': 4 });
  });
});
