import { buttonLabel } from './const';
import { hasStatusEffect, log } from './helpers';

import { DamageBande } from './damageBande';
import { DamageNpc } from './damageNpc';
import { DamageCreature } from './damageCreature';
import { DamageKnight } from './damageKnight';
import { DamageVehicule } from './damageVehicule';
import { DamageMecha } from './damageMecha';

let context;

// Initialize module
Hooks.once('init', async () => {
  console.log('knight-damage | Initializing knight-damage');

  CONFIG.statusEffects.push({ id: 'anti-anatheme', label: 'Anti-anathème', icon: 'icons/svg/explosion.svg' });
  CONFIG.statusEffects.push({ id: 'folde', label: 'Bloque folde', icon: 'icons/svg/hazard.svg' });
  CONFIG.statusEffects.push({
    id: 'apply-guardian-cdf',
    label: 'Applique Guardian Cdf',
    icon: 'icons/svg/holy-shield.svg',
  });
});

Hooks.on('renderChatMessage', async (message, html) => {
  addApplyDamageButton(message, html);
  addRevertDamageEvent(message, html);

  html.find('button.btnDgts').on('click', (event) => {
    setContext(event);
  });
  html.find('button.btnViolence').on('click', (event) => {
    setContext(event);
  });

  if (!message.getFlag('knight-damage', 'isRecap')) return;

  html.on('mouseenter', (event) => {
    // eslint-disable-next-line no-undef
    const token = fromUuidSync(`Scene.${message.speaker.scene}.Token.${message.speaker.token}`)?.object;
    onHoverIn(event, token);
  });
  html.on('mouseleave', (event) => {
    // eslint-disable-next-line no-undef
    const token = fromUuidSync(`Scene.${message.speaker.scene}.Token.${message.speaker.token}`)?.object;
    onHoverOut(event, token);
  });
});

Hooks.on('preCreateChatMessage', async (message) => {
  if (!context) return;
  message.updateSource({ 'flags.knight-damage.context': context });
  context = undefined;
});

Hooks.on('preCreateActor', async (actor) => {
  if (actor.type != 'knight') return;
  actor.updateSource({ 'flags.knight-damage.anatheme': { etat: 'selected', text: buttonLabel.selected } });
});

Hooks.on('renderActorSheet', async (sheet, html) => {
  if (sheet.actor.type == 'knight') return;

  let etat = sheet.actor.getFlag('knight-damage', 'anatheme')?.etat;
  let text = sheet.actor.getFlag('knight-damage', 'anatheme')?.text;

  if (!sheet.actor.getFlag('knight-damage', 'anatheme')) {
    etat = 'selected';
    text = buttonLabel.selected;

    sheet.actor.setFlag('knight-damage', 'anatheme', { etat: etat, text: text });
  }

  html
    .find('.tab.options')
    .find('.main')
    .append(`<button type="action" data-value="true" data-option="anatheme" class="${etat}">${text}</button>`)
    .find('[data-option="anatheme"]')
    .on('click', { actor: sheet.actor }, (event) => {
      event.currentTarget.classList.toggle('selected');
      event.currentTarget.classList.toggle('unselected');
      event.currentTarget.innerHTML = buttonLabel[event.currentTarget.className];

      event.data.actor.setFlag('knight-damage', 'anatheme', {
        etat: event.currentTarget.className,
        text: buttonLabel[event.currentTarget.className],
      });
    });
});

async function setContext(event) {
  context = JSON.parse(event.currentTarget.dataset.all);
  const actor = await fromUuid(`Actor.${context.actor.id}`);

  if (hasStatusEffect(actor, 'anti-anatheme') || context.listAllE.degats.list.some((e) => e.name == 'Anti-Anathème')) {
    context = foundry.utils.mergeObject(context, { antianatheme: true });
  }
}

async function addApplyDamageButton(message, html) {
  log(message);

  const regex = new RegExp(`Dégâts</div>|Violence</div>|Débordement</div>`);
  const match = message.content.match(regex);

  if (!match) return;

  if (message.content.match(new RegExp(`Mode Oriflamme : Dégâts`)) && !message.getFlag('knight-damage', 'context')) {
    message.setFlag('knight-damage', 'context', { antianatheme: true });
  }

  html.find('.message-content').append('<div class="damageButton flexrow"><div>').find('.damageButton').html('');

  html
    .find('.damageButton')
    .append(`<button data-action="applyDamage">Normal</button>`)
    .find('[data-action="applyDamage"]')
    .on('click', { message: message }, handleClickApplyDamage);
  html
    .find('.damageButton')
    .append(`<button data-action="applyDamageHalf">Demi</button>`)
    .find('[data-action="applyDamageHalf"]')
    .on('click', { message: message, mult: 0.5 }, handleClickApplyDamage);
  html
    .find('.damageButton')
    .append(`<button data-action="applyDamageDouble">Double</button>`)
    .find('[data-action="applyDamageDouble"]')
    .on('click', { message: message, mult: 2 }, handleClickApplyDamage);
}

async function addRevertDamageEvent(message, html) {
  html.find('.revert-damage').on('click', { message: message, html: html }, handleClickRevertDamage);
}

async function handleClickRevertDamage(event) {
  const message = event.data.message;
  const html = event.data.html;
  const token = await fromUuid(`Scene.${message.speaker.scene}.Token.${message.speaker.token}`);
  const actor = token.actor;

  const damage = createDamageObject(actor.type, token, message);

  damage.revertDamage(message, html);
}

async function handleClickApplyDamage(event) {
  if (canvas.activeLayer.controlled <= 0) return;

  let mult = 1;
  if (event.data.mult) {
    mult = event.data.mult;
  }

  canvas.activeLayer.controlled.forEach(async (e) => {
    const damage = createDamageObject(e.actor.type, e.document, event.data.message, mult);

    if (!damage) return;

    try {
      if (event.shiftKey) {
        await damage.askModifier();
      }
    } catch {
      return;
    }
    damage.calculate();
    damage.apply();
    damage.generateRecapMessage();
  });
}

export function createDamageObject(type, token, message, mult = 1) {
  switch (type) {
    case 'knight':
      return new DamageKnight(token, message, mult);
    case 'bande':
      return new DamageBande(token, message, mult);
    case 'creature':
      return new DamageCreature(token, message, mult);
    case 'pnj':
      return new DamageNpc(token, message, mult);
    case 'vehicule':
      return new DamageVehicule(token, message, mult);
    case 'mechaarmure':
      return new DamageMecha(token, message, mult);
    default:
      return false;
  }
}

async function onHoverIn(event, token) {
  if (!canvas.ready) return;

  token?.isVisible && !token.controlled && token._onHoverIn(event);
}
async function onHoverOut(event, token) {
  canvas.ready && token._onHoverOut(event);
}
