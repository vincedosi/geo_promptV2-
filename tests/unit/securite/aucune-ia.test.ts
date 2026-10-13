import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Verrou : plus aucune IA dans le code de dentsu.explore.
 *
 * Décision du propriétaire (2026-10-07 puis 2026-10-12) : « je veux plus rien
 * d'IA dans le code » — le copilote, l'agent d'enchères, les bilans, le ML
 * Modal et leurs clés ont été retirés en six lots, et AIDA (le shell dentsu)
 * devient l'IA. Ce test empêche qu'un de ces éléments revienne par une
 * dépendance, une variable d'environnement ou un appel réseau.
 *
 * Il balaie TOUS les fichiers suivis par git, tous langages confondus, sauf :
 * `docs/` et `.superpowers/` (historique et plans), `sql/` (migrations
 * historiques REJOUABLES : elles portent l'histoire de la base, où des tables
 * et RPC d'IA subsistent volontairement — liste du propriétaire ; les réécrire
 * changerait ce qu'une base neuve reconstruit), les `.md` (la doc raconte ce
 * qui a été retiré) et ce fichier, qui cite les motifs qu'il traque.
 *
 * Ce qui reste volontairement en base (tables et RPC d'IA, liste remise au
 * propriétaire) n'est pas du code : aucune règle ici ne les vise.
 */

const RACINE = process.cwd();

const IGNORES = [/^docs\//, /^\.superpowers\//, /^sql\//, /\.md$/];
const TOLERES = new Set<string>(['tests/unit/securite/aucune-ia.test.ts']);

/** Paquets d'IA que `package.json` ne doit plus déclarer. */
const PAQUETS_INTERDITS = [
  /^ai$/,
  /^@ai-sdk\//,
  /^openai$/,
  /^mistralai$/,
  /^@anthropic-ai\//,
  /^@google\/generative-ai$/,
  /^@mistralai\//,
];

const FORMES: { nom: string; detecte: RegExp }[] = [
  {
    nom: "import du SDK d'IA (`ai` ou `@ai-sdk/*`)",
    detecte: /(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*['"](?:ai|@ai-sdk\/[^'"]+)['"]/,
  },
  {
    nom: "clé de fournisseur d'IA (Gemini, Mistral) ou variable Modal",
    detecte: /GOOGLE_GENERATIVE_AI_API_KEY|MISTRAL_API_KEY|MODAL_BIDDING_ML_URL|MODAL_CLUSTERING_URL|MODAL_TOKEN_ID|MODAL_TOKEN_SECRET/,
  },
  {
    nom: "appel réseau vers un fournisseur d'IA",
    detecte: /generativelanguage\.googleapis\.com|api\.mistral\.ai|\bmodal\.run\b/,
  },
  {
    nom: "import d'un autre SDK d'IA (openai, mistralai, @anthropic-ai/*, @google/generative-ai, @mistralai/*)",
    detecte: /(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*['"](?:openai|mistralai|@anthropic-ai\/[^'"]+|@google\/generative-ai|@mistralai\/[^'"]+)['"]/,
  },
  {
    nom: "appel d'une route d'IA supprimée (/api/chat, /api/smart-prompt, /api/providers)",
    detecte: /['"`]\/api\/(?:chat|smart-prompt|providers)\b/,
  },
];

function fichiersSuivis(): string[] {
  const sortie = execFileSync('git', ['ls-files', '-z'], {
    cwd: RACINE,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return sortie
    .split('\0')
    .filter(Boolean)
    .filter((f) => !IGNORES.some((re) => re.test(f)) && !TOLERES.has(f));
}

function lireTexte(chemin: string): string | null {
  try {
    const abs = join(RACINE, chemin);
    const st = statSync(abs);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return null;
    const buf = readFileSync(abs);
    if (buf.subarray(0, 4096).includes(0)) return null; // binaire
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

describe("aucune IA dans le code", () => {
  const fichiers = fichiersSuivis();

  it('le balayage voit bien les fichiers suivis', () => {
    expect(fichiers.length).toBeGreaterThan(500);
  });

  for (const forme of FORMES) {
    it(`aucun fichier suivi ne porte : ${forme.nom}`, () => {
      const fautifs: string[] = [];
      for (const f of fichiers) {
        const contenu = lireTexte(f);
        if (contenu !== null && forme.detecte.test(contenu)) fautifs.push(f);
      }
      expect(fautifs, `Fichiers fautifs : ${fautifs.join(', ')}`).toEqual([]);
    });
  }

  it("package.json (racine et angular/) ne déclare aucun paquet d'IA", () => {
    const fautifs: string[] = [];
    for (const p of ['package.json', 'angular/package.json']) {
      const brut = lireTexte(p);
      if (brut === null) continue;
      const pkg = JSON.parse(brut) as Record<string, Record<string, string> | undefined>;
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const nom of Object.keys(pkg[section] ?? {})) {
          if (PAQUETS_INTERDITS.some((re) => re.test(nom))) fautifs.push(`${p} › ${section} › ${nom}`);
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("package-lock.json ne résout aucun paquet d'IA", () => {
    // Lu directement : le lockfile dépasse la borne de taille de `lireTexte`.
    const fautifs: string[] = [];
    for (const p of ['package-lock.json', 'angular/package-lock.json']) {
      const brut = readFileSync(join(RACINE, p), 'utf8');
      const lock = JSON.parse(brut) as { packages?: Record<string, unknown> };
      for (const k of Object.keys(lock.packages ?? {})) {
        const nom = k.split('node_modules/').pop() ?? '';
        if (PAQUETS_INTERDITS.some((re) => re.test(nom))) fautifs.push(`${p} › ${k}`);
      }
    }
    expect(fautifs).toEqual([]);
  });
});
