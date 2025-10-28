import { log, getTraitValue, extractTraitValue, hasStatusEffect } from './helpers';
import { traitName } from './const';

export class DamageBase {
  actor;
  token;

  actorStats = {};
  effectiveStats = {};

  damage = 0;
  damageRepartition = {};

  ignoreArmure = false;
  ignoreCdf = false;
  antianatheme = false;
  antivehicule = false;

  damageTraits = {
    destructeur: { bool: false, result: 0 },
    meurtrier: { bool: false, result: 0 },
    ultraviolence: { bool: false, result: 0 },
    fureur: { bool: false, result: 0 },
  };

  perceArmure = 0;
  penetrant = 0;

  constructor(token, message, mult) {
    log('actor : ', token);
    log('message : ', message);
    this.token = token;
    this.actor = token.actor;
    const target = message.flags?.knight?.targets?.find((e) => e.id === this.token.id);
    if (target) this.damage = Math.ceil(target.value * mult);
    if (!this.damage) {
      const regexDebordement = new RegExp(`Débordement</div>`);
      const matchDebordement = message.content.match(regexDebordement);

      const regexOri = new RegExp(`Mode Oriflamme :`);
      const matchOri = message.content.match(regexOri);

      if (matchDebordement || matchOri) {
        const number = message.content.match(new RegExp(`>\\n\\s*\\d+\\n\\s*<`));
        this.damage = Number(number[0].match(new RegExp(`\\d+`))[0]) * mult;
      }

      if (matchDebordement) {
        if (this.initiatorHasEffect(message, 'Ignore CdF')) {
          this.addWeaponEffects(message, 'ignorechampdeforce');
        }
        if (this.initiatorHasEffect(message, 'Ignore Armure')) {
          this.addWeaponEffects(message, 'ignorearmure');
        }
        if (this.initiatorHasEffect(message, 'Anti-véhicule')) {
          this.addWeaponEffects(message, 'antivehicule');
        }
      }
    }

    this.setBooleanTraits(message);
    this.setTraitsResult(message);
    this.setPerceArmureAndPenetrant(message);

    this.setActorStats();
  }

  async askModifier() {
    const mod = await foundry.applications.api.DialogV2.prompt({
      window: { title: 'Damage modifier' },
      content: '<input name="value" type="number" autofocus>',
      modal: true,
      rejectClose: true,
      ok: {
        label: 'Confirm',
        callback: (event, button) => {
          return { damage: button.form.elements.value.valueAsNumber };
        },
      },
    });
    this.damage += mod.damage;
    log('Modified base damage : ', this.damage);
  }

  setActorStats() {
    this.effectiveStats = foundry.utils.deepClone(this.actorStats, { strict: true });

    log('Stats : ', this.actorStats);
  }

  setBooleanTraits(message) {
    if (message.getFlag('knight-damage', 'isRecap')) return;
    this.antianatheme = this.getWeaponEffects(message, 'antianatheme');
    if (!this.antianatheme) {
      // eslint-disable-next-line no-undef
      const baseActor = fromUuidSync(`Actor.${message.flags.knight.actor._id}`);
      this.antianatheme = hasStatusEffect(baseActor, 'anti-anatheme');
    }

    this.ignoreArmure = this.getWeaponEffects(message, 'ignorearmure');
    this.ignoreCdf = this.getWeaponEffects(message, 'ignorechampdeforce');

    this.antivehicule = this.getWeaponEffects(message, 'antivehicule');

    for (const [key] of Object.entries(this.damageTraits)) {
      this.damageTraits[key].bool = this.getWeaponEffects(message, key);
    }

    log('ignore armure : ', this.ignoreArmure);
    log('ingore Cdf : ', this.ignoreCdf);
    log('Anti-Anathéme : ', this.antianatheme);
    log('Damage trait : ', this.damageTraits);
  }

  setTraitsResult(message) {
    for (const [key] of Object.entries(this.damageTraits)) {
      if (this.damageTraits[key].bool) {
        this.damageTraits[key].result = extractTraitValue(message, traitName[key].label);
      }
    }
  }

  setPerceArmureAndPenetrant(message) {
    if (message.getFlag('knight-damage', 'isRecap')) return;

    let trait;
    if ((trait = message.flags.knight.weapon.effets.raw.find((e) => e.includes('percearmure')))) {
      this.perceArmure = getTraitValue(trait);
    }
    if ((trait = message.flags.knight.weapon.effets.raw.find((e) => e.includes('penetrant')))) {
      this.penetrant = getTraitValue(trait);
    }

    log('Perce-Armure : ', this.perceArmure);
    log('Pénétrant : ', this.penetrant);
  }

  applyTraitCdf() {
    if (this.actorStats.cdf <= this.penetrant || this.ignoreCdf) {
      this.effectiveStats.cdf = 0;
      return;
    }
    this.effectiveStats.cdf -= this.penetrant;
  }

  applyTraitArmure() {
    if (this.actorStats.armure <= this.perceArmure || this.ignoreArmure) {
      this.effectiveStats.armure = 0;
      return;
    }
    this.effectiveStats.armure -= this.perceArmure;
  }

  isArmorIgnored() {
    return this.actorStats.armure <= this.perceArmure || this.ignoreArmure ? true : false;
  }

  applyDamageTrait(trait) {
    if (this.damageTraits[trait].bool && this.damage > 0) {
      this.damage += this.damageTraits[trait].result;
    }
  }

  calculateDamageStatWithColosse() {
    if (this.isColosseApplied()) {
      this.damage = Math.trunc(this.damage / 10);
    }
  }

  isColosseApplied() {
    return (this.actor.system.resilience?.value !== 0 || this.actor.type == 'vehicule') && !this.antivehicule;
  }

  calculateDamageStat(stat) {
    if (this.damage > this.effectiveStats[stat]) {
      this.damage -= this.effectiveStats[stat];
      this.damageRepartition[stat] += this.effectiveStats[stat];
      this.actorStats[stat] -= this.effectiveStats[stat];
      this.effectiveStats[stat] = 0;
    } else {
      this.actorStats[stat] -= this.damage;
      this.damageRepartition[stat] += this.damage;
      this.damage = 0;
      this.effectiveStats[stat] -= this.damage;
    }
  }

  calculateArmureVersSante(armureDamage, etat = 'sante', tranche = 5) {
    log('total armure damage : ', armureDamage);
    let damageSante = Math.trunc(armureDamage / tranche);
    log('Damage armure vers sante : ', damageSante);

    if (damageSante >= this.effectiveStats[etat]) {
      this.damageRepartition[etat] += this.effectiveStats[etat];
      this.actorStats[etat] -= this.effectiveStats[etat];
      this.effectiveStats[etat] = 0;
    } else {
      this.actorStats[etat] -= damageSante;
      this.effectiveStats[etat] -= damageSante;
      this.damageRepartition[etat] += damageSante;
    }
  }

  revertDamage(message, html) {
    html.find('.recap').css('text-decoration', 'line-through');
    html.find('.revert-damage').remove();

    message.update({ content: html.find('.message-content').html() });
    const recap = message.flags['knight-damage'].recap;

    this.damageRepartition = recap;

    log('Before revert : ', this.actorStats);

    for (const [key, value] of Object.entries(this.damageRepartition)) {
      this.actorStats[key] += value;
    }

    log('After revert', this.actorStats);

    this.apply();
  }

  apply() {
    let data = {};

    if (this.damageRepartition.armure) {
      data = { ...data, ...{ 'system.armure.value': this.actorStats.armure } };
    }
    if (this.damageRepartition.blindage) {
      data = { ...data, ...{ 'system.blindage.value': this.actorStats.blindage } };
    }
    if (this.damageRepartition.armureGuardian) {
      data = { ...data, ...{ 'system.equipements.guardian.armure.value': this.actorStats.armureGuardian } };
    }
    if (this.damageRepartition.sante) {
      data = { ...data, ...{ 'system.sante.value': this.actorStats.sante } };
    }
    if (this.damageRepartition.cohesion) {
      data = { ...data, ...{ 'system.sante.value': this.actorStats.cohesion } };
    }
    if (this.damageRepartition.espoir) {
      data = { ...data, ...{ 'system.espoir.value': this.actorStats.espoir } };
    }

    log('deep clone data ', foundry.utils.deepClone(data));
    this.actor.update(data);

    if (this.damageRepartition.energie) {
      data = { 'system.energie.value': this.actorStats.energie };
    }

    this.actor.update(data);
    log('Applied data', data);
  }

  generateRecapMessage(data = {}) {
    log('generate message data : ', data);
    let message =
      '<div class="recap"><div>Récapitulatif des dégâts <button type="button" class="revert-damage"><i class="fa-solid fa-rotate-left"></i></button>:</div>';
    if (this.damageRepartition.energie) {
      message += `<div>Energie : ${this.damageRepartition.energie}</div>`;
    }
    if (this.damageRepartition.armure) {
      message += `<div>Armure : ${this.damageRepartition.armure}</div>`;
    }
    if (this.damageRepartition.blindage) {
      message += `<div>Blindage : ${this.damageRepartition.blindage}</div>`;
    }
    if (this.damageRepartition.armureGuardian) {
      message += `<div>Guardian : ${this.damageRepartition.armureGuardian}</div>`;
    }
    if (this.damageRepartition.sante) {
      message += `<div>Santé : ${this.damageRepartition.sante}</div>`;
    }
    if (this.damageRepartition.cohesion) {
      message += `<div>Cohésion : ${this.damageRepartition.cohesion}</div>`;
    }
    if (this.damageRepartition.espoir) {
      message += `<div>Espoir : ${this.damageRepartition.espoir}</div>`;
    }

    message += '</div>';

    const baseData = {
      user: game.userId,
      content: message,
      speaker: { actor: this.actor, token: this.token, scene: canvas.scene },
      flags: { 'knight-damage': { recap: this.damageRepartition, isRecap: true } },
    };

    const mergedData = foundry.utils.mergeObject(baseData, data, { recursive: true });

    const chat = ChatMessage.create(mergedData);

    log('Recap message : ', chat);
  }

  getWeaponEffects(message, effect) {
    return message.flags.knight.weapon.effets.raw.includes(effect);
  }

  addWeaponEffects(message, effect) {
    message.flags.knight.weapon.effets.raw.push(effect);
  }

  initiatorHasEffect(message, effect) {
    return message.flags.knight.actor.items.find((e) => e.name == effect) != undefined ? true : false;
  }

  actorGetItem(itemName) {
    return this.actor.items.find((e) => e.name == itemName);
  }
}
