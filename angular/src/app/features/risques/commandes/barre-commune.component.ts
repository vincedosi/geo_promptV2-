import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ChampComponent } from '../../../ui/champ/champ.component';
import { PastilleComponent } from '../../../ui/pastille/pastille.component';
import { DonneesRisqueService } from '../etat/donnees-risque.service';
import { EtatRisqueService } from '../etat/etat-risque.service';
import { DIMENSIONS_PROPOSEES, type Dimension, LIBELLE_DIMENSION, MODES_ZONE, type ModeZone } from '../logique/dimensions';
import { NIVEAUX_RISQUE } from '../logique/gravites';

/** Libellé et infobulle de chaque origine de zone — copie de `AIDE_MODE` (`AnalysePopulationOverlay.tsx:155-158`). */
const AIDE_MODE: Record<ModeZone, { label: string; aide: string }> = {
  pprt: { label: 'Périmètre PPRT', aide: 'Servitude publiée par l\'État, opposable' },
  buffer: { label: 'Rayon calculé', aide: 'Rayon choisi ci-dessus — aucune valeur réglementaire' },
};

/** Infobulles de « Lister par », mot pour mot (l.1033-1038). */
const TITRE_MAILLE: Partial<Record<Dimension, string>> = {
  commune: 'Le carroyage INSEE porte le code commune tel qu’il l’écrit : Paris, Lyon et Marseille y sont par arrondissement.',
  code_postal: 'Ni part ni densité à cette maille : le seul référentiel de population par code postal surcompte de 10,5 %.',
};

/** Garde au moins un élément : tout décocher ne rendrait rien, sans explication (l.1132-1135). */
function basculer<T>(liste: readonly T[], x: T): T[] | null {
  const suivant = liste.includes(x) ? liste.filter((v) => v !== x) : [...liste, x];
  return suivant.length === 0 ? null : suivant;
}

/**
 * La barre commune du module risque — portage de `AnalysePopulationOverlay.tsx:990-1199`, réglettes
 * exceptées (projetées, T6). UNE barre pour toutes les étapes : tout ce qui y figure vaut partout, et
 * l'état est unique (`EtatRisqueService`), il n'y a aucune copie à synchroniser.
 *
 * Première rangée : ce qu'on REGARDE (cible, maille listée, territoire, rayons). Seconde rangée, sous un
 * trait fin : ce qu'on RETIENT (nature de zone, niveau réglementaire) et comment on LIT les zones.
 *
 * ⚠ `<select>` natifs et non des menus flottants : un menu maison sortirait de la racine d'ombre.
 */
@Component({
  selector: 'mg-barre-commune',
  imports: [ChampComponent, PastilleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex flex-wrap items-end gap-[18px] px-5 py-3">
      <mg-champ libelle="Cible">
        <select class="rounded-lg border-fin border-subtle bg-elevated px-[10px] py-[6px] text-[12px] text-primary"
                (change)="choisirCible($event)">
          @if (familles().length === 0) {
            <option value="ind" [selected]="etat().cible === 'ind'">Population totale</option>
          }
          @for (f of familles(); track f.famille) {
            <optgroup [label]="f.famille">
              @for (c of f.cibles; track c.code) {
                <option [value]="c.code" [selected]="c.code === etat().cible">{{ c.libelle }}</option>
              }
            </optgroup>
          }
        </select>
      </mg-champ>

      <!-- La maille dit CE QU'ON LISTE, le fil d'Ariane dit OÙ : « les 100 plus grandes communes de France » reste posable. -->
      <mg-champ libelle="Lister par">
        <div class="flex gap-1">
          @for (d of mailles; track d.id) {
            <button mgPastille [actif]="donnees.dimension() === d.id" [attr.title]="d.titre"
                    (click)="choisirMaille(d.id)">{{ d.label }}</button>
          }
        </div>
      </mg-champ>

      <!-- Raccourci de territoire : il écrit le même état que le fil d'Ariane, les deux ne peuvent pas se contredire. -->
      <mg-champ libelle="Territoire">
        <select class="min-w-[190px] rounded-lg border-fin border-subtle bg-elevated px-[10px] py-[6px] text-[12px] text-primary"
                (change)="choisirTerritoire($event)">
          <option value="" [selected]="territoire() === ''">France entière</option>
          @if (donnees.refGeo().regions.length > 0) {
            <optgroup label="Régions">
              @for (u of donnees.refGeo().regions; track u.code) {
                <option [value]="'region:' + u.code" [selected]="territoire() === 'region:' + u.code">{{ u.nom }}</option>
              }
            </optgroup>
          }
          @if (donnees.refGeo().departements.length > 0) {
            <optgroup label="Départements">
              @for (u of donnees.refGeo().departements; track u.code) {
                <option [value]="'departement:' + u.code" [selected]="territoire() === 'departement:' + u.code">{{ u.code }} — {{ u.nom }}</option>
              }
            </optgroup>
          }
        </select>
      </mg-champ>

      <!-- Les réglettes du rayon (T6), une par niveau. -->
      <ng-content />
    </div>

    <div class="flex flex-wrap items-center gap-5 border-b-fin border-subtle px-5 pt-0 pb-3">
      <mg-champ libelle="Nature de la zone">
        <div class="flex gap-1">
          @for (m of modes; track m.id) {
            <button mgPastille [actif]="etat().modes.includes(m.id)" [attr.title]="m.aide"
                    (click)="basculerMode(m.id)">{{ m.label }}</button>
          }
        </div>
      </mg-champ>

      <mg-champ libelle="Niveau réglementaire">
        <div class="flex flex-wrap gap-1">
          @for (n of niveaux; track n.id) {
            <button mgPastille [actif]="etat().gravites.includes(n.id)" (click)="basculerNiveau(n.id)">{{ n.label }}</button>
          }
        </div>
      </mg-champ>

      <!-- La seule commande qui ne filtre rien : aucun chargement n'en dépend, la bascule est instantanée. -->
      <mg-champ libelle="Lecture des zones">
        <div class="flex gap-1">
          <button mgPastille [actif]="etat().fusionner" title="Une enveloppe continue par bande — jusqu'où s'étend le risque"
                  (click)="etatRisque.maj({ fusionner: true })">Fusionnées</button>
          <button mgPastille [actif]="!etat().fusionner" title="Un cercle par site et par anneau — de quel site vient cette zone"
                  (click)="etatRisque.maj({ fusionner: false })">Site par site</button>
        </div>
      </mg-champ>
    </div>
  `,
})
export class BarreCommuneComponent {
  protected readonly etatRisque = inject(EtatRisqueService);
  protected readonly donnees = inject(DonneesRisqueService);
  protected readonly etat = this.etatRisque.etat;

  protected readonly mailles = DIMENSIONS_PROPOSEES.map((id) => ({ id, label: LIBELLE_DIMENSION[id], titre: TITRE_MAILLE[id] ?? null }));
  protected readonly modes = MODES_ZONE.map((id) => ({ id, ...AIDE_MODE[id] }));
  protected readonly niveaux = NIVEAUX_RISQUE;

  /** Les cibles groupées par famille, dans l'ordre d'apparition (l.893). */
  protected readonly familles = computed(() => {
    const cibles = this.donnees.cibles();
    return [...new Set(cibles.map((c) => c.famille))].map((famille) => ({
      famille, cibles: cibles.filter((c) => c.famille === famille),
    }));
  });

  /** La valeur du menu « Territoire » : le DERNIER segment résolu (l.1066). */
  protected readonly territoire = computed(() => {
    const c = this.donnees.chemin();
    const d = c[c.length - 1];
    return d ? `${d.niveau}:${d.code}` : '';
  });

  protected choisirCible(ev: Event): void {
    this.etatRisque.maj({ cible: (ev.target as HTMLSelectElement).value });
  }

  /**
   * Choisir la maille naturelle REVIENT à `null` : la maille suit alors de nouveau le fil d'Ariane.
   * Le survol et la sélection de ③ sont OUBLIÉS (relecture T11) : un code de région désignerait au niveau suivant un
   * département homonyme (93 → Seine-Saint-Denis), et la mini-carte se cadrerait dessus.
   */
  choisirMaille(d: Dimension): void {
    this.donnees.oublierUnite();
    this.donnees.mailleChoisie.set(d === this.donnees.mailleNaturelle() ? null : d);
  }

  protected choisirTerritoire(ev: Event): void {
    this.donnees.choisirTerritoire((ev.target as HTMLSelectElement).value as '' | `region:${string}`);
  }

  basculerMode(m: ModeZone): void {
    const suivant = basculer(this.etat().modes, m);
    if (suivant) this.etatRisque.maj({ modes: suivant });
  }

  basculerNiveau(g: string): void {
    const suivant = basculer(this.etat().gravites, g);
    if (suivant) this.etatRisque.maj({ gravites: suivant });
  }
}
