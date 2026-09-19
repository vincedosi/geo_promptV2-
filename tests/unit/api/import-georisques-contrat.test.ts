import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Test STRUCTUREL : il lit le source de la route plutôt que d'en simuler le
 * comportement. C'est délibéré, et c'est le motif déjà employé par
 * `tests/unit/carte/panneau-analyse-garde.test.ts` : un test qui simule peut
 * être vert alors que la vraie route a perdu son garde-fou. Ici les garde-fous
 * sont des règles de projet (I/O, SSRF, idempotence), et ce sont elles qu'on
 * verrouille.
 */
const BRUT = readFileSync(
  join(process.cwd(), 'app/api/admin/import-georisques/route.ts'),
  'utf8',
);

/**
 * Le source PRIVÉ de ses commentaires. Sans ça, le premier test échouait sur la
 * documentation de la route elle-même, qui cite la tournure interdite pour
 * expliquer pourquoi elle l'est. Un test de contrat doit lire le code, pas la
 * prose qui l'entoure.
 */
const SRC = BRUT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('contrat de la route d import Géorisques', () => {
  it('lit son corps par lireCorps, jamais request.json() nu', () => {
    // `await request.json()` répond 500 sur un corps illisible ; lireCorps rend
    // un 400 avec un message français.
    expect(SRC).toContain('lireCorps');
    expect(SRC).not.toMatch(/await\s+req(uest)?\.json\(\)/);
  });

  it('appelle l extérieur par lecture-avec-reprise, jamais un fetch nu', () => {
    // Importer ce module EST la déclaration que la lecture est idempotente.
    expect(BRUT).toContain('lecture-avec-reprise');
    expect(SRC).toContain('fetchLectureAvecReprise');
    expect(SRC).not.toMatch(/\bawait fetch\(/);
  });

  it('borne l hôte appelé — garde-fou SSRF', () => {
    expect(SRC).toMatch(/DOMAINES_AUTORISES\s*=\s*\['georisques\.gouv\.fr'\]/);
    expect(SRC).toContain('urlAutorisee');
  });

  it('écrit par lots de 50 au maximum', () => {
    expect(SRC).toMatch(/TAILLE_LOT\s*=\s*50/);
  });

  it('respecte le plafond de page_size mesuré sur la source', () => {
    // À 2 000 l'API rend ZÉRO ligne, sans erreur : relever cette borne rendrait
    // l'import silencieusement vide.
    expect(SRC).toMatch(/PAGE_SIZE_MAX\s*=\s*1000/);
  });

  it('distingue inséré de déjà présent — upsert suivi d un select', () => {
    expect(SRC).toContain("onConflict: 'id'");
    expect(SRC).toMatch(/\.select\('id'\)/);
  });

  it('est protégée et dynamique', () => {
    expect(SRC).toContain('requireAdmin');
    expect(SRC).toContain("export const dynamic = 'force-dynamic'");
  });

  it('émet une progression nommée, jamais un traitement silencieux', () => {
    expect(SRC).toMatch(/etape: 'demarrage'/);
    expect(SRC).toMatch(/etape: 'insertion'/);
    expect(SRC).toMatch(/etape: 'termine'/);
    expect(SRC).toContain('pourcentage');
    expect(SRC).toContain('traitees');
  });

  it('ferme le flux dans un finally — un flux interrompu ne reste pas ouvert', () => {
    expect(SRC).toMatch(/finally\s*\{[\s\S]*controller\.close\(\)/);
  });

  it('ne se fie pas au filtre statut_seveso de l API, qui est ignoré', () => {
    expect(SRC).not.toContain('statut_seveso=');
  });
});
