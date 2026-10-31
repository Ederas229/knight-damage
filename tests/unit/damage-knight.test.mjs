import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DamageKnight } from '../../src/module/damageKnight.js';
import { makeActor, makeItem, makeKnightMessage, makeToken, traitSpan } from './support/doubles.mjs';
import {
  registerUuid,
  clearUuidRegistry,
  resetRecorders,
  recordedQueries,
  recordedDialogPrompts,
  setDialogPrompt,
  setDialogPromptCallback,
  resetDialogPrompt,
} from './support/foundry-globals.mjs';

const ATTACKER_UUID = 'Scene.scene-1.Token.token-atk';
const VICTIM_UUID = 'Scene.scene-1.Token.token-def.Actor.actor-def';
// Frozen so any source-side push into weapon.effets.raw that ever bypassed
// the makeKnightMessage copy would throw here instead of silently leaking
// into every later fixture using this constant.
const STANDARD_RAW = Object.freeze(['percearmure 40', 'penetrant 6']);

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

// armure 0 victims: isArmorIgnored() is trivially true (0 <= perceArmure with
// the default raw carrying NO percearmure entry, so perceArmure stays 0), hence
// the armure track is skipped (repartition.armure stays 0) and the post-CdF
// damage reaches the guardian gate directly.
function zeroArmureFixture({
  system,
  statuses = [],
  weaponRaw = ['penetrant 6'],
  content = '',
  targetValue = 60,
} = {}) {
  registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
  registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
  const actor = makeActor('knight', system, {
    id: 'actor-def',
    uuid: VICTIM_UUID,
    name: 'Victime',
    temporaryEffects: statuses.map((status) => ({ statuses: new Set([status]) })),
  });
  const token = makeToken(actor, { id: 'token-def' });
  const message = makeKnightMessage({
    content: `<div class="knight-roll"><div>Dégâts</div>${content}</div>`,
    weaponRaw,
    targets: [{ id: 'token-def', value: targetValue }],
  });
  return { damage: new DamageKnight(token, message, 1, false), actor };
}

beforeEach(() => {
  resetRecorders();
  clearUuidRegistry();
});

afterEach(() => {
  resetDialogPrompt();
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

  it('CHARACTERIZATION: 70 damage vs full 100 armor — the no-op subtraction is detectable: 70 absorbed from the full value (armure 30 left) and the /5 carry is trunc(70/5)=14 of the ABSORBED damage', async () => {
    // CdF 0 with penetrant 6 is zeroed, so the full 70 reaches the armor track.
    // If applyTraitArmure() were ever re-enabled, the effective armor would be
    // 60: observable here would be armure 40 left (70 - 60 overflow damage),
    // repartition {armure: 60, sante: 20} and sante drained to 0 (carry 12 +
    // the 10 overflow finishing the remaining 8). The values below detect it.
    const { damage } = knightFixture({ system: knightSystem({ cdf: 0 }), targetValue: 70 });
    // Checked BEFORE calculate: isArmorIgnored() re-reads actorStats live, and
    // after the soak actorStats.armure (30) would satisfy 30 <= 40 anyway.
    expect(damage.isArmorIgnored()).toBe(false);
    await damage.calculate();
    expect(damage.actorStats.armure).toBe(30); // 100 - 70, absorbed from the full value
    expect(damage.actorStats.sante).toBe(6); // 20 - trunc(70 / 5) = 20 - 14
    expect(damage.damageRepartition).toEqual({ armure: 70, sante: 14 });
    expect(damage.damage).toBe(0);
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

describe('destructeur gate (damageKnight.js:151-154: bonus only when the armure track runs)', () => {
  // Negative controls for the two scenarios where the armure track is skipped.
  // The trait is parsed (bool + result) but the gate
  // `effectiveStats.armure > 0 && (!isArmorIgnored() || cuirDuTaureau)` blocks
  // applyDamageTrait('destructeur'). Every repartition number below equals the
  // unlabeled twin; the discriminating number is the stranded damage, 36 as
  // pinned vs the 48 (56 + 12 - 20 sante) an unguarded +12 would leave.
  // NB: the worn-armor case is the discriminating one (only the isArmorIgnored
  // clause blocks there); in the armure-0 case BOTH clauses block independently,
  // so that fixture only breaks if the whole gate is removed — it is kept as the
  // documentation twin of the folde scenario.

  it('worn armure 30 vs perce-armure 40 (bypassed) + Destructeur +12: gate blocks the bonus — {armure:0, sante:20}, armure 30 and armureGuardian 15 untouched, stranded 36 (48 unguarded)', async () => {
    const { damage } = knightFixture({
      system: knightSystem({ armure: 30 }),
      weaponRaw: [...STANDARD_RAW, 'destructeur'],
      content: traitSpan('Destructeur', 12),
    });
    expect(damage.damageTraits.destructeur).toEqual({ bool: true, result: 12 });
    // Checked BEFORE calculate: isArmorIgnored() re-reads actorStats, and the
    // bypass holds here anyway (armure is never touched on this path).
    expect(damage.isArmorIgnored()).toBe(true);
    await damage.calculate();
    expect(damage.damageRepartition).toEqual({ armure: 0, sante: 20 });
    expect(damage.actorStats.armure).toBe(30);
    expect(damage.actorStats.armureGuardian).toBe(15);
    expect(damage.actorStats.sante).toBe(0);
    expect(damage.damage).toBe(36);
  });

  it('armure 0 + status folde + Destructeur +12: gate blocks the bonus twice over (effectiveStats.armure 0 AND the trivial 0<=0 bypass) — {armure:0, sante:20}, armureGuardian 15 untouched, stranded 36 (48 unguarded)', async () => {
    const { damage } = zeroArmureFixture({
      system: knightSystem({ armure: 0, cdf: 10, guardianArmure: 15 }),
      statuses: ['folde'],
      weaponRaw: ['penetrant 6', 'destructeur'],
      content: traitSpan('Destructeur', 12),
    });
    expect(damage.damageTraits.destructeur).toEqual({ bool: true, result: 12 });
    await damage.calculate();
    expect(damage.damageRepartition).toEqual({ armure: 0, sante: 20 });
    expect(damage.actorStats.armure).toBe(0);
    expect(damage.actorStats.armureGuardian).toBe(15);
    expect(damage.actorStats.sante).toBe(0);
    expect(damage.damage).toBe(36);
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
    // INTENDED (author): with the armure track
    // skipped, damage beyond sante (56 - 20 = 36) is left on this.damage and
    // silently dropped, and the guardian branch never runs because
    // actorStats.armure is still > 0. This overflow loss is by design — do not "fix".
    expect(damage.damage).toBe(36);
  });

  it('cuirDuTaureau re-engages the armure track despite the bypass', async () => {
    // INTENDED (author): an item counts as ACTIVE
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
    // taureau above — INTENDED (author).
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

describe('instinct-du-loup ignorearmure / ignorecdf flags (damageKnight.js:54-59)', () => {
  // INTENDED (author): the item is ACTIVE when system.active.base is FALSY
  // (same inverted guard as Cuir du taureau). applyInstinctDuLoup() is the
  // first thing calculate() does, so the neutralisation lands before any
  // CdF/armure math. armure 60 is chosen ABOVE perceArmure 40 so the two
  // bypass clauses (flag vs value) are independent and the flag side is the
  // only one the loup can switch off.
  function loupItem(flags) {
    return makeItem('Instinct du loup', {
      system: { active: { base: false } },
      flags: { 'knight-damage': { loup: flags } },
    });
  }

  it("CONTROL — raw 'ignorearmure' vs armure 60 (> perce-armure 40): the flag alone forces the bypass — armure track skipped, {armure:0, sante:20}, armure 60 untouched, sante 0, stranded 36", async () => {
    const { damage } = knightFixture({
      system: knightSystem({ armure: 60 }),
      weaponRaw: [...STANDARD_RAW, 'ignorearmure'],
    });
    expect(damage.ignoreArmure).toBe(true);
    expect(damage.isArmorIgnored()).toBe(true);
    await damage.calculate();
    expect(damage.damageRepartition).toEqual({ armure: 0, sante: 20 });
    expect(damage.actorStats.armure).toBe(60);
    expect(damage.actorStats.sante).toBe(0);
    expect(damage.damage).toBe(36);
  });

  it("flag ignorearmure:'active' + raw 'ignorearmure' vs armure 60: bypass neutralised AND 60 > perce-armure 40 keeps the value clause false — armure track RUNS, absorbs 56 (armure 4), carry trunc(56/5)=11 (sante 9), {armure:56, sante:11}, nothing stranded", async () => {
    const { damage } = knightFixture({
      system: knightSystem({ armure: 60 }),
      weaponRaw: [...STANDARD_RAW, 'ignorearmure'],
      actorItems: [loupItem({ ignorearmure: 'active' })],
    });
    await damage.calculate();
    // The flag was flipped off; perceArmure stays 40 (no 'percearmure' key).
    expect(damage.ignoreArmure).toBe(false);
    expect(damage.perceArmure).toBe(40);
    expect(damage.damageRepartition).toEqual({ armure: 56, sante: 11 });
    expect(damage.actorStats.armure).toBe(4);
    expect(damage.actorStats.sante).toBe(9);
    expect(damage.damage).toBe(0);
    // NB: isArmorIgnored() is re-read live, so after the soak (armure 4) it
    // reads 4 <= 40 = true again; what matters is that the track RAN.
  });

  it("CONTROL — raw 'ignorechampdeforce' vs CdF 10: applyTraitCdf zeroes the CdF WITHOUT the penetrant subtraction — full 60 hits the armor (armure 40), carry trunc(60/5)=12 (sante 8), {armure:60, sante:12}", async () => {
    const { damage } = knightFixture({
      weaponRaw: [...STANDARD_RAW, 'ignorechampdeforce'],
    });
    expect(damage.ignoreCdf).toBe(true);
    await damage.calculate();
    expect(damage.effectiveStats.cdf).toBe(0);
    expect(damage.damageRepartition).toEqual({ armure: 60, sante: 12 });
    expect(damage.actorStats.armure).toBe(40);
    expect(damage.actorStats.sante).toBe(8);
  });

  it("flag ignorecdf:'active' + raw 'ignorechampdeforce': bypass neutralised, so penetrant 6 vs CdF 10 leaves effective CdF 4 that soaks 4 — damage 56 (armure 44), carry trunc(56/5)=11 (sante 9), {armure:56, sante:11}", async () => {
    const { damage } = knightFixture({
      weaponRaw: [...STANDARD_RAW, 'ignorechampdeforce'],
      actorItems: [loupItem({ ignorecdf: 'active' })],
    });
    await damage.calculate();
    expect(damage.ignoreCdf).toBe(false);
    expect(damage.effectiveStats.cdf).toBe(4);
    expect(damage.damageRepartition).toEqual({ armure: 56, sante: 11 });
    expect(damage.actorStats.armure).toBe(44);
    expect(damage.actorStats.sante).toBe(9);
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

describe('meurtrier', () => {
  // Armure 30 / CdF 0 / guardian 0 so 10 damage still remains when the sante
  // stage is reached: applyDamageTrait('meurtrier') (damage > 0 gate) fires and
  // sante 40 is big enough that the +9 lands in the repartition, not under the cap.
  function meurtrierFixture({ weaponRaw }) {
    return knightFixture({
      system: knightSystem({ armure: 30, cdf: 0, guardianArmure: 0, sante: 40 }),
      weaponRaw,
      content: traitSpan('Meurtrier', 9),
      targetValue: 40,
    });
  }

  it("raw 'meurtrier' + content '+9': at the sante stage damage 10 becomes 19, repartition.sante 6+19=25, actorStats.sante 15", async () => {
    const { damage } = meurtrierFixture({ weaponRaw: ['meurtrier'] });
    expect(damage.damageTraits.meurtrier).toEqual({ bool: true, result: 9 });
    await damage.calculate();
    // 40 - CdF 0 -> armure absorbs 30 (10 left) -> guardian 0 -> carry trunc(30/5)=6.
    // meurtrier: 10 + 9 = 19 fully absorbed by the remaining sante (34).
    expect(damage.actorStats.sante).toBe(15);
    expect(damage.damageRepartition).toEqual({ armure: 30, armureGuardian: 0, sante: 25 });
    expect(damage.damage).toBe(0);
  });

  it("negative twin: same fixture WITHOUT 'meurtrier' in raw keeps the sante damage at 10 (repartition.sante 16, sante 24) — the +9 is exactly the 25-16 gap", async () => {
    const { damage } = meurtrierFixture({ weaponRaw: [] });
    expect(damage.damageTraits.meurtrier).toEqual({ bool: false, result: 0 });
    await damage.calculate();
    expect(damage.actorStats.sante).toBe(24);
    expect(damage.damageRepartition).toEqual({ armure: 30, armureGuardian: 0, sante: 16 });
  });
});

describe('infatigable', () => {
  it("item 'Infatigable' type 'avantage': the armure->sante carry is suppressed (armure 100->44, sante stays 20)", async () => {
    const { damage } = knightFixture({
      actorItems: [makeItem('Infatigable', { type: 'avantage' })],
    });
    expect(damage.infatigable).toBeTruthy();
    await damage.calculate();
    // Worked example 56 absorbed by the armor, but calculateArmureVersSante
    // skips adding repartition.armure (infatigable) -> carry 0.
    expect(damage.actorStats.armure).toBe(44);
    expect(damage.actorStats.sante).toBe(20);
    expect(damage.damageRepartition).toEqual({ armure: 56, sante: 0 });
  });

  it("negative twin: 'Infatigable' with type 'duree' (not 'avantage') is not matched — the carry applies (sante -11, sante 9)", async () => {
    const { damage } = knightFixture({
      actorItems: [makeItem('Infatigable', { type: 'duree' })],
    });
    expect(damage.infatigable).toBeFalsy();
    await damage.calculate();
    expect(damage.actorStats.armure).toBe(44);
    expect(damage.actorStats.sante).toBe(9);
    expect(damage.damageRepartition).toEqual({ armure: 56, sante: 11 });
  });
});

describe('Rire du corbeau (energie split via the real DialogV2 ok.callback)', () => {
  // NOTE (source-oracle correction): unlike cuir-du-taureau / instinct-du-loup,
  // the corbeau guard is the plain truthy check `if (corbeau?.system?.active?.base)`
  // (damageKnight.js:109) — the item is ACTIVE when system.active.base is TRUTHY.
  // Pass no valueAsNumber to program the dialog yourself (setDialogPrompt).
  function corbeauFixture({
    activeBase = true,
    valueAsNumber,
    system,
    targetValue = 60,
    weaponRaw = STANDARD_RAW,
  } = {}) {
    if (valueAsNumber !== undefined) setDialogPromptCallback(valueAsNumber);
    return knightFixture({
      system,
      targetValue,
      weaponRaw,
      actorItems: [makeItem('Rire du corbeau', { system: { active: { base: activeBase } } })],
    });
  }

  it('value 0: energie absorbs nothing, the whole 56 continues the normal path (repartition {energie:0, armure:56, sante:11})', async () => {
    const { damage } = corbeauFixture({ valueAsNumber: 0 });
    await damage.calculate();
    expect(damage.damageRepartition).toEqual({ energie: 0, armure: 56, sante: 11 });
    expect(damage.actorStats.energie).toBe(12);
    expect(damage.actorStats.armure).toBe(44);
    expect(damage.actorStats.sante).toBe(9);
    // the corbeau path itself issues NO addReminder query (reminders only come
    // from the energie/espoir target paths) — pin the absence.
    expect(recordedQueries()).toEqual([]);
  });

  // damageKnight.js:282: `if (!Number.isFinite(value)) return 0;` sits BEFORE the
  // `value <= 0` check. Without it, NaN fails all three guards (NaN <= 0 and
  // NaN >= 28 are both false) and returns NaN, which poisons every later number
  // (energie, armure and sante would all end up NaN, repartition too).
  it('valueAsNumber NaN (empty/non-numeric input): the finite guard returns 0 BEFORE the <=0 check — plain worked example continues, energie 12 untouched ({energie:0, armure:56, sante:11})', async () => {
    const { damage } = corbeauFixture({ valueAsNumber: Number.NaN });
    await damage.calculate();
    // The energie key is still PRESENT with 0: damageKnight.js:113 initialises
    // damageRepartition.energie before calculateDamageStat('energie') adds 0.
    expect(damage.damageRepartition).toEqual({ energie: 0, armure: 56, sante: 11 });
    expect(damage.actorStats.energie).toBe(12);
    expect(damage.actorStats.armure).toBe(44);
    expect(damage.actorStats.sante).toBe(9);
    expect(damage.damage).toBe(0);
    expect(recordedQueries()).toEqual([]);
  });

  // askDamageEnergie wraps the WHOLE prompt call in try/catch (damageKnight.js:
  // 272-291), so a rejected prompt leaves the initial `damageEnergie = 0`.
  it('prompt REJECTS (rejectClose semantics, async): try/catch keeps damageEnergie 0 and the plain path continues — one prompt recorded, no retry', async () => {
    setDialogPrompt(async () => {
      throw new Error('prompt rejected');
    });
    const { damage } = corbeauFixture();
    await damage.calculate();
    expect(recordedDialogPrompts()).toHaveLength(1);
    expect(damage.damageRepartition).toEqual({ energie: 0, armure: 56, sante: 11 });
    expect(damage.actorStats.energie).toBe(12);
    expect(damage.actorStats.armure).toBe(44);
    expect(damage.actorStats.sante).toBe(9);
    expect(damage.damage).toBe(0);
  });

  it('prompt throws SYNCHRONOUSLY inside DialogV2.prompt: the same try/catch rescue — plain path, still exactly one prompt recorded', async () => {
    setDialogPrompt(() => {
      throw new Error('prompt threw synchronously');
    });
    const { damage } = corbeauFixture();
    await damage.calculate();
    expect(recordedDialogPrompts()).toHaveLength(1);
    expect(damage.damageRepartition).toEqual({ energie: 0, armure: 56, sante: 11 });
    expect(damage.actorStats.energie).toBe(12);
  });

  // Load-bearing clamp (damageKnight.js:284): energie 40 absorbs the whole
  // requested split, so the only thing stopping the extra units is the clamp.
  // CdF 0 is zeroed by penetrant 6, so the corbeau point sees the FULL damage 20
  // and the half-split bound is trunc(20/2) = 10: requested 15 comes back 10.
  it('clamp is load-bearing: value 15 >= trunc(20/2) is clamped to 10 — {energie:10, armure:10, sante:2} (energie 30, armure 90, sante 18); without the clamp it would be 15/5/1', async () => {
    const { damage } = corbeauFixture({
      system: knightSystem({ cdf: 0, energie: 40 }),
      targetValue: 20,
      valueAsNumber: 15,
    });
    await damage.calculate();
    const [prompt] = recordedDialogPrompts();
    expect(prompt.window.title).toBe('Rire du corbeau');
    expect(prompt.content).toContain('value="10"'); // default input = trunc(20/2)
    expect(damage.damageRepartition).toEqual({ energie: 10, armure: 10, sante: 2 });
    expect(damage.actorStats.energie).toBe(30);
    expect(damage.actorStats.armure).toBe(90);
    expect(damage.actorStats.sante).toBe(18);
    expect(damage.damage).toBe(0);
  });

  it('value 40 with energie 12: the clamp bound is NOT observable in this fixture (energie caps the absorb at 12 whether or not the value is clamped to 28) — {energie:12, armure:44, sante:8}; only the prompt default pins the bound (value="28")', async () => {
    const { damage } = corbeauFixture({ valueAsNumber: 40 });
    await damage.calculate();
    expect(damage.damageRepartition).toEqual({ energie: 12, armure: 44, sante: 8 });
    expect(damage.actorStats.energie).toBe(0);
    expect(damage.actorStats.armure).toBe(56);
    expect(damage.actorStats.sante).toBe(12);
    // the real prompt: default input value and clamp bound are trunc(56/2) = 28
    const [prompt] = recordedDialogPrompts();
    expect(prompt.window.title).toBe('Rire du corbeau');
    expect(prompt.content).toContain('value="28"');
    // The clamp's EFFECT on the numbers is pinned by the "clamp is
    // load-bearing" fixture above (energie 40, so nothing else caps the absorb).
  });

  it('value 10 (mid): exact split — energie takes 10 (energie 2 left), remainder 46 continues armure + carry trunc(46/5)=9 (repartition {energie:10, armure:46, sante:9})', async () => {
    const { damage } = corbeauFixture({ valueAsNumber: 10 });
    await damage.calculate();
    expect(damage.damageRepartition).toEqual({ energie: 10, armure: 46, sante: 9 });
    expect(damage.actorStats.energie).toBe(2);
    expect(damage.actorStats.armure).toBe(54);
    expect(damage.actorStats.sante).toBe(11);
  });

  it('system.active.base FALSY: the guard does NOT fire (plain truthy check, opposite polarity to the Cuir-du-taureau convention) — plain worked example, dialog never opened', async () => {
    const { damage } = corbeauFixture({ activeBase: false, valueAsNumber: 10 });
    await damage.calculate();
    expect(recordedDialogPrompts()).toEqual([]);
    expect(damage.damageRepartition).toEqual({ armure: 56, sante: 11 });
    expect(damage.actorStats.energie).toBe(12);
  });
});

describe('guardian branch gates (damageKnight.js:162-174)', () => {
  // Fixtures use the module-scope zeroArmureFixture (armure 0 => trivial
  // isArmorIgnored bypass, so the armure track stays skipped and damage reaches
  // the guardian gate directly).

  it("status 'folde': guardian gear is NOT soaked (gate short-circuits) — armureGuardian 15 untouched, 56 goes straight to sante and the 36 overflow is silently dropped", async () => {
    // INTENDED (author) consequence: armure 0 <= 0 makes isArmorIgnored()
    // true, so the armure track is skipped and damage beyond sante stays on
    // this.damage and is dropped, exactly like the worn-armor bypass case.
    const { damage } = zeroArmureFixture({
      system: knightSystem({ armure: 0, cdf: 10, guardianArmure: 15 }),
      statuses: ['folde'],
    });
    await damage.calculate();
    expect(damage.actorStats.armureGuardian).toBe(15);
    expect(damage.actorStats.sante).toBe(0);
    expect(damage.damageRepartition).toEqual({ armure: 0, sante: 20 });
    expect(damage.damage).toBe(36);
  });

  it("system.wear 'guardian': guardian soak skipped by the wear gate — same numbers, armureGuardian 15 untouched", async () => {
    const { damage } = zeroArmureFixture({
      system: knightSystem({ armure: 0, cdf: 10, guardianArmure: 15, wear: 'guardian' }),
    });
    await damage.calculate();
    expect(damage.actorStats.armureGuardian).toBe(15);
    expect(damage.actorStats.sante).toBe(0);
    expect(damage.damageRepartition).toEqual({ armure: 0, sante: 20 });
    expect(damage.damage).toBe(36);
  });

  it("status 'apply-guardian-cdf': guardian CdF 10 (> penetrant 6, NOT reduced by it) soaks 10 FIRST, then armureGuardian 15 — carry gains trunc(15/5)=3 (repartition {armure:0, armureGuardian:15, sante:4})", async () => {
    // 30 damage - 4 (CdF 10 - penetrant 6) = 26 -> guardian CdF: 26-10 = 16
    // -> armureGuardian absorbs 15 (1 left) -> carry trunc((0+15)/5) = 3
    // -> sante repartition 3 + the 1 remaining = 4.
    const { damage } = zeroArmureFixture({
      system: knightSystem({ armure: 0, cdf: 10, guardianArmure: 15, guardianCdf: 10 }),
      statuses: ['apply-guardian-cdf'],
      targetValue: 30,
    });
    await damage.calculate();
    expect(damage.effectiveStats.cdfGuardian).toBe(10);
    expect(damage.actorStats.armureGuardian).toBe(0);
    expect(damage.actorStats.sante).toBe(16);
    expect(damage.damageRepartition).toEqual({ armure: 0, armureGuardian: 15, sante: 4 });
    expect(damage.damage).toBe(0);
  });

  it('apply-guardian-cdf zeroing sub-case: penetrant 6 >= cdfGuardian 4 zeroes the 4-unit guardian CdF, so the 4 units it would have soaked pass the (identical) 15-point armureGuardian soak and land in sante — repartition.sante 14 vs the 4 of the un-zeroed twin, sante 6 vs 16', async () => {
    // cdfGuardian 4 <= penetrant 6 -> effectiveStats.cdfGuardian 0 -> damage
    // stays 26 -> armureGuardian 15 absorbs (11 left) -> carry trunc(15/5)=3
    // -> sante repartition 3 + 11 = 14 (vs 3 + 1 = 4 in the cdfGuardian-10 twin
    // above; the 10-unit gap is exactly the 11-1 difference in what reaches
    // sante after the same 15-point armor soak).
    const { damage } = zeroArmureFixture({
      system: knightSystem({ armure: 0, cdf: 10, guardianArmure: 15, guardianCdf: 4 }),
      statuses: ['apply-guardian-cdf'],
      targetValue: 30,
    });
    await damage.calculate();
    expect(damage.effectiveStats.cdfGuardian).toBe(0);
    expect(damage.actorStats.sante).toBe(6);
    expect(damage.damageRepartition).toEqual({ armure: 0, armureGuardian: 15, sante: 14 });
  });

  // Negative control for the STATUS GATE itself (damageKnight.js:168): the same
  // fixture without the status never calls applyGuardianCdf, so the 10-point
  // guardian CdF is neither applied nor zeroed — effectiveStats.cdfGuardian
  // stays 10 but is simply unused.
  it("WITHOUT the 'apply-guardian-cdf' status (same cdfGuardian 10 fixture): no CdF step at all — effectiveStats.cdfGuardian untouched at 10, damage 26 -> armureGuardian absorbs 15 (11 left) -> carry trunc(15/5)=3, repartition {armure:0, armureGuardian:15, sante:14}", async () => {
    const { damage } = zeroArmureFixture({
      system: knightSystem({ armure: 0, cdf: 10, guardianArmure: 15, guardianCdf: 10 }),
      targetValue: 30,
    });
    await damage.calculate();
    expect(damage.effectiveStats.cdfGuardian).toBe(10);
    expect(damage.actorStats.cdfGuardian).toBe(10);
    expect(damage.actorStats.armureGuardian).toBe(0);
    expect(damage.actorStats.sante).toBe(6);
    expect(damage.damageRepartition).toEqual({ armure: 0, armureGuardian: 15, sante: 14 });
    expect(damage.damage).toBe(0);
  });

  it('boundary: damage exactly 0 when it reaches the gate — the strict damage > 0 check skips the guardian entirely (no armureGuardian key in the repartition)', async () => {
    // armure 30 (not 0) so the armure track runs; damage 30 is EXACTLY absorbed
    // (actorStats.armure lands on 0 and this.damage on 0 at the same time).
    const { damage } = zeroArmureFixture({
      system: knightSystem({ armure: 30, cdf: 0, guardianArmure: 15 }),
      targetValue: 30,
    });
    await damage.calculate();
    expect(damage.damage).toBe(0);
    expect(damage.actorStats.armureGuardian).toBe(15);
    // toEqual with no armureGuardian key pins that lines 170-171 never ran.
    expect(damage.damageRepartition).toEqual({ armure: 30, sante: 6 });
    expect(damage.actorStats.sante).toBe(14);
  });
});
