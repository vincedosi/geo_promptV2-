import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BasculeThemeComponent } from '../../../layout/bascule-theme.component';
import { DISPONIBLE_PROCHAINEMENT } from '../../../layout/navigation';
import { IconeComponent } from '../../../ui/icone/icone.component';
import type { NomIcone } from '../../../ui/icone/icones';
import { MAP_STYLES } from '../logique/fonds';

/**
 * Liens du back office — `BACK_OFFICE_LINKS` de `SettingsOverlay.tsx:83-95`, même ordre, mêmes libellés et icônes,
 * à un écart VOULU près (2026-10-10) : « Organisations (workspaces) » et « Utilisateurs » sont remplacés par UNE
 * entrée « Accès », la page Angular qui les réunit. `cible` : chemin RELATIF à la route `carte` qui monte ce
 * panneau (le préfixe appartient au shell) ; sans `cible`, l'entrée est inerte.
 */
const LIENS_BACK_OFFICE: readonly { libelle: string; icone: NomIcone; cible?: string }[] = [
  { libelle: 'Accès', icone: 'utilisateurs', cible: '../admin/acces' },
  { libelle: 'Import POI', icone: 'fichier-haut' },
  { libelle: 'Import Shapefile', icone: 'fichier-haut' },
  { libelle: 'Import OOH', icone: 'fichier-haut' },
  { libelle: 'IRIS crawler', icone: 'base-de-donnees' },
  { libelle: 'Radio FM/DAB+', icone: 'radio' },
  { libelle: 'Connexions API', icone: 'prise' },
  { libelle: 'Sources', icone: 'base-de-donnees' },
  { libelle: 'Historique imports', icone: 'fichier-haut' },
  { libelle: 'Health check', icone: 'activite' },
];

/**
 * Le panneau « Réglages » du rail — portage de `components/map/overlays/SettingsOverlay.tsx`.
 *
 * Cinq sections, dans l'ordre de React : Modèle IA, Fond de carte, Vues sauvegardées, Apparence, Back office.
 * - **Modèle IA** et **Vues sauvegardées** sont rendus à l'identique mais INERTES (arbitrage B5) : le premier
 *   règle l'Assistant, jamais porté (décision du propriétaire du 2026-10-04) ; le second ouvre le panneau de
 *   sauvegarde, qui vit DANS l'Assistant (`page.tsx:863-876`). Le badge d'état de la clé n'est pas rendu :
 *   il interrogerait `/api/providers/status` pour un modèle qui ne sert à rien ici.
 * - **Fond de carte** est actif : il émet l'id choisi ; la page recrée la carte (B11).
 * - **Apparence** reprend `mg-bascule-theme`, qui passe par `ThemeService.basculer()` seul (`ECRIRE_HTML`).
 * - **Back office** : « Accès » est ACTIF (lien relatif vers `admin/acces`) ; les neuf autres liens restent
 *   INERTES (« Disponible prochainement », patron de la barre latérale) tant que leurs pages ne sont pas portées.
 */
@Component({
  selector: 'mg-reglages',
  imports: [BasculeThemeComponent, IconeComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-5 px-4 py-3 font-sans' },
  template: `
    <section data-section="modele-ia">
      <h4 class="mb-2 mt-0 text-[11px] font-medium tracking-[0.04em] text-secondary">Modèle IA</h4>
      <div class="mb-2 flex items-center gap-1.5">
        @for (p of modeles; track p.id) {
          <button
            type="button"
            aria-disabled="true"
            [attr.title]="indisponible"
            [attr.data-modele]="p.id"
            class="cursor-default rounded-[4px] border-fin px-2.5 py-1 font-sans text-[11px]"
            [class]="p.id === 'mistral' ? 'border-teal bg-[color-mix(in_srgb,var(--brand-teal)_8%,transparent)] font-medium text-teal' : 'border-default bg-transparent font-normal text-secondary'"
          >{{ p.libelle }}</button>
        }
      </div>
    </section>

    <section data-section="fond">
      <h4 class="mb-2 mt-0 text-[11px] font-medium tracking-[0.04em] text-secondary">Fond de carte</h4>
      <div class="grid grid-cols-2 gap-1.5">
        @for (s of fonds; track s.id) {
          <button
            type="button"
            [attr.data-fond]="s.id"
            [attr.aria-pressed]="s.id === fond()"
            (click)="choisirFond.emit(s.id)"
            class="cursor-pointer rounded-[6px] border-fin px-2.5 py-2 font-sans text-[11px] transition-[background-color,border-color,color] duration-150 ease-[var(--ease-hover)]"
            [class]="s.id === fond() ? 'border-teal bg-teal-10 text-teal' : 'border-default bg-transparent text-secondary'"
          >{{ s.label }}</button>
        }
      </div>
    </section>

    <section data-section="vues">
      <h4 class="mb-2 mt-0 text-[11px] font-medium tracking-[0.04em] text-secondary">Vues sauvegardées</h4>
      <div class="flex flex-col gap-2">
        <button
          type="button"
          aria-disabled="true"
          [attr.title]="indisponible"
          class="w-full cursor-default rounded-[6px] border-fin border-teal bg-transparent px-4 py-2 font-sans text-[12px] font-medium text-teal"
        >Sauvegarder la vue actuelle</button>
      </div>
    </section>

    <section data-section="apparence">
      <h4 class="mb-2 mt-0 text-[11px] font-medium tracking-[0.04em] text-secondary">Apparence</h4>
      <div class="flex items-center gap-2.5">
        <mg-bascule-theme />
        <span class="text-[12px] text-secondary">Thème clair / sombre</span>
      </div>
    </section>

    <section data-section="back-office">
      <h4 class="mb-2 mt-0 text-[11px] font-medium tracking-[0.04em] text-secondary">Back office</h4>
      <div class="flex flex-col gap-0.5">
        @for (lien of liens; track lien.libelle) {
          @if (lien.cible) {
            <a
              [routerLink]="lien.cible"
              class="flex cursor-pointer items-center gap-2.5 rounded-[6px] px-1.5 py-2 text-left font-sans text-[12px] text-secondary no-underline transition-[background-color,color] duration-[120ms] ease-[var(--ease-hover)] hover:bg-elevated hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-teal-50)]"
            >
              <mg-icone [nom]="lien.icone" [taille]="14" [trait]="1.5" />
              {{ lien.libelle }}
            </a>
          } @else {
            <button
              type="button"
              aria-disabled="true"
              [attr.title]="indisponible"
              class="flex cursor-default items-center gap-2.5 rounded-[6px] border-0 bg-transparent px-1.5 py-2 text-left font-sans text-[12px] text-secondary transition-[background-color,color] duration-[120ms] ease-[var(--ease-hover)] hover:bg-elevated hover:text-primary"
            >
              <mg-icone [nom]="lien.icone" [taille]="14" [trait]="1.5" />
              {{ lien.libelle }}
            </button>
          }
        }
      </div>
    </section>
  `,
})
export class ReglagesComponent {
  /** L'id du fond courant (`MAP_STYLES[].id`). */
  readonly fond = input.required<string>();
  readonly choisirFond = output<string>();

  protected readonly fonds = MAP_STYLES;
  protected readonly modeles = [{ id: 'mistral', libelle: 'Mistral' }, { id: 'gemini', libelle: 'Gemini' }] as const;
  protected readonly liens = LIENS_BACK_OFFICE;
  protected readonly indisponible = DISPONIBLE_PROCHAINEMENT;
}
