import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Verrous STRUCTURELS sur le calcul de population exposée.
 *
 * Ils lisent le SQL, pas la base : ils tournent donc en CI sans Postgres, et
 * ils attrapent une régression au moment où elle est écrite, pas au moment où
 * quelqu'un remarque un chiffre bizarre.
 *
 * ── POURQUOI CES TESTS EXISTENT ───────────────────────────────────────────
 *
 * Deux audits successifs ont trouvé CINQ défauts sur ce module, et tous
 * étaient de la même famille : **une colonne qui existe et ment**. Aucun ne
 * levait d'erreur, aucun ne se voyait à la relecture.
 *
 *   `carreaux_filosofi.ind`            NULL sur 2 298 582 lignes
 *   `carreaux_filosofi.geom_centroid`  NULL sur 2 298 582 lignes
 *   `ref_codes_postaux.pop_total`      110,5 % de la population française
 *   `ref_codes_postaux.surface_km2`    109,3 % du territoire
 *
 * Chacun de ces pièges est ici transformé en test. Le jour où quelqu'un
 * réécrit la fonction et retombe dedans — ce qui m'est arrivé à huit heures
 * d'intervalle sur deux colonnes de la même table — la suite rougit.
 */

const RACINE = process.cwd();

/** La migration la plus récente définissant `population_exposee_agregee`. */
function sqlCourant(): { fichier: string; contenu: string } {
  const fichiers = readdirSync(join(RACINE, 'sql'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  for (const f of fichiers) {
    const contenu = readFileSync(join(RACINE, 'sql', f), 'utf-8');
    if (contenu.includes('create or replace function public.population_exposee_agregee(')) {
      return { fichier: f, contenu };
    }
  }
  throw new Error('Aucune migration ne définit population_exposee_agregee');
}

/** Le corps de la fonction, hors commentaires : c'est lui qui s'exécute. */
function corpsExecutable(contenu: string): string {
  const d = contenu.indexOf('create or replace function public.population_exposee_agregee(');
  const f = contenu.indexOf('$function$;', d);
  return contenu
    .slice(d, f)
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
}

describe('population exposée — les colonnes qui mentent', () => {
  const { contenu } = sqlCourant();
  const corps = corpsExecutable(contenu);

  it('ne lit JAMAIS la colonne `ind` de carreaux_filosofi — elle est NULL partout', () => {
    // La population vit dans `metadata->>'ind'`. Lire la colonne rendrait ZÉRO
    // sur toute la France, sans la moindre erreur.
    expect(corps).not.toMatch(/\bc\.ind\b/);
    expect(corps).not.toMatch(/select[^;]*\bind\b\s*(,|from)(?![^;]*metadata)/i);
    // Et elle lit bien le jsonb.
    expect(corps).toMatch(/metadata->>p_cible/);
  });

  it('ne lit JAMAIS `geom_centroid` — NULL partout, ce qui vidait la dimension code postal', () => {
    expect(corps).not.toMatch(/geom_centroid/);
    // Le centroïde est calculé.
    expect(corps).toMatch(/ST_Centroid\(\s*c\.geom_3857\s*\)/);
  });

  it('ne prend PAS son dénominateur dans ref_codes_postaux — il surcompte de 10 %', () => {
    // `pop_total` rend 110,5 % de la population française et `surface_km2`
    // 109,3 % du territoire : un carreau à cheval sur deux codes postaux y
    // compte deux fois. La part était donc fausse sur l'encodage par défaut
    // de la carte.
    expect(corps).not.toMatch(/cp\.pop_total/);
    expect(corps).not.toMatch(/cp\.surface_km2/);
  });

  it('prend son dénominateur dans iris_agg_departement — 100,0 % du chiffre INSEE', () => {
    expect(corps).toMatch(/iris_agg_departement/);
    expect(corps).toMatch(/a\.population/);
    expect(corps).toMatch(/a\.superficie_km2/);
  });
});

describe('population exposée — les règles de calcul', () => {
  const { contenu } = sqlCourant();
  const corps = corpsExecutable(contenu);

  it('unit les zones DANS chaque carreau — sinon les recouvrements comptent deux fois', () => {
    // Sommer naïvement surestime de 62,2 % en mode buffer sur un département
    // dense (mesure du 2026-09-18 : 334 401 au lieu de 206 169).
    expect(corps).toMatch(/ST_Union\(\s*ST_Intersection\(/);
    // Groupé par carreau, jamais par (carreau × unité) : c'est ce qui fait
    // passer le calcul de 54 s à 3 s.
    expect(corps).toMatch(/group by c\.id\b/);
  });

  it('arrondit de façon CUMULATIVE — la somme des lignes doit retomber sur le total', () => {
    // Un `round()` par ligne faisait afficher 5 804 pour un total de 5 805, et
    // l'écart grandit avec le nombre de lignes. Or l'écran affirme que la
    // somme égale le total.
    expect(corps).toMatch(/rows between unbounded preceding and 1 preceding/);
  });

  it('arrondit le total UNE fois, sur la somme non arrondie', () => {
    // Sinon le total dépend du NOMBRE de lignes, et les trois dimensions
    // divergent entre elles (région 5 805, département 5 804).
    expect(corps).toMatch(/'total_exposee',\s*\(select round\(coalesce\(sum\(exposee\), 0\)\) from agrege\)/);
  });

  it('construit le buffer sur `geography` — en 3857, « 500 m » en couvrirait 685', () => {
    expect(corps).toMatch(/ST_Buffer\(\s*ST_SetSRID\(ST_MakePoint\([^)]*\), 4326\)::geography/);
  });

  it('valide la cible contre le catalogue — seule barrière contre l’injection', () => {
    expect(corps).toMatch(/from public\.cibles_exposition where code = p_cible/);
  });

  it('compte les carreaux non rattachés — un chiffre amputé en silence est pire qu’absent', () => {
    expect(corps).toMatch(/'carreaux_non_attribues'/);
  });

  it('retire l’exécution à anon et authenticated', () => {
    // PostgreSQL accorde EXECUTE à PUBLIC par défaut : ne rien écrire suffit à
    // ouvrir la fonction à quiconque a la clé publique de l'app.
    expect(contenu).toMatch(/revoke all on function public\.population_exposee_agregee/);
    expect(contenu).toMatch(/grant execute on function public\.population_exposee_agregee[\s\S]*?to service_role/);
  });
});

describe('population exposée — le catalogue des cibles', () => {
  it('ne contient que des EFFECTIFS, jamais un taux', () => {
    // On peut prendre 30 % des habitants d'un carreau ; on ne peut pas prendre
    // 30 % d'un revenu médian. Un taux se calcule APRÈS agrégation.
    const seed = readFileSync(join(RACINE, 'sql', '185_population_exposee_agregee.sql'), 'utf-8');
    const codes = [...seed.matchAll(/\('([a-z0-9_]+)',\s*'[^']*',\s*'(?:Population|Âge|Ménages|Logement)'/g)]
      .map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(20);
    for (const c of codes) {
      expect(c, `« ${c} » ressemble à un taux, pas à un effectif`).not.toMatch(/^(part_|taux_|rev_|ind_snv)/);
    }
  });
});
