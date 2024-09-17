import { hasStatusEffect, log } from './helpers';
import { DamageBase } from './damageBase';

export class DamageKnight extends DamageBase {
  infatigable = false;

  constructor(actor, message) {
    super(actor, message);

    this.setInfatigable();
  }

  setActorStats() {
    this.actorStats.armure = this.actor.system.armure.value;
    this.actorStats.cdf = this.actor.system.champDeForce.value;

    this.actorStats.armureGuardian = this.actor.system.equipements.guardian.armure.value;
    this.actorStats.cdfGuardian = this.actor.system.equipements.guardian.champDeForce.value;

    this.actorStats.sante = this.actor.system.sante.value;
    super.setActorStats();
  }

  setInfatigable() {
    this.infatigable = this.actor.items.contents.find((e) => e.name == 'Infatigable' && e.type == 'avantage');
  }

  applyGuardianCdf() {
    if (this.effectiveStats.cdfGuardian <= this.penetrant || this.ignoreCdf) {
      this.effectiveStats.cdfGuardian = 0;
    }
    log('Effective guardian cdf : ', this.effectiveStats.cdfGuardian);
    if (this.damage <= this.effectiveStats.cdfGuardian) {
      this.damage = 0;
      return;
    }
    this.damage -= this.effectiveStats.cdfGuardian;
    log('Damage after Guardian Cdf : ', this.damage);
  }

  calculateArmureVersSante(armureDamage = 0) {
    if (!this.infatigable) {
      armureDamage += this.damageRepartition.armure;
    }
    if (this.damageRepartition.armureGuardian >= 0) {
      armureDamage += this.damageRepartition.armureGuardian;
    }
    super.calculateArmureVersSante(armureDamage);
  }

  calculate() {
    log('Base Damage : ', this.damage);

    this.applyTraitCdf();
    log('Effective Cdf : ', this.effectiveStats.cdf);

    this.applyTraitArmure();
    log('Effective armure : ', this.effectiveStats.armure);

    this.damage -= this.effectiveStats.cdf;
    log('Damage after Cdf', this.damage);
    if (this.damage <= 0) {
      return;
    }

    this.damageRepartition.armure = 0;
    this.applyDamageTrait('destructeur');
    this.calculateDamageStat('armure');
    log('Damage Armure : ', this.damageRepartition.armure);
    log('Damage after Armure : ', this.damage);

    if (
      this.damage > 0 &&
      this.actorStats.armure <= 0 &&
      !hasStatusEffect(this.actor, 'folde') &&
      !(this.actor.system.wear == 'guardian')
    ) {
      if (hasStatusEffect(this.actor, 'apply-guardian-cdf')) this.applyGuardianCdf();

      this.damageRepartition.armureGuardian = 0;
      this.calculateDamageStat('armureGuardian');
      log('Damage Guardian : ', this.damageRepartition.armureGuardian);
      log('Damage after Guardian : ', this.damage);
    }

    this.damageRepartition.sante = 0;
    this.calculateArmureVersSante();
    this.applyDamageTrait('meurtrier');
    this.calculateDamageStat('sante');
    log('Damage sante : ', this.damageRepartition.sante);

    log('End actor stats : ', this.actorStats);
    log('Damage repartition : ', this.damageRepartition);
  }

  async revertDamage(message, html) {
    html.find('.recap').css('text-decoration', 'line-through');
    html.find('.revert-damage').remove();

    message.update({ content: html.find('.message-content').html() });
    const recap = message.flags['knight-damage'].recap;
    const wear = message.flags['knight-damage'].wear;

    if (wear == 'armure' && this.actor.system.wear != 'armure') {
      this.switchArmure('armure');
    } else if (wear == 'guardian' && this.actor.system.wear != 'guardian') {
      this.switchArmure('guardian');
    }

    this.damageRepartition = recap;

    log('Before revert : ', this.actorStats);
    const setActorStats = function () {
      this.setActorStats();

      for (const [key, value] of Object.entries(this.damageRepartition)) {
        log(key, value);
        this.actorStats[key] += value;
      }
    }.bind(this);
    setTimeout(setActorStats, 100);
    log('After revert', this.actorStats);
    setTimeout(this.apply.bind(this), 101);
  }

  async apply() {
    await super.apply();
    if (this.actorStats.armure == 0 && this.actor.system.wear == 'armure' && !hasStatusEffect(this.actor, 'folde')) {
      setTimeout(this.switchArmure.bind(this), 10, 'guardian');
    }
  }

  generateRecapMessage(data = {}) {
    log(this);
    super.generateRecapMessage(
      foundry.utils.mergeObject({ flags: { 'knight-damage': { wear: this.actor.system.wear } } }, data, {
        recursive: true,
      }),
    );
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
    }, 10);
  }
}
