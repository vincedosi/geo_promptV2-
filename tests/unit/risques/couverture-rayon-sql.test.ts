import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Verrous STRUCTURELS sur la couverture par rayon (sql/198 construction,
 * sql/199 lecture).
 *
 * Ils lisent le SQL, pas la base : ils tournent en CI sans Postgres et
 * attrapent une régression au moment où elle est écrite.
 *
 * ── LES TROIS DÉFAUTS QU'ILS GARDENT ──────────────────────────────────────
 *
 * Chacun a coûté du temps le 2026-09-18, et aucun n'aurait levé d'erreur :
 *
 * 1. **Le jsonb dans les clés de groupement.** `carreaux_filosofi.metadata`
 *    pèse ~806 octets ; le traîner jusque dans `group by grouping sets`
 *    obligeait Postgres à le hacher pour chaque groupe, à chacun des quatre
 *    niveaux. Mesuré en production : 54,5 s pour une bande bretonne ÉPARSE, et
 *    dépassement du délai sur la bande parisienne.
 *
 * 2. **Le total calculé comme une somme.** Un carreau proche de deux natures
 *    compte dans les deux courbes — correct pour chacune, faux pour leur
 *    somme. Vérifié en local : 240 745 au minimum par carreau contre 282 502
 *    en additionnant les natures, soit 17 % d'écart.
 *
 * 3. **Les sites non filtrés par bande.** Chaque bande parcourait les 1 258
 *    sites de France pour n'en utiliser qu'une poignée.
 */

const RACINE = process.cwd();

function sqlContenant(motif: string): { fichier: string; contenu: string } {
  const fichiers = readdirSync(join(RACINE, 'sql'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  for (const f of fichiers) {
    const contenu = readFileSync(join(RACINE, 'sql', f), 'utf-8');
    if (contenu.includes(motif)) return { fichier: f, contenu };
  }
  throw new Error(`Aucune migration ne contient « ${motif} »`);
}

const CONSTRUCTION = sqlContenant('create or replace function public.construire_couverture_rayon(');
const LECTURE = sqlContenant('create or replace function public.lire_couverture_rayon(');

describe('construction de la couverture par rayon', () => {
  const s = CONSTRUCTION.contenu;

  it('ne met JAMAIS le jsonb des carreaux dans une clé de groupement', () => {
    // C'est LE défaut de performance : 54,5 s -> 7,4 s en le sortant.
    expect(s).not.toMatch(/group by grouping sets[\s\S]{0,400}\bmeta\b/);
    expect(s).not.toMatch(/group by [^\n]*\bmeta\b/);
    // Et la population est lue par jointure sur la clé primaire, au dernier
    // moment.
    expect(s).toMatch(/join public\.carreaux_filosofi c on c\.id = s\.carreau/);
  });

  it('filtre les SITES par la bande, pas seulement les carreaux', () => {
    // Sans cela, chaque bande parcourt les 1 258 sites de France.
    expect(s).toMatch(/p\.lng >= v_lon_min - 0\.15/);
    expect(s).toMatch(/p\.lng <\s+v_lon_max \+ 0\.15/);
  });

  it('calcule le total au MINIMUM par carreau, jamais par addition', () => {
    // `grouping sets` produit les quatre niveaux d'un coup, chacun par `min`.
    expect(s).toMatch(/grouping sets/);
    expect(s).toMatch(/min\(d\) as d/);
    // Les niveaux agrégés sont marqués par '*', pas par une somme des lignes.
    expect(s).toMatch(/coalesce\(gravite, '\*'\)/);
    expect(s).toMatch(/coalesce\(nature,\s+'\*'\)/);
  });

  it('mesure les distances en geography, jamais en 3857 brut', () => {
    // En 3857 a nos latitudes, un metre vaut ~0,73 m reel : « 500 m » en
    // couvrirait 685.
    expect(s).toMatch(/ST_Distance\(ST_Transform\(ST_Centroid\(c\.geom_3857\), 4326\)::geography/);
  });

  it('découpe par BANDE de carreaux, jamais par département de sites', () => {
    // Un carreau doit être traité exactement une fois : decouper par
    // departement des SITES traiterait deux fois un carreau proche de sites de
    // deux departements, et le minimum serait alors calcule sur un
    // sous-ensemble a chaque passe.
    expect(s).toMatch(/ST_XMin\(c\.geom_3857\) >= v_x_min/);
    expect(s).toMatch(/couverture_rayon_bandes/);
  });

  it('journalise les bandes pour être reprenable', () => {
    expect(s).toMatch(/insert into public\.couverture_rayon_bandes/);
    expect(s).toMatch(/on conflict \(bande\) do update/);
  });

  it('retire l’exécution à anon et authenticated', () => {
    expect(s).toMatch(/revoke all on function public\.construire_couverture_rayon/);
    expect(s).toMatch(/grant execute on function public\.construire_couverture_rayon[\s\S]*?to service_role/);
  });
});

describe('lecture de la courbe', () => {
  const s = LECTURE.contenu;

  it('lit la table PRÉ-CALCULÉE et ne croise aucune géométrie', () => {
    expect(s).toMatch(/from public\.couverture_rayon_risque/);
    // Aucun appel PostGIS coûteux : c'est tout l'intérêt du pré-calcul.
    expect(s).not.toMatch(/ST_Intersects|ST_DWithin|ST_Buffer/);
  });

  it('rend une grille COMPLÈTE de 100 à 10 000, sans trou', () => {
    // Une nature sans carreau à un palier n'a pas de ligne : mesuré, 94 points
    // sur 99. Recharts relierait les points existants, inventant une pente.
    expect(s).toMatch(/generate_series\(100, 10000, 100\)/);
    // Et le report du dernier cumul connu sur les paliers vides.
    expect(s).toMatch(/max\(c\.pop_cumulee\) over/);
  });

  it('cumule avec une fenêtre EXPLICITE en `rows`, jamais le `range` par défaut', () => {
    // Le defaut d'une fenetre ordonnee est `range`, qui regrouperait les ex
    // aequo. Sans effet ici, mais un defaut implicite dans un cumul est ce qui
    // se met a mentir quand la cle change.
    expect(s).toMatch(/rows between unbounded preceding and current row/);
  });

  it('décale les paliers de 100 m — « à moins de 0 mètre » n’existe pas', () => {
    // Le palier `b` regroupe les carreaux dans [b, b+100) : la population « a
    // moins de 100 m » est l'increment du palier 0.
    expect(s).toMatch(/rayon_m \+ 100 as rayon_m/);
  });

  it('ne somme JAMAIS les gravités : `*` est une ligne pré-calculée', () => {
    // Selectionner les deux gravites revient a LIRE la ligne '*', obtenue au
    // minimum par carreau — pas a additionner les deux lignes detaillees.
    expect(s).toMatch(/v_gravite := '\*'/);
    expect(s).toMatch(/r\.gravite = v_gravite/);
  });

  it('garde toujours la courbe totale, même quand les natures sont filtrées', () => {
    expect(s).toMatch(/r\.nature = '\*' or r\.nature = any\(p_natures\)/);
    // Et previent que ce total porte sur PLUS que ce qui est affiche.
    expect(s).toMatch(/total_est_global/);
  });

  it('valide la cible contre le catalogue — seule barrière contre l’injection', () => {
    expect(s).toMatch(/from public\.cibles_exposition where code = p_cible/);
  });

  it('compte les sites avec `sum`, pas `count` sur un groupement par nature', () => {
    // `count(*)` aurait compte les NATURES — 8 au lieu de 1 258.
    expect(s).toMatch(/'n_sites', coalesce\(sum\(n\), 0\)/);
  });
});

describe('l’onglet ne recalcule rien au déplacement du curseur', () => {
  const composant = readFileSync(
    join(RACINE, 'components/risques/OngletRayonInfluence.tsx'),
    'utf-8',
  );

  it('le curseur ne touche QUE l’état local', () => {
    // C'est la promesse de cet onglet, et la correction du defaut signale :
    // dans l'autre onglet, chaque pas de rayon relançait un calcul de 4 s.
    // `setRayon` ne doit apparaitre dans aucune dependance de chargement.
    expect(composant).toMatch(/onChange=\{\(e\) => setRayon\(Number\(e\.target\.value\)\)\}/);
    const deps = composant.match(/\}, \[cible, niveaux, natures, perim\]\)/);
    expect(deps, 'le chargement ne doit pas dépendre du rayon').not.toBeNull();
  });

  it('ignore une réponse dépassée par une plus récente', () => {
    // Sans ce jeton, un filtre change deux fois de suite pouvait afficher le
    // resultat du PREMIER appel, arrive en dernier.
    expect(composant).toMatch(/jeton !== dernier\.current/);
  });

  it('dit que la courbe totale n’est pas la somme des autres', () => {
    expect(composant).toMatch(/n’est pas la somme des autres/);
  });

  it('n’utilise aucun violet — règle du DESIGN_SYSTEM', () => {
    expect(composant).not.toMatch(/#a855f7|#a78bfa|#818cf8/i);
  });
});
