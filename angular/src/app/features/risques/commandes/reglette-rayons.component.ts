import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { RegletteComponent } from '../../../ui/reglette/reglette.component';
import {
  LIBELLE_NIVEAU, type Niveau, PAS_RAYON_M, type ProfilRayons, RAYON_MAX_M, RAYON_MIN_M,
  anneauxDuNiveau, libelleRayon, normaliserProfil, poserRayonExterieur,
} from '../logique/profil';

/**
 * Ce qu'on est en train de régler, tant que le doigt n'a pas lâché (`RegletteRayons.tsx:63`).
 *
 * ⚠ Ce n'est PAS un profil : une intention sans géométrie en base. La carte s'en sert pour un aperçu (T8),
 * et rien d'autre ne doit le lire — surtout pas un calcul de population, qui afficherait un chiffre pour
 * une zone qui n'existe pas encore. Il ne va jamais dans l'URL.
 */
export interface ApercuRayon {
  /** Le niveau dont on déplace le bord, ou `null` quand ils sont liés. */
  niveau: Niveau | null;
  rayonM: number;
}

/**
 * Les niveaux que le pré-calcul sait classer. Dérivé de la donnée disponible, jamais de `NIVEAUX` : ce dernier
 * porte aussi `autres`, dont `carreau_risque_distance` ne mesure aucune distance — une réglette y serait un
 * curseur qui ne change aucun chiffre.
 */
const NIVEAUX_REGLABLES: readonly Niveau[] = ['haut', 'bas'];

/** Infobulles du cadenas, mot pour mot (`RegletteRayons.tsx:112-114`). */
const TITRE_LIES = 'Les niveaux partagent les mêmes anneaux. Cliquez pour leur en donner de propres — c’est ce qui permet le bidding différencié.';
const TITRE_DELIES = 'Donner à tous les niveaux les anneaux du seuil haut, pour comparer à périmètre égal. ⚠ Les anneaux propres du seuil bas sont alors écrasés, et les délier ne les restaure pas.';

/**
 * Les réglettes de rayon de la barre commune — portage de `RegletteRayons.tsx`. Une par niveau réglable ;
 * cadenas fermé, UNE seule, « Tous les niveaux », dont les autres niveaux héritent.
 *
 * ── CE QU'ELLE RÈGLE, ET CE QU'ELLE NE RÈGLE PAS ─────────────────────────
 *
 * Le BORD d'un niveau, son anneau extérieur. Un niveau en porte jusqu'à quatre : les anneaux intérieurs
 * restent au tiroir, rappelés en gris à côté de la valeur (`poserRayonExterieur` garde le bord au-dessus du
 * dernier intérieur).
 *
 * ── LE CALCUL NE PART QU'AU RELÂCHEMENT ──────────────────────────────────
 *
 * `population_par_classe` coûte ~2,8 s sur la France : une requête par position serait l'incident du 28/03.
 * `mg-reglette` prévisualise pendant le glissement (`apercu`, à chaque position, sans aucune requête) et ne
 * valide qu'au relâchement : `profil` n'est émis QUE là.
 */
@Component({
  selector: 'mg-reglette-rayons',
  imports: [IconeComponent, RegletteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-wrap items-end gap-4' },
  template: `
    @for (r of reglettes(); track r.niveau) {
      <mg-reglette [libelle]="r.libelle" [valeur]="r.bord" [min]="rayonMin" [max]="rayonMax" [pas]="pasRayon"
                   [formater]="libelleRayon" [complement]="r.interieurs"
                   titreComplement="Anneaux intérieurs — réglables dans l’atelier, la réglette ne déplace que le bord."
                   [descriptionAccessible]="r.description"
                   (apercu)="relayerApercu(r.niveauApercu, $event)" (valider)="poser(r.niveau, $event)" />
    }
    <button type="button" (click)="basculerLiaison()" [attr.aria-pressed]="profil().lie"
            [attr.title]="profil().lie ? titreLies : titreDelies"
            class="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent px-0 pt-0 pb-[6px] text-[11px]"
            [class.text-teal]="profil().lie" [class.text-tertiary]="!profil().lie">
      <mg-icone [nom]="profil().lie ? 'cadenas' : 'cadenas-ouvert'" [taille]="12" />
      {{ profil().lie ? 'niveaux liés' : 'lier les niveaux' }}
    </button>
  `,
})
export class RegletteRayonsComponent {
  readonly profil = input.required<ProfilRayons>();
  /** Le nouveau profil, au RELÂCHEMENT d'une réglette ou au clic du cadenas — jamais pendant un glissement. */
  readonly changerProfil = output<ProfilRayons>({ alias: 'profil' });
  /** À chaque position du curseur, puis `null` au relâchement : la carte dessine un aperçu, sans requête. */
  readonly apercu = output<ApercuRayon | null>();

  protected readonly rayonMin = RAYON_MIN_M;
  protected readonly rayonMax = RAYON_MAX_M;
  protected readonly pasRayon = PAS_RAYON_M;
  protected readonly libelleRayon = libelleRayon;
  protected readonly titreLies = TITRE_LIES;
  protected readonly titreDelies = TITRE_DELIES;

  protected readonly reglettes = computed(() => {
    const p = this.profil();
    const niveaux = p.lie ? (['haut'] as const) : NIVEAUX_REGLABLES;
    return niveaux.map((niveau) => {
      const anneaux = anneauxDuNiveau(p, niveau);
      const interieurs = anneaux.slice(0, -1);
      const libelle = p.lie ? 'Tous les niveaux' : LIBELLE_NIVEAU[niveau];
      return {
        niveau,
        libelle,
        bord: anneaux.length > 0 ? anneaux[anneaux.length - 1] : RAYON_MIN_M,
        interieurs: interieurs.length > 0 ? `${interieurs.map(libelleRayon).join(' · ')} ·` : undefined,
        description: `Bord de la zone — ${libelle}, de ${RAYON_MIN_M} à ${RAYON_MAX_M} mètres`,
        // Cadenas fermé : l'aperçu vaut pour TOUS les niveaux, d'où `null` — la carte dessinerait sinon les
        // cercles du seul seuil haut pendant que la réglette annonce « tous les niveaux ».
        niveauApercu: p.lie ? null : niveau,
      };
    });
  });

  protected relayerApercu(niveau: Niveau | null, rayonM: number | null): void {
    this.apercu.emit(rayonM === null ? null : { niveau, rayonM });
  }

  protected poser(niveau: Niveau, rayonM: number): void {
    this.changerProfil.emit(poserRayonExterieur(this.profil(), niveau, rayonM));
  }

  protected basculerLiaison(): void {
    const p = this.profil();
    this.changerProfil.emit(normaliserProfil({ ...p, lie: !p.lie }));
  }
}
