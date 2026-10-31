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
  const value = Number(array[array.length - 1]);
  if (!Number.isFinite(value)) return 0; // entree malformee (sans nombre) -> neutre au lieu de NaN
  return Math.max(0, value); // un trait d'arme n'est jamais negatif : un negatif boosterait la defense
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
  if (!number) return 0; // span absent du message -> trait neutre au lieu de NaN en aval
  const digits = number[0].match(new RegExp(`\\d+`));
  return digits ? Number(digits[0]) : 0; // signe « + » sans chiffre -> pareillement neutre
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
 * @returns data
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

  log('generate reminder Data :', data);

  return data;
}
