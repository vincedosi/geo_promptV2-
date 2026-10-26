import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CarteActivation } from '../../logique/activation/cartes';
import { carteDe } from '../../testing/activation-factice';
import { CartePlateformeComponent } from './carte-plateforme.component';

@Component({
  selector: 'mg-hote-carte',
  imports: [CartePlateformeComponent],
  template: '<mg-carte-plateforme [carte]="carte()"><p data-projete>contenu</p></mg-carte-plateforme>',
})
class Hote { readonly carte = signal<CarteActivation>(carteDe()); }

function rendre(c: CarteActivation) {
  const f = TestBed.createComponent(Hote);
  f.componentInstance.carte.set(c);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('CartePlateformeComponent', () => {
  it('nom, mode, nature, contenu projeté', () => {
    const el = rendre(carteDe());
    expect(el.querySelector('[data-carte-plateforme="dv360"]')).not.toBeNull();
    expect(el.querySelector('[data-libelle]')!.textContent!.trim()).toBe('DV360');
    expect(el.querySelector('[data-mode]')!.textContent!.trim()).toBe('API');
    expect(el.querySelector('[data-nature]')!.textContent!.trim()).toBe('63 CP — conversion de la zone (95 % d’utile)');
    expect(el.querySelector('[data-projete]')).not.toBeNull();
    expect(el.querySelector('[data-motifs]')).toBeNull();
  });

  it('motifs en encart, avertissements écrits, modes « Simulé » et « Fichier »', () => {
    const el = rendre(carteDe({ mode: 'simule', motifs: ['A', 'B'], avertissements: ['Publicité politique interdite chez Meta dans l’Union européenne.'] }));
    expect([...el.querySelectorAll('[data-motifs] > div')].map((d) => d.textContent!.trim())).toEqual(['· A', '· B']);
    expect(el.querySelector('[data-avertissements]')!.textContent).toContain('Publicité politique interdite chez Meta');
    expect(el.querySelector('[data-mode]')!.textContent!.trim()).toBe('Simulé');
    expect(rendre(carteDe({ mode: 'fichier', nature: '' })).querySelector('[data-nature]')).toBeNull();
  });
});
