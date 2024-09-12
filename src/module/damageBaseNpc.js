import { DamageBase } from './damageBase';
import { log } from './helpers';

export class DamageBaseNpc extends DamageBase {
  chair;
  chairAe = { mineur: 0, majeur: 0 };

  constructor(actor, message) {
    super(actor, message);
    this.setAspectChair();
  }

  setAspectChair() {
    this.chair = this.actor.system.aspects.chair.value;

    this.chairAe.mineur = Number(this.actor.system.aspects.chair.ae.mineur.value);
    this.chairAe.majeur = Number(this.actor.system.aspects.chair.ae.majeur.value);
    log('Aspect Exceptionel : ', this.chairAe);
  }

  applyAntiAnatheme() {
    if (!this.antianatheme) {
      this.baseDamage -= this.chairAe.mineur + this.chairAe.majeur;
      log('Damage after chair exceptionnel', this.baseDamage);
      this.baseDamage -= this.actorStats.bouclier;
      log('Damage after bouclier');
      if (this.baseDamage < 0) {
        this.baseDamage = 0;
        return;
      }
    }
  }
}
