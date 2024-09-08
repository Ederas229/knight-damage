import { getMessageContext, getTraitValue, hasStatusEffect, log } from './helpers';

export class Damage {
  actor;
  wear;

  actorStats = {};
  effectiveStats = {};

  baseDamage = 0;
  damageRepartition = {};

  ignoreArmure = false;
  ignoreCdf = false;
  infatigable = false;

  perceArmure = 0;
  penetrant = 0;

  constructor(actor, message) {
    this.actor = actor;
    this.baseDamage = message.rolls[0]?.total;

    log('actor : ', actor);
    log('message : ', message);

    this.setIgnoreTraits(message);
    this.setInfatigable();
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
    this.baseDamage += mod.damage;
    log('Modified base damage : ', this.baseDamage);
  }

  setActorStats() {
    this.actorStats.armure = this.actor.system.armure.value;
    this.actorStats.cdf = this.actor.system.champDeForce.value;

    this.wear = this.actor.system.wear;

    if (this.actor.type == 'knight') {
      this.actorStats.armureGuardian = this.actor.system.equipements.guardian.armure.value;
      this.actorStats.cdfGuardian = this.actor.system.equipements.guardian.champDeForce.value;
    }

    this.actorStats.sante = this.actor.system.sante.value;
    this.effectiveStats = foundry.utils.deepClone(this.actorStats, { strict: true });

    log('Stats : ', this.actorStats);
  }

  setIgnoreTraits(message) {
    const context = getMessageContext(message);

    if (!context) return;

    this.ignoreArmure = context.listAllE.other.some((e) => e.name == 'Ignore Armure');
    this.ignoreCdf = context.listAllE.other.some((e) => e.name == 'Ignore Champ De Force');

    log('ignore armure : ', this.ignoreArmure);
    log('ingore Cdf : ', this.ignoreCdf);
  }

  setInfatigable() {
    this.infatigable = this.actor.items.contents.find((e) => e.name == 'Infatigable' && e.type == 'avantage');
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

  applyGuardianCdf() {
    if (this.effectiveStats.cdfGuardian <= this.penetrant || this.ignoreCdf) {
      this.effectiveStats.cdfGuardian = 0;
    }
    log('Effective guardian cdf : ', this.effectiveStats.cdfGuardian);
    if (this.baseDamage <= this.effectiveStats.cdfGuardian) {
      this.baseDamage = 0;
      return;
    }
    this.baseDamage -= this.effectiveStats.cdfGuardian;
    log('Damage after Guardian Cdf : ', this.baseDamage);
  }

  calculateDamageStat(stat) {
    if (this.baseDamage > this.effectiveStats[stat]) {
      this.baseDamage -= this.effectiveStats[stat];
      this.damageRepartition[stat] += this.effectiveStats[stat];
      this.actorStats[stat] -= this.effectiveStats[stat];
    } else {
      this.actorStats[stat] -= this.baseDamage;
      this.damageRepartition[stat] += this.baseDamage;
      this.baseDamage = 0;
    }
  }

  calculateDamageSante() {
    if (!(this.infatigable && this.actor.wear == 'knight')) {
      this.baseDamage += Math.trunc(this.damageRepartition.armure);
    }
  }

  calculateArmureVersSante() {
    let armureDamage = 0;
    if (!this.infatigable) {
      armureDamage += this.damageRepartition.armure;
    }
    if (this.damageRepartition.armureGuardian >= 0) {
      armureDamage += this.damageRepartition.armureGuardian;
    }
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

  calculateTypeKnight() {
    log('Base Damage : ', this.baseDamage);

    this.applyTraitCdf();
    log('Effective Cdf : ', this.effectiveStats.cdf);

    this.applyTraitArmure();
    log('Effective armure : ', this.effectiveStats.armure);

    this.baseDamage -= this.effectiveStats.cdf;
    log('Damage after Cdf', this.baseDamage);

    this.damageRepartition.armure = 0;
    this.calculateDamageStat('armure');
    log('Damage Armure : ', this.damageRepartition.armure);
    log('Damage after Armure : ', this.baseDamage);

    if (
      this.baseDamage > 0 &&
      this.actorStats.armure <= 0 &&
      !hasStatusEffect(this.actor, 'folde') &&
      !(this.wear == 'guardian')
    ) {
      if (hasStatusEffect(this.actor, 'apply-guardian-cdf')) this.applyGuardianCdf();

      this.damageRepartition.armureGuardian = 0;
      this.calculateDamageStat('armureGuardian');
      log('Damage Guardian : ', this.damageRepartition.armureGuardian);
      log('Damage after Guardian : ', this.baseDamage);
    }

    this.damageRepartition.sante = 0;
    this.calculateArmureVersSante();
    this.calculateDamageStat('sante');
    log('Damage sante : ', this.damageRepartition.sante);

    log('End actor stats : ', this.actorStats);
    log('Damage repartition : ', this.damageRepartition);
  }

  calculate() {
    if (this.actor.type == 'knight') {
      this.calculateTypeKnight();
    }
  }

  async revertDamage(message, html) {
    html.find('.recap').css('text-decoration', 'line-through');
    html.find('.revert-damage').remove();

    message.update({ content: html.find('.message-content').html() });
    const recap = message.flags['knight-damage'].recap;
    const wear = message.flags['knight-damage'].wear;

    if (wear == 'armure' && this.wear != 'armure') {
      this.switchArmure('armure');
    } else if (wear == 'guardian' && this.wear != 'guardian') {
      this.switchArmure('guardian');
    }

    this.damageRepartition = recap;

    log('Before revert : ', this.actorStats);
    const setActorStats = function () {
      log(this);
      this.setActorStats();
      const max = {
        armure: 0,
        armureGuardian: this.actor.system.equipements.guardian.armure.base,
        sante: this.actor.system.sante.max,
      };
      if (wear == 'armure') {
        max.armure = this.actor.items.find((e) => e.type == 'armure').system.armure.base;
      } else if (wear == 'guardian') {
        max.armure = max.armureGuardian;
      }

      log(max);
      for (const [key, value] of Object.entries(this.damageRepartition)) {
        this.actorStats[key] += value;
        if (this.actorStats[key] > max[key]) {
          this.actorStats[key] = max[key];
        }
      }
    }.bind(this);
    setTimeout(setActorStats, 10);
    log('After revert', this.actorStats);
    setTimeout(this.apply.bind(this), 10);
  }

  apply() {
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

    this.actor.update(data);

    if (
      this.actorStats.armure == 0 &&
      this.actor.type == 'knight' &&
      this.wear == 'armure' &&
      !hasStatusEffect(this.actor, 'folde')
    ) {
      setTimeout(this.switchArmure.bind(this), 10, 'guardian');
    }
    log('Applied data', data);
  }

  generateRecapMessage() {
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
    const chat = ChatMessage.create({
      user: game.userId,
      content: message,
      speaker: { actor: this.actor },
      flags: { 'knight-damage': { recap: this.damageRepartition, wear: this.wear } },
    });

    log('Recap message : ', chat);
  }

  switchArmure(etat) {
    let opened = false;
    if (!this.actor.sheet.rendered) {
      this.actor.sheet.render(true);
      opened = true;
    }
    setTimeout(() => {
      this.actor.sheet.element.find(`.armure[data-type="${etat}"]`).click();
      log('switching');
    }, 1);
    setTimeout(() => {
      if (opened) this.actor.sheet.close();
    }, 1);
  }
}
