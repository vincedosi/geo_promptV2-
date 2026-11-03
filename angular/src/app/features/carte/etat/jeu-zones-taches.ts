import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { messageErreurCouverture, refusDeLErreur } from '../logique/analyses/couverture-erreurs';
import type { ChoixMaille } from '../logique/jeu/mailles-url';
import { type EchecSimulation, lectureRequise } from '../logique/jeu/bilan';
import { rayonPropose, texteTropDeCercles } from '../logique/jeu/ecran';
import type { Plateforme, PlateformeGeo } from '../logique/jeu/plateformes';
import type { Recette } from '../logique/zones/recette';
import { FileLectures } from './file-lectures';

/**
 * La clé de la tâche qui chiffre un choix de ⑤ : la couverture requise (`couverture|zone|cible|découpage`), ou le
 * pavage de la plateforme (`cercles|plateforme`). Sans la date de la zone : la file est vidée quand elle CHANGE, et une
 * date adoptée (`JeuZonesService.choisirZone`) garde ainsi sa lecture en vol.
 */
export function cleTache(
  p: Plateforme, c: ChoixMaille, ligne: PlateformeGeo, recette: Recette | null, zone: string | null, cible: string,
): string {
  const besoin = lectureRequise(c, ligne, recette);
  return besoin === 'cercles' ? `cercles|${p}` : `couverture|${zone}|${cible}|${besoin}`;
}

/**
 * Les TÂCHES de conversion de ⑤ (⑤ finitions, T0) : la file des lectures (`FileLectures`, une à la fois) et le
 * message d'échec de chaque tâche, par clé. Extraites de `JeuZonesService`, arrivé au plafond de 400 lignes
 * (`taille-fichiers.test.ts`), à comportement constant — même parenté que `file-lectures.ts` : un état de lectures
 * que le service possède sans en porter le détail.
 *
 * À créer dans un contexte d'injection (la file se détruit au `DestroyRef` du propriétaire). Une zone introuvable
 * (supprimée, d'un autre espace) n'est pas notée comme l'échec d'une tâche : elle est rendue au propriétaire
 * (`zonePerdue`), qui retire la zone et garde le message.
 */
export class TachesJeu {
  private readonly file = new FileLectures();
  /** Revue T6 (I-7) : le message ET la nature de l'échec (transitoire : réseau, quota 429, serveur). */
  private readonly _erreurs = signal<ReadonlyMap<string, EchecSimulation>>(new Map());
  /** B10 : le rayon proposé avec un refus `trop_de_cercles`, par clé de tâche ; oublié avec l'échec. */
  private readonly _propositions = signal<ReadonlyMap<string, NonNullable<ReturnType<typeof rayonPropose>>>>(new Map());
  /** Le pavage demandé en dernier par plateforme (`zone|cible|rayon|seuil`) : un second `valider` identique n'en relance pas. */
  private readonly demandes = new Map<Plateforme, string>();

  constructor(private readonly zonePerdue: (message: string) => void) {}

  /** La tâche est en file ou en vol (lu dans un `computed` : suit la file). */
  contient(cle: string): boolean {
    return this.file.contient(cle);
  }

  /** Le message d'échec de la tâche, s'il y en a un (lu dans un `computed` : suit les échecs). */
  erreur(cle: string): string | undefined {
    return this._erreurs().get(cle)?.message;
  }

  /** Revue T6 (I-7) : l'échec de la tâche, message et nature, s'il y en a un (suit les échecs). */
  echec(cle: string): EchecSimulation | undefined {
    return this._erreurs().get(cle);
  }

  /** B10 : le rayon proposé avec le refus `trop_de_cercles` de la tâche, s'il y en a un (suit les échecs). */
  proposition(cle: string): NonNullable<ReturnType<typeof rayonPropose>> | undefined {
    return this._propositions().get(cle);
  }

  /** Oublie l'échec précédent de la tâche, puis la met en file (une tâche de même clé est remplacée). */
  ajouter<T>(cle: string, source: () => Observable<T>, succes: (r: T) => void): void {
    this.oublier(cle);
    this.file.ajouter(cle, source, succes, (e) => this.noter(cle, e));
  }

  /**
   * Met en file le pavage en cercles d'une plateforme, sauf s'il est DÉJÀ en file ou en vol pour la même `demande`
   * (double relâchement) ; une autre demande (autre rayon, autre seuil) remplace celle en vol.
   */
  paver<T>(plateforme: Plateforme, demande: string, cle: string, source: () => Observable<T>, succes: (r: T) => void): void {
    if (this.contient(cle) && this.demandes.get(plateforme) === demande) return;
    this.demandes.set(plateforme, demande);
    this.ajouter(cle, source, succes);
  }

  /** Oublie l'échec de la tâche (un refus de pavage valait pour l'ancien rayon ou l'ancien seuil). */
  oublier(cle: string): void {
    const suite = new Map(this._erreurs());
    if (suite.delete(cle)) this._erreurs.set(suite);
    const propositions = new Map(this._propositions());
    if (propositions.delete(cle)) this._propositions.set(propositions);
  }

  /** Annule tout : la file, la lecture en vol, et les échecs notés. */
  vider(): void {
    this.file.vider();
    this._erreurs.set(new Map());
    this._propositions.set(new Map());
  }

  private noter(cle: string, e: unknown): void {
    // Trop de cercles : les chiffres du corps, dans la phrase de l'avertissement (E4) ; sinon la phrase du serveur.
    const message = (e instanceof HttpErrorResponse ? texteTropDeCercles(e.error) : null) ?? messageErreurCouverture(e);
    if (refusDeLErreur(e) === 'zone_introuvable') {
      this.zonePerdue(message);
      return;
    }
    const transitoire = !(e instanceof HttpErrorResponse) || e.status === 0 || e.status === 429 || e.status >= 500;
    this._erreurs.update((m) => new Map(m).set(cle, { message, transitoire }));
    const p = e instanceof HttpErrorResponse ? rayonPropose(e.error) : null;
    if (p) this._propositions.update((m) => new Map(m).set(cle, p));
  }
}
