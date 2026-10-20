import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { OngletsRoutesComponent, type OngletRoute } from '../commun/onglets-routes.component';
import { PROVIDERS } from './logique/fournisseurs';

/** Sous-onglets de l'écran, dans l'ordre de `TABS` (`app/admin/api/layout.tsx:7-10`). */
export const ONGLETS_CONNEXIONS_API: readonly OngletRoute[] = [
  ...PROVIDERS.map((p) => ({ chemin: p.key, libelle: p.label })),
  { chemin: 'logs', libelle: 'Logs' },
];

/**
 * `admin/systeme/api` — l'écran « Connexions API », troisième onglet de la page Système (lot 6, T9,
 * amendement du 2026-10-12). Portage de `app/admin/api/layout.tsx` (+ `page.tsx` : la racine mène à
 * `dv360`, par la route).
 *
 * - Le titre « Connexions API » et son sous-titre restent, comme EN-TÊTE DE SECTION de l'écran
 *   (`h2`, 14 px) et non comme second titre de page : Système porte déjà le `h1` (même règle que le
 *   double titre corrigé sur Qualité en T6). React : `h1` 18 px.
 * - Les sous-onglets propres à React (DV360, Meta, TikTok, The Trade Desk, Logs) restent DANS
 *   l'écran : sous-routes RELATIVES, la barre `mg-onglets-routes` en variante `ecran` — le rendu de
 *   `layout.tsx` (12 px de marge latérale, ni survol ni marge basse, retour à la ligne) diffère de
 *   la barre de Système au pixel (C16), mais tabulation, flèches et `aria-selected` sont les mêmes.
 * - Le fond `--bg-primary` et le `minHeight: 100vh` de React ne sont pas repris : la page Système
 *   pose déjà le fond, et une hauteur d'écran DANS un onglet ferait défiler la page pour rien.
 * - Les marges latérales de 24 px de React (`padding: '20px 24px 0'`, `'16px 24px 0'`, `24`) ne
 *   sont pas reprises : l'écran s'aligne sur le titre et la barre de Système ; les espacements
 *   verticaux (16 px avant la barre, 24 px avant le contenu) le sont.
 */
@Component({
  selector: 'mg-connexions-api',
  imports: [OngletsRoutesComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 data-titre class="titre">Connexions API</h2>
    <p data-sous-titre class="sous-titre">Connecter les plateformes DSP pour le reporting et le custom bidding.</p>
    <mg-onglets-routes class="barre" [onglets]="onglets" libelle="Connexions API" variante="ecran" />
    <div class="contenu">
      <router-outlet />
    </div>
  `,
  styles: [`
    :host { display: block; font-family: var(--font-sans); color: var(--text-primary); }
    .titre { font-weight: 500; font-size: 14px; margin: 0; }
    .sous-titre { font-size: 13px; color: var(--text-secondary); margin: 4px 0 0; }
    .barre { margin-top: 16px; }
    .contenu { padding-top: 24px; }
  `],
})
export class ConnexionsApiPage {
  protected readonly onglets = ONGLETS_CONNEXIONS_API;
}
