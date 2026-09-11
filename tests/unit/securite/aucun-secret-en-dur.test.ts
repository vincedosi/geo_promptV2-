import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Garde-fou : aucun secret en dur dans les fichiers suivis par git.
 *
 * ── Ce que ce test verrouille ───────────────────────────────────────────────
 *
 * Le 2026-09-11, **sept scripts Python versionnés portaient la clé
 * `service_role` en clair** — et la comparaison d'empreintes a montré que
 * c'était la clé ACTIVE, pas une ancienne. Cette clé contourne toute RLS : elle
 * donne un accès complet en lecture et en écriture à la base.
 *
 * L'audit de sécurité de la veille ne l'avait pas vue : il cherchait des secrets
 * dans le code TypeScript côté client. Les scripts Python n'étaient pas dans son
 * champ. D'où ce test, qui ne regarde pas un langage mais TOUS les fichiers
 * suivis par git.
 *
 * Il ne remplace pas la rotation : retirer une clé du code ne l'efface pas de
 * l'historique git. Il empêche seulement qu'une nouvelle y entre.
 */

const RACINE = process.cwd();

/**
 * Formes recherchées. Volontairement peu nombreuses et précises : un motif trop
 * large produit des faux positifs, et un test qu'on apprend à ignorer ne protège
 * plus rien.
 */
const FORMES: { nom: string; detecte: (contenu: string) => boolean }[] = [
  {
    nom: 'JWT Supabase (anon ou service_role)',
    detecte: (c) => /eyJhbGciOiJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{20,}/.test(c),
  },
  {
    nom: 'clé secrète Supabase nouveau format',
    detecte: (c) => /\bsb_secret_[A-Za-z0-9_-]{16,}/.test(c),
  },
  {
    nom: 'clé OpenAI / Anthropic',
    detecte: (c) => /\b(sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9-]{20,})/.test(c),
  },
  {
    // L'en-tête PEM seul ne prouve rien : deux fixtures du projet portent
    // « BEGIN PRIVATE KEY / abc / END », dont le corps est littéralement « abc ».
    // Ce qui fait un secret, c'est la CHARGE — on mesure donc le corps encodé
    // entre les deux marqueurs. Mettre ces deux fichiers dans une liste
    // d'exceptions aurait masqué une vraie clé qui s'y serait glissée ensuite.
    nom: 'clé privée PEM',
    detecte: (c) => {
      const blocs = c.match(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END/g) ?? [];
      return blocs.some((bloc) => (bloc.match(/[A-Za-z0-9+/=]/g) ?? []).length > 200);
    },
  },
];

/** Ce fichier cite les motifs qu'il traque : il ne peut pas s'auto-signaler. */
const TOLERES = new Set<string>(['tests/unit/securite/aucun-secret-en-dur.test.ts']);

/** Les fichiers réellement SUIVIS par git — pas ceux ignorés (.env.local…). */
function fichiersSuivis(): string[] {
  try {
    return execFileSync('git', ['ls-files'], {
      cwd: RACINE, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    }).split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const EXTENSIONS_TEXTE = /\.(ts|tsx|js|jsx|mjs|cjs|py|sql|json|md|ya?ml|sh|ps1|txt|example)$/i;

/**
 * Recolle les littéraux de chaîne adjacents avant de chercher.
 *
 * **C'est ce qui manquait, et la première version de ce test était décorative
 * à cause de ça.** Les sept scripts fautifs écrivaient la clé DÉCOUPÉE :
 *
 *     SUPABASE_KEY = (
 *         "eyJhbGciOi…"
 *         ".eyJpc3MiOi…"
 *     )
 *
 * Le fichier ne contient donc jamais le jeton d'un seul tenant : entre les deux
 * moitiés, il y a un guillemet, un saut de ligne et de l'indentation. Un motif
 * qui cherche la forme complète passe à côté — vérifié : le test est resté vert
 * sur un fichier qui portait bel et bien la clé active.
 *
 * Retirer les `"…"` de jonction reconstitue la chaîne telle que l'interpréteur
 * la verra. Ça vaut pour Python comme pour JavaScript, qui concatènent l'un et
 * l'autre les littéraux adjacents.
 */
function recollerLitteraux(contenu: string): string {
  return contenu
    .replace(/"\s*\+?\s*"/g, '')   // "abc" "def"  et  "abc" + "def"
    .replace(/'\s*\+?\s*'/g, '')
    .replace(/`\s*\+?\s*`/g, '');
}

const suivis = fichiersSuivis();
const infractions: { fichier: string; forme: string }[] = [];

for (const fichier of suivis) {
  if (TOLERES.has(fichier) || !EXTENSIONS_TEXTE.test(fichier)) continue;
  const chemin = join(RACINE, fichier);
  let contenu: string;
  try {
    if (statSync(chemin).size > 4 * 1024 * 1024) continue;
    contenu = readFileSync(chemin, 'utf8');
  } catch {
    continue;
  }
  const recolle = recollerLitteraux(contenu);
  for (const { nom, detecte } of FORMES) {
    if (detecte(contenu) || detecte(recolle)) infractions.push({ fichier, forme: nom });
  }
}

describe('aucun secret en dur dans le dépôt', () => {
  it('le scan lit bien les fichiers suivis par git', () => {
    // Sans ce garde, un `git ls-files` muet rendrait le test suivant vert à vide.
    expect(suivis.length).toBeGreaterThan(300);
    expect(suivis).toContain('package.json');
  });

  it('les détecteurs reconnaissent un secret et épargnent une fixture', () => {
    // Le test doit pouvoir echouer. Aucun vrai secret ici : tout est fabrique.
    const jwtFabrique = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiZXhlbXBsZV9mYWJyaXF1ZSJ9';
    expect(FORMES[0].detecte(jwtFabrique)).toBe(true);
    expect(FORMES[0].detecte('rien a voir')).toBe(false);

    const pemFixture = '-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----';
    expect(FORMES[3].detecte(pemFixture)).toBe(false);

    const pemCharge = '-----BEGIN PRIVATE KEY-----' + 'A'.repeat(400) + '-----END PRIVATE KEY-----';
    expect(FORMES[3].detecte(pemCharge)).toBe(true);
  });

  it('voit un secret DÉCOUPÉ en littéraux concaténés — le trou d origine', () => {
    // Forme exacte des sept scripts fautifs : la cle etait coupee en deux, donc
    // jamais contigue dans le fichier. Sans recollage, le test restait vert sur
    // un fichier qui portait la cle active. Jeton fabrique ci-dessous.
    const decoupe = [
      'SUPABASE_KEY = (',
      '    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"',
      '    ".eyJyb2xlIjoiZmFicmlxdWVfcG91cl9sZV90ZXN0In0"',
      ')',
    ].join('\n');

    expect(FORMES[0].detecte(decoupe)).toBe(false);                    // invisible tel quel
    expect(FORMES[0].detecte(recollerLitteraux(decoupe))).toBe(true);  // visible une fois recolle
  });

  it('aucun fichier suivi ne porte de secret', () => {
    const liste = infractions.map((i) => `${i.fichier} — ${i.forme}`);
    expect(
      liste,
      `Secret en dur détecté :\n${liste.join('\n')}\n\n`
        + `Le retirer du code NE SUFFIT PAS : une clé déjà commitée doit être `
        + `RÉVOQUÉE et remplacée côté fournisseur — elle reste dans l'historique git.`,
    ).toEqual([]);
  });
});
