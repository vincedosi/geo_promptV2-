/**
 * Le filtre par nature de risque MORD, et refuse ce qu'il ne reconnaît pas.
 *
 * ── LES DEUX DÉFAUTS QUE CE FICHIER VERROUILLE ────────────────────────────
 *
 * **1. Un filtre affiché et non appliqué.** La barre de contrôle est COMMUNE
 * aux trois onglets. Décocher une nature changeait la courbe du rayon
 * d'influence — `couverture_rayon_risque` porte la dimension depuis sql/198 —
 * et ne changeait PAS le tableau des bandes juste au-dessus, qui lisait
 * `carreau_risque_distance`, construite sur un prédicat fixe. Deux chiffres
 * sur le même écran, l'un filtré, l'autre non, et rien pour le dire.
 *
 * `construire_zone_set`, lui, REFUSAIT explicitement (`filtre_nature_non_
 * supporte`) — et il avait raison : un filtre affiché mais non appliqué est le
 * pire des trois états, pire qu'un filtre absent qui ne promet rien.
 *
 * **2. Un libellé non reconnu, replié en silence.** `ordinal_nature` rend 0
 * pour l'inconnu, ce qui est CORRECT à la construction — un site hors registre
 * garde une ligne, sous « Nature non précisée ». Au filtrage, le même repli
 * sert ce seau sous le nom d'une AUTRE nature : mesuré le 2026-09-20, un
 * accent manquant sur « GPL et produits pétroliers » rendait 136 277 habitants
 * au lieu de 7 753 811. Un chiffre plausible, d'une question que personne
 * n'avait posée.
 *
 * ⚠ Ces tests LISENT la base. Aucune valeur absolue n'est figée ici — elles
 * changeront au prochain import de sites : on vérifie des RELATIONS.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

const PROFIL = {
  haut: [1000, 2000, 5000],
  bas: [500, 1000],
  autres: [],
  lie: false,
  inclurePPRT: true,
};

interface Bandes {
  calculable?: boolean;
  error?: string;
  natures_inconnues?: string[];
  total?: number;
  filtre_natures_applique?: boolean;
}

async function bandes(natures: string[] | null, parent: string | null = '13'): Promise<Bandes> {
  const { data, error } = await sb.rpc('population_par_classe', {
    p_profil: PROFIL as never,
    p_cible: 'ind',
    p_maille: 'departement',
    p_parent: parent as never,
    p_limite: 40000,
    p_natures: natures as never,
  });
  if (error) throw new Error(`population_par_classe : ${error.message}`);
  return data as unknown as Bandes;
}

/** Les libellés RÉELS du registre, jamais une liste tapée ici. */
let libelles: string[] = [];
let precalculNature = false;

beforeAll(async () => {
  const { data } = await sb
    .from('icpe_rubrique_familles')
    .select('libelle')
    .order('rang_gravite', { ascending: false });
  libelles = (data ?? []).map((r) => r.libelle as string);

  const { count } = await sb
    .from('carreau_risque_nature')
    .select('carreau_id', { count: 'exact', head: true });
  precalculNature = (count ?? 0) > 0;
});

describe('le filtre par nature mord', () => {
  it('le pré-calcul par nature existe, sinon rien de ce qui suit n’a de sens', () => {
    // Un `it` plutôt qu'un `throw` dans `beforeAll` : si la table n'est pas
    // construite sur ce poste, on veut le lire comme tel et non comme un
    // filtre cassé.
    expect(precalculNature, 'carreau_risque_nature est vide — '
      + 'construire avec scripts/construire_carreau_risque.mjs').toBe(true);
  });

  it('sans filtre, la fonction le DIT — elle ne le laisse pas deviner', async () => {
    const r = await bandes(null);
    expect(r.filtre_natures_applique).toBe(false);
    expect(r.total).toBeGreaterThan(0);
  });

  it('avec filtre, la fonction le dit ET le total DIMINUE', async () => {
    if (!precalculNature) return;
    const sans = await bandes(null);
    const avec = await bandes([libelles[0]]);

    expect(avec.filtre_natures_applique).toBe(true);
    // Une seule nature ne peut pas exposer plus de monde que toutes réunies.
    expect(avec.total!).toBeLessThan(sans.total!);
  });

  it('deux natures différentes ne rendent pas le même total', async () => {
    if (!precalculNature || libelles.length < 2) return;
    const a = await bandes([libelles[0]]);
    const b = await bandes([libelles[1]]);
    // C'est la preuve que le filtre porte sur la donnée et non sur un drapeau :
    // avant sql/219, ces deux appels rendaient le MÊME nombre.
    expect(a.total).not.toBe(b.total);
  });

  it('ajouter une nature ne peut qu’AUGMENTER le total', async () => {
    if (!precalculNature || libelles.length < 2) return;
    const une = await bandes([libelles[0]]);
    const deux = await bandes([libelles[0], libelles[1]]);
    expect(deux.total!).toBeGreaterThanOrEqual(une.total!);
  });

  it('l’ORDRE des natures ne change rien', async () => {
    if (!precalculNature || libelles.length < 2) return;
    const ab = await bandes([libelles[0], libelles[1]]);
    const ba = await bandes([libelles[1], libelles[0]]);
    expect(ab.total).toBe(ba.total);
  });
});

describe('un libellé non reconnu est REFUSÉ, jamais replié', () => {
  it('refuse et NOMME ce qu’il n’a pas reconnu', async () => {
    const r = await bandes(['Nature qui n’existe pas']);
    expect(r.calculable).toBe(false);
    expect(r.error).toBe('natures_inconnues');
    expect(r.natures_inconnues).toContain('Nature qui n’existe pas');
    // Et surtout : pas de total. Un chiffre servi ici serait celui du seau
    // « non précisée », plausible et faux.
    expect(r.total).toBeUndefined();
  });

  it('refuse le LOT ENTIER dès qu’un seul libellé est inconnu', async () => {
    if (libelles.length === 0) return;
    // Calculer sur les natures reconnues et taire l'autre rendrait un chiffre
    // juste pour une question amputée — la même famille de mensonge.
    const r = await bandes([libelles[0], 'Explosiv']);
    expect(r.calculable).toBe(false);
    expect(r.natures_inconnues).toEqual(['Explosiv']);
  });

  it('« Nature non précisée » est un filtre LÉGITIME, pas un inconnu', async () => {
    // C'est le libellé que la construction pose sur les sites hors registre :
    // le seul qui n'ait pas de ligne dans `icpe_rubrique_familles`, et qui
    // désigne pourtant un ensemble réel de carreaux.
    const { data } = await sb.rpc('natures_inconnues', {
      p_libelles: ['Nature non précisée'] as never,
    });
    expect(data).toBeNull();
  });

  it('chaque libellé du registre est reconnu', async () => {
    if (libelles.length === 0) return;
    // Le catalogue servi à l'écran et le résolveur lisent la MÊME table : si
    // ce test rougit, le menu propose une nature que le calcul refuserait.
    const { data } = await sb.rpc('natures_inconnues', {
      p_libelles: libelles as never,
    });
    expect(data).toBeNull();
  });
});
