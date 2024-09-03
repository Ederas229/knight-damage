// Initialize module
Hooks.once('init', async () => {
  console.log('knight-damage | Initializing knight-damage');
});

Hooks.on('renderChatMessage', async (message, html) => {
  if (!message.isRoll) return;

  const regex = new RegExp(`Dégâts</div>`);
  const match = message.content.match(regex);

  if (!match) return;

  html
    .find('.message-content')
    .append(`<button data-action="applyDamage">Apply Damage</button>`)
    .find('[data-action="applyDamage"]')
    .on('click', { message: message }, handleClick);
});

async function handleClick(event) {
  if (_token.actor.type != 'knight') return;
  let mod = 0;
  try {
    if (event.shiftKey) {
      mod = await foundry.applications.api.DialogV2.prompt({
        window: { title: 'Damage modifier' },
        content: '<input name="value" type="number" autofocus>',
        modal: true,
        rejectClose: true,
        ok: {
          label: 'Confirm',
          callback: (event, button) => button.form.elements.value.valueAsNumber,
        },
      });
    }
    const totalDamage = event.data.message.rolls[0].total + mod;
    applyDamage(totalDamage);
  } catch {
    return;
  }
}

async function applyDamage(totalDamage, ignoreCdf = false) {
  const actor = _token.actor;

  let overflowDamage = 0;
  let damageArmor;

  if (ignoreCdf) {
    damageArmor = totalDamage;
  } else {
    damageArmor = totalDamage - _token.actor.system.champDeForce.value;
  }

  if (damageArmor > actor.system.armure.value) {
    overflowDamage = damageArmor - actor.system.armure.value;
    damageArmor = actor.system.armure.value;
  }

  let damageHealth = checkHealthDamageModifier(actor, Math.trunc(damageArmor / 5));

  if (actor.system.wear == 'guardian') {
    damageHealth += overflowDamage;
  }

  if (damageHealth > actor.system.sante.value) {
    damageHealth = actor.system.sante.value;
  }

  const armure = actor.system.armure.value - damageArmor;
  const health = actor.system.sante.value - damageHealth;

  await actor.update({
    'system.armure.value': armure > 0 ? armure : 0,
    'system.sante.value': health > 0 ? health : 0,
  });

  let message = '';

  if (actor.system.wear == 'armure') {
    message = '<div>Armure :</div>';
  } else if (actor.system.wear == 'guardian') {
    message = '<div>Guardian :</div>';
  }

  message += `<div>PA : ${damageArmor}</div>`;
  message += `<div>PS : ${damageHealth}</div>`;

  await ChatMessage.create({ user: game.userId, content: message, speaker: { actor: actor } });

  if (actor.system.wear == 'armure' && armure <= 0) {
    let opened = false;
    if (!actor.sheet.rendered) {
      await actor.sheet.render(true);
      opened = true;
    }
    setTimeout(changeToGuardian, 10, actor);
    setTimeout(() => {
      if (opened) actor.sheet.close();
    }, 1);
    setTimeout(applyDamage, 100, overflowDamage, true);
  }
}

function changeToGuardian(actor) {
  actor.sheet.element.find('.armure[data-type="guardian"]').click();
}

function checkHealthDamageModifier(actor, damage) {
  if (
    actor.items.contents.find((e) => e.name == 'Infatigable' && e.type == 'avantage') &&
    actor.system.wear == 'armure'
  )
    return 0;
  return damage;
}
