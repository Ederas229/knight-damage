// Entrypoint-layer pins (src/module/knight-damage.js).
// Feasibility adjudication (review-5 follow-up): importing the entrypoint under
// the unit stubs executes ONLY its five top-level Hooks.once/Hooks.on calls —
// the first test below pins exactly that, and the foundry-globals Hooks stub
// records handlers without ever invoking them (the init callback body, which
// would need CONFIG, stays unrun). Everything else in the file is function
// declarations. So createDamageObject and the revert-click handler ARE
// honestly unit-reachable: the click handler is captured from the REAL
// renderChatMessageHTML registration through the recorder's .on(), and the
// only stub divergences are the $ identity pass-through and the bare-global
// fromUuid twin — both documented in foundry-globals.mjs.
import { describe, it, expect, beforeEach } from 'vitest';
import { createDamageObject } from '../../src/module/knight-damage.js';
import { DamageKnight } from '../../src/module/damageKnight.js';
import { DamageVehicule } from '../../src/module/damageVehicule.js';
import { DamageMecha } from '../../src/module/damageMecha.js';
import { makeActor, makeKnightMessage, makeMessage, makeToken, makeHtmlRecorder } from './support/doubles.mjs';
import {
  clearUuidRegistry,
  resetRecorders,
  registerUuid,
  recordedQueries,
  recordedMessages,
  registeredHooks,
} from './support/foundry-globals.mjs';
import { VICTIM_UUID, knightSystem, registerAttacker } from './support/knight-fixtures.mjs';

const TOKEN_UUID = 'Scene.scene-1.Token.token-def';
const VEHICULE_UUID = 'Scene.scene-1.Token.token-def.Actor.actor-veh';

beforeEach(() => {
  resetRecorders();
  clearUuidRegistry();
});

describe('entrypoint import surface', () => {
  // The import of knight-damage.js is side-effect-bounded: exactly the five
  // hook registrations (the commented preCreateActor/renderActorSheet block
  // compiles to nothing). If a future top-level statement executes, this list
  // changes and the unit import stops being safe.
  it('importing the entrypoint registers exactly the five Hooks registrations and nothing else executes (init callback body stays unrun — CONFIG is never touched)', () => {
    expect(registeredHooks().map((r) => [r.hook, r.once])).toEqual([
      ['init', true],
      ['preUpdateChatMessage', false],
      ['renderChatMessageHTML', false],
      ['preCreateActiveEffect', false],
      ['renderModuleSheet', false],
    ]);
  });
});

describe('createDamageObject dispatch (knight-damage.js:336-352: pure type switch, no side effects)', () => {
  function victimToken(type, system) {
    const actor = makeActor(type, system, { id: 'actor-def', uuid: VICTIM_UUID });
    return makeToken(actor, { id: 'token-def' });
  }

  function attackMessage() {
    return makeKnightMessage({
      weaponRaw: ['percearmure 40', 'penetrant 6'],
      targets: [{ id: 'token-def', value: 60 }],
    });
  }

  it("'knight' -> DamageKnight (3-arg call form from handleClickRevertDamage: mult defaults to 1, damage = ceil(60*1) = 60)", () => {
    registerAttacker();
    const damage = createDamageObject('knight', victimToken('knight', knightSystem()), attackMessage());
    expect(damage).toBeInstanceOf(DamageKnight);
    expect(damage.damage).toBe(60);
  });

  it("'vehicule' -> DamageVehicule and 'mechaarmure' -> DamageMecha (5-arg call form from handleClickApplyDamage)", () => {
    registerAttacker();
    const vehicule = createDamageObject(
      'vehicule',
      victimToken('vehicule', { armure: { value: 30 }, champDeForce: { value: 3 }, energie: { value: 12 } }),
      attackMessage(),
      1,
      false,
    );
    expect(vehicule).toBeInstanceOf(DamageVehicule);
    expect(vehicule.damage).toBe(60);

    const mecha = createDamageObject(
      'mechaarmure',
      victimToken('mechaarmure', {
        blindage: { value: 30 },
        champDeForce: { value: 0 },
        energie: { value: 10 },
        resilience: { value: 1 },
      }),
      attackMessage(),
      1,
      false,
    );
    expect(mecha).toBeInstanceOf(DamageMecha);
    expect(mecha.damage).toBe(60);
  });

  it("'pnj' and 'bande' -> false: the commented-out DamageNpc/DamageBande dispatches stay dead code, no object is constructed for them", () => {
    registerAttacker();
    expect(createDamageObject('pnj', victimToken('pnj', {}), attackMessage(), 1, false)).toBe(false);
    expect(createDamageObject('bande', victimToken('bande', {}), attackMessage())).toBe(false);
  });
});

describe('handleClickRevertDamage via the registered renderChatMessageHTML hook — G4 pin (knight-damage.js:298)', () => {
  // Production-faithful fixture: run the REAL vehicule pipeline (calculate +
  // generateRecapMessage on a 130-damage hit: /10 -> 13, -3 CdF -> 10 absorbed
  // by the 30 armure -> stored recap {armure: 10, passenger: 2}), then hand
  // back the recap message exactly as ChatMessage.create received it plus the
  // already-damaged victim (armure 20) whose token the revert click resolves.
  function vehiculePipelineRecap() {
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
    const [armureRecap] = recordedMessages();

    const recapMessage = makeMessage({
      content: armureRecap.content,
      flags: armureRecap.flags,
      speaker: { scene: 'scene-1', token: 'token-def' },
    });
    const damagedActor = makeActor(
      'vehicule',
      { armure: { value: 20 }, champDeForce: { value: 3 }, energie: { value: 12 } },
      { id: 'actor-veh', uuid: VEHICULE_UUID },
    );
    return { recapMessage, damagedActor, revertToken: makeToken(damagedActor, { id: 'token-def' }) };
  }

  // Drives the REAL registration: the hook handler (message, html) binds the
  // click through addRevertDamageEvent (knight-damage.js:290-292), and the
  // recorder hands back the bound { data, handler }. The recap content carries
  // no Dégâts/Débordement marker, so addApplyDamageButton early-returns and
  // .revert-damage carries exactly one click binding.
  async function bindRevertClick(recapMessage) {
    const renderHooks = registeredHooks('renderChatMessageHTML');
    expect(renderHooks).toHaveLength(1);
    const html = makeHtmlRecorder();
    await renderHooks[0].fn(recapMessage, html);
    const bindings = html.onBindings('.revert-damage');
    expect(bindings).toHaveLength(1);
    expect(bindings[0].event).toBe('click');
    // jQuery re-injects the bind-time data as event.data — pin the wiring.
    expect(bindings[0].data.message).toBe(recapMessage);
    expect(bindings[0].data.html).toBe(html); // $ identity keeps the same recorder
    return { html, binding: bindings[0] };
  }

  it('G4: the speaker token no longer resolves (deleted between roll and revert) — the real click handler returns silently: zero html markers, no message.update, no actor update, no query (pre-5fbba11 it crashed on token.actor of null inside the jQuery handler)', async () => {
    const { recapMessage, damagedActor } = vehiculePipelineRecap();
    // TOKEN_UUID deliberately left OUT of the registry: the stubbed global
    // fromUuid resolves it to null, like a deleted scene token.
    const { html, binding } = await bindRevertClick(recapMessage);

    const callsBeforeClick = html.calls.length;
    await expect(binding.handler({ data: binding.data })).resolves.toBeUndefined();

    // The guard returned before revertDamage ran: not ONE extra html call
    // (no .recap line-through, no .revert-damage remove, no content read)...
    expect(html.calls).toHaveLength(callsBeforeClick);
    // ...no content rewrite on the message...
    expect(recapMessage.updates).toEqual([]);
    // ...nothing reinvested on the still-existing victim document...
    expect(damagedActor.updates).toEqual([]);
    // ...and no energie reminder query (recap has no energie key, but pin the
    // whole recorder empty anyway: the handler never got that far).
    expect(recordedQueries()).toEqual([]);
  });

  it('twin: the SAME recap whose token DOES resolve — the same handler proceeds end-to-end: vehicule armure restored 20+10=30 (INTENDED double update), the content rewritten from .message-content by value, all three html markers applied — proving the G4 guard above is load-bearing, not an always-silent handler', async () => {
    const { recapMessage, damagedActor, revertToken } = vehiculePipelineRecap();
    registerUuid(TOKEN_UUID, revertToken);
    const { html, binding } = await bindRevertClick(recapMessage);

    await binding.handler({ data: binding.data });

    expect(html.calls).toContainEqual({
      selector: '.recap',
      action: 'css',
      property: 'text-decoration',
      value: 'line-through',
    });
    expect(html.calls).toContainEqual({ selector: '.revert-damage', action: 'remove' });
    expect(html.calls).toContainEqual({ selector: '.message-content', action: 'html' });
    expect(recapMessage.updates).toEqual([
      { content: '<div class="message-content">CANNED HTML FOR .message-content</div>' },
    ]);
    // DamageVehicule inherits the synchronous DamageBase revert (already
    // pinned in damage-revert.test.mjs): restored 30 written twice, no
    // passenger key in the payload map.
    expect(damagedActor.updates).toEqual([{ 'system.armure.value': 30 }, { 'system.armure.value': 30 }]);
    // No energie in the recap -> revertEnergieReminder early-returns.
    expect(recordedQueries()).toEqual([]);
  });
});
