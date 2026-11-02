// Phase-2 contract pins for the RECORDED knight attack fixture (tests/e2e/fixtures/*.json).
// These tests are the guard rail of the shared-fixture merge: the recorded live message must
// agree with every value the rest of the unit suite treats as the "standard" knight-message
// contract. If a re-record drifts (knight system upgrade, dice-plan change), THIS file fails
// loudly — consumer tests are never edited to chase a drifted fixture.

import { describe, it, expect } from 'vitest';
import { RECORDED_FIXTURE_META, STANDARD_RAW, standardKnightMessageFixture } from './support/knight-fixtures.mjs';
import { loadRecordedFixture, PINNED_KNIGHT_VERSION, TRAIT_FIXTURE_NAME } from '../e2e/support/fixture-store.mjs';

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

  it('serialized dice pools match the plan PIP-BY-PIP (value pin alone would not prove determinism)', () => {
    // Review 3: an exploit re-roll (same 3D6 formula) could hijack the dice queue and leave the
    // damage pool genuinely random — ~4.6% of random 3d6 sums equal 12 and would satisfy the
    // value pin. Mirror of the recorder's gate, now CI-enforced on the committed fixture:
    // exactly ONE pool per phase, plan die shape, and the override extension's exact
    // base/remainder pip split (dice-override/content.js:45-51).
    const planPips = (plan) => {
      const base = Math.floor(plan.total / plan.count);
      return Array.from(
        { length: plan.count },
        (_, i) => base + (i === plan.count - 1 ? plan.total - base * plan.count : 0),
      );
    };
    const cases = [
      ['damage rolls', fixture.rolls, RECORDED_FIXTURE_META.dicePlan.damage],
      ['flags.knight.attaque', fixture.flags.knight.attaque, RECORDED_FIXTURE_META.dicePlan.attack],
    ];
    for (const [label, entries, plan] of cases) {
      expect(entries, label).toHaveLength(1);
      // v14: ChatMessage.rolls are serialized JSON strings; flags.knight.attaque holds live objects.
      const roll = typeof entries[0] === 'string' ? JSON.parse(entries[0]) : entries[0];
      const dice = (roll.terms ?? []).filter((t) => t.class === 'Die');
      expect(dice, `${label}: exactly one Die term`).toHaveLength(1);
      expect(dice[0].faces, label).toBe(plan.faces);
      expect(dice[0].number, label).toBe(plan.count);
      expect(
        dice[0].results.filter((r) => r.active === true).map((r) => r.result),
        label,
      ).toEqual(planPips(plan));
      expect(roll.total, label).toBe(plan.total);
    }
  });

  it('content carries the module DOM anchors its injection depends on', () => {
    // The unit doubles answer by canned SELECTOR, not DOM, so a knight-system change to the
    // real message shape (e.g. the .knight-roll append anchor at knight-damage.js:261) would
    // keep the unit suite green and only surface in local-only e2e — pin the anchors here so
    // CI catches that class of drift. (The trait-bearing recording that exercises the REAL
    // label/value span path is the sibling TRAIT fixture — pinned in its own describe below;
    // this standard weapon renders label-only spans, no value span.)
    expect(fixture.content).toContain('class="knight-roll"');
    expect(fixture.content.match(/class="label/g)).not.toBeNull();
  });
});

// Phase 3 (third review (b)): the trait-bearing recording is the live witness for the HTML
// shape extractTraitValue (helpers.js:26-33) regexes over. The unit suite's traitSpan()
// double was previously a FABRICATION with no live counterpart — these pins tie it to the
// system's REAL rendered spans so a knight-system template/label change fails in CI.
describe('recorded trait fixture = real extractTraitValue HTML contract', () => {
  const { meta, message: traitFixture } = loadRecordedFixture(TRAIT_FIXTURE_NAME);
  const knight = traitFixture.flags.knight;

  it('metadata header pins the trait recording (seed, trait sub-roll plan, expected span value)', () => {
    expect(meta.kind).toBe('knight-damage/attack-damage-message');
    expect(meta.knightSystemVersion).toBe(PINNED_KNIGHT_VERSION);
    expect(meta.weaponItemSeed.system.effets.raw).toEqual(['percearmure 40', 'penetrant 6', 'destructeur']);
    expect(meta.diceOverrideApplied).toBe(true);
    expect(traitFixture.flags.knight.targets[0].value).toBe(meta.dicePlan.expectedTargetValue);
    expect(meta.dicePlan.traitSubRoll).toEqual({ faces: 6, count: 2, total: 6 });
    expect(meta.dicePlan.expectedTraitValue).toBe(6);
  });

  it('weapon.effets.raw keeps the bare destructeur keyword (the module reads BOOL from raw, N from spans)', () => {
    expect(knight.weapon.effets.raw).toEqual(['percearmure 40', 'penetrant 6', 'destructeur']);
  });

  it('the REAL system HTML shows exactly one Destructeur label+value span pair with +6', () => {
    // Same regex source the module builds in helpers.js:27-29 (and the e2e recorder gates on).
    // NOTE the recorded bytes put a newline + indentation between the two spans — the module's \s*
    // tolerates it, and this pin keeps the EXACT recorded whitespace so template re-indentation
    // in a future knight system version is a loud contract drift, not a silent pass.
    const regex = new RegExp('<span class="label">Destructeur<\\/span>\\s*<span class="value">\\+\\d*');
    const matches = Array.from(traitFixture.content.matchAll(new RegExp(regex.source, 'g')));
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('<span class="label">Destructeur</span>\n            <span class="value">+6');
  });

  it('the standard fixture has NO such value span (label-only spans only) — the gap the trait fixture closes', () => {
    const standard = standardKnightMessageFixture();
    expect(standard.content.match(/<span class="label">Destructeur<\/span>/)).toBeNull();
    // Perce-armure/Pénétrant render as label-merge spans (roll.html:203-205), never value spans:
    expect(standard.content).toContain('<span class="label merge">Perce Armure 40</span>');
    expect(standard.content).toContain('<span class="label merge">Pénétrant 6</span>');
  });

  it('detailledEffets carries the destructeur entry with +6 and the exact unaccented label', () => {
    // const.js maps traitName.destructeur.label = 'Destructeur' — this pin proves the system's
    // French label really IS unaccented, so extractTraitValue's label interpolation matches.
    const entries = knight.targets[0].detailledEffets.filter((d) => d.simple === 'destructeur');
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Destructeur');
    expect(entries[0].value).toBe('+6');
  });

  it('PLAN-DRIVEN pip determinism: the trait damage message carries TWO pools (3D6 + the 2D6 sub-roll)', () => {
    const planPips = (plan) => {
      const base = Math.floor(plan.total / plan.count);
      return Array.from(
        { length: plan.count },
        (_, i) => base + (i === plan.count - 1 ? plan.total - base * plan.count : 0),
      );
    };
    const asRoll = (e) => (typeof e === 'string' ? JSON.parse(e) : e);
    const damagePools = traitFixture.rolls.map(asRoll);
    expect(damagePools).toHaveLength(2); // main 3D6 + destructeur 2D6 (standard plan had 1)
    const byShape = (faces, count) =>
      damagePools.find((r) =>
        (r.terms ?? []).filter((t) => t.class === 'Die').some((d) => d.faces === faces && d.number === count),
      );
    for (const plan of [meta.dicePlan.damage, meta.dicePlan.traitSubRoll]) {
      const roll = byShape(plan.faces, plan.count);
      expect(roll, `${plan.faces}d${plan.count} pool missing from the trait damage message`).toBeTruthy();
      const dice = (roll.terms ?? []).filter((t) => t.class === 'Die');
      expect(dice).toHaveLength(1);
      expect(dice[0].results.filter((r) => r.active === true).map((r) => r.result)).toEqual(planPips(plan));
      expect(roll.total).toBe(plan.total);
    }
    // Attack side stays exactly one pool.
    expect(knight.attaque.map(asRoll)).toHaveLength(1);
  });
});
