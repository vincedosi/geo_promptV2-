import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CorrespondanceComponent } from './etapes/correspondance.component';
import { EnvoiComponent } from './etapes/envoi.component';
import { EtapesComponent } from './etapes/etapes.component';
import { FichiersComponent } from './etapes/fichiers.component';
import { ImportShapefileService } from './etat/import-shapefile.service';

/**
 * `admin/donnees/importer/shapefile` — portage de `app/admin/carreaux-import/page.tsx` (lot 6, T14), type
 * « Shapefile » de l'onglet « Importer » de la page Données (amendement A7) ; `admin/carreaux-import` y redirige.
 *
 * Trois étapes (fil `mg-shapefile-etapes`) : 1 Fichiers (lecture du bundle DANS le navigateur, `proj4` chargé
 * à la demande), 2 Mapping, 3 Import (envoi par lots de 1 000, un seul en vol, puis enregistrement de la
 * source). L'état que React tient au niveau de la PAGE (`ImportShapefileService`) est fourni par `ImporterPage`,
 * pas ici (vague finale, I-2) : un envoi survit au passage par un autre type d'import. Rien ne se lit à l'ouverture.
 *
 * Écarts à React, voulus : le titre « Import shapefile » (`h1`) est porté par le cadre (« Données », onglet
 * « Importer », type « Shapefile ») — un seul titre de page, comme POI (T12), IRIS (T15) et Radio (T16) ; le
 * sous-titre est gardé. Le `<style>` de React (barres de défilement globales, animation `spin`) n'est pas
 * repris : les barres sont celles de l'application, l'animation vit dans `mg-progression-import`. Largeur
 * 960 px de React gardée.
 */
@Component({
  selector: 'mg-import-shapefile',
  imports: [EtapesComponent, FichiersComponent, CorrespondanceComponent, EnvoiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="sous-titre">Import de données géographiques — Shapefile &rarr; Supabase</p>
    <mg-shapefile-etapes [etape]="etat.etape()" [verrouille]="etat.importEnCours()" (choisir)="etat.choisirEtape($event)" />
    @switch (etat.etape()) {
      @case (1) { <mg-shapefile-fichiers /> }
      @case (2) { <mg-shapefile-correspondance /> }
      @case (3) { <mg-shapefile-envoi /> }
    }
  `,
  styles: `
    :host { display: block; max-width: 960px; font-family: var(--font-sans); color: var(--text-primary); }
    .sous-titre { font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary); margin: 0 0 32px; }
  `,
})
export class CarreauxImportPage {
  protected readonly etat = inject(ImportShapefileService);
}
