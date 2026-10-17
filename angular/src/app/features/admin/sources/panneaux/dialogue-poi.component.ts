import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, linkedSignal, output, viewChild,
} from '@angular/core';
import type { FormulairePoi } from '../data/panneaux.types';

let compteur = 0;

/** Formulaire vierge (`emptyPoiForm`, `usePoiAdmin.ts:19-22`) : l'ORDRE des clés est celui du corps envoyé. */
export const FORMULAIRE_POI_VIDE: FormulairePoi = {
  nom: '', categorie: '', sous_categorie: '', lat: '', lng: '', adresse: '', ville: '', departement: '', code_postal: '', source: '',
};

type ChampPoi = Exclude<keyof FormulairePoi, 'id'>;

/** Les dix champs de la modale de React (`PoiPanel.tsx:274-285`), dans son ordre ; `large` = sur deux colonnes. */
const CHAMPS: { champ: ChampPoi; libelle: string; large: boolean }[] = [
  { champ: 'nom', libelle: 'Nom', large: true },
  { champ: 'categorie', libelle: 'Catégorie *', large: false },
  { champ: 'sous_categorie', libelle: 'Sous-catégorie', large: false },
  { champ: 'lat', libelle: 'Latitude *', large: false },
  { champ: 'lng', libelle: 'Longitude *', large: false },
  { champ: 'adresse', libelle: 'Adresse', large: true },
  { champ: 'ville', libelle: 'Ville', large: false },
  { champ: 'departement', libelle: 'Département', large: false },
  { champ: 'code_postal', libelle: 'Code postal', large: false },
  { champ: 'source', libelle: 'Source', large: false },
];

/**
 * Modale de création / édition d'un POI — portage de la modale de `PoiPanel.tsx:259-316` (lot 6, T19).
 *
 * `<dialog>` natif (C6) au lieu du voile `position: fixed` de React (interdit dans une racine d'ombre) :
 * `showModal()` la place dans la couche supérieure SANS la sortir de l'ombre. Montée par le parent (`@if`)
 * tant qu'un POI est créé ou édité, ouverte à son premier rendu, le FOCUS dans le premier champ (« Nom ») —
 * React ne posait aucun focus.
 *
 * Fermeture : « Annuler » et Échap (geste natif ; React n'en avait aucun), refusés pendant l'enregistrement.
 * Un clic sur le fond ne ferme pas, comme React. Le formulaire est émis TEL QUEL (`JSON.stringify(poiModal.data)`
 * de React) : tout en texte, `id` en tête en édition.
 *
 * Écarts (C9) : voile `rgba(0,0,0,0.7)` → noir à 70 % ; bouton « Créer » : texte `#fff` sur le teal (≈ 1,9:1)
 * → `--brand-teal-fg`, le jeton du texte posé sur un aplat teal (défaut corrigé, listé) ; teal du titre
 * lisible en clair (`light-dark`, T16). Libellés reliés à leur champ (`for` / `id`), React n'en avait pas.
 */
@Component({
  selector: 'mg-dialogue-poi',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dialogue-poi.component.html',
  styleUrl: './dialogue-poi.component.css',
})
export class DialoguePoiComponent {
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private detruit = false;

  protected readonly id = `mg-dialogue-poi-${++compteur}`;
  protected readonly champs = CHAMPS;
  readonly mode = input.required<'creation' | 'edition'>();
  readonly initial = input.required<FormulairePoi>();
  readonly enCours = input(false);
  readonly erreur = input('');
  readonly enregistrer = output<FormulairePoi>();
  readonly annuler = output<void>();

  /** Le formulaire en cours de saisie, repris de `initial` (`setPoiModal(m => ({ ...m, data: { ...m.data, [field]: v } }))`). */
  protected readonly formulaire = linkedSignal(() => ({ ...this.initial() }));

  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');

  constructor() {
    afterNextRender(() => {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
      d.querySelector<HTMLInputElement>('[data-champ="nom"]')?.focus();
    });
    const noeud = this.hote.nativeElement;
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      const d = noeud.querySelector('dialog');
      if (d?.open) d.close();
    });
  }

  protected saisir(champ: ChampPoi, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.formulaire.update((f) => ({ ...f, [champ]: v }));
  }

  protected valider(): void {
    this.enregistrer.emit(this.formulaire());
  }

  protected surAnnulationNative(e: Event): void {
    e.preventDefault();
    if (!this.enCours()) this.annuler.emit();
  }

  /** Fermeture native non empêchée : pendant l'enregistrement la modale est rouverte, sinon `annuler` resynchronise. */
  protected surFermeture(): void {
    if (this.detruit) return;
    if (this.enCours()) this.dialogue().nativeElement.showModal();
    else this.annuler.emit();
  }
}
