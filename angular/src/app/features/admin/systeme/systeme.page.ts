import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { EntetePageComponent } from '../../../ui/entete-page/entete-page.component';
import { OngletsRoutesComponent, type OngletRoute } from '../commun/onglets-routes.component';
import { FraicheurEtatService } from '../health/etat/fraicheur-etat.service';
import { SanteService } from '../health/etat/sante.service';

/**
 * Onglets de la page Système, dans l'ordre. « Connexions API » (T9) porte ses propres sous-onglets
 * (DV360, Meta, TikTok, The Trade Desk, Logs) — jamais d'onglet « bientôt » au niveau de la page
 * (amendement du 2026-10-12).
 */
export const ONGLETS_SYSTEME: readonly OngletRoute[] = [
  { chemin: 'sante', libelle: 'Santé' },
  { chemin: 'fraicheur', libelle: 'Fraîcheur des données' },
  { chemin: 'api', libelle: 'Connexions API' },
];

/**
 * `admin/systeme` — la page « Système » (lot 6, T6, amendement du 2026-10-12 : l'administration
 * tient en trois pages à onglets, Accès, Données, Système). Pas de source React pour le cadre :
 * React a une page par fonction ; les ÉCRANS montés dans les onglets restent à la parité React.
 *
 * Les deux onglets du Health check React (`/admin/health`, « Diagnostic système » et « Fraîcheur
 * données ») sont remontés d'un niveau : ils deviennent les sous-routes `sante` et `fraicheur` —
 * plus de double barre. Le titre de page « Santé système » de React disparaît au profit de
 * « Système » ; chaque onglet garde le sous-titre que React affichait pour lui.
 *
 * Fournit l'état des deux onglets (`SanteService`, `FraicheurEtatService`), détruits avec la page :
 * un écran d'onglet est détruit quand on en change, ses données non — chaque lecture est faite à la
 * PREMIÈRE ouverture de son onglet, et un aller-retour ne relit rien.
 * Largeur 900 px, pour la barre ET chaque onglet (même borne, minor T6) : celle du Health check
 * React (`page.tsx:199`). Connexions API s'y range : React ne borne pas `layout.tsx` (barre pleine
 * largeur), mais son contenu ne dépasse jamais 640 px (`dv360/page.tsx:188`) ; seule la ligne de sa
 * barre de sous-onglets s'arrête donc à 900 px au lieu de courir jusqu'au bord.
 */
@Component({
  selector: 'mg-systeme',
  imports: [EntetePageComponent, OngletsRoutesComponent, RouterOutlet],
  providers: [SanteService, FraicheurEtatService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-[900px]">
      <mg-entete-page titre="Système" />
      <mg-onglets-routes [onglets]="onglets" libelle="Système" />
      <router-outlet />
    </div>
  `,
})
export class SystemePage {
  protected readonly onglets = ONGLETS_SYSTEME;
}
