import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { type Observable, map, of, tap } from 'rxjs';
import { type Bbox, bboxEnParametre } from '../../../carte/bbox';
import { chargerParCadre } from '../../../carte/charger-par-cadre';
import { FABRIQUE_POPUP, type PopupCarte } from '../../../carte/fabrique-carte';
import { messageErreurApi } from '../../../core/http/erreurs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi, type CollectionPprt } from '../data/carte.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { RisqueCarteService } from '../etat/risque-carte.service';
import { JETON_PPRT } from '../logique/pprt';
import { PPRT_ZOOM_PLANCHER } from '../logique/versions';
import { COUCHE_PPRT_FOND, SOURCE_PPRT, poserCouchesPprt, repeindreCouchesPprt, retirerCouchesPprt } from './couche-risques';
import { contenuPopupPprt } from './popups-risques';

/** Ce que rend une lecture : la collection, ou « sous le plancher » (aucune requête). */
type LecturePprt = { sousLePlancher: true } | { sousLePlancher: false; charge: CollectionPprt };

const VIDE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * La couche « Périmètre PPRT » — les servitudes d'utilité publique PM3 —, portage de `app/map/_components/PprtLayer.tsx`
 * (lot 4, T12). Couche INDÉPENDANTE des sites ICPE : on peut afficher les périmètres sans les points, et l'inverse.
 *
 * ── LE PLANCHER DE ZOOM ──────────────────────────────────────────────────
 * Sous `PPRT_ZOOM_PLANCHER` (8), une zone mesure moins d'un pixel : AUCUNE requête, la source est vidée (pas
 * supprimée : la recréer à chaque franchissement ferait clignoter la couche), et `pprtEtat.sousLePlancher` le dit au
 * panneau — sinon une case cochée ne produirait rien.
 *
 * ── LECTURE ──────────────────────────────────────────────────────────────
 * `GET /api/map/pprt` sur la bbox VISIBLE (`chargerParCadre` : immédiat, puis 350 ms après un déplacement, l'ancienne
 * lecture annulée). Même bbox et mêmes types que la lecture précédente : rien n'est redemandé (carte recréée, B11).
 * Le thème ne fait que repeindre — React relisait à chaque bascule (défaut corrigé). Un échec est DIT (`erreur`).
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class PprtService {
  private readonly etat = inject(RisqueCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(CarteApi);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly document = inject(DOCUMENT);
  private readonly teintes = inject(CouleursService).palette(JETON_PPRT);

  readonly erreur = signal<string | null>(null);

  private readonly posee = signal<maplibregl.Map | null>(null);
  private readonly cle = computed(() => this.etat.pprtTypes().join(','));
  private derniere: { cle: string; charge: CollectionPprt } | null = null;
  private ecoutes: { carte: maplibregl.Map; retirer: () => void } | null = null;
  private popup: PopupCarte | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.ecoutes?.retirer());

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const actif = this.etat.pprtActif();
      const cle = this.cle();
      if (!carte) {
        this.posee.set(null);
        return;
      }
      if (!actif) {
        untracked(() => this.eteindre(carte));
        return;
      }
      let arreter: (() => void) | null = null;
      nettoyer(quandStyleCharge(carte, () => untracked(() => {
        arreter = chargerParCadre(
          carte,
          (b) => this.lire(carte, b, cle),
          (lecture) => this.appliquer(carte, lecture),
          { surEchec: (e) => this.erreur.set(messageErreurApi(e)) },
        );
      })));
      nettoyer(() => arreter?.());
    });

    effect(() => {
      // Le jeton n'est lu que si les couches existent (même règle que les autres couches).
      const carte = this.posee();
      if (carte) repeindreCouchesPprt(carte, this.teintes());
    });
  }

  private lire(carte: maplibregl.Map, b: Bbox, cle: string): Observable<LecturePprt> {
    if (carte.getZoom() < PPRT_ZOOM_PLANCHER) return of({ sousLePlancher: true });
    const bbox = bboxEnParametre(b);
    const cleLecture = `${cle}|${bbox}`;
    if (this.derniere?.cle === cleLecture) return of({ sousLePlancher: false, charge: this.derniere.charge });
    return this.api.pprt(bbox, this.etat.pprtTypes()).pipe(
      tap((charge) => { this.derniere = { cle: cleLecture, charge }; }),
      map((charge): LecturePprt => ({ sousLePlancher: false, charge })),
    );
  }

  private appliquer(carte: maplibregl.Map, lecture: LecturePprt): void {
    this.erreur.set(null);
    if (lecture.sousLePlancher) {
      (carte.getSource(SOURCE_PPRT) as maplibregl.GeoJSONSource | undefined)?.setData(VIDE);
      this.etat.pprtEtat.set({ sousLePlancher: true, rendus: 0, total: 0 });
      return;
    }
    const charge = lecture.charge;
    poserCouchesPprt(carte, this.teintes());
    (carte.getSource(SOURCE_PPRT) as maplibregl.GeoJSONSource | undefined)
      ?.setData({ type: 'FeatureCollection', features: charge.features });
    if (this.ecoutes?.carte !== carte) this.ecouter(carte);
    this.posee.set(carte);
    this.etat.pprtEtat.set({
      sousLePlancher: false,
      rendus: charge.n_rendus ?? charge.features.length,
      total: charge.n_total ?? 0,
    });
  }

  private ecouter(carte: maplibregl.Map): void {
    this.ecoutes?.retirer();
    const clic = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const doc = carte.getContainer().ownerDocument ?? this.document;
      this.popup?.remove();
      this.popup = this.fabriquePopup({ offset: 10, maxWidth: '340px' })
        .setLngLat(e.lngLat)
        .setDOMContent(contenuPopupPprt((f.properties ?? {}) as Record<string, unknown>, doc))
        .addTo(carte);
    };
    const entree = () => { carte.getCanvas().style.cursor = 'pointer'; };
    const sortie = () => { carte.getCanvas().style.cursor = ''; };
    carte.on('click', COUCHE_PPRT_FOND, clic);
    carte.on('mouseenter', COUCHE_PPRT_FOND, entree);
    carte.on('mouseleave', COUCHE_PPRT_FOND, sortie);
    this.ecoutes = {
      carte,
      retirer: () => {
        carte.off('click', COUCHE_PPRT_FOND, clic);
        carte.off('mouseenter', COUCHE_PPRT_FOND, entree);
        carte.off('mouseleave', COUCHE_PPRT_FOND, sortie);
      },
    };
  }

  /** Extinction (`nettoyer`, `PprtLayer.tsx:93-103`) : couches, source, popup, écouteurs. */
  private eteindre(carte: maplibregl.Map): void {
    this.popup?.remove();
    this.popup = null;
    this.ecoutes?.retirer();
    this.ecoutes = null;
    this.erreur.set(null);
    retirerCouchesPprt(carte);
    this.posee.set(null);
  }
}
