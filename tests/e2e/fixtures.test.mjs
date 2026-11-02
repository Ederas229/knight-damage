// E2E fixture validation (Phase 2 of docs/testing-plan.md): replay the recorded knight damage
// message in the LIVE world and prove the shared fixture really is the contract the module keys
// off. NO damage is applied here (that is Phase 3) — creation + module buttons only.
//
// Assertions:
//   A. the module's renderChatMessageHTML hook injects its five damage buttons on the replayed
//      message (knight-damage.js:250-288),
//   B. flags.knight.weapon.effets.raw round-trips to exactly ['percearmure 40','penetrant 6'],
//   C. the French-HTML regex sources taken from the module's own code match (or deliberately do
//      not match) the replayed message.content.
//
// Run with `npm run test:e2e:fixtures` AFTER `npm run prepare:e2e && npm run setup:e2e` (and after
// `npm run record:e2e` at least once — the JSON fixtures are committed, so this normally just works).

import config from './config.mjs';
import { loadFramework, respawnPreservingSymlinks } from './support/framework.mjs';
import { loadRecordedFixture, STANDARD_FIXTURE_NAME } from './support/fixture-store.mjs';

/* global process */

if (respawnPreservingSymlinks()) {
  // Parent: the symlink-preserving child inherited stdio and carries the run.
} else {
  const Framework = await loadFramework();
  main(Framework).catch((err) => {
    console.error(`\nE2E FIXTURES FAIL: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });
}

// Regex sources copied from the module's own code (keep in sync with src/ — this file asserts
// the RECORDED fixture satisfies them, it does not re-derive them):
//   knight-damage.js:253 (button-injection gate), damageBase.js:46/49/53 (Débordement fallback),
//   helpers.js:27-29 (extractTraitValue span regex, trait label from const.js:2).
const MODULE_REGEXES = [
  {
    label: 'button-injection regex (knight-damage.js:253)',
    source: 'Dégâts</div>|Violence</div>|Débordement</div>',
    expectHit: true,
  },
  { label: 'damage label (damageBase.js:46 sibling)', source: 'Dégâts</div>', expectHit: true },
  { label: 'Débordement marker (damageBase.js:46)', source: 'Débordement</div>', expectHit: false },
  { label: 'Oriflamme marker (damageBase.js:49)', source: 'Mode Oriflamme :', expectHit: false },
  {
    label: 'Destructeur trait span (helpers.js:28, const.js:2)',
    source: '<span class="label">Destructeur</span>\\s*<span class="value">\\+\\d*',
    expectHit: false,
  },
];

async function main(Framework) {
  const fw = new Framework(config);
  const results = [];

  const { meta, message } = loadRecordedFixture(STANDARD_FIXTURE_NAME);
  console.log(
    `[fixtures] loaded ${STANDARD_FIXTURE_NAME} (recorded: knight ${meta.knightSystemVersion}, core ${meta.coreVersion})`,
  );

  try {
    await fw.start();

    const versions = await fw.executeInFoundry(() => ({ knight: game.system.version, core: game.version }));
    results.push([
      `live system/core match fixture meta (knight ${meta.knightSystemVersion} / core ${meta.coreVersion})`,
      versions.knight === meta.knightSystemVersion && versions.core === meta.coreVersion,
      `live knight ${versions.knight} / core ${versions.core}`,
    ]);

    // Replay: ChatMessage.create the recorded object (metadata + volatiles already stripped).
    // The catch INSIDE the page fn is load-bearing: create REJECTS on a schema-invalid `rolls`,
    // and an uncaught rejection would kill page.evaluate — null lets the no-rolls fallback run.
    const createInPage = (data) =>
      ChatMessage.create(data)
        .then((m) => m.id)
        .catch(() => null);

    let created = await fw.executeInFoundry(createInPage, message);
    let replayedWithRolls = true;
    if (!created) {
      replayedWithRolls = false;
      const noRolls = { ...message };
      delete noRolls.rolls;
      created = await fw.executeInFoundry(createInPage, noRolls);
      console.log('[fixtures] replay fell back to stripping `rolls` (core schema refused the stored roll payloads)');
    }
    if (!created)
      throw new Error('fixture replay failed even without `rolls` — recorded contract no longer createable');

    // A. Module button injection on the replayed message (rendered DOM, not just flags).
    // STRICT card targeting: no "last card" fallback — without setup:e2e between runs, the chat
    // log still holds a PREVIOUS replay whose buttons would silently satisfy the predicate, and a
    // fallback would also mask a dataset mismatch. Miss => keep polling (waitFor retries on null).
    const buttons = await fw.waitFor(
      (msgId) => {
        const cards = Array.from(document.querySelectorAll('.chat-scroll li.chat-message'));
        const card = cards.find((li) => li.dataset.messageId === msgId);
        if (!card) return null;
        const found = Array.from(card.querySelectorAll('.damageButton button')).map((b) => ({
          label: b.textContent.trim(),
          action: b.dataset.action,
        }));
        return found.length > 0 ? found : null;
      },
      15000,
      created,
    );
    const expectedButtons = [
      { label: 'Normal', action: 'applyDamage' },
      { label: 'Demi', action: 'applyDamageHalf' },
      { label: 'Double', action: 'applyDamageDouble' },
      { label: 'Espoir', action: 'applyDamageEspoir' },
      { label: 'Energie', action: 'applyDamageEnergie' },
    ];
    const buttonsOk = JSON.stringify(buttons) === JSON.stringify(expectedButtons);
    results.push([
      'module injected the five damage buttons (Normal/Demi/Double/Espoir/Energie) on the replayed message',
      buttonsOk,
      `got ${JSON.stringify(buttons)}`,
    ]);

    // B. Weapon effets.raw round-trip through the live flags system.
    const raw = await fw.executeInFoundry((msgId) => game.messages.get(msgId).flags.knight.weapon.effets.raw, created);
    const rawOk = JSON.stringify(raw) === JSON.stringify(['percearmure 40', 'penetrant 6']);
    results.push([
      "flags.knight.weapon.effets.raw round-trips to ['percearmure 40','penetrant 6']",
      rawOk,
      `got ${JSON.stringify(raw)}`,
    ]);

    // C. The module's French-HTML regexes, run in page context against the live message content.
    const regexHits = await fw.executeInFoundry(
      (payload) => {
        const m = game.messages.get(payload.msgId);
        return payload.sources.map(({ source }) => ({
          source,
          hit: new RegExp(source).test(m.content),
        }));
      },
      { msgId: created, sources: MODULE_REGEXES.map((r) => ({ source: r.source })) },
    );
    for (const spec of MODULE_REGEXES) {
      const got = regexHits.find((h) => h.source === spec.source);
      results.push([
        `module regex ${spec.label} ${spec.expectHit ? 'matches' : 'does NOT match'} replayed content`,
        got?.hit === spec.expectHit,
        `hit=${got?.hit}`,
      ]);
    }

    // Contract pins the unit suite leans on (cheap to assert here, keeps both suites honest).
    const contract = await fw.executeInFoundry((msgId) => {
      const m = game.messages.get(msgId);
      const target = m.flags.knight.targets[0];
      return {
        targetTokenId: target.id,
        targetValue: target.value,
        targetIsValue: target.isValue,
        attackerType: m.flags.knight.actor.type,
        attackerId: m.flags.knight.actor._id,
        speakerScene: m.speaker.scene,
        speakerToken: m.speaker.token,
      };
    }, created);
    const contractOk =
      contract.targetTokenId === message.flags.knight.targets[0].id &&
      contract.targetValue === message.flags.knight.targets[0].value &&
      contract.targetIsValue === true &&
      contract.attackerType === 'pnj' &&
      contract.attackerId === message.flags.knight.actor._id &&
      contract.speakerScene === message.speaker.scene &&
      contract.speakerToken === message.speaker.token;
    results.push([
      'flags/targets/speaker contract matches the recorded fixture verbatim',
      contractOk,
      `got ${JSON.stringify(contract)}`,
    ]);

    for (const [label, ok, detail] of results) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — ${detail}`}`);
    }

    const failures = results.filter(([, ok]) => !ok).length;
    if (failures > 0) {
      await fw.screenshot('fixtures-failure.png').catch(() => {});
      console.log(
        `\nE2E FIXTURES: FAIL (${failures}/${results.length} assertions failed; screenshot in test-data/screenshots/)`,
      );
    } else {
      console.log(
        `\nE2E FIXTURES: PASS (${results.length}/${results.length} assertions, replayWithRolls=${replayedWithRolls})`,
      );
    }
    process.exitCode = failures > 0 ? 1 : 0;
  } catch (err) {
    await fw.screenshot('fixtures-failure.png').catch(() => {});
    throw err;
  } finally {
    await fw.stop();
    console.log('Foundry server + browser stopped.');
  }
}
