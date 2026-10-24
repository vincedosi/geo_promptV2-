import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, linkedSignal, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { type ChoixPlateforme, type DetailJeuZone, JeuxApi } from '../../data/jeux.api';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { messageErreurCouverture } from '../../logique/analyses/couverture-erreurs';
import { PLATEFORMES } from '../../logique/jeu/plateformes';
import { BOUTON_CALCUL, ENCART_ERREUR, LIBELLE_CHAMP, LISTE_CHAMP } from '../analyse/styles-analyse';

/**
 * ⑤ Jeu de zones — enregistrer le jeu (lot 5, T12) : un nom (proposé : celui de la zone), puis le CTA teal
 * « Enregistrer le jeu » → `POST /api/zones/jeux` ; le jeu est ADOPTÉ sans relecture (`JeuZonesService.adopter`) :
 * `?jeu=` posé, `?zoneJeu=` et `?mailles=` retirés. Un jeu ouvert : « Enregistrer les réglages » → `PATCH` (nom, mode
 * de plan, choix des plateformes ; la zone et la cible ne changent pas), la réponse est adoptée telle quelle.
 *
 * UNE requête par geste : le bouton est inerte pendant l'envoi (un double clic n'en lance pas deux). Un refus se lit
 * dans la réponse (`{ error }`, ex. 409) ; la requête est abandonnée à la destruction (P-c).
 */
@Component({
  selector: 'mg-enregistrer-jeu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2 px-4 py-3', 'data-enregistrer-jeu': '' },
  template: `
    <label [class]="libelleChamp" for="mg-nom-jeu">Nom du jeu</label>
    <input id="mg-nom-jeu" type="text" maxlength="120" [class]="listeChamp + ' cursor-text'" [value]="nom()" (input)="nom.set(texte($event))" />
    <button type="button" data-enregistrer [disabled]="enCours() || !nom().trim() || choix().length === 0" (click)="enregistrer()" [class]="boutonCalcul + ' self-start'">
      {{ enCours() ? 'Enregistrement…' : jeu.jeuId() ? 'Enregistrer les réglages' : 'Enregistrer le jeu' }}
    </button>
    @if (message(); as m) { <p data-message role="status" class="m-0 text-[11px] text-secondary">{{ m }}</p> }
    @if (erreur(); as e) { <div data-erreur role="alert" [class]="encartErreur">{{ e }}</div> }
  `,
})
export class EnregistrerJeuComponent {
  protected readonly jeu = inject(JeuZonesService);
  private readonly api = inject(JeuxApi);

  /** Le nom proposé pour un jeu neuf : celui de la zone. */
  readonly nomPropose = input('');

  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly listeChamp = LISTE_CHAMP;
  protected readonly boutonCalcul = BOUTON_CALCUL;
  protected readonly encartErreur = ENCART_ERREUR;

  /** Le nom du jeu ouvert, sinon le nom proposé ; réaligné quand l'un ou l'autre change. */
  protected readonly nom = linkedSignal(() => this.jeu.jeu()?.jeu.nom ?? this.nomPropose());
  protected readonly enCours = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly erreur = signal<string | null>(null);
  /** Le choix de chaque plateforme tel qu'il part (`ChoixPlateformeSchema`) : un rayon pour le cercle, et lui seul. */
  protected readonly choix = computed<ChoixPlateforme[]>(() => PLATEFORMES.flatMap((p) => {
    const c = this.jeu.choix()[p];
    if (!c) return [];
    return [c.maille === 'cercle' && c.rayon_m !== undefined
      ? { plateforme: p, maille: c.maille, seuil: c.seuil, rayon_m: c.rayon_m } : { plateforme: p, maille: c.maille, seuil: c.seuil }];
  }));

  private envoi: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.envoi?.unsubscribe());
  }

  protected texte(ev: Event): string {
    return (ev.target as HTMLInputElement).value;
  }

  protected enregistrer(): void {
    const zone = this.jeu.zoneId();
    const nom = this.nom().trim();
    if (this.enCours() || !zone || !nom) return;
    this.enCours.set(true);
    this.message.set(null);
    this.erreur.set(null);
    const id = this.jeu.jeuId();
    const plateformes = this.choix();
    const fin = { error: (e: unknown) => this.terminer(null, messageErreurCouverture(e)) };
    if (id) {
      this.envoi = this.api.regler(id, { nom, mode_plan: this.jeu.modePlan(), plateformes }).subscribe({
        next: (r) => this.terminer(r, 'Réglages enregistrés.'), ...fin,
      });
      return;
    }
    const cible = this.jeu.cible();
    const modePlan = this.jeu.modePlan();
    const ouvert = this.jeu.jeu();
    this.envoi = this.api.enregistrer({ nom, jeu: { type: 'zone', zone_id: zone, cible, mode_plan: modePlan, plateformes } }).subscribe({
      next: (r) => this.terminer({
        jeu: {
          id: r.id, type: 'zone', nom, description: null, version: r.version, created_at: new Date().toISOString(),
          custom_geo_zone_id: zone, cible, mode_plan: modePlan,
        },
        zone: { id: zone, nom: ouvert?.zone.nom ?? this.nomPropose(), recette: this.jeu.recette() },
        plateformes: plateformes.map((c) => ({ ...c, rayon_m: c.rayon_m ?? null })),
      }, 'Jeu enregistré.'),
      ...fin,
    });
  }

  private terminer(detail: DetailJeuZone | null, texte: string): void {
    this.envoi = null;
    this.enCours.set(false);
    if (detail) {
      this.jeu.adopter(detail);
      this.message.set(texte);
    } else {
      this.erreur.set(texte);
    }
  }
}
