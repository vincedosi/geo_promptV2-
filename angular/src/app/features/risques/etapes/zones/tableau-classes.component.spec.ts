import { TestBed } from '@angular/core/testing';
import type { ClasseJeu } from '../../data/jeux-zones.api';
import { MESSAGE_AUCUNE_CLASSE, TableauClassesComponent, couleurDeClasse } from './tableau-classes.component';

const CLASSES: ClasseJeu[] = [
  { classe: 'haut:1', n_cp: 1234, n_cp_retenus: 1006, population_en_zone: 526874.4, population_en_zone_retenue: 1, population_achetee: 1 },
  { classe: 'bas:pprt', n_cp: 3, n_cp_retenus: 0, population_en_zone: 701, population_en_zone_retenue: 0, population_achetee: 0 },
];

async function rendre(classes = CLASSES, poids: Record<string, number> = { 'haut:1': 2 }) {
  const f = TestBed.createComponent(TableauClassesComponent);
  f.componentRef.setInput('classes', classes);
  f.componentRef.setInput('poids', poids);
  f.componentRef.setInput('anneauxPar', { haut: [1000, 2000, 5000], bas: [500, 1000], autres: [] });
  const emis: { classe: string; valeur: number }[] = [];
  f.componentInstance.poidsChange.subscribe((v) => emis.push(v));
  await f.whenStable();
  return { el: f.nativeElement as HTMLElement, emis };
}

function sortir(champ: HTMLInputElement, valeur: string) {
  champ.value = valeur;
  champ.dispatchEvent(new Event('blur'));
}

describe('TableauClassesComponent', () => {
  it('une ligne par classe : pastille par jeton du niveau, population arrondie, retenus / touchés, poids (1 par défaut)', async () => {
    const { el } = await rendre();
    const lignes = [...el.querySelectorAll('tr[data-role="classe"]')];
    expect(lignes).toHaveLength(2);
    const cellules = (tr: Element) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.replace(/\s+/g, ' ').trim());
    expect(cellules(lignes[0]).slice(1, 3)).toEqual(['526 874', '1 006 / 1 234']);
    expect(cellules(lignes[1]).slice(1, 3)).toEqual(['701', '0 / 3']);
    const champs = [...el.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    expect(champs.map((c) => c.value)).toEqual(['2', '1']);
    expect((lignes[0].querySelector('span[aria-hidden]') as HTMLElement).style.background).toBe('var(--niveau-haut)');
  });

  it('couleurDeClasse : jetons de niveau, gris de donnée absente pour « hors » et l’inconnu', () => {
    expect(couleurDeClasse('bas:2')).toBe('var(--niveau-bas)');
    expect(couleurDeClasse('hors')).toBe('var(--donnee-absente)');
    expect(couleurDeClasse('x:1')).toBe('var(--donnee-absente)');
  });

  it('le poids part à la SORTIE du champ, borné ; vide, hors bornes ou inchangé : rien', async () => {
    const { el, emis } = await rendre();
    const [haut, bas] = [...el.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    sortir(haut, '2');
    sortir(haut, '');
    sortir(haut, '7');
    sortir(haut, '-1');
    expect(emis).toEqual([]);
    sortir(bas, '0');
    sortir(haut, '4.5');
    expect(emis).toEqual([{ classe: 'bas:pprt', valeur: 0 }, { classe: 'haut:1', valeur: 4.5 }]);
  });

  it('aucune classe : l’alerte de React', async () => {
    const { el } = await rendre([]);
    expect(el.querySelector('[role="status"]')?.textContent?.trim()).toBe(MESSAGE_AUCUNE_CLASSE);
    expect(el.querySelector('table')).toBeNull();
  });
});
