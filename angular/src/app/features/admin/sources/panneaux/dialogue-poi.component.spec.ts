import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { FormulairePoi } from '../data/panneaux.types';
import { DialoguePoiComponent, FORMULAIRE_POI_VIDE } from './dialogue-poi.component';
import { doublerDialog, texte } from '../../testing/dom';

describe('DialoguePoiComponent — modale de création / édition d’un POI (lot 6, T19)', () => {
  let f: ComponentFixture<DialoguePoiComponent>;
  let el: HTMLElement;
  let envois: FormulairePoi[];
  let annulations: number;

  async function monter(mode: 'creation' | 'edition', initial: FormulairePoi, extra: { enCours?: boolean; erreur?: string } = {}) {
    doublerDialog();
    f = TestBed.createComponent(DialoguePoiComponent);
    f.componentRef.setInput('mode', mode);
    f.componentRef.setInput('initial', initial);
    if (extra.enCours !== undefined) f.componentRef.setInput('enCours', extra.enCours);
    if (extra.erreur !== undefined) f.componentRef.setInput('erreur', extra.erreur);
    envois = [];
    annulations = 0;
    f.componentInstance.enregistrer.subscribe((v) => envois.push(v));
    f.componentInstance.annuler.subscribe(() => annulations++);
    document.body.appendChild(f.nativeElement as HTMLElement);
    el = f.nativeElement as HTMLElement;
    await f.whenStable();
  }

  afterEach(() => (f.nativeElement as HTMLElement).remove());

  it('ouverte en modale, titre de React, dix champs dans l’ordre de React, LE FOCUS dans le premier (« Nom »)', async () => {
    await monter('creation', { ...FORMULAIRE_POI_VIDE, categorie: 'lycee' });
    const d = el.querySelector('dialog')!;
    expect(d.hasAttribute('open')).toBe(true);
    expect(d.getAttribute('aria-labelledby')).toBe(el.querySelector('[data-titre]')!.id);
    expect(texte(el.querySelector('[data-titre]'))).toBe('+ Nouveau POI');
    expect([...el.querySelectorAll('label')].map(texte)).toEqual([
      'Nom', 'Catégorie *', 'Sous-catégorie', 'Latitude *', 'Longitude *', 'Adresse', 'Ville', 'Département', 'Code postal', 'Source',
    ]);
    expect([...el.querySelectorAll('[data-champ]')].map((i) => i.getAttribute('data-champ'))).toEqual(
      ['nom', 'categorie', 'sous_categorie', 'lat', 'lng', 'adresse', 'ville', 'departement', 'code_postal', 'source'],
    );
    expect(document.activeElement).toBe(el.querySelector('[data-champ="nom"]'));
    expect(texte(el.querySelector('[data-enregistrer]'))).toBe('Créer');
  });

  it('saisie puis « Créer » : émet le formulaire complet, clés dans l’ordre de `emptyPoiForm`', async () => {
    await monter('creation', FORMULAIRE_POI_VIDE);
    const i = el.querySelector<HTMLInputElement>('[data-champ="nom"]')!;
    i.value = 'Point';
    i.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('[data-enregistrer]')!.click();
    expect(envois).toEqual([{ ...FORMULAIRE_POI_VIDE, nom: 'Point' }]);
    expect(Object.keys(envois[0])).toEqual(Object.keys(FORMULAIRE_POI_VIDE));
  });

  it('enregistrement en cours : « Enregistrement... », bouton désactivé, Échap ne ferme pas ; erreur affichée au-dessus des champs', async () => {
    await monter('edition', { ...FORMULAIRE_POI_VIDE, id: 'p1' }, { enCours: true, erreur: 'lat: Expected number' });
    expect(texte(el.querySelector('[data-titre]'))).toBe('Éditer POI');
    const b = el.querySelector<HTMLButtonElement>('[data-enregistrer]')!;
    expect(texte(b)).toBe('Enregistrement...');
    expect(b.disabled).toBe(true);
    expect(texte(el.querySelector('[data-erreur]'))).toBe('lat: Expected number');
    el.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(annulations).toBe(0);
  });

  it('« Annuler » et Échap (hors enregistrement) émettent `annuler`', async () => {
    await monter('creation', FORMULAIRE_POI_VIDE);
    el.querySelector<HTMLButtonElement>('[data-annuler]')!.click();
    const c = new Event('cancel', { cancelable: true });
    el.querySelector('dialog')!.dispatchEvent(c);
    expect(c.defaultPrevented).toBe(true);
    expect(annulations).toBe(2);
  });
});
