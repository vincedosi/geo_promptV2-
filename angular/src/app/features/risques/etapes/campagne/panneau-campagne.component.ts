import type { HttpResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked,
} from '@angular/core';
import type { Observable, Subscription } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { CourbeComponent } from '../../../../graphiques/courbe.component';
import type { RepereCourbe, SerieCourbe } from '../../../../graphiques/option-courbe';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { type Extraction, JeuxZonesApi } from '../../data/jeux-zones.api';
import { SimulationApi } from '../../data/simulation.api';
import { type ReglagesSimulation, SimulationService } from '../../etat/simulation.service';
import { BoutonExportComponent } from '../../exports/bouton-export.component';
import {
  DEFAUTS, PERIODES, REGLAGES, blocsACorriger, classeBouton, lignesBilan, lignesPartenaires, sitesSousServis,
} from '../../logique/panneau-campagne';
import { LIBELLE_PERIODE } from '../../logique/simulation/vue';

/**
 * Le panneau de l'étape ⑤ Campagne — portage de `PanneauCampagne.tsx`.
 *
 * ── DE HAUT EN BAS, DANS L'ORDRE DU GESTE ─────────────────────────────────
 *
 * 1. **La campagne** : l'extraction qu'on fait diffuser, les réglages, puis Simuler, Recaler, Exporter, Purger.
 * 2. **La période** : v1, v2 ou la campagne entière — elle pilote TOUT l'écran, bandeau, carte et tableau compris.
 * 3. **L'alignement jour par jour**, avec le recalage annoté, et le bilan avant et après.
 * 4. **Ce qu'il faut corriger**, **les partenaires**, **les sites sous-servis**.
 *
 * ⚠ Aucun badge « Simulation » : arbitrage du 2026-09-24. Le drapeau vit en base (`dsp_campaigns.est_simulation`).
 *
 * Différence avec React, voulue (A8) : « Exporter en Excel » passe par `mg-bouton-export` (Bearer), là où React posait
 * un `<a href>` vers une route qui ne lit que l'en-tête `Authorization`.
 */
@Component({
  selector: 'mg-panneau-campagne',
  imports: [BoutonExportComponent, CourbeComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col gap-[18px] overflow-auto px-5 py-4' },
  templateUrl: './panneau-campagne.component.html',
})
export class PanneauCampagneComponent {
  protected readonly simulation = inject(SimulationService);
  private readonly jeuxApi = inject(JeuxZonesApi);
  private readonly simulationApi = inject(SimulationApi);

  protected readonly texte = 'm-0 text-[12px] leading-[1.55] text-secondary';
  protected readonly note = 'm-0 text-[11px] leading-[1.55] text-tertiary';
  protected readonly fort = 'font-medium text-primary';
  protected readonly entete = 'mb-3 flex items-center gap-2 border-t border-subtle bg-elevated px-[14px] py-[10px]';
  protected readonly point = 'size-[6px] shrink-0 rounded-full bg-teal';
  protected readonly titre = 'm-0 text-[12px] font-medium text-primary';
  protected readonly th = 'whitespace-nowrap border-b-fin border-default px-[6px] py-[5px] font-normal text-tertiary';
  protected readonly td = 'whitespace-nowrap border-b-fin border-subtle px-[6px] py-[5px] text-primary';
  protected readonly periodes = PERIODES;
  protected readonly libellePeriode = LIBELLE_PERIODE;

  protected readonly jeuId = this.simulation.jeu;
  protected readonly sim = computed(() => this.simulation.reponse()?.simulation ?? null);
  protected readonly vue = this.simulation.vue;

  /** Les extractions du jeu : `null` tant qu'elles n'ont pas été lues. */
  protected readonly extractions = signal<Extraction[] | null>(null);
  protected readonly version = signal<number | null>(null);
  protected readonly reglages = signal<ReglagesSimulation>(DEFAUTS);
  protected readonly confirmerPurge = signal(false);
  protected readonly occupe = computed(() => this.simulation.progression() !== null);
  protected readonly boutonPrincipal = computed(() => classeBouton(true, this.occupe()));
  protected readonly boutonNeutre = computed(() => classeBouton(false, this.occupe()));
  protected readonly boutonSimuler = computed(() => classeBouton(true, this.occupe() || this.version() === null));

  protected readonly optionsExtractions = computed(() => (this.extractions() ?? []).map((e) => ({
    id: e.id,
    version: e.version,
    libelle: `v${e.version} · ${e.origine === 'recalage' ? 'recalage' : 'initiale'} · ${formaterNombre(e.n_retenus)} CP`,
  })));

  /** La barre du geste en cours : « 37 % · 31 000 / 83 977 lignes », rien quand l'avancement n'est pas mesurable. */
  protected readonly progression = computed(() => {
    const p = this.simulation.progression();
    if (!p) return null;
    const lignes = p.faites != null && p.total != null ? ` · ${formaterNombre(p.faites)} / ${formaterNombre(p.total)} lignes` : '';
    return { message: p.message, pourcentage: p.pourcentage, avancement: p.pourcentage === null ? null : `${p.pourcentage} %${lignes}` };
  });

  protected readonly reglagesAffiches = computed(() => {
    const g = this.reglages();
    return REGLAGES.map((r) => ({ ...r, valeur: g[r.cle], valeurTexte: r.format(g[r.cle]) }));
  });

  protected readonly dateDebut = computed(() => {
    const s = this.sim();
    return s ? new Date(`${s.date_debut}T00:00:00Z`).toLocaleDateString('fr-FR') : '';
  });

  /** « Exporter en Excel » : le classeur de la simulation, lu au clic (A8). */
  protected readonly chargerExport = (): Observable<HttpResponse<Blob>> =>
    this.simulationApi.exportSimulation(this.jeuId()!);

  // ── La courbe : deux séries et non une colorée par segment — la rupture EST l'information. ──
  protected readonly seriesCourbe = computed<SerieCourbe[]>(() => {
    const pts = this.simulation.courbe();
    return [
      { cle: 'v1', libelle: 'Alignement', jeton: 'diverge-sous-2', epaisseur: 2, marqueurs: true, points: pts.map((p) => [p.jour, p.version === 1 ? p.score : null] as const) },
      { cle: 'v2', libelle: 'Alignement', jeton: 'brand-teal', epaisseur: 2, marqueurs: true, points: pts.map((p) => [p.jour, p.version === 2 ? p.score : null] as const) },
    ];
  });
  protected readonly repere = computed<RepereCourbe | undefined>(() => {
    const s = this.sim();
    return s ? { x: s.jour_recalage, libelle: 'Recalage v2', jeton: 'text-tertiary', jetonLibelle: 'text-secondary' } : undefined;
  });
  protected readonly domaineX = computed<readonly [number, number]>(() => [1, this.sim()?.jours ?? 1]);
  protected readonly graduationsX = computed(() => [1, 7, 14, 21, 28].filter((t) => t <= (this.sim()?.jours ?? 0)));
  /** Recharts : marge {14, 8, 0, −18}, axe Y de 60 px (−18 + 60 = 42), axe X de 30 px. */
  protected readonly marges = { top: 14, right: 8, bottom: 30, left: 42 };
  protected readonly formaterJour = (v: number): string => `j${v}`;
  protected readonly formaterScore = (v: number): string => String(v);
  protected readonly formaterTitre = (v: number): string => `Jour ${v}`;
  protected readonly formaterArrondi = (v: number): string => String(Math.round(v));

  /** Le bilan avant / après, TOUJOURS sur v1 et v2, quelle que soit la période choisie. */
  protected readonly bilan = computed(() => lignesBilan(this.simulation.reponse()));

  protected readonly corriger = computed(() => {
    const v = this.vue();
    const entrees = this.simulation.reponse()?.entrees;
    return v && entrees ? blocsACorriger(v, entrees) : null;
  });

  protected readonly partenaires = computed(() => lignesPartenaires(this.vue()));

  protected readonly sousServis = computed(() => {
    const v = this.vue();
    return v ? sitesSousServis(v) : null;
  });

  private abonnementExtractions: Subscription | null = null;
  /** Jeu des extractions lues en dernier : la version choisie ne vaut que pour lui. */
  private jeuLu: string | null = null;

  constructor() {
    // Les extractions du jeu : relues quand la simulation change, puisqu'un recalage en crée une
    // (`PanneauCampagne.tsx:71-88`, dépendances `[jeuId, sim?.id, sim?.statut]`).
    const cle = computed(() => {
      const s = this.sim();
      return { jeu: this.jeuId(), id: s?.id ?? null, statut: s?.statut ?? null };
    }, { equal: (a, b) => a.jeu === b.jeu && a.id === b.id && a.statut === b.statut });
    effect(() => {
      const { jeu } = cle();
      untracked(() => this.lireExtractions(jeu));
    });
    inject(DestroyRef).onDestroy(() => this.abonnementExtractions?.unsubscribe());
  }

  private lireExtractions(jeu: string | null): void {
    this.abonnementExtractions?.unsubscribe();
    // Défaut React corrigé : React garde la version du jeu PRÉCÉDENT (`setVersion((v) => v ?? …)`), et Simuler partirait
    // sur une version que ce jeu n'a peut-être pas. Un autre jeu repart de sa propre version par défaut.
    if (jeu !== this.jeuLu) this.version.set(null);
    this.jeuLu = jeu;
    if (!jeu) {
      this.extractions.set(null);
      return;
    }
    this.abonnementExtractions = this.jeuxApi.extractions(jeu).subscribe({
      next: (d) => {
        const liste = d?.extractions ?? [];
        this.extractions.set(liste);
        // Par défaut, la dernière extraction INITIALE : une v2 de recalage est un produit de simulation, pas un plan
        // qu'on a décidé.
        this.version.update((v) => v ?? liste.find((e) => e.origine === 'initiale')?.version ?? liste[0]?.version ?? null);
      },
      // Comme React : une liste illisible se lit « aucune extraction ».
      error: () => this.extractions.set([]),
    });
  }

  protected choisirVersion(ev: Event): void {
    this.version.set(Number((ev.target as HTMLSelectElement).value));
  }

  protected regler(cle: keyof ReglagesSimulation, ev: Event): void {
    const v = Number((ev.target as HTMLInputElement).value);
    this.reglages.update((g) => ({ ...g, [cle]: v }));
  }

  protected simuler(): void {
    const v = this.version();
    if (v !== null) void this.simulation.simuler(v, this.reglages());
  }

  protected recaler(): void {
    void this.simulation.recaler();
  }

  protected purger(): void {
    this.confirmerPurge.set(false);
    void this.simulation.purger();
  }
}
