export function log(...args) {
  const devMode = false;
  if (devMode) {
    console.log(...args);
  }
}

/**
 * Extrait la valeur d'un trait (Perce-armure 60 renvoi 60)
 * @param {String} trait
 * @returns {Number}
 */
export function getTraitValue(trait) {
  const array = trait.split(' ');
  return Number(array[array.length - 1]);
}

/**
 * Extrait du message les dégâts infligés par le trait
 * @param {Message} message
 * @param {String} trait
 * @returns {Number}
 */
export function extractTraitValue(message, trait) {
  const number = message.content.match(
    new RegExp(`<span class="label">${trait}<\\/span>\\s*<span class="value">\\+\\d*`),
  );
  if (!number) return;
  return Number(number[0].match(new RegExp(`\\d+`))[0]);
}

/**
 *
 * @param {ActorDocument} actor
 * @param {String} statusEffect
 * @returns {boolean}
 */
export function hasStatusEffect(actor, statusEffect) {
  return actor.temporaryEffects.some((e) => e.statuses.has(statusEffect));
}

/**
 *
 * @param {TokenDocument} origin Token attaquant
 * @param {ActorDocument} actor Actor recevant l'attaque
 * @param {Number} value
 * @param {String} stat
 * @param {boolean} isRevert
 * @returns void
 */
export async function generateReminderData(origin, actor, value, stat, isRevert = false) {
  const data = {};
  const actorUuid = actor.uuid.replaceAll('.', '_');

  if (isRevert) value *= -1;

  foundry.utils.mergeObject(data, await origin.actor.getFlag('knight-damage', stat));

  if (!data[actorUuid]) {
    data[actorUuid] = 0;
  }

  data[actorUuid] += value;

  log('generateEspoirData :', data);

  return data;
}
