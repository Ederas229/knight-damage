import { DamageBaseNpc } from './damageBaseNpc';
import { log } from './helpers';

export class DamageCreature extends DamageBaseNpc {
  setActorStats() {
    this.actorStats.armure = this.actor.system.armure.value;
    this.actorStats.bouclier = this.actor.system.bouclier.value;

    this.actorStats.sante = this.actor.system.sante.value;
    super.setActorStats();
  }

  calculate() {
    log('Base Damage : ', this.damage);

    this.applyTraitArmure();
    log('Effective armure : ', this.effectiveStats.armure);

    this.calculateBouclierAspectExceptionnel();

    if (this.damage <= 0) {
      return;
    }

    if (this.effectiveStats.armure > 0) {
      this.applyDamageTrait('destructeur');
    }

    if (
      (Math.trunc(this.damage / 10) > this.effectiveStats.armure && this.isColosseApplied()) ||
      (this.damage > this.effectiveStats.armure && !this.isColosseApplied())
    ) {
      this.applyDamageTrait('meurtrier');
    }

    this.calculateDamageStatWithColosse();

    this.damageRepartition.armure = 0;
    this.calculateDamageStat('armure');
    log('Damage Armure : ', this.damageRepartition.armure);
    log('Damage after Armure : ', this.damage);

    this.damageRepartition.sante = 0;
    this.calculateArmureVersSante(this.damageRepartition.armure);
    this.calculateDamageStat('sante');
    log('Damage sante : ', this.damageRepartition.sante);

    log('End actor stats : ', this.actorStats);
    log('Damage repartition : ', this.damageRepartition);
  }
}
