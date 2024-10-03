import { DamageBase } from './damageBase';
import { log } from './helpers';

export class DamageBaseNpc extends DamageBase {
  chair;
  chairAe = { mineur: 0, majeur: 0 };

  constructor(actor, message, mult) {
    super(actor, message, mult);
    this.setAspectChair();
  }

  setAspectChair() {
    this.chair = this.actor.system.aspects?.chair?.value;

    this.chairAe.mineur = Number(this.actor.system.aspects?.chair?.ae.mineur.value);
    this.chairAe.majeur = Number(this.actor.system.aspects?.chair?.ae.majeur.value);
    log('Aspect Exceptionel : ', this.chairAe);
  }

  calculateBouclierAspectExceptionnel() {
    if (this.antianatheme && this.actor.getFlag('knight-damage', 'anatheme').etat == 'selected') return;

    this.damage -= this.chairAe.mineur + this.chairAe.majeur;
    log('Damage after chair exceptionnel', this.damage);
    this.damage -= this.actorStats.bouclier;
    log('Damage after bouclier', this.damage);
    if (this.damage < 0) {
      this.damage = 0;
      return;
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

  generateRecapMessage() {
    const data = {};

    if (game.user.isGM) {
      data.whisper = game.userId;
    }

    super.generateRecapMessage(data);
  }
}
