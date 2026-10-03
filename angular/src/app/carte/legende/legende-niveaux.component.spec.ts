import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LegendeComponent } from './legende.component';
import { libelleRayon } from '../../features/risques/logique/profil';
import { LegendeNiveauxComponent, type NiveauLegende } from './legende-niveaux.component';

@Component({
  imports: [LegendeComponent, LegendeNiveauxComponent],
  template: `<mg-legende><mg-legende-niveaux [niveaux]="niveaux" /><p>Note</p></mg-legende>`,
})
class Hote {
  niveaux: NiveauLegende[] = [
    { libelle: 'Seveso seuil haut', jeton: 'niveau-haut', anneaux: [1000, 2000, 5000] },
    { libelle: 'Seveso seuil bas', jeton: 'niveau-bas', anneaux: [500, 1000] },
    { libelle: 'Autres régimes', jeton: 'niveau-autres', anneaux: [] },
  ];
}

describe('libelleRayon', () => {
  it('suit lib/risques/profil.ts', () => {
    expect(libelleRayon(500)).toBe('500 m');
    expect(libelleRayon(2000)).toBe('2 km');
    expect(libelleRayon(1500)).toBe('1,5 km');
  });
});

describe('mg-legende-niveaux', () => {
  function monter() {
    const f = TestBed.createComponent(Hote);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('ne liste que les niveaux qui portent un anneau', () => {
    const el = monter();
    expect(el.textContent).toContain('Seveso seuil haut');
    expect(el.textContent).toContain('Seveso seuil bas');
    expect(el.textContent).not.toContain('Autres régimes');
  });

  it('pose un carré par anneau, à l\'opacité de sa bande, teinté par un jeton CSS', () => {
    const carres = [...monter().querySelectorAll<HTMLElement>('[aria-hidden="true"]')];
    expect(carres).toHaveLength(5);
    expect(carres.map((c) => c.style.opacity)).toEqual(['0.45', '0.28', '0.16', '0.45', '0.28']);
    expect(carres[0].style.background).toContain('var(--niveau-haut)');
    expect(carres[3].style.background).toContain('var(--niveau-bas)');
  });

  it('écrit les rayons en police mono, et rien d\'autre', () => {
    const mono = [...monter().querySelectorAll('.font-mono')].map((e) => e.textContent);
    expect(mono).toEqual(['1 km', '2 km', '5 km', '500 m', '1 km']);
  });
});
