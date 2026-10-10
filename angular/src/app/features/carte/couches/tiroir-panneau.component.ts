import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ConfigService } from '../../../core/config/config.service';
import { PoisService } from './pois.service';

/** Le nom de la variable que le bandeau nomme quand la clé manque (`MapPanel.tsx:333-335`). */
export const VARIABLE_CLE_GOOGLE = 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY';

/** L'adresse Street View d'un point (`MapPanel.tsx:126-128`). */
export function adresseStreetView(cle: string, lat: number, lng: number): string {
  return `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(cle)}&location=${lat},${lng}&heading=0&pitch=0&fov=90`;
}

/**
 * Le tiroir Street View d'un panneau cliqué — portage de `app/copilote/_components/MapPanel.tsx:291-339`.
 *
 * À droite de la carte, sur toute sa hauteur (`min(420px, 92vw)`, `z-index` 30), DANS le conteneur de la carte : la
 * vue Google est un `<iframe>` de la racine d'ombre, jamais un portail. La clé vient de `config.local.json`
 * (`googleMapsKey`, écrit par `npm run config` depuis la variable `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` de la racine) ;
 * absente ou vide, un bandeau NOMME la variable, comme React — jamais un cadre vide.
 *
 * Écarts voulus, de couleur : le bandeau d'alerte prend `--danger` (fond 10 %, bord 30 %, texte plein) au lieu du
 * rouge `#ef4444` et du rose `#fecaca` écrits en dur, illisibles sur fond clair.
 */
@Component({
  selector: 'mg-tiroir-panneau',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (pois.panneauSelectionne(); as p) {
      <aside data-tiroir-panneau aria-label="Street View"
        class="absolute bottom-0 right-0 top-0 z-30 flex w-[min(420px,92vw)] flex-col border-l border-subtle bg-[var(--bg-primary)]">
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
          @if (adresse(); as src) {
            <iframe data-street-view [title]="'Street View ' + p.nom" width="100%" height="360" loading="lazy" allowfullscreen
              [src]="src" class="block rounded-[2px] border border-subtle bg-elevated"></iframe>
          } @else {
            <div data-cle-manquante
              class="rounded-[2px] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-[10px] font-mono text-[11px] text-danger">
              {{ variable }} manquante.
            </div>
          }
        </div>
      </aside>
    }
  `,
})
export class TiroirPanneauComponent {
  protected readonly pois = inject(PoisService);
  private readonly config = inject(ConfigService);
  private readonly assainisseur = inject(DomSanitizer);
  protected readonly variable = VARIABLE_CLE_GOOGLE;

  protected readonly audience = computed(() => {
    const a = this.pois.panneauSelectionne()?.audience;
    return a != null ? Number(a).toLocaleString('fr-FR') : '—';
  });

  /** L'adresse de l'iframe, de confiance : un domaine fixe, une clé de configuration et deux nombres. */
  protected readonly adresse = computed<SafeResourceUrl | null>(() => {
    const p = this.pois.panneauSelectionne();
    const cle = this.config.valeur.googleMapsKey;
    if (!p || !cle) return null;
    return this.assainisseur.bypassSecurityTrustResourceUrl(adresseStreetView(cle, p.lat, p.lng));
  });
}
