import { describe, it, expect, beforeEach } from 'vitest';
import { getTraitValue, extractTraitValue, hasStatusEffect, generateReminderData } from '../../src/module/helpers.js';
import { makeActor, makeToken, makeMessage } from './support/doubles.mjs';
import { clearUuidRegistry, resetRecorders } from './support/foundry-globals.mjs';

beforeEach(() => {
  resetRecorders();
  clearUuidRegistry();
});

describe('getTraitValue', () => {
  it('extracts the trailing number of a trait string', () => {
    expect(getTraitValue('Perce-armure 40')).toBe(40);
    expect(getTraitValue('Pénétrant 6')).toBe(6);
    expect(getTraitValue('percearmure 120')).toBe(120);
  });

  it('returns NaN when the last token is not a number', () => {
    expect(getTraitValue('antivehicule')).toBeNaN();
  });
});

describe('extractTraitValue', () => {
  it('extracts +N from the French chat HTML for a trait label', () => {
    const message = makeMessage({
      content:
        '<div class="knight-roll"><div>Dégâts</div>' +
        '<div class="trait"><span class="label">Destructeur</span><span class="value">+12</span></div>' +
        '</div>',
    });
    expect(extractTraitValue(message, 'Destructeur')).toBe(12);
  });

  it('tolerates whitespace between the two spans', () => {
    const message = makeMessage({
      content: '<span class="label">Fureur</span>\n  <span class="value">+3</span>',
    });
    expect(extractTraitValue(message, 'Fureur')).toBe(3);
  });

  it('returns undefined when the label is absent from the content', () => {
    const message = makeMessage({ content: '<div>Dégâts</div>' });
    expect(extractTraitValue(message, 'Meurtrier')).toBeUndefined();
  });
});

describe('hasStatusEffect', () => {
  it('is true when a temporary effect carries the status', () => {
    const actor = makeActor('knight', {}, { temporaryEffects: [{ statuses: new Set(['anti-anatheme']) }] });
    expect(hasStatusEffect(actor, 'anti-anatheme')).toBe(true);
    expect(hasStatusEffect(actor, 'folde')).toBe(false);
  });

  it('is false with no temporary effects', () => {
    const actor = makeActor('knight', {});
    expect(hasStatusEffect(actor, 'anti-anatheme')).toBe(false);
  });
});

describe('generateReminderData', () => {
  const VICTIM_UUID = 'Scene.scene-1.Token.token-def.Actor.actor-def';

  it('encodes the actor uuid with dots replaced by underscores', async () => {
    const attacker = makeActor('pnj', {}, { id: 'actor-atk' });
    const origin = makeToken(attacker, { id: 'token-atk' });
    const victim = makeActor('knight', {}, { uuid: VICTIM_UUID });

    const data = await generateReminderData(origin, victim, 12, 'energie');
    // Only dots are replaced: hyphens in the id parts are kept verbatim.
    expect(data).toEqual({ 'Scene_scene-1_Token_token-def_Actor_actor-def': 12 });
  });

  it('accumulates onto an existing flag value', async () => {
    const attacker = makeActor(
      'pnj',
      {},
      { id: 'actor-atk', flags: { 'knight-damage': { espoir: { [VICTIM_UUID.replaceAll('.', '_')]: 5 } } } },
    );
    const origin = makeToken(attacker, { id: 'token-atk' });
    const victim = makeActor('knight', {}, { uuid: VICTIM_UUID });

    const data = await generateReminderData(origin, victim, 12, 'espoir');
    expect(data).toEqual({ 'Scene_scene-1_Token_token-def_Actor_actor-def': 17 });
  });

  it('negates the value when reverting', async () => {
    const key = VICTIM_UUID.replaceAll('.', '_');
    const attacker = makeActor('pnj', {}, { id: 'actor-atk', flags: { 'knight-damage': { energie: { [key]: 5 } } } });
    const origin = makeToken(attacker, { id: 'token-atk' });
    const victim = makeActor('knight', {}, { uuid: VICTIM_UUID });

    const data = await generateReminderData(origin, victim, 12, 'energie', true);
    expect(data).toEqual({ [key]: -7 });
  });

  it('produces a negative value from nothing when reverting an unflagged victim', async () => {
    const attacker = makeActor('pnj', {}, { id: 'actor-atk' });
    const origin = makeToken(attacker, { id: 'token-atk' });
    const victim = makeActor('knight', {}, { uuid: VICTIM_UUID });

    const data = await generateReminderData(origin, victim, 12, 'energie', true);
    expect(data).toEqual({ 'Scene_scene-1_Token_token-def_Actor_actor-def': -12 });
  });
});
