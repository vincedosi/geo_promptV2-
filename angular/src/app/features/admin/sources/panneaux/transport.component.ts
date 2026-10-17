import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { SourcesAdminApi } from '../data/sources-admin.api';
import type { StatsTransport } from '../data/panneaux.types';

type Niveau = 'bon' | 'moyen' | 'faible';

/** `badgeColor` de React : ≥ 90 % vert, ≥ 70 % avertissement, sinon rouge. */
function niveau(pct: number): Niveau {
  return pct >= 90 ? 'bon' : pct >= 70 ? 'moyen' : 'faible';
}

/**
 * Onglet « Transport & Flux » des Sources — portage de `TransportPanel.tsx` et de son état dans
 * `page.tsx:105-170` (lot 6, T19) : arrêts de transport, flux routier (TMJA), scoring des panneaux par
 * ville en tableau repliable.
 *
 * Lecture : `transport-stats` à la CRÉATION — la page ne crée ce panneau qu'à la première visite de
 * l'onglet et le GARDE ensuite (masqué), comme React gardait `transportStats` et `showTransportTable`
 * dans le parent : aucune relecture au retour, le tableau garde son état. « Actualiser » relit une fois ;
 * replier / déplier le tableau ne lit rien. La route séquence trois `COUNT` exacts (règle d'I/O).
 *
 * Écarts à React :
 * - échec (HTTP ≠ 2xx) : traité comme `success: false` → « Aucune donnée. » + « Charger » (React
 *   journalisait l'erreur en console et rendait la même chose).
 * - couleurs (C9) : `#22c55e` → `--success` ; `#f97316` (orange, sans jeton) → mélange à parts égales de
 *   `--warning` et `--danger` ; `rgba(…,0.10|0.25)` → `color-mix` à 10 % / 25 %. Les pastilles de
 *   couverture (`${badgeColor}1a` / `44`, CSS invalide chez React, donc sans fond ni bord) prennent le fond
 *   à 10 % et le bord à 27 % que React voulait écrire, comme T18.
 * - lignes du tableau au survol : `:hover` CSS au lieu de deux écouteurs ; rayure `rgba(255,255,255,0.01)`
 *   (invisible) omise.
 */
@Component({
  selector: 'mg-sources-transport',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transport.component.html',
  styleUrls: ['./panneaux-commun.css', './transport.component.css'],
})
export class TransportComponent {
  private readonly api = inject(SourcesAdminApi);
  private lecture: Subscription | null = null;

  protected readonly stats = signal<StatsTransport | null>(null);
  protected readonly chargement = signal(false);
  protected readonly tableau = signal(false);

  /** Couvertures en % (`pctTransport` / `pctFlux` de React), arrondies. */
  protected readonly couvertures = computed(() => {
    const s = this.stats();
    if (!s) return null;
    const t = Math.round((s.panneaux.avec_transport / s.panneaux.total) * 100);
    const f = Math.round((s.panneaux.avec_flux / s.panneaux.total) * 100);
    const ratio = (n: number) => `(${formaterNombre(n)} / ${formaterNombre(s.panneaux.total)})`;
    return {
      transport: { pct: t || 0, niveau: niveau(t), ratio: ratio(s.panneaux.avec_transport) },
      flux: { pct: f || 0, niveau: niveau(f), ratio: ratio(s.panneaux.avec_flux) },
      // « masqué si scoring non calculé » (React l. 140).
      basculable: s.panneaux.total > 0 && (t > 0 || f > 0),
    };
  });

  protected readonly arrets = computed(() => {
    const s = this.stats();
    return s ? Object.entries(s.arrets.by_source).map(([src, nb]) => ({ src, nb: formaterNombre(nb) })) : [];
  });

  protected readonly flux = computed(() => {
    const s = this.stats();
    return s
      ? Object.entries(s.flux.by_source).map(([src, nb]) => ({
        libelle: src === 'tmja_rrn_national' ? 'CEREMA (réel): ' : 'OSM proxy: ', nb: formaterNombre(nb),
      }))
      : [];
  });

  protected readonly totaux = computed(() => {
    const s = this.stats();
    return s ? { arrets: formaterNombre(s.arrets.total), flux: formaterNombre(s.flux.total) } : null;
  });

  protected readonly villes = computed(() => (this.stats()?.villes ?? []).map((v) => {
    const pT = Math.round((v.avec_transport / v.nb_panneaux) * 100);
    const pF = Math.round((v.avec_flux / v.nb_panneaux) * 100);
    return { ...v, pT, pF, nT: niveau(pT), nF: niveau(pF) };
  }));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
    this.lire();
  }

  /** `fetchTransportStats` (`page.tsx:156-165`) : un échec garde les statistiques précédentes, comme React. */
  protected lire(): void {
    this.lecture?.unsubscribe();
    this.chargement.set(true);
    this.lecture = this.api.transportStats().subscribe({
      next: (r) => {
        if (r?.success) this.stats.set(r);
        this.chargement.set(false);
      },
      error: () => this.chargement.set(false),
    });
  }
}
