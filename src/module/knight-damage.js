import { DamageBande } from './damageBande';
import { DamageKnight } from './damageKnight';
import { hasStatusEffect, log } from './helpers';

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
});

Hooks.on('preCreateChatMessage', async (message) => {
  if (!context) return;
  message.updateSource({ 'flags.knight-damage.context': context });
  context = undefined;
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

  html
    .find('.message-content')
    .append(`<button data-action="applyDamage">Apply Damage</button>`)
    .find('[data-action="applyDamage"]')
    .on('click', { message: message }, handleClickApplyDamage);
}

async function addRevertDamageEvent(message, html) {
  html.find('.revert-damage').on('click', { message: message, html: html }, handleClickRevertDamage);
}

async function handleClickRevertDamage(event) {
  const message = event.data.message;
  const html = event.data.html;
  const token = await fromUuid(`Scene.${message.speaker.scene}.Token.${message.speaker.token}`);
  const actor = token.actor;
  let damage;

  switch (actor.type) {
    case 'knight':
      damage = new DamageKnight(actor, message);
      break;
    case 'bande':
      damage = new DamageBande(actor, message);
      break;
    default:
      return;
  }
  damage.revertDamage(message, html);
}

async function handleClickApplyDamage(event) {
  let damage;
  switch (canvas.activeLayer.controlled[0].actor.type) {
    case 'knight':
      damage = new DamageKnight(canvas.activeLayer.controlled[0].actor, event.data.message);
      break;
    case 'bande':
      damage = new DamageBande(canvas.activeLayer.controlled[0].actor, event.data.message);
      break;
    default:
      return;
  }

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
}
