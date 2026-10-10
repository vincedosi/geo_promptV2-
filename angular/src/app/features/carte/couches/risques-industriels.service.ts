import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { type Observable, type Subscription, of, tap } from 'rxjs';
import { type Bbox, bboxEnParametre } from '../../../carte/bbox';
import { chargerParCadre } from '../../../carte/charger-par-cadre';
import { FABRIQUE_POPUP, type PopupCarte } from '../../../carte/fabrique-carte';
import { messageErreurApi } from '../../../core/http/erreurs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { type CollectionSitesRisque, SitesRisqueApi } from '../../risques/data/sites-risque.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { RisqueCarteService } from '../etat/risque-carte.service';
import {
  COUCHE_RISQUES_HALO, COUCHE_RISQUES_POINT, COUCHE_RISQUES_ZONE, COUCHE_RISQUES_ZONE_CONTOUR, JETONS_RISQUES,
  SOURCE_RISQUES_POINTS, SOURCE_RISQUES_ZONES, poserCouchesRisques, repeindreCouchesRisques, retirerCouchesRisques,
  zonesDesSites,
} from './couche-risques';
import { type DonneesRichesSite, contenuPopupSite, donneesRiches, remplirExposition } from './popups-risques';

/**
 * La couche « Zones à risque industriel » de la carte principale : les sites ICPE de la carte VISIBLE, leur zone
 * calculée, leur halo et leur popup — portage de `app/map/_components/RisqueIndustrielLayer.tsx` (lot 4, T12). L'état
 * (filtres, compte) vit dans `RisqueCarteService`.
 *
 * ── LECTURE ──────────────────────────────────────────────────────────────
 * `GET /api/map/risques-industriels` sur la bbox VISIBLE (`chargerParCadre`) : immédiatement à l'allumage et à chaque
 * changement de filtre, puis 350 ms après la fin d'un déplacement ; la lecture précédente est ANNULÉE. Une lecture dont
 * la bbox ET les filtres sont ceux de la précédente n'est pas refaite : une carte recréée par un changement de fond
 * (B11) retrouve ses points sans nouvelle requête.
 *
 * ── CE QUI NE RELIT PAS (défauts React corrigés) ─────────────────────────
 * React rechargeait tout au changement de THÈME et à la bascule du HALO (les deux étaient dans les dépendances de son
 * effet). Ici le thème ne fait que repeindre (`setPaintProperty`, aucune source recréée) et le halo n'est qu'une
 * visibilité. Un `moveend` sans déplacement ne relit rien non plus. Un échec de lecture est DIT (`erreur`) — React se
 * taisait (`if (!res.ok) return`) — et les points précédents restent.
 *
 * « Tout effacer » ne touche PAS cette couche, comme React (`handleClearAllLayers`, `page.tsx:681-765`, n'en dit rien).
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class RisquesIndustrielsService {
  private readonly etat = inject(RisqueCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(SitesRisqueApi);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly document = inject(DOCUMENT);
  private readonly teintes = inject(CouleursService).palette(JETONS_RISQUES);

  /** L'échec de la dernière lecture, en français ; `null` après un succès. */
  readonly erreur = signal<string | null>(null);

  /** L'instance qui porte les couches ; `null` tant qu'aucune donnée n'est posée. */
  private readonly posee = signal<maplibregl.Map | null>(null);
  /** La clé des filtres qui partent en requête — le halo n'en fait pas partie (visibilité seule). */
  private readonly cle = computed(() => JSON.stringify([
    this.etat.niveaux(), this.etat.natures(), this.etat.inclureInactifs(), this.etat.rayonM(),
  ]));
  private derniere: { cle: string; charge: CollectionSitesRisque } | null = null;
  private riches = new Map<string, DonneesRichesSite>();
  private ecoutes: { carte: maplibregl.Map; retirer: () => void } | null = null;
  private popup: PopupCarte | null = null;
  private lectureExposition: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.lectureExposition?.unsubscribe();
      this.ecoutes?.retirer();
    });

    // Lecture : carte courante, couche allumée, filtres de requête.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const actif = this.etat.actif();
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
          (b) => this.lire(b, cle),
          (charge) => this.appliquer(carte, charge),
          { surEchec: (e) => this.erreur.set(messageErreurApi(e)) },
        );
      })));
      nettoyer(() => arreter?.());
    });

    // Réglages d'affichage (`RisqueIndustrielLayer.tsx:521-527`) : zone visible si un rayon est demandé, halo selon la
    // case — sans recréer les couches, sans requête.
    effect(() => {
      const carte = this.posee();
      const zone = this.etat.rayonM() > 0;
      const halo = this.etat.afficherHalo();
      if (!carte) return;
      const vis = (id: string, visible: boolean) => {
        if (carte.getLayer(id)) carte.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      };
      vis(COUCHE_RISQUES_ZONE, zone);
      vis(COUCHE_RISQUES_ZONE_CONTOUR, zone);
      vis(COUCHE_RISQUES_HALO, halo);
    });

    // Thème : les couleurs et le cerne (inversé entre thèmes) REPEINTS.
    effect(() => {
      // Le jeton n'est lu que si les couches existent (même règle que les autres couches).
      const carte = this.posee();
      if (carte) repeindreCouchesRisques(carte, this.teintes());
    });
  }

  private lire(b: Bbox, cle: string): Observable<CollectionSitesRisque> {
    const bbox = bboxEnParametre(b);
    const cleLecture = `${cle}|${bbox}`;
    if (this.derniere?.cle === cleLecture) return of(this.derniere.charge);
    return this.api.carte(bbox, {
      gravites: this.etat.niveaux(),
      natures: this.etat.natures(),
      inclureInactifs: this.etat.inclureInactifs(),
      rayonM: this.etat.rayonM(),
    }).pipe(tap((charge) => { this.derniere = { cle: cleLecture, charge }; }));
  }

  private appliquer(carte: maplibregl.Map, charge: CollectionSitesRisque): void {
    this.erreur.set(null);
    this.riches = donneesRiches(charge);
    poserCouchesRisques(carte, this.teintes());
    (carte.getSource(SOURCE_RISQUES_ZONES) as maplibregl.GeoJSONSource | undefined)?.setData(zonesDesSites(charge));
    (carte.getSource(SOURCE_RISQUES_POINTS) as maplibregl.GeoJSONSource | undefined)
      ?.setData({ type: 'FeatureCollection', features: charge.features });
    if (this.ecoutes?.carte !== carte) this.ecouter(carte);
    this.posee.set(carte);
    this.etat.compte.set({
      rendus: charge.n_rendus ?? charge.features.length,
      total: charge.n_total ?? 0,
      avecPprt: charge.n_avec_pprt ?? 0,
    });
  }

  /** Les écouteurs de la couche des points, posés UNE fois par instance (R-03 de React) et retirés à l'extinction. */
  private ecouter(carte: maplibregl.Map): void {
    this.ecoutes?.retirer();
    const clic = (e: maplibregl.MapLayerMouseEvent) => this.cliquer(carte, e);
    const entree = () => { carte.getCanvas().style.cursor = 'pointer'; };
    const sortie = () => { carte.getCanvas().style.cursor = ''; };
    carte.on('click', COUCHE_RISQUES_POINT, clic);
    carte.on('mouseenter', COUCHE_RISQUES_POINT, entree);
    carte.on('mouseleave', COUCHE_RISQUES_POINT, sortie);
    this.ecoutes = {
      carte,
      retirer: () => {
        carte.off('click', COUCHE_RISQUES_POINT, clic);
        carte.off('mouseenter', COUCHE_RISQUES_POINT, entree);
        carte.off('mouseleave', COUCHE_RISQUES_POINT, sortie);
      },
    };
  }

  /** La popup du site, ouverte TOUT DE SUITE ; la population exposée la remplit quand elle arrive (~300 ms). */
  private cliquer(carte: maplibregl.Map, e: maplibregl.MapLayerMouseEvent): void {
    const f = e.features?.[0];
    if (!f) return;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const id = String(p['id'] ?? '');
    const doc = carte.getContainer().ownerDocument ?? this.document;
    const { racine, exposition } = contenuPopupSite(p, this.riches.get(id), untracked(this.teintes), doc);
    this.popup?.remove();
    this.lectureExposition?.unsubscribe();
    const lieu = f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : e.lngLat;
    this.popup = this.fabriquePopup({ offset: 10, maxWidth: '340px' }).setLngLat(lieu).setDOMContent(racine).addTo(carte);
    if (!id) return;
    // Une réponse en retard n'écrit que dans SA popup : la lecture précédente est annulée au clic suivant.
    this.lectureExposition = this.api.exposition(id).subscribe({
      next: (charge) => remplirExposition(exposition, charge, null),
      error: (err: unknown) => {
        const corps = err instanceof HttpErrorResponse ? (err.error as { error?: unknown } | null) : null;
        remplirExposition(exposition, null,
          typeof corps?.error === 'string' && corps.error ? corps.error : 'Population exposée indisponible.');
      },
    });
  }

  /** Extinction (`nettoyer`, `RisqueIndustrielLayer.tsx:228-239`) : popup, écouteurs, couches, sources. */
  private eteindre(carte: maplibregl.Map): void {
    this.lectureExposition?.unsubscribe();
    this.popup?.remove();
    this.popup = null;
    this.ecoutes?.retirer();
    this.ecoutes = null;
    this.erreur.set(null);
    // Défaut React corrigé (revue 1) : le compte n'est pas gardé — rallumée sur une autre vue, la couche montrait
    // l'ancien « N sites » le temps de la lecture.
    this.etat.compte.set(null);
    retirerCouchesRisques(carte);
    this.posee.set(null);
  }
}
