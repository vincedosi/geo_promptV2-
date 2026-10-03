import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formaterDecimal, formaterNombre } from '../../../core/format/nombre';
import { BandeauKpiComponent } from '../../../ui/bandeau-kpi/bandeau-kpi.component';
import { KpiComponent } from '../../../ui/kpi/kpi.component';
import type { Bandes } from '../data/profil-risque.api';
import type { CompteSites } from '../data/sites-risque.api';
import type { PointCourbe } from '../etat/donnees-risque.service';
import { LIBELLE_DIMENSION, type Dimension } from '../logique/dimensions';
import { partExposee, tauxUtile } from '../logique/kpi';

/** La phrase de fin de bandeau, et sa définition en infobulle — MOT POUR MOT de `BandeauKpi.tsx:164-175`. */
export const CONSIGNE_BANDEAU = 'Ces six chiffres suivent les filtres et le profil. Survolez-en un pour sa définition.';
export const DEFINITION_BANDEAU =
  'Taux d’utile : part des habitants des unités touchées qui vivent réellement en zone. '
  + 'Il chute aux petits rayons — on achète un territoire entier pour n’en viser qu’une '
  + 'fraction. Il n’est affiché que si des unités sont laissées de côté : quand toutes '
  + 'sont touchées, il vaut exactement la part et n’apprend rien. Le taux du PLAN, '
  + 'calculé sur les codes postaux réellement retenus, apparaît à l’étape Zones.';

/**
 * Habitants gagnés par 100 m de plus, au rayon courant (`BandeauKpi.tsx:59-72`) : le palier le plus proche
 * AU-DESSOUS du rayon, lu sur la courbe DÉJÀ calculée — jamais recalculé, sinon deux chiffres divergeraient.
 */
export function gainMarginal(courbe: PointCourbe[] | null, rayonM: number | null): number | null {
  if (!courbe || courbe.length === 0 || rayonM === null) return null;
  let choisi: PointCourbe | null = null;
  for (const pt of courbe) {
    if (pt.r <= rayonM) choisi = pt;
    else break;
  }
  return choisi?.i ?? null;
}

/** Un tiret et non un zéro tant que la donnée manque : zéro se lirait « personne n'est exposé ». */
const ou = (v: number | null, suffixe = ''): string => (v === null ? '—' : `${formaterNombre(v)}${suffixe}`);

/**
 * Les six chiffres permanents du module risque — portage de `BandeauKpi.tsx`, sur `mg-bandeau-kpi` et `mg-kpi`.
 * Valeurs, libellés, notes et infobulle MOT POUR MOT. Le taux d'utile est le seul, avec le total, à porter
 * l'accent de marque : il doit être vu AVANT l'achat.
 */
@Component({
  selector: 'mg-bandeau-kpi-risque',
  imports: [BandeauKpiComponent, KpiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <mg-bandeau-kpi [consigne]="consigne" [definition]="definition">
      <mg-kpi [valeur]="v().total" [libelle]="v().libelleTotal" note="somme exclusive : un carreau, une classe" accent />
      <mg-kpi [valeur]="v().part" libelle="du territoire étudié" note="rapporté au carroyage, pas aux 67,8 M de l’INSEE" />
      <mg-kpi [valeur]="v().sites" libelle="sites retenus" note="ne s’additionne pas avec la population" />
      <mg-kpi [valeur]="v().codesPostaux" libelle="codes postaux touchés" note="les retenus se décident à l’étape Zones" />
      <mg-kpi [valeur]="v().taux" libelle="taux d’utile" [note]="v().noteTaux" accent />
      <mg-kpi [valeur]="v().gain" libelle="par 100 m de plus" [note]="v().noteGain" />
    </mg-bandeau-kpi>
  `,
})
export class BandeauKpiRisqueComponent {
  readonly bandes = input.required<Bandes | null>();
  readonly sites = input.required<CompteSites | null>();
  /** La courbe cumulée totale, pour le gain marginal. `null` si indisponible. */
  readonly courbe = input.required<PointCourbe[] | null>();
  /** Le plus grand rayon du profil, en mètres — l'abscisse du gain marginal. */
  readonly rayonMax = input.required<number | null>();
  readonly maille = input.required<Dimension>();
  readonly libelleCible = input.required<string>();

  protected readonly consigne = CONSIGNE_BANDEAU;
  protected readonly definition = DEFINITION_BANDEAU;

  protected readonly v = computed(() => {
    const b = this.bandes();
    const s = this.sites();
    const partFrance = b ? partExposee(b.total, b.population_reference) : null;
    // `null` quand TOUTES les unités sont touchées : le taux vaudrait la part, deux cases à gauche.
    const taux = b ? tauxUtile(b.total, b.pop_unites_touchees, b.population_reference) : null;
    const gain = gainMarginal(this.courbe(), this.rayonMax());
    const rayonMax = this.rayonMax();
    const maille = LIBELLE_DIMENSION[this.maille()].toLowerCase();
    return {
      total: ou(b?.total ?? null),
      libelleTotal: this.libelleCible().toLowerCase(),
      part: partFrance === null ? '—' : `${formaterDecimal(partFrance)} %`,
      sites: s ? `${formaterNombre(s.retenus)} / ${formaterNombre(s.total)}` : '—',
      codesPostaux: ou(b?.n_codes_postaux ?? null),
      taux: taux === null ? '—' : `${formaterDecimal(taux)} %`,
      // La note DIT pourquoi le tiret — mais seulement une fois mesuré : pendant le calcul elle mentirait.
      noteTaux: b && taux === null ? `toutes les unités sont touchées à la maille ${maille}` : `à la maille ${maille}`,
      gain: gain === null ? '—' : `+${formaterNombre(gain)}`,
      noteGain: rayonMax === null ? 'aucun anneau posé' : `au rayon de ${formaterNombre(rayonMax)} m`,
    };
  });
}
