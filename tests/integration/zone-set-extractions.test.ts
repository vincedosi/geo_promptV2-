/**
 * Les garanties d'une extraction : immuable, versionnée, idempotente.
 *
 * ── POURQUOI CES TROIS-LÀ, ET PAS LE CONTENU DU PLAN ──────────────────────
 *
 * Le contenu du plan est déjà couvert : `genererPlanCp` est une fonction pure,
 * testée en unitaire, et c'est elle — et elle seule — qui produit les
 * multiplicateurs archivés ici. Les retester à travers la base ne vérifierait
 * que la plomberie de transport.
 *
 * Ce qui n'est couvert nulle part ailleurs, c'est ce que la BASE promet :
 *
 * 1. **Immuable.** La Phase 5 comparera une diffusion à l'extraction qui l'a
 *    produite. Si v1 pouvait être réécrite, la courbe annotée « recalage v2 »
 *    comparerait v2 à elle-même — et rien, à l'écran, ne le laisserait voir.
 *    La garantie tient par un trigger et non par l'absence de route PATCH :
 *    une seconde route suffirait à la perdre.
 *
 * 2. **Idempotente.** Deux clics rapprochés sur « Extraire » ne doivent pas
 *    produire deux versions jumelles que personne ne saura départager six mois
 *    plus tard. L'empreinte porte le CONTENU et pas le commentaire : annoter
 *    différemment ne crée pas une version.
 *
 * 3. **Versionnée sans course.** Le numéro est attribué sous
 *    `pg_advisory_xact_lock` (leçon de sql/159 : un `INSERT … SELECT max+1`
 *    sans verrou est aussi exposé qu'un `SELECT max` suivi d'un `INSERT`).
 *
 * ⚠ Ce test ÉCRIT en base. Il crée son propre jeu de zones jetable plutôt que
 * d'emprunter un jeu existant : extraire depuis un vrai jeu y laisserait des
 * versions que l'écran afficherait ensuite comme de vraies extractions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

/** Le jeu jetable de ce fichier. Supprimé en fin de suite, cascade comprise. */
let jeuId: string | null = null;

/** Un plan minimal : deux codes postaux, l'un retenu, l'autre non. */
const LIGNES = [
  {
    code_postal: '13001', code_canonique: '13001', classe: 'haut:1',
    cluster_id: null, cluster_rang: 1, zone_nom: 'Zone de test',
    pop_en_zone: 1000, pop_totale: 4000, part_en_zone: 25,
    retenu: true, multiplicateur: 1.5,
  },
  {
    code_postal: '13002', code_canonique: '13002', classe: 'hors',
    cluster_id: null, cluster_rang: null, zone_nom: null,
    pop_en_zone: 0, pop_totale: 8000, part_en_zone: 0,
    retenu: false, multiplicateur: 0,
  },
];

const RESUME = {
  n_cp: 2, n_retenus: 1, taux_utile: 25, part_plan_en_zone: 100,
  population_exposee: 1000,
};

interface Retour {
  ok: boolean;
  error?: string;
  deja_extraite?: boolean;
  id?: string;
  version?: number;
  lignes_ecrites?: number;
}

async function extraire(
  lignes: unknown,
  origine = 'initiale',
  commentaire = '',
): Promise<Retour> {
  const { data, error } = await sb.rpc('creer_zone_set_extraction', {
    p_zone_set_id: jeuId!,
    p_lignes: lignes as never,
    p_resume: RESUME as never,
    p_origine: origine,
    p_commentaire: commentaire,
    p_created_by: undefined,
  });
  if (error) throw new Error(error.message);
  return data as unknown as Retour;
}

beforeAll(async () => {
  // On emprunte l'org et le profil d'un jeu existant : `zone_sets` porte des
  // colonnes NOT NULL qu'on ne peut pas inventer sans recopier le schéma ici —
  // et une copie du schéma dans un test dérive au premier `alter table`.
  const { data: modele, error } = await sb
    .from('zone_sets')
    .select('org_id, created_by, profil, cible, gravites, natures, modes, territoire, mode_plan, seuil_couverture_cp, poids, profil_hash, custom_geo_zone_id')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!modele) throw new Error('Aucun jeu de zones en base : ce test a besoin d’un modèle.');

  const { data: cree, error: erreurCree } = await sb
    .from('zone_sets')
    .insert({
      ...modele,
      nom: `__test extractions ${Date.now()}`,
      description: 'jeu jetable créé par tests/integration/zone-set-extractions',
      brouillon: false,
      // `construit_le` est la condition d'extraction : sans lui la RPC refuse,
      // et c'est justement l'un des refus qu'on vérifie plus bas.
      construit_le: new Date().toISOString(),
      population_exposee: 1000,
      n_cp_retenus: 1,
      taux_utile: 25,
      // Un hash propre : l'index unique partiel ne porte que sur les
      // brouillons, mais deux jeux au même hash prêteraient à confusion.
      profil_hash: `__test_${Date.now()}`,
    })
    .select('id')
    .single();
  if (erreurCree) throw new Error(erreurCree.message);
  jeuId = cree.id;
});

afterAll(async () => {
  // Cascade : les extractions et leurs lignes partent avec le jeu.
  if (jeuId) await sb.from('zone_sets').delete().eq('id', jeuId);
});

describe('extractions d’un jeu de zones (sql/231)', () => {
  it('la première extraction est la v1, et elle écrit toutes ses lignes', async () => {
    const r = await extraire(LIGNES, 'initiale', 'première');
    expect(r.ok).toBe(true);
    expect(r.deja_extraite).toBe(false);
    expect(r.version).toBe(1);
    expect(r.lignes_ecrites).toBe(LIGNES.length);
  });

  it('ré-extraire le MÊME contenu rend la version existante, même annotée autrement', async () => {
    // L'ordre des lignes est inversé et le commentaire change : ni l'un ni
    // l'autre ne définit une extraction. Sans le `order by` de l'empreinte,
    // l'inversion suffirait à créer une jumelle.
    const r = await extraire([...LIGNES].reverse(), 'initiale', 'un tout autre commentaire');
    expect(r.ok).toBe(true);
    expect(r.deja_extraite).toBe(true);
    expect(r.version).toBe(1);
  });

  it('des multiplicateurs différents créent une v2, marquée recalage', async () => {
    const recalees = LIGNES.map((l) => ({ ...l, multiplicateur: l.multiplicateur * 2 }));
    const r = await extraire(recalees, 'recalage', 'après mesure');
    expect(r.ok).toBe(true);
    expect(r.deja_extraite).toBe(false);
    expect(r.version).toBe(2);

    const { data } = await sb
      .from('zone_set_extractions')
      .select('version, origine')
      .eq('zone_set_id', jeuId!)
      .eq('version', 2)
      .single();
    expect(data?.origine).toBe('recalage');
  });

  it('un plan vide est REFUSÉ, et non archivé comme une extraction vide', async () => {
    // L'archiver produirait une version qu'on croirait valide — et la Phase 5
    // comparerait une diffusion à un plan inexistant.
    const r = await extraire([]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('plan_vide');
  });

  it('une extraction ne peut pas être modifiée — la garantie tient en base', async () => {
    const { error } = await sb
      .from('zone_set_extractions')
      .update({ commentaire: 'réécrit' })
      .eq('zone_set_id', jeuId!)
      .eq('version', 1);
    // ⚠ supabase-js ne LÈVE pas : il rend `{ error }`. Tester l'absence
    // d'exception laisserait ce test vert sur un trigger supprimé.
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toMatch(/immuable/i);
  });

  it('ses LIGNES non plus ne peuvent pas être modifiées', async () => {
    const { data: v1 } = await sb
      .from('zone_set_extractions')
      .select('id')
      .eq('zone_set_id', jeuId!)
      .eq('version', 1)
      .single();

    const { error } = await sb
      .from('zone_set_extraction_cp')
      .update({ multiplicateur: 9 })
      .eq('extraction_id', v1!.id);
    expect(error).not.toBeNull();
    // Le message nomme la TABLE : sur la fille, `old.id` n'existe pas, et une
    // version naïve du trigger faisait lever « record "old" has no field "id" »
    // — un refus qui marche, mais qui envoie chercher un défaut de schéma.
    expect(error?.message ?? '').toMatch(/immuable/i);
  });

  it('la population d’un membre indiscernable reste NULL, jamais zéro', async () => {
    // Nantes 44200 quand 44000 porte le groupe : on ne sait pas combien
    // d'exposés y habitent. Zéro se lirait « ce code postal n'expose
    // personne », ce qui est faux et ferait sous-estimer le groupe.
    const membre = {
      code_postal: '44200', code_canonique: '44000', classe: 'haut:3',
      cluster_id: null, cluster_rang: 2, zone_nom: 'Nantes',
      pop_en_zone: null, pop_totale: null, part_en_zone: null,
      retenu: false, multiplicateur: 0.25,
    };
    const r = await extraire([...LIGNES, membre], 'initiale', 'avec un membre de groupe');
    expect(r.ok).toBe(true);

    const { data } = await sb
      .from('zone_set_extraction_cp')
      .select('pop_totale, pop_en_zone, code_canonique')
      .eq('extraction_id', r.id!)
      .eq('code_postal', '44200')
      .single();
    expect(data?.pop_totale).toBeNull();
    expect(data?.pop_en_zone).toBeNull();
    expect(data?.code_canonique).toBe('44000');
  });
});
