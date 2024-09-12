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
      this.baseDamage += this.damageTraits.ultraviolence.result;
    } else {
      this.baseDamage += this.damageTraits.fureur.result;
    }
  }

  calculate() {
    log(this.actorStats);
    log(this.effectiveStats);
    log('Base Damage : ', this.baseDamage);
    this.applyViolenceTrait();
    log('Damage after traits : ', this.baseDamage);

    this.applyAntiAnatheme();

    log('Damage : ', this.baseDamage);
    this.damageRepartition.cohesion = 0;
    this.calculateDamageStat('cohesion');
    log('Damage cohesion : ', this.damageRepartition);
  }
}
