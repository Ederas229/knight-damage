import { log, getMessageContext, getTraitValue } from './helpers';
import { traitName } from './const';

export class DamageBase {
  actor;

  actorStats = {};
  effectiveStats = {};

  baseDamage = 0;
  damageRepartition = {};

  ignoreArmure = false;
  ignoreCdf = false;

  damageTraits = {
    destructeur: { bool: false, result: 0 },
    meurtrier: { bool: false, result: 0 },
    ultraviolence: { bool: false, result: 0 },
    fureur: { bool: false, result: 0 },
  };

  perceArmure = 0;
  penetrant = 0;

  constructor(actor, message) {
    this.actor = actor;
    this.baseDamage = message.rolls[0]?.total;

    this.setBooleanTraits(message);
    this.setTraitsResult(message);
    this.setPerceArmureAndPenetrant(message);

    this.setActorStats();

    log('actor : ', actor);
    log('message : ', message);
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
    this.baseDamage += mod.damage;
    log('Modified base damage : ', this.baseDamage);
  }

  setActorStats() {
    this.effectiveStats = foundry.utils.deepClone(this.actorStats, { strict: true });

    log('Stats : ', this.actorStats);
  }

  setBooleanTraits(message) {
    const context = getMessageContext(message);

    if (!context) return;

    this.ignoreArmure = context.listAllE.other.some((e) => e.name == 'Ignore Armure');
    this.ignoreCdf = context.listAllE.other.some((e) => e.name == 'Ignore Champ De Force');

    for (const [key] of Object.entries(this.damageTraits)) {
      this.damageTraits[key].bool = context.listAllE[traitName[key].cat].list.some(
        (e) => e.name == traitName[key].label,
      );
    }

    log('ignore armure : ', this.ignoreArmure);
    log('ingore Cdf : ', this.ignoreCdf);
  }

  setTraitsResult(message) {
    const context = getMessageContext(message);

    for (const [key] of Object.entries(this.damageTraits)) {
      if (this.damageTraits[key].bool) {
        this.damageTraits[key].result = context.listAllE[traitName[key].cat].list.find(
          (e) => e.name == traitName[key].label,
        ).total;
      }
      log(this.damageTraits);
    }
  }

  setPerceArmureAndPenetrant(message) {
    const context = getMessageContext(message);

    if (!context) return;

    let trait;
    if ((trait = context.listAllE.other.find((e) => e.name.includes('Perce Armure')))) {
      this.perceArmure = getTraitValue(trait);
    }
    if ((trait = context.listAllE.other.find((e) => e.name.includes('Pénétrant')))) {
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

  applyDamageTrait(trait) {
    if (this.damageTraits[trait].bool && this.baseDamage > 0) {
      this.baseDamage += this.damageTraits[trait].result;
    }
  }

  calculateDamageStat(stat) {
    if (this.baseDamage > this.effectiveStats[stat]) {
      this.baseDamage -= this.effectiveStats[stat];
      this.damageRepartition[stat] += this.effectiveStats[stat];
      this.actorStats[stat] -= this.effectiveStats[stat];
      this.effectiveStats[stat] = 0;
    } else {
      this.actorStats[stat] -= this.baseDamage;
      this.damageRepartition[stat] += this.baseDamage;
      this.baseDamage = 0;
      this.effectiveStats[stat] -= this.baseDamage;
    }
  }

  calculateArmureVersSante(armureDamage) {
    log('total armure damage : ', armureDamage);
    let damageSante = Math.trunc(armureDamage / 5);
    log('Damage armure vers sante : ', damageSante);

    if (damageSante >= this.effectiveStats.sante) {
      this.damageRepartition.sante += this.effectiveStats.sante;
      this.actorStats.sante -= this.effectiveStats.sante;
      this.effectiveStats.sante = 0;
    } else {
      this.actorStats.sante -= damageSante;
      this.effectiveStats.sante -= damageSante;
      this.damageRepartition.sante += damageSante;
    }
  }

  revertDamage(message, html, max) {
    html.find('.recap').css('text-decoration', 'line-through');
    html.find('.revert-damage').remove();

    message.update({ content: html.find('.message-content').html() });
    const recap = message.flags['knight-damage'].recap;

    this.damageRepartition = recap;

    log('Before revert : ', this.actorStats);

    for (const [key, value] of Object.entries(this.damageRepartition)) {
      this.actorStats[key] += value;
      if (this.actorStats[key] > max[key]) {
        this.actorStats[key] = max[key];
      }
    }

    log('After revert', this.actorStats);

    this.apply();
  }

  async apply() {
    let data = {};
    if (this.damageRepartition.armure) {
      data = { ...data, ...{ 'system.armure.value': this.actorStats.armure } };
    }
    if (this.damageRepartition.armureGuardian) {
      data = { ...data, ...{ 'system.equipements.guardian.armure.value': this.actorStats.armureGuardian } };
    }
    if (this.damageRepartition.sante) {
      data = { ...data, ...{ 'system.sante.value': this.actorStats.sante } };
    }

    await this.actor.update(data);

    log('Applied data', data);
  }

  generateRecapMessage(data = {}) {
    log('generate message data : ', data);
    let message =
      '<div class="recap"><div>Récapitulatif des dégâts <button type="button" class="revert-damage"><i class="fa-solid fa-rotate-left"></i></button>:</div>';
    if (this.damageRepartition.armure) {
      message += `<div>Armure : ${this.damageRepartition.armure}</div>`;
    }
    if (this.damageRepartition.armureGuardian) {
      message += `<div>Guardian : ${this.damageRepartition.armureGuardian}</div>`;
    }
    if (this.damageRepartition.sante) {
      message += `<div>Santé : ${this.damageRepartition.sante}</div>`;
    }

    message += '</div>';

    const baseData = {
      user: game.userId,
      content: message,
      speaker: { actor: this.actor },
      flags: { 'knight-damage': { recap: this.damageRepartition } },
    };

    const mergedData = foundry.utils.mergeObject(baseData, data, { recursive: true });

    const chat = ChatMessage.create(mergedData);

    log('Recap message : ', chat);
  }
}
