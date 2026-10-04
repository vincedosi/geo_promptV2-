import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, type Signal, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { type JeuDetail, type JeuResume, JeuxZonesApi, type ReglageJeu } from '../data/jeux-zones.api';
import type { JeuDeZones } from '../logique/jeu';

/** `'vide' | 'chargement' | 'echec' | 'pret'`, porté À CÔTÉ de la donnée (`use-jeux-zones.ts:98`). */
export type EtatAtelier = 'vide' | 'chargement' | 'echec' | 'pret';

/** Les messages par défaut, MOT POUR MOT de `use-jeux-zones.ts`. */
export const MESSAGES_ATELIER = {
  construction: 'Construction impossible.',
  lecture: 'Jeu de zones illisible.',
  reglage: 'Modification impossible.',
  suppression: 'Suppression impossible.',
} as const;

/**
 * Le message d'une réponse en erreur — `messageErreur` de `use-jeux-zones.ts:127-134` : le champ `error` du corps
 * JSON s'il existe, le message par défaut sinon. Jamais une levée sur un corps illisible. Une coupure de Kong à 60 s
 * (504, corps sans `error`) rend donc le message par défaut, comme React.
 */
export function messageAtelier(erreur: unknown, defaut: string): string {
  if (erreur instanceof HttpErrorResponse) {
    const corps = erreur.error as { error?: unknown } | null;
    if (corps && typeof corps === 'object' && typeof corps.error === 'string') return corps.error;
  }
  return defaut;
}

/**
 * L'atelier des jeux de zones de l'étape ④ : bibliothèque, construction, réglage — portage de `use-jeux-zones.ts`.
 *
 * ── LE COMPROMIS QU'IL ORGANISE ───────────────────────────────────────────
 *
 * Construire un jeu coûte une vingtaine de secondes (7 classes, ~1 940 codes postaux) : chaque carreau INSEE de 200 m
 * est affecté à une classe, puis on mesure ce que cela couvre de chaque code postal. Rien de cela ne dépend du SEUIL,
 * ni des poids, ni du mode de plan : on construit une fois — dans un BROUILLON, avant qu'un nom soit choisi — et tous
 * les réglages se rejouent en quelques dizaines de millisecondes (PATCH, `appliquer_seuil_zone_set`).
 *
 * ── LA COURSE ────────────────────────────────────────────────────────────
 *
 * Deux constructions ou deux réglages lancés coup sur coup peuvent revenir dans le désordre. Chaque appel porte un
 * jeton, et seul le dernier a le droit d'écrire — sinon l'écran afficherait le taux d'utile d'un réglage que plus
 * personne ne regarde, sans rien pour le signaler.
 *
 * ── CE QUI DIFFÈRE DU HOOK REACT ─────────────────────────────────────────
 *
 * - Fourni par l'ÉCRAN (A13), pas par le panneau de ④ : quitter l'étape pendant une construction ne la perd pas, et
 *   y revenir ne relit pas la bibliothèque (React démontait l'onglet, relisait la bibliothèque à chaque visite et
 *   jetait une construction en cours).
 * - La bibliothèque n'est lue qu'à la PREMIÈRE visite de ④ (`assurerBibliotheque`) : ouvrir le module à l'étape ①
 *   n'a pas à la demander.
 * - Le seuil réglé se propage par le signal `reglage` (A14), et non par l'événement DOM `magelian:jeu-zones-regle` :
 *   la carte des codes postaux partage l'injecteur de l'écran.
 */
@Injectable()
export class AtelierJeuxService {
  private readonly api = inject(JeuxZonesApi);

  private readonly _bibliotheque = signal<JeuResume[]>([]);
  private readonly _etatBibliotheque = signal<EtatAtelier>('chargement');
  private readonly _detail = signal<JeuDetail | null>(null);
  private readonly _etat = signal<EtatAtelier>('vide');
  private readonly _erreur = signal<string | null>(null);
  private readonly _reglage = signal(0);

  /** Les jeux enregistrés de l'organisation. */
  readonly bibliotheque: Signal<JeuResume[]> = this._bibliotheque.asReadonly();
  readonly etatBibliotheque: Signal<EtatAtelier> = this._etatBibliotheque.asReadonly();
  /** Le jeu ouvert : brouillon en cours de réglage, ou jeu enregistré. */
  readonly detail: Signal<JeuDetail | null> = this._detail.asReadonly();
  readonly etat: Signal<EtatAtelier> = this._etat.asReadonly();
  readonly erreur: Signal<string | null> = this._erreur.asReadonly();
  /**
   * Incrémenté après chaque réglage réussi, APRÈS la relecture du détail : la carte des codes postaux relit alors
   * `retenu`, que seul le serveur décide (A14). Émis avant, elle peindrait l'état précédent.
   */
  readonly reglage: Signal<number> = this._reglage.asReadonly();

  /** Le jeton du dernier appel. Seul lui a le droit d'écrire dans l'état. */
  private jeton = 0;
  /** L'écran fermé pendant une construction ne doit plus écrire. */
  private detruit = false;
  private bibliothequeDemandee = false;
  /** Le dernier jeu demandé par l'URL : un échec n'est pas retenté en boucle (voir `ouvrirDepuisUrl`). */
  private demandeUrl: string | null = null;

  constructor() {
    // La piste du bandeau de progression : le plus long geste du module, signalé où qu'on regarde
    // (`OngletZones.tsx:238`, `usePiste('jeu-de-zones', …)`).
    inject(ChargementService).suivre('jeu-de-zones', 'Construction du jeu de zones…', () => this._etat() === 'chargement');
    inject(DestroyRef).onDestroy(() => { this.detruit = true; });
  }

  /** Lit la bibliothèque, une fois par écran — à la première visite de ④. */
  assurerBibliotheque(): void {
    if (this.bibliothequeDemandee) return;
    this.bibliothequeDemandee = true;
    void this.rafraichirBibliotheque();
  }

  /** Construit un brouillon pour ce jeu, ou retrouve celui qui existe déjà. */
  construire(jeu: JeuDeZones): void {
    // Le brouillon remplace le jeu ouvert : l'URL qui le nommait ne le désigne plus (l'écran la vide), et un retour
    // ultérieur de l'URL sur ce jeu doit pouvoir le rouvrir.
    this.demandeUrl = null;
    void this.construireAsync(jeu);
  }

  /** Ouvre un jeu déjà enregistré. */
  ouvrir(id: string): void {
    this.demandeUrl = id;
    void this.ouvrirAsync(id);
  }

  /**
   * Le jeu nommé par l'URL s'ouvre TOUT SEUL (`OngletZones.tsx:192-200`) — c'est ce qui rend le lien partageable.
   *
   * ⚠ La garde porte sur le DERNIER IDENTIFIANT DEMANDÉ, pas sur le jeu affiché. React comparait l'URL au jeu chargé
   * et à l'état, ce qui avait deux effets, corrigés ici : un jeu introuvable était redemandé à chaque passage en
   * `echec` (une boucle de requêtes sans fin), et un brouillon construit pendant qu'un jeu était nommé dans l'URL
   * était aussitôt remplacé par ce jeu. On n'ouvre donc que lorsque l'URL CHANGE.
   */
  ouvrirDepuisUrl(id: string | null): void {
    if (!id || id === this.demandeUrl) return;
    this.demandeUrl = id;
    if (this._detail()?.jeu.id === id) return;
    void this.ouvrirAsync(id);
  }

  /** Rejoue le seuil, les poids, le mode de plan, ou enregistre le brouillon. */
  async regler(champs: ReglageJeu): Promise<boolean> {
    const id = this._detail()?.jeu.id;
    if (!id) return false;
    const mien = ++this.jeton;
    this._erreur.set(null);
    try {
      try {
        await firstValueFrom(this.api.regler(id, champs));
      } catch (e) {
        throw new Error(messageAtelier(e, MESSAGES_ATELIER.reglage));
      }
      // Le détail est RELU, jamais fusionné à la main : le seuil change `retenu` sur chaque code postal, donc le
      // compte et le taux d'utile de CHAQUE classe. Le recalculer ici dupliquerait le calcul du serveur.
      await this.chargerDetail(id, mien);
      if (champs.enregistrer) await this.rafraichirBibliotheque();
      this._reglage.update((n) => n + 1);
      return true;
    } catch (e) {
      if (!this.detruit && mien === this.jeton) this._erreur.set((e as Error).message);
      return false;
    }
  }

  /** Retire un jeu de la bibliothèque. Le jeu ouvert qui vient d'être supprimé quitte l'atelier. */
  async supprimer(id: string): Promise<boolean> {
    this._erreur.set(null);
    try {
      try {
        await firstValueFrom(this.api.supprimer(id));
      } catch (e) {
        throw new Error(messageAtelier(e, MESSAGES_ATELIER.suppression));
      }
      if (this.detruit) return true;
      // Le laisser affiché donnerait à régler un objet qui n'existe plus.
      if (this._detail()?.jeu.id === id) {
        this._detail.set(null);
        this._etat.set('vide');
      }
      if (this.demandeUrl === id) this.demandeUrl = null;
      await this.rafraichirBibliotheque();
      return true;
    } catch (e) {
      if (!this.detruit) this._erreur.set((e as Error).message);
      return false;
    }
  }

  private async rafraichirBibliotheque(): Promise<void> {
    this._etatBibliotheque.set('chargement');
    try {
      const j = await firstValueFrom(this.api.lister());
      if (this.detruit) return;
      this._bibliotheque.set(Array.isArray(j?.jeux) ? j.jeux : []);
      this._etatBibliotheque.set('pret');
    } catch {
      if (!this.detruit) this._etatBibliotheque.set('echec');
    }
  }

  private async chargerDetail(id: string, mien: number): Promise<void> {
    let j: JeuDetail;
    try {
      j = await firstValueFrom(this.api.lire(id));
    } catch (e) {
      throw new Error(messageAtelier(e, MESSAGES_ATELIER.lecture));
    }
    // ⚠ Le jeton AVANT l'écriture : une réponse arrivée après une autre plus récente est jetée, pas affichée.
    if (this.detruit || mien !== this.jeton) return;
    this._detail.set({ jeu: j.jeu, classes: j.classes ?? [] });
    this._etat.set('pret');
  }

  private async construireAsync(jeu: JeuDeZones): Promise<void> {
    const mien = ++this.jeton;
    this._etat.set('chargement');
    this._erreur.set(null);
    try {
      let rep: { id: string };
      try {
        rep = await firstValueFrom(this.api.construire(jeu));
      } catch (e) {
        throw new Error(messageAtelier(e, MESSAGES_ATELIER.construction));
      }
      if (this.detruit || mien !== this.jeton) return;
      await this.chargerDetail(rep.id, mien);
    } catch (e) {
      if (this.detruit || mien !== this.jeton) return;
      this._erreur.set((e as Error).message);
      this._etat.set('echec');
    }
  }

  private async ouvrirAsync(id: string): Promise<void> {
    const mien = ++this.jeton;
    this._etat.set('chargement');
    this._erreur.set(null);
    try {
      await this.chargerDetail(id, mien);
    } catch (e) {
      if (this.detruit || mien !== this.jeton) return;
      this._erreur.set((e as Error).message);
      this._etat.set('echec');
    }
  }
}
