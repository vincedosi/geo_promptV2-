/**
 * Palettes de DONNÉES — copie Angular de `CARREAUX_PALETTES`
 * (`lib/carreaux/catalogue.ts:63-100`).
 *
 * Exception A10 à la règle « aucune couleur en dur » : ce sont des échelles de
 * DONNÉES (identiques dans les deux thèmes, comme React les écrit), pas des
 * couleurs d'interface. Verrouillées par
 * `tests/unit/angular/risques-logique-carte-paritaire.test.ts`.
 */

export interface CarreauxPalette {
  id: string;
  label: string;
  stops: string[]; // 6 couleurs, min → max
}

// Exception A10 : échelles de DONNÉES, identiques dans les deux thèmes
export const PALETTES_DONNEES: CarreauxPalette[] = [
  {
    id: 'rouge',
    label: 'Rouge',
    stops: ['#FFF5F0', '#FEE0D2', '#FCBBA1', '#FC9272', '#DE2D26', '#A50F15'],
  },
  {
    id: 'bleu',
    label: 'Bleu',
    stops: ['#F7FBFF', '#C6DBEF', '#9ECAE1', '#4292C6', '#2171B5', '#08306B'],
  },
  {
    id: 'vert',
    label: 'Vert',
    stops: ['#F7FCF5', '#C7E9C0', '#74C476', '#41AB5D', '#238B45', '#00441B'],
  },
  {
    id: 'violet',
    label: 'Violet',
    stops: ['#F2F0F7', '#DADAEB', '#BCBDDC', '#9E9AC8', '#756BB1', '#54278F'],
  },
  {
    id: 'turbo',
    label: 'Turbo',
    stops: ['#30123B', '#4675ED', '#1BD0D5', '#71F656', '#FAC829', '#B10326'],
  },
  {
    id: 'plasma',
    label: 'Plasma',
    stops: ['#0D0887', '#6A00A8', '#B12A90', '#E16462', '#FCA636', '#F0F921'],
  },
];
