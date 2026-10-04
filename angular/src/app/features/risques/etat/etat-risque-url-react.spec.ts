import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ETAT_DEFAUT, type EtatRisque, ecrireEtatUrl } from '../logique/etat-url';
import { EtatRisqueService, PARAM_RISQUE } from './etat-risque.service';

@Component({ selector: 'mg-sonde-etat', template: '', providers: [EtatRisqueService] })
class SondeEtat {
  readonly etat = inject(EtatRisqueService);
}

/** L'URL qu'écrit React (`ContexteRisque.tsx:93-105`) pour un état, sur `/r`. */
function urlReact(e: EtatRisque): string {
  const params = new URLSearchParams();
  const encode = ecrireEtatUrl(e);
  if (encode !== '') params.set(PARAM_RISQUE, encode);
  const q = params.toString();
  return `/r${q ? `?${q}` : ''}`;
}

const ETATS: Array<[string, EtatRisque]> = [
  ['département 13', { ...ETAT_DEFAUT, chemin: ['departement:13'], etape: 'couverture' }],
  ['région 93 puis département 13', { ...ETAT_DEFAUT, chemin: ['region:93', 'departement:13'], maille: 'commune' }],
  [
    'natures accentuées, espaces, virgules, parenthèses',
    { ...ETAT_DEFAUT, natures: ['GPL et produits pétroliers', 'Inflammables (ancienne nomenclature)', 'a, b'] },
  ],
  [
    'profil, jeu, atelier, fusion',
    {
      ...ETAT_DEFAUT,
      profil: { ...ETAT_DEFAUT.profil, lie: false },
      etape: 'zones',
      jeu: '0b7ece33-0000-4000-8000-000000000000',
      atelier: true,
      fusionner: false,
    },
  ],
];

async function monter(url: string) {
  TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'r', component: SondeEtat }])] });
  const harnais = await RouterTestingHarness.create();
  const sonde = await harnais.navigateByUrl(url, SondeEtat);
  return { harnais, sonde, router: TestBed.inject(Router) };
}

describe('URL du module : parité octet pour octet avec React (arbitrage A2)', () => {
  for (const [nom, etat] of ETATS) {
    it(`écrit l'URL de React — ${nom}`, async () => {
      const { harnais, sonde, router } = await monter('/r');
      sonde.etat.maj(etat);
      TestBed.tick();
      await harnais.fixture.whenStable();
      expect(router.url).toBe(urlReact(etat));
    });

    it(`lit l'URL collée depuis React — ${nom}`, async () => {
      const { harnais, sonde, router } = await monter(urlReact(etat));
      expect(sonde.etat.etat()).toEqual(etat);
      await harnais.fixture.whenStable();
      // Une URL déjà canonique ne provoque aucune réécriture.
      expect(router.url).toBe(urlReact(etat));
    });
  }
});
