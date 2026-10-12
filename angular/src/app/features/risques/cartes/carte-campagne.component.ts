import {
  ChangeDetectionStrategy, Component, DestroyRef, afterRenderEffect, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { type Observable, catchError, map, of, switchMap } from 'rxjs';
import { CADRE_METROPOLE, bboxEnParametre } from '../../../carte/bbox';
import { CarteComponent } from '../../../carte/carte.component';
import { chargerParCadre } from '../../../carte/charger-par-cadre';
import { FABRIQUE_POPUP, type PopupCarte } from '../../../carte/fabrique-carte';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { JeuxZonesApi } from '../data/jeux-zones.api';
import { SimulationApi } from '../data/simulation.api';
import { SimulationService } from '../etat/simulation.service';
import {
  BORNES_LEGENDE, type Collection, type GeometriesCampagne, JETONS_CAMPAGNE, L_BASSINS, L_BASSINS_CONTOUR, L_BASSINS_ETIQUETTE,
  L_CERCLES, L_CP, L_CP_CONTOUR, L_SITES, type LectureCampagne, S_BASSINS, S_CERCLES, S_CP, S_SITES, type TeintesCampagne,
  cadreDesZones, contenuBulleCampagne, fusionnerDiffusion, rampeDe, vide,
} from '../logique/carte-campagne';

/**
 * La carte de l'étape ⑤ : ce que la campagne a VRAIMENT diffusé, zone par zone — portage de `CarteCampagne.tsx`
 * (lot 3, T17).
 *
 * ── TROIS COUCHES ─────────────────────────────────────────────────────────
 *
 * 1. Les BASSINS colorés par leur indice de pression (part diffusée ÷ part du plan × 100) sur l'échelle divergente
 *    du Suivi — un bassin SANS indice est gris (`trancheIndice` rend -1), JAMAIS « conforme » ;
 * 2. un CERCLE par position de code postal, surface ∝ impressions, teal acheté en zone, gris en fuite ;
 * 3. les SITES, verts / orange / rouges selon la pression reçue par leur bassin (`etatSite`).
 * La bascule « Codes postaux » remplace les bassins par l'aplat des codes postaux, peint du même indice au CP.
 *
 * ── CE QUI SE RECHARGE, ET CE QUI NE SE RECHARGE PAS ──────────────────────
 *
 * Les GÉOMÉTRIES (bassins et sites par `/simulation/carte`, contours par `/cp-geo` en mode codes postaux) sont lues
 * sur la bbox VISIBLE (`?bbox=` obligatoire), immédiatement puis au `moveend` après 350 ms de calme (`chargerParCadre`,
 * requête précédente annulée), et seulement quand la carte est À L'ÉCRAN (`actif`). Les CHIFFRES viennent de
 * `SimulationService`, déjà chargés : changer de période ne fait partir AUCUNE requête, les couleurs changent par
 * `setData` sur les géométries en mémoire.
 *
 * ── LES COULEURS NE SUIVENT PAS LE THÈME ──────────────────────────────────
 *
 * Palette CLAIRE fixe (`paletteDuTheme(…, 'clair')`, A11), lue une fois : une bascule de thème ne repeint rien, ne
 * recrée aucune source et ne relit rien. Les couleurs voyagent dans les PROPRIÉTÉS des entités (`['get', 'couleur']`),
 * jamais `var()` dans `paint`. La légende est peinte avec la MÊME palette fixe (défaut React corrigé : sa légende
 * suivait le thème, donc ne ressemblait plus à la carte en thème sombre).
 */
@Component({
  selector: 'mg-carte-campagne',
  imports: [CarteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative flex min-h-0 min-w-0 flex-1' },
  template: `
    <mg-carte [cadre]="cadreInitial" (prete)="surPrete($event)" (erreur)="erreurCarte.set($event)" class="min-h-0 min-w-0 flex-1">
      <div class="absolute top-2.5 left-2.5 z-[3] flex flex-wrap gap-1.5">
        <div role="group" aria-label="Lecture de la carte" data-lecture
             class="flex items-center gap-0.5 rounded-lg border-fin border-default bg-[var(--card-overlay)] p-0.5">
          @for (l of lectures; track l.id) {
            <button type="button" (click)="mode.set(l.id)" [attr.aria-pressed]="mode() === l.id"
                    class="cursor-pointer rounded-md border-0 px-[9px] py-1 text-[11px]"
                    [class.bg-teal-10]="mode() === l.id" [class.text-teal]="mode() === l.id"
                    [class.bg-transparent]="mode() !== l.id" [class.text-secondary]="mode() !== l.id">{{ l.libelle }}</button>
          }
        </div>
        <label class="flex cursor-pointer items-center gap-1.5 rounded-lg border-fin border-default bg-[var(--card-overlay)] px-2 py-1 text-[11px] text-secondary">
          <input type="checkbox" data-impressions [checked]="cercles()" (change)="cercles.set($any($event.target).checked)" />
          Impressions
        </label>
      </div>

      @if (!vue()) {
        <div class="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center">
          <p data-sans-simulation class="m-0 flex items-center rounded-lg border-fin border-default bg-[var(--card-overlay)] px-3 py-2 text-[12px] text-secondary">
            Lancez une simulation pour voir la diffusion dans les zones.
          </p>
        </div>
      }

      <div data-legende-campagne
           class="absolute bottom-2.5 left-2.5 z-[3] flex max-w-[calc(100%-20px)] flex-col gap-1.5 rounded-[8px] border-fin border-default bg-[var(--card-overlay)] px-2.5 py-2">
        <span class="text-[10px] font-medium text-secondary">Indice de pression · part diffusée ÷ part du plan</span>
        <div>
          <div class="flex gap-0.5">
            @for (c of rampe(); track $index) {
              <span class="block h-2 w-[22px] rounded-[2px]" [style.background]="c"></span>
            }
          </div>
          <div class="flex justify-between px-3.5 font-mono text-[9px] text-tertiary">
            @for (b of bornes; track b) { <span>{{ b }}</span> }
          </div>
        </div>
        <div class="flex flex-wrap gap-2.5 text-[10px] text-tertiary">
          <span><span aria-hidden="true" class="mr-1 inline-block size-[9px] rounded-full align-[-1px]" [style.background]="teintes().teal"></span>Impressions, CP acheté</span>
          <span><span aria-hidden="true" class="mr-1 inline-block size-[9px] rounded-full align-[-1px]" [style.background]="teintes().fuite"></span>Fuite hors plan</span>
        </div>
        <div class="flex flex-wrap gap-2.5 text-[10px] text-tertiary">
          <span><span aria-hidden="true" class="mr-1 inline-block size-[7px] rounded-full align-[-1px]" [style.background]="teintes().servi"></span>Site servi</span>
          <span><span aria-hidden="true" class="mr-1 inline-block size-[7px] rounded-full align-[-1px]" [style.background]="teintes().partiel"></span>Partiel</span>
          <span><span aria-hidden="true" class="mr-1 inline-block size-[7px] rounded-full align-[-1px]" [style.background]="teintes().sousServi"></span>Sous-servi</span>
        </div>
      </div>
    </mg-carte>
    @if (erreurCarte(); as message) {
      <p role="alert" class="absolute right-2.5 bottom-[34px] z-[3] m-0 max-w-[300px] rounded-lg border-fin border-danger/25 bg-card-overlay px-[11px] py-[7px] text-[11px] leading-[1.5] text-danger">{{ message }}</p>
    }
  `,
})
export class CarteCampagneComponent {
  /** Vrai quand la carte est À L'ÉCRAN (étape ⑤) : masquée, sa bbox serait celle d'un conteneur de largeur nulle. */
  readonly actif = input(false);

  private readonly simulation = inject(SimulationService);
  private readonly simulationApi = inject(SimulationApi);
  private readonly jeuxApi = inject(JeuxZonesApi);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly couleurs = inject(CouleursService);

  /** Lue UNE fois (un `computed` sans dépendance) : la palette est fixe, aucun effet ne dépend du thème. */
  protected readonly teintes = computed<TeintesCampagne>(() => this.couleurs.paletteDuTheme(JETONS_CAMPAGNE, 'clair'));
  protected readonly rampe = computed(() => rampeDe(this.teintes()));
  protected readonly bornes = BORNES_LEGENDE;
  protected readonly cadreInitial = CADRE_METROPOLE;
  protected readonly lectures: { id: LectureCampagne; libelle: string }[] = [
    { id: 'bassins', libelle: 'Zones' }, { id: 'cp', libelle: 'Codes postaux' },
  ];

  protected readonly vue = this.simulation.vue;
  protected readonly mode = signal<LectureCampagne>('bassins');
  protected readonly cercles = signal(true);
  protected readonly erreurCarte = signal<string | null>(null);

  private readonly instance = signal<maplibregl.Map | null>(null);
  private readonly geo = signal<GeometriesCampagne>({ bassins: vide(), sites: vide(), cp: vide() });
  private cadrageFait = false;
  private bulle: PopupCarte | null = null;

  constructor() {
    // 1. Les géométries du cadre visible, quand la carte est à l'écran — relancées au changement de jeu ou de lecture
    //    (le mode « Codes postaux » ajoute `/cp-geo`). JAMAIS sur la période ni sur le thème. `afterRenderEffect` : la
    //    carte vient peut-être de passer de la largeur nulle à l'écran, le DOM doit être à jour avant `resize()`.
    afterRenderEffect((surNettoyage) => {
      const carte = this.instance();
      const jeu = this.simulation.jeu();
      const mode = this.mode();
      if (!carte || !jeu || !this.actif()) return;
      const arreter = untracked(() => {
        carte.resize();
        return chargerParCadre(carte, (b) => this.lire(jeu, mode, bboxEnParametre(b)), (g) => this.geo.set(g));
      });
      surNettoyage(arreter);
    });

    // 2. Premier cadrage sur les zones du jeu, une fois (padding 40, sans animation, zoom 9 au plus) — et SEULEMENT
    //    quand la carte est à l'écran. La carte reste montée en largeur nulle hors de l'étape ⑤ : un `fitBounds` sur
    //    ce conteneur-là calcule un zoom absurde, et le drapeau posé empêchait ensuite tout vrai cadrage. D'où
    //    `afterRenderEffect` (DOM à jour), `resize()` AVANT `fitBounds`, et le drapeau posé APRÈS un vrai cadrage.
    afterRenderEffect(() => {
      const carte = this.instance();
      const vue = this.vue();
      if (!carte || !vue || this.cadrageFait || !this.actif()) return;
      const cadre = cadreDesZones(vue.zones);
      if (!cadre) return;
      untracked(() => {
        carte.resize();
        carte.fitBounds([[cadre[0], cadre[1]], [cadre[2], cadre[3]]], { padding: 40, duration: 0, maxZoom: 9 });
      });
      this.cadrageFait = true;
    });

    // 3. Recadrage sur la zone choisie dans le tableau (600 ms, zoom 11 au plus, marge proportionnelle).
    effect(() => {
      const carte = this.instance();
      const id = this.simulation.zoneActive();
      const z = untracked(() => this.vue()?.zones.find((x) => x.id === id));
      if (!carte || !z?.bbox) return;
      const [o, s, e, n] = z.bbox;
      const pad = Math.max(e - o, n - s) * 0.4 + 0.08;
      untracked(() => carte.fitBounds([[o - pad, s - pad], [e + pad, n + pad]], { padding: 40, duration: 600, maxZoom: 11 }));
    });

    // 4. Les chiffres fusionnés dans les géométries en mémoire : `setData` et visibilités, aucune requête.
    //    Sans simulation (purgée, ou jamais lancée), les quatre sources sont VIDÉES : défaut React corrigé — sa carte
    //    gardait après une purge les bassins colorés et les cercles d'une diffusion qui n'existe plus.
    effect(() => {
      const carte = this.instance();
      const vue = this.vue();
      const geo = this.geo();
      const zoneActive = this.simulation.zoneActive();
      const mode = this.mode();
      const cercles = this.cercles();
      if (!carte) return;
      if (!vue) {
        untracked(() => {
          for (const s of [S_BASSINS, S_SITES, S_CERCLES, S_CP]) {
            (carte.getSource(s) as maplibregl.GeoJSONSource | undefined)?.setData(vide() as GeoJSON.FeatureCollection);
          }
        });
        return;
      }
      untracked(() => this.peindre(carte, fusionnerDiffusion(geo, vue, zoneActive, mode, cercles, this.teintes()), mode));
    });

    inject(DestroyRef).onDestroy(() => this.bulle?.remove());
  }

  protected surPrete(carte: maplibregl.Map): void {
    const t = this.teintes();
    for (const s of [S_BASSINS, S_SITES, S_CERCLES, S_CP]) carte.addSource(s, { type: 'geojson', data: vide() });
    carte.addLayer({ id: L_CP, type: 'fill', source: S_CP, paint: { 'fill-color': ['get', 'couleur'], 'fill-opacity': 0.72 } });
    carte.addLayer({ id: L_CP_CONTOUR, type: 'line', source: S_CP, paint: { 'line-color': ['get', 'contour'], 'line-width': 0.5 } });
    carte.addLayer({ id: L_BASSINS, type: 'fill', source: S_BASSINS, paint: { 'fill-color': ['get', 'couleur'], 'fill-opacity': 0.8 } });
    carte.addLayer({
      id: L_BASSINS_CONTOUR, type: 'line', source: S_BASSINS,
      paint: { 'line-color': ['get', 'contour'], 'line-width': ['get', 'epaisseur'] },
    });
    carte.addLayer({
      id: L_CERCLES, type: 'circle', source: S_CERCLES,
      paint: {
        'circle-color': ['get', 'couleur'], 'circle-opacity': 0.72,
        'circle-stroke-color': ['get', 'halo'], 'circle-stroke-width': 0.8,
        // Surface ∝ impressions : rayon ∝ racine. Le facteur suit le zoom pour que les cercles restent lisibles.
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          5, ['*', 10, ['get', 'r']], 9, ['*', 24, ['get', 'r']], 12, ['*', 40, ['get', 'r']]],
      },
    });
    carte.addLayer({
      id: L_SITES, type: 'circle', source: S_SITES,
      paint: {
        'circle-color': ['get', 'couleur'], 'circle-radius': 3.5,
        'circle-stroke-color': ['get', 'halo'], 'circle-stroke-width': 1,
      },
    });
    carte.addLayer({
      id: L_BASSINS_ETIQUETTE, type: 'symbol', source: S_BASSINS,
      layout: { 'text-field': ['get', 'etiquette'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-allow-overlap': false },
      // Texte foncé sur halo clair : le fond Positron est clair dans les deux thèmes.
      paint: { 'text-color': t.actif, 'text-halo-color': t.halo, 'text-halo-width': 1.4 },
    });
    this.ecouter(carte);
    this.instance.set(carte);
  }

  /** Bassins et sites du cadre ; en mode « Codes postaux », leurs contours aussi (un échec de ceux-ci les laisse vides). */
  private lire(jeu: string, mode: LectureCampagne, bbox: string): Observable<GeometriesCampagne> {
    return this.simulationApi.carte(jeu, bbox).pipe(
      switchMap((fc) => {
        const features = (fc.features ?? []) as Collection['features'];
        const bassins: Collection = { type: 'FeatureCollection', features: features.filter((f) => f.properties?.['type'] === 'bassin') };
        const sites: Collection = { type: 'FeatureCollection', features: features.filter((f) => f.properties?.['type'] === 'site') };
        if (mode !== 'cp') return of({ bassins, sites, cp: vide() });
        return this.jeuxApi.cpGeo(jeu, bbox).pipe(
          map((d) => ({ bassins, sites, cp: (d.error ? vide() : d) as unknown as Collection })),
          catchError(() => of({ bassins, sites, cp: vide() })),
        );
      }),
    );
  }

  private peindre(carte: maplibregl.Map, f: ReturnType<typeof fusionnerDiffusion>, mode: LectureCampagne): void {
    const ecrire = (s: string, d: Collection) =>
      (carte.getSource(s) as maplibregl.GeoJSONSource | undefined)?.setData(d as GeoJSON.FeatureCollection);
    ecrire(S_BASSINS, f.bassins);
    ecrire(S_SITES, f.sites);
    ecrire(S_CERCLES, f.cerclesFc);
    ecrire(S_CP, f.cp);
    for (const id of [L_BASSINS, L_BASSINS_CONTOUR, L_BASSINS_ETIQUETTE]) {
      carte.setLayoutProperty(id, 'visibility', mode === 'bassins' ? 'visible' : 'none');
    }
    for (const id of [L_CP, L_CP_CONTOUR]) carte.setLayoutProperty(id, 'visibility', mode === 'cp' ? 'visible' : 'none');
  }

  /** Bulle au survol (aucune requête), clic sur un bassin → zone active. */
  private ecouter(carte: maplibregl.Map): void {
    const effacer = () => {
      this.bulle?.remove();
      carte.getCanvas().style.cursor = '';
    };
    carte.on('mousemove', (e: maplibregl.MapMouseEvent) => {
      const f = carte.queryRenderedFeatures(e.point, { layers: [L_SITES, L_CERCLES, L_BASSINS, L_CP] })[0];
      if (!f) {
        effacer();
        return;
      }
      const couche = f.layer.id;
      carte.getCanvas().style.cursor = couche === L_BASSINS ? 'pointer' : '';
      const contenu = contenuBulleCampagne(couche, (f.properties ?? {}) as Record<string, unknown>, this.vue()?.zones ?? []);
      if (!contenu) return;
      this.bulle ??= this.fabriquePopup({ closeButton: false, closeOnClick: false, maxWidth: '260px' });
      this.bulle.setLngLat(e.lngLat).setDOMContent(contenu).addTo(carte);
    });
    carte.on('click', (e: maplibregl.MapMouseEvent) => {
      const f = carte.queryRenderedFeatures(e.point, { layers: [L_BASSINS] })[0];
      if (f) this.simulation.zoneActive.set(String(f.properties?.['id']));
    });
    // `mouseout` : MapLibre l'émet quand le pointeur quitte le canevas (React écoutait `mouseleave` sur le canevas).
    carte.on('mouseout', effacer);
  }
}
