// Shared knight fixture helpers for the damage suite. Hoisted verbatim from
// the consumer test files (damage-knight / damage-revert / damage-vehicule-mecha
// / recap-message / damage-base) — same values, same semantics, zero
// assertion changes in the refactor commit.
//
// Phase-2 merge (shared fixture problem): the MESSAGE side of the standard
// fixture is no longer hand-built — STANDARD_RAW and the standard knight
// message baseline are sourced from the recorded live knight-system attack
// message in tests/e2e/fixtures/ (see tests/e2e/record-fixtures.mjs), so unit
// and e2e suites now share ONE source of truth for the knight message
// contract. The ACTOR side (knightSystem()) stays hand-parameterized for now:
// the recorded message embeds the full live actor blob (aspects/derived data),
// which would drown the per-case stat knobs the damage tests twist — see the
// Phase 2 status block in docs/testing-plan.md.

import { registerUuid } from './foundry-globals.mjs';
import { makeActor } from './doubles.mjs';
import { loadRecordedFixture, STANDARD_FIXTURE_NAME } from '../../e2e/support/fixture-store.mjs';

export const ATTACKER_UUID = 'Scene.scene-1.Token.token-atk';
export const VICTIM_UUID = 'Scene.scene-1.Token.token-def.Actor.actor-def';

// Recorded contract: the live attack fixture (metadata header + stripped message).
const RECORDED = loadRecordedFixture(STANDARD_FIXTURE_NAME);
// Shallow-freeze the meta: the message side is deep-cloned per call below, but a consumer must
// not be able to mutate the recording context (versions, dice plan) that contract tests pin.
export const RECORDED_FIXTURE_META = Object.freeze(RECORDED.meta);
const RECORDED_MESSAGE = RECORDED.message;

/**
 * Deep-cloned copy of the recorded real knight damage message (ChatMessage source
 * object, metadata + volatiles stripped): the shared baseline for "a standard pnj
 * attack message" in BOTH suites. E2E replays it via ChatMessage.create; unit tests
 * feed its flags/content into makeMessage/makeKnightMessage-shaped doubles. Always
 * hand out clones — the source MUTATES weapon.effets.raw (see doubles.mjs).
 */
export function standardKnightMessageFixture() {
  return structuredClone(RECORDED_MESSAGE);
}

// Frozen so any source-side push into weapon.effets.raw that ever bypassed
// the makeKnightMessage copy would throw here instead of silently leaking
// into every later fixture using this constant. Now DERIVED from the recorded
// fixture (fixture-contract.test.mjs pins it equals the pre-recording standard
// ['percearmure 40', 'penetrant 6'] — if a re-record ever drifts it, that test
// fails instead of quietly redefining the standard).
export const STANDARD_RAW = Object.freeze([...RECORDED_MESSAGE.flags.knight.weapon.effets.raw]);

// Standard fixture per the test plan: full 100 armor, CdF 10 straddling
// penetrant 6, guardian gear, sante 20, espoir 15 (reduction 3), energie 12.
export function knightSystem({
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

// Registers the attacking pnj actor AND its token uuid, so the constructor's
// anti-anatheme status fallback (fromUuidSync('Actor.<_id>'), damageBase.js:107)
// and the reminder queries (foundry.utils.fromUuid(this.origin)) both resolve.
// Guard-pin tests deliberately skip this (unresolvable attacker twins).
export function registerAttacker() {
  registerUuid('Actor.actor-atk', makeActor('pnj', {}, { id: 'actor-atk' }));
  registerUuid(ATTACKER_UUID, { uuid: ATTACKER_UUID });
}
