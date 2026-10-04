import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import type maplibregl from 'maplibre-gl';
import type { Subscription } from 'rxjs';
import { type Bbox, bboxEnParametre } from '../../../carte/bbox';
import { CarteComponent } from '../../../carte/carte.component';
import { chargerParCadre } from '../../../carte/charger-par-cadre';
import { contenuPopup } from '../../../carte/contenu-popup';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { formaterNombre } from '../../../core/format/nombre';
import { LegendeComponent } from '../../../carte/legende/legende.component';
import { LegendeNiveauxComponent, type NiveauLegende } from '../../../carte/legende/legende-niveaux.component';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { messageErreurApi } from '../../../core/http/erreurs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import type { ApercuRayon } from '../commandes/reglette-rayons.component';
import { ZonesRisqueApi } from '../data/zones-risque.api';
import { codeProfil, codeZonesRisque } from '../logique/code-profil';
import { LIBELLE_NIVEAU, NIVEAUX, type ProfilRayons, anneauxDuNiveau } from '../logique/profil';
import { ZONES_RISQUE_ZOOM_LISIBLE } from '../logique/zooms';
import {
  ID_CERCLES, ID_SITES, SOURCE_APERCU, SOURCE_CERCLES, SOURCE_SITES, SOURCE_SURVOL, basculerCerclesSites,
  cerclesApercu, cerclesDesSites, cerclesSurvol, ecrireSource, poserCouchesSites, repeindreCouchesSites,
} from './couches-sites';
import { basculerCouchesZones, poserCouchesZones, repeindreCouchesZones } from './couches-zones';

/**
 * Les trois grappes industrielles denses (`CarteRisque.tsx:154-161`) : une vue France entière ne montre JAMAIS
 * l'objet du module, une zone de 2 km y faisant moins d'un pixel.
 */
export const GRAPPES: ReadonlyArray<{ nom: string; bbox: Bbox }> = [
  { nom: 'Vallée de la chimie', bbox: [4.75, 45.6, 5.05, 45.75] },
  { nom: 'Estuaire de la Seine', bbox: [0.05, 49.4, 0.55, 49.55] },
  { nom: 'Étang de Berre', bbox: [4.75, 43.35, 5.3, 43.6] },
];

/** La vue d'ouverture : l'Étang de Berre, la grappe la plus dense (`VUE_INITIALE = GRAPPES[2].bbox`). */
export const VUE_INITIALE_RISQUE: Bbox = GRAPPES[2].bbox;

/** Le jeton de chaque niveau, pour la légende (DOM : `var()` y est permis). */
const JETON_NIVEAU = { haut: 'niveau-haut', bas: 'niveau-bas', autres: 'niveau-autres' } as const;

/**
 * La carte permanente du module risque — portage de `CarteRisque.tsx` (lot 3, T7 : les ZONES ; T8 : les sites,
 * le survol, le mode site par site et l'aperçu de rayon).
 *
 * ── UNE INSTANCE, JAMAIS RECRÉÉE ──────────────────────────────────────────
 *
 * `mg-carte` crée MapLibre une fois ; ce composant n'y pose que des couches. Quand la clé des zones
 * (`codeZonesRisque(codeProfil(profil), natures)`) change, la SOURCE et ses couches sont recréées — jamais la
 * carte. La clé est une CHAÎNE (`computed`) : un aller-retour d'étapes, ou un nouveau tableau `natures` au même
 * contenu, ne change rien et ne relance ni préparation ni tuile.
 *
 * ── TROIS EFFETS, TROIS RAISONS ───────────────────────────────────────────
 *
 * 1. **La clé** → `preparer` PUIS les couches. La géométrie est construite AVANT de poser la source (2,8 s sur
 *    la France, une fois par code) : sinon MapLibre demanderait ses tuiles sous une clé que personne n'a
 *    construite et échouerait en silence. Une nouvelle clé annule la préparation en vol. La préparation part DÈS LE
 *    MONTAGE, en parallèle du chargement du fond (comme React) ; les couches attendent les deux.
 * 2. **Le thème** → `setPaintProperty` seul. React recréait la source à chaque bascule de thème (le thème était
 *    une dépendance de son effet des zones), donc REPRÉPARAIT et redemandait toutes les tuiles pour un
 *    changement de couleur — défaut corrigé, listé au rapport T7.
 * 3. **`fusionner`** → `setLayoutProperty('visibility')` seul. À la CRÉATION, la visibilité lit `fusionner`
 *   SANS dépendance (`untracked`) — l'équivalent de `fusionnerRef` : la mettre en dépendance de l'effet 1
 *   recréerait la source à chaque clic, et l'oublier ferait réapparaître les enveloppes en mode site par site
 *   à chaque profil.
 *
 * Les tuiles échappent au limiteur de `HttpClient` : la discipline (plancher de source 4, `minzoom` des
 * couches 7 et 10, préparation une fois par code) est donc ICI.
 *
 * ── LES SITES (T8, `couches-sites.ts`) ────────────────────────────────────
 *
 * 4. Les points viennent de `/api/map/risques-industriels` sur la bbox VISIBLE (`chargerParCadre` : immédiat au
 *    départ, anti-rebond 350 ms ensuite, requête précédente annulée, `limite=800`), rechargés quand `gravites` ou `natures` changent ; jamais
 *    avant que la carte existe, donc jamais la France entière.
 * 5. Les cercles du site par site et 6. l'aperçu de rayon DÉRIVENT des sites déjà chargés ; le survol aussi, dans
 *    un écouteur de couche. Aucun de ces trois dessins ne fait de requête.
 * Les couches de sites sont posées au `load`, AVANT les zones, qui s'insèrent dessous.
 */
@Component({
  selector: 'mg-carte-risque',
  imports: [CarteComponent, LegendeComponent, LegendeNiveauxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 min-w-0 flex-1' },
  template: `
    <mg-carte [cadre]="vueInitiale" (prete)="surPrete($event)" (zoom)="zoom.set($event)"
              (erreur)="erreurCarte.set($event)" class="min-h-0 min-w-0 flex-1">
      <!-- Aller voir une grappe (CarteRisque.tsx:972) : 11 px, --card-overlay, bord 0,5 --border-default, rayon 6. -->
      <div class="absolute top-2.5 left-2.5 z-[2] flex max-w-[calc(100%-100px)] flex-wrap gap-[6px]">
        @for (g of grappes; track g.nom) {
          <button type="button" (click)="allerA(g.bbox)"
                  class="cursor-pointer rounded-lg border-fin border-default bg-card-overlay px-[10px] py-[5px] text-[11px] text-secondary">{{ g.nom }}</button>
        }
      </div>
      <!-- La légende ne liste QUE les niveaux qui portent un anneau (mg-legende-niveaux). -->
      <mg-legende class="absolute bottom-2.5 left-2.5 z-[2]">
        <mg-legende-niveaux [niveaux]="niveauxLegende()" />
        <div class="mt-0.5 text-[9.5px] leading-[1.5] text-tertiary">
          Trait plein : périmètre publié par l’État. Tireté : rayon que nous calculons.{{ texteNbSites() }}
        </div>
      </mg-legende>
      <!-- Sous le seuil LISIBLE et non sous le plancher : entre z4 et z7 la carte ne peint rien, et sans ce bandeau
           on croirait qu'il n'y a rien à voir. -->
      @if (sousLeSeuilLisible()) {
        <div class="absolute top-[50px] left-2.5 z-[2] max-w-[300px] rounded-lg border-fin border-warning/25 bg-warning/12 px-[11px] py-[7px] text-[11px] leading-[1.5] text-warning">
          Zoomez pour voir les zones : à cette échelle, un rayon de 2 km fait moins d’un pixel.
        </div>
      }
      @if (preparation()) {
        <!-- Même place et même plan que React (z 2, sous « Carte seule » en z 4) : React la recouvre, on garde la parité. -->
        <div class="absolute top-2.5 right-[56px] z-[2] rounded-lg border-fin border-subtle bg-card-overlay px-[10px] py-[6px] text-[10.5px] text-secondary">
          Découpage des zones…
        </div>
      }
    </mg-carte>
    @if (erreurCarte() ?? erreurZones() ?? erreurSites(); as message) {
      <p role="alert" class="absolute right-2.5 bottom-[34px] z-[3] m-0 max-w-[300px] rounded-lg border-fin border-danger/25 bg-card-overlay px-[11px] py-[7px] text-[11px] leading-[1.5] text-danger">
        {{ message }}
      </p>
    }
  `,
})
export class CarteRisqueComponent {
  /** Le profil CALCULÉ (anneaux des seuils décochés vidés) : la carte dessine ce qu'on compte. */
  readonly profil = input.required<ProfilRayons>();
  /** Natures de risque retenues, vide = toutes : elles entrent dans la clé de cache des zones. */
  readonly natures = input<readonly string[]>([]);
  /** Niveaux réglementaires retenus : ils filtrent les SITES chargés (`gravites=`). */
  readonly gravites = input<readonly string[]>([]);
  /** Zones fusionnées (défaut), ou un cercle tireté par site et par anneau — les couches de zones sont alors masquées. */
  readonly fusionner = input(true);
  /** Le rayon en cours de glissement d'une réglette — les cercles d'aperçu, sans requête. */
  readonly apercu = input<ApercuRayon | null>(null);
  /** L'instance MapLibre, à son premier `load` — pour la liaison des caméras (T15). */
  readonly carte = output<maplibregl.Map>();
  /**
   * La clé de zones (`codeZonesRisque`) dont la géométrie vient d'être construite (ou dont la construction a échoué :
   * la carte pose quand même). La carte des codes postaux attend cette clé avant de demander les MÊMES tuiles en
   * surimpression — sinon elle les demanderait sous une clé que personne n'a encore construite (relecture T15).
   */
  readonly clePrete = output<string>();

  private readonly api = inject(ZonesRisqueApi);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  /** UNE palette pour les zones et les sites : une seule lecture du CSS par bascule de thème. */
  private readonly teintes = inject(CouleursService).palette({
    haut: 'niveau-haut', bas: 'niveau-bas', autres: 'niveau-autres', halo: 'halo-carte', contourPoint: 'contour-point',
  });

  protected readonly vueInitiale = VUE_INITIALE_RISQUE;
  protected readonly grappes = GRAPPES;
  /** Le zoom courant (React : `useState(9)`, tenu par `m.on('zoom')`). */
  protected readonly zoom = signal(9);
  protected readonly sousLeSeuilLisible = computed(() => this.zoom() < ZONES_RISQUE_ZOOM_LISIBLE);
  protected readonly preparation = signal(false);
  protected readonly erreurCarte = signal<string | null>(null);
  protected readonly erreurZones = signal<string | null>(null);
  protected readonly erreurSites = signal<string | null>(null);

  /**
   * Les sites de la dernière vue chargée — la source des cercles du site par site et de l'aperçu, qu'on ne
   * redemande jamais. Un NOUVEL objet à chaque chargement : deux vues voisines au même nombre de sites
   * redessinent quand même leurs cercles (React tenait un compteur `versionSites` pour la même raison).
   */
  private readonly sites = signal<GeoJSON.FeatureCollection | null>(null, { equal: () => false });
  /** « N sites affichés » ; vide tant qu'aucune vue n'est arrivée (React : `nSites === null`). */
  protected readonly texteNbSites = computed(() => {
    const fc = this.sites();
    return Array.isArray(fc?.features) ? ` · ${formaterNombre(fc.features.length)} sites affichés` : '';
  });
  /** Formes SÉRIALISÉES des filtres de sites : un nouveau tableau au même contenu ne relance aucun chargement. */
  private readonly cleGravites = computed(() => this.gravites().join(','));

  private readonly instance = signal<maplibregl.Map | null>(null);
  /** La clé du profil SEUL : la route ne relit qu'un profil, les natures voyagent à part. */
  private readonly codeSeul = computed(() => codeProfil(this.profil()));
  /** Jointe par virgules comme React (`cleNatures`) : un libellé contenant une virgule serait coupé en deux, à l'identique (parité). */
  private readonly cleNatures = computed(() => this.natures().join(','));
  /** La clé de cache des zones, par la MÊME fonction que les deux routes serveur. Une chaîne : égale, rien ne bouge. */
  private readonly code = computed(() => codeZonesRisque(this.codeSeul(), this.listeNatures()));

  protected readonly niveauxLegende = computed<NiveauLegende[]>(() => NIVEAUX.map((n) => ({
    libelle: LIBELLE_NIVEAU[n],
    jeton: JETON_NIVEAU[n],
    anneaux: anneauxDuNiveau(this.profil(), n),
  })));

  private preparationEnVol: Subscription | null = null;
  /** La dernière clé dont la géométrie est construite (ou dont la construction a échoué : on pose quand même). */
  private readonly codePrepare = signal<string | null>(null);
  /** La clé dont les couches sont sur la carte : une seule pose par clé. */
  private codePose: string | null = null;

  constructor() {
    // Libellé EXACT de React (`usePiste('zones', 'Découpage des zones…', …)`).
    inject(ChargementService).suivre('zones', 'Découpage des zones…', () => this.preparation());
    inject(DestroyRef).onDestroy(() => this.preparationEnVol?.unsubscribe());

    // 1a. La clé change → préparer, DÈS LE MONTAGE et sans attendre le fond de carte : React lançait le POST en
    //     parallèle du chargement du style (relecture T7, I1). Une clé déjà préparée ne repart pas.
    effect(() => {
      const code = this.code();
      untracked(() => this.preparer(code));
    });

    // 1b. Les couches ne se posent qu'une fois la carte chargée ET la clé COURANTE préparée — jamais une tuile avant
    //     la construction de sa géométrie. Une seule pose par clé (`codePose`).
    effect(() => {
      const carte = this.instance();
      const code = this.code();
      const prepare = this.codePrepare();
      if (!carte || prepare !== code || this.codePose === code) return;
      untracked(() => this.poser(carte, code));
    });

    // 2. Le thème change → on repeint zones ET sites. `carte` d'abord : la palette n'est lue qu'une fois la carte là.
    effect(() => {
      const carte = this.instance();
      if (!carte) return;
      const t = this.teintes();
      untracked(() => {
        repeindreCouchesZones(carte, t);
        repeindreCouchesSites(carte, t);
      });
    });

    // 3. « Lecture des zones » → visibilité seule : les zones OU les cercles du site par site.
    effect(() => {
      const carte = this.instance();
      const visible = this.fusionner();
      if (!carte) return;
      untracked(() => {
        basculerCouchesZones(carte, visible);
        basculerCerclesSites(carte, !visible);
      });
    });

    // 4. Les sites de la bbox VISIBLE : immédiatement au départ, puis à chaque `moveend` après 350 ms de calme, la requête
    //    précédente ANNULÉE (`chargerParCadre`). Relancé quand les niveaux ou les natures changent — jamais sur le
    //    thème (React le faisait : une requête de plus à chaque bascule, pour les mêmes points).
    effect((surNettoyage) => {
      const carte = this.instance();
      const gravites = this.cleGravites();
      const natures = this.cleNatures();
      if (!carte) return;
      const arreter = untracked(() => chargerParCadre(
        carte,
        (b) => this.api.sites(bboxEnParametre(b), {
          gravites: gravites ? gravites.split(',') : [],
          natures: natures ? natures.split(',') : [],
        }),
        (fc) => {
          this.erreurSites.set(null);
          ecrireSource(carte, SOURCE_SITES, fc);
          this.sites.set(fc);
        },
        // React se taisait (« une carte sans ses points reste lisible ») : on garde les points précédents, mais on
        // DIT que la vue n'a pas pu être rechargée.
        { surEchec: (e) => this.erreurSites.set(messageErreurApi(e)) },
      ));
      surNettoyage(arreter);
    });

    // 5. Les cercles du site par site, dérivés des sites DÉJÀ chargés — rien n'est construit tant que les zones
    //    sont fusionnées : 400 cercles de 64 segments pour une couche masquée, reconstruits à chaque panoramique.
    effect(() => {
      const carte = this.instance();
      const fusionner = this.fusionner();
      const sites = this.sites();
      const profil = this.profil();
      if (!carte) return;
      untracked(() => ecrireSource(carte, SOURCE_CERCLES, fusionner ? [] : cerclesDesSites(sites, profil)));
    });

    // 6. L'aperçu pendant le glissement d'une réglette : un cercle par site au rayon réglé, `null` → vidé.
    effect(() => {
      const carte = this.instance();
      const apercu = this.apercu();
      const sites = this.sites();
      if (!carte) return;
      untracked(() => ecrireSource(carte, SOURCE_APERCU, apercu ? cerclesApercu(sites, apercu) : []));
    });
  }

  /** Un bouton de grappe recadre la carte, animation 800 ms, marge 40 (`CarteRisque.tsx:980`). */
  protected allerA(bbox: Bbox): void {
    this.instance()?.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 800 });
  }

  /**
   * La carte est chargée : les couches de sites sont posées TOUT DE SUITE (sources vides), avant les zones — qui
   * s'insèrent dessous (`avant: ID_CERCLES`). Les écoutes de couche sont posées UNE fois : MapLibre les garde à
   * travers les `setData`, et la carte n'est jamais recréée.
   */
  protected surPrete(carte: maplibregl.Map): void {
    poserCouchesSites(carte, this.teintes(), !this.fusionner());
    this.ecouterSites(carte);
    this.instance.set(carte);
    this.carte.emit(carte);
  }

  /**
   * Clic → popup ; survol → anneaux du site, curseur ; sortie → effacés. AUCUNE requête : position et niveau sont
   * dans le GeoJSON déjà chargé, les rayons dans le profil COURANT (lu à chaque mouvement, comme `profilRef`).
   */
  private ecouterSites(carte: maplibregl.Map): void {
    // Au clic et non au survol : sur une grappe dense les points se touchent, un survol ferait clignoter l'écran.
    carte.on('click', ID_SITES, (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = (f.properties ?? {}) as Record<string, unknown>;
      // Statut · ville · nature, dans l'ordre de React (`CarteRisque.tsx:666`) ; `textContent`, jamais du HTML.
      const details = [p['statut_seveso'], p['ville'], p['libelle_nature']].map((v) => (v ? String(v) : null));
      this.fabriquePopup({ closeButton: true, maxWidth: '260px' })
        .setLngLat(e.lngLat)
        .setDOMContent(contenuPopup(String(p['nom'] ?? 'Site sans nom'), details))
        .addTo(carte);
    });
    carte.on('mousemove', ID_SITES, (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (f) ecrireSource(carte, SOURCE_SURVOL, cerclesSurvol(f, this.profil()));
    });
    carte.on('mouseenter', ID_SITES, () => { carte.getCanvas().style.cursor = 'pointer'; });
    carte.on('mouseleave', ID_SITES, () => {
      carte.getCanvas().style.cursor = '';
      ecrireSource(carte, SOURCE_SURVOL, []);
    });
  }

  private listeNatures(): string[] {
    const cle = this.cleNatures();
    return cle ? cle.split(',') : [];
  }

  /**
   * Construit la géométrie de la clé courante, UNE fois par clé. Une nouvelle clé annule la préparation en vol ;
   * revenir à la clé déjà préparée (donc déjà posée) ne relance rien. Passe par `HttpClient`, donc par le
   * limiteur de 3 appels : aucune priorité n'est prise sur les autres requêtes de l'écran.
   */
  private preparer(code: string): void {
    this.preparationEnVol?.unsubscribe();
    this.preparationEnVol = null;
    if (this.codePrepare() === code) {
      this.preparation.set(false);
      return;
    }
    this.erreurZones.set(null);
    this.preparation.set(true);
    const fin = () => {
      this.preparation.set(false);
      this.codePrepare.set(code);
      this.clePrete.emit(code);
    };
    this.preparationEnVol = this.api.preparer(this.codeSeul(), this.listeNatures()).subscribe({
      next: fin,
      // React posait la source MÊME sur un échec de préparation (« la carte reste utilisable »), sans rien dire.
      // On pose de même — le fond reste, l'absence de zones se voit — mais l'échec est AFFICHÉ (défaut corrigé).
      error: (e: unknown) => {
        this.erreurZones.set(messageErreurApi(e));
        fin();
      },
    });
  }

  /** (Re)pose source et couches de la clé courante. Lus sans dépendance : `fusionner` décide à la CRÉATION (effet 3). */
  private poser(carte: maplibregl.Map, code: string): void {
    this.codePose = code;
    poserCouchesZones(carte, {
      url: this.api.urlTuilesZones(this.codeSeul(), this.listeNatures()),
      teintes: this.teintes(),
      profil: this.profil(),
      visible: this.fusionner(),
      // SOUS les sites : recréées à un changement de profil, les zones recouvriraient sinon points et cercles.
      avant: carte.getLayer(ID_CERCLES) ? ID_CERCLES : undefined,
    });
  }
}
