import { DestroyRef, Injectable, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { type Observable, type Subscription, catchError, concatMap, forkJoin, from, map, of, switchMap } from 'rxjs';
import { ZonesCustomService } from '../couches/zones-custom.service';
import { ZonesCustomApi } from '../data/zones-custom.api';
import { type LignePlan, type ZonePlan, ligneZoneEntiere, lignesDesItems } from '../logique/zones/plan-media';

/** Zones lues ensemble, lot après lot : la règle des 3 appels simultanés au plus (`ZoneMediaPlanPanel.tsx:108-110`). */
const TAILLE_LOT = 3;

/**
 * Le plan média des zones affichées, côté PAGE (lot 4, T15) : quand le panneau droit s'ouvre, et les audiences qu'il
 * tabule. Le panneau (`mg-plan-media`), lui, ne garde que la saisie (budget, CPM, cible, répartition, campagne).
 *
 * ── OUVERTURE (`page.tsx:274-280`) ───────────────────────────────────────
 * La première zone affichée ouvre le panneau ; la croix le ferme et il reste fermé quand d'autres zones arrivent
 * (bouton « Plan média (n) » pour le rouvrir) ; plus aucune zone le ferme. Un `linkedSignal` sur le NOMBRE de zones :
 * il se recalcule quand ce nombre change, et `set(false)` (la croix) tient jusque-là.
 *
 * ── AUDIENCES : CACHE PAR ZONE, LECTURE PANNEAU OUVERT ───────────────────
 * Chaque zone donne ses lignes une fois (`/items-audience`, une ligne par item ; repli `GET /api/custom-geo/[id]`,
 * la zone entière) ; ajouter une zone ne relit que la nouvelle. Panneau fermé, rien n'est lu, comme React où le
 * panneau démonté ne lisait plus. Écart voulu : le cache vit ici, avec la page — React le perdait à chaque fermeture
 * du panneau et relisait toutes les zones (et le premier appel par zone peut coûter ~10 s de calcul serveur).
 *
 * ── TOTAUX NATIONAUX : UNE FOIS ──────────────────────────────────────────
 * React les relisait à chaque montage du panneau ; ils ne bougent qu'au ré-import des carreaux. Lus à la première
 * ouverture, relus seulement après un échec.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class PlanMediaService {
  private readonly api = inject(ZonesCustomApi);
  /** Les zones affichées, dans l'ordre d'affichage (`planZones`). */
  readonly zones = inject(ZonesCustomService).zonesAffichees;

  /** Le panneau est-il ouvert (`planPanelOpen`) ? `set(false)` pour la croix, `set(true)` pour « Plan média (n) ». */
  readonly ouvert = linkedSignal<number, boolean>({
    source: () => this.zones().length,
    computation: (n, precedent) => (n === 0 ? false : !precedent || precedent.source === 0 ? true : precedent.value),
  });
  /** Le panneau est affiché : ouvert ET au moins une zone (`planZones.length > 0 && planPanelOpen`). */
  readonly visible = computed(() => this.ouvert() && this.zones().length > 0);

  /** Les lignes du tableau, recomposées dans l'ordre d'affichage des zones. */
  readonly lignes = signal<LignePlan[]>([]);
  /** Des zones sont en lecture : le tableau affiche « Chargement des audiences… ». */
  readonly chargement = signal(false);
  /** Population France par clé de cible (`nationalTotals`), `null` tant qu'elle n'est pas lue. */
  readonly totaux = signal<Record<string, number> | null>(null);

  private readonly cache = new Map<string, LignePlan[]>();
  private lecture: Subscription | null = null;
  private lectureTotaux: Subscription | null = null;

  constructor() {
    effect((nettoyer) => {
      if (!this.visible()) return;
      const zones = this.zones();
      untracked(() => this.charger(zones));
      nettoyer(() => this.abandonner());
    });

    effect(() => {
      if (this.visible()) untracked(() => this.lireTotaux());
    });

    inject(DestroyRef).onDestroy(() => {
      this.abandonner();
      this.lectureTotaux?.unsubscribe();
    });
  }

  private charger(zones: readonly ZonePlan[]): void {
    const recomposer = () => this.lignes.set(zones.flatMap((z) => this.cache.get(z.id) ?? []));
    const manquantes = zones.filter((z) => !this.cache.has(z.id));
    if (!manquantes.length) {
      recomposer();
      return;
    }
    const lots: ZonePlan[][] = [];
    for (let i = 0; i < manquantes.length; i += TAILLE_LOT) lots.push(manquantes.slice(i, i + TAILLE_LOT));
    this.chargement.set(true);
    this.lecture = from(lots).pipe(concatMap((lot) => forkJoin(lot.map((z) => this.lireZone(z))))).subscribe({
      next: (resolues) => {
        for (const [id, lignes] of resolues) this.cache.set(id, lignes);
        recomposer();
      },
      complete: () => this.chargement.set(false),
    });
  }

  /** Les lignes d'une zone : ses items, sinon la zone entière ; une audience illisible donne une ligne sans valeur. */
  private lireZone(z: ZonePlan): Observable<[string, LignePlan[]]> {
    const zoneEntiere = () => this.api.zone(z.id).pipe(
      map((detail) => [ligneZoneEntiere(z, detail?.audience_stats)]),
      catchError(() => of([{ id: z.id, name: z.name, values: null }])),
    );
    return this.api.audienceItems(z.id).pipe(
      catchError(() => of(null)),
      switchMap((r) => {
        const items = lignesDesItems(z.id, r?.items);
        return items ? of(items) : zoneEntiere();
      }),
      map((lignes): [string, LignePlan[]] => [z.id, lignes]),
    );
  }

  private abandonner(): void {
    this.lecture?.unsubscribe();
    this.lecture = null;
    this.chargement.set(false);
  }

  private lireTotaux(): void {
    if (this.totaux() || this.lectureTotaux) return;
    this.lectureTotaux = this.api.totauxNationaux().subscribe({
      next: (r) => { if (r?.totals) this.totaux.set(r.totals); },
      error: () => { this.lectureTotaux = null; },
    });
  }
}
