import { DestroyRef, Injectable, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { RAYON_LECTURE_DEFAUT } from '../../risques/etapes/rayon/courbe-population.component';
import { JETONS_RAYON, entitesRayon, poserCoucheRayon, retirerCoucheRayon } from '../couches/couche-couverture-rayon';
import { CouvertureApi } from '../data/couverture.api';
import { messageErreurRequete } from '../logique/analyses/commun';
import { CIBLE_PAR_DEFAUT } from '../logique/analyses/couverture';
import {
  CLE_TOUS, type LigneProfil, RAYON_MAX_DEFAUT_M, type ResultatCouvertureRayon, TYPE_ICPE, profilRayon, requeteRayon,
} from '../logique/analyses/couverture-rayon';
import { perimetreDeFiltre } from '../logique/zones/perimetre-recette';
import { MESSAGES_REFUS } from '../logique/zones/recette';
import { CataloguePoiService } from './catalogue-poi.service';
import { CouchesCarteService, quandStyleCharge } from './couches-carte.service';
import { EtatCarteService } from './etat-carte.service';
import { ZoneAnalyseeService } from './zone-analysee.service';

/**
 * ④ Analyse — l'état de « Couverture par rayon autour d'un type de POI » (lot 4, T12) et sa couche sur la carte.
 *
 * ── LE PÉRIMÈTRE ─────────────────────────────────────────────────────────
 * La zone analysée par défaut (`surZone`, patron du score de T10), sinon le filtre de ①. La borne est EN BASE
 * (`resoudre_perimetre` : France et région refusées, ≤ 12 000 km²) : l'écran ne refuse que l'absence de périmètre.
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

  readonly ouvert = signal(false);
  /** Le catalogue des POI de ②, plus les sites ICPE (leur calque est à part). */
  readonly types = computed(() => {
    const t = this.catalogue.types();
    return t.some((x) => x.id === TYPE_ICPE.id) ? t : [...t, TYPE_ICPE];
  });
  /** Le premier type dès que le catalogue arrive ; gardé tant qu'il existe (patron de `recette-rayon-poi`). */
  readonly categorie = linkedSignal<readonly { id: string }[], string>({
    source: this.types,
    computation: (types, avant) => (avant && types.some((t) => t.id === avant.value) ? avant.value : types[0]?.id ?? ''),
  });
  readonly rayonMax = signal(RAYON_MAX_DEFAUT_M);
  readonly champ = signal<string | null>(null);
  /** Sans champ : une ligne, `*` (le POI le plus proche). Avec : une ligne par valeur saisie. */
  readonly ligneTous = signal<LigneProfil>({ valeur: CLE_TOUS, anneaux: '' });
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

  readonly resultat = signal<ResultatCouvertureRayon | null>(null);
  /** Le profil du calcul affiché : les bandes du tableau se lisent sur LUI, pas sur la saisie en cours. */
  readonly profilCalcule = signal<Record<string, number[]>>({});
  readonly enCours = signal(false);
  readonly erreur = signal<string | null>(null);
  /** Le rayon lu sur la courbe : celui des cercles peints. */
  readonly rayon = signal(RAYON_LECTURE_DEFAUT);

  private jeton = 0;
  private lecture: Subscription | null = null;

  constructor() {
    this.couches.inscrireEffacement('couverture-rayon', () => this.perimer());

    // P-a : l'effet ne fait que lire ; périmer écrit des signaux, hors suivi. La première valeur n'est pas un changement.
    let derniere = untracked(this.requete);
    effect(() => {
      const requete = this.requete();
      untracked(() => {
        if (requete === derniere) return;
        derniere = requete;
        this.perimer();
      });
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

    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      this.jeton++;
    });
  }

  /** Déplier lit le catalogue des types de POI de la page, une fois (`chargerUneFois` ne relit rien s'il l'a été). */
  basculerOuvert(): void {
    this.ouvert.update((o) => !o);
    if (this.ouvert()) this.catalogue.chargerUneFois();
  }

  /** « Calculer » : un second appel annule le premier. Sans périmètre, la phrase des recettes, et aucune requête. */
  lancer(): void {
    const requete = this.requete();
    this.perimer();
    if (!requete) {
      this.erreur.set(this.perimetre() ? 'Choisissez un type de POI.' : MESSAGES_REFUS.perimetre_absent);
      return;
    }
    const jeton = this.jeton;
    const profil = profilRayon({ champ: this.champ(), lignes: this.lignes() });
    this.enCours.set(true);
    this.lecture = this.api.rayon(requete).subscribe({
      next: (r) => {
        if (jeton !== this.jeton) return;
        this.lecture = null;
        this.profilCalcule.set(profil);
        this.rayon.set(Math.min(RAYON_LECTURE_DEFAUT, r.rayon_max_m));
        this.resultat.set(r);
        this.enCours.set(false);
      },
      error: (e: unknown) => {
        if (jeton !== this.jeton) return;
        this.lecture = null;
        this.enCours.set(false);
        this.erreur.set(messageErreurRequete(e));
      },
    });
  }

  /** Annule la lecture en vol, invalide son jeton, efface résultat, message et couche. */
  private perimer(): void {
    this.lecture?.unsubscribe();
    this.lecture = null;
    this.jeton++;
    this.resultat.set(null);
    this.erreur.set(null);
    this.enCours.set(false);
  }
}
