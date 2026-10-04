import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterDecimal, formaterNombreCourt } from '../../../../core/format/nombre';
import { BandeauKpiComponent } from '../../../../ui/bandeau-kpi/bandeau-kpi.component';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { SimulationService } from '../../etat/simulation.service';
import { LIBELLE_PERIODE } from '../../logique/simulation/vue';

/** La phrase de fin de bandeau et sa définition en infobulle — MOT POUR MOT de `BandeauCampagne.tsx:61-72`. */
export const CONSIGNE_CAMPAGNE = 'Ces six chiffres suivent la période choisie. Survolez ce texte pour leurs définitions.';
export const DEFINITION_CAMPAGNE =
  'Alignement : même règle que le Suivi de campagne (tolérance 10 %), calculée par '
  + 'bassin sur les impressions UTILES — celles qui touchent des habitants exposés. '
  + 'Le plan d’un bassin est sa part de la population exposée, jamais la population '
  + 'totale de ses codes postaux. Coût par exposé touché : dépense ÷ exposés touchés '
  + 'au moins une fois, estimés par une loi de Poisson.';

/** `pct` et `eur` de `BandeauCampagne.tsx:18-19`. */
const pct = (x: number | null): string => (x == null ? '—' : `${formaterDecimal(x * 100, 1)} %`);
const eur = (x: number | null, d = 2): string => (x == null ? '—' : `${formaterDecimal(x, d)} €`);

/**
 * Les six chiffres de l'étape ⑤, à la place de ceux des étapes ① à ④ — portage de `BandeauCampagne.tsx`.
 *
 * Même conteneur (`mg-bandeau-kpi`), mêmes tuiles (`mg-kpi`), même emplacement : on change de QUESTION (« la campagne
 * tient-elle son plan »), pas d'écran. Les chiffres suivent la PÉRIODE choisie et le disent dans leur note.
 */
@Component({
  selector: 'mg-bandeau-campagne',
  imports: [BandeauKpiComponent, KpiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <mg-bandeau-kpi [consigne]="consigne" [definition]="definition">
      <mg-kpi [valeur]="v().impressions" libelle="impressions" [note]="v().noteImpressions" />
      <mg-kpi [valeur]="v().score" libelle="alignement / 100" [note]="v().noteScore" accent />
      <mg-kpi [valeur]="v().partEnZone" libelle="part en zone" note="impressions sur les codes postaux achetés" />
      <mg-kpi [valeur]="v().tauxUtile" libelle="taux d’utile réel" note="impressions qui touchent des exposés" accent />
      <mg-kpi [valeur]="v().depense" libelle="dépense" note="au CPM réel de chaque partenaire" />
      <mg-kpi [valeur]="v().cout" libelle="coût par exposé touché" [note]="v().noteCout" />
    </mg-bandeau-kpi>
  `,
})
export class BandeauCampagneComponent {
  private readonly simulation = inject(SimulationService);

  protected readonly consigne = CONSIGNE_CAMPAGNE;
  protected readonly definition = DEFINITION_CAMPAGNE;

  protected readonly v = computed(() => {
    const vue = this.simulation.vue();
    const i = vue?.indicateurs ?? null;
    const note = vue ? `${LIBELLE_PERIODE[vue.periode].toLowerCase()} · jours ${vue.jours[0]} à ${vue.jours[1]}` : '';
    return {
      impressions: i ? formaterNombreCourt(i.impressions) : '—',
      noteImpressions: vue ? note : this.simulation.etat() === 'chargement' ? 'lecture de la simulation' : 'aucune campagne simulée',
      score: i ? (i.score == null ? 'non calculable' : String(Math.round(i.score))) : '—',
      noteScore: i?.raison ?? 'par zone, sur la population exposée',
      partEnZone: pct(i?.part_en_zone ?? null),
      tauxUtile: pct(i?.taux_utile_reel ?? null),
      depense: i ? `${formaterNombreCourt(Math.round(i.depense))} €` : '—',
      cout: eur(i?.cout_expose_touche ?? null, 3),
      noteCout: i ? `${formaterNombreCourt(Math.round(i.exposes_touches))} exposés touchés au moins une fois` : 'portée estimée par zone',
    };
  });
}
