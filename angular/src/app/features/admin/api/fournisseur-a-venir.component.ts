import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BASE_RESSOURCES, urlRessourceDistante } from '../../../core/ressources/ressource-distante';
import type { DspProvider } from '../logique/types/dsp';
import { fournisseur } from './logique/fournisseurs';

/**
 * `admin/systeme/api/{meta,ttd}` — portage de `ProviderPlaceholder`
 * (`app/admin/api/_components/ProviderPlaceholder.tsx`), monté par `meta/page.tsx` et `ttd/page.tsx`.
 *
 * Le fournisseur vient des `data` de la route (`{ fournisseur: 'meta' }`), lues dans
 * `ActivatedRoute` : la liaison des entrées par le routeur (`withComponentInputBinding`) dépend de
 * la configuration du routeur de l'HÔTE, on ne s'y fie pas.
 * Logo par `urlRessourceDistante` (C15), `alt` = libellé, comme React. Le champ est désactivé et le
 * restera : il annonce la forme de l'écran à venir.
 */
@Component({
  selector: 'mg-fournisseur-a-venir',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <img class="logo" [src]="urlLogo" [alt]="fournisseur.label" />
    <div class="carte">
      <p data-titre class="titre">Intégration {{ fournisseur.label }} bientôt disponible</p>
      <p data-texte class="texte">La connexion {{ fournisseur.label }} sera ajoutée après la mise en production de DV360.</p>
      <input disabled placeholder="Identifiant de compte" aria-label="Identifiant de compte" class="champ" />
    </div>
  `,
  styles: [`
    :host { display: block; max-width: 560px; font-family: var(--font-sans); }
    /* En ligne, comme le <img> de React (la ligne ajoute sa hauteur de descente sous le logo). */
    .logo { height: 28px; margin-bottom: 16px; }
    .carte { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 24px; }
    .titre { font-size: 14px; color: var(--text-primary); margin: 0; }
    .texte { font-size: 13px; color: var(--text-secondary); margin: 8px 0 0; }
    .champ {
      margin-top: 16px; width: 100%; background: var(--bg-level-2);
      border: 0.5px solid var(--border-subtle); border-radius: 6px; padding: 8px 12px; color: var(--text-tertiary);
      font-family: var(--font-sans); font-size: 13px;
    }
    .champ::placeholder { color: var(--text-tertiary); }
  `],
})
export class FournisseurAVenirComponent {
  protected readonly fournisseur = fournisseur(inject(ActivatedRoute).snapshot.data['fournisseur'] as DspProvider);
  protected readonly urlLogo = urlRessourceDistante(this.fournisseur.logo, inject(BASE_RESSOURCES));
}
