import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ConfigService } from '../../../core/config/config.service';

/** Le nom de la variable que le bandeau nomme quand la clé manque (`MapPanel.tsx:333-335`). */
export const VARIABLE_CLE_GOOGLE = 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY';

/** L'adresse Street View d'un point (`MapPanel.tsx:126-128`). */
export function adresseStreetView(cle: string, lat: number, lng: number): string {
  return `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(cle)}&location=${lat},${lng}&heading=0&pitch=0&fov=90`;
}

/**
 * La vue Street View d'un point, ou le bandeau qui NOMME la variable de la clé quand elle manque — jamais un cadre
 * vide. Partagée par le tiroir des POI (`mg-tiroir-panneau`) et la fiche d'un emplacement OOH
 * (`mg-fiche-emplacement-ooh`), qui restent deux composants distincts.
 *
 * La clé vient de `config.local.json` (`googleMapsKey`, écrit par `npm run config` depuis la variable
 * `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` de la racine). Le bandeau prend `--danger` (fond 10 %, bord 30 %, texte plein).
 */
@Component({
  selector: 'mg-street-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (adresse(); as src) {
      <iframe data-street-view [title]="'Street View ' + titre()" width="100%" [attr.height]="hauteur()" loading="lazy" allowfullscreen
        [src]="src" class="block rounded-[2px] border-fin border-subtle bg-elevated"></iframe>
    } @else {
      <div data-cle-manquante
        class="rounded-[2px] border-fin border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-[10px] font-mono text-[11px] text-danger">
        {{ variable }} manquante.
      </div>
    }
  `,
})
export class StreetViewComponent {
  readonly lat = input.required<number>();
  readonly lng = input.required<number>();
  readonly titre = input.required<string>();
  /** Hauteur de la vue, en px. */
  readonly hauteur = input.required<number>();

  private readonly config = inject(ConfigService);
  private readonly assainisseur = inject(DomSanitizer);
  protected readonly variable = VARIABLE_CLE_GOOGLE;

  /** L'adresse de l'iframe, de confiance : un domaine fixe, une clé de configuration et deux nombres. */
  protected readonly adresse = computed<SafeResourceUrl | null>(() => {
    const cle = this.config.valeur.googleMapsKey;
    if (!cle) return null;
    return this.assainisseur.bypassSecurityTrustResourceUrl(adresseStreetView(cle, this.lat(), this.lng()));
  });
}
