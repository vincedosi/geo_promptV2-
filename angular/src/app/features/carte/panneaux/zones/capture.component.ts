import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, output, signal, viewChild,
} from '@angular/core';
import { type Observable, type Subscription, catchError, defer, forkJoin, map, of, throwError, timeout } from 'rxjs';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CaptureService, type SourceCapture } from '../../etat/capture.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import {
  type MetaBataille, TRANSFORMATIONS, type TransformationCapture, aplatir, compterSommets, enrichissementBataille, sourceTypeCapture,
  texteBbox,
} from '../../logique/zones/capture';
import type { Recette } from '../../logique/zones/recette';

/** Délai de résolution d'une couche avant de la dire en échec (> `maxDuration` serveur, compilation à froid comprise). */
const DELAI_GEOMETRIE_MS = 50_000;
/** Le dialogue se ferme seul après la réussite, le temps de la lire. */
const FERMETURE_APRES_MS = 2000;

/** Le repli de chaque avertissement d'un 207 de `/api/custom-geo/capture` quand la route n'écrit pas de `message`. */
const AVERTISSEMENTS_CAPTURE: Readonly<Record<string, string>> = {
  recette_non_enregistree: 'Zone sauvegardée, mais sa recette n’a pas pu être enregistrée.',
  zone_created_but_resolution_failed: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.',
};

/** Une couche après résolution : ses géométries, ou la raison de son échec. */
interface Collecte { source: SourceCapture; geometries: GeoJSON.Geometry[]; erreur: string | null }

/**
 * « Sauvegarder la vue comme zone custom » — `components/custom-geo/CustomGeoCaptureModal.tsx` (lot 4, T16), textes
 * exacts (sans accents, comme React).
 *
 * À l'ouverture, la géométrie de chaque couche contributive allumée est demandée (au plus trois appels à la fois, par
 * le limiteur), chacune isolée : un échec ou un dépassement de délai n'emporte que sa couche, les autres restent
 * capturables. Puis `/api/custom-geo/capture` ÉCRIT la zone fusionnée selon la transformation choisie.
 *
 * `<dialog>` natif dans la racine d'ombre (B13), jamais le voile `position: fixed` de React. Échap, voile et croix
 * ferment, sauf pendant la sauvegarde. Défaut de React corrigé : la zone capturée n'apparaissait pas dans « Mes
 * zones » avant de rouvrir le panneau — `cree` la fait relire.
 *
 * Lot 3 (T11) : le corps porte en plus une recette FIGÉE (`recetteCapture`) — `isochrone` pour une bataille,
 * `capture` sinon — que la route écrit sur la zone. Les isochrones et la bataille se lancent toujours à l'étape ④.
 */
@Component({
  selector: 'mg-capture',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './capture.component.html',
  styleUrl: './capture.component.css',
})
export class CaptureComponent {
  private readonly api = inject(ZonesCustomApi);
  private readonly annonce = inject(AnnonceService);
  protected readonly creation = inject(CreationZoneService);

  readonly fermer = output<void>();
  /** La zone est enregistrée : « Mes zones » se relit. */
  readonly cree = output<void>();

  protected readonly transformations = TRANSFORMATIONS;
  protected readonly nom = signal('');
  protected readonly description = signal('');
  protected readonly transformation = signal<TransformationCapture>('union');
  protected readonly resolution = signal(true);
  private readonly collectes = signal<Collecte[]>([]);
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly succes = signal<string | null>(null);
  /** L'avertissement d'un 207 (`body.message` de la route, sinon un repli selon `warning`). */
  protected readonly avertissement = signal<string | null>(null);

  protected readonly valides = computed(() => this.collectes().filter((c) => !c.erreur));
  protected readonly echecs = computed(() => {
    const e = this.collectes().filter((c) => c.erreur);
    if (e.length === 0) return null;
    return {
      titre: `${e.length} layer${e.length > 1 ? 's' : ''} non capture${e.length > 1 ? 's' : ''} :`,
      detail: e.map((c) => `${c.source.label} (${c.erreur})`).join(' · '),
    };
  });
  private readonly geometries = computed(() => this.valides().flatMap((c) => c.geometries));
  protected readonly sommets = computed(() => compterSommets(this.geometries()).toLocaleString('fr-FR'));
  protected readonly bbox = computed(() => texteBbox(this.geometries()));
  protected readonly sourceType = computed(() => sourceTypeCapture(this.valides().map((c) => c.source.sourceType)));
  /** Une bataille à plusieurs POI : ses POI rappelés sous le nom (`battleLayer`). */
  private readonly bataille = computed(() => {
    const c = this.valides().find((v) => v.source.sourceType === 'isochrone_battle');
    return c ? enrichissementBataille(c.source.metadata as MetaBataille) : null;
  });
  protected readonly poisBataille = computed(() => {
    const pois = this.bataille()?.enrichissement['pois'] as { poi_id: string; poi_name: string }[] | undefined;
    return pois && pois.length > 1 ? pois : null;
  });
  protected readonly sansOrganisation = computed(() => this.creation.org() === null);
  protected readonly possible = computed(() =>
    !!this.nom().trim() && this.geometries().length > 0 && !!this.creation.org() && !this.enCours() && !this.succes() && !this.resolution());
  protected readonly libelleSauver = computed(() =>
    this.enCours() ? 'Sauvegarde...' : this.resolution() ? 'Chargement...' : 'Sauvegarder');

  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');
  private abonnements: Subscription[] = [];
  private minuterie: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    afterNextRender(() => {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
    });
    const hote = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.minuterie);
      for (const a of this.abonnements) a.unsubscribe();
      const d = hote.querySelector('dialog');
      if (d?.open) d.close();
    });
    this.resoudre(inject(CaptureService).sources());
  }

  protected sauver(): void {
    if (!this.possible()) return;
    this.enCours.set(true);
    this.erreur.set(null);
    const valides = this.valides();
    const bataille = this.bataille();
    const corps = {
      name: this.nom().trim(),
      description: this.description().trim() || null,
      org_id: this.creation.org(),
      source_type: this.sourceType(),
      source_metadata: {
        ...bataille?.enrichissement,
        contributing_layers: valides.map((c) => ({
          id: c.source.id, source_type: c.source.sourceType, label: c.source.label, metadata: c.source.metadata,
        })),
      },
      geometries: this.geometries(),
      transformation: this.transformation(),
      ...(bataille?.sousZones ? { subzones: bataille.sousZones } : {}),
      recette: recetteCapture(bataille?.enrichissement ?? null, this.sourceType()),
    };
    this.abonnements.push(this.api.capturer(corps).subscribe({
      next: (r) => {
        this.enCours.set(false);
        this.succes.set(`Zone sauvegardee — ${r.count_iris ?? 0} IRIS, ${r.count_cp ?? 0} CP resolus`);
        this.cree.emit();
        // 207 : la zone EXISTE (elle est relue), mais quelque chose manque — dit, et le dialogue reste ouvert pour
        // être lu (pas de fermeture automatique) ; « Sauvegarder » reste inactif, aucun second envoi.
        if (r.warning) {
          this.avertissement.set(r.message ?? AVERTISSEMENTS_CAPTURE[r.warning] ?? 'Zone sauvegardée, avec un avertissement.');
          return;
        }
        this.minuterie = setTimeout(() => this.fermer.emit(), FERMETURE_APRES_MS);
      },
      error: (e: { status?: number; error?: { message?: string; error?: string } | null }) => {
        this.enCours.set(false);
        this.erreur.set(e.status ? (e.error?.message ?? e.error?.error ?? 'Erreur de sauvegarde') : 'Erreur reseau');
      },
    }));
  }

  /** Croix, Annuler, voile, Échap : rien pendant la sauvegarde. */
  protected demanderFermeture(): void {
    if (!this.enCours()) this.fermer.emit();
  }

  /** Échap : consommé (le panneau derrière reste ouvert). */
  protected echap(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.demanderFermeture();
  }

  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement) this.demanderFermeture();
  }

  /** Chaque couche résolue isolément ; un résultat partiel est annoncé (le `toast.warning` de React). */
  private resoudre(sources: SourceCapture[]): void {
    if (sources.length === 0) {
      this.resolution.set(false);
      return;
    }
    this.abonnements.push(forkJoin(sources.map((s) => this.collecter(s))).subscribe((collectes) => {
      this.collectes.set(collectes);
      this.resolution.set(false);
      const echecs = collectes.filter((c) => c.erreur);
      if (echecs.length > 0 && echecs.length < collectes.length) {
        const n = echecs.length;
        this.annonce.annoncer(`${n} layer${n > 1 ? 's' : ''} indisponible${n > 1 ? 's' : ''} — Capture possible avec les autres. `
          + `Non récupérés : ${echecs.map((c) => c.source.label).join(', ')}.`);
      } else if (echecs.length === collectes.length) {
        this.annonce.annoncer('Toutes les géométries ont échoué — Réessayez ou réduisez la zone. Aucune sauvegarde possible.');
      }
    }));
  }

  private collecter(source: SourceCapture): Observable<Collecte> {
    const o = source.obtenir;
    const geometrie$ = 'locale' in o
      ? defer(() => of(o.locale()))
      : defer(() => {
        const corps = o.corps();
        return corps ? this.api.source(o.route, corps).pipe(map((r) => r.geometry ?? null)) : of(null);
      });
    return geometrie$.pipe(
      timeout({ first: DELAI_GEOMETRIE_MS, with: () => throwError(() => new Error(`Timeout ${DELAI_GEOMETRIE_MS}ms — ${source.label}`)) }),
      map((g): Collecte => {
        const geometries = aplatir(g);
        return { source, geometries, erreur: geometries.length ? null : 'Aucune géométrie retournée' };
      }),
      catchError((e: unknown) => of({ source, geometries: [], erreur: messageEchec(e) })),
    );
  }
}

/** Une valeur de paramètre qu'une recette `isochrone` admet (`recette-schema.ts` : chaîne ≤ 200, nombre, booléen). */
const parametreAdmis = (v: unknown): v is string | number | boolean =>
  (typeof v === 'string' && v.length <= 200) || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';

/**
 * La recette FIGÉE de la capture (lot 3, T11 — L3-5) : une bataille capturée SEULE devient `{ type: 'isochrone' }`,
 * ses paramètres étant les clés SCALAIRES de son enrichissement (`enrichissementBataille` : `cache_key`, `category`,
 * `mode`, `poi_count` — les noms réels ; il n'y a ni `minutes` ni `version` dans la métadonnée de la couche), plus ses
 * `paliers` joints en chaîne (« 5,10,15 » : un tableau n'est pas un paramètre admis). Les POI, eux, restent dans
 * `source_metadata` et les sous-zones. `cache_key` n'est qu'une PROVENANCE : le cache peut avoir été purgé, la
 * recette ne se rejoue pas.
 *
 * Toute autre capture devient `{ type: 'capture' }` et nomme sa source : une bataille sans POI (pas d'enrichissement),
 * et une capture MIXTE (bataille + autre couche, `composite`) — sa forme n'est pas que des isochrones. Ni l'une ni
 * l'autre ne se recalcule.
 */
export function recetteCapture(enrichissement: Record<string, unknown> | null, sourceType: string): Recette {
  if (!enrichissement || sourceType !== 'isochrone_battle') return { v: 1, type: 'capture', source_type: sourceType };
  const { paliers, ...autres } = enrichissement;
  const chaine = Array.isArray(paliers) && paliers.length > 0 ? { paliers: paliers.join(',') } : {};
  const parametres = Object.fromEntries(
    Object.entries({ ...autres, ...chaine })
      .filter((e): e is [string, string | number | boolean] => parametreAdmis(e[1]))
      .slice(0, 20),
  );
  return { v: 1, type: 'isochrone', parametres };
}

/** « HTTP 500 <corps> » comme React (`fetchGeometryFromRoute`), le message d'une erreur sinon. */
function messageEchec(e: unknown): string {
  const r = e as { status?: number; error?: unknown; message?: string };
  if (typeof r.status === 'number' && r.status > 0) {
    const corps = typeof r.error === 'string' ? r.error : JSON.stringify(r.error ?? '');
    return `HTTP ${r.status} ${corps.slice(0, 200)}`;
  }
  return r.message || 'Erreur inconnue';
}
