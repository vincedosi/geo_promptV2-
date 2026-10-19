import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { formaterNombre } from '../../../core/format/nombre';
import { IconeComponent } from '../../../ui/icone/icone.component';
import type { StatsRadio } from '../radio/data/radio-admin.api';
import type { StatsSources, StatsZones } from './data/sources-admin.api';
import type { OngletSources, TeinteSources } from './logique/constantes';

interface Tuile {
  onglet: OngletSources;
  libelle: string;
  valeur: string;
  sous: string;
  teinte: TeinteSources;
}

/**
 * Tuiles de la vue « Toutes » (`app/admin/sources/page.tsx:361-384`, plus `CustomZonesStatsCard`) :
 * une par domaine, un clic ouvre son onglet. Rendues seulement quand les statistiques sont là, comme
 * React (`activeTab === 'all' && sourcesStats`).
 *
 * Écarts à React :
 * - tuile OOH : `ooh.total` et « panneaux actifs » (amendement A6) — React affichait
 *   « undefined villes · 0 régies », la RPC ne rendant plus que `total` depuis sql/082.
 * - zones perso : lues UNE fois par l'écran (cache, règle d'I/O), pas à chaque retour sur « Toutes »
 *   comme le hook de React monté avec la tuile.
 * - teintes (C9) : `#06b6d4` (IRIS) → `--info`, `#22c55e` (Transport) → `--success`.
 *
 * Gardés par parité : sous-titre Radio en nombres BRUTS (`FM 11602`, React n'y formate pas), carreaux
 * en `toFixed(2) + 'M'` (C17), rayon 2 px, animations d'entrée.
 */
@Component({
  selector: 'mg-tuiles-sources',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grille">
      @for (t of tuiles(); track t.onglet; let i = $index) {
        <button type="button" class="tuile" [attr.data-tuile]="t.onglet" [attr.data-teinte]="t.teinte"
          [style.animation-delay.s]="0.05 * i" (click)="choisir.emit(t.onglet)">
          <div class="libelle" data-libelle>{{ t.libelle }}</div>
          <div class="valeur" data-valeur>{{ t.valeur }}</div>
          <div class="sous" data-sous>{{ t.sous }}</div>
        </button>
      }
      <button type="button" class="tuile zones" data-tuile="custom_zones" data-teinte="teal" (click)="choisir.emit('custom_zones')">
        <div class="tete">
          <div class="pastille"><mg-icone nom="epingle-carte" [taille]="10" /></div>
          <span class="libelle sans-marge" data-libelle>Zones perso</span>
        </div>
        <div class="valeur" data-valeur>{{ zones().valeur }}</div>
        <div class="sous" data-sous>{{ zones().sous }}</div>
      </button>
    </div>
  `,
  styles: [`
    :host { display: block; }
    @keyframes srcFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes srcCountUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .grille { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 20px; }
    .tuile {
      background: var(--bg-surface); border: 0.5px solid var(--border-subtle); border-radius: 2px; padding: 14px 16px;
      cursor: pointer; text-align: left; transition: all 0.2s ease; animation: srcFadeIn 0.4s ease-out both;
      font-family: var(--font-sans);
    }
    .tuile.zones { animation: none; transition: border-color 0.2s ease; }
    .tuile:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 1px; }
    .tuile[data-teinte='teal'] { --teinte: var(--brand-teal); }
    .tuile[data-teinte='succes'] { --teinte: var(--success); }
    .tuile[data-teinte='avert'] { --teinte: var(--warning); }
    .tuile[data-teinte='info'] { --teinte: var(--info); }
    .tuile:hover { border-color: var(--teinte); }
    .libelle { font-size: 9px; font-weight: 500; color: var(--text-secondary); margin-bottom: 8px; }
    .libelle.sans-marge { margin-bottom: 0; }
    .valeur {
      font-family: var(--font-mono); font-size: 22px; font-weight: 700; color: var(--teinte); line-height: 1; margin-bottom: 4px;
      animation: srcCountUp 0.5s ease-out;
    }
    .zones .valeur { animation: none; }
    .sous { font-size: 10px; color: var(--text-tertiary); }
    .tete { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .pastille {
      width: 16px; height: 16px; border-radius: 3px; background: var(--brand-teal-10); border: 0.5px solid var(--brand-teal-30);
      display: flex; align-items: center; justify-content: center; color: var(--teal-texte);
    }
    @media (prefers-reduced-motion: reduce) { .tuile, .valeur { animation: none; } }
  `],
})
export class TuilesSourcesComponent {
  readonly stats = input.required<StatsSources>();
  readonly radio = input<StatsRadio | null>(null);
  readonly statsZones = input<StatsZones | null>(null);
  readonly zonesChargement = input(false);
  readonly choisir = output<OngletSources>();

  protected readonly tuiles = computed<Tuile[]>(() => {
    const s = this.stats();
    const r = this.radio();
    return [
      { onglet: 'panneaux', libelle: 'Panneaux OOH', valeur: formaterNombre(s.ooh.total), sous: 'panneaux actifs', teinte: 'avert' },
      { onglet: 'poi', libelle: 'POI', valeur: formaterNombre(s.poi.total), sous: 'lycées, CIRFA, autres', teinte: 'teal' },
      { onglet: 'carreaux', libelle: 'Carreaux', valeur: (s.carreaux.total / 1_000_000).toFixed(2) + 'M', sous: 'Filosofi 200m', teinte: 'succes' },
      { onglet: 'iris', libelle: 'IRIS', valeur: formaterNombre(s.iris.total), sous: `${formaterNombre(s.iris.enrichis)} enrichis`, teinte: 'info' },
      {
        onglet: 'transport', libelle: 'Transport & Flux', valeur: formaterNombre(s.transport.total + s.flux.total),
        sous: 'arrêts + routes', teinte: 'succes',
      },
      {
        onglet: 'radio', libelle: 'Radio', valeur: r ? formaterNombre(r.total_emetteurs) : '0',
        sous: r ? `FM ${r.emetteurs_fm} · DAB+ ${r.emetteurs_dab}` : 'aucun import', teinte: 'teal',
      },
    ];
  });

  /** `CustomZonesStatsCard` : « … » pendant la lecture, 0 sans réponse. */
  protected readonly zones = computed(() => {
    const z = this.statsZones();
    return {
      valeur: this.zonesChargement() ? '…' : formaterNombre(z?.total_zones ?? 0),
      sous: `${formaterNombre(z?.total_iris ?? 0)} IRIS · ${formaterNombre(z?.total_cp ?? 0)} CP résolus`,
    };
  });
}
