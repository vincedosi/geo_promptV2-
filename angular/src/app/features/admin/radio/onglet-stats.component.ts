import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { formaterNombre } from '../../../core/format/nombre';
import { messageErreurApi } from '../../../core/http/erreurs';
import { EnteteSectionComponent } from '../../../ui/entete-section/entete-section.component';
import { RadioAdminApi, type AuditRadio } from './data/radio-admin.api';
import { RadioOngletsService } from './etat/radio-onglets.service';
import {
  dureeEnrichissement, filtrerNonMatchees, fmtDate, libelleCategorie, partSource, resumeEnrichissement, slugRadio,
  teinteBarreCategorie, teinteDiagnostic, teinteKpiMatchees, teintePctCategorie, teinteStatut,
} from './logique/radio';

/** Options des menus de React (`page.tsx:787-803`), dans l'ordre. */
const CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'P'] as const;
const DIAGNOSTICS = [
  { valeur: '', libelle: 'Tous diagnostics' },
  { valeur: 'parent', libelle: 'Parent detecte' },
  { valeur: 'declinaison', libelle: 'Declinaison locale' },
  { valeur: 'absente', libelle: 'Absente sources' },
  { valeur: 'aucune', libelle: 'Aucune freq FM' },
] as const;
const FREQUENCES = [
  { valeur: 0, libelle: 'Toutes freq' },
  { valeur: 3, libelle: '3+ freq FM' },
  { valeur: 5, libelle: '5+ freq FM' },
] as const;

/** Pastille de chaque source (`colors`, `page.tsx:856`) ; une source inconnue est tertiaire. */
const TEINTES_SOURCE: Record<string, string> = { 'freq-radio': 'teal', arcom: 'info', 'fallback-national': 'avert' };

/**
 * Onglet « Statistiques » de l'écran Radio (`admin/donnees/importer/radio/stats`) — l'audit du matching,
 * portage de `app/admin/radio/page.tsx:719-898` et de `fetchAudit` (l.118-125) (lot 6, T17). Lecture seule.
 *
 * Comme React : UN `GET /api/radio/audit` à CHAQUE ouverture de l'onglet (`useEffect` sur `tab`, l.337),
 * « Chargement de l'audit... » pendant la lecture ; sections dans l'ordre KPI, barre, par catégorie, non
 * matchées (filtres locaux), sources, derniers enrichissements ; les filtres vivent au niveau de la page
 * (`RadioOngletsService`). Aucun nombre recalculé : tout vient de la RPC `get_radio_audit`.
 *
 * Écarts à React, voulus et listés au rapport :
 * - **refus de la route affiché** (`role="alert"`) : React restait sur « Chargement de l'audit... » ;
 * - **catégorie choisie surlignée dès le clic** : React ne posait le fond qu'au `mouseleave` suivant ;
 *   ligne cliquable au clavier (`tabindex`, Entrée / Espace, `aria-selected`) ;
 * - **couleurs** (C9) : `#5b9bd5` → `--info`, `rgba(…)` → `color-mix` des jetons, teal du texte lisible
 *   en clair (`light-dark`, comme T16).
 */
@Component({
  selector: 'mg-radio-stats',
  imports: [EnteteSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onglet-stats.component.html',
  styleUrl: './onglet-stats.component.css',
})
export class OngletStatsComponent {
  private readonly api = inject(RadioAdminApi);
  protected readonly reglages = inject(RadioOngletsService);

  protected readonly categories = CATEGORIES;
  protected readonly diagnostics = DIAGNOSTICS;
  protected readonly frequences = FREQUENCES;

  protected readonly chargement = signal(true);
  protected readonly erreur = signal<string | null>(null);
  private readonly audit = signal<AuditRadio | null>(null);

  protected readonly kpis = computed(() => {
    const a = this.audit();
    if (!a) return null;
    const k = a.kpis;
    return {
      pct: k.pct,
      cartes: [
        { libelle: 'Radios matchees', valeur: `${k.matchees} / ${k.total}`, sous: `${k.pct}%`, teinte: teinteKpiMatchees(k.pct) as string | null },
        { libelle: 'Non matchees', valeur: String(k.non_matchees), sous: `${(100 - k.pct).toFixed(1)}%`, teinte: k.non_matchees > 0 ? 'danger' : 'succes' },
        { libelle: 'Relations m2m', valeur: formaterNombre(k.relations), sous: 'emetteur x radio', teinte: null },
      ],
    };
  });

  protected readonly lignesCategories = computed(() => (this.audit()?.par_categorie ?? []).map((r) => ({
    cat: r.cat,
    libelle: libelleCategorie(r.cat),
    matchees: `${r.matchees}/${r.total}`,
    nonMatchees: r.non_matchees,
    pct: `${r.pct}%`,
    largeur: r.pct,
    teintePct: teintePctCategorie(r.pct),
    teinteBarre: teinteBarreCategorie(r.pct),
  })));

  protected readonly titreNonMatchees = computed(() => `Radios non matchees (${this.audit()?.non_matchees.length ?? 0})`);

  protected readonly lignesNonMatchees = computed(() => filtrerNonMatchees(this.audit()?.non_matchees ?? [], {
    cat: this.reglages.auditCategorie(),
    diag: this.reglages.auditDiagnostic(),
    freqMin: this.reglages.auditFrequencesMin(),
    recherche: this.reglages.auditRecherche(),
  }).map((r) => ({
    id: r.id,
    nom: r.nom,
    cat: r.cat,
    portee: r.portee ?? '—',
    freq: r.nb_freq_ods,
    fort: r.nb_freq_ods >= 5,
    diagnostic: r.diagnostic,
    teinte: teinteDiagnostic(r.diagnostic),
    freqRadio: `https://www.frequence-radio.com/frequence-${slugRadio(r.nom)}.html`,
    arcom: `https://www.arcom.fr/rechercher?query=${encodeURIComponent(r.nom)}`,
  })));

  protected readonly sources = computed(() => {
    const a = this.audit();
    if (!a) return [];
    return (a.sources ?? []).map((s) => ({
      source: s.source,
      part: partSource(s.relations, a.kpis.relations),
      teinte: TEINTES_SOURCE[s.source] ?? 'tertiaire',
    }));
  });

  protected readonly enrichissements = computed(() => (this.audit()?.historique ?? []).map((h) => ({
    id: h.id,
    date: fmtDate(h.started_at),
    duree: dureeEnrichissement(h.duration_s),
    resume: resumeEnrichissement(h),
    teinte: teinteStatut(h.status),
  })));

  constructor() {
    const lecture = this.api.audit().subscribe({
      next: (a) => {
        this.audit.set(a);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.erreur.set(messageErreurApi(e));
        this.chargement.set(false);
      },
    });
    inject(DestroyRef).onDestroy(() => lecture.unsubscribe());
  }

  /** Clic sur une catégorie : filtre les non matchées, un second clic le retire (`page.tsx:764`). */
  protected basculerCategorie(cat: string): void {
    this.reglages.auditCategorie.update((c) => (c === cat ? '' : cat));
  }

  protected choisirCategorie(valeur: string): void {
    this.reglages.auditCategorie.set(valeur);
  }

  protected choisirDiagnostic(valeur: string): void {
    this.reglages.auditDiagnostic.set(valeur);
  }

  protected choisirFrequences(valeur: string): void {
    this.reglages.auditFrequencesMin.set(Number(valeur));
  }

  protected chercher(valeur: string): void {
    this.reglages.auditRecherche.set(valeur);
  }
}
