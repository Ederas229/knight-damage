// Phase-2 contract pins for the RECORDED knight attack fixture (tests/e2e/fixtures/*.json).
// These tests are the guard rail of the shared-fixture merge: the recorded live message must
// agree with every value the rest of the unit suite treats as the "standard" knight-message
// contract. If a re-record drifts (knight system upgrade, dice-plan change), THIS file fails
// loudly — consumer tests are never edited to chase a drifted fixture.

import { describe, it, expect } from 'vitest';
import { RECORDED_FIXTURE_META, STANDARD_RAW, standardKnightMessageFixture } from './support/knight-fixtures.mjs';
import { PINNED_KNIGHT_VERSION } from '../e2e/support/fixture-store.mjs';

describe('recorded knight attack fixture = standard knight message contract', () => {
  const fixture = standardKnightMessageFixture();
  const knight = fixture.flags.knight;

  it('weapon.effets.raw is exactly the hand-built STANDARD_RAW (percearmure 40 + penetrant 6)', () => {
    expect(STANDARD_RAW).toEqual(['percearmure 40', 'penetrant 6']);
    expect(knight.weapon.effets.raw).toEqual([...STANDARD_RAW]);
    expect(Object.isFrozen(STANDARD_RAW)).toBe(true);
  });

  it('content carries the French damage-label fragment the module gates on (Dégâts</div>)', () => {
    expect(fixture.content).toMatch(/Dégâts<\/div>/);
    // The module injection regex (knight-damage.js:253) matches…
    expect(fixture.content.match(new RegExp('Dégâts</div>|Violence</div>|Débordement</div>'))).not.toBeNull();
    // …while the Débordement/Oriflamme fallback markers must NOT be present, so the
    // targets[].value path (damageBase.js:43-44) is the live damage source.
    expect(fixture.content.match(new RegExp('Débordement</div>'))).toBeNull();
    expect(fixture.content.match(new RegExp('Mode Oriflamme :'))).toBeNull();
  });

  it('targets[] carries the token id + numeric damage value damageBase.js:43-44 reads', () => {
    expect(knight.targets).toHaveLength(1);
    const [target] = knight.targets;
    // World-fixture victim token id (docs/testing-plan.md Phase 0 scene table).
    expect(target.id).toBe('tkVicKnightAAAAA');
    expect(target.isValue).toBe(true);
    expect(typeof target.value).toBe('number');
    expect(Number.isFinite(target.value)).toBe(true);
    expect(target.value).toBeGreaterThan(0);
    // UNCONDITIONAL pins: the recorder's integrity gate runs before its write, so a fixture with
    // diceOverrideApplied=false can never reach the tracked file — a conditional pin here would be
    // a pollution hole (review 2). The dice plan pinned every die: the damage value is deterministic.
    expect(RECORDED_FIXTURE_META.diceOverrideApplied).toBe(true);
    expect(target.value).toBe(RECORDED_FIXTURE_META.dicePlan.expectedTargetValue);
  });

  it('attacker flags carry a pnj (NOT knight) actor with its world _id — the module button gate', () => {
    expect(knight.actor.type).toBe('pnj');
    expect(knight.actor._id).toBe('kdtAtkPnjAAAAAAA');
  });

  it('speaker carries the attacker actor id + alias only (actorLink:true world fixture)', () => {
    // The atk-pnj token is seeded actorLink:true, so token.actor is the PROTOTYPE actor and
    // RollKnight's speaker (roll: this.actor?.token) yields token/scene = null — real live-GM
    // behaviour for linked tokens, faithfully recorded. Consequence pinned here: the module's
    // DamageBase origin (damageBase.js:36) becomes 'Scene.null.Token.null' on such messages,
    // so reminder queries drop (origin unresolvable — inert-by-design) and hover/revert never
    // resolve a token object. Consumer unit tests keep using makeKnightMessage speakers.
    expect(fixture.speaker.actor).toBe('kdtAtkPnjAAAAAAA');
    expect(fixture.speaker.alias).toBe('atk-pnj');
    expect(fixture.speaker.token).toBeNull();
    expect(fixture.speaker.scene).toBeNull();
    const origin = `Scene.${fixture.speaker.scene}.Token.${fixture.speaker.token}`;
    expect(origin).toBe('Scene.null.Token.null');
  });

  it('metadata header pins the recording context (knight system version, world, dice plan)', () => {
    expect(RECORDED_FIXTURE_META.kind).toBe('knight-damage/attack-damage-message');
    expect(RECORDED_FIXTURE_META.knightSystemVersion).toBe(PINNED_KNIGHT_VERSION);
    expect(RECORDED_FIXTURE_META.recordedFromWorld).toBe('knight-damage-test');
    expect(RECORDED_FIXTURE_META.weaponItemSeed.system.effets.raw).toEqual(['percearmure 40', 'penetrant 6']);
  });

  it('no volatile keys survived the strip (_id/id/timestamp/userId/author at the top level)', () => {
    for (const key of ['_id', 'id', 'timestamp', 'userId', 'author']) {
      expect(fixture).not.toHaveProperty(key);
    }
  });

  it('every standardKnightMessageFixture() call hands out an isolated deep clone', () => {
    const a = standardKnightMessageFixture();
    const b = standardKnightMessageFixture();
    // Mirrors the doubles.mjs mutation-guard comment: source-side pushes into
    // weapon.effets.raw must never leak back into the recorded baseline.
    a.flags.knight.weapon.effets.raw.push('ignorearmure');
    expect(b.flags.knight.weapon.effets.raw).toEqual(['percearmure 40', 'penetrant 6']);
    expect(standardKnightMessageFixture().flags.knight.weapon.effets.raw).toEqual(['percearmure 40', 'penetrant 6']);
  });
});
