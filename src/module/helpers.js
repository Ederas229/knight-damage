export function log(...args) {
  const devMode = false;
  if (devMode) {
    console.log(...args);
  }
}

export function getTraitValue(trait) {
  const array = trait.name.split(' ');
  return Number(array[array.length - 1]);
}

export function getMessageContext(message) {
  return message.flags['knight-damage'].context;
}

export function hasStatusEffect(actor, statusEffect) {
  return actor.temporaryEffects.some((e) => e.statuses.has(statusEffect));
}
