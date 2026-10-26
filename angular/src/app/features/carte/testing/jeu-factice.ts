import { provideHttpClient } from '@angular/common/http';
import type { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, type EnvironmentProviders, type Provider, type Type } from '@angular/core';
import type { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ConfigService } from '../../../core/config/config.service';
import { ProfilRisqueApi } from '../../risques/data/profil-risque.api';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { JeuCarteService } from '../couches/jeu-carte.service';
import { IrisApi } from '../data/iris.api';
import { AnnonceService } from '../etat/annonce.service';
import { ContoursZonesService } from '../etat/contours-zones.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { CouvertureApi } from '../data/couverture.api';
import { ActivationApi } from '../data/activation.api';
import { JeuxApi } from '../data/jeux.api';
import { ZonesCustomApi } from '../data/zones-custom.api';
import { CatalogueIndicateursService } from '../etat/catalogue-indicateurs.service';
import { JeuZonesService } from '../etat/jeu-zones.service';
import { ParcoursService } from '../etat/parcours.service';
import { PileEchapService } from '../etat/pile-echap.service';
import { ZoneAnalyseeService } from '../etat/zone-analysee.service';
import type { PlateformeGeo } from '../logique/jeu/plateformes';
import { OutilsCarteService } from '../outils/outils-carte.service';

/**
 * Le banc des écrans de ⑤ Jeu de zones (lot 5, T10-T12) : l'état RÉEL (`JeuZonesService`, `ZoneAnalyseeService`,
 * `ParcoursService`, fournis par l'hôte comme par la page) et les routes RÉELLES (`JeuxApi`, `CouvertureApi`) derrière
 * `HttpTestingController` — c'est ce qui prouve qu'un geste lance, ou ne lance PAS, une requête. La liste des zones,
 * le profil, le catalogue d'indicateurs et celui des cibles sont des doublures.
 */

export const Z1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const Z2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const J1 = '16fd2706-8baf-433b-82eb-8c7fada847da';

export const regle = (p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo => ({
  libelle: p.maille, natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});

/** Le registre du 24/10, réduit à ce que les écrans lisent. */
export const REGISTRE: PlateformeGeo[] = [
  regle({ plateforme: 'dv360', maille: 'cp', libelle: 'Codes postaux', doc_url: 'https://doc.example/dv360', ordre: 10 }),
  regle({ plateforme: 'dv360', maille: 'cercle', libelle: 'Cercles', limites: { rayon_min_m: 1000, pop_min_unite: 1000 }, ordre: 20 }),
  regle({ plateforme: 'dv360', maille: 'polygone', libelle: 'Polygones', natif: false, disponible: false, note: 'Pas de polygone.', ordre: 25 }),
  regle({ plateforme: 'ttd', maille: 'polygone', libelle: 'Polygones', a_verifier: true, ordre: 30 }),
  regle({ plateforme: 'meta', maille: 'cercle', libelle: 'Cercles', limites: { max_unites: 200, rayon_min_m: 1000, rayon_max_m: 80000 }, ordre: 60 }),
  regle({ plateforme: 'tiktok', maille: 'departement', libelle: 'Départements', limites: { max_unites: 3000, pop_min_groupe: 1000 }, ordre: 80 }),
  regle({ plateforme: 'tiktok', maille: 'cercle', libelle: 'Cercles', natif: false, disponible: false, note: 'Aucun ciblage par rayon.', ordre: 100 }),
];

export const couvertureCp = {
  zone_id: Z1, cible: 'ind', decoupage: 'cp', population: 1000, surface_km2: 10, n_carreaux: 5, zone_maj: 'v1',
  lignes: [
    { code: '13001', nom: null, commune: null, n_carreaux: 2, pop_en_zone: 600, pop_totale: 1000, part: 60 },
    { code: '13002', nom: null, commune: null, n_carreaux: 2, pop_en_zone: 300, pop_totale: 1000, part: 30 },
    { code: '13003', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 100, pop_totale: 1000, part: 10 },
  ],
};

export const urlCouverture = (zone: string, decoupage: string, cible = 'ind') => `/api/zones/${zone}/couverture?cible=${cible}&decoupage=${decoupage}`;

@Component({ selector: 'mg-vide-jeu', template: '' })
export class VideJeu {}

/**
 * Les fournisseurs du banc : l'état de ⑤ comme la page le fournit, les routes réelles (`JeuxApi`, `CouvertureApi`),
 * les doublures — montés par `monterJeu`. `lister` : la liste des zones (`ZonesCustomApi.lister`) ; par défaut, jamais
 * de réponse.
 */
function fournisseursJeu(lister: () => unknown = () => NEVER): Array<Provider | EnvironmentProviders> {
  return [
    provideRouter([{ path: 'carte', component: VideJeu }]),
    provideHttpClient(), JeuxApi, ActivationApi, CouvertureApi, JeuZonesService, ParcoursService, ZoneAnalyseeService,
    { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    { provide: ZonesCustomApi, useValue: { lister, geometrie: () => NEVER } },
    { provide: AuthService, useValue: { lireProfil: async () => ({ role: 'admin', nom: 'A', organisation: 'o1' }) } },
    { provide: CatalogueIndicateursService, useValue: { charger: () => of([]) } },
    { provide: ProfilRisqueApi, useValue: { cibles: () => NEVER } },
    // La carte de ⑤ (T11) : aucune carte publiée dans le banc, donc rien n'est peint ni lu tant qu'on ne regarde rien.
    JeuCarteService, CouchesCarteService, EtatCarteService, OutilsCarteService, PileEchapService,
    { provide: AnnonceService, useValue: { annoncer: () => undefined } },
    { provide: IrisApi, useValue: { urlTuiles: () => '/api/tiles/iris/{z}/{x}/{y}' } },
    { provide: ContoursZonesService, useValue: { zones: () => NEVER } },
    { provide: CouleursService, useValue: { palette: () => () => ({}) } },
  ];
}

/**
 * Les entrées `…/testing` d'Angular, PASSÉES par le spec : ce fichier n'est pas un spec et ne les importe qu'en type
 * (`imports-partages.test.ts` : le remote n'importe à l'exécution que des entrées que tout hôte partage).
 */
export interface OutilsBanc {
  TestBed: typeof TestBed;
  HttpTestingController: typeof HttpTestingController;
  provideHttpClientTesting: typeof provideHttpClientTesting;
}

/**
 * Le montage commun des specs de ⑤ (revue finale du lot 5, point 11 — il était recopié dans cinq specs) : navigation
 * vers `url`, puis le composant et ses entrées ; l'état de ⑤ à l'injecteur du banc. `lister` : la liste des zones.
 */
export async function monterJeu<T>(
  outils: OutilsBanc, composant: Type<T>, url = '/carte', o: { lister?: () => unknown; entrees?: Record<string, unknown> } = {},
) {
  const { TestBed: banc } = outils;
  banc.configureTestingModule({ providers: [...fournisseursJeu(o.lister), outils.provideHttpClientTesting()] });
  const router = banc.inject(Router);
  await router.navigateByUrl(url);
  const fixture = banc.createComponent(composant);
  for (const [cle, valeur] of Object.entries(o.entrees ?? {})) fixture.componentRef.setInput(cle, valeur);
  const stable = async () => { for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); await fixture.whenStable(); } };
  await stable();
  return {
    fixture, el: fixture.nativeElement as HTMLElement, stable, router,
    http: banc.inject(outils.HttpTestingController), jeu: banc.inject(JeuZonesService),
  };
}
