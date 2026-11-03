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
import {
  VICTIM_UUID,
  knightSystem,
  registerAttacker,
  standardKnightMessageFixture,
} from './support/knight-fixtures.mjs';

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

describe('antianatheme injection via the registered preUpdateChatMessage hook (knight-damage.js:83-96)', () => {
  // v14 fix pin: the pre-fix listener read data.flags.knight.actor.statuses.has(...) — but the
  // knight flag's actor entry is a SERIALIZED snapshot and Actor#statuses is a runtime-only
  // derived Set (core client/documents/actor.mjs), so the listener threw (swallowed) and the
  // injection never ran. Statuses in serialized data live at effects[].statuses (plain arrays),
  // and ONLY serialized shapes reach the hook: the runtime-Set lookup is deliberately absent.
  function runHook(data) {
    const hooks = registeredHooks('preUpdateChatMessage');
    expect(hooks).toHaveLength(1);
    // Core dispatches pre-update hooks via Hooks.call (never awaited): a synchronous mutation is
    // load-bearing — a Promise-returning listener would race the already-committed update.
    expect(hooks[0].fn(makeMessage({}), data)).toBeUndefined();
  }

  function updateData({ raw = ['percearmure 40', 'penetrant 6'], actor = { _id: 'actor-atk', effects: [] } } = {}) {
    return { flags: { knight: { weapon: { effets: { raw } }, actor } } };
  }

  it('serialized attacker snapshot carrying the anti-anatheme status effect -> "antianatheme" appended to weapon.effets.raw', () => {
    const data = updateData({ actor: { _id: 'actor-atk', effects: [{ _id: 'eff-x', statuses: ['anti-anatheme'] }] } });
    runHook(data);
    expect(data.flags.knight.weapon.effets.raw).toEqual(['percearmure 40', 'penetrant 6', 'antianatheme']);
  });

  it('already-injected raw stays single-pushed (re-running the hook on the updated data is inert — the includes guard short-circuits before the effects read)', () => {
    const data = updateData({
      raw: ['percearmure 40', 'antianatheme'],
      actor: { effects: [{ statuses: ['anti-anatheme'] }] },
    });
    runHook(data);
    expect(data.flags.knight.weapon.effets.raw).toEqual(['percearmure 40', 'antianatheme']);
  });

  it('inert attacker-snapshot shapes are null-safe (each silently skips, no swallowed TypeError): no actor key, no effects, effect without statuses, unrelated status, and a runtime-style live statuses Set (never reaches a real hook — flag data is always serialized — and deliberately NOT consulted)', () => {
    for (const actor of [
      undefined,
      { _id: 'actor-atk' },
      { _id: 'actor-atk', effects: [{ _id: 'eff-x' }] },
      { _id: 'actor-atk', effects: [{ _id: 'eff-x', statuses: ['peur'] }] },
      { _id: 'actor-atk', statuses: new Set(['anti-anatheme']) },
    ]) {
      const data = updateData({ actor });
      runHook(data);
      expect(data.flags.knight.weapon.effets.raw).toEqual(['percearmure 40', 'penetrant 6']);
    }
  });

  it('update data without weapon.effets.raw (e.g. knight edits unrelated flags) is left untouched, no crash', () => {
    const data = { flags: { knight: { weapon: {}, actor: { effects: [{ statuses: ['anti-anatheme'] }] } } } };
    runHook(data);
    expect(data.flags.knight.weapon.effets).toBeUndefined();
  });

  it("the REAL recorded fixture's attacker snapshot passes the hook INERTLY (effects: [] -> no injection) — CI witness that the shared baseline carries no baked attacker status: a future re-record that bakes one into flags.knight.actor.effects flips THIS pin, not the damage math downstream", () => {
    const data = updateData({ actor: standardKnightMessageFixture().flags.knight.actor });
    runHook(data);
    expect(data.flags.knight.weapon.effets.raw).toEqual(['percearmure 40', 'penetrant 6']);
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

describe('death reminder card via the registered preCreateActiveEffect hook — generateReminderMessage format (knight-damage.js:120-151)', () => {
  // The FLAGLESS death-card format (French header bytes, trunc(value/6) d6-restore lines, the
  // 0-value-key skip, the `_`->`.` uuid round-trip) is pinned ONLY by the e2e reminders suite,
  // which NEVER runs in CI — this pin closes that blind spot against the real registrations,
  // using the stubbed bare-global fromUuid + the ChatMessage.create recorder.
  async function fireDead(effect) {
    const hooks = registeredHooks('preCreateActiveEffect');
    expect(hooks).toHaveLength(1);
    await hooks[0].fn(effect);
    // generateReminderMessage is fired WITHOUT await in the hook's stats loop AND suspends
    // itself at the per-key `await fromUuid`: flush microtasks plus one macrotask so every
    // recorded ChatMessage.create has landed before the assertions.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Spy over the stubbed bare-global fromUuid (the module resolves it dynamically at call
  // time): the recorded lookups pin the SKIP ORDER — a `value==0` continue implemented AFTER
  // fromUuid would push 'Actor.actor-gone' here (mutation-validated: moving the continue past
  // the lookup fails exactly this assertion).
  async function fireDeadSpying(effect, lookups) {
    const realFromUuid = globalThis.fromUuid;
    globalThis.fromUuid = async (uuid) => {
      lookups.push(uuid);
      return realFromUuid(uuid);
    };
    try {
      await fireDead(effect);
    } finally {
      globalThis.fromUuid = realFromUuid;
    }
  }

  it('a `Dead` effect on an actor holding an energie reminder map emits EXACTLY ONE flagless chat card: EXACT header, one line per NONZERO key with trunc/6 d6 and the _->. round-trip NAME, the 0-value key skipped BEFORE any fromUuid lookup (zero lookups of its uuid — spy-pinned), the undefined-flag espoir loop silent', async () => {
    registerUuid(
      'Actor.actor-veh',
      makeActor('vehicule', {}, { id: 'actor-veh', uuid: 'Actor.actor-veh', name: 'veh-name' }),
    );
    registerUuid(
      'Actor.actor-atk',
      makeActor('pnj', {}, { id: 'actor-atk', uuid: 'Actor.actor-atk', name: 'atk-name' }),
    );
    const dying = makeActor(
      'knight',
      {},
      {
        id: 'actor-dying',
        uuid: 'Actor.actor-dying',
        name: 'dying-name',
        flags: {
          'knight-damage': {
            // Keys are uuids with `.`->`_` (ids deliberately `_`-free, like every seed id):
            // round-trip back to the registered 'Actor.actor-veh'/'Actor.actor-atk' uuids. The
            // 0-value key's uuid is deliberately NOT registered either — but the LOOKUP SPY
            // below, not a crash, is what proves the skip happens before any resolution.
            energie: { 'Actor_actor-veh': 5, 'Actor_actor-atk': 13, 'Actor_actor-gone': 0 },
          },
        },
      },
    );

    const lookups = [];
    await fireDeadSpying({ name: 'Dead', target: dying }, lookups);

    const messages = recordedMessages();
    expect(messages).toHaveLength(1); // espoir flag undefined -> that loop iteration emits nothing
    // Death cards are FLAGLESS (no flags in the create data) — why the e2e leak scan must
    // marker-scan them instead of filtering on isRecap.
    expect(messages[0].flags).toBeUndefined();
    expect(messages[0].content).toBe(
      "<div>Dégâts d'energie infligés :</div><div>veh-name : 5 (0d6)</div><div>atk-name : 13 (2d6)</div>",
    );
    // The 0-value key resolves NEVER: skipping precedes fromUuid (knight-damage.js:138-139).
    expect(lookups).toEqual(['Actor.actor-veh', 'Actor.actor-atk']);
  });

  it("a NOT-Dead effect name on an actor FULLY LOADED with a reminder map emits NOTHING (the name gate is the hook's ONLY gate — a loaded actor makes that pin load-bearing, mutation-validated), and a Dead effect on an actor WITHOUT reminder flags emits NOTHING too (the undefined-flag guard; if that guard were dropped the resulting TypeError lands in the UNAWAITED loop call as an unhandled rejection — vitest fails the run via its error reporter, not via this assertion)", async () => {
    registerUuid(
      'Actor.actor-atk',
      makeActor('pnj', {}, { id: 'actor-atk', uuid: 'Actor.actor-atk', name: 'atk-name' }),
    );
    const flagged = makeActor(
      'knight',
      {},
      {
        id: 'actor-flagged',
        uuid: 'Actor.actor-flagged',
        name: 'flagged',
        flags: { 'knight-damage': { energie: { 'Actor_actor-atk': 7 } } },
      },
    );
    const plain = makeActor('knight', {}, { id: 'actor-plain', uuid: 'Actor.actor-plain', name: 'plain' });
    await fireDead({ name: 'Pas Dead', target: flagged });
    await fireDead({ name: 'Dead', target: plain });
    expect(recordedMessages()).toEqual([]);
  });
});

describe('renderModuleSheet loup injection via the registered hook (knight-damage.js:153-220)', () => {
  // The hook fires for the KNIGHT system's item type 'module' (NOT a Foundry module): the sheet's
  // object is a knight module-item. The e2e Phase-6 case D pins this live; these pins lock the
  // two-pass contract the live sheet depends on: FIRST pass creates the 8-key all-'unactive' map
  // and RETURNS (no DOM touched at all), a LATER pass prepends the 8 buttons whose classes mirror
  // the stored flag values and binds one click handler per key that writes the flag value as the
  // button className LITERALLY (no normalization).
  const LOUP_KEYS = [
    'choc',
    'degatscontinus',
    'percearmure',
    'peur',
    'ignorearmure',
    'ignorecdf',
    'drainenergie',
    'domination',
  ];

  function runLoupHook(sheet, html) {
    const hooks = registeredHooks('renderModuleSheet');
    expect(hooks).toHaveLength(1);
    return hooks[0].fn(sheet, html);
  }

  function makeLoupSheet({ name = 'Instinct du loup', loupFlag } = {}) {
    const setCalls = [];
    const object = {
      name,
      system: { active: { base: false } },
      flags: loupFlag === undefined ? {} : { 'knight-damage': { loup: structuredClone(loupFlag) } },
      setFlag(scope, key, value) {
        setCalls.push({ scope, key, value: JSON.parse(JSON.stringify(value)) });
        object.flags[scope] ??= {};
        object.flags[scope][key] = value;
        return Promise.resolve();
      },
      getFlag(scope, key) {
        return object.flags[scope]?.[key];
      },
    };
    return { object, setCalls };
  }

  // Fake DOM button for the captured click handlers: className is the LIVE class-token string the
  // handler reads AFTER its two classList.toggle calls.
  function makeButton(className) {
    const tokens = new Set(className.split(' ').filter(Boolean));
    return {
      classList: { toggle: (t) => (tokens.has(t) ? tokens.delete(t) : tokens.add(t)) },
      get className() {
        return Array.from(tokens).join(' ');
      },
    };
  }

  it('a non-"Instinct du loup" module sheet is skipped whole: no flag write, no DOM call at all', async () => {
    const sheet = makeLoupSheet({ name: 'Rire du corbeau' });
    const html = makeHtmlRecorder();
    await runLoupHook(sheet, html);
    expect(sheet.setCalls).toEqual([]);
    expect(html.calls).toEqual([]);
  });

  it('FIRST pass (no loup flag yet) writes EXACTLY the 8-key all-"unactive" map and RETURNS before touching the DOM (no prepend, no bindings — the buttons only exist from the NEXT render pass)', async () => {
    const sheet = makeLoupSheet();
    const html = makeHtmlRecorder();
    await runLoupHook(sheet, html);
    expect(sheet.setCalls).toHaveLength(1);
    expect(sheet.setCalls[0]).toEqual({
      scope: 'knight-damage',
      key: 'loup',
      value: Object.fromEntries(LOUP_KEYS.map((k) => [k, 'unactive'])),
    });
    expect(html.calls).toEqual([]);
  });

  it('SECOND pass prepends the 8-button block into .niveau_n1 with the classes MIRRORED from the stored map (one "active" outlier rides through byte-exact) and binds exactly one click handler per key', async () => {
    const stored = Object.fromEntries(LOUP_KEYS.map((k) => [k, 'unactive']));
    stored.percearmure = 'active';
    const sheet = makeLoupSheet({ loupFlag: stored });
    const html = makeHtmlRecorder();
    await runLoupHook(sheet, html);

    const prepends = html.calls.filter((c) => c.action === 'prepend');
    expect(prepends).toHaveLength(1);
    expect(prepends[0].selector).toBe('.niveau_n1');
    for (const key of LOUP_KEYS) {
      expect(prepends[0].content).toContain(`data-option="${key}" class="${stored[key]}"`);
    }
    // No flag re-creation when the map already exists.
    expect(sheet.setCalls).toEqual([]);

    for (const key of LOUP_KEYS) {
      const bindings = html.onBindings(`[data-option=${key}]`);
      expect(bindings).toHaveLength(1);
      expect(bindings[0].event).toBe('click');
      expect(bindings[0].data).toEqual({ module: sheet.object });
    }
    expect(html.calls.filter((c) => c.action === 'on')).toHaveLength(LOUP_KEYS.length);
  });

  it('the click handler rewrites flag[key] to the className LITERALLY (unnormalized): toggling "unactive" off and "active" on lands "active"; a foreign class token lands verbatim and the 7 sibling keys keep their stored bytes', async () => {
    const stored = Object.fromEntries(LOUP_KEYS.map((k) => [k, 'unactive']));
    const sheet = makeLoupSheet({ loupFlag: stored });
    const html = makeHtmlRecorder();
    await runLoupHook(sheet, html);

    const normal = html.onBindings('[data-option=percearmure]')[0];
    normal.handler({ currentTarget: makeButton('unactive'), data: normal.data });
    expect(sheet.object.getFlag('knight-damage', 'loup')).toEqual({
      ...Object.fromEntries(LOUP_KEYS.map((k) => [k, 'unactive'])),
      percearmure: 'active',
    });

    const foreign = html.onBindings('[data-option=peur]')[0];
    foreign.handler({ currentTarget: makeButton('choisi actif'), data: foreign.data });
    const map = sheet.object.getFlag('knight-damage', 'loup');
    // The handler toggles ONLY its two known tokens (both absent here -> ADDED) and copies the
    // resulting class string VERBATIM — the flag byte is the full resulting className.
    expect(map.peur).toBe('choisi actif unactive active');
    expect(map.percearmure).toBe('active');
    expect(map.choc).toBe('unactive');
  });
});
