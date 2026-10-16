import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { JeuxZonesApi } from '../../../risques/data/jeux-zones.api';
import { PARAM_RISQUE } from '../../../risques/etat/etat-risque.service';
import { risqueDuJeu } from '../../logique/entree-module-risque';

/** Une ligne de la liste, mise en forme une fois à la lecture (aucune méthode appelée dans le gabarit). */
interface LigneJeu {
  id: string;
  nom: string;
  version: number;
  detail: string;
}

/**
 * « Jeux de zones à risque » dans l'outil « Mes zones » de la boîte à outils (panneau Zones jusqu'au 2026-10-13) — portage de `app/map/_components/panneaux/JeuxDeZonesRail.tsx` et de
 * sa section dans `PanneauZones.tsx:138-151` (lot 4, T13).
 *
 * Un jeu de zones EST une zone : un périmètre nommé, enregistré, réutilisable. Le panneau Zones est l'endroit où l'on
 * cherche un périmètre qu'on a déjà, d'où cette entrée à côté de l'atelier qui les fabrique.
 *
 * Ce panneau MONTRE et OUVRE — rien d'autre, comme React : ni affichage des géométries ni suppression, deux gestes qui
 * vivent dans l'atelier avec le contexte qui les rend compréhensibles. Ouvrir navigue vers le module, route enfant de la
 * carte (`risques`, B2), à l'étape ④ sur ce jeu (`ouvrirJeuDeZones`, `page.tsx:232-240`).
 *
 * La liste est lue UNE fois, au montage — à la première ouverture de l'outil, qui est ensuite gardé (React :
 * `useEffect([], …)`, `cache: 'no-store'`).
 */
@Component({
  selector: 'mg-jeux-de-zones',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block border-b-fin border-subtle pt-3' },
  template: `
    <h4 class="mb-2 mt-0 px-4 text-[11px] font-medium tracking-[0.04em] text-secondary">Jeux de zones à risque</h4>
    @if (jeux(); as liste) {
      @if (liste.length === 0) {
        <p data-jeux-vide class="m-0 px-4 pb-3 text-[11.5px] leading-[1.6] text-tertiary">{{ echec() ? messageEchec : messageVide }}</p>
      } @else {
        <ul class="m-0 flex list-none flex-col gap-[5px] px-4 pb-3">
          @for (j of liste; track j.id) {
            <li>
              <button type="button" [attr.data-jeu]="j.id" (click)="ouvrir(j.id)" title="Ouvrir ce jeu dans l’atelier"
                      class="flex w-full cursor-pointer items-center gap-[9px] rounded-[6px] border-fin border-subtle bg-transparent px-[10px] py-2 text-left text-primary">
                <mg-icone nom="calques" [taille]="13" class="shrink-0 text-tertiary" />
                <span class="min-w-0 flex-1">
                  <span class="block text-[12px]">{{ j.nom }}<span class="ml-[7px] font-mono text-[10px] text-tertiary">v{{ j.version }}</span></span>
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

  protected readonly messageVide = 'Aucun jeu enregistré. Ils se fabriquent dans Calques, section Zones à '
    + 'risque industriel, bouton « Analyser la population à risque ».';
  protected readonly messageEchec = 'Liste indisponible pour le moment.';

  /** `null` pendant la lecture ; une liste vide après un échec, avec `echec` levé (React l.62-75). */
  protected readonly jeux = signal<LigneJeu[] | null>(null);
  protected readonly echec = signal(false);

  constructor() {
    const abonnement = inject(JeuxZonesApi).lister().subscribe({
      next: (r) => this.jeux.set((Array.isArray(r?.jeux) ? r.jeux : []).map((j) => ({
        id: j.id,
        nom: j.nom,
        version: j.version,
        detail: `${j.n_cp_retenus === null ? '—' : formaterNombre(j.n_cp_retenus)} CP`
          + (j.taux_utile !== null ? ` · ${formaterDecimal(Number(j.taux_utile))} % d’utile` : ''),
      }))),
      error: () => {
        this.jeux.set([]);
        this.echec.set(true);
      },
    });
    inject(DestroyRef).onDestroy(() => abonnement.unsubscribe());
  }

  /** L'URL du module est écrite PAR la navigation même : le module naît sur ④ et ce jeu, jamais sur l'étape par défaut. */
  protected ouvrir(id: string): void {
    // `merge` : l'étape du parcours (`etape`) suit dans l'URL du module ; le `risque` passé ici l'emporte sur l'ancien.
    void this.router.navigate(['risques'], {
      relativeTo: this.route,
      queryParams: { [PARAM_RISQUE]: risqueDuJeu(id) },
      queryParamsHandling: 'merge',
    });
  }
}
