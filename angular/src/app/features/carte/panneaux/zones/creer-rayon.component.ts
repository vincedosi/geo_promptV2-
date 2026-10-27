import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import type { Subscription } from 'rxjs';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { poserApercuRayon, retirerApercuRayon } from '../../couches/apercu-rayon';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { CouchesCarteService, quandStyleCharge } from '../../etat/couches-carte.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { messageZoneRayon } from '../../logique/zones/creation-zone';
import {
  type Centre, PAS_RAYON_M, RAYON_DEFAUT_M, RAYON_MAX_M, RAYON_MIN_M, cercleApercu, corpsRayon, libelleRayon, nomRayonParDefaut,
} from '../../logique/zones/rayon';
import { OutilCreationComponent } from './outil-creation.component';

/** L'identifiant sous lequel la pose du centre PREND la carte (`EtatCarteService.prendreCarte`). */
const OUTIL = 'rayon';

/**
 * « Zone par rayon » — `app/map/_components/panneaux/CreerZoneRayon.tsx` (lot 4, T16) : un clic sur la carte pose le
 * centre, le curseur règle le rayon (500 m à 100 km), l'aperçu du cercle se dessine LOCALEMENT (aucune requête par
 * pixel de curseur). La géométrie enregistrée vient du serveur, clippée sur le territoire : la part retenue
 * (`part_retenue`) est dite dans le message de création dès qu'elle passe sous 98 %.
 *
 * Défaut de React corrigé : le clic de pose, hors du panneau, FERMAIT le panneau Zones (`OverlayPanel`), et l'outil
 * disparaissait avec son centre — la zone par rayon ne pouvait pas être créée. Pendant la pose, la carte est prise
 * (`prendreCarte`) : le clic pose le centre et le panneau reste ouvert.
 */
@Component({
  selector: 'mg-creer-rayon',
  imports: [OutilCreationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-outil-creation
      titre="Zone par rayon"
      [ouvert]="ouvert()"
      [(nom)]="nom"
      [enCours]="enCours()"
      [inactif]="inactif()"
      [erreur]="erreur()"
      [message]="message()"
      (basculer)="basculer($event)"
      (creer)="creer()"
    >
      <button
        type="button"
        data-poser
        class="w-full cursor-pointer rounded-[6px] border-fin px-[10px] py-[7px] text-[11px]"
        [class]="enPose() ? 'border-teal bg-teal-10 text-teal' : 'border-default bg-transparent text-secondary'"
        (click)="basculerPose()"
      >{{ libellePose() }}</button>

      @if (texteCentre(); as c) {
        <div data-centre class="font-mono text-[10px] text-tertiary">{{ c }}</div>
      }

      <div>
        <div class="flex items-center gap-2">
          <input
            type="range"
            class="flex-1 accent-[var(--brand-teal)]"
            [min]="min"
            [max]="max"
            [step]="pas"
            [value]="rayonM()"
            (input)="rayonM.set(+$any($event.target).value)"
          />
          <span data-rayon class="w-14 text-right font-mono text-[11px] text-secondary">{{ libelle() }}</span>
        </div>
        <div class="mt-1 text-[10px] leading-[1.5] text-tertiary">
          L’aperçu montre le cercle entier. La zone enregistrée est clippée sur le
          territoire — un centre proche de la côte en perd une partie.
        </div>
      </div>
    </mg-outil-creation>
  `,
})
export class CreerRayonComponent {
  private readonly api = inject(ZonesCustomApi);
  private readonly creation = inject(CreationZoneService);
  private readonly couches = inject(CouchesCarteService);
  private readonly etat = inject(EtatCarteService);
  private readonly couleurs = inject(CouleursService).palette({ teal: 'brand-teal' });

  readonly cree = output<void>();
  /**
   * Sa famille de ③ est repliée (tiroirs exclusifs, retours du 26/10, T7) : le composant reste MONTÉ — centre, rayon,
   * nom et création en vol survivent — mais la pose s'arrête (carte rendue) et l'aperçu se retire ; il revient à la
   * réouverture.
   */
  readonly enPause = input(false);

  protected readonly min = RAYON_MIN_M;
  protected readonly max = RAYON_MAX_M;
  protected readonly pas = PAS_RAYON_M;
  protected readonly ouvert = signal(false);
  protected readonly enPose = signal(false);
  protected readonly centre = signal<Centre | null>(null);
  protected readonly rayonM = signal(RAYON_DEFAUT_M);
  protected readonly nom = signal('');
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);

  protected readonly texteCentre = computed(() => {
    const c = this.centre();
    return c ? `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}` : null;
  });
  protected readonly libelle = computed(() => libelleRayon(this.rayonM()));
  protected readonly libellePose = computed(() =>
    this.enPose() ? 'Cliquez sur la carte…' : this.centre() ? 'Déplacer le centre' : 'Poser le centre sur la carte');
  protected readonly inactif = computed(() => this.enCours() || !this.centre() || !this.creation.org());

  private abonnement: Subscription | null = null;

  constructor() {
    // Le clic de pose : écouté tant que la carte existe, et lu seulement en pose (comme React, `enPoseRef`) — une
    // écoute posée par un effet À l'entrée en pose manquerait un clic arrivé avant lui.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (carte) nettoyer(this.ecouterPose(carte));
    });
    // Le viseur, pendant la pose.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte || !this.enPose()) return;
      const canevas = carte.getCanvas();
      canevas.style.cursor = 'crosshair';
      // Le viseur reste si le dessin tient encore la carte.
      nettoyer(() => {
        if (!this.etat.carteOccupee()) canevas.style.cursor = '';
      });
    });

    // En pause (famille repliée) : la pose s'arrête, la carte est rendue. Rien d'autre n'est touché.
    effect(() => {
      if (this.enPause()) untracked(() => this.arreterPose());
    });

    // L'aperçu : posé tant que l'outil est ouvert (hors pause) avec un centre, redessiné à chaque rayon et au thème.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const centre = this.centre();
      if (!carte || !this.ouvert() || this.enPause() || !centre) return;
      const cercle = cercleApercu(centre.lon, centre.lat, this.rayonM());
      const teal = this.couleurs().teal;
      const attente = quandStyleCharge(carte, () => poserApercuRayon(carte, cercle, teal));
      nettoyer(() => {
        attente();
        retirerApercuRayon(carte);
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.abonnement?.unsubscribe();
      this.etat.rendreCarte(OUTIL);
    });
  }

  protected basculer(ouvert: boolean): void {
    this.ouvert.set(ouvert);
    if (!ouvert) this.arreterPose();
  }

  /**
   * « Poser le centre » / « Cliquez sur la carte… ». La carte est prise DANS le geste, pas dans un effet : un effet
   * passe après le rendu, et un clic sur la carte arrivé avant lui fermait encore le panneau (constaté au navigateur).
   */
  protected basculerPose(): void {
    if (this.enPose()) {
      this.arreterPose();
      return;
    }
    this.enPose.set(true);
    this.etat.prendreCarte(OUTIL);
  }

  private arreterPose(): void {
    this.enPose.set(false);
    this.etat.rendreCarte(OUTIL);
  }

  protected creer(): void {
    const centre = this.centre();
    if (this.inactif() || !centre) return;
    const corps = corpsRayon(centre, this.rayonM());
    const nom = this.nom();
    this.enCours.set(true);
    this.erreur.set(null);
    this.message.set(null);
    this.abonnement = this.creation.creer(
      this.api.depuisRayon(corps),
      () => nom || nomRayonParDefaut(corps.rayon_m),
      () => ({ v: 1, type: 'rayon_point', lon: corps.lon, lat: corps.lat, rayon_m: corps.rayon_m }),
    ).subscribe((issue) => {
      this.enCours.set(false);
      if ('erreur' in issue) {
        this.erreur.set(issue.erreur);
        return;
      }
      this.message.set(messageZoneRayon(issue.geo, issue.countCp, issue.avertissement));
      this.centre.set(null);
      this.nom.set('');
      this.cree.emit();
    });
  }

  /** Le clic de pose sur une instance : il devient le centre, en pose seulement ; rend de quoi retirer l'écoute. */
  private ecouterPose(carte: maplibregl.Map): () => void {
    const clic = (e: maplibregl.MapMouseEvent) => {
      // En pose ET maître des clics : si le dessin a repris la carte, ce clic est un sommet, pas un centre.
      if (!this.enPose() || this.etat.outilCarte() !== OUTIL) return;
      this.centre.set({ lon: e.lngLat.lng, lat: e.lngLat.lat });
      this.arreterPose();
    };
    carte.on('click', clic);
    return () => carte.off('click', clic);
  }
}
