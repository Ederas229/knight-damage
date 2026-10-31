// Shared knight fixture helpers for the damage suite. Hoisted verbatim from
// the consumer test files (damage-knight / damage-revert / damage-vehicule-mecha
// / recap-message / damage-base) — same values, same semantics, zero
// assertion changes in the refactor commit.

import { registerUuid } from './foundry-globals.mjs';
import { makeActor } from './doubles.mjs';

export const ATTACKER_UUID = 'Scene.scene-1.Token.token-atk';
export const VICTIM_UUID = 'Scene.scene-1.Token.token-def.Actor.actor-def';

// Frozen so any source-side push into weapon.effets.raw that ever bypassed
// the makeKnightMessage copy would throw here instead of silently leaking
// into every later fixture using this constant.
export const STANDARD_RAW = Object.freeze(['percearmure 40', 'penetrant 6']);

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
