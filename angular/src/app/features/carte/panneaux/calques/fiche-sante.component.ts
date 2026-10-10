import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { CiviqueApi, type ReponseSanteCommune, type SanteCommune } from '../../data/civique.api';
import { JETONS_NIVEAUX_SANTE } from '../../logique/palettes-donnees-carte';
import { POLLEN_LEVEL_LABELS } from '../../logique/sante';

/** Les états de la fiche (`FetchState`, `HealthIndicatorCard.tsx:31-36`). */
type EtatFiche =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; data: SanteCommune }
  | { kind: 'empty'; message: string }
  | { kind: 'error'; message: string };

/** Les polluants, dans l'ordre et avec les libellés de `AirSubBlock.tsx:13-19`. */
const POLLUANTS: ReadonlyArray<readonly ['pm10' | 'pm25' | 'no2' | 'o3' | 'so2', string]> = [
  ['no2', 'NO₂'], ['o3', 'O₃'], ['pm10', 'PM10'], ['pm25', 'PM2,5'], ['so2', 'SO₂'],
];
/** Les espèces, dans l'ordre et avec les libellés de `PollenSubBlock.tsx:13-20`. */
const ESPECES: ReadonlyArray<readonly [string, string]> = [
  ['ambroisie', 'Ambroisie'], ['armoise', 'Armoise'], ['aulne', 'Aulne'], ['bouleau', 'Bouleau'], ['graminees', 'Graminées'],
  ['olivier', 'Olivier'],
];

/** `atmoLevelToken` / `pollenLevelToken` (`lib/civic-health/levels.ts:34-44`) : le jeton du niveau, `var()` dans le DOM. */
function jetonAtmo(n: number | null | undefined): string {
  return `var(--${n != null && n >= 1 && n <= 6 ? JETONS_NIVEAUX_SANTE.atmo[n as 1] : JETONS_NIVEAUX_SANTE.atmo[0]})`;
}
function jetonPollen(n: number | null | undefined): string {
  return `var(--${n != null && n >= 0 && n <= 6 ? JETONS_NIVEAUX_SANTE.pollen[n as 0] : JETONS_NIVEAUX_SANTE.pollen[0]})`;
}
const libellePollen = (n: number) => POLLEN_LEVEL_LABELS[n as keyof typeof POLLEN_LEVEL_LABELS];

/** `formatDate` de `HealthIndicatorCard.tsx:38-48`. */
function formaterDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * La fiche air + pollen de la commune de l'IRIS sélectionné — portage de `components/donnees-terrain/HealthIndicatorCard.tsx`
 * (avec `AirSubBlock`, `PollenSubBlock`, `HealthCardSkeleton`), rendue en tête de « Santé environnementale ».
 *
 * Cinq états, textes de React : aucun IRIS (invite), chargement (squelette à deux colonnes), indisponible (message de la
 * route), erreur réseau (« Réessayer » relit en vidant le cache de la commune), fiche. Une commune lue est gardée pour la
 * vie du composant (`cacheRef` de React) : revenir sur elle ne relit rien.
 *
 * Écarts, de couleur seulement : fonds `rgba(247,183,49,…)` du badge « cache » en jeton `--warning` ; squelette FLAT
 * (pulsation, sans dégradé — « flat total », même règle que les autres squelettes Angular). Défauts React listés, NON
 * corrigés (parité) : titres « AIR » / « POLLEN » en capitales (`text-transform`).
 */
@Component({
  selector: 'mg-fiche-sante',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: `
    @keyframes pulse { 50% { opacity: 0.5; } }
    .squelette { background: var(--bg-level-2); animation: pulse 1.5s ease-in-out infinite; border-radius: 4px; }
    @media (prefers-reduced-motion: reduce) { .squelette { animation: none; } }
  `,
  template: `
    @switch (etat().kind) {
      @case ('idle') {
        <div data-fiche-vide class="p-[14px] text-[11px] italic leading-[1.5] text-tertiary">
          Cliquez sur un IRIS pour voir l'air et les pollens du jour.
        </div>
      }
      @case ('loading') {
        <div data-fiche-squelette aria-hidden="true" class="grid grid-cols-2 gap-3 px-[14px] py-3">
          @for (c of [0, 1]; track c) {
            <div class="flex flex-col gap-2">
              <div class="squelette h-[10px] w-[60%]"></div>
              <div class="flex items-center gap-2">
                <div class="squelette size-5 !rounded-[10px]"></div>
                <div class="squelette h-[14px] w-1/2"></div>
              </div>
              <div class="squelette h-1.5 w-full"></div>
              <div class="squelette h-1.5 w-full"></div>
              <div class="squelette h-1.5 w-full"></div>
            </div>
          }
        </div>
      }
      @case ('error') {
        <div data-fiche-erreur class="flex flex-col gap-2 p-[14px] text-[11px] text-danger">
          <span>{{ message() }}</span>
          <button type="button" (click)="reessayer()"
            class="cursor-pointer self-start rounded-[6px] border-fin border-teal bg-transparent px-3 py-1.5 text-[11px] font-medium text-teal">Réessayer</button>
        </div>
      }
      @case ('empty') {
        <div data-fiche-indisponible class="p-[14px] text-[11px] leading-[1.5] text-tertiary">{{ message() }}</div>
      }
      @case ('success') {
        @if (donnee(); as d) {
          <div data-fiche-sante class="flex flex-col gap-3 px-[14px] py-3">
            <div class="flex items-center justify-between gap-2">
              <span data-commune class="text-[12px] font-medium text-primary">{{ nomCommune() || d.commune }}</span>
              @if (d.stale) {
                <span data-cache title="Donnée de fallback (cache > 24h)"
                  class="rounded-[3px] border-fin border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-1.5 py-0.5 font-mono text-[9px] text-warning">cache</span>
              }
            </div>

            <div class="grid gap-[14px]" [class.grid-cols-2]="!!d.air && !!d.pollen">
              @if (d.air; as air) {
                <div data-bloc-air class="flex flex-col gap-[10px]">
                  <div class="text-[10px] uppercase tracking-[0.06em] text-tertiary">Air</div>
                  <div class="flex items-center gap-[10px]">
                    <span data-pastille [attr.aria-label]="'Indice ATMO ' + air.indice + ' sur 6'"
                      class="size-[18px] shrink-0 rounded-full border border-default" [style.background]="vue().couleurAir"></span>
                    <div class="flex flex-col leading-[1.2]">
                      <span class="text-[13px] font-medium capitalize text-primary">{{ air.qualificatif }}</span>
                      <span class="font-mono text-[10px] text-tertiary">{{ air.indice }} / 6</span>
                    </div>
                  </div>
                  <div class="mt-0.5 flex flex-col gap-1">
                    @for (p of polluants(); track p.cle) {
                      <div data-polluant [title]="p.titre" class="flex items-center gap-1.5">
                        <span class="w-8 font-mono text-[9px] text-tertiary">{{ p.libelle }}</span>
                        <div class="relative h-1 flex-1 overflow-hidden rounded-[2px] bg-[var(--border-subtle)]">
                          @if (p.niveau != null) {
                            <div class="h-full" [style.width.%]="(p.niveau / 6) * 100" [style.background]="p.couleur"></div>
                          }
                        </div>
                        <span class="w-[14px] text-right font-mono text-[9px]" [class.text-tertiary]="p.niveau == null"
                          [class.text-secondary]="p.niveau != null">{{ p.niveau ?? '—' }}</span>
                      </div>
                    }
                  </div>
                </div>
              }
              @if (d.pollen; as pollen) {
                <div data-bloc-pollen class="flex flex-col gap-[10px]">
                  <div class="text-[10px] uppercase tracking-[0.06em] text-tertiary">Pollen</div>
                  <div class="flex items-center gap-[10px]">
                    <span data-pastille [attr.aria-label]="'Indice pollen ' + pollen.indice_global + ' sur 6'"
                      class="size-[18px] shrink-0 rounded-full border border-default" [style.background]="vue().couleurPollen"></span>
                    <div class="flex flex-col leading-[1.2]">
                      <span class="text-[13px] font-medium capitalize text-primary">{{ vue().libellePollen }}</span>
                      <span class="font-mono text-[10px] text-tertiary">{{ pollen.indice_global }} / 6</span>
                    </div>
                  </div>
                  <div class="mt-0.5 flex flex-col gap-1">
                    @for (e of especes(); track e.cle) {
                      <div data-espece [title]="e.titre" class="flex items-center gap-1.5" [style.opacity]="e.niveau === 0 ? 0.45 : 1">
                        <span class="w-16 text-[10px] text-tertiary">{{ e.libelle }}</span>
                        <div class="h-1 flex-1 overflow-hidden rounded-[2px] bg-[var(--border-subtle)]">
                          <div class="h-full" [style.width.%]="(e.niveau / 6) * 100" [style.background]="e.couleur"></div>
                        </div>
                        <span class="w-[14px] text-right font-mono text-[9px] text-secondary">{{ e.niveau }}</span>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>

            @if (previsions(); as pv) {
              <div class="mt-0.5 flex flex-col gap-1.5">
                <button type="button" data-previsions (click)="previsionsOuvertes.set(!previsionsOuvertes())"
                  class="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] text-secondary">{{ previsionsOuvertes() ? '▾ Masquer prévisions' : '▸ Voir prévisions' }}</button>
                @if (previsionsOuvertes()) {
                  <div class="flex flex-col gap-1.5 border-l border-l-[var(--border-subtle)] pl-3 font-mono text-[10px] text-secondary">
                    @if (pv.airJ1; as a) {
                      <div data-j1 class="flex items-center gap-2">
                        <span class="w-7 text-tertiary">J+1</span>
                        <span class="inline-flex items-center gap-1">Air
                          <span class="inline-block size-2 rounded-full" [style.background]="a.couleur"></span>
                          <span class="capitalize">{{ a.libelle }}</span></span>
                        @if (pv.pollenJ1; as p) {
                          <span class="inline-flex items-center gap-1">· Pollen
                            <span class="inline-block size-2 rounded-full" [style.background]="p.couleur"></span>
                            <span class="capitalize">{{ p.libelle }}</span></span>
                        }
                      </div>
                    }
                    @if (pv.pollenJ2; as p) {
                      <div data-j2 class="flex items-center gap-2">
                        <span class="w-7 text-tertiary">J+2</span>
                        <span class="inline-flex items-center gap-1">Pollen
                          <span class="inline-block size-2 rounded-full" [style.background]="p.couleur"></span>
                          <span class="capitalize">{{ p.libelle }}</span></span>
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <div class="mt-1 flex flex-col gap-1 border-t-fin border-subtle pt-2 font-mono text-[9px] italic leading-[1.4] text-tertiary">
              <span data-source>Source : {{ d.source }}@if (vue().miseAJour; as date) { — Mis à jour le {{ date }}}</span>
              <a [href]="lienAtmo()" target="_blank" rel="noopener noreferrer" class="text-teal no-underline">↗ Voir sur map.atmo-france.org</a>
            </div>
          </div>
        }
      }
    }
  `,
})
export class FicheSanteComponent {
  /** Code INSEE de la commune de l'IRIS sélectionné. */
  readonly codeCommune = input<string | null>(null);
  readonly nomCommune = input<string | null>(null);

  private readonly api = inject(CiviqueApi);
  protected readonly etat = signal<EtatFiche>({ kind: 'idle' });
  protected readonly previsionsOuvertes = signal(false);
  private readonly cache = new Map<string, SanteCommune>();
  private lecture: Subscription | null = null;


  protected readonly donnee = computed(() => { const e = this.etat(); return e.kind === 'success' ? e.data : null; });
  protected readonly message = computed(() => { const e = this.etat(); return e.kind === 'empty' || e.kind === 'error' ? e.message : ''; });
  /** Pastilles, libellé global du pollen et date de mise à jour : calculés, jamais une méthode dans le gabarit. */
  protected readonly vue = computed(() => {
    const d = this.donnee();
    return {
      couleurAir: jetonAtmo(d?.air?.indice),
      couleurPollen: jetonPollen(d?.pollen?.indice_global),
      libellePollen: d?.pollen ? libellePollen(d.pollen.indice_global) : '',
      miseAJour: d?.air?.date ? formaterDate(d.air.date) : null,
    };
  });
  protected readonly lienAtmo = computed(() => `https://map.atmo-france.org/?commune=${encodeURIComponent(this.donnee()?.code_insee ?? '')}`);
  protected readonly polluants = computed(() => {
    const air = this.donnee()?.air;
    if (!air) return [];
    return POLLUANTS.map(([cle, libelle]) => {
      const niveau = air.sous_indices[cle] ?? null;
      return { cle, libelle, niveau, couleur: jetonAtmo(niveau), titre: niveau == null ? `${libelle} : indisponible` : `${libelle} : niveau ${niveau}/6` };
    });
  });
  protected readonly especes = computed(() => {
    const pollen = this.donnee()?.pollen;
    if (!pollen) return [];
    return ESPECES.map(([cle, libelle]) => {
      const niveau = pollen.especes[cle] ?? 0;
      return { cle, libelle, niveau, couleur: jetonPollen(niveau), titre: `${libelle} : ${libellePollen(niveau)}` };
    });
  });
  /** `hasForecast` (`HealthIndicatorCard.tsx:200-203`) et les trois prévisions possibles. */
  protected readonly previsions = computed(() => {
    const d = this.donnee();
    if (!d || !(d.air?.previsionJ1 || d.pollen?.previsionJ1 || d.pollen?.previsionJ2)) return null;
    const pJ1 = d.pollen?.previsionJ1;
    const pJ2 = d.pollen?.previsionJ2;
    return {
      airJ1: d.air?.previsionJ1 ? { couleur: jetonAtmo(d.air.previsionJ1.indice), libelle: d.air.previsionJ1.qualificatif } : null,
      pollenJ1: pJ1 ? { couleur: jetonPollen(pJ1.indice), libelle: libellePollen(pJ1.indice) } : null,
      pollenJ2: pJ2 ? { couleur: jetonPollen(pJ2.indice), libelle: libellePollen(pJ2.indice) } : null,
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
    effect(() => {
      const code = this.codeCommune();
      untracked(() => this.charger(code, 'Données indisponibles pour cette zone.'));
    });
  }

  /** « Réessayer » : la commune est relue, cache vidé (`HealthIndicatorCard.tsx:145-160`). */
  protected reessayer(): void {
    const code = this.codeCommune();
    if (!code) return;
    this.cache.delete(code);
    this.charger(code, 'Données indisponibles.');
  }

  private charger(code: string | null, messageVide: string): void {
    this.lecture?.unsubscribe();
    if (!code) {
      this.etat.set({ kind: 'idle' });
      return;
    }
    const enCache = this.cache.get(code);
    if (enCache) {
      this.etat.set({ kind: 'success', data: enCache });
      return;
    }
    this.etat.set({ kind: 'loading' });
    const vide = (r: ReponseSanteCommune | null) => this.etat.set({ kind: 'empty', message: r?.message ?? messageVide });
    this.lecture = this.api.santeCommune(code).subscribe({
      next: (r) => {
        if (!r?.data) { vide(r); return; }
        this.cache.set(code, r.data);
        this.etat.set({ kind: 'success', data: r.data });
      },
      // React lisait le corps JSON même en erreur HTTP (400 code invalide → son message) ; seul un corps illisible ou un
      // échec réseau donne « Échec de chargement. Réessayer ? ».
      error: (e: unknown) => {
        const corps = e instanceof HttpErrorResponse ? e.error : null;
        if (corps && typeof corps === 'object') vide(corps as ReponseSanteCommune);
        else this.etat.set({ kind: 'error', message: 'Échec de chargement. Réessayer ?' });
      },
    });
  }
}
