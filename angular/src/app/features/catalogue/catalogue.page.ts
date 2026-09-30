import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ChargementService } from '../../core/chargement/chargement.service';
import { BarreProgressionComponent } from '../../ui/barre-progression/barre-progression.component';
import { ChampComponent } from '../../ui/champ/champ.component';
import { type EtapeAffichee, FilEtapesComponent } from '../../ui/fil-etapes/fil-etapes.component';
import { IconeComponent } from '../../ui/icone/icone.component';
import { ICONES, type NomIcone } from '../../ui/icone/icones';
import { FilArianeComponent, type SegmentAriane } from '../../ui/fil-ariane/fil-ariane.component';
import { KpiComponent } from '../../ui/kpi/kpi.component';
import { PastilleComponent } from '../../ui/pastille/pastille.component';
import { PerimeDirective } from '../../ui/perime/perime.directive';
import { RegletteComponent } from '../../ui/reglette/reglette.component';
import { Cellule, EnteteCellule } from '../../ui/tableau/cellules';

/**
 * Chaque composant de ui/, dans son état réel, avec des données d'exemple
 * génériques. Sert à la relecture visuelle dans les deux thèmes, et de mode
 * d'emploi pour les lots suivants.
 */
@Component({
  selector: 'mg-catalogue',
  imports: [
    BarreProgressionComponent, ChampComponent, FilEtapesComponent, FilArianeComponent,
    IconeComponent, KpiComponent, PastilleComponent, PerimeDirective, RegletteComponent, Cellule, EnteteCellule,
  ],
  providers: [ChargementService],
  templateUrl: './catalogue.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CataloguePage {
  private readonly chargement = inject(ChargementService);

  protected readonly iconesPortees = Object.keys(ICONES) as NomIcone[];
  protected readonly taillesIcones = [14, 16, 20];
  protected readonly enCalcul = signal(false);
  protected readonly pastilles = signal<Record<string, boolean>>({ premier: true, second: false });
  protected readonly etapeCourante = signal('deux');
  protected readonly etapes: EtapeAffichee[] = [
    { cle: 'un', rang: 1, libelle: 'Choisir', renseignee: true },
    { cle: 'deux', rang: 2, libelle: 'Régler', renseignee: true },
    { cle: 'trois', rang: 3, libelle: 'Comparer', renseignee: false },
  ];
  protected readonly segments = signal<SegmentAriane[]>([
    { cle: 'racine', libelle: 'Ensemble' },
    { cle: 'groupe', libelle: 'Groupe A', titre: 'Niveau 1 — code A' },
    { cle: 'element', libelle: 'Élément 12', titre: 'Niveau 2 — code 12' },
  ]);
  protected readonly valeurReglette = signal(1000);
  protected readonly apercuReglette = signal<number | null>(null);

  constructor() {
    this.chargement.suivre('catalogue', 'Calcul d’exemple', () => this.enCalcul());
  }

  protected basculerPastille(cle: string): void {
    this.pastilles.update((p) => ({ ...p, [cle]: !p[cle] }));
  }

  protected remonter(i: number): void {
    this.segments.update((s) => s.slice(0, i + 1));
  }

  protected formaterMetres(n: number): string {
    return n >= 1000 ? `${(n / 1000).toLocaleString('fr-FR')} km` : `${n} m`;
  }
}
