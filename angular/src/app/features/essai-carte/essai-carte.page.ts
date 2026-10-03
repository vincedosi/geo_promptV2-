import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import maplibregl from 'maplibre-gl';
import { finalize } from 'rxjs';
import { type Bbox, bboxEnParametre } from '../../carte/bbox';
import { CarteComponent } from '../../carte/carte.component';
import { chargerParCadre } from '../../carte/charger-par-cadre';
import { contenuPopup, type LignePopup } from '../../carte/contenu-popup';
import { ChargementService } from '../../core/chargement/chargement.service';
import { messageErreurApi } from '../../core/http/erreurs';
import { formaterDecimal, formaterNombre, formaterNombreAbrege } from '../../core/format/nombre';
import { CouleursService } from '../../core/theme/couleurs.service';
import { CourbeComponent } from '../../graphiques/courbe.component';
import type { SerieCourbe } from '../../graphiques/option-courbe';
import { BandeauKpiComponent } from '../../ui/bandeau-kpi/bandeau-kpi.component';
import { BarreProgressionComponent } from '../../ui/barre-progression/barre-progression.component';
import { EntetePageComponent } from '../../ui/entete-page/entete-page.component';
import { KpiComponent } from '../../ui/kpi/kpi.component';
import { PerimeDirective } from '../../ui/perime/perime.directive';
import { type ReponseCourbe, ZonesRisqueApi } from '../risques/data/zones-risque.api';

/** Le profil par défaut du module risque : seuil haut 1/2/5 km, seuil bas 500 m/1 km, PPRT inclus. */
export const CODE_PROFIL_DEFAUT = 'h1000.2000.5000_b500.1000_a_L0_P1';

/** Étang de Berre : la vue initiale de CarteRisque.tsx. */
const CADRE_ETANG_DE_BERRE: Bbox = [4.75, 43.35, 5.3, 43.6];

const SOURCE_ZONES = 'zones';
const SOURCE_SITES = 'sites';
const COUCHE_ZONES = 'zones-fond';
const COUCHE_CONTOUR = 'zones-contour';
const COUCHE_SITES = 'sites-points';
/** Nom de la couche dans la tuile : `ST_AsMVT(t, 'zones_risque', …)` (sql/205, zones_risque_tuile). */
const COUCHE_TUILE = 'zones_risque';

/** Opacité par bande 1 à 4 (`OPACITE_BANDE`, lib/carte/palette-zones-risque.ts) et pour un PPRT (bande nulle). */
const OPACITE_BANDES = [0.45, 0.28, 0.16, 0.08] as const;
const OPACITE_PPRT = 0.5;
const OPACITE_FONDUE = 0.32;
const ZOOM_DETAIL = 10;
const ZOOM_LISIBLE = 7;
const RAYON_KPI_M = 5000;
const NB_NATURES = 8;

type Teintes = { haut: string; bas: string; autres: string };

/**
 * Page d'essai du lot 2 : les vraies zones (tuiles MVT), les vrais sites (GeoJSON
 * sur la bbox visible) et la vraie courbe de couverture, avec les briques
 * mg-carte et mg-courbe. Elle prouve la chaîne, elle ne remplace pas le module risque.
 */
@Component({
  selector: 'mg-essai-carte',
  imports: [BandeauKpiComponent, PerimeDirective, EntetePageComponent, BarreProgressionComponent, CarteComponent, CourbeComponent, KpiComponent, RouterLink],
  providers: [ChargementService],
  templateUrl: './essai-carte.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EssaiCartePage {
  private readonly api = inject(ZonesRisqueApi);
  private readonly chargement = inject(ChargementService);
  private readonly destruction = inject(DestroyRef);

  protected readonly cadre = CADRE_ETANG_DE_BERRE;

  protected readonly erreurCarte = signal<string | null>(null);
  protected readonly erreurZones = signal<string | null>(null);
  protected readonly erreurSites = signal<string | null>(null);
  protected readonly erreurCourbe = signal<string | null>(null);
  protected readonly reponseCourbe = signal<ReponseCourbe | null>(null);

  private readonly zonesEnCours = signal(false);
  private readonly sitesEnCours = signal(false);
  private readonly courbeEnCours = signal(true);

  private readonly couleurs = inject(CouleursService).palette({
    haut: 'niveau-haut', bas: 'niveau-bas', autres: 'niveau-autres', trait: 'text-primary',
  });
  private readonly carte = signal<maplibregl.Map | null>(null);
  private readonly zonesPosees = signal(false);

  protected readonly series = computed<SerieCourbe[]>(() => {
    let rang = 0;
    return (this.reponseCourbe()?.courbes ?? []).map((c) => {
      const points = c.points.map((p) => [p.r, p.p] as const);
      if (c.cle === '*') {
        return { cle: c.cle, libelle: 'Toutes natures', jeton: 'brand-teal', points, epaisseur: 2.2, etiquetee: true };
      }
      const jeton = `nature-${(rang % NB_NATURES) + 1}`;
      rang++;
      return { cle: c.cle, libelle: c.cle, jeton, points };
    });
  });
  protected readonly domaineX = computed<readonly [number, number] | undefined>(() => {
    const r = this.reponseCourbe();
    return r ? [100, r.rayon_max_m] : undefined;
  });
  protected readonly habitants5km = computed(() => {
    const totale = this.reponseCourbe()?.courbes.find((c) => c.cle === '*');
    const point = totale?.points.find((p) => p.r === RAYON_KPI_M);
    return formaterNombre(point?.p);
  });
  protected readonly nbSites = computed(() => {
    const r = this.reponseCourbe();
    return r ? formaterNombre(r.n_sites) : '—';
  });
  /** Le repère du rayon retenu : trait teal tireté, SANS libellé (React). */
  protected readonly repere = { x: RAYON_KPI_M };
  /** Graduations fixes de 1 à 10 km (Recharts : `ticks`). */
  protected readonly graduationsX = Array.from({ length: 10 }, (_, i) => (i + 1) * 1000);
  protected readonly formaterX = (x: number) => `${x / 1000} km`;
  protected readonly formaterY = formaterNombreAbrege;
  protected readonly formaterValeur = (y: number) => formaterNombre(y);
  protected readonly formaterTitre = (x: number) => `à moins de ${formaterDecimal(x / 1000)} km`;
  /** Étiquettes de population tous les kilomètres, décochées par défaut comme en React. */
  protected readonly etiquettes = signal(false);
  /** Vrai tant que la courbe se charge : les chiffres du bandeau décrivent alors un état périmé (K5). */
  protected readonly chargementCourbe = this.courbeEnCours.asReadonly();
  /**
   * TEXTE DE LA PAGE D'ESSAI, que le lot 3 remplace par celui de l'écran réel : la structure est celle de
   * `BandeauKpi.tsx` (« Ces six chiffres suivent les filtres et le profil. Survolez-en un pour sa définition. »),
   * mais ce bandeau n'a que deux tuiles et aucune définition en infobulle — la phrase ne promet donc que ce qui est vrai.
   */
  protected readonly consigneBandeau = 'Ces deux chiffres suivent le profil par défaut.';

  constructor() {
    this.chargement.suivre('zones', 'Préparation des zones', () => this.zonesEnCours());
    this.chargement.suivre('sites', 'Sites visibles', () => this.sitesEnCours());
    this.chargement.suivre('courbe', 'Courbe de couverture', () => this.courbeEnCours());

    // Désabonnement EXPLICITE et non `takeUntilDestroyed` : `@angular/core/rxjs-interop`
    // n'est pas partagé par un hôte AIDA par défaut, et sa copie lève NG0203
    // (tests/unit/angular/imports-partages.test.ts).
    const courbe = this.api.courbe('seveso_haut')
      .pipe(finalize(() => this.courbeEnCours.set(false)))
      .subscribe({
        next: (r) => this.reponseCourbe.set(r),
        error: (e: unknown) => this.erreurCourbe.set(messageErreurApi(e)),
      });
    this.destruction.onDestroy(() => courbe.unsubscribe());

    // Bascule de thème : on REPOSE les couleurs, on ne recrée ni la carte ni les sources
    // (les tuiles ne sont donc pas redemandées).
    effect(() => {
      const carte = this.carte();
      const c = this.couleurs();
      if (!carte) return;
      carte.setPaintProperty(COUCHE_SITES, 'circle-color', this.couleurSite(c));
      carte.setPaintProperty(COUCHE_SITES, 'circle-stroke-color', c.trait);
      if (this.zonesPosees()) {
        carte.setPaintProperty(COUCHE_ZONES, 'fill-color', this.couleurNiveau(c));
        carte.setPaintProperty(COUCHE_CONTOUR, 'line-color', this.couleurNiveau(c));
      }
    });
  }

  protected surCartePrete(carte: maplibregl.Map): void {
    this.carte.set(carte);
    this.poserSites(carte);
    this.zonesEnCours.set(true);
    const preparation = this.api.preparer(CODE_PROFIL_DEFAUT)
      .pipe(finalize(() => this.zonesEnCours.set(false)))
      .subscribe({
        // Les tuiles ne sont demandées QU'APRÈS la construction de la géométrie.
        next: () => this.poserZones(carte),
        error: (e: unknown) => this.erreurZones.set(messageErreurApi(e)),
      });
    this.destruction.onDestroy(() => preparation.unsubscribe());
  }

  private poserZones(carte: maplibregl.Map): void {
    const c = this.couleurs();
    carte.addSource(SOURCE_ZONES, {
      type: 'vector',
      tiles: [this.api.urlTuilesZones(CODE_PROFIL_DEFAUT)],
      minzoom: 4,
      maxzoom: 14,
    });
    // Sous les sites, pour qu'un point reste cliquable.
    carte.addLayer({
      id: COUCHE_ZONES, type: 'fill', source: SOURCE_ZONES, 'source-layer': COUCHE_TUILE,
      minzoom: ZOOM_LISIBLE,
      paint: {
        'fill-color': this.couleurNiveau(c) as never,
        'fill-opacity': ['step', ['zoom'], OPACITE_FONDUE, ZOOM_DETAIL, [
          'case',
          ['==', ['get', 'bande'], null], OPACITE_PPRT,
          ['==', ['get', 'bande'], 1], OPACITE_BANDES[0],
          ['==', ['get', 'bande'], 2], OPACITE_BANDES[1],
          ['==', ['get', 'bande'], 3], OPACITE_BANDES[2],
          OPACITE_BANDES[3],
        ]] as never,
      },
    }, COUCHE_SITES);
    carte.addLayer({
      id: COUCHE_CONTOUR, type: 'line', source: SOURCE_ZONES, 'source-layer': COUCHE_TUILE,
      minzoom: ZOOM_DETAIL,
      paint: { 'line-color': this.couleurNiveau(c) as never, 'line-width': 1, 'line-opacity': 0.9 },
    }, COUCHE_SITES);
    this.zonesPosees.set(true);
  }

  private poserSites(carte: maplibregl.Map): void {
    const c = this.couleurs();
    carte.addSource(SOURCE_SITES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    carte.addLayer({
      id: COUCHE_SITES, type: 'circle', source: SOURCE_SITES,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 13, 5.5],
        'circle-color': this.couleurSite(c) as never,
        'circle-stroke-color': c.trait,
        'circle-stroke-width': 1,
      },
    });
    carte.on('click', COUCHE_SITES, (e: maplibregl.MapLayerMouseEvent) => this.ouvrirPopup(carte, e));

    // UNE requête après l'arrêt du mouvement, sur la bbox visible — jamais sans bbox.
    const arreter = chargerParCadre(
      carte,
      (b) => {
        this.sitesEnCours.set(true);
        return this.api.sites(bboxEnParametre(b)).pipe(finalize(() => this.sitesEnCours.set(false)));
      },
      (fc) => {
        this.erreurSites.set(null);
        (carte.getSource(SOURCE_SITES) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
      },
      { surEchec: (e) => this.erreurSites.set(messageErreurApi(e)) },
    );
    this.destruction.onDestroy(arreter);
  }

  /** Propriétés lues dans la réponse réelle de /api/map/risques-industriels : nom, ville, statut_seveso, libelle_nature. */
  private ouvrirPopup(carte: maplibregl.Map, e: maplibregl.MapLayerMouseEvent): void {
    const p = (e.features?.[0]?.properties ?? {}) as Record<string, unknown>;
    const lignes: LignePopup[] = [];
    if (p['ville']) lignes.push({ libelle: 'Commune', valeur: String(p['ville']) });
    if (p['statut_seveso']) lignes.push({ libelle: 'Statut', valeur: String(p['statut_seveso']) });
    if (p['libelle_nature']) lignes.push({ libelle: 'Nature', valeur: String(p['libelle_nature']) });
    new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat(e.lngLat)
      .setDOMContent(contenuPopup(String(p['nom'] ?? 'Site sans nom'), lignes))
      .addTo(carte);
  }

  private couleurNiveau(c: Teintes): unknown[] {
    return ['match', ['get', 'niveau'], 'haut', c.haut, 'bas', c.bas, c.autres];
  }

  private couleurSite(c: Teintes): unknown[] {
    return ['match', ['get', 'gravite'], 'seveso_haut', c.haut, 'seveso_bas', c.bas, c.autres];
  }
}
