import {
  ChangeDetectionStrategy, Component, DestroyRef, afterRenderEffect, computed, effect, inject, input, output, signal,
  untracked,
} from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { Observable, debounceTime, defer, filter, finalize, map, merge, of, switchMap } from 'rxjs';
import { CADRE_METROPOLE, bboxDeCarte, bboxEnParametre } from '../../../carte/bbox';
import { CarteComponent } from '../../../carte/carte.component';
import { FABRIQUE_POPUP, type PopupCarte } from '../../../carte/fabrique-carte';
import { formaterDecimal, formaterNombre } from '../../../core/format/nombre';
import { messageErreurApi } from '../../../core/http/erreurs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { type ChargementCp, JeuxZonesApi } from '../data/jeux-zones.api';
import { ZonesRisqueApi } from '../data/zones-risque.api';
import { AtelierJeuxService } from '../etat/atelier-jeux.service';
import { codeZonesRisque } from '../logique/code-profil';
import { ZONES_RISQUE_ZOOM_LISIBLE, ZONES_RISQUE_ZOOM_PLANCHER } from '../logique/zooms';
import { COUCHE_TUILE } from './couches-zones';

export const SOURCE_CP = 'zoneset-cp';
export const SOURCE_RAYONS_CP = 'zoneset-rayons';
export const ID_FOND_CP = 'zoneset-cp-fond';
export const ID_CONTOUR_CP = 'zoneset-cp-contour';
export const ID_ECARTES_CP = 'zoneset-cp-ecartes';
export const ID_SURBRILLANCE_CP = 'zoneset-cp-surbrillance';
export const ID_RAYONS_CP = 'zoneset-rayons-contour';

/**
 * Les trois variables de coloration (`CarteCodesPostaux.tsx:49-67`). Elles ne répondent PAS à la même question :
 * `plan`, ce que le code postal reçoit du budget ; `exposition`, la part de SES habitants réellement en zone (la
 * dilution) ; `population`, combien d'exposés il porte.
 */
export type ColorationCp = 'plan' | 'exposition' | 'population';

export const LIBELLE_COLORATION: Record<ColorationCp, string> = {
  plan: 'Part du plan',
  exposition: 'Taux d’exposition',
  population: 'Population exposée',
};

/**
 * ⚠ Bornes FIXES par variable, jamais dérivées de ce qui est à l'écran : une échelle recalculée à chaque panoramique
 * fait changer la couleur d'un code postal qui n'a pas bougé (`CarteCodesPostaux.tsx:258-270`).
 */
const ECHELLES: Record<ColorationCp, [champ: string, bornes: readonly number[]]> = {
  plan: ['part_plan', [0, 0.0005, 0.001, 0.002, 0.004]],
  exposition: ['taux_exposition', [0, 20, 40, 60, 80]],
  population: ['pop_en_zone', [0, 2000, 8000, 20000, 50000]],
};

/** Les compteurs du bandeau, tels que la route les rend. */
export interface ChiffresCp {
  n_total: number;
  n_affiches: number;
  n_retenus: number;
  taux_utile: number | null;
}

/**
 * Les teintes de cette carte, d'un THÈME FIXE (A11) : le fond est Positron dans les deux thèmes, et React peignait
 * toujours la rampe `--seq-*` SOMBRE (`RAMPE`), le gris neutre d'un écarté (`GRIS_ECARTE`, = `--donnee-absente` à
 * 0,28), le contour orange des rayons (`#e0603f` = `--niveau-haut` sombre) et la surbrillance teal.
 * Seul le contour des codes postaux n'a pas de jeton : React écrivait `rgba(120,120,120,0.55)` ; on prend
 * `--text-tertiary` (#8a8a8a, invariant) à la même opacité — écart listé au rapport T15.
 */
const JETONS_CP = {
  r1: 'seq-1', r2: 'seq-2', r3: 'seq-3', r4: 'seq-4', r5: 'seq-5',
  ecarte: 'donnee-absente', contour: 'text-tertiary', rayons: 'niveau-haut', surbrillance: 'brand-teal',
} as const;
type TeintesCp = Record<keyof typeof JETONS_CP, string>;
/** L'opacité du gris d'un écarté, appliquée par `fill-opacity` et non recopiée dans un `rgba`. */
export const OPACITE_ECARTE = 0.28;

function expressionCouleur(coloration: ColorationCp, t: TeintesCp): maplibregl.ExpressionSpecification {
  const [champ, b] = ECHELLES[coloration];
  return [
    'interpolate', ['linear'], ['coalesce', ['get', champ], 0],
    b[0], t.r1, b[1], t.r2, b[2], t.r3, b[3], t.r4, b[4], t.r5,
  ] as unknown as maplibregl.ExpressionSpecification;
}

const filtreSurbrillance = (codes: readonly string[] | null) =>
  ['in', ['get', 'code_postal'], ['literal', codes ?? []]] as unknown as maplibregl.FilterSpecification;

/**
 * La bulle d'un code postal (`CarteCodesPostaux.tsx:363-382`), par `textContent` et jamais par `innerHTML`.
 * Deux nombres sont écrits à la française, là où React écrivait un point décimal (`23.4 %`, `0.123 %`) — défaut
 * corrigé et listé au rapport T15.
 */
export function contenuBulleCp(p: Record<string, unknown>, doc: Document = document): HTMLElement {
  const ligne = (texte: string, classe = '') => {
    const d = doc.createElement('div');
    if (classe) d.className = classe;
    d.textContent = texte;
    return d;
  };
  const racine = doc.createElement('div');
  racine.className = 'text-[11px] leading-[1.5]';
  const titre = ligne(String(p['code_postal']), 'font-medium');
  const membres = Number(p['n_membres'] ?? 1);
  // ⚠ Le polygone dessiné est celui de la COMMUNE : le référentiel ne distingue pas les contours des codes postaux
  // d'une même ville (sql/228). Le taire ferait lire « 44000 » comme un quartier.
  if (membres > 1) {
    const s = doc.createElement('span');
    s.className = 'opacity-70';
    s.textContent = ` + ${membres - 1} code(s) indissociable(s)`;
    titre.appendChild(s);
  }
  const taux = p['taux_exposition'];
  racine.append(
    titre,
    ligne(`Exposés : ${formaterNombre(Number(p['pop_en_zone'] ?? 0))} / ${formaterNombre(Number(p['pop_totale'] ?? 0))} habitants`),
    ligne(`Taux d’exposition : ${taux == null ? '—' : Number(taux).toLocaleString('fr-FR')} %`),
    ligne(`Part du plan : ${formaterDecimal(Number(p['part_plan'] ?? 0) * 100, 3)} %`),
    ligne(p['retenu'] ? 'Acheté' : 'Écarté par le seuil', 'opacity-75'),
  );
  return racine;
}

/**
 * La carte de DROITE de l'étape ④ : ce qu'on ACHÈTE — portage de `CarteCodesPostaux.tsx` (lot 3, T15).
 *
 * ── MONTÉE UNE FOIS, JAMAIS DÉMONTÉE ──────────────────────────────────────
 *
 * `mg-vue-cartes` la monte dès l'ouverture, à largeur nulle tant qu'on ne la regarde pas (`actif` faux) : comme
 * la carte des rayons, la remonter rechargerait fond, tuiles et position à chaque aller-retour d'étape.
 *
 * ── QUAND ELLE LIT ────────────────────────────────────────────────────────
 *
 * `/cp-geo` sur la bbox VISIBLE (une ligne par code postal, part du plan calculée par le serveur avec
 * `genererPlanCp` — l'écran ne recalcule rien), et SEULEMENT quand (jeu, réglage, bbox) change :
 * - immédiatement quand la carte devient visible ou que le jeu change ; puis au `moveend` après 350 ms de calme,
 *   jamais au `move` (famille de l'incident du 28/03) ;
 * - au réglage du seuil (`AtelierJeuxService.reglage`, A14) : le serveur seul décide de `retenu` ;
 * - JAMAIS deux fois pour la même clé. ⚠ Défaut React corrigé : `CarteCodesPostaux.tsx` relisait `/cp-geo` environ
 *   toutes les 5 s sans que rien ne bouge (chaque `moveend` relançait, y compris ceux d'un `resize` ou d'un
 *   `jumpTo` de la carte liée sur le même cadre). Ici la clé `jeu|réglage|bbox arrondie` est comparée à la dernière
 *   chargée ET à celle en vol, AVANT le `switchMap` — une requête identique en vol n'est donc jamais annulée.
 * - Pas tant qu'elle est masquée : sa bbox y serait celle d'un conteneur de largeur nulle. Au moment où elle
 *   apparaît, le canevas est d'abord redimensionné (`afterRenderEffect`, après la mise à jour du DOM), puis lu.
 *
 * ── LES COULEURS NE SUIVENT PAS LE THÈME ──────────────────────────────────
 *
 * Palette d'un thème FIXE (`paletteDuTheme(…, 'sombre')`, A11), comme React : basculer le thème ne repeint rien et
 * ne recrée aucune source. Jamais `var()` dans `paint` (`addLayer` lève).
 */
@Component({
  selector: 'mg-carte-codes-postaux',
  imports: [CarteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 min-w-0 flex-1' },
  template: `
    <mg-carte [cadre]="cadreInitial" (prete)="surPrete($event)" (erreur)="erreurCarte.set($event)" class="min-h-0 min-w-0 flex-1">
      <!-- Le bandeau d'état : un chargement muet se lit « il n'y a rien ». -->
      @if (bandeau(); as texte) {
        <div data-etat-cp class="absolute top-2.5 left-2.5 z-[3] rounded-lg border-fin border-default bg-[var(--card-overlay)] px-[10px] py-[5px] text-[11px]"
             [class.text-danger]="etat() === 'echec'" [class.text-secondary]="etat() !== 'echec'">{{ texte }}</div>
      }
      <!-- La légende : sans elle, une choroplèthe est un dessin. Pastilles peintes avec la MÊME palette fixe que la carte. -->
      @if (etat() === 'pret') {
        <div data-legende-cp class="absolute bottom-6 left-2.5 z-[3] rounded-lg border-fin border-default bg-[var(--card-overlay)] px-[10px] py-[7px] text-[10px] text-secondary">
          <div class="mb-1 text-primary">{{ libelleColoration() }}</div>
          <div class="flex items-center gap-0.5">
            @for (c of rampe(); track $index) {
              <span class="block h-2 w-[22px]" [style.background]="c"></span>
            }
          </div>
          <div class="flex justify-between font-mono"><span>faible</span><span>fort</span></div>
          <div class="mt-[5px] flex items-center gap-[5px]">
            <span class="block h-2 w-[22px]" [style.background]="teintes().ecarte" [style.opacity]="opaciteEcarte"></span>
            <span>écarté par le seuil</span>
          </div>
        </div>
      }
    </mg-carte>
    @if (erreurCarte(); as message) {
      <p role="alert" class="absolute right-2.5 bottom-[34px] z-[3] m-0 max-w-[300px] rounded-lg border-fin border-danger/25 bg-card-overlay px-[11px] py-[7px] text-[11px] leading-[1.5] text-danger">{{ message }}</p>
    }
  `,
})
export class CarteCodesPostauxComponent {
  /** Le jeu à afficher, ou `null` tant qu'aucun n'est construit. */
  readonly jeuId = input<string | null>(null);
  /** Le code du profil CALCULÉ (`codeProfil(profilCalcul)`), pour la surimpression des rayons. */
  readonly codeProfil = input('');
  readonly natures = input<readonly string[]>([]);
  readonly coloration = input<ColorationCp>('plan');
  /** Les codes postaux à mettre en évidence (survol d'un bassin du tableau). */
  readonly surbrillance = input<readonly string[] | null>(null);
  /** Vrai quand la carte est À L'ÉCRAN : masquée, elle ne lit rien. */
  readonly actif = input(false);
  /** L'instance, à son premier `load` — pour la liaison des caméras. */
  readonly carte = output<maplibregl.Map>();
  /** Les compteurs du bandeau, `null` sur un échec. */
  readonly chiffres = output<ChiffresCp | null>();

  private readonly api = inject(JeuxZonesApi);
  private readonly zonesApi = inject(ZonesRisqueApi);
  private readonly atelier = inject(AtelierJeuxService);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly couleurs = inject(CouleursService);
  /**
   * Lue UNE fois, à la première peinture (un `computed` sans dépendance) : la palette est fixe, aucun effet ne dépend
   * du thème. Paresseuse : une carte jamais chargée ne lit pas la feuille.
   */
  protected readonly teintes = computed<TeintesCp>(() => this.couleurs.paletteDuTheme(JETONS_CP, 'sombre'));
  protected readonly rampe = computed(() => {
    const t = this.teintes();
    return [t.r1, t.r2, t.r3, t.r4, t.r5];
  });
  protected readonly opaciteEcarte = OPACITE_ECARTE;
  protected readonly cadreInitial = CADRE_METROPOLE;

  private readonly instance = signal<maplibregl.Map | null>(null);
  private readonly etatInterne = signal<'vide' | 'chargement' | 'echec' | 'pret'>('vide');
  private readonly message = signal<string | null>(null);
  protected readonly erreurCarte = signal<string | null>(null);
  protected readonly etat = computed(() => (this.jeuId() ? this.etatInterne() : 'vide'));
  protected readonly libelleColoration = computed(() => LIBELLE_COLORATION[this.coloration()]);
  protected readonly bandeau = computed(() => {
    if (!this.jeuId()) return 'Aucun jeu construit — réglez les anneaux, puis construisez.';
    const e = this.etatInterne();
    if (e === 'chargement') return 'Chargement des codes postaux…';
    if (e === 'echec') return this.message();
    return null;
  });

  private readonly cleNatures = computed(() => this.natures().join(','));
  /** La clé de cache des zones, par la MÊME fonction que la carte des rayons et les routes serveur. */
  private readonly cleRayons = computed(() =>
    this.codeProfil() ? codeZonesRisque(this.codeProfil(), this.cleNatures() ? this.cleNatures().split(',') : []) : '');

  /** La dernière clé `jeu|réglage|bbox` chargée avec succès, et celle en vol. */
  private cleChargee: string | null = null;
  private cleEnVol: string | null = null;
  private colorationPosee: ColorationCp | null = null;
  private rayonsPoses: string | null = null;
  private bulle: PopupCarte | null = null;

  constructor() {
    // 1. Les codes postaux, quand (jeu, réglage, bbox visible) change — voir l'en-tête. `afterRenderEffect` : la carte
    //    vient peut-être de passer de la largeur nulle à la moitié de l'écran, et le DOM doit être à jour avant
    //    `resize()` puis la lecture de la bbox.
    afterRenderEffect((surNettoyage) => {
      const carte = this.instance();
      const jeu = this.jeuId();
      const reglage = this.atelier.reglage();
      if (!carte || !jeu || !this.actif()) return;
      const abonnement = untracked(() => {
        carte.resize();
        return this.lectures(carte, jeu, reglage).subscribe();
      });
      surNettoyage(() => abonnement.unsubscribe());
    });

    // 2. La variable de coloration → `setPaintProperty` seul (la valeur initiale est posée à la création).
    effect(() => {
      const carte = this.instance();
      const c = this.coloration();
      if (!carte || c === this.colorationPosee) return;
      this.colorationPosee = c;
      untracked(() => carte.setPaintProperty(ID_FOND_CP, 'fill-color', expressionCouleur(c, this.teintes())));
    });

    // 3. La surbrillance venue du tableau des bassins : un filtre, aucune requête (les CP voyagent avec le bassin).
    effect(() => {
      const carte = this.instance();
      const codes = this.surbrillance();
      if (!carte) return;
      untracked(() => carte.setFilter(ID_SURBRILLANCE_CP, filtreSurbrillance(codes)));
    });

    // 4. La surimpression des rayons : les MÊMES tuiles que la carte de gauche, en CONTOUR seulement. Posée quand la
    //    carte est visible (React la posait au montage, carte masquée comprise) ; recréée quand la clé change.
    effect(() => {
      const carte = this.instance();
      const cle = this.cleRayons();
      if (!carte || !this.actif() || cle === this.rayonsPoses) return;
      untracked(() => this.poserRayons(carte, cle));
    });

    inject(DestroyRef).onDestroy(() => this.bulle?.remove());
  }

  protected surPrete(carte: maplibregl.Map): void {
    carte.addSource(SOURCE_CP, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Les ÉCARTÉS d'abord, sous les retenus : ils sont le fond sur lequel se lit ce qu'on achète.
    carte.addLayer({
      id: ID_ECARTES_CP, type: 'fill', source: SOURCE_CP, filter: ['!', ['get', 'retenu']],
      paint: { 'fill-color': this.teintes().ecarte, 'fill-opacity': OPACITE_ECARTE },
    });
    this.colorationPosee = this.coloration();
    carte.addLayer({
      id: ID_FOND_CP, type: 'fill', source: SOURCE_CP, filter: ['get', 'retenu'],
      paint: { 'fill-color': expressionCouleur(this.colorationPosee, this.teintes()), 'fill-opacity': 0.75 },
    });
    carte.addLayer({
      id: ID_CONTOUR_CP, type: 'line', source: SOURCE_CP,
      paint: {
        'line-color': this.teintes().contour, 'line-opacity': 0.55, 'line-width': 0.5,
        // Tireté sur les écartés : la couleur dit « pas acheté », le trait le redit — lisible en niveaux de gris.
        'line-dasharray': ['case', ['get', 'retenu'], ['literal', [1, 0]], ['literal', [2, 2]]],
      },
    });
    carte.addLayer({
      id: ID_SURBRILLANCE_CP, type: 'line', source: SOURCE_CP, filter: filtreSurbrillance(this.surbrillance()),
      paint: { 'line-color': this.teintes().surbrillance, 'line-width': 2.5 },
    });
    this.ecouterSurvol(carte);
    this.instance.set(carte);
    this.carte.emit(carte);
  }

  /**
   * Le flux des lectures : la bbox courante tout de suite, puis à chaque `moveend` après 350 ms de calme. Une clé déjà
   * chargée, ou en vol, est écartée AVANT `switchMap` (qui annulerait sinon la requête en vol identique).
   */
  private lectures(carte: maplibregl.Map, jeu: string, reglage: number): Observable<unknown> {
    const mouvements = new Observable<void>((abonne) => {
      const emettre = () => abonne.next();
      carte.on('moveend', emettre);
      return () => carte.off('moveend', emettre);
    });
    return merge(defer(() => of(undefined)), mouvements.pipe(debounceTime(350))).pipe(
      map(() => bboxEnParametre(bboxDeCarte(carte))),
      map((bbox) => ({ bbox, cle: `${jeu}|${reglage}|${bbox}` })),
      filter(({ cle }) => cle !== this.cleChargee && cle !== this.cleEnVol),
      switchMap(({ bbox, cle }) => {
        this.cleEnVol = cle;
        this.etatInterne.set('chargement');
        return new Observable<void>((abonne) => {
          const s = this.api.cpGeo(jeu, bbox).subscribe({
            next: (d) => this.appliquer(carte, cle, d),
            error: (e: unknown) => this.echouer(messageErreurApi(e)),
            complete: () => abonne.complete(),
          });
          return () => s.unsubscribe();
        }).pipe(finalize(() => { if (this.cleEnVol === cle) this.cleEnVol = null; }));
      }),
    );
  }

  private appliquer(carte: maplibregl.Map, cle: string, d: ChargementCp): void {
    if (d.error) {
      this.echouer(d.error);
      return;
    }
    (carte.getSource(SOURCE_CP) as maplibregl.GeoJSONSource | undefined)?.setData(d as unknown as GeoJSON.FeatureCollection);
    this.cleChargee = cle;
    this.etatInterne.set('pret');
    this.message.set(null);
    this.chiffres.emit({ n_total: d.n_total, n_affiches: d.n_affiches, n_retenus: d.n_retenus, taux_utile: d.taux_utile });
  }

  private echouer(message: string): void {
    this.etatInterne.set('echec');
    this.message.set(message);
    this.chiffres.emit(null);
  }

  private poserRayons(carte: maplibregl.Map, cle: string): void {
    if (carte.getLayer(ID_RAYONS_CP)) carte.removeLayer(ID_RAYONS_CP);
    if (carte.getSource(SOURCE_RAYONS_CP)) carte.removeSource(SOURCE_RAYONS_CP);
    this.rayonsPoses = cle;
    if (!cle) return;
    const natures = this.cleNatures() ? this.cleNatures().split(',') : [];
    carte.addSource(SOURCE_RAYONS_CP, {
      type: 'vector', tiles: [this.zonesApi.urlTuilesZones(this.codeProfil(), natures)],
      minzoom: ZONES_RISQUE_ZOOM_PLANCHER, maxzoom: 14,
    });
    carte.addLayer({
      id: ID_RAYONS_CP, type: 'line', source: SOURCE_RAYONS_CP, 'source-layer': COUCHE_TUILE,
      minzoom: ZONES_RISQUE_ZOOM_LISIBLE,
      paint: { 'line-color': this.teintes().rayons, 'line-width': 1, 'line-opacity': 0.9 },
    });
  }

  /** La bulle suit la souris sur les codes postaux, retenus ou écartés ; aucune requête. */
  private ecouterSurvol(carte: maplibregl.Map): void {
    carte.on('mousemove', (e: maplibregl.MapMouseEvent) => {
      const f = carte.queryRenderedFeatures(e.point, { layers: [ID_FOND_CP, ID_ECARTES_CP] })[0];
      if (!f) {
        this.bulle?.remove();
        carte.getCanvas().style.cursor = '';
        return;
      }
      carte.getCanvas().style.cursor = 'pointer';
      this.bulle ??= this.fabriquePopup({ closeButton: false, closeOnClick: false });
      this.bulle.setLngLat(e.lngLat).setDOMContent(contenuBulleCp((f.properties ?? {}) as Record<string, unknown>)).addTo(carte);
    });
  }
}
