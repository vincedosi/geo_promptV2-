import { TestBed } from '@angular/core/testing';
import type { JeuResume } from '../../data/jeux-zones.api';
import type { EtatAtelier } from '../../etat/atelier-jeux.service';
import { BibliothequeComponent, TEXTES_BIBLIOTHEQUE } from './bibliotheque.component';

const JEU = (id: string, partiel: Partial<JeuResume> = {}): JeuResume => ({
  id, nom: `Jeu ${id}`, description: null, version: 2, created_at: '', construit_le: null, population_exposee: null,
  n_cp_retenus: 1006, taux_utile: 81.62, mode_plan: 'pondere', seuil_couverture_cp: 35, ...partiel,
});

async function rendre(etat: EtatAtelier, jeux: JeuResume[] = [], ouvert: string | null = null, enCoursId: string | null = null) {
  const f = TestBed.createComponent(BibliothequeComponent);
  f.componentRef.setInput('etat', etat);
  f.componentRef.setInput('jeux', jeux);
  f.componentRef.setInput('ouvert', ouvert);
  f.componentRef.setInput('enCoursId', enCoursId);
  const ouverts: string[] = [];
  const supprimes: string[] = [];
  f.componentInstance.ouvrir.subscribe((id) => ouverts.push(id));
  f.componentInstance.supprimer.subscribe((id) => supprimes.push(id));
  await f.whenStable();
  return { el: f.nativeElement as HTMLElement, ouverts, supprimes };
}

describe('BibliothequeComponent', () => {
  it('chargement, échec et liste vide disent chacun ce qu’il en est', async () => {
    expect((await rendre('chargement')).el.textContent).toContain(TEXTES_BIBLIOTHEQUE.lecture);
    expect((await rendre('echec')).el.querySelector('[role="status"]')?.textContent?.trim()).toBe(TEXTES_BIBLIOTHEQUE.echec);
    expect((await rendre('pret')).el.textContent?.trim()).toBe(TEXTES_BIBLIOTHEQUE.vide);
  });

  it('une ligne par jeu : nom, version, résumé chiffré ; le jeu ouvert est surligné', async () => {
    const { el } = await rendre('pret', [JEU('a'), JEU('b', { n_cp_retenus: null, taux_utile: null, seuil_couverture_cp: 20 })], 'a');
    const lignes = [...el.querySelectorAll('li[data-role="jeu"]')];
    expect(lignes[0].querySelector('[data-role="resume"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 006 codes postaux · 81,6 % d’utile · seuil 35 %');
    expect(lignes[1].querySelector('[data-role="resume"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('— codes postaux · seuil 20 %');
    expect(lignes[0].textContent).toContain('v2');
    expect(lignes[0].classList).toContain('border-teal');
    expect(lignes[1].classList).toContain('border-subtle');
  });

  it('ouvrir et supprimer émettent l’identifiant ; la suppression en cours désactive son bouton', async () => {
    const { el, ouverts, supprimes } = await rendre('pret', [JEU('a'), JEU('b')], null, 'b');
    el.querySelector<HTMLButtonElement>('li:first-child button[title="Ouvrir ce jeu dans l’atelier"]')!.click();
    el.querySelector<HTMLButtonElement>('li:first-child button[title="Supprimer ce jeu"]')!.click();
    expect(ouverts).toEqual(['a']);
    expect(supprimes).toEqual(['a']);
    expect(el.querySelector<HTMLButtonElement>('li:last-child button[title="Supprimer ce jeu"]')!.disabled).toBe(true);
  });
});
