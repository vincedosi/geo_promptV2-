import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin, type Subscription } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { ConfirmationComponent } from '../../../../ui/confirmation/confirmation.component';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { SourcesAdminApi } from '../data/sources-admin.api';
import type { DepartementIris, RapportSynchroIris, SourceIris, StatsIris } from '../data/panneaux.types';
import { erreurDuCorps, estCoupure } from './erreurs';
import { IrisSynchroComponent } from './iris-synchro.component';

/** Colonnes de `public.iris` affichées par React (`IrisPanel.tsx:146-154`), écrites en dur comme chez lui. */
const SCHEMA = [
  { col: 'code_iris', type: 'TEXT', note: 'code unique à 9 chiffres' },
  { col: 'nom_iris', type: 'TEXT', note: 'libellé IRIS' },
  { col: 'code_commune', type: 'TEXT', note: 'code INSEE commune' },
  { col: 'nom_commune', type: 'TEXT', note: 'nom commune' },
  { col: 'code_dept', type: 'TEXT', note: 'code département (2 ou 3 car.)' },
  { col: 'type_iris', type: 'TEXT', note: 'H / A / D / Z' },
  { col: 'geom', type: 'GEOMETRY', note: 'MultiPolygon — EPSG:4326' },
];

/** Le message d'un refus HTTP (`error` du corps), d'une coupure, ou d'une erreur inattendue. */
function messageErreur(e: unknown, repli: string): string {
  if (e instanceof HttpErrorResponse && !estCoupure(e)) return erreurDuCorps(e) ?? `HTTP ${e.status}`;
  if (estCoupure(e)) return 'Failed to fetch';
  return e instanceof Error ? e.message : repli;
}

/** Un message de retour : un texte qui commence par « ✓ » est une réussite. */
function retour(texte: string): { texte: string; succes: boolean } {
  return { texte, succes: texte.startsWith('✓') };
}

/**
 * Onglet « IRIS » des Sources — portage d'`IrisPanel.tsx` et d'`useIrisAdmin.ts` (lot 6, T19) :
 * statistiques du référentiel, millésime, régénération des PMTiles, suppression de TOUS les IRIS,
 * rapport de synchronisation schéma ↔ code (`mg-iris-synchro`).
 *
 * Lectures : statistiques + métadonnées ENSEMBLE à la création (`Promise.all` de React, deux GET au plus
 * en même temps). La page ne crée ce panneau qu'à la première visite de l'onglet et le GARDE ensuite
 * (masqué) — l'état de React vivait dans le parent pour la même raison (`useIrisAdmin.ts:10-16`) : pas de
 * relecture au retour, messages et rapport conservés.
 *
 * Écarts à React (défauts corrigés, listés au rapport) :
 * - millésime : React postait sans lire la réponse et affichait « ✓ Sauvegardé » même sur un refus
 *   (`useIrisAdmin.ts:113-118`). Ici : POST, PUIS relecture des métadonnées ; « ✓ » seulement si l'écriture
 *   est acceptée, sinon notification « Enregistrement échoué » au message de la route.
 * - PMTiles (déclenche un workflow GitHub, non idempotent) et suppression de tous les IRIS : passent
 *   par `mg-confirmation` (React : aucun garde pour les PMTiles, deux boutons en ligne pour la suppression).
 * - un refus HTTP est lu dans le corps de l'erreur `HttpClient`, comme React le lisait dans `res.json()`.
 * - statistiques en échec : « Aucune donnée. » et « Charger » (patron de Transport ; vague finale D4) — React
 *   laissait le panneau vide ; une table vide (`total: 0`) donne « 0 % » et non « NaN % » (D6) ; la relecture
 *   du millésime est annulée à la destruction, sa minuterie jamais reposée après (D15).
 * - couleurs (C9) : `#06b6d4` → `--info` ; `${cyan}66` → `--info` à 40 % ; `rgba(…)` → `color-mix` ;
 *   les valeurs `${C.red}44|66|22` (CSS invalide chez React) prennent la valeur voulue.
 */
@Component({
  selector: 'mg-sources-iris',
  imports: [ConfirmationComponent, IconeComponent, IrisSynchroComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './iris.component.html',
  styleUrls: ['./panneaux-commun.css', './iris.component.css', './iris-actions.css'],
})
export class IrisComponent {
  private readonly api = inject(SourcesAdminApi);
  private readonly notifications = inject(NotificationsService);
  private lecture: Subscription | null = null;
  /** Relecture des métadonnées après l'écriture du millésime : annulée à la destruction (D15). */
  private relectureMeta: Subscription | null = null;
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  private detruit = false;

  protected readonly schema = SCHEMA;
  protected readonly stats = signal<StatsIris | null>(null);
  protected readonly departements = signal<DepartementIris[]>([]);
  protected readonly source = signal<SourceIris | null>(null);
  protected readonly chargement = signal(false);

  protected readonly annee = signal('2025');
  protected readonly anneeEnCours = signal(false);
  protected readonly anneeSauvee = signal(false);

  protected readonly pmtilesConfirmation = signal(false);
  protected readonly pmtilesEnCours = signal(false);
  /** Retour du déclenchement : texte et réussite (`✓`), calculés une fois, jamais dans le gabarit (D5). */
  protected readonly pmtilesMessage = signal<{ texte: string; succes: boolean } | null>(null);

  protected readonly suppressionConfirmation = signal(false);
  protected readonly suppressionEnCours = signal(false);
  protected readonly suppressionMessage = signal<{ texte: string; succes: boolean } | null>(null);

  protected readonly rapport = signal<RapportSynchroIris | null>(null);
  protected readonly synchroEnCours = signal(false);
  protected readonly synchroErreur = signal<string | null>(null);

  protected readonly vue = computed(() => {
    const s = this.stats();
    if (!s) return null;
    const pct = (v: number) => (s.total > 0 ? Math.round((v / s.total) * 100) : 0);
    const max = this.departements()[0]?.nb ?? 1;
    return {
      total: formaterNombre(s.total),
      cases: [
        { libelle: 'Départements', valeur: formaterNombre(s.nb_depts), teinte: 'info' },
        { libelle: 'Communes', valeur: formaterNombre(s.nb_communes), teinte: 'teal' },
        { libelle: 'Avec géométrie', valeur: formaterNombre(s.with_geom), teinte: 'succes' },
        { libelle: 'Taille table', valeur: s.table_size, teinte: 'avert' },
      ],
      types: [
        { code: 'Z', libelle: "Zone d'activité économique", valeur: s.type_z, teinte: 'avert' },
        { code: 'H', libelle: 'Habitation', valeur: s.type_h, teinte: 'teal' },
        { code: 'A', libelle: 'Activité', valeur: s.type_a, teinte: 'succes' },
        { code: 'D', libelle: 'Divers', valeur: s.type_d, teinte: 'neutre' },
      ].map((t) => ({ ...t, nombre: formaterNombre(t.valeur), pct: pct(t.valeur) })),
      departements: this.departements().map((d) => ({ ...d, pct: Math.round((d.nb / max) * 100) })),
      index: s.index_size,
      confirmation: `Supprime toutes les zones IRIS de la base (TRUNCATE). Confirmer la suppression de ${formaterNombre(s.total)} IRIS ?`,
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      this.lecture?.unsubscribe();
      this.relectureMeta?.unsubscribe();
      if (this.minuterie) clearTimeout(this.minuterie);
    });
    this.lire();
  }

  /**
   * `fetchIrisStats` (`useIrisAdmin.ts:79-96`) : les deux lectures ensemble ; un échec est avalé, comme React,
   * mais le panneau propose alors « Charger » (D4).
   */
  protected lire(): void {
    this.lecture?.unsubscribe();
    this.chargement.set(true);
    this.lecture = forkJoin({ stats: this.api.irisStats(), meta: this.api.irisMetadonnees() }).subscribe({
      next: ({ stats, meta }) => {
        if (meta?.['annee']) this.annee.set(meta['annee']);
        if (stats?.success && stats.stats) {
          this.stats.set(stats.stats);
          this.departements.set(stats.top_depts ?? []);
          this.source.set(stats.source ?? null);
        }
        this.chargement.set(false);
      },
      error: () => this.chargement.set(false),
    });
  }

  protected saisirAnnee(e: Event): void {
    this.annee.set((e.target as HTMLInputElement).value);
  }

  /** Une écriture : jamais annulée à la destruction. */
  protected sauverAnnee(): void {
    this.anneeEnCours.set(true);
    this.api.enregistrerIrisMetadonnees({ annee: this.annee() }).subscribe({
      next: () => {
        if (this.detruit) return;
        this.relectureMeta?.unsubscribe();
        this.relectureMeta = this.api.irisMetadonnees().subscribe({
          next: (meta) => {
            if (meta?.['annee']) this.annee.set(meta['annee']);
            this.anneeEnCours.set(false);
            this.anneeSauvee.set(true);
            if (this.minuterie) clearTimeout(this.minuterie);
            this.minuterie = setTimeout(() => this.anneeSauvee.set(false), 2000);
          },
          error: (e: unknown) => {
            this.anneeEnCours.set(false);
            this.notifications.error('Relecture échouée', messageErreur(e, 'Erreur'));
          },
        });
      },
      error: (e: unknown) => {
        this.anneeEnCours.set(false);
        this.notifications.error('Enregistrement échoué', messageErreur(e, 'Erreur'));
      },
    });
  }

  /** `triggerIrisPmtiles` (`useIrisAdmin.ts:120-135`), après confirmation. */
  protected declencherPmtiles(): void {
    this.pmtilesConfirmation.set(false);
    this.pmtilesEnCours.set(true);
    this.pmtilesMessage.set(null);
    this.api.declencherPmtiles().subscribe({
      next: (r) => {
        this.pmtilesMessage.set(r?.success
          ? retour(`✓ Workflow lancé — durée estimée 5-8 min. Suivi : ${r.workflow_url}`)
          : retour(`! Erreur : ${r?.error}`));
        this.pmtilesEnCours.set(false);
      },
      error: (e: unknown) => {
        this.pmtilesMessage.set(retour(e instanceof HttpErrorResponse && !estCoupure(e)
          ? `! Erreur : ${erreurDuCorps(e) ?? `HTTP ${e.status}`}`
          : `! Erreur réseau : ${messageErreur(e, String(e))}`));
        this.pmtilesEnCours.set(false);
      },
    });
  }

  /** `deleteAllIris` (`useIrisAdmin.ts:140-155`), après confirmation. Succès : statistiques relues. */
  protected supprimerTout(): void {
    this.suppressionEnCours.set(true);
    this.suppressionMessage.set(null);
    const fin = () => {
      this.suppressionEnCours.set(false);
      this.suppressionConfirmation.set(false);
    };
    this.api.supprimerIris().subscribe({
      next: (r) => {
        if (r?.success) {
          this.suppressionMessage.set(retour(`✓ ${r.deleted ?? 0} IRIS supprimés`));
          fin();
          this.stats.set(null);
          this.lire();
        } else {
          this.suppressionMessage.set(retour(`! Erreur: ${r?.error}`));
          fin();
        }
      },
      error: (e: unknown) => {
        this.suppressionMessage.set(retour(e instanceof HttpErrorResponse && !estCoupure(e)
          ? `! Erreur: ${erreurDuCorps(e) ?? `HTTP ${e.status}`}`
          : `! ${messageErreur(e, 'Erreur')}`));
        fin();
      },
    });
  }

  /** `runIrisSync` (`useIrisAdmin.ts:98-111`). */
  protected synchroniser(): void {
    this.synchroEnCours.set(true);
    this.synchroErreur.set(null);
    this.api.synchroniserIris().subscribe({
      next: (r) => {
        this.rapport.set(r);
        this.synchroEnCours.set(false);
      },
      error: (e: unknown) => {
        this.synchroErreur.set(e instanceof HttpErrorResponse && !estCoupure(e) ? (erreurDuCorps(e) ?? 'Erreur') : messageErreur(e, 'Erreur inconnue'));
        this.synchroEnCours.set(false);
      },
    });
  }
}
