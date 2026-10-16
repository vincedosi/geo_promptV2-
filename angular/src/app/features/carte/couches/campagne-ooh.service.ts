import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi } from '../data/carte.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import {
  type CampagneOohResume, type DetailCampagneOoh, type EmplacementOoh, JETONS_CAMPAGNE_OOH, collectionCarte, emprise, rangsDesLignes,
} from '../logique/campagnes-ooh';
import { messageHttp } from '../logique/zones/zones-affichees';
import { ecouterCampagneOoh, poserCoucheCampagneOoh, retirerCoucheCampagneOoh } from './couche-campagne-ooh';
import { PoisService } from './pois.service';

/** Le recadrage sur l'emprise d'une campagne (métropole : les DROM n'ont pas de points). */
const RECADRAGE = { padding: 50, duration: 800, maxZoom: 14 } as const;

/**
 * La campagne OOH affichée sur la carte principale (spec 2026-10-16-ooh-campagnes § 6) : la liste des campagnes de
 * l'espace, la campagne choisie, les lignes masquées, l'emplacement ouvert dans la fiche — et la couche DÉDIÉE qui
 * les peint (`couche-campagne-ooh.ts`, patron de « Mes zones »).
 *
 * ── UNE RÉCONCILIATION ───────────────────────────────────────────────────
 * Un `effect` rend la carte conforme à (campagne, lignes masquées, palette) : il pose, met à jour ou retire. Il couvre
 * d'un même geste le choix, le masquage d'une ligne, le changement de thème (repeinture) et la carte recréée par un
 * changement de fond.
 *
 * ── CHANGER D'ESPACE ─────────────────────────────────────────────────────
 * `@Injectable()` sans `providedIn` : fourni par `CartePage`, que `CarteHoteComponent` RECRÉE à chaque changement
 * d'espace. L'état meurt avec la page et les lectures en vol sont désabonnées : une réponse de l'ancien espace
 * n'atteint jamais le nouveau. « Tout effacer » (`inscrireEffacement`) ferme la campagne et retire la couche ; une
 * lecture encore en vol est abandonnée, sa réponse ne peint rien — de même au choix d'une autre campagne.
 *
 * I/O : la liste n'est lue qu'à l'ouverture de la section (une fois par page) ; une campagne, à son choix.
 */
@Injectable()
export class CampagneOohService {
  private readonly api = inject(CarteApi);
  private readonly couches = inject(CouchesCarteService);
  private readonly pois = inject(PoisService);
  private readonly palette = inject(CouleursService).palette(JETONS_CAMPAGNE_OOH);

  /** `null` tant que la liste n'a pas été lue. */
  readonly campagnes = signal<readonly CampagneOohResume[] | null>(null);
  readonly listeTronquee = signal(false);
  readonly chargementListe = signal(false);
  readonly erreurListe = signal<string | null>(null);
  readonly detail = signal<DetailCampagneOoh | null>(null);
  readonly chargementDetail = signal(false);
  readonly erreurDetail = signal<string | null>(null);
  /** Les lignes dont les points sont masqués. */
  readonly masquees = signal<ReadonlySet<string>>(new Set());
  /** L'emplacement ouvert dans la fiche. */
  readonly emplacementSelectionne = signal<EmplacementOoh | null>(null);
  /** Le rang de teinte (1-8) de chaque ligne qui a des emplacements. */
  readonly rangs = computed(() => rangsDesLignes(this.detail()?.lignes ?? []));

  private lectureListe: Subscription | null = null;
  private lectureDetail: Subscription | null = null;

  constructor() {
    this.couches.inscrireEffacement('campagne-ooh', () => this.fermer());

    // La carte, PUIS la campagne, et la palette en dernier : un jeton n'est lu que si une campagne est affichée
    // (pré-vol P1, patron de `radio.service.ts`). Sans feuille de style — les specs de la page — `palette` lève.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) return;
      const detail = this.detail();
      if (!detail) {
        nettoyer(quandStyleCharge(carte, () => untracked(() => retirerCoucheCampagneOoh(carte))));
        return;
      }
      const donnees = collectionCarte(detail, this.rangs(), this.masquees());
      const p = this.palette();
      const peinture = { lignes: [p.l1, p.l2, p.l3, p.l4, p.l5, p.l6, p.l7, p.l8], contour: p.contour };
      nettoyer(quandStyleCharge(carte, () => untracked(() => poserCoucheCampagneOoh(carte, donnees, peinture))));
    });

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) return;
      nettoyer(ecouterCampagneOoh(carte, (id) => this.selectionner(id)));
    });

    // Le tiroir Street View des POI et la fiche d'un emplacement occupent la même place : l'un ferme l'autre.
    effect(() => {
      if (this.pois.panneauSelectionne() !== null) untracked(() => this.emplacementSelectionne.set(null));
    });

    inject(DestroyRef).onDestroy(() => {
      this.lectureListe?.unsubscribe();
      this.lectureDetail?.unsubscribe();
    });
  }

  /** Lit la liste UNE fois par page ; après un échec, un nouvel appel relit. */
  lireCampagnes(): void {
    if (this.campagnes() !== null || this.lectureListe !== null) return;
    this.chargementListe.set(true);
    this.erreurListe.set(null);
    const lecture = this.api.campagnesOoh().subscribe({
      next: (r) => {
        this.lectureListe = null;
        this.chargementListe.set(false);
        this.listeTronquee.set(r.tronque);
        this.campagnes.set(r.campagnes);
      },
      error: (e: unknown) => {
        this.lectureListe = null;
        this.chargementListe.set(false);
        this.erreurListe.set(messageHttp(e, 'Lecture des campagnes impossible'));
      },
    });
    if (!lecture.closed) this.lectureListe = lecture;
  }

  /** Lit une campagne et l'affiche ; une lecture précédente encore en vol est abandonnée. */
  choisir(id: string): void {
    if (this.detail()?.campagne.id === id) return;
    this.lectureDetail?.unsubscribe();
    this.lectureDetail = null;
    this.emplacementSelectionne.set(null);
    this.erreurDetail.set(null);
    this.chargementDetail.set(true);
    const lecture = this.api.campagneOoh(id).subscribe({
      next: (d) => {
        this.lectureDetail = null;
        this.chargementDetail.set(false);
        this.masquees.set(new Set());
        this.detail.set(d);
        const b = emprise(d.emplacements);
        if (b) this.couches.carteCourante()?.fitBounds([[b[0], b[1]], [b[2], b[3]]], RECADRAGE);
      },
      error: (e: unknown) => {
        this.lectureDetail = null;
        this.chargementDetail.set(false);
        this.erreurDetail.set(messageHttp(e, 'Lecture de la campagne impossible'));
      },
    });
    if (!lecture.closed) this.lectureDetail = lecture;
  }

  /** Affiche ou masque les points d'une ligne ; masquer la ligne de l'emplacement ouvert ferme sa fiche. */
  basculerLigne(id: string): void {
    this.masquees.update((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    const choisi = this.emplacementSelectionne();
    if (choisi && this.masquees().has(choisi.properties.ligne_id)) this.emplacementSelectionne.set(null);
  }

  /** Ouvre la fiche d'un emplacement (clic sur la carte) ; ferme le tiroir Street View des POI. */
  selectionner(id: string): void {
    const e = this.detail()?.emplacements.find((x) => x.properties.id === id) ?? null;
    if (e) this.pois.panneauSelectionne.set(null);
    this.emplacementSelectionne.set(e);
  }

  /** Retour à la liste, « Tout effacer » : plus de campagne, ni sur la carte ni en lecture. La liste reste. */
  fermer(): void {
    this.lectureDetail?.unsubscribe();
    this.lectureDetail = null;
    this.chargementDetail.set(false);
    this.erreurDetail.set(null);
    this.emplacementSelectionne.set(null);
    this.masquees.set(new Set());
    this.detail.set(null);
  }
}
