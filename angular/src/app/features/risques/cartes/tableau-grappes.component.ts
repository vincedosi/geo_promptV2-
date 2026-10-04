import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import type { Bbox } from '../../../carte/bbox';
import { formaterNombre } from '../../../core/format/nombre';
import { messageErreurApi } from '../../../core/http/erreurs';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { type Grappe, JeuxZonesApi } from '../data/jeux-zones.api';

/** Une ligne prête à afficher : aucune méthode appelée dans le gabarit. */
interface LigneGrappe {
  id: string;
  nom: string;
  jeton: string;
  nSites: number;
  exposes: string;
  nCp: string;
  nCpRetenus: string;
  part: string;
  codes: string[];
  bbox: Bbox | null;
  titre: string;
}

/**
 * Le tableau des BASSINS, sous les deux cartes de l'étape ④ — portage de `TableauGrappes.tsx` (lot 3, T15).
 *
 * Une carte montre où ; elle ne classe pas. Le taux d'achat PAR BASSIN, que ni la choroplèthe ni le bandeau ne
 * disent, est ici.
 *
 * - ⚠ AUCUNE REQUÊTE AU SURVOL : les codes postaux voyagent AVEC le bassin (sql/230, 580 bassins = 186 ko). Le
 *   survol d'une ligne met en évidence ses codes postaux sur la carte de droite, et ne DÉPLACE rien ; le
 *   recadrage est un geste décidé, le clic.
 * - Les bassins sont lus UNE fois par jeu : le composant reste monté hors de ④ (masqué), donc un aller-retour
 *   d'étapes ne les redemande pas (React démontait le tableau et relisait à chaque retour). Pas avant d'être
 *   visible (`actif`) : ouvrir l'écran à l'étape ① n'a pas à les demander.
 */
@Component({
  selector: 'mg-tableau-grappes',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'shrink-0' },
  template: `
    @switch (etat()) {
      @case ('chargement') {
        <div class="flex items-center border-t border-subtle bg-[var(--bg-level-1)] px-3.5 py-[9px] text-[11px] text-secondary">
          <mg-icone nom="chargement" [taille]="12" class="animate-spin" /><span class="ml-1.5">Chargement des bassins…</span>
        </div>
      }
      @case ('echec') {
        <div class="flex items-center border-t border-subtle bg-[var(--bg-level-1)] px-3.5 py-[9px] text-[11px] text-danger">{{ message() }}</div>
      }
      @default {
        @if (lignes().length === 0) {
          <div class="flex items-center border-t border-subtle bg-[var(--bg-level-1)] px-3.5 py-[9px] text-[11px] text-secondary">
            <span>Aucun bassin — le profil ne retient aucun site.</span>
          </div>
        } @else {
          <div class="max-h-[190px] overflow-auto border-t border-subtle bg-[var(--bg-level-1)]">
            <table class="w-full border-collapse text-[11px] text-secondary">
              <thead>
                <tr class="bg-[var(--bg-level-2)]">
                  <th class="px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-primary">Bassin</th>
                  <th class="px-2.5 py-1.5 text-right font-medium whitespace-nowrap text-primary">Sites</th>
                  <th class="px-2.5 py-1.5 text-right font-medium whitespace-nowrap text-primary">Exposés</th>
                  <th class="px-2.5 py-1.5 text-right font-medium whitespace-nowrap text-primary">Codes postaux</th>
                  <th class="px-2.5 py-1.5 text-right font-medium whitespace-nowrap text-primary">Achetés</th>
                  <th class="px-2.5 py-1.5 text-right font-medium whitespace-nowrap text-primary"
                      title="Codes postaux achetés rapportés à ceux que le bassin touche">Part achetée</th>
                </tr>
              </thead>
              <tbody (mouseleave)="survol.emit(null)">
                @for (g of lignes(); track g.id) {
                  <tr (mouseenter)="survol.emit(g.codes)" (click)="g.bbox && recadrer.emit(g.bbox)" [attr.title]="g.titre"
                      class="border-t-fin border-subtle" [class.cursor-pointer]="!!g.bbox" [class.cursor-default]="!g.bbox">
                    <td class="px-2.5 py-[5px] text-left whitespace-nowrap">
                      <span class="mr-[7px] inline-block h-[7px] w-[7px] rounded-full" [style.background]="g.jeton"></span>{{ g.nom }}
                    </td>
                    <td class="px-2.5 py-[5px] text-right font-mono whitespace-nowrap">{{ g.nSites }}</td>
                    <td class="px-2.5 py-[5px] text-right font-mono whitespace-nowrap">{{ g.exposes }}</td>
                    <td class="px-2.5 py-[5px] text-right font-mono whitespace-nowrap">{{ g.nCp }}</td>
                    <td class="px-2.5 py-[5px] text-right font-mono whitespace-nowrap">{{ g.nCpRetenus }}</td>
                    <!-- « — » et non « 0 % » : un bassin sans code postal touché n'a pas une part nulle, il n'en a pas. -->
                    <td class="px-2.5 py-[5px] text-right font-mono whitespace-nowrap">{{ g.part }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    }
  `,
})
export class TableauGrappesComponent {
  readonly jeuId = input<string | null>(null);
  /** Vrai quand le tableau est à l'écran (étape ④ dédoublée). */
  readonly actif = input(false);
  /** Recadrer les DEUX cartes sur un bassin. */
  readonly recadrer = output<Bbox>();
  /** Les codes postaux du bassin survolé, ou `null` au départ du curseur. */
  readonly survol = output<string[] | null>();

  private readonly api = inject(JeuxZonesApi);
  protected readonly etat = signal<'chargement' | 'echec' | 'pret'>('chargement');
  protected readonly message = signal<string | null>(null);
  private readonly grappes = signal<Grappe[]>([]);
  protected readonly lignes = computed<LigneGrappe[]>(() => this.grappes().map((g) => ({
    id: g.id,
    nom: g.nom,
    jeton: g.niveau_dominant === 'haut' ? 'var(--niveau-haut)' : 'var(--niveau-bas)',
    nSites: g.n_sites,
    exposes: formaterNombre(Number(g.pop_exposee ?? 0)),
    nCp: formaterNombre(g.n_cp),
    nCpRetenus: formaterNombre(g.n_cp_retenus),
    part: g.n_cp > 0 ? `${Math.round((g.n_cp_retenus / g.n_cp) * 100)} %` : '—',
    codes: g.codes_postaux,
    bbox: g.bbox,
    titre: g.bbox ? 'Recadrer les deux cartes sur ce bassin' : 'Ce bassin n’a pas d’enveloppe : rien à recadrer',
  })));

  /** Le jeu dont les bassins sont chargés (ou en cours) : un seul appel par jeu. */
  private jeuLu: string | null = null;
  private lecture: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
    effect(() => {
      const jeu = this.jeuId();
      if (!jeu || !this.actif() || jeu === this.jeuLu) return;
      untracked(() => this.lire(jeu));
    });
  }

  private lire(jeu: string): void {
    this.lecture?.unsubscribe();
    this.jeuLu = jeu;
    this.etat.set('chargement');
    this.lecture = this.api.grappes(jeu).subscribe({
      next: (d) => {
        this.grappes.set(d.grappes ?? []);
        this.etat.set('pret');
      },
      error: (e: unknown) => {
        // Un échec n'est pas mémorisé : la prochaine visite de ④ retente.
        this.jeuLu = null;
        this.message.set(messageErreurApi(e));
        this.etat.set('echec');
      },
    });
  }
}
