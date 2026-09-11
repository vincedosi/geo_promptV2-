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

/** Le valide-t-elle ? `lireCorps` est le helper du projet ; `safeParse` le Zod nu. */
const VALIDE = /\blireCorps\(|\bsafeParse\(/;

/**
 * Routes qui lisent un corps SANS le valider, au 2026-09-11.
 *
 * Cette liste ne doit que rétrécir. Chaque retrait est un commit qui lit la
 * route, écrit son schéma en mode permissif — la forme, jamais la règle métier
 * — et vérifie qu'aucune entrée acceptée aujourd'hui ne devient un 400.
 */
const DETTE = new Set<string>([
  // Fichier PROTÉGÉ par CLAUDE.md : ne pas modifier sans demande explicite.
  'app/api/isochrone-battle/route.ts',
  // Imports et traitements batch — corps volumineux, formes hétérogènes.
  'app/api/admin/geocode/batch/route.ts',
  'app/api/admin/geocode/update/route.ts',
  'app/api/admin/import-datagouv/route.ts',
  'app/api/admin/import-geo/register/route.ts',
  'app/api/admin/import-geo/route.ts',
  'app/api/admin/import-ooh/arcgis/route.ts',
  'app/api/admin/import-poi/dry-run/route.ts',
  'app/api/admin/import-poi/execute/route.ts',
  'app/api/admin/import-poi/parse/route.ts',
  'app/api/iris-crawler/manual-import/route.ts',
  'app/api/iris-crawler/manual-upload/route.ts',
  'app/api/radio/import-arcom-ods/route.ts',
  // Administration et référentiels.
  'app/api/admin/campaigns/[id]/organizations/route.ts',
  'app/api/admin/dsp/dv360/oauth/start/route.ts',
  'app/api/admin/init-admin/route.ts',
  'app/api/admin/iris/metadata/route.ts',
  'app/api/admin/organizations/[id]/sources/assign/route.ts',
  'app/api/admin/organizations/[id]/sources/route.ts',
  'app/api/admin/poi-categories/route.ts',
  'app/api/admin/sources/[id]/route.ts',
  'app/api/admin/sources/route.ts',
  // Copilote, agents et calculs — corps portant des historiques de conversation
  // ou des géométries, à modéliser avec soin.
  'app/api/agent/analyze-drift/route.ts',
  'app/api/agent/apply-recommendation/route.ts',
  'app/api/agent/chat/route.ts',
  'app/api/bidding/train/route.ts',
  'app/api/chat/route.ts',
  'app/api/digital/[campaignId]/ai-analysis/route.ts',
  'app/api/isochrone-battle/apply-battle/route.ts',
  'app/api/isochrone-cache-check/route.ts',
  'app/api/map/ooh/route.ts',
  'app/api/pilot/route.ts',
  'app/api/smart-prompt/route.ts',
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
    // Valeur de depart mesuree le 2026-09-11 : 40 routes. Ce chiffre est un
    // cliquet : le baisser quand la dette diminue, jamais le monter.
    expect(DETTE.size).toBeLessThanOrEqual(33);
  });
});
