// revertDamage coverage: DamageBase.revertDamage (fully synchronous) and
// DamageKnight.revertDamage (defers setActorStats to setTimeout(100) and
// apply to setTimeout(101), so it is exercised under vi.useFakeTimers).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DamageBase } from '../../src/module/damageBase.js';
import { DamageKnight } from '../../src/module/damageKnight.js';
import { makeActor, makeKnightMessage, makeToken, makeHtmlRecorder } from './support/doubles.mjs';
import { registerUuid, clearUuidRegistry, resetRecorders, recordedQueries } from './support/foundry-globals.mjs';

const ATTACKER_UUID = 'Scene.scene-1.Token.token-atk';
const VICTIM_UUID = 'Scene.scene-1.Token.token-def.Actor.actor-def';
const REVERTED_CONTENT = '<div class="message-content">contenu reverti</div>';

function registerAttacker() {
  registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
  registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
}

// Same standard knight fixture as damage-knight.test.mjs.
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

// A recap message double carrying the flags revertDamage reads.
function makeRecapMessage({ recap, wear = 'normal', anatheme = false }) {
  const message = makeKnightMessage({
    weaponRaw: ['percearmure 40', 'penetrant 6'],
    targets: [{ id: 'token-def', value: 60 }],
  });
  message.flags['knight-damage'] = { recap, origin: ATTACKER_UUID, wear, anatheme };
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
    return { damage, actor, message, html: makeHtmlRecorder({ messageContent: REVERTED_CONTENT }) };
  }

  it('applies the recap back onto actorStats (44+56=100, 9+11=20), stamps the html markers, rewrites the message content, and writes the restored values through the double apply()', () => {
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

    // message.update recorder got the html() string.
    expect(message.updates).toEqual([{ content: REVERTED_CONTENT }]);

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
    const html = makeHtmlRecorder({ messageContent: REVERTED_CONTENT });

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
