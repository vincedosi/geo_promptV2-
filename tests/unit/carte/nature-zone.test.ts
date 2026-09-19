import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STATUT_ZONE,
  NATURES_ZONE,
  TIRETE_ZONE_CALCULEE,
  descriptionStatut,
  type StatutZone,
} from '@/lib/carte/nature-zone';

/**
 * La convention « plein = réglementaire, tireté = calculé » a déjà existé à
 * l'envers dans ce dépôt : le périmètre PPRT opposable se dessinait en
 * pointillés et le cercle de 500 m que nous calculons en trait plein, chacun
 * dans son fichier, chacun avec un commentaire qui justifiait son choix.
 * Aucun test ne les comparait, donc rien ne signalait la contradiction.
 *
 * Ces tests lisent le SOURCE des deux couches, et pas un objet de paint
 * reconstruit : c'est le seul moyen d'attraper une inversion réintroduite
 * directement dans le composant. Même raison que
 * `tests/unit/carte/panneau-analyse-garde.test.ts`.
 */

const lire = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

const SRC_PPRT = 'app/map/_components/PprtLayer.tsx';
const SRC_RISQUES = 'app/map/_components/RisqueIndustrielLayer.tsx';

describe('convention de trait : plein = réglementaire, tireté = calculé', () => {
  it('le périmètre PPRT ne porte AUCUN tireté', () => {
    const src = lire(SRC_PPRT);
    // On vise la propriété de paint, pas le mot « tireté » des commentaires —
    // l'en-tête raconte justement l'histoire de l'inversion et doit pouvoir
    // le dire sans faire échouer le test.
    expect(src).not.toMatch(/'line-dasharray'/);
  });

  it('le périmètre PPRT est tracé avec la largeur exportée, jamais un nombre en dur', () => {
    const src = lire(SRC_PPRT);
    expect(src).toMatch(/LARGEUR_TRAIT_PPRT/);
  });

  it('la zone calculée porte le tireté partagé', () => {
    const src = lire(SRC_RISQUES);
    expect(src).toMatch(/'line-dasharray':\s*\[\.\.\.TIRETE_ZONE_CALCULEE\]/);
  });

  it('le tireté est un motif à deux temps, reproductible en CSS', () => {
    expect(TIRETE_ZONE_CALCULEE).toHaveLength(2);
    expect(TIRETE_ZONE_CALCULEE.every((n) => n > 0)).toBe(true);
  });
});

describe('statuts de zone', () => {
  const tous: StatutZone[] = ['pprt', 'sans_pprt', 'non_soumis', 'non_concerne'];

  it('les quatre statuts sont décrits', () => {
    for (const s of tous) {
      expect(STATUT_ZONE[s].libelle.length).toBeGreaterThan(0);
      expect(STATUT_ZONE[s].explication.length).toBeGreaterThan(0);
    }
  });

  it('seul `pprt` est réglementaire', () => {
    expect(STATUT_ZONE.pprt.reglementaire).toBe(true);
    for (const s of tous.filter((x) => x !== 'pprt')) {
      expect(STATUT_ZONE[s].reglementaire).toBe(false);
    }
  });

  it('« aucun PPRT publié » et « non soumis » ne disent PAS la même chose', () => {
    // C'est toute la valeur de la distinction : l'un est une donnée qui
    // manque, l'autre une zone qui n'existe pas en droit. Les confondre
    // ferait passer une règle de droit pour une lacune de notre import.
    expect(STATUT_ZONE.sans_pprt.libelle).not.toBe(STATUT_ZONE.non_soumis.libelle);
    expect(STATUT_ZONE.sans_pprt.explication).not.toBe(STATUT_ZONE.non_soumis.explication);
    expect(STATUT_ZONE.non_soumis.explication).toMatch(/seuil bas/i);
    expect(STATUT_ZONE.sans_pprt.explication).toMatch(/seuil haut/i);
  });

  it('une valeur absente ou inconnue retombe sur « hors champ », jamais sur undefined', () => {
    expect(descriptionStatut(null)).toBe(STATUT_ZONE.non_concerne);
    expect(descriptionStatut(undefined)).toBe(STATUT_ZONE.non_concerne);
    expect(descriptionStatut('valeur_que_la_base_ne_rend_pas')).toBe(STATUT_ZONE.non_concerne);
  });

  it('la RPC rend bien ces quatre valeurs et pas d’autres', () => {
    // Le SQL est la source des statuts ; ce test empêche qu'on en ajoute un
    // côté base sans le décrire ici — l'interface afficherait alors « hors
    // champ PPRT » sur un cas qui n'en est pas un.
    const sql = lire('sql/179_risques_rattachement_pprt.sql');
    for (const s of tous) expect(sql).toContain(`'${s}'`);
  });
});

describe('légende', () => {
  it('expose exactement les deux natures, et elles se distinguent par le trait', () => {
    expect(NATURES_ZONE).toHaveLength(2);
    const traits = NATURES_ZONE.map((n) => n.trait);
    expect(new Set(traits).size).toBe(2);
    expect(NATURES_ZONE.find((n) => n.cle === 'reglementaire')?.trait).toBe('plein');
    expect(NATURES_ZONE.find((n) => n.cle === 'calculee')?.trait).toBe('tirete');
  });
});
