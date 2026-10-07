import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../core/format/nombre';
import { type IrisDbColumn, IRIS_DB_COLUMNS } from '../logique/iris-colonnes';
import { IrisService } from './iris.service';

/** Les groupes du panneau, dans l'ordre de React (`IrisDetailPanel.tsx:40`) — « Métadonnées » n'y est pas. */
const ORDRE_GROUPES = ['Population', 'Âge', 'Revenus', 'Emploi', 'Diplômes', 'CSP', 'Logement', 'Familles', 'Mobilité'] as const;
/** Largeurs des trois lignes de `SkeletonText` (`components/ui/GeoSkeleton.tsx:29`). */
const LARGEURS_SQUELETTE = ['100%', '85%', '60%'];

/** Le libellé dit-il « % » ? (`IrisDetailPanel.tsx:53`). */
function libelleEnPourcent(c: IrisDbColumn): boolean {
  const l = c.label.toLowerCase();
  return l.includes('(%)') || l.includes('%');
}

/**
 * `fmtValue` de `IrisDetailPanel.tsx:44-57`, mot pour mot : « — » pour l'absent, entier à la française, « 7.4 % »,
 * « 41 235 € », « 0.41 ». Le point décimal des pourcentages et des flottants est celui de React (`toFixed`), gardé
 * pour la parité des chiffres.
 */
export function formaterValeurIris(c: IrisDbColumn, brut: unknown): string {
  if (brut === null || brut === undefined) return '—';
  const v = Number(brut);
  if (isNaN(v)) return String(brut);
  if (c.type === 'boolean') return v ? 'Oui' : 'Non';
  if (c.type === 'integer') return formaterNombre(v);
  const l = c.label.toLowerCase();
  if (l.includes('(%)') || l.includes('%')) return `${v.toFixed(1)} %`;
  if (l.includes('(€)') || l.includes('€')) return `${formaterNombre(Math.round(v))} €`;
  return v.toFixed(2);
}

/** Une ligne du panneau : son libellé, sa valeur mise en forme, et la barre d'une colonne en %. */
interface Ligne {
  readonly nom: string;
  readonly libelle: string;
  readonly valeur: string;
  readonly renseignee: boolean;
  /** Largeur de la barre (0-100) pour une colonne en % renseignée ; `null` sinon (ligne simple). */
  readonly barre: number | null;
  readonly pourcent: boolean;
}

/**
 * Le panneau de détail d'un IRIS cliqué — portage de `app/map/_components/IrisDetailPanel.tsx` et de son cadre de
 * `page.tsx:1436-1450` : `absolute` à droite de la carte, 320 px, au-dessus d'elle.
 *
 * L'ombre portée `-4px 0 24px rgba(0,0,0,0.5)` de React est GARDÉE, pour la parité (décision du brief T7) : c'est un
 * écart au design system (« flat total ») hérité de React, listé au rapport.
 *
 * Écart voulu : un détail qui ne se lit pas (404, réseau) laisse le panneau ouvert sur « Détail indisponible pour cet
 * IRIS. » — React le refermait sans un mot (`useIrisDetail.ts:72`), un clic sans effet visible.
 */
@Component({
  selector: 'mg-detail-iris',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  styles: `
    .squelette {
      background: linear-gradient(90deg, var(--bg-level-2) 25%, var(--bg-level-3) 50%, var(--bg-level-2) 75%);
      background-size: 200% 100%;
      animation: miroitement 1.5s linear infinite;
    }
    @keyframes miroitement {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .squelette { animation: none; }
    }
    .fermer:hover { color: var(--text-primary); border-color: var(--text-tertiary); }
  `,
  template: `
    @if (i.codeSelectionne(); as code) {
      <div data-detail-iris class="absolute inset-y-0 right-0 z-50 w-[320px] shadow-[-4px_0_24px_rgb(0_0_0/0.5)]">
        <div class="absolute inset-0 z-20 flex flex-col overflow-hidden bg-[var(--bg-level-2)]">
          <div class="shrink-0 border-b-fin border-subtle bg-[var(--bg-surface)] px-[14px] pb-[10px] pt-3">
            <div class="flex items-start justify-between">
              <div class="min-w-0 flex-1">
                <div class="mb-1 text-[9px] uppercase tracking-[0.1em] text-teal">IRIS</div>
                <div data-nom class="break-words font-mono text-[13px] font-semibold leading-[1.3] text-primary">{{ nom() ?? code }}</div>
                <div data-codes class="mt-[3px] font-mono text-[10px] text-tertiary">{{ i.detail()?.code_iris ?? code }}@if (i.detail()?.code_commune; as c) {<span class="ml-2">Commune {{ c }}</span>}@if (i.detail()?.code_dept; as d) {<span class="ml-2">Dép. {{ d }}</span>}</div>
                @if (i.detail()?.is_true_iris === false) {
                  <div class="mt-1.5 text-[8px] uppercase tracking-[0.05em] text-warning">Zone communale (non IRIS)</div>
                }
              </div>
              <button
                type="button"
                data-fermer
                aria-label="Fermer le détail IRIS"
                (click)="i.fermerDetail()"
                class="fermer ml-2 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[2px] border-fin border-subtle bg-transparent font-mono text-[12px] text-tertiary transition-[color,border-color] duration-150 ease-[var(--ease-hover)]"
              >✕</button>
            </div>
          </div>

          @if (i.chargementDetail()) {
            <div class="flex-1 px-[14px] pb-6 pt-[14px]" aria-hidden="true">
              @for (b of blocs; track b) {
                <div data-squelette-bloc class="mb-5">
                  <div class="squelette mb-3 h-[10px] w-20 rounded-[3px]"></div>
                  <div class="flex flex-col gap-2">
                    @for (l of largeurs; track $index) {
                      <div class="squelette h-3 rounded-[3px]" [style.width]="l"></div>
                    }
                  </div>
                </div>
              }
            </div>
          } @else if (i.erreurDetail()) {
            <p data-erreur class="m-0 flex-1 px-[14px] pt-[14px] text-[12px] text-tertiary">Détail indisponible pour cet IRIS.</p>
          } @else {
            <div class="flex-1 overflow-y-auto px-[14px] pb-6 pt-[14px]">
              @for (s of sections(); track s.titre) {
                <div [attr.data-section]="s.titre" class="mb-5">
                  <div class="mb-[10px] border-b-fin border-subtle pb-[5px] text-[9px] uppercase tracking-[0.1em] text-teal">{{ s.titre }}</div>
                  @for (l of s.lignes; track l.nom) {
                    @if (l.pourcent) {
                      <div [attr.data-colonne]="l.nom" class="mb-[10px]">
                        <div class="mb-[3px] flex items-center justify-between">
                          <span class="text-[9px] uppercase tracking-[0.06em] text-tertiary">{{ l.libelle }}</span>
                          <span class="font-mono text-[11px]" [class.text-primary]="l.barre !== null" [class.text-tertiary]="l.barre === null">{{ l.valeur }}</span>
                        </div>
                        @if (l.barre !== null) {
                          <div class="h-[3px] overflow-hidden rounded-[2px] bg-[var(--border-subtle)]">
                            <div
                              data-barre
                              class="h-full rounded-[2px] transition-[width] duration-[400ms] ease-linear"
                              [style.width.%]="l.barre"
                              [style.background]="l.barre > 30 && l.barre <= 60 ? 'var(--success)' : 'var(--brand-teal)'"
                            ></div>
                          </div>
                        }
                      </div>
                    } @else {
                      <div [attr.data-colonne]="l.nom" class="mb-2 flex items-baseline justify-between">
                        <span class="flex-1 pr-2 text-[9px] uppercase tracking-[0.06em] text-tertiary">{{ l.libelle }}</span>
                        <span class="shrink-0 font-mono text-[12px]" [class.text-primary]="l.renseignee" [class.text-tertiary]="!l.renseignee">{{ l.valeur }}</span>
                      </div>
                    }
                  }
                </div>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class DetailIrisComponent {
  protected readonly i = inject(IrisService);
  protected readonly blocs = [0, 1, 2, 3];
  protected readonly largeurs = LARGEURS_SQUELETTE;

  protected readonly nom = computed(() => this.i.detail()?.nom_iris ?? null);

  /** Les sections renseignées, dans l'ordre de React ; une section sans AUCUNE valeur n'est pas rendue. */
  protected readonly sections = computed(() => {
    const d = this.i.detail();
    if (!d) return [];
    return ORDRE_GROUPES.map((titre) => {
      const colonnes = IRIS_DB_COLUMNS.filter((c) => c.group === titre && c.name !== 'is_true_iris');
      return {
        titre,
        presente: colonnes.some((c) => d[c.name] !== null && d[c.name] !== undefined),
        lignes: colonnes.map<Ligne>((c) => {
          const brut = d[c.name];
          const renseignee = brut !== null && brut !== undefined;
          const pourcent = c.type === 'float' && libelleEnPourcent(c);
          return {
            nom: c.name, libelle: c.label, valeur: formaterValeurIris(c, brut), renseignee, pourcent,
            barre: pourcent && renseignee ? Math.min(100, Math.max(0, Number(brut))) : null,
          };
        }),
      };
    }).filter((s) => s.presente);
  });
}
