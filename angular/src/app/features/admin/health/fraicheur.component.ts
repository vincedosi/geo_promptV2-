import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../core/format/nombre';
import type { EtatFraicheur, NatureSource } from '../logique/types/fraicheur';
import { FraicheurApi, type ReponseFraicheur, type SourceAffichee } from './data/fraicheur.api';

/** `LIBELLE_NATURE` (`FraicheurPanel.tsx:67-72`), dans l'ordre de la légende. */
const LIBELLE_NATURE: Record<NatureSource, string> = {
  live: 'Live',
  cache: 'Cache daté',
  referentiel: 'Référentiel',
  derive: 'Dérivé',
};

/** `EXPLICATION_NATURE` (`FraicheurPanel.tsx:78-83`), recopiée telle quelle. */
const EXPLICATION_NATURE: Record<NatureSource, string> = {
  live: 'Appelée à chaque usage, jamais stockée. Rien à périmer.',
  cache: 'Copie datée qui expire. Stockée pour rendre la lecture possible, pas pour faire référence.',
  referentiel: 'Millésime figé, réimporté à la main. Le risque est qu’il vieillisse sans qu’on le voie.',
  derive: 'Calculée depuis une autre donnée du projet.',
};

/** Couleur d'un badge — jeton, comme `C` de React (`couleurEtat`, l.85-90 ; nature l.300). */
type Teinte = 'succes' | 'danger' | 'avert' | 'accent' | 'neutre';

function teinteEtat(etat: EtatFraicheur): Teinte {
  if (etat === 'a_jour') return 'succes';
  if (etat === 'en_retard') return 'danger';
  if (etat === 'jamais_mesure') return 'avert';
  return 'neutre';
}

function formaterAge(ageJours: number): string {
  if (ageJours < 1) return 'aujourd’hui';
  if (ageJours < 60) return `il y a ${ageJours} j`;
  return `il y a ${Math.round(ageJours / 30)} mois`;
}

function libelleEtat(etat: EtatFraicheur, ageJours: number | null): string {
  if (etat === 'a_jour') return 'À jour';
  if (etat === 'en_retard') return ageJours !== null ? `En retard de ${ageJours} j` : 'En retard';
  if (etat === 'jamais_mesure') return 'Jamais mesuré';
  return ageJours !== null ? formaterAge(ageJours) : '—';
}

/** `formaterDate` (l.109-116) : une année seule reste telle quelle, sinon date `fr-FR` sans heure. */
function formaterDate(valeur: string | null): string {
  if (!valeur) return '—';
  if (/^\d{4}$/.test(valeur)) return valeur;
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return valeur;
  return d.toLocaleDateString('fr-FR');
}

/** Message d'un échec : le `error` du corps (celui du SERVEUR, 429 compris), sinon le repli de React. */
function messageEchec(e: unknown, repli: string): string {
  const corps = e instanceof HttpErrorResponse ? (e.error as { error?: unknown } | null) : null;
  return corps && typeof corps === 'object' && typeof corps.error === 'string' && corps.error ? corps.error : repli;
}

interface LigneAffichee {
  id: string;
  libelle: string;
  nature: string;
  teinteNature: Teinte;
  provenance: string;
  collecte: string;
  note: string | null;
  etat: string;
  teinteEtat: Teinte;
  lourd: boolean;
  table: string | null;
  lignes: string;
  estime: boolean;
  millesime: string;
  entree: string;
  cadence: number | null;
}

function ligne(s: SourceAffichee): LigneAffichee {
  const min = formaterDate(s.donneeMin);
  const max = formaterDate(s.donneeMax);
  return {
    id: s.id,
    libelle: s.libelle,
    nature: LIBELLE_NATURE[s.nature],
    teinteNature: s.nature === 'live' ? 'accent' : 'neutre',
    provenance: s.provenance,
    collecte: s.collecte,
    note: s.note,
    etat: libelleEtat(s.etat, s.ageJours),
    teinteEtat: teinteEtat(s.etat),
    lourd: s.coutMesure === 'lourd',
    table: s.table,
    lignes: s.nLignes != null ? `${s.nEstime ? '~' : ''}${formaterNombre(s.nLignes)}` : '—',
    estime: s.nEstime,
    millesime: s.donneeMin && s.donneeMax && min !== max ? `${min} → ${max}` : max,
    entree: formaterDate(s.ingestionMax),
    cadence: s.cadenceAttendueJours,
  };
}

/**
 * Onglet « Fraîcheur données » de `/admin/health` — portage de
 * `app/admin/health/_components/FraicheurPanel.tsx`.
 *
 * À l'ouverture : UNE lecture du relevé persisté (GET), aucune mesure. Deux boutons, comme
 * React : « Relancer la mesure » (passe légère, < 15 Mo) et « Mesurer » sur la ligne du flux
 * routier (347 Mo lus — coût affiché AVANT le clic, en légende et en `title`). Pendant une
 * mesure, les deux boutons sont désactivés et la méthode refuse un second envoi. Un refus
 * (429 compris) affiche le message du serveur, sans relance automatique. Le relevé rendu par
 * le serveur (FUSIONNÉ source par source) remplace l'affichage tel quel.
 *
 * Écarts à React, voulus :
 * - corps d'erreur illisible : React affichait le message de `res.json()` (« Unexpected
 *   token… ») ; ici le repli de React (« Lecture impossible. », « La mesure a échoué. »).
 * - badges : React écrit `${couleur}1a` / `${couleur}44` avec `couleur = var(--x)` — valeurs
 *   invalides, donc AUCUN fond ni bordure ; reproduit (rendu mesuré, C16), seule la couleur
 *   du texte porte la teinte.
 * - encart d'erreur `rgba(248,113,113,…)` → `color-mix` de `--danger` (C9).
 */
@Component({
  selector: 'mg-fraicheur',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fraicheur.component.html',
  styles: [`
    :host { display: flex; flex-direction: column; gap: 16px; }
    .cadre { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 2px; }
    .bandeau { padding: 14px 16px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .petit { font-size: 11px; color: var(--text-tertiary); line-height: 1.5; }
    .mono { font-family: var(--font-mono); }
    .badge { font-size: 10px; border-radius: 4px; padding: 2px 7px; white-space: nowrap; }
    [data-t='succes'] { color: var(--success); }
    [data-t='danger'] { color: var(--danger); }
    [data-t='avert'] { color: var(--warning); }
    [data-t='accent'] { color: var(--brand-teal); }
    [data-t='neutre'] { color: var(--text-tertiary); }
    button { border-radius: 6px; font-family: var(--font-sans); font-weight: 500; cursor: pointer; background: transparent; }
    button:disabled { opacity: 0.5; }
    .relancer { padding: 8px 14px; font-size: 12px; border: 0.5px solid var(--brand-teal); color: var(--brand-teal); }
    .lourd { padding: 5px 10px; font-size: 11px; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .erreur {
      background: color-mix(in srgb, var(--danger) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--danger) 20%, transparent);
      border-radius: 2px; padding: 10px 14px; font-size: 12px; color: var(--danger);
    }
    .tableau { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 640px; }
    thead tr { background: var(--bg-level-2); }
    th {
      text-align: left; padding: 8px 10px; font-weight: 400; font-size: 10px; color: var(--text-tertiary);
      border-bottom: 1px solid var(--border-subtle); white-space: nowrap;
    }
    tbody tr + tr { border-top: 1px solid var(--border-subtle); }
    td { padding: 10px; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); vertical-align: top; }
    td .sans { font-family: var(--font-sans); }
    .nw { white-space: nowrap; }
    .note { margin-top: 6px; padding-left: 8px; border-left: 2px solid var(--border-subtle); }
    .sous { font-family: var(--font-sans); font-size: 10px; color: var(--text-tertiary); margin-top: 2px; }
  `],
})
export class FraicheurComponent {
  private readonly api = inject(FraicheurApi);
  private appel: Subscription | null = null;

  protected readonly donnees = signal<ReponseFraicheur | null>(null);
  protected readonly chargement = signal(true);
  protected readonly mesureEnCours = signal<'leger' | 'lourd' | null>(null);
  protected readonly erreur = signal<string | null>(null);

  /** Boutons désactivés : `mesureEnCours !== null || chargement` (l.237, l.335). */
  protected readonly occupe = computed(() => this.mesureEnCours() !== null || this.chargement());
  protected readonly lignes = computed(() => (this.donnees()?.sources ?? []).map(ligne));
  protected readonly enRetard = computed(() => (this.donnees()?.sources ?? []).filter((s) => s.etat === 'en_retard').length);
  protected readonly jamais = computed(() => (this.donnees()?.sources ?? []).filter((s) => s.etat === 'jamais_mesure').length);
  protected readonly releve = computed(() => {
    if (this.chargement()) return 'Lecture du relevé…';
    const d = this.donnees();
    if (!d?.mesureLe) return 'Aucun relevé : rien n’a encore été mesuré.';
    return `Relevé du ${new Date(d.mesureLe).toLocaleString('fr-FR')}${d.dureeMs != null ? ` · ${d.dureeMs} ms` : ''}`;
  });
  protected readonly legende = (Object.keys(LIBELLE_NATURE) as NatureSource[]).map((n) => ({
    cle: n,
    libelle: LIBELLE_NATURE[n],
    teinte: (n === 'live' ? 'accent' : 'neutre') as Teinte,
    explication: EXPLICATION_NATURE[n],
  }));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.appel?.unsubscribe());
    this.appel = this.api.lire().subscribe({
      next: (r) => {
        this.donnees.set(r);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.erreur.set(messageEchec(e, 'Lecture impossible.'));
        this.chargement.set(false);
      },
    });
  }

  /** `mesurer` (l.157-176) : UNE mesure à la fois ; jamais de relance automatique. */
  protected mesurer(inclureLourd: boolean): void {
    if (this.occupe()) return;
    this.mesureEnCours.set(inclureLourd ? 'lourd' : 'leger');
    this.erreur.set(null);
    this.appel = this.api.mesurer(inclureLourd).subscribe({
      next: (r) => {
        this.donnees.set(r);
        if (r.persiste === false) {
          this.erreur.set('Mesure faite, mais elle n’a pas pu être enregistrée : elle sera perdue au rechargement.');
        }
        this.mesureEnCours.set(null);
      },
      error: (e: unknown) => {
        this.erreur.set(messageEchec(e, 'La mesure a échoué.'));
        this.mesureEnCours.set(null);
      },
    });
  }
}
