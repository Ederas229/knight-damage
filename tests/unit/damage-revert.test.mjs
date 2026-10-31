// revertDamage coverage: DamageBase.revertDamage (fully synchronous) and
// DamageKnight.revertDamage (defers setActorStats to setTimeout(100) and
// apply to setTimeout(101), so it is exercised under vi.useFakeTimers).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DamageBase } from '../../src/module/damageBase.js';
import { DamageKnight } from '../../src/module/damageKnight.js';
import { DamageVehicule } from '../../src/module/damageVehicule.js';
import { makeActor, makeKnightMessage, makeMessage, makeToken, makeHtmlRecorder } from './support/doubles.mjs';
import { clearUuidRegistry, resetRecorders, recordedQueries, recordedMessages } from './support/foundry-globals.mjs';
import { ATTACKER_UUID, VICTIM_UUID, knightSystem, registerAttacker } from './support/knight-fixtures.mjs';

const VEHICULE_UUID = 'Scene.scene-1.Token.token-def.Actor.actor-veh';
// Distinct canned html() per selector: the string below is only reachable
// through html.find('.message-content').html(), so the message.update content
// assertion proves the provenance by value. The two decoys are what the source
// would have written if it ever read the content from another selector.
const REVERTED_CONTENT = '<div class="message-content">contenu relu sur .message-content</div>';
const CANNED_HTML = {
  '.recap': '<div class="recap">DECOY contenu lu sur .recap</div>',
  '.revert-damage': '<button class="revert-damage">DECOY contenu lu sur .revert-damage</button>',
  '.message-content': REVERTED_CONTENT,
};

function makeRevertHtmlRecorder() {
  return makeHtmlRecorder({ html: CANNED_HTML });
}

// A recap message double carrying the flags revertDamage reads. isRecap: true
// mirrors what generateRecapMessage writes (damageBase.js:337) — production
// fidelity: the constructor then short-circuits the trait/perce parsing (the
// revert path reads none of it, so every number below is unchanged).
function makeRecapMessage({ recap, wear = 'normal', anatheme = false }) {
  const message = makeKnightMessage({
    weaponRaw: ['percearmure 40', 'penetrant 6'],
    targets: [{ id: 'token-def', value: 60 }],
  });
  message.flags['knight-damage'] = { recap, isRecap: true, origin: ATTACKER_UUID, wear, anatheme };
  return message;
}

beforeEach(() => {
  resetRecorders();
  clearUuidRegistry();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DamageBase.revertDamage — synchronous, no timers', () => {
  function baseRevertFixture({ recap, actorStats }) {
    registerAttacker();
    const actor = makeActor('knight', {}, { id: 'actor-def', uuid: VICTIM_UUID });
    const token = makeToken(actor, { id: 'token-def' });
    const message = makeRecapMessage({ recap });
    const damage = new DamageBase(token, message, 1, false);
    // Victim already damaged: this is the post-calculate() state of the
    // standard worked example (armure 100-56=44, sante 20-11=9).
    damage.actorStats = actorStats;
    return { damage, actor, message, html: makeRevertHtmlRecorder() };
  }

  it('the recap double carries isRecap:true like the real recap, so the constructor short-circuits trait/perce parsing (weapon raw percearmure 40 / penetrant 6 stays unparsed, all damage traits off)', () => {
    // No attacker registered on purpose: if setBooleanTraits ran, its
    // anti-anatheme fallback would resolve fromUuidSync('Actor.actor-atk') to
    // undefined and hasStatusEffect(undefined, ...) would throw.
    const token = makeToken(makeActor('knight', {}, { id: 'actor-def', uuid: VICTIM_UUID }), { id: 'token-def' });
    const message = makeRecapMessage({ recap: { armure: 56, sante: 11 } });
    const damage = new DamageBase(token, message, 1, false);

    expect(message.flags['knight-damage'].isRecap).toBe(true);
    // the knight target entry is still parsed (the damage extraction has no
    // isRecap short-circuit):
    expect(damage.damage).toBe(60);
    expect(damage.perceArmure).toBe(0);
    expect(damage.penetrant).toBe(0);
    expect(damage.ignoreArmure).toBe(false);
    expect(damage.ignoreCdf).toBe(false);
    expect(damage.damageTraits).toEqual({
      destructeur: { bool: false, result: 0 },
      meurtrier: { bool: false, result: 0 },
      ultraviolence: { bool: false, result: 0 },
      fureur: { bool: false, result: 0 },
    });
  });

  it('applies the recap back onto actorStats (44+56=100, 9+11=20), stamps the html markers, rewrites the message content with the value canned for the .message-content selector only, and writes the restored values through the double apply()', () => {
    const { damage, actor, message, html } = baseRevertFixture({
      recap: { armure: 56, sante: 11 },
      actorStats: { armure: 44, sante: 9 },
    });

    damage.revertDamage(message, html);

    // html recorder: exact selectors and chaining used by the source.
    expect(html.selectorsUsed()).toEqual(['.recap', '.revert-damage', '.message-content']);
    expect(html.calls).toContainEqual({
      selector: '.recap',
      action: 'css',
      property: 'text-decoration',
      value: 'line-through',
    });
    expect(html.calls).toContainEqual({ selector: '.revert-damage', action: 'remove' });
    expect(html.calls).toContainEqual({ selector: '.message-content', action: 'html' });

    // message.update recorder got the html() string of .message-content — and
    // NOT the decoy returned by any other selector.
    expect(message.updates).toEqual([{ content: REVERTED_CONTENT }]);
    expect(message.updates[0].content).not.toContain('DECOY');

    // recap becomes the repartition and the reverted stats are written per
    // apply()'s mapping. INTENDED (author): apply() always double-updates
    // (energie falsy leaves the second payload equal to the first).
    expect(damage.damageRepartition).toEqual({ armure: 56, sante: 11 });
    expect(actor.updates).toEqual([
      { 'system.armure.value': 100, 'system.sante.value': 20 },
      { 'system.armure.value': 100, 'system.sante.value': 20 },
    ]);

    // no energie in the recap -> revertEnergieReminder returns early, no query
    expect(recordedQueries()).toEqual([]);
  });

  it('a recap carrying energie fires the un-awaited addReminder query with revert:true and energie is written in the second update', async () => {
    const { damage, actor, message, html } = baseRevertFixture({
      recap: { armure: 56, sante: 11, energie: 4 },
      actorStats: { armure: 44, sante: 9, energie: 8 },
    });

    damage.revertDamage(message, html);

    // revertEnergieReminder is called without await; let its async remainder drain.
    const queries = await vi.waitFor(() => {
      const q = recordedQueries();
      if (q.length < 1) throw new Error('no query recorded yet');
      return q;
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].queryName).toBe('knight-damage.addReminder');
    expect(queries[0].data).toEqual({
      uuidOrigin: ATTACKER_UUID,
      uuidActor: VICTIM_UUID,
      value: 4,
      stat: 'energie',
      revert: true,
    });

    // energie 8+4=12 restored and written in the second update call.
    expect(actor.updates).toEqual([
      { 'system.armure.value': 100, 'system.sante.value': 20 },
      { 'system.energie.value': 12 },
    ]);
  });
});

describe('DamageKnight.revertDamage — setActorStats at setTimeout(100), apply at setTimeout(101)', () => {
  it('under fake timers: reloads stats from the DAMAGED system, adds the recap back (armure 44+56=100, sante 9+11=20, espoir 15+3=18), applies after the timers, and sends the espoir reminder with revert:true', async () => {
    vi.useFakeTimers();
    registerAttacker();
    const actor = makeActor('knight', knightSystem({ armure: 44, sante: 9 }), {
      id: 'actor-def',
      uuid: VICTIM_UUID,
      name: 'Victime',
    });
    const token = makeToken(actor, { id: 'token-def' });
    // wear flag 'normal' equals the actor's wear, so neither switchArmure
    // branch is entered — the DOM-driven switchArmure() path deliberately
    // stays out of unit scope.
    const message = makeRecapMessage({ recap: { armure: 56, sante: 11, espoir: 3 } });
    const damage = new DamageKnight(token, message, 1, false);
    const html = makeRevertHtmlRecorder();

    const reverted = damage.revertDamage(message, html);

    // apply() is only scheduled at this point (setTimeout 101): no actor update yet.
    expect(actor.updates).toEqual([]);

    vi.advanceTimersByTime(200);
    await reverted;

    expect(html.selectorsUsed()).toEqual(['.recap', '.revert-damage', '.message-content']);
    expect(message.updates).toEqual([{ content: REVERTED_CONTENT }]);

    // setActorStats (t=100) reloads the damaged system values (44/9/15) BEFORE
    // adding the recap back (100/20/18), and apply (t=101) uses those values —
    // the 100/101 ordering is what makes the write correct.
    expect(actor.updates).toEqual([
      { 'system.armure.value': 100, 'system.sante.value': 20, 'system.espoir.value': 18 },
      { 'system.armure.value': 100, 'system.sante.value': 20, 'system.espoir.value': 18 },
    ]);

    // espoir reminder with revert:true; no energie entry in the recap so the
    // revertEnergieReminder query is skipped.
    const queries = recordedQueries();
    expect(queries).toHaveLength(1);
    expect(queries[0].queryName).toBe('knight-damage.addReminder');
    expect(queries[0].data).toEqual({
      uuidOrigin: ATTACKER_UUID,
      uuidActor: VICTIM_UUID,
      value: 3,
      stat: 'espoir',
      revert: true,
    });

    // actorStats.armure restored to 100 -> the knight apply() folde/guardian
    // auto-switch (armure == 0) does not fire.
    expect(damage.actorStats).toEqual({
      armure: 100,
      cdf: 10,
      egide: 0,
      armureGuardian: 15,
      cdfGuardian: 5,
      sante: 20,
      espoir: 18,
      energie: 12,
    });
  });
});

describe('DamageVehicule inherits DamageBase.revertDamage — the vehicule armure recap IS revertible', () => {
  // REACHABLE in production: unlike the flagless passenger/pilote side messages
  // (INTENDED author consequence pinned in recap-message.test.mjs), the vehicule
  // armure recap comes from DamageVehicule.generateRecapMessage -> the base
  // template, so it carries BOTH the .revert-damage button and the
  // flags['knight-damage'] = {recap, isRecap, origin} the revert click needs
  // (addRevertDamageEvent binds every .revert-damage, knight-damage.js:290-292;
  // handleClickRevertDamage then rebuilds the damage object by ACTOR type,
  // knight-damage.js:300 -> DamageVehicule, which inherits the base revert).
  // The fixture therefore runs the REAL pipeline first (calculate +
  // generateRecapMessage on a 130-damage hit: /10 colosse -> 13 - 3 CdF = 10
  // absorbed by the 30 armure -> stored repartition {armure: 10, passenger: trunc(10/5)=2})
  // and reverts that exact recap message against the already-damaged actor.
  function vehiculeRevertFixture() {
    registerAttacker();
    const healthyActor = makeActor(
      'vehicule',
      { armure: { value: 30 }, champDeForce: { value: 3 }, energie: { value: 12 } },
      { id: 'actor-veh', uuid: VEHICULE_UUID },
    );
    const attack = new DamageVehicule(
      makeToken(healthyActor, { id: 'token-def' }),
      makeKnightMessage({ targets: [{ id: 'token-def', value: 130 }] }),
      1,
      false,
    );
    attack.calculate();
    attack.generateRecapMessage();
    const [armureRecapData] = recordedMessages(); // [0] is the armure recap; the passenger message is the flagless second one

    // The recap message exactly as ChatMessage.create received it: knight-damage
    // flags ONLY (no flags.knight), which the base constructor tolerates
    // (message.flags?.knight?.targets?.find short-circuits, damage stays 0).
    const recapMessage = makeMessage({
      content: armureRecapData.content,
      flags: armureRecapData.flags,
      speaker: { scene: 'scene-1', token: 'token-def' },
    });

    // Already-damaged victim (armure 30-10=20): the state of the document when
    // the GM clicks revert.
    const actor = makeActor(
      'vehicule',
      { armure: { value: 20 }, champDeForce: { value: 3 }, energie: { value: 12 } },
      { id: 'actor-veh', uuid: VEHICULE_UUID },
    );
    const damage = new DamageVehicule(makeToken(actor, { id: 'token-def' }), recapMessage, 1, false);
    return { damage, actor, message: recapMessage, armureRecapData, html: makeRevertHtmlRecorder() };
  }

  it('reverts the real apply()-stored recap {armure: 10, passenger: 2}: armure 20+10=30 written (twice, INTENDED double update), the payload has NO passenger key — CHARACTERIZATION: the revert loop leaves actorStats.passenger = undefined + 2 = NaN, confined to memory and never written to the actor', () => {
    const { damage, actor, message, armureRecapData, html } = vehiculeRevertFixture();

    // Reachability pins: the armure recap carries the revert affordance + flags.
    expect(armureRecapData.content).toContain('revert-damage');
    expect(armureRecapData.flags['knight-damage'].recap).toEqual({ armure: 10, passenger: 2 });
    // No flags.knight targets and no Débordement marker in the recap content:
    // the constructor extracts no damage at all.
    expect(damage.damage).toBe(0);
    // DamageVehicule does NOT override revertDamage: the method the instance
    // resolves IS DamageBase.prototype.revertDamage (the synchronous base path).
    expect(DamageVehicule.prototype.revertDamage).toBe(DamageBase.prototype.revertDamage);

    damage.revertDamage(message, html);

    // Same synchronous markers as the knight/base revert: line-through, button
    // removed, content rewritten from .message-content by value.
    expect(html.selectorsUsed()).toEqual(['.recap', '.revert-damage', '.message-content']);
    expect(message.updates).toEqual([{ content: REVERTED_CONTENT }]);

    // apply()'s update mapping (damageBase.js:271-303) has keys armure/blindage/
    // armureGuardian/sante/cohesion/espoir — but NONE for 'passenger', so the
    // first payload carries only the restored armure; the second call repeats it
    // (INTENDED author double-update, no energie in this recap).
    expect(actor.updates).toEqual([{ 'system.armure.value': 30 }, { 'system.armure.value': 30 }]);

    // CHARACTERIZATION (same convention as the vehicule passenger-NaN pin in
    // damage-vehicule-mecha.test.mjs): the revert loop `actorStats[key] += value`
    // iterates the recap INCLUDING 'passenger', and DamageVehicule.setActorStats
    // never defines it — undefined + 2 = NaN. The actor.updates assertions above
    // pin that the NaN is confined to actorStats: it never reaches the document.
    expect(Number.isNaN(damage.actorStats.passenger)).toBe(true);
    expect(damage.actorStats).toEqual({ armure: 30, cdf: 3, energie: 12, passenger: NaN });

    // No energie entry in the recap -> revertEnergieReminder early-returns.
    expect(recordedQueries()).toEqual([]);
  });
});
