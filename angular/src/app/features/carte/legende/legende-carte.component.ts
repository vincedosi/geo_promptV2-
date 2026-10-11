import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { CarreauxService } from '../couches/carreaux.service';
import { IrisService } from '../couches/iris.service';
import { MeteoService } from '../couches/meteo.service';
import { couleurPoi } from '../couches/couche-pois';
import { PoisService } from '../couches/pois.service';
import { RadioService } from '../couches/radio.service';
import { SanteService } from '../couches/sante.service';
import { TmjaService } from '../couches/tmja.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { RisqueCarteService } from '../etat/risque-carte.service';
import { LegendeBatailleComponent } from './legende-bataille.component';
import { LegendeScoreComponent } from './legende-score.component';
import { LegendeZonesProfilComponent } from './legende-zones-profil.component';
import { formaterNombre } from '../../../core/format/nombre';
import { LARGEUR_TRAIT_PPRT } from '../logique/pprt';
import { formaterValeur, palierEchelle, versValeurReelle } from '../logique/carreaux/bornes';
import { CARREAUX_INDICATEURS } from '../logique/carreaux/catalogue';
import { bornesInternes } from '../logique/carreaux/expressions';
import { echelleDe, uniteIris } from '../logique/iris-echelle';
import { uniteNormalisee } from '../logique/carreaux/normalisation';
import { type DegradeId, libelleDegrade } from '../logique/degrades';
import { ECART_RAIL_PANNEAU, LARGEUR_RAIL } from '../logique/navigation';
import {
  ABSTENTION_LEGEND, ABSTENTION_LEGEND_REPERES, CARREAUX_PALETTES, IRIS_PALETTES, JETONS_NIVEAUX_SANTE, LEGENDE_TMJA,
} from '../logique/palettes-donnees-carte';
import { ATMO_LEVEL_LABELS, POLLEN_LEVEL_LABELS } from '../logique/sante';

/**
 * Le dégradé actif a-t-il un bloc dans CETTE légende ? — `degradeALegende` de `LegendeCarte.tsx:150-178`, source
 * UNIQUE de la question : la boîte ne s'ouvre jamais vide. Le `switch` est EXHAUSTIF (`never`) : un dégradé ajouté à
 * `DegradeId` sans décision ici fait échouer la compilation.
 *
 * Carreaux (T6), IRIS (T7), indicateurs civiques et santé (T10), météo (T11) sont portés. Côté React, `civic-indicateurs` et `civic-sante` vérifiaient aussi la
 * variable / le jeu : ici, le dégradé n'est réclamé QUE par `choisir(code)` / `choisirJeu(jeu)` non nuls, et l'éviction
 * remet la variable à `null` — l'un ne va pas sans l'autre. `score` et `diffusion` portent leur propre légende, comme
 * React : celle du score est `mg-legende-score` (T18), montée ici mais posée en bas à droite. `zones-risque` a ici SON bloc (T13, `mg-legende-zones-profil`) : React la renvoyait à `ZonesRisqueLayer`, qui
 * n'en dessinait aucune — défaut corrigé.
 */
export function degradeALegende(d: DegradeId | null): boolean {
  if (!d) return false;
  switch (d) {
    case 'carreaux':
    case 'iris':
    case 'civic-indicateurs':
    case 'civic-sante':
    case 'meteo':
    case 'zones-risque':
      return true;
    case 'campagne-impressions':
      return false; // bloc à venir (lot 5)
    case 'score':
    case 'diffusion':
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
 * catégories des points affichés, avec leur compte — et le bloc « Figurés » APRÈS — les types de POI choisis. T9 y
 * ajoute les quatre paliers du flux routier (le palier faible estompé quand il est masqué) et la ligne des émetteurs
 * radio. Écarts, défauts corrigés : la pastille d'une catégorie prend la couleur de son ÉPINGLE quand l'utilisateur en a
 * choisi une ; les paliers TMJA prennent les couleurs de la CARTE (React affichait `#e5a00d` pour un palier peint
 * `#f97316`) — dans les deux cas, React laissait la légende contredire la carte.
 */
@Component({
  selector: 'mg-legende-carte',
  imports: [IconeComponent, LegendeBatailleComponent, LegendeScoreComponent, LegendeZonesProfilComponent],
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
                  <!-- LegendeCarte.tsx:408-460 : la bataille et sa réglette de palier maximum (T17). -->
                  <mg-legende-bataille />
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
              @case ('civic-indicateurs') {
                <!-- LegendeCarte.tsx:259-273 : le dégradé pondéré et ses trois repères. -->
                <div data-bloc="civique">
                  <div class="mb-1 text-[11px] font-medium text-secondary">{{ titreCivique }}</div>
                  <div class="flex h-1.5 overflow-hidden rounded-[3px]">
                    @for (p of legendeAbstention; track $index) {
                      <div data-palier-civique [style.flex]="p[1]" [style.background]="p[0]"></div>
                    }
                  </div>
                  <div class="mt-0.5 flex justify-between">
                    @for (r of reperesAbstention; track r) {
                      <span class="font-mono text-[10px] text-tertiary">{{ r }}</span>
                    }
                  </div>
                </div>
              }
              @case ('civic-sante') {
                <!-- LegendeCarte.tsx:275-293 : six niveaux sur deux colonnes, estompés sous le seuil. -->
                @if (niveauxSante(); as ns) {
                  <div data-bloc="sante">
                    <div class="mb-1 text-[11px] font-medium text-secondary">{{ ns.titre }}</div>
                    <div class="grid grid-cols-2 gap-x-[10px] gap-y-1">
                      @for (n of ns.niveaux; track n.niveau) {
                        <div data-niveau-sante class="flex items-center gap-1.5" [style.opacity]="n.estompe ? 0.3 : 1">
                          <span class="size-[10px] shrink-0 rounded-[2px]" [style.background]="n.couleur"></span>
                          <span class="font-mono text-[10px] text-tertiary">{{ n.libelle }}</span>
                        </div>
                      }
                    </div>
                  </div>
                }
              }
              @case ('meteo') {
                <!-- LegendeCarte.tsx:297-304 : le titre et la variable affichée — React ne montre pas la rampe. -->
                <div data-bloc="meteo">
                  <div class="mb-1 text-[11px] font-medium text-secondary">{{ titreMeteo }}</div>
                  <div class="font-mono text-[10px] text-tertiary">{{ meteo.libelle() ?? 'Couche active' }}</div>
                </div>
              }
              @case ('zones-risque') {
                <mg-legende-zones-profil />
              }
            }
            @if (zonesRisque(); as z) {
              <!-- BlocZonesRisque (LegendeCarte.tsx:534-590) : laquelle des deux zones vient de l'État, laquelle est calculée. -->
              <div data-bloc="zones-risque">
                <div class="mb-1 text-[11px] font-medium text-secondary">Zones à risque</div>
                <div class="flex flex-col gap-[5px]">
                  @if (z.reglementaire) {
                    <div data-zone-reglementaire class="flex items-center gap-1.5">
                      <span aria-hidden="true" class="h-0 w-4 shrink-0" [style.border-top]="tracePprt"></span>
                      <span class="text-[10px] text-secondary">Périmètre PPRT — réglementaire</span>
                    </div>
                  }
                  @if (z.calculee; as rayon) {
                    <div data-zone-calculee class="flex items-center gap-1.5">
                      <span aria-hidden="true" class="h-0 w-4 shrink-0 border-t border-dashed border-t-[var(--text-secondary)]"></span>
                      <span class="text-[10px] text-secondary">Rayon {{ rayon }} m — calculé</span>
                    </div>
                  }
                  @if (z.compte; as c) {
                    <div data-zone-compte class="font-mono text-[10px] leading-[1.4] text-tertiary">{{ c }}</div>
                  }
                  <div class="font-mono text-[10px] leading-[1.4] text-tertiary">Trait plein = publié par l’État · tireté = calculé par dentsu.explore</div>
                </div>
              </div>
            }
            @if (figuresVisibles()) {
              <!-- BlocFigures (LegendeCarte.tsx:466-523) : les types de POI choisis, les paliers TMJA, les émetteurs radio. -->
              <div data-bloc="figures">
                <div class="mb-1 text-[11px] font-medium text-secondary">Figurés</div>
                <div class="flex flex-col gap-1">
                  @for (f of figuresPoi(); track f.cat) {
                    <div [attr.data-figure]="f.cat" class="flex items-center gap-1.5">
                      <span class="size-2 shrink-0 rounded-full" [style.background]="f.couleur"></span>
                      <span class="font-mono text-[10px] text-tertiary">{{ f.cat }}</span>
                    </div>
                  }
                  @if (tmja.visible()) {
                    @for (p of paliersTmja; track p.libelle) {
                      <div data-figure-tmja class="flex items-center gap-1.5" [style.opacity]="p.faible && tmja.masquerFaible() ? 0.35 : 1">
                        <span class="h-[3px] w-[14px] shrink-0 rounded-[2px]" [style.background]="p.couleur"></span>
                        <span class="font-mono text-[10px] text-tertiary">{{ p.libelle }}</span>
                      </div>
                    }
                  }
                  @if (radio.visible()) {
                    <div data-figure-radio class="flex items-center gap-1.5">
                      <span class="size-2 shrink-0 rounded-full" [style.background]="radio.couleurCouverture()"></span>
                      <span class="font-mono text-[10px] text-tertiary">Émetteurs radio</span>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
    }
    <!-- ScoreMapLayer.tsx:241-303 : la carte du score, à part, en bas à droite (elle ne s'ouvre pas dans cette boîte). -->
    <mg-legende-score />
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
  protected readonly tmja = inject(TmjaService);
  protected readonly radio = inject(RadioService);
  protected readonly paliersTmja = LEGENDE_TMJA;
  private readonly sante = inject(SanteService);
  protected readonly titreCivique = libelleDegrade('civic-indicateurs');
  protected readonly meteo = inject(MeteoService);
  protected readonly titreMeteo = libelleDegrade('meteo');
  protected readonly legendeAbstention = ABSTENTION_LEGEND;
  protected readonly reperesAbstention = ABSTENTION_LEGEND_REPERES;
  /** Les six niveaux du jeu affiché : `var(--pollen-level-N)` / `var(--atmo-level-N)` (DOM : le jeton est résolu). */
  protected readonly niveauxSante = computed(() => {
    const jeu = this.sante.jeu();
    if (!jeu) return null;
    const libelles: Record<number, string> = jeu === 'pollen' ? POLLEN_LEVEL_LABELS : ATMO_LEVEL_LABELS;
    const seuil = this.sante.seuil();
    return {
      titre: jeu === 'pollen' ? 'Indice pollen' : 'Indice ATMO',
      niveaux: ([1, 2, 3, 4, 5, 6] as const).map((niveau) => ({
        niveau,
        couleur: `var(--${JETONS_NIVEAUX_SANTE[jeu][niveau]})`,
        libelle: `${niveau} — ${libelles[niveau]}`,
        estompe: seuil > 0 && niveau < seuil,
      })),
    };
  });

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

  private readonly risque = inject(RisqueCarteService);
  protected readonly tracePprt = `${LARGEUR_TRAIT_PPRT}px solid var(--pprt-contour)`;
  /**
   * Le bloc « Zones à risque » (`BlocZonesRisque`, `LegendeCarte.tsx:534-590`) : présent si une zone calculée
   * (couche allumée ET rayon) ou les périmètres PPRT sont affichés ; « N sites sur M ont un périmètre PPRT » avec la zone
   * calculée — la part de ce qu'on voit qui repose sur une donnée de l'État. `null` : aucun des deux.
   */
  protected readonly zonesRisque = computed(() => {
    const rayon = this.risque.rayonM();
    const calculee = this.risque.actif() && rayon > 0;
    const reglementaire = this.risque.pprtActif();
    if (!calculee && !reglementaire) return null;
    const c = this.risque.compte();
    return {
      reglementaire,
      calculee: calculee ? formaterNombre(rayon) : null,
      compte: calculee && c && c.rendus > 0
        ? `${formaterNombre(c.avecPprt)} site${c.avecPprt > 1 ? 's' : ''} sur ${formaterNombre(c.rendus)} ${c.avecPprt > 1 ? 'ont' : 'a'} un périmètre PPRT`
        : null,
    };
  });

  /** `poiCount > 0 || tmjaVisible || radioVisible` (`LegendeCarte.tsx:599`). */
  protected readonly figuresVisibles = computed(
    () => this.figuresPoi().length > 0 || this.tmja.visible() || this.radio.visible(),
  );

  /** La boîte ne s'ouvre que si un bloc rendra quelque chose (`LegendeCarte.tsx:596-606`) — jamais vide. */
  protected readonly visible = computed(
    () => degradeALegende(this.degradeActif()) || this.analyse() !== null || this.figuresVisibles() || this.zonesRisque() !== null,
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
