import { deleteMessagesInPage, waitForCard } from './chat.mjs';
import { replayMessageInPage } from './actor-pages.mjs';

/**
 * Node-side replay of a byte-frozen fixture chat-message document (the fixture object is
 * structuredClone-d per call — NEVER written back to disk) with the victim TOKEN injected as
 * speaker (DamageBase.origin and every revert click resolve through message.speaker, so the
 * replay deviates from the recorded null speaker deliberately and identically across suites).
 *
 * Shared by the damage suites (hoisted from the Phase-3/Phase-4 near-copies, review of Phase 4):
 * - create WITH rolls; on create failure retry WITHOUT rolls (the serialized-roll payloads are
 *   the dice-plan contract; the fallback only fires if the system-side create rejects);
 * - render timeout on the PINNED card => SELF-DELETE the created message (the caller never
 *   received the id and cannot clean it up — the boot-persistent chat log would leak it);
 * - returns the message id only once the card is rendered.
 */
export async function replayFixture(fw, fixtureMessage, mutate, speaker, tag = 'replay') {
  const data = structuredClone(fixtureMessage);
  if (mutate) mutate(data);
  data.speaker = speaker;
  const first = await fw.executeInFoundry(replayMessageInPage, data);
  let id = first?.id ?? null;
  if (!id) {
    console.log(`[${tag}] replay create WITH rolls failed: ${first?.error ?? 'null'} (SERVER-SIDE orphan possible)`);
    const noRolls = structuredClone(fixtureMessage);
    if (mutate) mutate(noRolls);
    delete noRolls.rolls;
    const second = await fw.executeInFoundry(replayMessageInPage, noRolls);
    id = second?.id ?? null;
  }
  if (!id) throw new Error('fixture replay failed (even without rolls)');
  try {
    await waitForCard(fw, id);
  } catch (err) {
    await fw.executeInFoundry(deleteMessagesInPage, [id]).catch(() => {});
    throw err;
  }
  return id;
}
