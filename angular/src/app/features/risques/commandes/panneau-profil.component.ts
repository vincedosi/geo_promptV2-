import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { formaterNombre } from '../../../core/format/nombre';
import { EnteteSectionComponent } from '../../../ui/entete-section/entete-section.component';
import { IconeComponent } from '../../../ui/icone/icone.component';
import {
  ANNEAUX_MAX, LIBELLE_NIVEAU, NIVEAUX, type Niveau, type ProfilRayons, RAYON_MAX_M, RAYON_MIN_M,
  anneauxDuNiveau, libelleRayon, normaliserProfil,
} from '../logique/profil';

/** Les paliers que les plans de prévention emploient couramment (`PanneauProfil.tsx:33`). */
const PRESETS = [500, 1000, 2000, 5000] as const;

/**
 * Le tiroir des anneaux — portage de `PanneauProfil.tsx`. Une ligne par niveau : chips des anneaux (leur
 * ordre EST l'ordre des bandes), paliers usuels à ajouter, saisie libre en mètres, cadenas sur le seuil haut,
 * case « Distinguer les périmètres PPRT ».
 *
 * Chaque geste passe par `normaliserProfil` : l'écran montre exactement l'objet qui servira au calcul (tri,
 * dédoublonnage, liaison appliqués). Rien ne part vers le serveur tant que le geste n'est pas fini : le profil
 * complet voyage en une fois, par `profilChange`.
 *
 * « Autres régimes » est DÉSACTIVÉ avec sa raison écrite, jamais absent : le masquer laisserait croire à un
 * oubli.
 */
@Component({
  selector: 'mg-panneau-profil',
  imports: [EnteteSectionComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-3' },
  template: `
    <mg-entete-section libelle="Anneaux par niveau" class="-mx-[10px]" />

    @for (l of lignes(); track l.niveau) {
      <div class="flex flex-col gap-[6px] rounded-lg border-fin border-subtle bg-surface px-[10px] py-2"
           [class.opacity-45]="l.inactif" [attr.data-niveau]="l.niveau">
        <div class="flex items-center gap-2">
          <span class="text-[12px] font-medium text-primary">{{ l.libelle }}</span>
          @if (l.niveau === 'haut') {
            <button type="button" (click)="appliquer({ lie: !profil().lie })" [attr.aria-pressed]="profil().lie"
                    [attr.title]="profil().lie
                      ? 'Les niveaux partagent les mêmes anneaux. Cliquez pour leur en donner de propres.'
                      : 'Donner à tous les niveaux les anneaux du seuil haut, pour comparer à périmètre égal.'"
                    class="ml-auto inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px]"
                    [class.text-teal]="profil().lie" [class.text-tertiary]="!profil().lie">
              <mg-icone [nom]="profil().lie ? 'cadenas' : 'cadenas-ouvert'" [taille]="12" />
              {{ profil().lie ? 'liés' : 'lier' }}
            </button>
          }
        </div>

        @if (l.inactif) {
          <p class="m-0 text-[11px] text-tertiary">
            Non calculé : 97 825 sites relèvent des autres régimes, contre 1 327 Seveso.
            Le pré-calcul les exclut pour l’instant.
          </p>
        } @else {
          <div class="flex flex-wrap items-center gap-1">
            @if (l.anneaux.length === 0) {
              <span class="text-[11px] text-warning">Aucun anneau : ce niveau ne classe aucun habitant.</span>
            }
            @for (a of l.anneaux; track a.rayon) {
              <span [attr.title]="a.titre" [attr.data-classe]="a.classe"
                    class="inline-flex items-center gap-1 rounded-md border-fin border-default bg-overlay py-[2px] pr-1 pl-2 font-mono text-[11px] text-primary">
                {{ a.libelle }}
                <button type="button" (click)="retirer(l.niveau, a.rayon)" [attr.aria-label]="'Retirer l’anneau de ' + a.libelle"
                        class="inline-flex cursor-pointer border-0 bg-transparent p-[2px] text-tertiary">
                  <mg-icone nom="croix" [taille]="10" />
                </button>
              </span>
            }
          </div>

          <div class="flex flex-wrap items-center gap-1">
            @for (r of l.presets; track r.rayon) {
              <button type="button" (click)="ajouter(l.niveau, r.rayon)"
                      class="inline-flex cursor-pointer items-center gap-[3px] rounded-md border-fin border-dashed border-default bg-transparent px-[6px] py-[2px] font-mono text-[11px] text-tertiary">
                <mg-icone nom="plus" [taille]="9" />
                {{ r.libelle }}
              </button>
            }
            <input type="number" [min]="rayonMin" [max]="rayonMax" step="100" placeholder="m"
                   [attr.aria-label]="'Ajouter un anneau, de ' + rayonMin + ' à ' + rayonMax + ' mètres'"
                   (keydown.enter)="$event.preventDefault(); saisir(l.niveau, $event)" (blur)="saisir(l.niveau, $event)"
                   (keydown.escape)="abandonner($event)"
                   class="w-[58px] rounded-md border-fin border-subtle bg-elevated px-[6px] py-[2px] font-mono text-[11px] text-primary" />
          </div>
        }
      </div>
    }

    <label class="flex cursor-pointer items-center gap-2 text-[12px] text-secondary">
      <input type="checkbox" [checked]="profil().inclurePPRT" (change)="basculerPprt($event)" />
      Distinguer les périmètres PPRT
    </label>
    <p class="m-0 text-[11px] leading-[1.5] text-tertiary">
      {{ profil().inclurePPRT
        ? 'Un carreau couvert par une servitude publiée par l’État forme une classe à part, avant toute bande calculée — y compris au-delà du dernier anneau.'
        : 'Les servitudes publiées ne sont pas distinguées : chaque carreau prend la bande de sa distance. Les chiffres ne disent alors plus ce qui vient d’un arrêté et ce qui vient d’un rayon choisi.' }}
    </p>

    @if (erreur(); as e) {
      <p role="alert" class="m-0 text-[11px] text-danger">{{ e }}</p>
    }
  `,
})
export class PanneauProfilComponent {
  readonly profil = input.required<ProfilRayons>();
  /** Population par classe (`haut:1`…), pour dire ce que chaque anneau apporte. */
  readonly parClasse = input<Record<string, number>>({});
  /** Le profil NORMALISÉ, à chaque geste. */
  readonly profilChange = output<ProfilRayons>();

  protected readonly rayonMin = RAYON_MIN_M;
  protected readonly rayonMax = RAYON_MAX_M;
  protected readonly erreur = signal<string | null>(null);

  protected readonly lignes = computed(() => {
    const p = this.profil();
    const pops = this.parClasse();
    return NIVEAUX.map((niveau) => {
      const anneaux = anneauxDuNiveau(p, niveau);
      return {
        niveau,
        libelle: LIBELLE_NIVEAU[niveau],
        inactif: niveau === 'autres',
        anneaux: anneaux.map((rayon, i) => {
          const pop = pops[`${niveau}:${i + 1}`];
          return {
            rayon,
            classe: `${niveau}:${i + 1}`,
            libelle: libelleRayon(rayon),
            titre: pop === undefined ? null : `Bande ${i + 1} : ${formaterNombre(pop)} habitants`,
          };
        }),
        presets: PRESETS.filter((r) => !anneaux.includes(r)).map((rayon) => ({ rayon, libelle: libelleRayon(rayon) })),
      };
    });
  });

  /**
   * Applique une modification et NORMALISE. Le seul refus atteignable ici est le dépassement de quatre anneaux
   * (les bornes sont filtrées à la saisie) : message explicite plutôt qu'un geste sans effet.
   */
  protected appliquer(brut: Partial<ProfilRayons>): void {
    try {
      this.profilChange.emit(normaliserProfil({ ...this.profil(), ...brut }));
      this.erreur.set(null);
    } catch {
      this.erreur.set('Quatre anneaux au maximum par niveau.');
    }
  }

  protected retirer(niveau: Niveau, r: number): void {
    this.appliquer({ [niveau]: anneauxDuNiveau(this.profil(), niveau).filter((x) => x !== r) });
  }

  protected ajouter(niveau: Niveau, r: number): void {
    const actuels = anneauxDuNiveau(this.profil(), niveau);
    if (actuels.includes(r)) return;
    if (actuels.length >= ANNEAUX_MAX) {
      this.erreur.set('Quatre anneaux au maximum par niveau. Retirez-en un d’abord.');
      return;
    }
    this.appliquer({ [niveau]: [...actuels, r] });
  }

  /**
   * Saisie libre, en mètres (Entrée ou sortie du champ). Les bornes sont vérifiées ICI, comme le schéma de
   * React : une valeur hors bornes ou non entière est ignorée et reste dans le champ.
   */
  protected saisir(niveau: Niveau, ev: Event): void {
    const champ = ev.target as HTMLInputElement;
    if (champ.value === '') return;
    const n = Number(champ.value);
    if (!Number.isInteger(n) || n < RAYON_MIN_M || n > RAYON_MAX_M) return;
    this.ajouter(niveau, n);
    champ.value = '';
  }

  /**
   * Échap ABANDONNE la saisie en cours : le champ est vidé AVANT que le tiroir ne se referme (l'événement continue
   * de remonter jusqu'à lui). Sans ça, la sortie du champ causée par la fermeture validerait un anneau tapé mais
   * jamais confirmé — Échap aurait l'effet d'Entrée.
   */
  protected abandonner(ev: Event): void {
    (ev.target as HTMLInputElement).value = '';
  }

  protected basculerPprt(ev: Event): void {
    this.appliquer({ inclurePPRT: (ev.target as HTMLInputElement).checked });
  }
}
