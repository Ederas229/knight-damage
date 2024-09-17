import { DamageBaseNpc } from './damageBaseNpc';
import { log } from './helpers';

export class DamageBande extends DamageBaseNpc {
  setActorStats() {
    this.actorStats.cohesion = this.actor.system.sante.value;
    this.actorStats.bouclier = this.actor.system.bouclier.max;

    super.setActorStats();
  }

  applyViolenceTrait() {
    if (this.chair < 10) {
      this.damage += this.damageTraits.ultraviolence.result;
    } else {
      this.damage += this.damageTraits.fureur.result;
    }
  }

  calculate() {
    log(this.actorStats);
    log(this.effectiveStats);
    log('Base Damage : ', this.damage);
    this.applyViolenceTrait();
    log('Damage after traits : ', this.damage);

    this.calculateBouclierAspectExceptionnel();

    log('Damage : ', this.damage);
    this.damageRepartition.cohesion = 0;
    this.calculateDamageStat('cohesion');
    log('Damage cohesion : ', this.damageRepartition);
  }
}
