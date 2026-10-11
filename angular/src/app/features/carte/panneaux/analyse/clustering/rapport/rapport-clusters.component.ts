import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, untracked,
  viewChild,
} from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import { messageErreurApi } from '../../../../../../core/http/erreurs';
import { CouleursService } from '../../../../../../core/theme/couleurs.service';
import { ClusteringApi } from '../../../../data/clustering.api';
import { couleurBadge, jetonSilhouette } from '../../../../logique/clustering/panneau';
import { themesBadge } from '../../../../logique/clustering/rapport';
import type { DonneesRapport } from './commun-rapport';
import { OngletCarteComponent } from './onglet-carte.component';
import { OngletComparaisonComponent } from './onglet-comparaison.component';
import { OngletHistoriqueComponent } from './onglet-historique.component';
import { OngletMethodologieComponent } from './onglet-methodologie.component';
import { OngletProfilsComponent } from './onglet-profils.component';
import { OngletQualiteComponent } from './onglet-qualite.component';
import { OngletResumeComponent } from './onglet-resume.component';

const ONGLETS = [
  { id: 'resume', libelle: 'Résumé' },
  { id: 'carte', libelle: 'Carte' },
  { id: 'profils', libelle: 'Profils' },
  { id: 'comparaison', libelle: 'Comparaison' },
  { id: 'qualite', libelle: 'Qualité' },
  { id: 'methodologie', libelle: 'Méthodologie' },
  { id: 'historique', libelle: 'Historique' },
] as const;
type OngletRapport = (typeof ONGLETS)[number]['id'];

/** `EXPORTS_INDISPONIBLES` (`ClusterDetails.tsx:973-974`) : les deux exports restent visibles, inactifs, et le disent. */
const EXPORTS_INDISPONIBLES = 'Export non restauré — dépendance retirée du projet (voir docs/PLAN_CLUSTERING.md)';

/**
 * Le rapport d'un modèle de clustering — `ClusterResultsOverlay` + `ClusterDetails` (`components/`, lot 4, T19) : un
 * tiroir à droite (900 px au plus, 65 % de la largeur), sept onglets.
 *
 * `<dialog>` natif (B13), dans la racine d'ombre : React portait le tiroir vers `<body>` (`createPortal`) parce qu'un
 * ancêtre animé le comprimait — ici `showModal()` le pose dans la couche supérieure, sans quitter l'arbre. Échap,
 * voile et « ← Fermer » le ferment ; l'Échap est CONSOMMÉ (le panneau Analyse derrière reste ouvert, comme la pile
 * Échap de React). Voile sans flou : « flat total ».
 *
 * Lit le modèle et les moyennes nationales EN PARALLÈLE (2 appels, sous le limiteur de 3) ; moyennes absentes (404) →
 * rapport sans référence, comme React. Non porté : « + Analyser » / « ↺ IA » (analyse Gemini — aucune IA portée, et
 * React ne l'affichait nulle part : elle ne nourrissait que l'export PDF, non restauré).
 */
@Component({
  selector: 'mg-rapport-clusters',
  imports: [
    OngletCarteComponent, OngletComparaisonComponent, OngletHistoriqueComponent, OngletMethodologieComponent, OngletProfilsComponent,
    OngletQualiteComponent, OngletResumeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialogue aria-label="Rapport du modèle de clustering" (cancel)="surAnnulation($event)" (keydown.escape)="echap($event)" (click)="surClic($event)">
      @if (chargement()) {
        <div class="p-10 text-center font-mono text-[12px] text-secondary">Chargement...</div>
      } @else if (erreur(); as e) {
        <div class="p-8">
          <div class="alerte rounded-[2px] px-4 py-3 font-mono text-[12px] text-danger">! {{ e }}</div>
          <button type="button" data-retour class="mt-3 cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] text-teal" (click)="fermer.emit()">← Retour</button>
        </div>
      } @else if (donnees(); as d) {
        <div class="flex h-full flex-col overflow-hidden">
          <div class="shrink-0 border-b-fin border-subtle bg-surface px-7 pt-5">
            <div class="mb-3 flex items-center gap-3">
              <button type="button" data-fermer class="cursor-pointer border-0 bg-transparent p-0 font-mono text-[10px] text-tertiary" (click)="fermer.emit()">← Fermer</button>
              <span class="text-subtle" aria-hidden="true">|</span>
              <span class="text-[18px] font-medium tracking-[-0.02em] text-primary">Clustering v{{ d.modele.version }}</span>
              <span class="silhouette rounded-[2px] px-1.5 py-0.5 font-mono text-[10px]" [style.--teinte]="teinteSilhouette()">SIL {{ silhouette() }}</span>
              @if (themes(); as t) { <span class="themes rounded-[2px] px-1.5 py-0.5 text-[10px]">{{ t }}</span> }
              <span class="ml-1 font-mono text-[10px] text-tertiary">{{ d.modele.k }} clusters · {{ d.modele.n_poi_trained }} POI · {{ d.modele.duration_minutes }}min {{ d.modele.mode }}</span>
              <div class="ml-auto flex items-center gap-2">
                <button type="button" data-export class="export" disabled [title]="indisponible">↓ XLSX</button>
                <button type="button" data-export class="export" disabled [title]="indisponible">↓ PDF</button>
              </div>
            </div>
            <div class="flex overflow-auto border-b-fin border-subtle" role="tablist">
              @for (o of onglets; track o.id) {
                <button type="button" role="tab" data-onglet class="onglet" [class.actif]="onglet() === o.id" [attr.aria-selected]="onglet() === o.id"
                        (click)="onglet.set(o.id)">{{ o.libelle }}</button>
              }
            </div>
          </div>
          <div class="flex-1 overflow-auto px-7 pt-6 pb-12">
            @switch (onglet()) {
              @case ('resume') { <mg-onglet-resume [d]="d" /> }
              @case ('carte') { <mg-onglet-carte [d]="d" /> }
              @case ('profils') { <mg-onglet-profils [d]="d" /> }
              @case ('comparaison') { <mg-onglet-comparaison [d]="d" /> }
              @case ('qualite') { <mg-onglet-qualite [d]="d" /> }
              @case ('methodologie') { <mg-onglet-methodologie [modele]="d.modele" /> }
              @case ('historique') { <mg-onglet-historique [d]="d" /> }
            }
          </div>
        </div>
      }
    </dialog>
  `,
  styles: `
    dialog {
      margin: 0 0 0 auto; padding: 0; height: 100%; max-height: 100%; width: min(900px, 65vw); max-width: 100%;
      background: var(--bg-primary); color: var(--text-primary); border: 0; border-left: 0.5px solid var(--border-subtle);
      font-family: var(--font-sans); overflow: hidden;
    }
    /* Le voile de React (rgba(0,0,0,0.4)) : noir à 40 % dans les deux thèmes — le jeton invariant --brand-teal-fg
       (#050505) —, sans le flou (DESIGN_SYSTEM : flat total). */
    dialog::backdrop { background: color-mix(in srgb, var(--brand-teal-fg) 40%, transparent); }
    .alerte { background: color-mix(in srgb, var(--danger) 6%, transparent); border: 0.5px solid color-mix(in srgb, var(--danger) 19%, transparent); }
    .silhouette { color: var(--teinte); border: 0.5px solid currentColor; opacity: 0.8; }
    .themes { color: var(--brand-teal); border: 0.5px solid color-mix(in srgb, var(--brand-teal) 25%, transparent); opacity: 0.9; }
    .export {
      background: none; border: 0.5px solid var(--border-subtle); border-radius: 2px; padding: 4px 10px;
      font-size: 11px; color: var(--text-secondary); cursor: not-allowed; opacity: 0.45;
    }
    .onglet {
      background: none; border: 0; border-bottom: 2px solid transparent; cursor: pointer; padding: 10px 18px; white-space: nowrap;
      font-size: 12px; color: var(--text-tertiary); transition: color 150ms var(--ease-out), border-color 150ms var(--ease-out);
    }
    .onglet.actif { color: var(--brand-teal); border-bottom-color: var(--brand-teal); }
  `,
})
export class RapportClustersComponent {
  readonly version = input.required<number>();
  readonly fermer = output<void>();

  private readonly api = inject(ClusteringApi);
  /** Le gris de la donnée absente, en valeur calculée : repli d'une teinte de cluster invalide. */
  private readonly absente = inject(CouleursService).palette({ absente: 'donnee-absente' });
  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');

  protected readonly onglets = ONGLETS;
  protected readonly indisponible = EXPORTS_INDISPONIBLES;
  protected readonly onglet = signal<OngletRapport>('resume');
  protected readonly chargement = signal(true);
  protected readonly erreur = signal<string | null>(null);
  protected readonly donnees = signal<DonneesRapport | null>(null);

  protected readonly silhouette = computed(() => this.donnees()?.modele.silhouette_score.toFixed(3) ?? '');
  protected readonly teinteSilhouette = computed(() => `var(--${jetonSilhouette(this.donnees()?.modele.silhouette_score ?? 0)})`);
  protected readonly themes = computed(() => themesBadge(this.donnees()?.modele.feature_themes ?? null));

  constructor() {
    // Une lecture par version ouverte ; la précédente annulée si la version change pendant la lecture.
    effect((nettoyer) => {
      const version = this.version();
      untracked(() => {
        this.chargement.set(true);
        this.erreur.set(null);
        this.onglet.set('resume');
      });
      const lecture = forkJoin({
        r: this.api.modele(version),
        france: this.api.moyennesFrance().pipe(catchError(() => of(null))),
      }).subscribe({
        next: ({ r, france }) => {
          const cids = Object.keys(r.cluster_summary ?? {}).sort((a, b) => Number(a) - Number(b));
          // Les teintes viennent de la base : validées UNE fois ici, pour les sept onglets (SVG, DOM, ECharts).
          const absente = untracked(this.absente).absente;
          const resume = Object.fromEntries(Object.entries(r.cluster_summary ?? {}).map(([cid, c]) => [
            cid, { ...c, color: couleurBadge(c.color) === c.color ? c.color : absente },
          ]));
          this.donnees.set({ modele: r.model, resume, pois: r.poi_list, france, cids });
          this.chargement.set(false);
        },
        error: (e: unknown) => {
          this.erreur.set(messageErreurApi(e));
          this.chargement.set(false);
        },
      });
      nettoyer(() => lecture.unsubscribe());
    });

    afterNextRender(() => {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
    });
    const hote = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    inject(DestroyRef).onDestroy(() => {
      const d = hote.querySelector('dialog');
      if (d?.open) d.close();
    });
  }

  /** Échap : consommé — il ferme le rapport, pas aussi le panneau derrière. */
  protected echap(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.fermer.emit();
  }

  /** Fermeture native (Échap traité par le navigateur seul) : on garde la main, le parent décide. */
  protected surAnnulation(e: Event): void {
    e.preventDefault();
    this.fermer.emit();
  }

  /** Le voile : un clic dont la cible est le `<dialog>` lui-même, hors de son contenu. */
  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement) this.fermer.emit();
  }
}
