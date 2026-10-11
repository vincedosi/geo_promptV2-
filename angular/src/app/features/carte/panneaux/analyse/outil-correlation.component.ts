import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { formaterNombreAbrege } from '../../../../core/format/nombre';
import { NuageComponent } from '../../../../graphiques/nuage.component';
import type { PointNuage } from '../../../../graphiques/option-nuage';
import { AnalysesApi } from '../../data/analyses.api';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import { dateFr, messageErreurRequete } from '../../logique/analyses/commun';
import {
  type CampagneItem, N_MIN_NUAGE, type ResultatCorrelation, ligneCouverture, lignesInfobulle, lireCoefficient, nomCampagne,
} from '../../logique/analyses/correlation';
import { type IndicateurRegistre, libelleIndicateur } from '../../logique/analyses/score';
import {
  BOUTON_CALCUL, CORPS_ACCORDEON, ENCART_AVERTISSEMENT, ENCART_ERREUR, ENTETE_ACCORDEON, LIBELLE_CHAMP, LISTE_CHAMP,
} from './styles-analyse';

/**
 * L'outil « Corrélation » du panneau Analyse — portage de `filter-panel/CorrelationTool.tsx` (lot 4, T18). Répond à
 * « ma campagne a-t-elle arrosé les codes postaux qui comptent ? » : nuage impressions × indicateur INSEE, un point
 * par code postal, coefficient de Pearson.
 *
 * `r` ne se montre JAMAIS seul : `n` et la couverture (CP appariés / touchés par la campagne) l'accompagnent, et sous
 * 30 points le coefficient n'est pas commenté. Sous 3 points, pas de nuage : l'écran le dit.
 *
 * ── PAS DE GARDE DE PÉRIMÈTRE, DÉLIBÉRÉMENT ──────────────────────────────
 * L'outil est borné par une CAMPAGNE (accès vérifié par la route), pas par un territoire : il lit un agrégat déjà
 * calculé (`campaign_cp_rollup`), il n'y a aucun balayage à empêcher. Il appelle donc l'API lui-même, sans passer par
 * le panneau (le verrou structurel le déclare).
 *
 * Campagnes et catalogue sont lus au PREMIER dépliage, jamais au montage ; le catalogue est partagé avec le score
 * composite (`CatalogueIndicateursService`). Deux appels au plus, sous le plafond de trois.
 */
@Component({
  selector: 'mg-outil-correlation',
  imports: [NuageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <button type="button" data-entete-outil [attr.aria-expanded]="ouvert()" (click)="basculer()" [class]="entete">
      <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
      <span class="flex-1 text-left text-[12px] font-medium text-primary">Corrélation</span>
      <span class="text-[10px] text-tertiary">{{ ouvert() ? '▲' : '▼' }}</span>
    </button>
    @if (ouvert()) {
      <div [class]="corps">
        <div class="text-[11px] leading-[1.5] text-tertiary">
          Compare les impressions livrées par code postal à un indicateur INSEE, pour voir si la campagne a arrosé les zones qui comptent.
        </div>

        @if (chargementListes()) {
          <div class="font-mono text-[11px] text-tertiary">Chargement…</div>
        } @else {
          <div>
            <div [class]="libelleChamp">Campagne</div>
            <!-- Le résultat est PÉRIMÉ dès qu'un champ change : sinon le r, le n et le nuage de la précédente restaient.
                 « selected » sur CHAQUE option, jamais « value » sur le select : les options sont recréées au dépliage, après
                 la liaison du select, qui retombait sur le libellé d'attente alors que le choix restait en mémoire. -->
            <select data-campagne [class]="liste" (change)="choisirCampagne($event)">
              <option value="" [selected]="!campagneId()">Choisir une campagne…</option>
              @for (c of campagnes(); track c.id) {
                <option [value]="c.id" [selected]="c.id === campagneId()">{{ c.name ?? c.nom ?? c.id }}</option>
              }
            </select>
          </div>
          <div>
            <div [class]="libelleChamp">Indicateur</div>
            <select data-variable [class]="liste" (change)="choisirVariable($event)">
              <option value="" [selected]="!variable()">Choisir un indicateur…</option>
              @for (i of indicateurs(); track i.indicator_code) {
                <option [value]="i.indicator_code" [selected]="i.indicator_code === variable()">{{ libelleIndicateur(i) }}</option>
              }
            </select>
          </div>
        }

        <button type="button" data-calculer [disabled]="!campagneId() || !variable() || calcul()" (click)="calculer()" [class]="boutonCalcul">
          {{ calcul() ? 'Calcul…' : 'Calculer la corrélation' }}
        </button>

        @if (erreur(); as e) {
          <div data-erreur [class]="encartErreur">{{ e }}</div>
        }

        @if (resultat(); as r) {
          <div class="flex flex-col gap-[10px]">
            <div class="flex items-baseline gap-[10px]">
              <span data-r class="font-mono text-[20px] text-primary">{{ r.r.toFixed(2) }}</span>
              <span data-lecture class="text-[11px] text-secondary">{{ lecture() }}</span>
            </div>
            <div data-details class="font-mono text-[10px] leading-[1.6] text-tertiary">
              {{ campagne() }}
              <br />
              {{ couverture() }}
              <br />
              {{ r.indicateur.label }}@if (r.indicateur.calcule_le) { · calculé le {{ date(r.indicateur.calcule_le) }}}
            </div>
            @if (r.n < nMinNuage) {
              <div data-trop-peu [class]="encartAvertissement">
                Trop peu de codes postaux appariés pour une corrélation lisible. L’indicateur n’est peut-être pas renseigné sur le territoire de la campagne.
              </div>
            } @else {
              <div class="rounded-[6px] border-fin border-subtle bg-elevated p-2">
                <mg-nuage [points]="r.points" [libelle]="'Impressions × ' + r.indicateur.label" libelleX="Impressions"
                  [formaterX]="abrege" [infobulle]="infobulle()" />
              </div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class OutilCorrelationComponent {
  private readonly api = inject(AnalysesApi);
  private readonly catalogue = inject(CatalogueIndicateursService);

  protected readonly ouvert = signal(false);
  private listesLues = false;
  protected readonly campagnes = signal<CampagneItem[]>([]);
  protected readonly indicateurs = signal<IndicateurRegistre[]>([]);
  protected readonly chargementListes = signal(false);

  protected readonly campagneId = signal('');
  protected readonly variable = signal('');
  protected readonly calcul = signal(false);
  protected readonly resultat = signal<ResultatCorrelation | null>(null);
  protected readonly erreur = signal<string | null>(null);

  protected readonly lecture = computed(() => {
    const r = this.resultat();
    return r ? lireCoefficient(r.r, r.n) : '';
  });
  protected readonly campagne = computed(() => nomCampagne(this.campagnes(), this.campagneId()));
  protected readonly couverture = computed(() => {
    const r = this.resultat();
    return r ? ligneCouverture(r) : '';
  });
  protected readonly infobulle = computed(() => {
    const libelle = this.resultat()?.indicateur.label ?? '';
    return (p: PointNuage) => lignesInfobulle(p, libelle);
  });

  protected readonly nMinNuage = N_MIN_NUAGE;
  protected readonly libelleIndicateur = libelleIndicateur;
  protected readonly date = dateFr;
  protected readonly abrege = (v: number) => formaterNombreAbrege(v);
  protected readonly entete = ENTETE_ACCORDEON;
  protected readonly corps = CORPS_ACCORDEON;
  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly liste = LISTE_CHAMP;
  protected readonly boutonCalcul = BOUTON_CALCUL;
  protected readonly encartErreur = ENCART_ERREUR;
  protected readonly encartAvertissement = ENCART_AVERTISSEMENT;

  /** Premier dépliage : campagnes et catalogue ENSEMBLE ; un échec laisse le dépliage suivant relire. */
  protected basculer(): void {
    const prochain = !this.ouvert();
    this.ouvert.set(prochain);
    if (!prochain || this.listesLues) return;
    this.listesLues = true;
    this.chargementListes.set(true);
    forkJoin([this.api.campagnes(), this.catalogue.charger()]).subscribe({
      next: ([campagnes, indicateurs]) => {
        this.campagnes.set(Array.isArray(campagnes) ? campagnes : []);
        this.indicateurs.set(indicateurs);
        this.chargementListes.set(false);
      },
      error: () => {
        this.erreur.set('Listes indisponibles.');
        this.listesLues = false;
        this.chargementListes.set(false);
      },
    });
  }

  protected choisirCampagne(e: Event): void {
    this.campagneId.set((e.target as HTMLSelectElement).value);
    this.resultat.set(null);
  }

  protected choisirVariable(e: Event): void {
    this.variable.set((e.target as HTMLSelectElement).value);
    this.resultat.set(null);
  }

  protected calculer(): void {
    const campagne = this.campagneId();
    const variable = this.variable();
    if (!campagne || !variable || this.calcul()) return;
    this.calcul.set(true);
    this.erreur.set(null);
    this.api.correlation(campagne, variable).subscribe({
      next: (r) => {
        this.resultat.set(r);
        this.calcul.set(false);
      },
      error: (e: unknown) => {
        this.erreur.set(messageErreurRequete(e));
        this.resultat.set(null);
        this.calcul.set(false);
      },
    });
  }
}
