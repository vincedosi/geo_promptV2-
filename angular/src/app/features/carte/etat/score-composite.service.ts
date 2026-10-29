import { Injectable, computed, inject, signal } from '@angular/core';
import { injecterTiroirsAnalyse } from './tiroirs-analyse';
import { catchError, throwError } from 'rxjs';
import { formaterNombre } from '../../../core/format/nombre';
import { ScoreService } from '../couches/score.service';
import { AnalysesApi } from '../data/analyses.api';
import { messageErreurRequete } from '../logique/analyses/commun';
import {
  type IndicateurChoisi, type IndicateurRegistre, type ResultatScore, ajouterIndicateur, compteAuDessus, corpsScore, libelleScore,
  messageZoneScore, nomZoneScore, parametresIndicateurs,
} from '../logique/analyses/score';
import { CatalogueIndicateursService } from './catalogue-indicateurs.service';
import { CreationZoneService } from './creation-zone.service';
import { EtatCarteService } from './etat-carte.service';
import { LectureAnnulable, surChangement } from './lecture-annulable';
import { ZoneAnalyseeService } from './zone-analysee.service';

/**
 * L'état de l'outil « Score composite » — `ScoreCompositeTool.tsx` (lot 4, T18), hors de son gabarit : le LANCEMENT
 * est appelé par le panneau Analyse, après sa garde de périmètre (verrou `panneau-analyse-garde.test.ts`) ; l'outil
 * n'émet qu'une demande. Les calculs sont dans `logique/analyses/score.ts`.
 *
 * ── PÉRIMER ──────────────────────────────────────────────────────────────
 * Tout réglage modifié (indicateur ajouté ou retiré, poids, sens) retire le résultat ET éteint la carte : sans cela,
 * l'écran annonçait « 42 codes postaux retenus » calculés avec les ANCIENS poids pendant que « Créer la zone »
 * envoyait les NOUVEAUX (`perimerResultat`, relecture du 2026-09-13).
 *
 * ── ENREGISTRER : OPT-IN ─────────────────────────────────────────────────
 * Décoché par défaut : l'outil se relance à chaque essai, et la liste « Mes analyses » est bornée à 50.
 *
 * ── SUR LA ZONE ANALYSÉE (lot 4, T10) ────────────────────────────────────
 * Quand ④ analyse une zone, le score s'y applique par défaut (`surZone`, bascule vers le périmètre de ①) : la route lit
 * déjà `{ type: 'zone' }`, et une zone suffit comme périmètre. Changer de zone — ou basculer — PÉRIME le résultat
 * (même geste que `perimer`) : le calcul en vol est annulé, sa réponse ne revient pas peindre la carte (P-c).
 *
 * `@Injectable()` sans `providedIn` : fourni par le panneau Analyse — fermer le panneau perd les réglages, comme
 * React ; la carte, elle, garde le score peint (`ScoreService`, à la page). Un calcul EN VOL à la fermeture est ANNULÉ
 * (`LectureAnnulable`, désabonnée au `DestroyRef`) : sa réponse ne peint jamais la carte d'un panneau fermé (ruling T12).
 */
@Injectable()
export class ScoreCompositeService {
  private readonly api = inject(AnalysesApi);
  private readonly etat = inject(EtatCarteService);
  private readonly carte = inject(ScoreService);
  private readonly catalogueService = inject(CatalogueIndicateursService);
  private readonly creation = inject(CreationZoneService);
  private readonly analysee = inject(ZoneAnalyseeService);

  /** Les tiroirs de ④ (T7) : l'outil est ouvert quand SON tiroir l'est — ouvrir un autre outil le referme. */
  private readonly tiroirs = injecterTiroirsAnalyse();
  readonly ouvert = computed(() => this.tiroirs.estOuvert('score'));
  readonly catalogue = signal<IndicateurRegistre[]>([]);
  readonly chargementCatalogue = signal(false);
  private catalogueLu = false;

  readonly choisis = signal<IndicateurChoisi[]>([]);
  readonly enregistrer = signal(false);
  /** Le calcul : un réglage modifié l'ANNULE, sans quoi l'ancien résultat reviendrait repeindre la carte. */
  private readonly lecture = new LectureAnnulable<ResultatScore>(messageErreurRequete);
  readonly calcul = this.lecture.enCours;
  readonly resultat = this.lecture.resultat;
  readonly erreur = this.lecture.erreur;

  readonly seuil = signal(70);
  readonly creationZone = signal(false);
  readonly messageZone = signal<string | null>(null);
  /** L'organisation active : sans elle, « Créer la zone » reste inactif (`!orgId`). */
  readonly org = this.creation.org;

  /** La zone analysée de ④, ou `null` : la bascule « Sur : » n'a de sens qu'avec elle. */
  readonly zoneAnalysee = this.analysee.zoneId;
  /** « Sur : la zone analysée » (défaut) ou « le périmètre de ① ». */
  readonly surZone = signal(true);
  /** La zone sur laquelle le score part, ou `null` : le périmètre de ①. */
  readonly zoneScore = computed(() => (this.surZone() ? this.zoneAnalysee() : null));

  readonly disponibles = computed(() => this.catalogue().filter((i) => !this.choisis().some((c) => c.code === i.indicator_code)));
  readonly auDessusDuSeuil = computed(() => compteAuDessus(this.resultat()?.scores ?? [], this.seuil()));

  constructor() {
    surChangement(this.zoneScore, () => this.perimer());
  }

  /** Déplier charge le catalogue la PREMIÈRE fois ; un échec laisse le dépliage suivant relire. */
  basculerOuvert(): void {
    this.tiroirs.basculer('score');
    const prochain = this.ouvert();
    if (!prochain || this.catalogueLu) return;
    this.catalogueLu = true;
    this.chargementCatalogue.set(true);
    this.catalogueService.charger().subscribe({
      next: (liste) => this.catalogue.set(liste),
      error: () => {
        this.erreur.set('Catalogue d’indicateurs indisponible.');
        this.catalogueLu = false;
        this.chargementCatalogue.set(false);
      },
      complete: () => this.chargementCatalogue.set(false),
    });
  }

  ajouter(code: string): void {
    const suivants = ajouterIndicateur(this.choisis(), this.catalogue(), code);
    if (!suivants) return;
    this.choisis.set(suivants);
    this.perimer();
  }

  retirer(code: string): void {
    this.choisis.update((l) => l.filter((c) => c.code !== code));
    this.perimer();
  }

  modifier(code: string, champ: Partial<Pick<IndicateurChoisi, 'poids' | 'sens'>>): void {
    this.choisis.update((l) => l.map((c) => (c.code === code ? { ...c, ...champ } : c)));
    this.perimer();
  }

  /** Appelé par le panneau APRÈS sa garde de périmètre — jamais par l'outil lui-même. */
  lancer(): void {
    const filtre = this.etat.filtre();
    const choisis = this.choisis();
    const zone = this.zoneScore();
    const perimetre = zone ? { zone } : filtre ? { filtre } : null;
    if (!choisis.length || this.calcul() || !perimetre) return;
    this.messageZone.set(null);
    this.lecture.lancer(this.api.score(corpsScore(choisis, perimetre, this.enregistrer())), (r) => {
      this.carte.afficher({ scores: r.scores, libelle: libelleScore(choisis.map((c) => c.label)), nIndicateurs: choisis.length });
    });
  }

  /**
   * « Créer la zone » : la route sœur RECALCULE le score au-dessus du seuil (elle ne croit pas une liste de CP remontée
   * par le client), puis `POST /api/zones` ÉCRIT la zone avec la recette figée `{ type: 'capture', source_type: 'score' }`
   * et sa géométrie — le geste commun des créations (`CreationZoneService`, lot 3). ③ finitions (T5, V-6, A-6) : la
   * recette garde sa PROVENANCE (`parametres` : indicateurs, poids, sens, maille, seuil), sans devenir recalculable.
   */
  creerZone(): void {
    const resultat = this.resultat();
    if (!resultat || this.creationZone() || !this.org()) return;
    const choisis = this.choisis();
    const seuil = this.seuil();
    const indicateurs = parametresIndicateurs(choisis);
    this.creationZone.set(true);
    this.messageZone.set(null);
    // Le refus de la route source est traduit ICI dans les mots de React (`messageZoneScore`), puis rendu sous la
    // forme que `CreationZoneService` relaie telle quelle (`{ error: { message } }`).
    const source = this.api.zoneDepuisScore({ indicateurs, codes_postaux: resultat.scores.map((s) => s.code), seuil }).pipe(
      catchError((e: { status?: number; error?: unknown }) => throwError(() => ({ status: e.status, error: { message: messageZoneScore(e) } }))),
    );
    // La recette d'une forme figée (lot 3, `capture` de source `score`) : sa géométrie part avec elle.
    const parametres = { indicateurs, maille: 'cp', seuil_score: seuil } as const;
    this.creation.creer(source, () => nomZoneScore(seuil, choisis), () => ({ v: 1, type: 'capture', source_type: 'score', parametres })).subscribe((issue) => {
      this.messageZone.set('erreur' in issue ? issue.erreur : `Zone créée — ${formaterNombre(issue.geo.count)} codes postaux.`);
      this.creationZone.set(false);
    });
  }

  /** Le message d'erreur reste : seul le résultat est retiré. */
  private perimer(): void {
    this.lecture.annuler();
    this.resultat.set(null);
    this.messageZone.set(null);
    this.carte.eteindre();
  }
}
