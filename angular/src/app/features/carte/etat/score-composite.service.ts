import { Injectable, computed, inject, signal } from '@angular/core';
import { type Subscription, catchError, throwError } from 'rxjs';
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
 * `@Injectable()` sans `providedIn` : fourni par le panneau Analyse — fermer le panneau perd les réglages, comme
 * React ; la carte, elle, garde le score peint (`ScoreService`, à la page).
 */
@Injectable()
export class ScoreCompositeService {
  private readonly api = inject(AnalysesApi);
  private readonly etat = inject(EtatCarteService);
  private readonly carte = inject(ScoreService);
  private readonly catalogueService = inject(CatalogueIndicateursService);
  private readonly creation = inject(CreationZoneService);

  readonly ouvert = signal(false);
  readonly catalogue = signal<IndicateurRegistre[]>([]);
  readonly chargementCatalogue = signal(false);
  private catalogueLu = false;

  readonly choisis = signal<IndicateurChoisi[]>([]);
  readonly enregistrer = signal(false);
  readonly calcul = signal(false);
  readonly resultat = signal<ResultatScore | null>(null);
  readonly erreur = signal<string | null>(null);

  readonly seuil = signal(70);
  readonly creationZone = signal(false);
  readonly messageZone = signal<string | null>(null);
  /** L'organisation active : sans elle, « Créer la zone » reste inactif (`!orgId`). */
  readonly org = this.creation.org;

  /** Le calcul en vol : un réglage modifié l'ANNULE, sans quoi l'ancien résultat reviendrait repeindre la carte. */
  private calculEnVol: Subscription | null = null;

  readonly disponibles = computed(() => this.catalogue().filter((i) => !this.choisis().some((c) => c.code === i.indicator_code)));
  readonly auDessusDuSeuil = computed(() => compteAuDessus(this.resultat()?.scores ?? [], this.seuil()));

  /** Déplier charge le catalogue la PREMIÈRE fois ; un échec laisse le dépliage suivant relire. */
  basculerOuvert(): void {
    const prochain = !this.ouvert();
    this.ouvert.set(prochain);
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
    if (!choisis.length || this.calcul() || !filtre) return;
    this.calcul.set(true);
    this.erreur.set(null);
    this.messageZone.set(null);
    this.calculEnVol = this.api.score(corpsScore(choisis, filtre, this.enregistrer())).subscribe({
      next: (r) => {
        this.resultat.set(r);
        this.carte.afficher({ scores: r.scores, libelle: libelleScore(choisis.map((c) => c.label)), nIndicateurs: choisis.length });
        this.calcul.set(false);
      },
      error: (e: unknown) => {
        this.erreur.set(messageErreurRequete(e));
        this.calcul.set(false);
      },
    });
  }

  /**
   * « Créer la zone » : la route sœur RECALCULE le score au-dessus du seuil (elle ne croit pas une liste de CP remontée
   * par le client), puis `POST /api/zones` ÉCRIT la zone avec la recette figée `{ type: 'capture', source_type: 'score' }`
   * et sa géométrie — le geste commun des créations (`CreationZoneService`, lot 3).
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
    this.creation.creer(source, () => nomZoneScore(seuil, choisis), () => ({ v: 1, type: 'capture', source_type: 'score' })).subscribe((issue) => {
      this.messageZone.set('erreur' in issue ? issue.erreur : `Zone créée — ${formaterNombre(issue.geo.count)} codes postaux.`);
      this.creationZone.set(false);
    });
  }

  private perimer(): void {
    this.calculEnVol?.unsubscribe();
    this.calculEnVol = null;
    this.calcul.set(false);
    this.resultat.set(null);
    this.messageZone.set(null);
    this.carte.eteindre();
  }
}
