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

/** Délai de résolution d'une couche avant de la dire en échec (> `maxDuration` serveur, compilation à froid comprise). */
const DELAI_GEOMETRIE_MS = 50_000;
/** Le dialogue se ferme seul après la réussite, le temps de la lire. */
const FERMETURE_APRES_MS = 2000;

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
    };
    this.abonnements.push(this.api.capturer(corps).subscribe({
      next: (r) => {
        this.enCours.set(false);
        this.succes.set(`Zone sauvegardee — ${r.count_iris ?? 0} IRIS, ${r.count_cp ?? 0} CP resolus`);
        this.cree.emit();
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

/** « HTTP 500 <corps> » comme React (`fetchGeometryFromRoute`), le message d'une erreur sinon. */
function messageEchec(e: unknown): string {
  const r = e as { status?: number; error?: unknown; message?: string };
  if (typeof r.status === 'number' && r.status > 0) {
    const corps = typeof r.error === 'string' ? r.error : JSON.stringify(r.error ?? '');
    return `HTTP ${r.status} ${corps.slice(0, 200)}`;
  }
  return r.message || 'Erreur inconnue';
}
