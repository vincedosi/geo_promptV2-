import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { APERCU_SITES_MAX } from '../../../risques/cartes/couches-sites';
import { CLE_TOUTES, CourbePopulationComponent, formaterKm } from '../../../risques/etapes/rayon/courbe-population.component';
import { CouvertureRayonService } from '../../etat/couverture-rayon.service';
import { MAX_VALEURS, RAYON_MAX_M, RAYON_MIN_M } from '../../logique/analyses/couverture';
import { CHAMP_SOUS_CATEGORIE, type LigneProfil, libelleBande } from '../../logique/analyses/couverture-rayon';
import { ChoixCibleComponent } from './choix-cible.component';
import { ChoixSurZoneComponent } from './choix-sur-zone.component';
import { EnteteOutilComponent } from './entete-outil.component';
import { PastillesComponent } from './pastilles.component';
import {
  BOUTON_CALCUL, CORPS_ACCORDEON, ENCART_ERREUR, LIBELLE_CHAMP, LISTE_CHAMP, PASTILLE, PASTILLE_INACTIVE,
} from './styles-analyse';

const CHAMP_SAISIE = 'w-full rounded-[6px] border-fin border-subtle bg-elevated px-[10px] py-1.5 font-mono text-[11px] text-primary';

/**
 * ④ Analyse — « Couverture par rayon autour d'un type de POI » (lot 4, T12) : la courbe du module risque (② Rayon),
 * généralisée à tout type de POI, sur la zone analysée ou le périmètre de ①. Sans équivalent React.
 *
 * HORS GARDE DE ① : la borne est en base (France, région et plus de 12 000 km² refusés, 6 calculs / min) et revient en
 * refus d'une ligne ; l'outil appelle donc lui-même `CouvertureRayonService.lancer()`.
 */
@Component({
  selector: 'mg-outil-rayon',
  imports: [EnteteOutilComponent, PastillesComponent, ChoixCibleComponent, ChoixSurZoneComponent, CourbePopulationComponent, KpiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <mg-entete-outil titre="Couverture par rayon autour d’un type de POI" [ouvert]="s.ouvert()" (basculer)="s.basculerOuvert()" />
    @if (s.ouvert()) {
      <div [class]="corps" data-outil-rayon>
        <div class="text-[11px] leading-[1.5] text-tertiary">
          Combien de personnes de la cible vivent à moins d’un rayon donné du POI le plus proche, de 100 m au rayon maximal.
        </div>

        @if (s.zoneAnalysee()) { <mg-choix-sur-zone [(surZone)]="s.surZone" objet="de la couverture par rayon" /> }

        <div>
          <label [class]="libelleChamp" for="rayon-type-poi">Type de POI</label>
          <select id="rayon-type-poi" data-categorie [class]="liste" (change)="s.categorie.set($any($event.target).value)">
            @for (t of s.types(); track t.id) { <option [value]="t.id" [selected]="t.id === s.categorie()">{{ t.label }}</option> }
          </select>
        </div>

        <div>
          <div [class]="libelleChamp">Rayon maximal</div>
          <div class="flex items-center gap-2">
            <input type="range" data-rayon-max aria-label="Rayon maximal" class="flex-1 accent-[var(--brand-teal)]" [min]="min" [max]="max" step="100"
              [value]="s.rayonMax()" (input)="s.rayonMax.set(+$any($event.target).value)" />
            <span class="w-14 text-right font-mono text-[11px] text-secondary">{{ km(s.rayonMax()) }}</span>
          </div>
        </div>

        <div>
          <div [class]="libelleChamp">Détail</div>
          <mg-pastilles libelle="Détail par champ" [options]="details" [(valeur)]="s.champ" />
        </div>

        <div>
          <div [class]="libelleChamp">Anneaux (m)</div>
          @if (!s.champ()) {
            <input type="text" data-anneaux="*" [class]="saisie" placeholder="ex. 500, 1000, 2000" aria-label="Anneaux autour du POI le plus proche"
              [value]="s.ligneTous().anneaux" (input)="s.ligneTous.set({ valeur: tous, anneaux: $any($event.target).value })" />
          } @else {
            <datalist id="rayon-valeurs">@for (v of valeursConnues(); track v) { <option [value]="v"></option> }</datalist>
            <div class="flex flex-col gap-1.5">
              @for (l of s.lignesValeurs(); track $index; let i = $index) {
                <div class="flex items-center gap-1.5" [attr.data-ligne]="i">
                  <input type="text" data-valeur [class]="saisie" list="rayon-valeurs" placeholder="valeur" aria-label="Valeur"
                    [value]="l.valeur" (input)="modifier(i, { valeur: $any($event.target).value })" />
                  <input type="text" data-anneaux [class]="saisie" placeholder="500, 1000" [attr.aria-label]="'Anneaux de ' + l.valeur"
                    [value]="l.anneaux" (input)="modifier(i, { anneaux: $any($event.target).value })" />
                  <button type="button" [attr.aria-label]="'Retirer ' + l.valeur" (click)="retirer(i)"
                    class="cursor-pointer border-0 bg-transparent text-[14px] leading-none text-tertiary">×</button>
                </div>
              }
              <button type="button" data-ajouter-valeur [disabled]="s.lignesValeurs().length >= maxValeurs" (click)="ajouter()"
                [class]="pastille + ' ' + pastilleInactive + ' self-start disabled:cursor-not-allowed disabled:opacity-40'">+ Ajouter une valeur</button>
              <div class="text-[10px] leading-[1.5] text-tertiary">Sans valeur, toutes les sous-catégories sont tracées ; avec, seules elles.</div>
            </div>
          }
        </div>

        <mg-choix-cible [cible]="s.cible()" (choisie)="s.cible.set($event)" />

        @if (s.erreur(); as e) { <div data-erreur role="alert" [class]="encartErreur">{{ e }}</div> }

        <button type="button" data-calculer [disabled]="s.enCours()" (click)="s.lancer()" [class]="boutonCalcul">
          {{ s.enCours() ? 'Calcul…' : 'Calculer' }}
        </button>

        @if (s.resultat(); as r) {
          <div data-resultat class="-mx-4 flex flex-col">
            <mg-courbe-population [courbes]="r.courbes" [libelleCible]="choixCible()?.libelle() ?? r.cible" [nomPerimetre]="s.nomPerimetre()"
                                  [titre]="titre()" nomTotale="Tous les POI" [rayonMax]="r.rayon_max_m" [(rayon)]="s.rayon">
              <mg-kpi [taille]="22" [valeur]="nombre(r.n_poi)" libelle="POI retenus" [note]="'à moins de ' + km(r.rayon_max_m) + ' du périmètre'" />
              <p mgNote data-role="note" class="m-0 px-5 pt-0 pb-[14px] text-[10px] leading-[1.5] text-tertiary">
                Distance du centre de chaque carreau de 200 m au POI le plus proche ; {{ nombre(r.population_perimetre) }} habitants
                carroyés dans le périmètre.
                @if (r.n_poi > apercuMax) { Cercles tracés autour des {{ apercuMax }} premiers POI seulement. }
                @if (r.courbes.length > 2) { « Tous les POI » n’est pas la somme des autres courbes — un habitant proche de deux valeurs compte dans les deux. }
              </p>
            </mg-courbe-population>

            @if (r.classes; as classes) {
              <table data-classes class="mx-4 mt-1 border-collapse text-[11px]">
                <thead><tr class="text-left text-tertiary">
                  <th class="py-1 font-normal">Valeur</th><th class="py-1 font-normal">Bande</th><th class="py-1 text-right font-normal">Population</th>
                </tr></thead>
                <tbody>
                  @for (c of classes; track c.valeur + c.anneau_m) {
                    <tr class="border-t-fin border-subtle text-secondary">
                      <td class="py-1">{{ c.valeur === tous ? 'Tous les POI' : c.valeur }}</td>
                      <td class="py-1 font-mono">{{ bande(c.valeur, c.anneau_m) }}</td>
                      <td class="py-1 text-right font-mono">{{ nombre(c.population) }}</td>
                    </tr>
                  }
                  <tr class="border-t-fin border-subtle text-tertiary">
                    <td class="py-1" colspan="2">Hors classes</td><td class="py-1 text-right font-mono">{{ nombre(r.hors_classes ?? 0) }}</td>
                  </tr>
                </tbody>
              </table>
            }
          </div>
        }
      </div>
    }
  `,
})
export class OutilRayonComponent {
  protected readonly s = inject(CouvertureRayonService);
  protected readonly choixCible = viewChild(ChoixCibleComponent);

  protected readonly min = RAYON_MIN_M;
  protected readonly max = RAYON_MAX_M;
  protected readonly maxValeurs = MAX_VALEURS;
  protected readonly details = [
    { cle: 'aucun', valeur: null, libelle: 'Aucun' },
    { cle: CHAMP_SOUS_CATEGORIE, valeur: CHAMP_SOUS_CATEGORIE, libelle: 'Par sous-catégorie' },
  ];
  protected readonly tous = CLE_TOUTES;
  protected readonly apercuMax = APERCU_SITES_MAX;
  protected readonly km = formaterKm;
  protected readonly nombre = formaterNombre;
  protected readonly corps = CORPS_ACCORDEON;
  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly liste = LISTE_CHAMP;
  protected readonly saisie = CHAMP_SAISIE;
  protected readonly boutonCalcul = BOUTON_CALCUL;
  protected readonly encartErreur = ENCART_ERREUR;
  protected readonly pastille = PASTILLE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;

  /** Les valeurs du dernier calcul, proposées à la saisie. */
  protected readonly valeursConnues = computed(() => (this.s.resultat()?.courbes ?? []).map((c) => c.cle).filter((c) => c !== CLE_TOUTES));
  protected readonly titre = computed(() => {
    const type = this.s.types().find((t) => t.id === this.s.categorie())?.label ?? this.s.categorie();
    return `Population couverte selon le rayon autour des POI « ${type} » — ${this.s.nomPerimetre()}`;
  });

  protected bande(valeur: string, anneauM: number): string {
    return libelleBande(this.s.profilCalcule()[valeur] ?? [], anneauM);
  }

  protected modifier(i: number, champ: Partial<LigneProfil>): void {
    this.s.lignesValeurs.update((l) => l.map((x, j) => (j === i ? { ...x, ...champ } : x)));
  }

  protected retirer(i: number): void {
    this.s.lignesValeurs.update((l) => l.filter((_, j) => j !== i));
  }

  protected ajouter(): void {
    this.s.lignesValeurs.update((l) => [...l, { valeur: '', anneaux: '' }]);
  }
}
