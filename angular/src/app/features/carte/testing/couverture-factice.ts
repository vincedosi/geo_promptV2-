import { type Provider, signal } from '@angular/core';
import { of } from 'rxjs';
import { ProfilRisqueApi } from '../../risques/data/profil-risque.api';
import { CouvertureService } from '../couches/couverture.service';
import { CouvertureApi } from '../data/couverture.api';
import { CataloguePoiService } from '../etat/catalogue-poi.service';
import { ZoneAnalyseeService } from '../etat/zone-analysee.service';

/**
 * Les services de ④ « Couverture d'une zone » (lot 4, T8) et de la couverture par rayon (T12) en doublures INERTES, pour les specs qui montent le panneau
 * Analyse sans la page : aucune zone analysée, aucun calcul, aucune lecture.
 */
export function fournisseursCouvertureFactices(): Provider[] {
  return [
    {
      provide: ZoneAnalyseeService,
      useValue: {
        zoneId: signal(null), cible: signal('ind'), decoupage: signal('forme'), resultat: signal(null), enCours: signal(false),
        erreur: signal(null), choisir: () => undefined, regler: () => undefined, chiffrer: () => undefined, siIntrouvable: () => false,
      },
    },
    {
      provide: CouvertureService,
      useValue: {
        affichee: signal(false), survole: signal(null), chargementContours: signal(false), contoursIndisponibles: signal(false),
        irisSousLeZoom: signal(false), survoler: () => undefined, masquee: signal(false), afficher: () => undefined,
      },
    },
    { provide: ProfilRisqueApi, useValue: { cibles: () => of({ cibles: [] }) } },
    // La couverture par rayon (T12), fournie par le panneau : aucun type de POI, aucun calcul.
    { provide: CouvertureApi, useValue: { rayon: () => of() } },
    { provide: CataloguePoiService, useValue: { types: signal([]), chargerUneFois: () => undefined } },
  ];
}
