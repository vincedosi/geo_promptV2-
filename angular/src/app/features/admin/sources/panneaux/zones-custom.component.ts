import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import type { OrganisationListe } from '../../commun/data/organisations-liste.api';
import { SourcesAdminApi, type ZoneAdmin } from '../data/sources-admin.api';
import { DialogueSuppressionZoneComponent } from './dialogue-suppression-zone.component';
import { erreurDuCorps, estCoupure } from '../../commun/erreurs-http';

/** Anti-rebond de la recherche (`useAdminCustomZones.ts:56` : 200 ms s'il y a une recherche, sinon 0). */
const DELAI_RECHERCHE = 200;

/** `fmtDate` de `ZonesTableRow.tsx:14-16`. */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

const pluriel = (n: number) => (n > 1 ? 's' : '');

/**
 * Onglet « Zones perso » des Sources — portage de `CustomZonesTab/*` et de `useAdminCustomZones.ts`
 * (lot 6, T20) : les zones perso de TOUS les espaces, filtrables par espace, type et nom, et leur
 * suppression.
 *
 * Lectures : la liste à la création (chaque visite de l'onglet, comme React qui remonte l'onglet), puis
 * à chaque filtre — tout de suite pour un espace ou un type, 200 ms après la dernière frappe pour la
 * recherche. Les espaces du filtre sont fournis par la page (`organisations`), qui les lit UNE fois par
 * écran (amendement A2 ; React les relisait à chaque montage de `WorkspaceFilter`). Les types sont
 * DÉRIVÉS des zones lues (aucune liste en dur, `index.tsx:28-33`).
 *
 * Écarts à React, voulus :
 * - une lecture remplacée par une plus récente est ANNULÉE (React laissait les réponses arriver dans le
 *   désordre : une frappe rapide pouvait afficher le résultat d'une recherche périmée).
 * - le dialogue de suppression est un `<dialog>` (C6) et l'erreur de suppression y est affichée, au
 *   lieu du toast `position: fixed` (interdit dans l'ombre, et caché sous le voile du dialogue modal) —
 *   voir `mg-dialogue-suppression-zone`.
 * - corbeille au survol et filtres : CSS (`:hover`, `:focus-visible`), sans écouteur ; libellé
 *   accessible « Supprimer la zone » (React : `title` seul) ; champ de recherche nommé.
 * - un espace ou un type choisi relit TOUT DE SUITE, même avec une recherche saisie : React attendait alors les
 *   200 ms de son anti-rebond, qui couvrait les trois filtres (`useAdminCustomZones.ts:56`) — écart listé (D13).
 * - couleurs (C9) : `rgba(255,87,87,0.1|0.2|0.08)` → `--danger` à 10 / 20 / 8 %.
 *
 * Gardés par parité : textes sans accents (« Aucune zone personnalisee… »), en-têtes en capitales
 * (`textTransform: uppercase` de React), « Erreur : HTTP <statut> » sans le corps de la route, nombres
 * en `fr-FR` (par `formaterNombre`, la source unique de CLAUDE.md — même sortie que `toLocaleString('fr-FR')`
 * de React), rayon 4 px.
 */
@Component({
  selector: 'mg-sources-zones',
  imports: [DialogueSuppressionZoneComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './zones-custom.component.html',
  styleUrl: './zones-custom.component.css',
})
export class ZonesCustomComponent {
  private readonly api = inject(SourcesAdminApi);
  private lecture: Subscription | null = null;
  private minuterie: ReturnType<typeof setTimeout> | undefined;

  /** Les espaces du filtre, lus une fois par écran par la page (`WorkspaceFilter`). */
  readonly organisations = input<readonly OrganisationListe[]>([]);

  protected readonly orgFiltre = signal<string | null>(null);
  protected readonly typeFiltre = signal<string | null>(null);
  protected readonly recherche = signal('');
  protected readonly zones = signal<ZoneAdmin[]>([]);
  protected readonly chargement = signal(false);
  protected readonly erreur = signal<string | null>(null);
  /** La zone visée par le dialogue de suppression (`deleteTarget`). */
  protected readonly aSupprimer = signal<ZoneAdmin | null>(null);
  protected readonly suppressionEnCours = signal(false);
  protected readonly erreurSuppression = signal<string | null>(null);

  protected readonly types = computed(() => [...new Set(this.zones().map((z) => z.source_type))].sort());
  protected readonly filtresActifs = computed(() => !!(this.orgFiltre() || this.typeFiltre() || this.recherche()));

  protected readonly entete = computed(() => {
    const n = this.zones().length;
    const w = new Set(this.zones().map((z) => z.org_id)).size;
    return `Zones perso — ${n} zone${pluriel(n)} sur ${w} workspace${pluriel(w)}`;
  });

  protected readonly pied = computed(() => {
    const z = this.zones();
    const iris = z.reduce((s, x) => s + x.feature_count_iris, 0);
    const cp = z.reduce((s, x) => s + x.feature_count_cp, 0);
    return `${this.filtresActifs() ? 'Filtres actifs : ' : ''}${z.length} zone${pluriel(z.length)} — `
      + `${formaterNombre(iris)} IRIS — ${formaterNombre(cp)} CP résolus`;
  });

  protected readonly lignes = computed(() => this.zones().map((z) => ({
    zone: z,
    iris: formaterNombre(z.feature_count_iris),
    cp: formaterNombre(z.feature_count_cp),
    date: fmtDate(z.created_at),
  })));

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.minuterie);
      this.lecture?.unsubscribe();
    });
    this.lire();
  }

  protected choisirOrg(e: Event): void {
    this.orgFiltre.set((e.target as HTMLSelectElement).value || null);
    this.relire(0);
  }

  protected choisirType(e: Event): void {
    this.typeFiltre.set((e.target as HTMLSelectElement).value || null);
    this.relire(0);
  }

  protected saisirRecherche(e: Event): void {
    this.recherche.set((e.target as HTMLInputElement).value);
    this.relire(this.recherche() ? DELAI_RECHERCHE : 0);
  }

  private relire(delai: number): void {
    clearTimeout(this.minuterie);
    if (delai === 0) this.lire();
    else this.minuterie = setTimeout(() => this.lire(), delai);
  }

  /** `fetchZones` (`useAdminCustomZones.ts:34-52`). */
  private lire(): void {
    this.lecture?.unsubscribe();
    this.chargement.set(true);
    this.erreur.set(null);
    this.lecture = this.api.zones({ orgId: this.orgFiltre(), sourceType: this.typeFiltre(), recherche: this.recherche() }).subscribe({
      next: (data) => {
        this.zones.set(Array.isArray(data?.zones) ? data.zones : []);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        // React : `throw new Error('HTTP <statut>')` ; un `fetch` en échec donne « Failed to fetch ».
        this.erreur.set(estCoupure(e) ? 'Failed to fetch' : e instanceof HttpErrorResponse ? `HTTP ${e.status}` : 'Erreur de chargement');
        this.chargement.set(false);
      },
    });
  }

  protected viser(z: ZoneAdmin): void {
    this.aSupprimer.set(z);
  }

  protected annulerSuppression(): void {
    this.aSupprimer.set(null);
    this.erreurSuppression.set(null);
  }

  /** `handleConfirmDelete` (`index.tsx:40-53`). Une écriture : jamais annulée à la destruction. */
  protected supprimer(): void {
    const z = this.aSupprimer();
    if (!z) return;
    this.suppressionEnCours.set(true);
    this.erreurSuppression.set(null);
    this.api.supprimerZone(z.id).subscribe({
      next: () => {
        this.zones.update((l) => l.filter((x) => x.id !== z.id));
        this.aSupprimer.set(null);
        this.suppressionEnCours.set(false);
        this.lire();
      },
      error: (e: unknown) => {
        this.suppressionEnCours.set(false);
        if (estCoupure(e) || !(e instanceof HttpErrorResponse)) {
          this.erreurSuppression.set('Failed to fetch');
          return;
        }
        // React : `res.json().catch(() => ({ error: 'Erreur' }))`, puis `data.error ?? 'HTTP <statut>'`.
        const erreur = erreurDuCorps(e);
        this.erreurSuppression.set(erreur === null ? 'Erreur' : (erreur ?? `HTTP ${e.status}`));
      },
    });
  }
}
