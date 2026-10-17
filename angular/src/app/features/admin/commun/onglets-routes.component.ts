import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** Un onglet : un segment de route RELATIF au cadre qui porte la barre, et son libellé. */
export interface OngletRoute {
  chemin: string;
  libelle: string;
}

/**
 * Barre d'onglets liée au routeur, partagée par les cadres de l'administration (« Données »,
 * « Système » — amendement du 2026-10-12, lot 6 T6). Chaque onglet est une sous-route : le lien se
 * partage, le retour arrière revient à l'onglet précédent, un rechargement rouvre le bon.
 *
 * - Liens RELATIFS (`routerLink="sante"`) : ils se résolvent contre la route du cadre, donc sous le
 *   préfixe de montage, qui appartient au shell (contrat AIDA) — jamais `/admin/...`.
 * - Motif ARIA « tabs » : `role="tablist"` nommé, `role="tab"`, `aria-selected` porté par
 *   `routerLinkActive` (juste aussi après un chargement direct sur un onglet), tabulation itinérante
 *   (seul l'onglet actif est dans l'ordre de Tab). Flèches gauche/droite : focus ET navigation vers
 *   l'onglet voisin, en boucle (comme les onglets de `fiche-espace`). Écouteur sur la liste, jamais
 *   sur `document` (il appartient au shell).
 * - Rendu : celui de la barre interne du Health check (T3, `app/admin/health/page.tsx:228-250`) —
 *   actif `--text-primary` + bordure basse 2 px `--brand-teal`, inactif `--text-tertiary`, survol
 *   `--text-secondary`, Inter 500 13 px, sentence case. Jetons seulement.
 */
@Component({
  selector: 'mg-onglets-routes',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="tablist" class="liste" [attr.data-variante]="variante()" [attr.aria-label]="libelle()" (keydown)="clavier($event)">
      @for (o of onglets(); track o.chemin) {
        <a
          role="tab"
          class="onglet"
          [attr.data-onglet]="o.chemin"
          [routerLink]="o.chemin"
          routerLinkActive
          #actif="routerLinkActive"
          [attr.aria-selected]="actif.isActive"
          [attr.tabindex]="actif.isActive ? 0 : -1"
        >{{ o.libelle }}</a>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .liste { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--border-subtle); }
    .onglet {
      border-bottom: 2px solid transparent; color: var(--text-tertiary); text-decoration: none;
      font-family: var(--font-sans); font-weight: 500; font-size: 13px; padding: 8px 14px; margin-bottom: -1px;
      cursor: pointer; transition: color 0.15s;
    }
    .onglet:hover { color: var(--text-secondary); }
    .onglet[aria-selected='true'] { border-bottom-color: var(--brand-teal); color: var(--text-primary); }
    .onglet:focus-visible { outline: 1px solid var(--brand-teal-50); outline-offset: -1px; }
    /* Variante « ecran » : la barre propre à un écran React (app/admin/api/layout.tsx:23-44) —
       12 px de marge latérale, pas de survol, pas de marge basse (l'écran pose la sienne), retour à
       la ligne permis. */
    .liste[data-variante='ecran'] { margin-bottom: 0; flex-wrap: wrap; }
    .liste[data-variante='ecran'] .onglet { padding: 8px 12px; transition: none; }
    .liste[data-variante='ecran'] .onglet:hover { color: var(--text-tertiary); }
    .liste[data-variante='ecran'] .onglet[aria-selected='true']:hover { color: var(--text-primary); }
    /* Variante « large » : la barre de l'écran Radio (app/admin/radio/page.tsx:356-366) — onglets
       collés (gap 0), 10 px 20 px, inactif en 400, actif en 500, trait du bas 0,5 px, pas de survol. */
    .liste[data-variante='large'] { gap: 0; border-bottom-width: 0.5px; }
    .liste[data-variante='large'] .onglet { padding: 10px 20px; font-weight: 400; margin-bottom: 0; transition: all 0.15s; }
    .liste[data-variante='large'] .onglet:hover { color: var(--text-tertiary); }
    .liste[data-variante='large'] .onglet[aria-selected='true'] { font-weight: 500; }
    .liste[data-variante='large'] .onglet[aria-selected='true']:hover { color: var(--text-primary); }
  `],
})
export class OngletsRoutesComponent {
  readonly onglets = input.required<readonly OngletRoute[]>();
  /** Nom accessible de la liste (le titre du cadre). */
  readonly libelle = input.required<string>();
  /**
   * `cadre` (défaut) : barre d'une page à onglets (Données, Système), rendu du Health check.
   * `ecran` : sous-onglets propres à un écran React monté dans un onglet (Connexions API, T9).
   * `large` : les onglets de l'écran Radio (T16), plus aérés.
   */
  readonly variante = input<'cadre' | 'ecran' | 'large'>('cadre');

  protected clavier(e: KeyboardEvent): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const liste = e.currentTarget as HTMLElement;
    const liens = [...liste.querySelectorAll<HTMLAnchorElement>('[role="tab"]')];
    if (liens.length === 0) return;
    // Depuis l'onglet qui a le focus, sinon depuis l'onglet actif.
    const cible = (e.target as Element | null)?.closest?.('[role="tab"]');
    let i = liens.indexOf(cible as HTMLAnchorElement);
    if (i < 0) i = Math.max(0, liens.findIndex((a) => a.getAttribute('aria-selected') === 'true'));
    const suivant = liens[(i + (e.key === 'ArrowRight' ? 1 : liens.length - 1)) % liens.length];
    suivant.focus();
    suivant.click();
  }
}
