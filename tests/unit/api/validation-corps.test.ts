import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Garde-fou : aucune route API ne lit un corps de requête sans le valider.
 *
 * ── Le constat (`SEC-001`) ──────────────────────────────────────────────────
 *
 * `CLAUDE.md` impose la validation Zod sur les routes API. Au 2026-09-11,
 * 40 routes écrivaient `const { x } = await request.json()` sans schéma. Deux
 * conséquences mesurées sur des routes réelles : un corps qui n'est pas du JSON
 * fait lever `request.json()` et la route répond 500 pour une faute d'appelant ;
 * une valeur du mauvais type traverse jusqu'à Postgres, qui rend un message
 * opaque (`/api/admin/users` répondait « Organization not found or inactive »
 * pour un `organization_id` qui n'était pas un UUID).
 *
 * ── Pourquoi une liste de dette plutôt qu'un test qui exige tout ────────────
 *
 * Ajouter un schéma REJETTE des entrées aujourd'hui acceptées : c'est un
 * changement de comportement, à faire route par route en lisant ce que chacune
 * tolère. Un test tout-ou-rien serait donc rouge pendant des semaines, et on le
 * désactiverait. La liste ci-dessous décrit l'état réel et ne peut que
 * rétrécir : ce test échoue aussi bien si une route la REJOINT (régression) que
 * si une entrée y reste alors que la route est traitée (liste périmée).
 *
 * Quand ce test échoue :
 *  - « n'est pas validée » → la route lit un corps sans schéma. Utiliser
 *    `lireCorps` de `lib/api/valider-corps.ts`.
 *  - « est validée mais figure encore dans DETTE » → retirer la ligne.
 *  - « n'existe plus » → retirer la ligne.
 */

const RACINE = process.cwd();
const API = join(RACINE, 'app', 'api');

/** Une route lit-elle un corps de requête ? */
const LIT_UN_CORPS = /\b(?:req|request)\.json\(\)|\.formData\(\)/;

/**
 * La valide-t-elle ? `lireCorps` (JSON) et `lireFormulaire` (multipart) sont les
 * helpers du projet ; `safeParse` couvre les routes qui appellent Zod elles-memes.
 */
const VALIDE = /\blireCorps\(|\blireFormulaire\(|\bsafeParse\(/;

/**
 * Routes qui lisent un corps SANS le valider.
 *
 * Parties de 40 le 2026-09-11, il n'en reste qu'UNE : le fichier protégé.
 *
 * Cette liste ne doit que rétrécir. Chaque retrait est un commit qui lit la
 * route, écrit son schéma en mode permissif — la forme, jamais la règle métier
 * — et vérifie qu'aucune entrée acceptée aujourd'hui ne devient un 400.
 */
const DETTE = new Set<string>([
  // Fichier PROTÉGÉ par CLAUDE.md : « NE PAS MODIFIER sauf demande explicite ».
  // C'est le moteur des isochrones multi-POI, la fonctionnalité la plus sensible
  // du produit. Y ajouter un schéma demande une demande explicite de Vincent.
  'app/api/isochrone-battle/route.ts',
]);

function routes(dossier: string): string[] {
  const trouvees: string[] = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) trouvees.push(...routes(chemin));
    else if (entree === 'route.ts') trouvees.push(chemin);
  }
  return trouvees;
}

const analysees = routes(API).map((chemin) => {
  const source = readFileSync(chemin, 'utf8');
  return {
    chemin: relative(RACINE, chemin).split(sep).join('/'),
    litUnCorps: LIT_UN_CORPS.test(source),
    valide: VALIDE.test(source),
  };
});

describe('validation des corps de requête — SEC-001', () => {
  it('trouve bien les routes API (le scan lui-meme doit etre sain)', () => {
    // Sans ce garde, un scan cassé rendrait tous les autres tests verts à vide.
    expect(analysees.length).toBeGreaterThan(100);
    expect(analysees.filter(r => r.litUnCorps).length).toBeGreaterThan(30);
  });

  it('aucune route ne lit un corps sans le valider, hors dette declaree', () => {
    const fautives = analysees
      .filter(r => r.litUnCorps && !r.valide && !DETTE.has(r.chemin))
      .map(r => r.chemin);
    expect(fautives, `Routes lisant un corps sans schema :\n${fautives.join('\n')}`).toEqual([]);
  });

  it('la liste de dette ne contient rien de perime', () => {
    const connues = new Set(analysees.map(r => r.chemin));
    const traitees = analysees.filter(r => r.valide && DETTE.has(r.chemin)).map(r => r.chemin);
    const disparues = [...DETTE].filter(c => !connues.has(c));

    expect(traitees, `Ces routes sont validees : les retirer de DETTE.\n${traitees.join('\n')}`).toEqual([]);
    expect(disparues, `Ces routes n'existent plus : les retirer de DETTE.\n${disparues.join('\n')}`).toEqual([]);
  });

  it('la dette recule — elle ne doit jamais remonter', () => {
    // 40 routes le 2026-09-11 au matin, 1 le soir — et celle-la est protegee.
    // Ce chiffre est un cliquet : le baisser quand la dette diminue, jamais le
    // monter. Le remonter demande de justifier pourquoi une route echappe a une
    // regle que CLAUDE.md declare obligatoire.
    expect(DETTE.size).toBeLessThanOrEqual(1);
  });

  it('la seule dette restante est le fichier protege', () => {
    // Si cette assertion tombe, c'est qu'une AUTRE route a ete inscrite en
    // dette : la question a se poser est pourquoi elle n'a pas de schema, pas
    // comment faire passer le test.
    expect([...DETTE]).toEqual(['app/api/isochrone-battle/route.ts']);
  });
});
