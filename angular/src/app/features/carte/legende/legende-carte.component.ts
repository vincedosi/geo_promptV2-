import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { CarreauxService } from '../couches/carreaux.service';
import { IrisService } from '../couches/iris.service';
import { couleurPoi } from '../couches/couche-pois';
import { PoisService } from '../couches/pois.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { formaterValeur, palierEchelle, versValeurReelle } from '../logique/carreaux/bornes';
import { CARREAUX_INDICATEURS } from '../logique/carreaux/catalogue';
import { bornesInternes } from '../logique/carreaux/expressions';
import { echelleDe, uniteIris } from '../logique/iris-echelle';
import { uniteNormalisee } from '../logique/carreaux/normalisation';
import { type DegradeId, libelleDegrade } from '../logique/degrades';
import { ECART_RAIL_PANNEAU, LARGEUR_RAIL } from '../logique/navigation';
import { CARREAUX_PALETTES, IRIS_PALETTES } from '../logique/palettes-donnees-carte';

/**
 * Le dégradé actif a-t-il un bloc dans CETTE légende ? — `degradeALegende` de `LegendeCarte.tsx:150-178`, source
 * UNIQUE de la question : la boîte ne s'ouvre jamais vide. Le `switch` est EXHAUSTIF (`never`) : un dégradé ajouté à
 * `DegradeId` sans décision ici fait échouer la compilation.
 *
 * Carreaux (T6) et IRIS (T7) sont portés. Chaque tâche de couche passe SON cas à `true` en ajoutant son bloc :
 * indicateurs civiques et santé (T10), météo (T11). `score`, `diffusion` et `zones-risque` portent leur
 * propre légende, comme React.
 */
export function degradeALegende(d: DegradeId | null): boolean {
  if (!d) return false;
  switch (d) {
    case 'carreaux':
    case 'iris':
      return true;
    case 'meteo':
    case 'civic-indicateurs':
    case 'civic-sante':
    case 'campagne-impressions':
      return false; // blocs à venir (T10, T11 ; campagne : lot 5)
    case 'score':
    case 'diffusion':
    case 'zones-risque':
      return false;
    default: {
      const exhaustif: never = d;
      return exhaustif;
    }
  }
}

/** Un palier de la légende des carreaux : sa teinte, son libellé, s'il est sélectionné. */
interface Palier {
  readonly index: number;
  readonly couleur: string;
  readonly libelle: string;
  readonly choisi: boolean;
}

/**
 * La légende UNIQUE de la carte — portage de `components/map/LegendeCarte.tsx` (cadre + cas `carreaux`).
 *
 * En bas à gauche, à `LARGEUR_RAIL + ECART_RAIL_PANNEAU` du bord, `z-index` 35 : sous les panneaux (40). `absolute`
 * dans l'hôte de la page (B1). Écart voulu : ni flou (`backdrop-filter`) ni ombre — « flat total ».
 *
 * Le bloc des carreaux est cliquable par palier : il pose `seauSelectionne`, et la couche filtre son opacité par le
 * MÊME découpage (`palierEchelle`) — une tranche cliquée désigne exactement les carreaux qu'elle affiche. Le fond d'un
 * palier choisi est sa couleur de DONNÉE à 13 % (`${couleur}22` de React).
 *
 * T8 ajoute, dans l'ordre de React (`LegendeCarte.tsx:640-645`), le bloc « Analyse spatiale » AVANT le dégradé — les
 * catégories des points affichés, avec leur compte — et le bloc « Figurés » APRÈS — les types de POI choisis ; TMJA et
 * radio y ajouteront leur ligne (T9). Écart, défaut corrigé : la pastille d'une catégorie prend la couleur de son
 * ÉPINGLE quand l'utilisateur en a choisi une ; React gardait la couleur de catégorie, et la légende contredisait la carte.
 */
@Component({
  selector: 'mg-legende-carte',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (visible()) {
      <div
        data-legende
        class="absolute bottom-3 z-[35] min-w-[180px] max-w-[240px] rounded-[8px] border-fin border-default bg-card-overlay"
        [style.left.px]="gauche"
      >
        <button
          type="button"
          [attr.aria-expanded]="ouvert()"
          (click)="ouvert.set(!ouvert())"
          class="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-[10px] py-2"
        >
          <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-[var(--brand-teal)]"></span>
          <span class="flex-1 text-left text-[11px] font-medium text-primary">Légende</span>
          <mg-icone [nom]="ouvert() ? 'chevron-bas' : 'chevron-droite'" [taille]="14" class="shrink-0 text-tertiary" />
        </button>
        @if (ouvert()) {
          <div class="flex flex-col gap-[10px] px-[10px] pb-[10px]">
            @if (analyse(); as a) {
              <!-- BlocAnalyse (LegendeCarte.tsx:332-376) : les catégories des points affichés. -->
              <div data-bloc="analyse">
                <div class="mb-1 text-[11px] font-medium text-secondary">Analyse spatiale</div>
                <div class="flex flex-col gap-[5px]">
                  @for (c of a.categories; track c.cat) {
                    <div [attr.data-categorie]="c.cat" class="flex items-center gap-1.5">
                      <span class="size-[10px] shrink-0 rounded-full" [style.background]="c.couleur"></span>
                      <span class="font-mono text-[10px] text-tertiary">{{ c.cat }} <span class="text-tertiary">({{ c.n }})</span></span>
                    </div>
                  }
                  @if (a.rayonZone) {
                    <div class="mt-[3px] flex items-center gap-1.5 border-t border-subtle pt-[5px]">
                      <span class="size-[9px] shrink-0 rounded-[1px] border-[1.5px] border-dashed border-hover bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"></span>
                      <span class="font-mono text-[10px] text-tertiary">Zone {{ a.rayonZone }} km</span>
                    </div>
                  }
                  @if (a.rayonPoi) {
                    <div class="mt-[3px] flex items-center gap-1.5 border-t border-subtle pt-[5px]">
                      <span class="size-[9px] shrink-0 rounded-full border-[1.5px] border-solid border-success bg-[color-mix(in_srgb,var(--success)_12%,transparent)]"></span>
                      <span class="font-mono text-[10px] text-tertiary">R={{ a.rayonPoi }}/POI</span>
                    </div>
                  }
                </div>
              </div>
            }
            @switch (degradeActif()) {
              @case ('carreaux') {
                <div data-bloc="carreaux">
                  <div class="mb-1 text-[11px] font-medium text-secondary">
                    {{ titreCarreaux }}@if (uniteCarreaux()) {<span class="font-mono font-normal"> · {{ uniteCarreaux() }}</span>}
                  </div>
                  @if (paliers(); as ps) {
                    <div class="flex flex-col gap-px">
                      @for (p of ps; track p.index) {
                        <button
                          type="button"
                          [attr.data-palier]="p.index"
                          [attr.aria-pressed]="p.choisi"
                          (click)="choisirPalier(p.index)"
                          class="flex w-full cursor-pointer items-center gap-1.5 rounded-[2px] border-fin border-solid px-[3px] py-px text-left"
                          [style.background]="p.choisi ? p.couleur + '22' : 'none'"
                          [style.border-color]="p.choisi ? p.couleur : 'transparent'"
                        >
                          <span class="size-[10px] shrink-0 rounded-[2px]" [style.background]="p.couleur"></span>
                          <span class="flex-1 font-mono text-[10px]" [class.text-primary]="p.choisi" [class.text-tertiary]="!p.choisi">{{ p.libelle }}</span>
                        </button>
                      }
                    </div>
                  } @else {
                    <div class="flex items-center gap-0.5">
                      @for (s of arretsCarreaux(); track $index) {
                        <span class="inline-block h-[7px] flex-1 rounded-[1px]" [style.background]="s"></span>
                      }
                    </div>
                  }
                </div>
              }
              @case ('iris') {
                <!-- LegendeCarte.tsx:225-256 : les mêmes frontières que la peinture (bornesInternes), non cliquables. -->
                <div data-bloc="iris">
                  <div class="mb-1 text-[11px] font-medium text-secondary">
                    {{ titreIris }}@if (uniteIrisAffichee(); as u) {<span class="font-mono font-normal"> · {{ u }}</span>}
                  </div>
                  @if (paliersIris(); as ps) {
                    <div class="flex flex-col gap-px">
                      @for (p of ps; track $index) {
                        <div data-palier-iris class="flex items-center gap-1.5">
                          <span class="size-[10px] shrink-0 rounded-[2px]" [style.background]="p.couleur"></span>
                          <span class="font-mono text-[10px] text-tertiary">{{ p.libelle }}</span>
                        </div>
                      }
                    </div>
                  } @else if (iris.bornesEnErreur()) {
                    <div class="text-[10px] text-warning">! Bornes indisponibles</div>
                  } @else if (iris.bornes() === undefined) {
                    <div class="text-[10px] text-tertiary">Chargement...</div>
                  } @else {
                    <div class="text-[10px] text-warning">! Aucune donnée pour cet indicateur</div>
                  }
                </div>
              }
            }
            @if (figuresPoi().length > 0) {
              <!-- BlocFigures (LegendeCarte.tsx:466-523) : les types de POI choisis ; TMJA et radio arrivent avec T9. -->
              <div data-bloc="figures">
                <div class="mb-1 text-[11px] font-medium text-secondary">Figurés</div>
                <div class="flex flex-col gap-1">
                  @for (f of figuresPoi(); track f.cat) {
                    <div [attr.data-figure]="f.cat" class="flex items-center gap-1.5">
                      <span class="size-2 shrink-0 rounded-full" [style.background]="f.couleur"></span>
                      <span class="font-mono text-[10px] text-tertiary">{{ f.cat }}</span>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class LegendeCarteComponent {
  /** Le dégradé actif (`EtatCarteService.degradeActif`). */
  readonly degradeActif = input.required<DegradeId | null>();

  private readonly carreaux = inject(CarreauxService);
  protected readonly iris = inject(IrisService);
  protected readonly titreIris = libelleDegrade('iris');
  protected readonly gauche = LARGEUR_RAIL + ECART_RAIL_PANNEAU;
  protected readonly ouvert = signal(true);
  protected readonly titreCarreaux = libelleDegrade('carreaux');

  private readonly pois = inject(PoisService);
  private readonly etat = inject(EtatCarteService);

  /** Les catégories de la zone affichée, triées, avec leur compte et les rayons (`activeCats`, `page.tsx:843`). */
  protected readonly analyse = computed(() => {
    const zone = this.pois.zone();
    if (!zone?.categories) return null;
    const cats = Object.keys(zone.categories).sort();
    if (cats.length === 0) return null;
    const styles = this.pois.styles();
    const rPoi = zone.rayon_poi_metres;
    return {
      categories: cats.map((cat) => ({ cat, n: zone.categories[cat], couleur: couleurPoi({ categorie: cat }, styles, zone) })),
      rayonZone: zone.rayon_metres ? (zone.rayon_metres / 1000).toFixed(1) : null,
      rayonPoi: rPoi ? (rPoi >= 1000 ? `${(rPoi / 1000).toFixed(1)}km` : `${rPoi}m`) : null,
    };
  });
  /** Les types de POI choisis (`selectedPOI`), dans la couleur de leur épingle. */
  protected readonly figuresPoi = computed(() => {
    const styles = this.pois.styles();
    return this.etat.poiSelectionnes().map((cat) => ({ cat, couleur: couleurPoi({ categorie: cat }, styles, {}) }));
  });

  /** La boîte ne s'ouvre que si un bloc rendra quelque chose (`LegendeCarte.tsx:596-606`) — jamais vide. */
  protected readonly visible = computed(
    () => degradeALegende(this.degradeActif()) || this.analyse() !== null || this.figuresPoi().length > 0,
  );

  protected readonly uniteCarreaux = computed(() => {
    const ind = this.carreaux.indicateur();
    return uniteNormalisee(ind, CARREAUX_INDICATEURS.find((i) => i.id === ind)?.unit ?? '');
  });
  protected readonly arretsCarreaux = computed(
    () => (CARREAUX_PALETTES.find((p) => p.id === this.carreaux.palette()) ?? CARREAUX_PALETTES[0]).stops,
  );
  /** Les six paliers (`LegendeCarte.tsx:198-214`) ; `null` sans bornes : la rampe seule. */
  protected readonly paliers = computed<Palier[] | null>(() => {
    const bornes = this.carreaux.bornes();
    if (!bornes) return null;
    const choisi = this.carreaux.seauSelectionne();
    return this.arretsCarreaux().map((couleur, i) => {
      const palier = palierEchelle(bornes, i, 6);
      const min = versValeurReelle(palier.min);
      const max = versValeurReelle(palier.max);
      return {
        index: i, couleur, choisi: choisi === i,
        libelle: i === 5 ? `≥ ${formaterValeur(min)}` : `${formaterValeur(min)} – ${formaterValeur(max)}`,
      };
    });
  });

  /** `uniteIris(classe) || '%'` (`LegendeCarte.tsx:232`) ; rien tant que les bornes manquent. */
  protected readonly uniteIrisAffichee = computed(() => {
    const b = this.iris.bornes();
    return b ? uniteIris(b.classe) || '%' : null;
  });
  /** Les six lignes « ≤ a », « a – b », « ≥ z » de `LegendeCarte.tsx:236-248` ; `null` sans bornes. */
  protected readonly paliersIris = computed(() => {
    const b = this.iris.bornes();
    if (!b) return null;
    const pal = IRIS_PALETTES.find((p) => p.id === this.iris.palette()) ?? IRIS_PALETTES[0];
    const f = bornesInternes(echelleDe(b), pal.stops.length).map(versValeurReelle);
    const n = pal.stops.length;
    return pal.stops.map((couleur, i) => ({
      couleur,
      libelle: i === 0 ? `≤ ${formaterValeur(f[0])}`
        : i === n - 1 ? `≥ ${formaterValeur(f[f.length - 1])}`
        : `${formaterValeur(f[i - 1])} – ${formaterValeur(f[i])}`,
    }));
  });

  protected choisirPalier(i: number): void {
    this.carreaux.seauSelectionne.set(this.carreaux.seauSelectionne() === i ? null : i);
  }
}
