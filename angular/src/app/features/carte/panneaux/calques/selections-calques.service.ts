import { Injectable, signal } from '@angular/core';
import { basculerSection, sectionsInitiales } from '../../etat/sections-filtre';

/**
 * L'état LOCAL du panneau Calques que React gardait dans `PanneauCalques.tsx` (`useState`, `useFilterSections(true, …)`) :
 * les sections internes ouvertes, les régies OOH et les types de transport choisis.
 *
 * Fourni par `mg-panneau-calques` lui-même : il survit au repli d'un groupe (les sections, rendues sous `@if`, sont
 * recréées) et disparaît à la fermeture du panneau, comme l'état React. Mode OVERLAY : rien n'est lu ni écrit dans
 * `localStorage`, et seules les sections territoriales démarrent ouvertes — POI, transport et OOH sont repliées.
 */
@Injectable()
export class SelectionsCalquesService {
  readonly sections = signal<Record<string, boolean>>(sectionsInitiales(true, () => undefined));
  /** Régies OOH choisies (`selectedOOH`, `PanneauCalques.tsx:263`). */
  readonly regiesOoh = signal<readonly string[]>([]);
  /** Types de transport choisis (`selectedTransportTypes`, `PanneauCalques.tsx:264`). */
  readonly typesTransport = signal<readonly string[]>([]);

  basculerSection(cle: string): void {
    this.sections.update((s) => basculerSection(s, cle, true, () => undefined));
  }
}
