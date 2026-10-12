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
import { mentionArretsTronques } from '../couches/transport.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { RisqueCarteService } from '../etat/risque-carte.service';
import { LegendeBatailleComponent } from './legende-bataille.component';
import { LegendeScoreComponent } from './legende-score.component';
import { LegendeZonesProfilComponent } from './legende-zones-profil.component';
import { formaterNombre } from '../../../core/format/nombre';
import { LARGEUR_TRAIT_PPRT } from '../logique/pprt';
import { CARREAUX_INDICATEURS } from '../logique/carreaux/catalogue';
import { uniteIris } from '../logique/iris-echelle';
import { uniteNormalisee } from '../logique/carreaux/normalisation';
import { type DegradeId, libelleDegrade } from '../logique/degrades';
import {
  type Palier, degradeALegende, libelleRayonPoi, niveauxDuJeuSante, paliersCarreaux, paliersIris, texteComptePprt,
} from '../logique/legende';
import { ECART_RAIL_PANNEAU, LARGEUR_RAIL } from '../logique/navigation';
import {
  ABSTENTION_LEGEND, ABSTENTION_LEGEND_REPERES, CARREAUX_PALETTES, IRIS_PALETTES, LEGENDE_TMJA,
} from '../logique/palettes-donnees-carte';

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
  templateUrl: './legende-carte.component.html',
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
    return jeu ? niveauxDuJeuSante(jeu, this.sante.seuil()) : null;
  });

  /** Les catégories de la zone affichée, triées, avec leur compte et les rayons (`activeCats`, `page.tsx:843`). */
  protected readonly analyse = computed(() => {
    const zone = this.pois.zone();
    if (!zone?.categories) return null;
    const cats = Object.keys(zone.categories).sort();
    if (cats.length === 0) return null;
    const styles = this.pois.styles();
    return {
      categories: cats.map((cat) => ({ cat, n: zone.categories[cat], couleur: couleurPoi({ categorie: cat }, styles, zone) })),
      rayonZone: zone.rayon_metres ? (zone.rayon_metres / 1000).toFixed(1) : null,
      rayonPoi: libelleRayonPoi(zone.rayon_poi_metres),
      // Liste d'arrêts coupée par la route : dit sous le compte (défaut React corrigé, revue finale I-2b).
      tronque: mentionArretsTronques(zone),
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
    return {
      reglementaire,
      calculee: calculee ? formaterNombre(rayon) : null,
      compte: calculee ? texteComptePprt(this.risque.compte()) : null,
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
    return bornes ? paliersCarreaux(bornes, this.arretsCarreaux(), this.carreaux.seauSelectionne()) : null;
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
    return paliersIris(b, pal.stops);
  });

  protected choisirPalier(i: number): void {
    this.carreaux.seauSelectionne.set(this.carreaux.seauSelectionne() === i ? null : i);
  }
}
