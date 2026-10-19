import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../core/format/nombre';
import { QualiteApi, type CleVerification, type Verification } from './data/qualite.api';
import { erreurDuCorps } from '../commun/erreurs-http';

/** `LigneIndicateur` (`page.tsx:44-59`). */
interface LigneIndicateur {
  indicator_code: string;
  label: string;
  famille: string | null;
  data_source: string;
  data_column: string | null;
  n_source: number | null;
  n_total_source: number | null;
  n_cp: number | null;
  cp_calcules_le: string | null;
  part_population: number | null;
  age_source_jours: number | null;
  n_cp_reference: number | null;
  verdict: 'colonne_absente' | 'source_vide' | 'perime' | 'non_verifie' | 'partiel' | 'ok';
  gravite: number;
}

/** `LigneSource` (`page.tsx:61-69`). */
interface LigneSource {
  table: string;
  libelle: string;
  derniere_donnee: string | null;
  n_lignes: number;
  cadence_attendue_jours: number | null;
  alimentation: string;
  age_jours: number | null;
}

/** `Controle` (`page.tsx:71-83`). */
interface Controle {
  cle: string;
  libelle: string;
  unite: string;
  attendu: number;
  mesure: number;
  ecart_absolu: number | null;
  ecart_relatif: number | null;
  tolerance: number;
  n_renseignes: number | null;
  pop_couverte: number | null;
  ok: boolean;
}

/**
 * Teinte d'une ligne ou d'un verdict — remplace les couleurs de `VERDICTS` (`page.tsx:86-98`) :
 * texte `var(--danger|--warning|--text-secondary|--text-tertiary)`, fonds `rgba(…, 0.08)` /
 * `rgba(78,205,196,0.06)` → `color-mix` du jeton à la même opacité (C9).
 */
type Teinte = 'danger' | 'avert' | 'info' | 'neutre';

/** `VERDICTS` (`page.tsx:86-98`), textes recopiés tels quels. */
const VERDICTS: Record<LigneIndicateur['verdict'], { texte: string; teinte: Teinte }> = {
  colonne_absente: { texte: 'colonne non mesurable dans le schéma', teinte: 'danger' },
  source_vide: { texte: 'source vide — ne produira jamais rien', teinte: 'danger' },
  perime: { texte: 'source périmée', teinte: 'avert' },
  non_verifie: { texte: 'jamais calculé — non vérifié', teinte: 'info' },
  partiel: { texte: 'couverture partielle', teinte: 'avert' },
  ok: { texte: 'ok', teinte: 'neutre' },
};

function dateCourte(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

interface VueIndicateurs {
  type: 'indicateurs';
  nProblemes: number;
  nTotal: number;
  lignes: {
    code: string; label: string; colonne: string; source: string; population: string; cp: string;
    verdict: string; teinte: Teinte;
  }[];
}

interface VueFraicheur {
  type: 'fraicheur';
  lignes: { table: string; libelle: string; derniere: string; age: string; lignes: string; alimentation: string; perime: boolean }[];
}

interface VueInvariants {
  type: 'invariants';
  nEchecs: number;
  nTotal: number;
  lignes: { cle: string; libelle: string; attendu: string; mesure: string; ecart: string; ok: boolean }[];
}

interface VueColonnes {
  type: 'colonnes';
  nVides: string;
  nTotal: number;
  nLignes: string;
  lignes: { nom: string; renseignes: string; nonNuls: string; couverture: string; teinte: Teinte }[];
}

type VueReleve = VueIndicateurs | VueFraicheur | VueInvariants | VueColonnes;

/** `VueIndicateurs` (`page.tsx:244-307`) : les problèmes d'abord, puis les « ok ». */
function vueIndicateurs(releve: unknown): VueIndicateurs {
  const d = releve as { indicateurs?: LigneIndicateur[] };
  const toutes = d.indicateurs ?? [];
  const problemes = toutes.filter((l) => l.verdict !== 'ok');
  return {
    type: 'indicateurs',
    nProblemes: problemes.length,
    nTotal: toutes.length,
    lignes: [...problemes, ...toutes.filter((l) => l.verdict === 'ok')].map((l) => {
      const v = VERDICTS[l.verdict];
      const part = l.n_source != null && l.n_total_source ? Math.round((l.n_source / l.n_total_source) * 100) : null;
      return {
        code: l.indicator_code,
        label: l.label,
        colonne: l.data_column ?? `(${l.data_source})`,
        source: l.n_source != null ? `${formaterNombre(l.n_source)}${part != null ? ` · ${part} %` : ''}` : '—',
        // La couverture qui compte est celle de la POPULATION, pas celle des lignes (page.tsx:285-290).
        population: l.part_population != null ? `${l.part_population} %` : '—',
        cp: `${l.n_cp != null ? formaterNombre(l.n_cp) : '—'}${l.age_source_jours != null ? ` · ${l.age_source_jours} j` : ''}`,
        verdict: v.texte,
        teinte: v.teinte,
      };
    }),
  };
}

/** `VueFraicheur` (`page.tsx:309-355`) : périmé = plus de 3 cadences de retard. */
function vueFraicheur(releve: unknown): VueFraicheur {
  const d = releve as { sources?: LigneSource[] };
  return {
    type: 'fraicheur',
    lignes: (d.sources ?? []).map((s) => ({
      table: s.table,
      libelle: s.libelle,
      derniere: s.derniere_donnee ?? '—',
      age: s.age_jours != null ? `${formaterNombre(s.age_jours)} j` : '—',
      lignes: formaterNombre(s.n_lignes),
      alimentation: s.alimentation,
      perime: s.cadence_attendue_jours != null && s.age_jours != null && s.age_jours > s.cadence_attendue_jours * 3,
    })),
  };
}

/** `VueInvariants` (`page.tsx:357-401`) : l'écart en unité métier à côté du pourcentage. */
function vueInvariants(releve: unknown): VueInvariants {
  const d = releve as { controles?: Controle[] };
  const controles = d.controles ?? [];
  return {
    type: 'invariants',
    nEchecs: controles.filter((c) => !c.ok).length,
    nTotal: controles.length,
    lignes: controles.map((c) => ({
      cle: c.cle,
      libelle: c.libelle,
      attendu: `${formaterNombre(c.attendu)} ${c.unite}`,
      mesure: `${formaterNombre(c.mesure)} ${c.unite}`,
      ecart: c.ecart_absolu != null && c.ecart_absolu !== 0
        ? `${c.ecart_absolu > 0 ? '+' : ''}${formaterNombre(c.ecart_absolu)} ${c.unite}`
        : c.ecart_relatif != null ? `${(c.ecart_relatif * 100).toFixed(4)} %` : '—',
      ok: c.ok,
    })),
  };
}

/** `VueColonnes` (`page.tsx:403-444`) : de la moins à la plus couverte. */
function vueColonnes(releve: unknown): VueColonnes {
  const d = releve as { n_lignes: number; colonnes?: Record<string, { renseignes: number; non_nuls: number }> };
  const entrees = Object.entries(d.colonnes ?? {})
    .map(([nom, v]) => ({ nom, ...v, part: d.n_lignes ? v.renseignes / d.n_lignes : 0 }))
    .sort((a, b) => a.part - b.part);
  return {
    type: 'colonnes',
    nVides: formaterNombre(entrees.filter((e) => e.renseignes === 0).length),
    nTotal: entrees.length,
    nLignes: formaterNombre(d.n_lignes),
    lignes: entrees.map((e) => ({
      nom: e.nom,
      renseignes: formaterNombre(e.renseignes),
      // « Renseignée » et « non nulle » sont distinguées : une colonne pleine de zéros n'est PAS vide.
      nonNuls: formaterNombre(e.non_nuls),
      couverture: `${Math.round(e.part * 100)} %`,
      teinte: (e.renseignes === 0 ? 'danger' : e.part < 0.5 ? 'avert' : 'neutre') as Teinte,
    })),
  };
}

const VUES: Record<CleVerification, (releve: unknown) => VueReleve> = {
  indicateurs: vueIndicateurs,
  fraicheur: vueFraicheur,
  invariants: vueInvariants,
  colonnes: vueColonnes,
};

interface VueVerification {
  cle: CleVerification;
  libelle: string;
  cout: string;
  etat: string;
  bouton: string;
  titre: string;
  vue: VueReleve | null;
}

/** POST : le `error` du corps (celui du SERVEUR, 429 compris), sinon `HTTP <statut>` (`page.tsx:140`). */
function messageVerification(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    const erreur = erreurDuCorps(e);
    if (erreur) return erreur;
    return e.status ? `HTTP ${e.status}` : 'Failed to fetch';
  }
  return e instanceof Error ? e.message : String(e);
}

/** GET : `HTTP <statut>` sans lire le corps (`page.tsx:116`). */
function messageLecture(e: unknown): string {
  if (e instanceof HttpErrorResponse) return e.status ? `HTTP ${e.status}` : 'Failed to fetch';
  return e instanceof Error ? e.message : String(e);
}

/**
 * `/admin/qualite-donnees` — portage de `app/admin/qualite-donnees/page.tsx`.
 *
 * **Rien ne se lance au chargement** : UN GET des relevés persistés, jamais un calcul. Chaque
 * vérification se relance par SON bouton, une à la fois (tous les boutons désactivés pendant,
 * la méthode refuse aussi un second envoi) ; le quota serveur (2/min) est la seule limite
 * réelle. **Aucun bouton « tout vérifier »** (incident du 28/03). Une famille jamais lancée
 * s'affiche « jamais lancée », pas « rien à signaler ».
 *
 * Écarts à React, voulus :
 * - couleurs (C9) : `rgba(255,87,87,0.08)`, `rgba(247,183,49,0.08)`, `rgba(78,205,196,0.06)`,
 *   `rgba(255,87,87,0.25)` → `color-mix` de `--danger` / `--warning` / `--brand-teal` à la même
 *   opacité ; polices en dur → `var(--font-sans)` / `var(--font-mono)`.
 * - réponse du POST non JSON : React affichait l'erreur de `res.json()` ; ici `HTTP <statut>`.
 *
 * - `persiste: false` (relevé non enregistré) est signalé, avec la phrase de Fraîcheur (Q-1, vague finale
 *   G6) : React le taisait, et un relevé affiché qui disparaît au rechargement ment.
 */
@Component({
  selector: 'mg-qualite-donnees',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './qualite-donnees.page.html',
  styles: [`
    :host { display: block; }
    /* Monté comme onglet du cadre Données (lot 6, T6) : le cadre pose déjà la marge de page et le titre ;
       le « padding: 32px 40px » et le h1 de React les doubleraient. */
    .page { max-width: 1100px; font-family: var(--font-sans); color: var(--text-secondary); }
    .intro { font-size: 13px; line-height: 1.6; margin: 0 0 28px; max-width: 720px; }
    .erreur {
      padding: 10px 12px; border-radius: 6px; margin-bottom: 20px; font-size: 12px; color: var(--danger-texte);
      background: color-mix(in srgb, var(--danger) 8%, transparent);
      border: 0.5px solid color-mix(in srgb, var(--danger) 25%, transparent);
    }
    .mono { font-family: var(--font-mono); }
    .chargement { font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary); }
    .liste { display: flex; flex-direction: column; gap: 20px; }
    section { background: var(--surface); border: 0.5px solid var(--border-subtle); border-radius: 8px; }
    header {
      display: flex; align-items: center; gap: 8px; padding: 10px 14px;
      background: var(--elevated); border-top: 1px solid var(--border-subtle); border-radius: 8px 8px 0 0;
    }
    .point { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-teal); flex-shrink: 0; }
    .titre { font-size: 12px; font-weight: 500; color: var(--text-primary); flex: 1; }
    .etat { font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); }
    button {
      background: transparent; border: 0.5px solid var(--brand-teal); color: var(--teal-texte);
      border-radius: 6px; padding: 5px 12px; font-family: var(--font-sans); font-size: 11px; font-weight: 500;
      cursor: pointer;
    }
    button:disabled { cursor: not-allowed; opacity: 0.4; }
    .corps { padding: 14px; }
    .cout { font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); }
    .jamais { font-size: 12px; color: var(--text-tertiary); }
    .synthese { font-size: 12px; margin-bottom: 10px; }
    .synthese strong { color: var(--text-primary); font-weight: 700; }
    .synthese strong.danger { color: var(--danger-texte); }
    .defile { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th {
      text-align: left; font-family: var(--font-sans); font-size: 11px; font-weight: 400;
      color: var(--text-tertiary); padding: 6px 10px; border-bottom: 0.5px solid var(--border-subtle);
    }
    td {
      font-family: var(--font-sans); font-size: 12px; color: var(--text-secondary);
      padding: 7px 10px; border-bottom: 0.5px solid var(--border-subtle);
    }
    td.m { font-family: var(--font-mono); font-size: 11px; }
    .d { text-align: right; }
    .petit { font-size: 11px; }
    .sous { font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); }
    tr[data-teinte='danger'] { background: color-mix(in srgb, var(--danger) 8%, transparent); }
    tr[data-teinte='avert'] { background: color-mix(in srgb, var(--warning) 8%, transparent); }
    tr[data-teinte='info'] { background: color-mix(in srgb, var(--brand-teal) 6%, transparent); }
    .c-danger { color: var(--danger-texte); }
    .c-avert { color: var(--warning-texte); }
    .c-info { color: var(--text-secondary); }
    .c-neutre { color: var(--text-tertiary); }
    .contresens { font-size: 11px; color: var(--text-tertiary); margin-top: 10px; line-height: 1.6; }
  `],
})
export class QualiteDonneesPage {
  private readonly api = inject(QualiteApi);
  private lecture: Subscription | null = null;
  private verification: Subscription | null = null;

  private readonly verifications = signal<Verification[]>([]);
  protected readonly chargement = signal(true);
  protected readonly enCours = signal<CleVerification | null>(null);
  protected readonly erreur = signal<string | null>(null);

  protected readonly vues = computed<VueVerification[]>(() => {
    const enCours = this.enCours();
    return this.verifications().map((v) => ({
      cle: v.cle,
      libelle: v.libelle,
      cout: v.cout,
      etat: v.calcule_le
        ? `mesuré le ${dateCourte(v.calcule_le)}${v.duree_ms ? ` · ${formaterNombre(v.duree_ms)} ms` : ''}`
        : 'jamais lancée',
      bouton: enCours === v.cle ? 'Mesure…' : v.calcule_le ? 'Relancer' : 'Lancer',
      titre: `Coût : ${v.cout}`,
      vue: v.releve ? VUES[v.cle](v.releve) : null,
    }));
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      // Quitter la page annule la requête côté navigateur, mais le serveur termine sa RPC et persiste
      // le relevé quand même (et le quota est déjà consommé) : on ne fait qu'ignorer la réponse.
      this.verification?.unsubscribe();
    });
    // Lecture des relevés PERSISTÉS, jamais un calcul.
    this.lecture = this.api.lire().subscribe({
      next: (r) => {
        this.verifications.set(r.verifications ?? []);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.erreur.set(messageLecture(e));
        this.chargement.set(false);
      },
    });
  }

  /** `relancer` (`page.tsx:129-149`) : UNE vérification à la fois, y compris côté client. */
  protected relancer(cle: CleVerification): void {
    if (this.enCours()) return;
    this.enCours.set(cle);
    this.erreur.set(null);
    this.verification = this.api.verifier(cle).subscribe({
      next: (r) => {
        this.verifications.update((prev) => prev.map((v) => (
          v.cle === cle ? { ...v, releve: r.releve, calcule_le: r.calcule_le, duree_ms: r.duree_ms } : v
        )));
        if (r.persiste === false) {
          this.erreur.set('Mesure faite, mais elle n’a pas pu être enregistrée : elle sera perdue au rechargement.');
        }
        this.enCours.set(null);
      },
      error: (e: unknown) => {
        this.erreur.set(messageVerification(e));
        this.enCours.set(null);
      },
    });
  }
}
