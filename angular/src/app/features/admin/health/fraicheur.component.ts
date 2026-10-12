import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../core/format/nombre';
import type { EtatFraicheur, NatureSource } from '../logique/types/fraicheur';
import type { SourceAffichee } from './data/fraicheur.api';
import { FraicheurEtatService } from './etat/fraicheur-etat.service';

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
 * Onglet « Fraîcheur des données » de la page Système (`admin/systeme/fraicheur`, lot 6 T6 ;
 * onglet « Fraîcheur données » de `/admin/health` en React) — portage de
 * `app/admin/health/_components/FraicheurPanel.tsx`, précédé du sous-titre que React affiche
 * sous l'en-tête de la page quand cet onglet est ouvert (`page.tsx:217-224`).
 * Son état (relevé, mesure en cours, erreur) est porté par `FraicheurEtatService`, fourni par la
 * page Système : l'écran est détruit à chaque changement d'onglet, le relevé ne l'est pas.
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
  private readonly etat = inject(FraicheurEtatService);

  protected readonly donnees = this.etat.donnees;
  protected readonly chargement = this.etat.chargement;
  protected readonly mesureEnCours = this.etat.mesureEnCours;
  protected readonly erreur = this.etat.erreur;
  protected readonly occupe = this.etat.occupe;
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
    // Le relevé vit dans `FraicheurEtatService` (fourni par la page Système) : lu à la PREMIÈRE
    // ouverture de l'onglet, gardé ensuite — revenir sur l'onglet ne le relit pas.
    this.etat.assurer();
  }

  /** « Relancer la mesure » / « Mesurer » : délégué à l'état (UNE mesure à la fois). */
  protected mesurer(inclureLourd: boolean): void {
    this.etat.mesurer(inclureLourd);
  }
}
