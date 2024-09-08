import { Damage } from './damage';

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
});

Hooks.on('preCreateChatMessage', async (message) => {
  if (!context) return;
  message.updateSource({ 'flags.knight-damage.context': context });
  context = undefined;
});

async function addApplyDamageButton(message, html) {
  if (!message.isRoll) return;

  html.find('button.btnDgts').on('click', (event) => {
    context = JSON.parse(event.currentTarget.dataset.all);
  });

  const regex = new RegExp(`Dégâts</div>`);
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
  const actor = await fromUuid('Actor.' + message.speaker.actor);
  const damage = new Damage(actor, message);
  damage.revertDamage(message, html);
}

async function handleClickApplyDamage(event) {
  const damage = new Damage(canvas.activeLayer.controlled[0].actor, event.data.message);

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
