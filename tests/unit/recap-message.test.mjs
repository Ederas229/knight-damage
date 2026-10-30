import { describe, it, expect, beforeEach } from 'vitest';
import { DamageBase } from '../../src/module/damageBase.js';
import { DamageKnight } from '../../src/module/damageKnight.js';
import { DamageVehicule } from '../../src/module/damageVehicule.js';
import { DamageMecha } from '../../src/module/damageMecha.js';
import { makeActor, makeKnightMessage, makeToken } from './support/doubles.mjs';
import { registerUuid, clearUuidRegistry, resetRecorders, recordedMessages } from './support/foundry-globals.mjs';

const ATTACKER_UUID = 'Scene.scene-1.Token.token-atk';

function registerAttacker() {
  registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
  registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
}

beforeEach(() => {
  resetRecorders();
  clearUuidRegistry();
});

describe('knight recap message', () => {
  function knightRecapFixture({ weaponRaw = ['percearmure 40', 'penetrant 6'] } = {}) {
    registerAttacker();
    const actor = makeActor(
      'knight',
      {
        armure: { value: 100 },
        champDeForce: { value: 10 },
        egide: { value: 0 },
        equipements: { guardian: { armure: { value: 15 }, champDeForce: { value: 5 } } },
        sante: { value: 20 },
        espoir: { value: 15, reduction: 3 },
        energie: { value: 12 },
        wear: 'normal',
      },
      { id: 'actor-def', uuid: 'Scene.scene-1.Token.token-def.Actor.actor-def', name: 'Victime' },
    );
    const token = makeToken(actor, { id: 'token-def' });
    const message = makeKnightMessage({ weaponRaw, targets: [{ id: 'token-def', value: 60 }] });
    return { damage: new DamageKnight(token, message, 1, false), actor, token };
  }

  it('creates one chat message with the recap lines in order', async () => {
    const { damage } = knightRecapFixture();
    await damage.calculate();
    damage.generateRecapMessage();

    const messages = recordedMessages();
    expect(messages).toHaveLength(1);
    const recap = messages[0];
    expect(recap.content).toContain('Récapitulatif des dégâts');
    const armureIdx = recap.content.indexOf('<div>Armure : 56</div>');
    const santeIdx = recap.content.indexOf('<div>Santé : 11</div>');
    expect(armureIdx).toBeGreaterThanOrEqual(0);
    expect(santeIdx).toBeGreaterThan(armureIdx);
    expect(recap.content).not.toContain('Energie');
    expect(recap.content).not.toContain('Espoir');
  });

  it('carries the base knight-damage flags plus the knight extras (wear, anatheme)', async () => {
    const { damage, actor, token } = knightRecapFixture();
    await damage.calculate();
    damage.generateRecapMessage();

    const recap = recordedMessages()[0];
    expect(recap.user).toBe(globalThis.game.userId);
    expect(recap.speaker.actor).toBe(actor);
    expect(recap.speaker.token).toBe(token);
    expect(recap.speaker.scene).toBe(globalThis.canvas.scene);
    expect(recap.flags['knight-damage']).toEqual({
      recap: { armure: 56, sante: 11 },
      isRecap: true,
      origin: ATTACKER_UUID,
      wear: 'normal',
      anatheme: false,
    });
  });

  it('records anatheme: true when the weapon has the anatheme effect', async () => {
    const { damage } = knightRecapFixture({ weaponRaw: ['anatheme'] });
    await damage.calculate();
    damage.generateRecapMessage();
    expect(recordedMessages()[0].flags['knight-damage'].anatheme).toBe(true);
  });
});

describe('recap line order (all stats)', () => {
  it('orders lines Energie -> Armure -> Blindage -> Guardian -> Santé -> Cohésion -> Espoir', () => {
    registerAttacker();
    const token = makeToken(makeActor('knight', {}), { id: 'token-def' });
    const damage = new DamageBase(token, makeKnightMessage({}), 1, false);
    damage.damageRepartition = {
      espoir: 7,
      cohesion: 6,
      sante: 5,
      armureGuardian: 4,
      blindage: 3,
      armure: 2,
      energie: 1,
    };
    damage.generateRecapMessage();

    const content = recordedMessages()[0].content;
    const lines = [
      'Energie : 1',
      'Armure : 2',
      'Blindage : 3',
      'Guardian : 4',
      'Santé : 5',
      'Cohésion : 6',
      'Espoir : 7',
    ];
    const indexes = lines.map((line) => content.indexOf(line));
    expect(indexes.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < indexes.length; i++) {
      expect(indexes[i]).toBeGreaterThan(indexes[i - 1]);
    }
  });
});

describe('vehicule recap messages', () => {
  function vehiculeRecapFixture({ targetValue = 130, targetStat = false } = {}) {
    registerAttacker();
    const actor = makeActor(
      'vehicule',
      { armure: { value: 30 }, champDeForce: { value: 3 }, energie: { value: 12 } },
      { id: 'actor-veh', uuid: 'Scene.scene-1.Token.token-def.Actor.actor-veh' },
    );
    const token = makeToken(actor, { id: 'token-def' });
    const message = makeKnightMessage({ targets: [{ id: 'token-def', value: targetValue }] });
    return { damage: new DamageVehicule(token, message, 1, targetStat), actor, token };
  }

  it('creates the armure recap plus a second passenger message', () => {
    const { damage } = vehiculeRecapFixture();
    damage.calculate();
    damage.generateRecapMessage();

    const [armureMsg, passengerMsg] = recordedMessages();
    expect(armureMsg.content).toContain('<div>Armure : 10</div>');
    expect(armureMsg.content).not.toContain('Santé');
    expect(armureMsg.flags['knight-damage']).toEqual({
      recap: { armure: 10, passenger: 2 },
      isRecap: true,
      origin: ATTACKER_UUID,
    });

    expect(passengerMsg.content).toContain('Dégâts sur les passagers');
    expect(passengerMsg.content).toContain('<div>Santé : 2</div>');
    // CHARACTERIZATION: the passenger message is created WITHOUT any
    // knight-damage flags, so it has no revert affordance of its own.
    expect(passengerMsg.flags).toBeUndefined();
    expect(passengerMsg.speaker.token).toBeDefined();
  });

  it('skips the passenger message when the repartition has energie', () => {
    const { damage } = vehiculeRecapFixture({ targetValue: 60, targetStat: 'energie' });
    damage.calculate();
    damage.generateRecapMessage();

    const messages = recordedMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('<div>Energie : 3</div>');
    expect(messages[0].flags['knight-damage'].recap).toEqual({ energie: 3 });
  });
});

describe('mecha recap messages', () => {
  function mechaRecapFixture() {
    registerAttacker();
    const actor = makeActor(
      'mechaarmure',
      {
        blindage: { value: 30 },
        champDeForce: { value: 0 },
        energie: { value: 10 },
        resilience: { value: 1 },
      },
      { id: 'actor-mecha', uuid: 'Scene.scene-1.Token.token-def.Actor.actor-mecha' },
    );
    const token = makeToken(actor, { id: 'token-def' });
    const message = makeKnightMessage({ targets: [{ id: 'token-def', value: 260 }] });
    return { damage: new DamageMecha(token, message, 1, false), actor, token };
  }

  it('creates the blindage recap plus a second pilote message with tranche-10 carry', () => {
    const { damage } = mechaRecapFixture();
    damage.calculate();
    damage.generateRecapMessage();

    const [blindageMsg, piloteMsg] = recordedMessages();
    expect(blindageMsg.content).toContain('<div>Blindage : 26</div>');
    expect(blindageMsg.content).not.toContain('Santé');
    expect(blindageMsg.flags['knight-damage'].recap).toEqual({ blindage: 26, passenger: 2 });

    expect(piloteMsg.content).toContain('Dégâts sur le pilote');
    expect(piloteMsg.content).toContain('<div>Santé : 2</div>');
    expect(piloteMsg.flags).toBeUndefined();
  });
});
