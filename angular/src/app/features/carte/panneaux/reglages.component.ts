import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BasculeThemeComponent } from '../../../layout/bascule-theme.component';
import { DISPONIBLE_PROCHAINEMENT } from '../../../layout/navigation';
import { IconeComponent } from '../../../ui/icone/icone.component';
import type { NomIcone } from '../../../ui/icone/icones';

/**
 * Liens du back office — `BACK_OFFICE_LINKS` de `SettingsOverlay.tsx:83-95`, même ordre, mêmes libellés et icônes,
 * à un écart VOULU près (2026-10-10) : « Organisations (workspaces) » et « Utilisateurs » sont remplacés par UNE
 * entrée « Accès », la page Angular qui les réunit. `cible` : chemin RELATIF à la route `carte`, dont la page rend
 * le tiroir qui monte ce panneau (le préfixe appartient au shell) ; sans `cible`, l'entrée est inerte.
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
  // Page portée au lot 6 (T3-T4) : l'entrée suit la règle « inerte tant que la page n'est pas portée » (parcours T21).
  { libelle: 'Health check', icone: 'activite', cible: '../admin/health' },
];

/**
 * Le tiroir « Réglages » de la boîte à outils de la carte (T5) — portage de `components/map/overlays/SettingsOverlay.tsx`.
 *
 * Deux sections : Apparence, Back office. Le fond de carte a son propre outil (tiroir « Fond de carte », 2026-10-13,
 * `commun/choix-fond.component.ts`). « Modèle IA » (Mistral/Gemini) et « Vues sauvegardées », rendues INERTES jusque-là
 * (arbitrage B5), sont retirées le 2026-10-12, React et Angular ensemble (suppression de toute l'IA, lot 5) : la
 * première réglait le chat, la seconde ouvrait l'écran de sauvegarde qui ne vivait que dans le chat.
 * - **Apparence** reprend `mg-bascule-theme`, qui passe par `ThemeService.basculer()` seul (`ECRIRE_HTML`).
 * - **Back office** : « Accès » et « Health check » sont ACTIFS (liens relatifs vers `admin/acces` et `admin/health`) ;
 *   les huit autres restent INERTES (« Disponible prochainement », patron de la barre latérale) tant que leurs pages
 *   ne sont pas portées.
 */
@Component({
  selector: 'mg-reglages',
  imports: [BasculeThemeComponent, IconeComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-5 px-4 py-3 font-sans' },
  template: `
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
  protected readonly liens = LIENS_BACK_OFFICE;
  protected readonly indisponible = DISPONIBLE_PROCHAINEMENT;
}
