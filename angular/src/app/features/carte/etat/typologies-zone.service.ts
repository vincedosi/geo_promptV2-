import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { poserCoucheTypologies, retirerCoucheTypologies, surlignerTypologie } from '../couches/couche-typologies';
import { CouvertureApi } from '../data/couverture.api';
import { messageErreurCouverture } from '../logique/analyses/couverture-erreurs';
import { JETONS_TYPOLOGIES, type ResultatTypologies, cleModele, entitesTypologies } from '../logique/analyses/typologies';
import { publierAnalysePeinte } from './analyses-peintes';
import { CouchesCarteService, quandStyleCharge } from './couches-carte.service';
import { LectureAnnulable, surChangement } from './lecture-annulable';
import { injecterTiroirsAnalyse } from './tiroirs-analyse';
import { ZoneAnalyseeService } from './zone-analysee.service';

/**
 * ④ Analyse — les typologies DÉJÀ calculées des POI de la zone analysée (④ finitions, T8, A-7 ; Excel n° 34), pour tous :
 * `GET /api/zones/[id]/typologies`. Le calcul d'un modèle reste au super admin (`mg-section-clustering`, inchangé).
 *
 * ── UNE LECTURE PAR (ZONE, VERSION), AU DÉPLI ─────────────────────────────
 * Rien n'est lu à l'ouverture de ④ : la première lecture part au premier dépli du tiroir « Typologies ». Elle est faite
 * une fois par (zone, version) — la version est la date de mise à jour de la zone (`ZoneAnalyseeService.ligne`) : une
 * zone recalculée en ③ est relue, rouvrir le tiroir ne relit rien. Tiroir replié, un changement de zone ne lit rien.
 *
 * ── UNE RÉPONSE QUITTÉE N'EST JAMAIS AFFICHÉE (P-c) ───────────────────────
 * Changer de zone (ou de version) PÉRIME : la lecture en vol est désabonnée, le résultat et la couche retirés. Un 404
 * `zone_introuvable` retire la zone de ④ ; son message reste (le changement de zone qui s'ensuit annule sans effacer).
 *
 * ── LA COUCHE (P-e) ──────────────────────────────────────────────────────
 * Fourni par le panneau Analyse, qui reste monté : la couche suit le résultat, le modèle choisi et la typologie
 * survolée, se re-pose sur une carte recréée et se retire au nettoyage de son effet — à la destruction de ce service.
 */
@Injectable()
export class TypologiesZoneService {
  private readonly api = inject(CouvertureApi);
  private readonly couches = inject(CouchesCarteService);
  private readonly analysee = inject(ZoneAnalyseeService);
  private readonly palette = inject(CouleursService).palette(JETONS_TYPOLOGIES);

  private readonly tiroirs = injecterTiroirsAnalyse();
  readonly ouvert = computed(() => this.tiroirs.estOuvert('typologies'));
  readonly zoneId = this.analysee.zoneId;
  /** La clé de la lecture : zone et version ; `null` sans zone. */
  private readonly cle = computed(() => {
    const zone = this.zoneId();
    return zone ? `${zone}|${this.analysee.ligne()?.updated_at ?? ''}` : null;
  });
  /** La clé du résultat affiché (ou lu en vol) : la même clé ne se relit pas. */
  private cleLue: string | null = null;
  private zoneRetiree = false;

  private readonly lecture = new LectureAnnulable<ResultatTypologies>(messageErreurCouverture);
  readonly resultat = this.lecture.resultat.asReadonly();
  readonly enCours = this.lecture.enCours.asReadonly();
  readonly erreur = this.lecture.erreur.asReadonly();

  /** Le modèle (durée, mode) regardé : le premier par défaut. */
  readonly modeleChoisi = signal<string | null>(null);
  readonly modele = computed(() => {
    const modeles = this.resultat()?.modeles ?? [];
    return modeles.find((m) => cleModele(m) === this.modeleChoisi()) ?? modeles[0] ?? null;
  });
  /** La typologie survolée dans le tableau. */
  readonly survol = signal<number | null>(null);

  constructor() {
    this.couches.inscrireEffacement('couverture-typologies', () => this.oublier());
    publierAnalysePeinte(computed(() => (this.resultat()?.pois.length ?? 0) > 0));

    surChangement(this.cle, () => {
      if (this.zoneRetiree) this.lecture.annuler();
      else this.lecture.perimer();
      this.zoneRetiree = false;
      this.cleLue = null;
      this.modeleChoisi.set(null);
      this.survol.set(null);
    });
    // Tiroir ouvert et clé pas encore lue : UNE lecture (au dépli, ou pour une nouvelle zone pendant qu'il est ouvert).
    effect(() => {
      const cle = this.cle();
      const zone = this.zoneId();
      if (!this.ouvert() || !cle || !zone) return;
      untracked(() => this.lire(cle, zone));
    });

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const r = this.resultat();
      const m = this.modele();
      if (!carte || !r || !m) return;
      // La palette en DERNIER, seulement avec un résultat : ouvrir la carte ne lit aucun jeton.
      const p = this.palette();
      const donnees = entitesTypologies(r.pois, m, p);
      const attente = quandStyleCharge(carte, () => poserCoucheTypologies(carte, donnees, p.contour));
      nettoyer(() => {
        attente();
        retirerCoucheTypologies(carte);
      });
    });
    effect(() => {
      const carte = this.couches.carteCourante();
      const survol = this.survol();
      if (carte && this.modele()) surlignerTypologie(carte, survol);
    });
  }

  basculerOuvert(): void {
    this.tiroirs.basculer('typologies');
  }

  private lire(cle: string, zone: string): void {
    if (this.cleLue === cle) return;
    this.cleLue = cle;
    this.lecture.lancer(this.api.typologies(zone), undefined, (e) => {
      this.cleLue = null;
      this.zoneRetiree = this.analysee.siIntrouvable(e);
    });
  }

  /** « Tout effacer » : le résultat et la couche partent ; rouvrir le tiroir relira. */
  private oublier(): void {
    this.lecture.perimer();
    this.cleLue = null;
  }
}
