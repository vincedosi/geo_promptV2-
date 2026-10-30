import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { TypologiesZoneService } from '../../etat/typologies-zone.service';
import {
  MESSAGE_AUCUN_POI_TYPE, MESSAGE_POPULATION_CUMULEE, MESSAGE_SANS_ZONE, MESSAGE_TRONQUE, type ModeleTypologies, cleModele, jetonTypologie, libelleModele,
  libelleTypologie,
} from '../../logique/analyses/typologies';
import { EnteteOutilComponent } from './entete-outil.component';
import { type OptionPastille, PastillesComponent } from './pastilles.component';
import { CORPS_ACCORDEON, ENCART_ERREUR, LIBELLE_CHAMP } from './styles-analyse';

/**
 * ④ Analyse — le tiroir « Typologies des POI » (④ finitions, T8, A-7 ; Excel n° 34), pour TOUS : les typologies déjà
 * calculées des POI de la zone analysée, un tableau par (durée, mode) — typologie, nombre de POI, population couverte —
 * et les POI sur la carte, colorés par typologie ; survoler une ligne met ses POI en surbrillance. L'état et la couche
 * sont dans `TypologiesZoneService` (panneau). Aucune lecture avant le premier dépli. Hors garde de ① : la zone est le
 * périmètre, lu dans l'espace de la session côté serveur (quota de la couverture).
 */
@Component({
  selector: 'mg-typologies-zone',
  imports: [EnteteOutilComponent, PastillesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <mg-entete-outil titre="Typologies des POI" [ouvert]="s.ouvert()" (basculer)="s.basculerOuvert()" />
    @if (s.ouvert()) {
      <div [class]="corps" data-outil-typologies>
        <div class="text-[11px] leading-[1.5] text-tertiary">
          Les typologies déjà calculées des POI situés dans la zone analysée, et la population que chacune couvre.
        </div>

        @if (s.erreur(); as e) { <div data-erreur role="alert" [class]="encartErreur">{{ e }}</div> }

        @if (!s.zoneId()) {
          <div data-sans-zone class="text-[12px] leading-[1.5] text-secondary">{{ sansZone }}</div>
        } @else if (s.enCours()) {
          <div class="font-mono text-[11px] text-tertiary">Lecture des typologies…</div>
        } @else if (s.resultat(); as r) {
          @if (r.motif === 'aucun_poi_type' || r.modeles.length === 0) {
            <div data-aucun-poi-type class="text-[12px] leading-[1.5] text-secondary">{{ aucun }}</div>
          } @else {
            @if (r.modeles.length > 1) {
              <div>
                <div [class]="libelleChamp">Modèle</div>
                <mg-pastilles libelle="Modèle de typologies" [options]="options()" [valeur]="cleCourante()" (valeurChange)="s.modeleChoisi.set($event)" />
              </div>
            }
            @if (s.modele(); as m) {
              <table class="w-full border-collapse text-[11px]" data-tableau-typologies>
                <caption class="sr-only">Typologies des POI de la zone, {{ libelle(m) }}</caption>
                <thead>
                  <tr class="text-left text-tertiary">
                    <th scope="col" class="py-1 font-normal">Typologie</th>
                    <th scope="col" class="py-1 text-right font-normal">POI</th>
                    <th scope="col" class="py-1 text-right font-normal" [attr.title]="cumulee">Population cumulée</th>
                  </tr>
                </thead>
                <tbody>
                  @for (t of m.typologies; track t.cluster_id; let i = $index) {
                    <tr [attr.data-typologie]="t.cluster_id" (mouseenter)="s.survol.set(t.cluster_id)" (mouseleave)="s.survol.set(null)"
                      class="border-t-fin border-subtle" [class.bg-elevated]="s.survol() === t.cluster_id">
                      <td class="py-1.5 text-primary">
                        <span aria-hidden="true" class="mr-1.5 inline-block size-2 rounded-full align-middle" [style.background]="teinte(i)"></span>{{ nom(t) }}
                      </td>
                      <td class="py-1.5 text-right font-mono text-secondary">{{ nombre(t.n_poi) }}</td>
                      <td class="py-1.5 text-right font-mono text-secondary">{{ nombre(t.population ?? 0) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              <div data-population-cumulee class="text-[11px] leading-[1.5] text-tertiary">{{ cumulee }}</div>
            }
            @if (r.tronque) { <div data-tronque class="text-[11px] leading-[1.5] text-secondary">{{ tronque }}</div> }
          }
        }
      </div>
    }
  `,
})
export class TypologiesZoneComponent {
  protected readonly s = inject(TypologiesZoneService);
  protected readonly corps = CORPS_ACCORDEON;
  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly encartErreur = ENCART_ERREUR;
  protected readonly sansZone = MESSAGE_SANS_ZONE;
  protected readonly aucun = MESSAGE_AUCUN_POI_TYPE;
  protected readonly tronque = MESSAGE_TRONQUE;
  protected readonly cumulee = MESSAGE_POPULATION_CUMULEE;
  protected readonly nombre = formaterNombre;
  protected readonly nom = libelleTypologie;
  protected readonly libelle = libelleModele;
  protected readonly teinte = jetonTypologie;

  protected readonly options = computed<readonly OptionPastille<string>[]>(() =>
    (this.s.resultat()?.modeles ?? []).map((m: ModeleTypologies) => ({ cle: cleModele(m), valeur: cleModele(m), libelle: libelleModele(m) })));
  protected readonly cleCourante = computed(() => {
    const m = this.s.modele();
    return m ? cleModele(m) : '';
  });
}
