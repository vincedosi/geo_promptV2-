import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../core/format/nombre';
import { ImportsApi, type LigneImport } from './data/imports.api';
import { ECHEC_RESEAU, erreurDuCorps, estCoupure } from '../commun/erreurs-http';

/**
 * Filtres de l'écran. React proposait `all`, `ooh`, `source` (`page.tsx:121-139`) : le filtre
 * « OOH » est RETIRÉ (ruling du 2026-10-16) — l'import OOH ArcGIS qui alimentait `import_runs_ooh`
 * a été supprimé ce jour-là (page et route React effacées), la table est vide depuis sql/260, et un
 * filtre qui ne peut plus rien montrer induit en erreur. Une ligne `kind: 'ooh'` éventuelle reste
 * visible sous « Tous », avec son badge « OOH » (la route la rend toujours).
 */
type Filtre = 'all' | 'source';
/** Libellés de React : `f === 'all' ? 'Tous' : f.toUpperCase()`. */
const FILTRES: readonly { cle: Filtre; libelle: string }[] = [
  { cle: 'all', libelle: 'Tous' },
  { cle: 'source', libelle: 'SOURCE' },
];

/** Teintes de React (`C.green`, `C.red`, `C.warn`, `C.textDim`), ramenées aux jetons (C9). */
type Teinte = 'succes' | 'danger' | 'avert' | 'neutre';

/** `StatusBadge` (`page.tsx:37-51`) : la teinte d'un statut, casse ignorée. */
function teinteStatut(status: string | null | undefined): Teinte {
  const s = status?.toLowerCase();
  if (s === 'success' || s === 'active' || s === 'termine') return 'succes';
  if (s === 'error' || s === 'deleted') return 'danger';
  if (s === 'running' || s === 'pending') return 'avert';
  return 'neutre';
}

/** `toLocaleString` de `page.tsx:167`, ou « — » sans date. */
function dateDebut(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Message d'une lecture en échec, au texte de React (`page.tsx:76-84`) : React lit le corps JSON
 * quel que soit le statut et affiche `data.error || 'Erreur'` ; un `fetch` qui échoue donne
 * `String(e)`, soit « TypeError: Failed to fetch ».
 */
function messageErreur(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (estCoupure(e)) return ECHEC_RESEAU;
    return erreurDuCorps(e) ?? 'Erreur';
  }
  return String(e);
}

interface VueLigne {
  id: string;
  kind: LigneImport['kind'];
  type: string;
  source: string;
  workspace: string | null;
  date: string;
  status: string;
  teinteStatut: Teinte;
  total: string;
  inseres: string;
  maj: string;
  erreurs: string;
  teinteErreurs: Teinte;
}

/**
 * `admin/donnees/historique` — portage de `app/admin/imports/page.tsx` (lot 6, T11′, amendement A1),
 * onglet « Historique » de la page Données ; `admin/imports` y redirige.
 *
 * UNE lecture à l'ouverture (`GET /api/admin/imports`), « Rafraîchir » en relance une ; filtres et
 * statistiques sont LOCAUX, recalculés sur la liste filtrée, sans requête.
 *
 * Écarts à React, voulus :
 * - ⚠ **filtre « OOH » et mention « OOH ArcGIS » du sous-titre RETIRÉS** (ruling du 2026-10-16,
 *   import ArcGIS supprimé) : le sous-titre devient « … — sources CSV/Shapefile ».
 * - titre « Historique des imports » remonté dans le cadre (« Données » + onglet « Historique »),
 *   comme Qualité en T6 ; le `padding`, le `min-height` et le fond de page de React sont ceux du cadre.
 * - couleurs (C9) : `#f87171`, `#fbbf24`, `#3b82f6` → `--danger`, `--warning`, `--info` ; fonds et
 *   bordures `rgba(…)` → `color-mix` du jeton à la même opacité ; polices en dur → `--font-*`.
 * - « Rafraîchir » pendant une lecture en vol annule la précédente (React laissait courir les deux,
 *   la dernière arrivée gagnait) ; quitter l'écran annule la lecture (lecture seule, rien à finir).
 * - corps d'erreur non JSON : « Erreur » au lieu du texte de `res.json()` (« SyntaxError: … »).
 * - `title` sur la source tronquée par l'ellipse (220 px), pour la lire au survol.
 *
 * Gardés par parité : bordures 1 px et rayon 2 px de React, libellés « SOURCE » et types en
 * capitales (`toUpperCase()` de React), en-têtes de colonnes, « global » pour une source sans espace.
 */
@Component({
  selector: 'mg-imports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './imports.page.html',
  styles: [`
    :host { display: block; font-family: var(--font-sans); color: var(--text-primary); }
    .sous-titre { font-size: 12px; color: var(--text-secondary); margin: 0 0 28px; }
    .stats { display: flex; gap: 12px; margin-bottom: 20px; }
    .stat { flex: 1; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 2px; padding: 12px 20px; }
    .stat-libelle { font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; }
    .stat-valeur { font-family: var(--font-mono); font-size: 20px; font-weight: 700; }
    .filtres { display: flex; gap: 8px; margin-bottom: 16px; }
    .filtres button {
      padding: 6px 14px; border-radius: 2px; border: 1px solid var(--border-subtle); background: none;
      color: var(--text-secondary); font-family: var(--font-sans); font-size: 12px; cursor: pointer;
    }
    .filtres button[aria-pressed='true'] { border-color: var(--brand-teal); background: var(--brand-teal-10); color: var(--teal-texte); }
    .filtres button:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 1px; }
    .filtres .rafraichir { margin-left: auto; }
    .tableau { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 2px; }
    .erreur { padding: 12px 16px; color: var(--danger-texte); font-family: var(--font-mono); font-size: 11px; border-bottom: 1px solid var(--border-subtle); }
    .message { padding: 40px; text-align: center; color: var(--text-secondary); font-family: var(--font-mono); font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    tr { border-bottom: 1px solid var(--border-subtle); }
    tbody tr:hover { background: var(--bg-level-2); }
    th { padding: 10px 12px; text-align: left; font-size: 11px; color: var(--text-secondary); font-weight: 400; }
    /* 16 px / 1,5 : la cellule de React n'a pas de taille propre et hérite des 16 px de la page — c'est
       sa ligne qui fixe la hauteur des rangées à badge (45 px), mesuré au navigateur. */
    td { padding: 10px 12px; font-size: 16px; line-height: 1.5; }
    td.texte { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
    td.source { color: var(--text-primary); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .global { color: var(--text-tertiary); }
    td.nombre { font-family: var(--font-mono); font-size: 12px; text-align: right; color: var(--text-secondary); }
    td.inseres { color: var(--success-texte); }
    td.maj { color: var(--warning-texte); }
    .badge { font-family: var(--font-mono); font-size: 10px; border-radius: 2px; padding: 2px 6px; border: 1px solid; }
    .badge[data-type='ooh'] { color: var(--teal-texte); background: var(--brand-teal-10); border-color: var(--brand-teal-30); }
    .badge[data-type='source'] {
      color: var(--info-texte); background: color-mix(in srgb, var(--info) 12%, transparent);
      border-color: color-mix(in srgb, var(--info) 30%, transparent);
    }
    .badge[data-statut][data-teinte='succes'] { color: var(--success-texte); background: color-mix(in srgb, var(--success) 12%, transparent); border-color: var(--success); }
    .badge[data-statut][data-teinte='danger'] { color: var(--danger-texte); background: color-mix(in srgb, var(--danger) 10%, transparent); border-color: var(--danger); }
    .badge[data-statut][data-teinte='avert'] { color: var(--warning-texte); background: color-mix(in srgb, var(--warning) 10%, transparent); border-color: var(--warning); }
    .badge[data-statut][data-teinte='neutre'] { color: var(--text-secondary); background: var(--bg-level-2); border-color: var(--text-secondary); }
    [data-valeur][data-teinte='succes'] { color: var(--success-texte); }
    [data-valeur][data-teinte='danger'], td[data-teinte='danger'] { color: var(--danger-texte); }
    [data-valeur][data-teinte='neutre'] { color: var(--text-secondary); }
  `],
})
export class ImportsPage {
  private readonly api = inject(ImportsApi);
  private lecture: Subscription | null = null;

  private readonly imports = signal<LigneImport[]>([]);
  protected readonly chargement = signal(true);
  protected readonly erreur = signal('');
  protected readonly filtre = signal<Filtre>('all');
  protected readonly filtres = FILTRES;

  private readonly filtrees = computed(() => {
    const f = this.filtre();
    return f === 'all' ? this.imports() : this.imports().filter((i) => i.kind === f);
  });

  /** Statistiques de la liste FILTRÉE (`page.tsx:89-91,107-120`). */
  protected readonly stats = computed(() => {
    const l = this.filtrees();
    const inseres = l.reduce((a, i) => a + (i.inserted ?? 0), 0);
    const erreurs = l.reduce((a, i) => a + (i.errors ?? 0), 0);
    return [
      { cle: 'runs', libelle: 'Runs', valeur: formaterNombre(l.length), teinte: 'neutre' as Teinte },
      { cle: 'importes', libelle: 'Enregistrements importés', valeur: formaterNombre(inseres), teinte: 'succes' as Teinte },
      { cle: 'erreurs', libelle: 'Erreurs', valeur: formaterNombre(erreurs), teinte: (erreurs > 0 ? 'danger' : 'neutre') as Teinte },
    ];
  });

  protected readonly lignes = computed<VueLigne[]>(() =>
    this.filtrees().map((i) => ({
      id: i.id,
      kind: i.kind,
      // `KindBadge` (`page.tsx:56-67`).
      type: i.kind === 'ooh' ? 'OOH' : (i.type ?? 'source').toUpperCase(),
      source: i.source,
      workspace: i.org_name ?? null,
      date: dateDebut(i.started_at),
      status: i.status ?? '—',
      teinteStatut: teinteStatut(i.status),
      total: formaterNombre(i.total),
      inseres: formaterNombre(i.inserted),
      maj: formaterNombre(i.updated),
      erreurs: formaterNombre(i.errors),
      teinteErreurs: (i.errors ?? 0) > 0 ? 'danger' : 'neutre',
    })),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
    this.lire();
  }

  /** `fetchImports` (`page.tsx:73-84`). En cas d'échec la liste déjà lue reste affichée, comme React. */
  protected lire(): void {
    this.lecture?.unsubscribe();
    this.chargement.set(true);
    this.erreur.set('');
    this.lecture = this.api.lire().subscribe({
      next: (r) => {
        if (r.success) this.imports.set(r.imports ?? []);
        else this.erreur.set(r.error || 'Erreur');
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.erreur.set(messageErreur(e));
        this.chargement.set(false);
      },
    });
  }
}
