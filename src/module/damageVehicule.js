import { DamageBase } from './damageBase';
import { log } from './helpers';

export class DamageVehicule extends DamageBase {
  setActorStats() {
    this.actorStats.armure = this.actor.system.armure.value;
    this.actorStats.cdf = this.actor.system.champDeForce.value;
    this.actorStats.energie = this.actor.system.energie.value;

    super.setActorStats();
  }

  calculate() {
    log('Base Damage : ', this.damage);

    this.applyTraitCdf();
    log('Effective Cdf : ', this.effectiveStats.cdf);

    this.damage -= this.effectiveStats.cdf;
    log('Damage after Cdf', this.damage);

    if (this.damage <= 0) {
      return;
    }

    if (this.effectiveStats.armure > 0 && !this.energie) {
      this.applyDamageTrait('destructeur');
    }

    this.calculateDamageStatWithColosse();

    log('target energie : ', this.energie);
    if (this.energie) {
      this.calculateEnergie();
      return;
    }

    this.damageRepartition.armure = 0;
    this.calculateDamageStat('armure');
    log('Damage Armure : ', this.damageRepartition.armure);
    log('Damage after Armure : ', this.damage);

    this.damageRepartition.passenger = 0;
    this.calculateArmureVersSante(this.damageRepartition.armure, 'passenger');
    log('Damage sante : ', this.damageRepartition.passenger);

    log('End actor stats : ', this.actorStats);
    log('Damage repartition : ', this.damageRepartition);
  }

  generateRecapMessage() {
    super.generateRecapMessage();

    if (this.damageRepartition.energie) return;

    let message = '<div class="recap"><div>Dégâts sur les passagers :</div>';

    message += `<div>Santé : ${this.damageRepartition.passenger}</div>`;

    message += '</div>';

    const baseData = {
      user: game.userId,
      content: message,
      speaker: { actor: this.actor, token: this.token, scene: canvas.scene },
    };

    const chat = ChatMessage.create(baseData);

    log('Recap message : ', chat);
  }
}
