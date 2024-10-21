export function log(...args) {
  const devMode = false;
  if (devMode) {
    console.log(...args);
  }
}

export function getTraitValue(trait) {
  const array = trait.split(' ');
  return Number(array[array.length - 1]);
}

export function extractTraitValue(message, trait) {
  const number = message.content.match(
    new RegExp(`<span class="label">${trait}<\\/span>\\s*<span class="value">\\+\\d*`),
  );
  if (!number) return;
  return Number(number[0].match(new RegExp(`\\d+`))[0]);
}

export function hasStatusEffect(actor, statusEffect) {
  return actor.temporaryEffects.some((e) => e.statuses.has(statusEffect));
}
