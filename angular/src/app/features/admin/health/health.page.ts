import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../core/format/nombre';
import type { Check, HealthResponse } from '../logique/types/admin';
import { APP_VERSION, BUILD_DATE } from '../logique/version';
import { CarteVerificationComponent } from './carte-verification.component';
import { HealthApi } from './data/health.api';
import { STYLES_STATUT } from './statut';

export type OngletHealth = 'systeme' | 'fraicheur';

/** Onglets de `app/admin/health/page.tsx:128-133`, libellés recopiés. */
export const ONGLETS_HEALTH: readonly { cle: OngletHealth; libelle: string }[] = [
  { cle: 'systeme', libelle: 'Diagnostic système' },
  { cle: 'fraicheur', libelle: 'Fraîcheur données' },
];

const MO = 1024 * 1024;
const GO = 1024 * MO;

/** Barre « Espace base de données » (`page.tsx:463-490`). */
interface TailleBase {
  libelle: string;
  pct: number;
  /** `OK` / `WARN` / `ERROR` : réutilise les couleurs de statut (vert, orange, rouge). */
  etat: 'OK' | 'WARN' | 'ERROR';
  note: string;
}

/**
 * Health check, onglet « Diagnostic système » — portage de `app/admin/health/page.tsx`.
 * L'onglet « Fraîcheur données » est porté en T4 (texte provisoire ici).
 *
 * Écarts à React, voulus :
 * - erreur HTTP : React fait `res.json()` sans tester `res.ok`. Un corps JSON d'erreur (401
 *   `{ error }`) devenait `health`, puis `health.checks.filter` levait au rendu (page blanche) ;
 *   ici toute réponse non 2xx est une lecture en ÉCHEC (`health` à `null`), comme une exception
 *   réseau chez React : « Erreur de connexion au serveur ».
 * - « Re-tester » ne relance jamais une seconde lecture tant que la première est en vol (le bouton
 *   est désactivé, la méthode le vérifie aussi).
 *
 * ⚠ Quota de la barre de taille (Free 500 MB / Pro 8 GB) recopié TEL QUEL (`page.tsx:466`) : il
 * décrit le projet Supabase hébergé, supprimé le 2026-09-21 — la base locale n'a pas de quota.
 * Défaut React gardé par parité.
 */
@Component({
  selector: 'mg-health',
  imports: [CarteVerificationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './health.page.html',
  styles: [STYLES_STATUT, `
    :host { display: block; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .tourne { animation: spin 1s linear infinite; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .carte { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 2px; overflow: hidden; }
    .carte-tete {
      display: flex; align-items: center; gap: 8px; padding: 10px 16px;
      border-bottom: 1px solid var(--border-subtle); background: var(--bg-level-2);
    }
    .carte-tete svg { stroke: var(--brand-teal); }
    .carte-titre { font-weight: 500; font-size: 12px; color: var(--text-primary); }
    .carte-droite { margin-left: auto; font-size: 11px; color: var(--text-secondary); }
    .carte-corps { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    .squelette { height: 60px; background: var(--bg-level-2); border-radius: 2px; }
    .squelette.pulse { animation: pulse 1.5s ease-in-out infinite; }
    .onglet {
      background: transparent; border: none; border-bottom: 2px solid transparent; color: var(--text-tertiary);
      font-weight: 500; font-size: 13px; padding: 8px 14px;
      cursor: pointer; margin-bottom: -1px;
    }
    .onglet[aria-selected='true'] { border-bottom-color: var(--brand-teal); color: var(--text-primary); }
    .pastille {
      font-size: 10px; color: var(--c-statut); background: var(--fond-statut);
      padding: 2px 10px; border-radius: 2px; border: 1px solid var(--bord-statut);
    }
    .pastille[data-etat='OK'] { border: none; }
    .globale {
      padding: 20px 24px; border-radius: 2px; margin-bottom: 16px; display: flex; align-items: center; gap: 16px;
      background: var(--fond-statut); border: 1px solid var(--bord-statut-fort);
    }
    .globale[data-etat='OK'] { border: none; }
    .globale.en-lecture { background: var(--bg-surface); border: 1px solid var(--border-subtle); }
    .resume { font-size: 15px; font-weight: 700; color: var(--c-statut); margin-bottom: 4px; }
    .en-lecture .resume { color: var(--text-secondary); }
    .retester {
      flex-shrink: 0; display: flex; align-items: center; gap: 6px; background: var(--brand-teal-10);
      border: 1px solid var(--brand-teal-30); border-radius: 2px; color: var(--brand-teal);
      font-size: 12px; padding: 7px 14px; cursor: pointer;
    }
    .retester:disabled { cursor: not-allowed; opacity: 0.5; }
    .tuile { padding: 12px 16px; background: var(--bg-level-2); border-radius: 2px; border: 1px solid var(--border-subtle); }
    .tuile-libelle { font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; }
    .tuile-valeur { font-size: 20px; font-weight: 700; }
    .encart { padding: 10px 14px; border-radius: 2px; font-size: 11px; color: var(--text-secondary); }
    .encart.danger { background: color-mix(in srgb, var(--danger) 10%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 20%, transparent); }
    .encart.avert { margin-top: 12px; background: color-mix(in srgb, var(--warning) 10%, transparent); border: 1px solid color-mix(in srgb, var(--warning) 20%, transparent); }
    .encart.info { margin-top: 12px; background: color-mix(in srgb, var(--info) 7%, transparent); border: 1px solid color-mix(in srgb, var(--info) 20%, transparent); }
    .piste { height: 6px; border-radius: 2px; background: color-mix(in srgb, var(--text-primary) 6%, transparent); overflow: hidden; }
    .remplissage { height: 100%; border-radius: 2px; background: var(--c-statut); transition: width 0.4s ease; }
    table { width: 100%; font-size: 11px; border-collapse: collapse; }
    thead tr { border-bottom: 1px solid var(--border-subtle); }
    th { font-family: 'Inter', system-ui, sans-serif; text-align: right; padding: 8px 12px; font-size: 11px; color: var(--text-secondary); font-weight: 400; }
    th:first-child { text-align: left; }
    tbody tr { border-bottom: 1px solid var(--border-subtle); }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:nth-child(even) { background: var(--bg-level-2); }
    td { padding: 10px 12px; text-align: right; color: var(--text-secondary); }
    td:first-child { text-align: left; color: var(--text-primary); font-weight: 600; }
    td:nth-child(2) { color: var(--text-tertiary); }
    td:nth-child(3) { color: var(--brand-teal); }
    .build {
      font-size: 11px; background: var(--bg-level-2);
      border: 1px solid var(--border-subtle); border-radius: 2px; padding: 12px 14px;
      display: flex; flex-direction: column; gap: 4px; line-height: 1.7;
    }
    .cle { color: var(--text-secondary); white-space: pre; }
  `],
})
export class HealthPage {
  private readonly api = inject(HealthApi);
  private lecture: Subscription | null = null;

  readonly onglet = signal<OngletHealth>('systeme');
  protected readonly onglets = ONGLETS_HEALTH;
  protected readonly version = APP_VERSION;
  protected readonly dateBuild = BUILD_DATE;

  protected readonly health = signal<HealthResponse | null>(null);
  protected readonly enLecture = signal(true);
  private readonly derniereLecture = signal<Date | null>(null);

  /** `health?.status || 'ERROR'` (`page.tsx:158`). */
  protected readonly statutGlobal = computed(() => this.health()?.status || 'ERROR');
  /** La pastille de l'en-tête n'apparaît que lecture finie ET réponse présente (`page.tsx:208`). */
  protected readonly pastilleVisible = computed(() => !this.enLecture() && this.health() !== null);

  private readonly checks = computed<Check[]>(() => this.health()?.checks ?? []);
  // Filtres de `page.tsx:162-165`, recopiés : BORNES_CARREAUX sort des variables d'environnement.
  protected readonly donneesChecks = computed(() => this.checks().filter((c) => c.name === 'BORNES_CARREAUX'));
  protected readonly envChecks = computed(() => this.checks().filter(
    (c) => !c.name.startsWith('SUPABASE_CONNEXION') && !c.name.startsWith('TABLE_') && c.name !== 'BORNES_CARREAUX'));
  protected readonly connChecks = computed(() => this.checks().filter((c) => c.name === 'SUPABASE_CONNEXION'));
  protected readonly tableChecks = computed(() => this.checks().filter((c) => c.name.startsWith('TABLE_')));
  protected readonly tableEnErreur = computed(() => this.tableChecks().some((c) => c.status === 'ERROR'));

  protected readonly nbOk = computed(() => this.checks().filter((c) => c.status === 'OK').length);
  protected readonly nbWarn = computed(() => this.checks().filter((c) => c.status === 'WARN').length);
  protected readonly nbErr = computed(() => this.checks().filter((c) => c.status === 'ERROR').length);

  protected readonly heureLecture = computed(() => this.derniereLecture()?.toLocaleTimeString('fr-FR') ?? '');
  protected readonly dateLecture = computed(() => this.derniereLecture()?.toLocaleString('fr-FR') || '—');

  protected readonly base = computed(() => (this.enLecture() ? null : this.health()?.database ?? null));
  protected readonly lignesTotales = computed(() => formaterNombre(this.base()?.total_rows));
  protected readonly lignesTables = computed(() =>
    (this.base()?.tables ?? []).map((t) => ({ ...t, lignes: formaterNombre(t.row_count) })));
  protected readonly taillesNA = computed(() => this.base()?.total_size === 'N/A');
  protected readonly taillesEstimees = computed(() => this.base()?.total_size?.startsWith('~') ?? false);

  /** Quota recopié de `page.tsx:466` (Free 500 MB / Pro 8 GB) — voir l'en-tête de classe. */
  protected readonly tailleBase = computed<TailleBase | null>(() => {
    const db = this.base();
    const utilises = db?.db_size_bytes;
    if (!db || utilises == null || utilises <= 0) return null;
    const pro = utilises > 500 * MO;
    const quota = pro ? 8 * GO : 500 * MO;
    const pct = Math.min(100, (utilises / quota) * 100);
    const quotaLibelle = quota >= GO ? `${(quota / GO).toFixed(0)} GB` : `${(quota / MO).toFixed(0)} MB`;
    const etat = pct > 90 ? 'ERROR' : pct > 70 ? 'WARN' : 'OK';
    const constat = pct > 90 ? '! Espace critique — pensez à upgrader ou purger des données'
      : pct > 70 ? '! Espace élevé — surveillez la consommation'
        : '✓ Espace suffisant';
    return {
      libelle: `${db.db_size} / ${quotaLibelle}`,
      pct,
      etat,
      note: `${constat} · quota estimé ${pro ? 'Pro (8 GB)' : 'Free (500 MB)'}`,
    };
  });
  protected readonly pctTexte = computed(() => {
    const t = this.tailleBase();
    return t ? `(${t.pct.toFixed(1)}%)` : '';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
    this.relire();
  }

  protected choisir(cle: OngletHealth): void {
    this.onglet.set(cle);
  }

  /** « Re-tester » (`fetchHealth`, `page.tsx:141-152`) : UNE lecture à la fois. */
  relire(): void {
    if (this.lecture && !this.lecture.closed) return;
    this.enLecture.set(true);
    this.lecture = this.api.lire().subscribe({
      next: (r) => {
        this.health.set(r);
        this.derniereLecture.set(new Date());
        this.enLecture.set(false);
      },
      error: () => {
        this.health.set(null);
        this.enLecture.set(false);
      },
    });
  }
}
