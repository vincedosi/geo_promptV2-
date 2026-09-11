import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Détection de dérive entre ARCHITECTURE.md et le code réel.
 *
 * ── Pourquoi ce test existe ─────────────────────────────────────────────────
 *
 * « Se souvenir de mettre à jour la doc » est une discipline, et une discipline
 * finit par céder. Le 2026-09-11, `docs/architecture.md` datait du 30 avril et
 * affirmait « 70 tables — RLS partout » : ça se lit comme une garantie de
 * sécurité alors que les policies sont dormantes (146 routes sur 146 passent
 * par `service_role` et les contournent). Une doc périmée ne se contente pas
 * d'être inutile — elle ment, et avec autorité.
 *
 * Ce test ne vérifie pas que la doc est BIEN écrite. Il vérifie qu'elle n'a pas
 * silencieusement divergé du code sur les faits qu'on peut mesurer : les
 * variables d'environnement, les dépendances externes, et l'unicité de la
 * source de vérité.
 *
 * ── Ce qu'il ne fait PAS, délibérément ──────────────────────────────────────
 *
 * Il ne compare pas la liste des 170 routes une par une. Ce serait un test
 * qu'on désactiverait au premier ajout de route légitime — et un test qu'on
 * éteint ne garde rien. On vérifie les faits stables et structurants, ceux dont
 * l'oubli coûte cher : une dépendance externe non documentée, une variable
 * d'environnement obligatoire absente, un second document d'architecture qui
 * repart.
 */

const RACINE = process.cwd();
const lire = (p: string) => readFileSync(join(RACINE, p), 'utf-8');

describe('dérive entre ARCHITECTURE.md et le code', () => {
  const archi = lire('ARCHITECTURE.md');

  it('une seule source de vérité : pas de second document d architecture', () => {
    // Le 11/09 il en existait trois. On n'en synchronise jamais trois.
    // Piège Windows : docs/architecture.md et docs/ARCHITECTURE.md sont le
    // MÊME fichier — écrire l'un écrase l'autre en silence.
    const concurrent = join(RACINE, 'docs', 'architecture.md');
    expect(
      existsSync(concurrent),
      'docs/architecture.md est réapparu. Le document autoritaire est ARCHITECTURE.md à la racine, '
      + 'déclaré par CLAUDE.md (@ARCHITECTURE.md). Fusionner puis supprimer le doublon.',
    ).toBe(false);
  });

  it('toute variable d env obligatoire du code est documentée', () => {
    // Une variable dont l'absence fait lever une route DOIT être dans la doc,
    // sinon un déploiement neuf casse sans que personne ne sache pourquoi.
    const exemple = lire('.env.example');
    const declarees = Array.from(exemple.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)).map(m => m[1]);
    const critiques = declarees.filter(v =>
      /^(SUPABASE|NEXT_PUBLIC_SUPABASE|MODAL|ORS|GOOGLE_GENERATIVE|DSP_ENC)/.test(v));

    const absentes = critiques.filter(v => !archi.includes(v));
    expect(
      absentes,
      `Variables d'environnement critiques absentes d'ARCHITECTURE.md : ${absentes.join(', ')}. `
      + `Les ajouter au tableau « Variables d'environnement ».`,
    ).toEqual([]);
  });

  it('toute dépendance externe appelée par le code est documentée', () => {
    // Modal manquait : lib/bidding-ml/client.ts appelait un serverless Python
    // tiers, invisible dans le doc autoritaire. Seul le doc PÉRIMÉ en parlait.
    const hotesExternes: Array<[string, string]> = [
      ['modal.run', 'Modal'],
      ['openrouteservice', 'OpenRouteService'],
      ['open-meteo', 'Open-Meteo'],
    ];
    const manquants = hotesExternes
      .filter(([, nom]) => !archi.toLowerCase().includes(nom.toLowerCase()))
      .map(([, nom]) => nom);

    expect(
      manquants,
      `Dépendances externes appelées par le code mais absentes d'ARCHITECTURE.md : ${manquants.join(', ')}.`,
    ).toEqual([]);
  });

  it('la dormance des RLS reste écrite noir sur blanc', () => {
    // C'est l'affirmation dont l'inverse a déjà été écrit dans un doc périmé
    // (« RLS partout »). Tant que les routes passent par service_role, le doc
    // doit le dire — c'est une information de sécurité, pas un détail.
    expect(
      /DORMANTES|dormantes|ne s'exécutent jamais/.test(archi),
      "ARCHITECTURE.md ne mentionne plus que les policies RLS sont dormantes. "
      + "Si c'est parce que la clé anon est enfin utilisée, tant mieux — mettre à jour ce test. "
      + "Sinon, la mention doit rester : un lecteur en conclut que la base est protégée.",
    ).toBe(true);
  });
});
