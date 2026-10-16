import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PoisService } from './pois.service';
import { StreetViewComponent } from './street-view.component';

/** Largeur du tiroir (`MapPanel.tsx`, `min(420px, 92vw)`), en px : la boîte à outils s'en écarte (`ecartOutils`). */
export const LARGEUR_TIROIR_PANNEAU = 420;

/**
 * Le tiroir Street View d'un panneau cliqué — portage de `app/map/_components/MapPanel.tsx:291-339`.
 *
 * À droite de la carte, sur toute sa hauteur (`min(420px, 92vw)`, `z-index` 30), DANS le conteneur de la carte : la
 * vue Google est un `<iframe>` de la racine d'ombre, jamais un portail (`mg-street-view`, partagé avec la fiche d'un
 * emplacement OOH) ; clé absente ou vide, un bandeau NOMME la variable, comme React — jamais un cadre vide.
 *
 * Écarts voulus, de couleur : le bandeau d'alerte prend `--danger` (fond 10 %, bord 30 %, texte plein) au lieu du
 * rouge `#ef4444` et du rose `#fecaca` écrits en dur, illisibles sur fond clair.
 */
@Component({
  selector: 'mg-tiroir-panneau',
  imports: [StreetViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (pois.panneauSelectionne(); as p) {
      <aside data-tiroir-panneau aria-label="Street View"
        class="absolute bottom-0 right-0 top-0 z-30 flex max-w-[92vw] flex-col border-l-fin border-subtle bg-[var(--bg-primary)]" [style.width.px]="largeur">
        <div class="flex items-center justify-between gap-2 border-b-fin border-subtle px-[14px] py-[10px]">
          <div class="font-mono text-[10px] tracking-[0.06em] text-secondary">STREET_VIEW</div>
          <button type="button" data-fermer aria-label="Fermer" (click)="pois.panneauSelectionne.set(null)"
            class="size-7 cursor-pointer rounded-[4px] border-fin border-subtle bg-transparent text-[13px] leading-none text-tertiary transition-all duration-150">✕</button>
        </div>
        <div class="flex flex-col gap-[10px] overflow-y-auto p-[14px]">
          <div data-infos class="rounded-[4px] border-fin border-subtle bg-elevated p-[10px] font-mono text-[11px] leading-[1.6] text-primary">
            <div><span class="text-[9px] text-tertiary">ID </span>{{ p.id }}</div>
            <div><span class="text-[9px] text-tertiary">NOM </span>{{ p.nom }}</div>
            <div><span class="text-[9px] text-tertiary">FMT </span>{{ p.format || '—' }}</div>
            <div><span class="text-[9px] text-tertiary">SCR </span>{{ p.score != null ? p.score : '—' }}</div>
            <div><span class="text-[9px] text-tertiary">AUD </span>{{ audience() }}</div>
          </div>
          <mg-street-view [lat]="p.lat" [lng]="p.lng" [titre]="p.nom" [hauteur]="360" />
        </div>
      </aside>
    }
  `,
})
export class TiroirPanneauComponent {
  protected readonly pois = inject(PoisService);
  protected readonly largeur = LARGEUR_TIROIR_PANNEAU;

  protected readonly audience = computed(() => {
    const a = this.pois.panneauSelectionne()?.audience;
    return a != null ? Number(a).toLocaleString('fr-FR') : '—';
  });
}
