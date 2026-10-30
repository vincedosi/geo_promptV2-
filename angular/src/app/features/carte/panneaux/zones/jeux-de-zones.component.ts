import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { type JeuListe, JeuxApi } from '../../data/jeux.api';
import { ouvrirJeuListe } from '../../etat/ouvrir-jeu';

/** Une ligne de la liste, mise en forme une fois à la lecture (aucune méthode appelée dans le gabarit). */
interface LigneJeu {
  id: string;
  type: JeuListe['type'];
  nom: string;
  version: number;
  detail: string;
}

/** Le badge neutre du type : un jeu risque s'ouvre dans le module, un jeu de zone à l'étape ⑤. */
export const BADGE_TYPE_JEU: Readonly<Record<JeuListe['type'], string>> = { risque: 'Risque', zone: 'Zone' };

/** Le détail d'une ligne : CP retenus et taux d'utile d'un jeu risque, la zone d'un jeu de zone. */
export function detailJeu(j: JeuListe): string {
  if (j.type === 'zone') return j.zone_nom ?? 'zone supprimée';
  return `${j.n_cp_retenus === null ? '—' : formaterNombre(j.n_cp_retenus)} CP`
    + (j.taux_utile !== null ? ` · ${formaterDecimal(Number(j.taux_utile))} % d’utile` : '');
}

/**
 * « Jeux de zones » dans l'outil « Mes zones » de la boîte à outils (panneau Zones jusqu'au 2026-10-13) — portage de `app/map/_components/panneaux/JeuxDeZonesRail.tsx` et de
 * sa section dans `PanneauZones.tsx:138-151` (lot 4, T13).
 *
 * Un jeu de zones EST une zone : un périmètre nommé, enregistré, réutilisable. Le panneau Zones est l'endroit où l'on
 * cherche un périmètre qu'on a déjà, d'où cette entrée à côté de l'atelier qui les fabrique.
 *
 * Ce panneau MONTRE et OUVRE — rien d'autre, comme React : ni affichage des géométries ni suppression, deux gestes qui
 * vivent dans l'atelier (ou la bibliothèque de ⑤) avec le contexte qui les rend compréhensibles. Depuis le lot 5 (T12),
 * les DEUX types : un jeu risque ouvre le module à l'étape ④ sur ce jeu (`ouvrirJeuDeZones`, `page.tsx:232-240`), un
 * jeu de zone ouvre ⑤ sur `?jeu=` (`ouvrirJeuListe`, règle partagée avec la bibliothèque de ⑤).
 *
 * La liste est lue au montage — à la première ouverture de l'outil, qui est ensuite gardé (React :
 * `useEffect([], …)`, `cache: 'no-store'`). Elle est relue quand `revision` a monté (un jeu enregistré ou réglé en ⑤,
 * `OutilsCarteService.revisionJeux`), au PROCHAIN affichage du tiroir (`visible`) : aucune lecture d'ici là (E5,
 * ⑤ finitions T5 — elle restait figée jusqu'au rechargement).
 */
@Component({
  selector: 'mg-jeux-de-zones',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block border-b-fin border-subtle pt-3' },
  template: `
    <h4 class="mb-2 mt-0 px-4 text-[11px] font-medium tracking-[0.04em] text-secondary">Jeux de zones</h4>
    @if (jeux(); as liste) {
      @if (liste.length === 0) {
        <p data-jeux-vide class="m-0 px-4 pb-3 text-[11.5px] leading-[1.6] text-tertiary">{{ echec() ? messageEchec : messageVide }}</p>
      } @else {
        <ul class="m-0 flex list-none flex-col gap-[5px] px-4 pb-3">
          @for (j of liste; track j.id) {
            <li>
              <button type="button" [attr.data-jeu]="j.id" (click)="ouvrir(j)" [title]="j.type === 'risque' ? 'Ouvrir ce jeu dans l’atelier' : 'Ouvrir ce jeu à l’étape ⑤'"
                      class="flex w-full cursor-pointer items-center gap-[9px] rounded-[6px] border-fin border-subtle bg-transparent px-[10px] py-2 text-left text-primary">
                <mg-icone nom="calques" [taille]="13" class="shrink-0 text-tertiary" />
                <span class="min-w-0 flex-1">
                  <span class="block text-[12px]">{{ j.nom }}<span class="ml-[7px] font-mono text-[10px] text-tertiary">v{{ j.version }}</span><span data-type-jeu class="ml-[7px] rounded-[4px] border-fin border-default bg-overlay px-1.5 py-px text-[10px] text-tertiary">{{ badge[j.type] }}</span></span>
                  <span class="mt-0.5 block font-mono text-[10px] text-tertiary">{{ j.detail }}</span>
                </span>
              </button>
            </li>
          }
        </ul>
      }
    } @else {
      <div data-jeux-lecture class="flex items-center gap-[7px] px-4 pb-[10px] pt-1">
        <mg-icone nom="chargement" [taille]="12" class="animate-spin text-teal" />
        <span class="text-[11.5px] text-tertiary">Lecture des jeux de zones…</span>
      </div>
    }
  `,
})
export class JeuxDeZonesComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly messageVide = 'Aucun jeu enregistré. Ils se fabriquent à l’étape ⑤, ou dans Calques, section Zones à '
    + 'risque industriel, bouton « Analyser la population à risque ».';
  protected readonly badge = BADGE_TYPE_JEU;
  protected readonly messageEchec = 'Liste indisponible pour le moment.';

  /** `null` pendant la lecture ; une liste vide après un échec, avec `echec` levé (React l.62-75). */
  protected readonly jeux = signal<LigneJeu[] | null>(null);
  protected readonly echec = signal(false);

  /** Monte quand la liste est périmée (`OutilsCarteService.revisionJeux`). */
  readonly revision = input(0);
  /** Le tiroir qui porte la liste est ouvert : une liste périmée ne se relit qu'à ce moment-là. */
  readonly visible = input(true);

  private readonly api = inject(JeuxApi);
  private abonnement: Subscription | null = null;

  constructor() {
    this.lire();
    // P-a : l'effet ne fait que lire ; la lecture part hors suivi, une fois par révision vue. La première valeur (les
    // entrées ne sont posées qu'après le constructeur) est celle de la lecture du montage.
    let vue: number | null = null;
    effect(() => {
      const revision = this.revision();
      const visible = this.visible();
      untracked(() => {
        if (vue === null) vue = revision;
        if (!visible || revision === vue) return;
        vue = revision;
        this.lire();
      });
    });
    inject(DestroyRef).onDestroy(() => this.abonnement?.unsubscribe());
  }

  private lire(): void {
    this.abonnement?.unsubscribe();
    this.abonnement = this.api.lister().subscribe({
      next: (r) => {
        this.echec.set(false);
        this.jeux.set((Array.isArray(r?.jeux) ? r.jeux : []).map((j) => ({
          id: j.id, type: j.type, nom: j.nom, version: j.version, detail: detailJeu(j),
        })));
      },
      error: () => {
        this.jeux.set([]);
        this.echec.set(true);
      },
    });
  }

  /** Selon le type : le module risque (né sur ④ et ce jeu), ou ⑤ sur `?jeu=`. */
  protected ouvrir(j: LigneJeu): void {
    void ouvrirJeuListe(this.router, this.route, j);
  }
}
