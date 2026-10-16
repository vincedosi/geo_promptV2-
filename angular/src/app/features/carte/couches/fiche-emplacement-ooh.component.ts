import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ConfigService } from '../../../core/config/config.service';
import { formaterNombre } from '../../../core/format/nombre';
import { LIBELLES_METHODE, LIBELLES_QUALITE, donneesRegie, formaterScore } from '../logique/campagnes-ooh';
import { CampagneOohService } from './campagne-ooh.service';
import { LARGEUR_TIROIR_PANNEAU, VARIABLE_CLE_GOOGLE, adresseStreetView } from './tiroir-panneau.component';

/** Une ligne de la fiche : libellé, valeur, et si la valeur est un nombre (JetBrains Mono). */
interface ChampFiche {
  libelle: string;
  valeur: string;
  nombre?: boolean;
}

/**
 * La fiche d'un emplacement d'une campagne OOH, ouverte au clic sur son point (spec 2026-10-16-ooh-campagnes § 6.4) :
 * nom du lieu, adresse, ville, CP, réseau, régie, type de lieu, écrans et formats, contacts, qualité de la
 * géolocalisation (qualité, méthode, libellé reconnu, score), campagne et ligne ; Street View conservé ; puis
 * « Données de la régie », replié, qui montre TOUTES les cellules de la ligne d'origine (`metadata`).
 *
 * Même place que le tiroir Street View des POI (`mg-tiroir-panneau`, 420 px à droite, z-30) : l'un ferme l'autre
 * (`CampagneOohService`). Les libellés sont en sentence case, sans les étiquettes mono en capitales du tiroir React.
 */
@Component({
  selector: 'mg-fiche-emplacement-ooh',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (service.emplacementSelectionne(); as e) {
      <aside data-fiche-emplacement-ooh aria-label="Emplacement OOH"
        class="absolute bottom-0 right-0 top-0 z-30 flex max-w-[92vw] flex-col border-l-fin border-subtle bg-[var(--bg-primary)]" [style.width.px]="largeur">
        <div class="flex items-center justify-between gap-2 border-b-fin border-subtle px-[14px] py-[10px]">
          <div data-titre class="text-[13px] font-medium text-primary">{{ e.properties.nom_lieu || 'Emplacement OOH' }}</div>
          <button type="button" data-fermer aria-label="Fermer" (click)="service.emplacementSelectionne.set(null)"
            class="size-7 shrink-0 cursor-pointer rounded-[4px] border-fin border-subtle bg-transparent text-[13px] leading-none text-tertiary hover:text-primary">✕</button>
        </div>
        <div class="flex flex-col gap-[10px] overflow-y-auto p-[14px]">
          <dl data-infos class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
            @for (c of champs(); track c.libelle) {
              <dt class="text-tertiary">{{ c.libelle }}</dt>
              <dd class="m-0 break-words text-secondary" [class.font-mono]="c.nombre">{{ c.valeur }}</dd>
            }
          </dl>
          @if (adresse(); as src) {
            <iframe data-street-view [title]="'Street View ' + (e.properties.nom_lieu ?? '')" width="100%" height="300" loading="lazy" allowfullscreen
              [src]="src" class="block rounded-[2px] border-fin border-subtle bg-elevated"></iframe>
          } @else {
            <div data-cle-manquante
              class="rounded-[2px] border-fin border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-[10px] font-mono text-[11px] text-danger">
              {{ variable }} manquante.
            </div>
          }
          <details data-donnees-regie class="rounded-[6px] border-fin border-subtle p-2.5 text-[11px]">
            <summary class="cursor-pointer text-secondary">Données de la régie</summary>
            @for (g of regie(); track g.titre) {
              <div class="mt-2 text-tertiary">{{ g.titre }}</div>
              <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono">
                @for (c of g.cellules; track c[0]) {
                  <dt class="text-tertiary">{{ c[0] }}</dt>
                  <dd class="m-0 break-words text-secondary">{{ c[1] }}</dd>
                }
              </dl>
            } @empty {
              <div class="mt-2 text-tertiary">Aucune donnée d’origine conservée.</div>
            }
          </details>
        </div>
      </aside>
    }
  `,
})
export class FicheEmplacementOohComponent {
  protected readonly service = inject(CampagneOohService);
  private readonly config = inject(ConfigService);
  private readonly assainisseur = inject(DomSanitizer);
  protected readonly largeur = LARGEUR_TIROIR_PANNEAU;
  protected readonly variable = VARIABLE_CLE_GOOGLE;

  protected readonly champs = computed<ChampFiche[]>(() => {
    const e = this.service.emplacementSelectionne();
    if (!e) return [];
    const p = e.properties;
    const detail = this.service.detail();
    const ligne = detail?.lignes.find((l) => l.id === p.ligne_id);
    const champs: ChampFiche[] = [
      { libelle: 'Adresse', valeur: p.adresse ?? '—' },
      { libelle: 'Ville', valeur: [p.code_postal, p.ville].filter((v) => !!v).join(' ') || '—' },
      { libelle: 'Réseau', valeur: p.reseau ?? '—' },
      { libelle: 'Régie', valeur: p.regie ?? '—' },
      { libelle: 'Type de lieu', valeur: p.type_lieu ?? '—' },
      { libelle: 'Écrans', valeur: formaterNombre(p.nb_ecrans), nombre: true },
      { libelle: 'Formats', valeur: p.formats && p.formats.length > 0 ? p.formats.join(', ') : '—' },
    ];
    if (p.contacts_semaine !== null) champs.push({ libelle: 'Contacts / semaine', valeur: formaterNombre(p.contacts_semaine), nombre: true });
    if (p.contacts_18_25_semaine !== null) {
      champs.push({ libelle: 'Contacts 18-25 / semaine', valeur: formaterNombre(p.contacts_18_25_semaine), nombre: true });
    }
    champs.push(
      { libelle: 'Géolocalisation', valeur: `${LIBELLES_QUALITE[p.geoloc_qualite ?? 'sure']} · ${p.geoloc_methode ? LIBELLES_METHODE[p.geoloc_methode] : '—'}` },
      { libelle: 'Reconnu', valeur: p.geoloc_libelle ?? '—' },
      { libelle: 'Score', valeur: formaterScore(p.geoloc_score), nombre: true },
      { libelle: 'Campagne', valeur: detail?.campagne.nom ?? '—' },
      { libelle: 'Ligne', valeur: ligne ? `${ligne.regie ?? '—'}${ligne.reseau ? ` · ${ligne.reseau}` : ligne.territoire ? ` · ${ligne.territoire}` : ''}` : '—' },
    );
    return champs;
  });

  protected readonly regie = computed(() => donneesRegie(this.service.emplacementSelectionne()?.properties.metadata ?? null));

  /** L'adresse de l'iframe, de confiance : un domaine fixe, une clé de configuration et deux nombres. */
  protected readonly adresse = computed<SafeResourceUrl | null>(() => {
    const e = this.service.emplacementSelectionne();
    const cle = this.config.valeur.googleMapsKey;
    if (!e || !cle) return null;
    const [lng, lat] = e.geometry.coordinates;
    return this.assainisseur.bypassSecurityTrustResourceUrl(adresseStreetView(cle, lat, lng));
  });
}
