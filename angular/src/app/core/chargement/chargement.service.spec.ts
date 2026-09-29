import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChargementService } from './chargement.service';

@Component({ selector: 'mg-source-essai', template: '' })
class SourceEssai {
  readonly actif = signal(true);
  constructor() {
    inject(ChargementService).suivre('essai', 'Calcul', () => this.actif());
  }
}

@Component({
  selector: 'mg-hote-essai',
  imports: [SourceEssai],
  providers: [ChargementService],
  template: '@if (montee()) { <mg-source-essai /> }',
})
class HoteEssai {
  readonly montee = signal(true);
  readonly chargement = inject(ChargementService);
}

describe('ChargementService', () => {
  it('déclare, met à jour et retire une piste', () => {
    const s = new ChargementService();
    s.declarer({ cle: 'a', libelle: 'Calcul', actif: true });
    expect(s.etat().texte).toBe('Calcul');
    s.declarer({ cle: 'a', libelle: 'Calcul', actif: false });
    expect(s.etat().actif).toBe(false);
    s.retirer('a');
    expect(s.etat()).toEqual({ actif: false, libelles: [], texte: null });
  });

  it('suit un signal et retire la piste quand la source est détruite', async () => {
    const f = TestBed.createComponent(HoteEssai);
    await f.whenStable();
    expect(f.componentInstance.chargement.etat().texte).toBe('Calcul');
    f.componentInstance.montee.set(false);
    await f.whenStable();
    expect(f.componentInstance.chargement.etat().actif).toBe(false);
  });
});
