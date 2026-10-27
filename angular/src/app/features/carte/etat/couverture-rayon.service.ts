import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { injecterTiroirsAnalyse } from './tiroirs-analyse';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CLE_TOUTES, RAYON_LECTURE_DEFAUT } from '../../risques/etapes/rayon/courbe-population.component';
import { JETONS_RAYON, entitesRayon, poserCoucheRayon, retirerCoucheRayon } from '../couches/couche-couverture-rayon';
import { CouvertureApi } from '../data/couverture.api';
import { messageErreurRequete } from '../logique/analyses/commun';
import { CIBLE_PAR_DEFAUT } from '../logique/analyses/couverture';
import {
  type LigneProfil, RAYON_MAX_DEFAUT_M, type ResultatCouvertureRayon, TYPE_ICPE, profilRayon, requeteRayon,
} from '../logique/analyses/couverture-rayon';
import { perimetreDeFiltre } from '../logique/zones/perimetre-recette';
import { MESSAGES_REFUS } from '../logique/zones/recette';
import { CataloguePoiService, typePoiRetenu } from './catalogue-poi.service';
import { CouchesCarteService, quandStyleCharge } from './couches-carte.service';
import { EtatCarteService } from './etat-carte.service';
import { LectureAnnulable, surChangement } from './lecture-annulable';
import { ZoneAnalyseeService } from './zone-analysee.service';

/**
 * ④ Analyse — l'état de « Couverture par rayon autour d'un type de POI » (lot 4, T12) et sa couche sur la carte.
 *
 * ── LE PÉRIMÈTRE ─────────────────────────────────────────────────────────
 * La zone analysée par défaut (`surZone`, patron du score de T10), sinon le filtre de ①. La borne est EN BASE
 * (`resoudre_perimetre` : France et région refusées, ≤ 12 000 km²) : l'écran ne refuse que l'absence de périmètre.
 * Une zone analysée introuvable (404) est retirée, comme pour la couverture d'une zone, et son message RESTE affiché :
 * le changement de périmètre qui s'ensuit annule sans effacer.
 *
 * ── UNE RÉPONSE QUITTÉE N'EST JAMAIS AFFICHÉE (P-c) ───────────────────────
 * Tout réglage modifié — type, rayon, champ, profil, cible, périmètre — change la requête, ce qui PÉRIME : la lecture
 * en vol est désabonnée (la requête HTTP annulée) et son jeton invalidé, le résultat et la couche retirés. Rien ne
 * repart seul.
 *
 * ── LA COUCHE (P-e) ──────────────────────────────────────────────────────
 * Fourni par le panneau Analyse, qui reste monté : la couche suit le résultat et le rayon lu sur la courbe, se re-pose
 * sur une carte recréée (B11) et se retire au nettoyage de son effet — donc à la destruction de ce service.
 */
@Injectable()
export class CouvertureRayonService {
  private readonly api = inject(CouvertureApi);
  private readonly etat = inject(EtatCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly analysee = inject(ZoneAnalyseeService);
  private readonly catalogue = inject(CataloguePoiService);
  private readonly palette = inject(CouleursService).palette(JETONS_RAYON);

  /** Les tiroirs de ④ (T7) : l'outil est ouvert quand SON tiroir l'est — ouvrir un autre outil le referme. */
  private readonly tiroirs = injecterTiroirsAnalyse();
  readonly ouvert = computed(() => this.tiroirs.estOuvert('rayon'));
  /**
   * Le catalogue des POI de ②, plus les sites ICPE (leur calque est à part) — ajoutés une fois le catalogue LU : avant,
   * ICPE seul serait retenu et resterait (`typePoiRetenu` garde l'ancien), le défaut dépendrait de l'ordre de navigation.
   */
  readonly types = computed(() => {
    const t = this.catalogue.types();
    return t.length === 0 || t.some((x) => x.id === TYPE_ICPE.id) ? t : [...t, TYPE_ICPE];
  });
  readonly categorie = typePoiRetenu(this.types);
  readonly rayonMax = signal(RAYON_MAX_DEFAUT_M);
  readonly champ = signal<string | null>(null);
  /** Sans champ : une ligne, `*` (le POI le plus proche). Avec : une ligne par valeur saisie. */
  readonly ligneTous = signal<LigneProfil>({ valeur: CLE_TOUTES, anneaux: '' });
  readonly lignesValeurs = signal<readonly LigneProfil[]>([]);
  readonly cible = signal(CIBLE_PAR_DEFAUT);

  readonly zoneAnalysee = this.analysee.zoneId;
  readonly surZone = signal(true);
  readonly perimetre = computed(() => {
    const zone = this.surZone() ? this.zoneAnalysee() : null;
    return zone ? { type: 'zone' as const, code: zone } : perimetreDeFiltre(this.etat.filtre());
  });
  readonly nomPerimetre = computed(() => (this.perimetre()?.type === 'zone' ? 'zone analysée' : this.etat.filtre()?.label ?? ''));
  private readonly lignes = computed(() => (this.champ() ? this.lignesValeurs() : [this.ligneTous()]));
  /** La requête des réglages courants ; `null` sans type de POI ou sans périmètre. */
  private readonly requete = computed(() => {
    const perimetre = this.perimetre();
    const categorie = this.categorie();
    if (!perimetre || !categorie) return null;
    return requeteRayon({ categorie, perimetre, cible: this.cible(), rayonMax: this.rayonMax(), champ: this.champ(), lignes: this.lignes() });
  });

  private readonly lecture = new LectureAnnulable<ResultatCouvertureRayon>(messageErreurRequete);
  readonly resultat = this.lecture.resultat.asReadonly();
  readonly enCours = this.lecture.enCours.asReadonly();
  readonly erreur = this.lecture.erreur.asReadonly();
  /** La zone analysée vient d'être retirée (404) : le changement de périmètre annule sans effacer le message. */
  private zoneRetiree = false;
  /** Le profil du calcul affiché : les bandes du tableau se lisent sur LUI, pas sur la saisie en cours. */
  readonly profilCalcule = signal<Record<string, number[]>>({});
  /** Le rayon lu sur la courbe : celui des cercles peints. */
  readonly rayon = signal(RAYON_LECTURE_DEFAUT);

  constructor() {
    this.couches.inscrireEffacement('couverture-rayon', () => this.lecture.perimer());
    surChangement(this.requete, () => {
      if (this.zoneRetiree) this.lecture.annuler();
      else this.lecture.perimer();
      this.zoneRetiree = false;
    });

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const r = this.resultat();
      if (!carte || !r) return;
      const donnees = entitesRayon(r.poi, this.rayon());
      // La palette en DERNIER, seulement avec un résultat : ouvrir la carte ne lit aucun jeton.
      const p = this.palette();
      const attente = quandStyleCharge(carte, () => poserCoucheRayon(carte, donnees, p));
      nettoyer(() => {
        attente();
        retirerCoucheRayon(carte);
      });
    });
  }

  /** Déplier lit le catalogue des types de POI de la page, une fois (`chargerUneFois` ne relit rien s'il l'a été). */
  basculerOuvert(): void {
    this.tiroirs.basculer('rayon');
    if (this.ouvert()) this.catalogue.chargerUneFois();
  }

  /** « Calculer » : un second appel annule le premier. Sans périmètre, la phrase des recettes, et aucune requête. */
  lancer(): void {
    const requete = this.requete();
    if (!requete) {
      this.lecture.refuser(this.perimetre() ? 'Choisissez un type de POI.' : MESSAGES_REFUS.perimetre_absent);
      return;
    }
    this.lecture.perimer();
    const profil = profilRayon({ champ: this.champ(), lignes: this.lignes() });
    this.lecture.lancer(this.api.rayon(requete), (r) => {
      this.profilCalcule.set(profil);
      this.rayon.set(Math.min(RAYON_LECTURE_DEFAUT, r.rayon_max_m));
    }, (e) => { this.zoneRetiree = this.analysee.siIntrouvable(e); });
  }
}
