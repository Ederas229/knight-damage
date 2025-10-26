import { DamageBaseNpc } from './damageBaseNpc';
import { log } from './helpers';

export class DamageNpc extends DamageBaseNpc {
  espoir = false;

  constructor(actor, message, mult, espoir) {
    super(actor, message, mult);

    this.espoir = espoir;
  }

  setActorStats() {
    this.actorStats.armure = this.actor.system.armure.value;
    this.actorStats.bouclier = this.actor.system.bouclier.value;
    this.actorStats.cdf = this.actor.system.champDeForce.value;

    this.actorStats.sante = this.actor.system.sante.value;
    this.actorStats.espoir = this.actor.system.espoir.value;
    super.setActorStats();
  }

  calculate() {
    log('Base Damage : ', this.damage);

    this.applyTraitCdf();
    log('Effective Cdf : ', this.effectiveStats.cdf);

    //this.applyTraitArmure();
    log('Effective armure : ', this.effectiveStats.armure);

    this.calculateBouclierAspectExceptionnel();

    this.damage -= this.effectiveStats.cdf;

    if (this.damage <= 0) {
      return;
    }

    if (this.espoir) {
      this.damageRepartition.espoir = 0;
      this.calculateDamageStat('espoir');

      log('Damage Espoir : ', this.damageRepartition.espoir);
      log('End actor stats : ', this.actorStats);
      log('Damage repartition : ', this.damageRepartition);
      return;
    }

    if (this.effectiveStats.armure > 0 && !this.isArmorIgnored()) {
      this.applyDamageTrait('destructeur');
    }

    if (Math.trunc(this.damage / 10) > this.effectiveStats.armure) {
      this.applyDamageTrait('meurtrier');
    }

    this.calculateDamageStatWithColosse();

    this.damageRepartition.armure = 0;
    if (!this.isArmorIgnored()) {
      this.calculateDamageStat('armure');
      log('Damage Armure : ', this.damageRepartition.armure);
      log('Damage after Armure : ', this.damage);
    }

    this.damageRepartition.sante = 0;
    this.calculateArmureVersSante(this.damageRepartition.armure);
    this.calculateDamageStat('sante');
    log('Damage sante : ', this.damageRepartition.sante);

    log('End actor stats : ', this.actorStats);
    log('Damage repartition : ', this.damageRepartition);
  }
}
