import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BASE_RESSOURCES } from '../../../core/ressources/ressource-distante';
import { FournisseurAVenirComponent } from './fournisseur-a-venir.component';

async function monter(cle: 'meta' | 'ttd') {
  TestBed.configureTestingModule({
    providers: [
      { provide: BASE_RESSOURCES, useValue: 'http://distante.test/app/main.js' },
      provideRouter([{ path: 'x', data: { fournisseur: cle }, component: FournisseurAVenirComponent }]),
    ],
  });
  const h = await RouterTestingHarness.create();
  await h.navigateByUrl('/x');
  return h.fixture.nativeElement as HTMLElement;
}

describe('FournisseurAVenirComponent — ProviderPlaceholder.tsx porté (lot 6, T9)', () => {
  it('Meta : logo de la remote, textes de React, champ désactivé', async () => {
    const el = await monter('meta');
    const img = el.querySelector('img')!;
    expect([img.getAttribute('src'), img.getAttribute('alt')]).toEqual(['http://distante.test/app/logos/meta.svg', 'Meta']);
    expect(el.querySelector('[data-titre]')?.textContent?.trim()).toBe('Intégration Meta bientôt disponible');
    expect(el.querySelector('[data-texte]')?.textContent?.trim()).toBe('La connexion Meta sera ajoutée après la mise en production de DV360.');
    const champ = el.querySelector('input')!;
    expect([champ.disabled, champ.placeholder]).toEqual([true, 'Identifiant de compte']);
  });

  it('The Trade Desk : libellé complet', async () => {
    const el = await monter('ttd');
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('The Trade Desk');
    expect(el.querySelector('[data-titre]')?.textContent?.trim()).toBe('Intégration The Trade Desk bientôt disponible');
  });
});
