import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Verrous STRUCTURELS sur la couverture par rayon (sql/198 construction,
 * sql/199 lecture, mise en forme des courbes dans `courbes_par_palier` depuis
 * sql/272).
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

/**
 * ⚠ Le motif ne dit PAS `create or replace`.
 *
 * `sqlContenant` rend la migration la PLUS RÉCENTE qui porte le motif. sql/200
 * redéfinit `construire_couverture_rayon` par un `drop` suivi d'un `create`
 * simple — ajouter des paramètres à valeur par défaut crée sinon une surcharge
 * ambiguë (leçon de sql/191). Avec `create or replace` dans le motif, ces
 * verrous auraient continué de lire sql/198, c'est-à-dire une version de la
 * fonction qui n'est plus celle de la base : ils seraient restés verts en
 * gardant du code mort.
 */
const CONSTRUCTION = sqlContenant('function public.construire_couverture_rayon(');

/**
 * Le CORPS d'une fonction, jusqu'à la fin de son `$fn$` — pas le fichier entier. Depuis sql/272, le fichier qui définit
 * `lire_couverture_rayon` définit aussi `couverture_rayon_poi`, qui croise légitimement des géométries : lire tout le
 * fichier ferait rougir « ne croise aucune géométrie » sur la voisine.
 */
function corps(nom: string): string {
  const motif = `function public.${nom}(`;
  const { contenu } = sqlContenant(motif);
  const debut = contenu.indexOf(motif);
  return contenu.slice(debut, contenu.indexOf('$fn$;', debut));
}
const LECTURE = { contenu: corps('lire_couverture_rayon') };
/** La mise en forme des courbes (cumul, grille, report), sortie de `lire_couverture_rayon` par sql/272. */
const COURBES = corps('courbes_par_palier');
/**
 * `compter_sites_rayon` a sa PROPRE recherche, et ce n'est pas de la
 * redondance : elle est née dans sql/199 aux côtés de `lire_couverture_rayon`,
 * mais sql/201 n'a redéfini que la seconde. Lire les deux dans le même fichier
 * faisait donc chercher un compteur de sites dans une migration qui ne parle
 * que de couverture — et le verrou tombait, sur une régression qui n'existait
 * pas.
 */
const COMPTE_SITES = sqlContenant('function public.compter_sites_rayon(');

describe('construction de la couverture par rayon', () => {
  const s = CONSTRUCTION.contenu;

  it('ne met JAMAIS le jsonb des carreaux dans une clé de groupement', () => {
    // C'est LE défaut de performance : 54,5 s -> 7,4 s en le sortant.
    //
    // On vérifie les CLÉS de groupement elles-mêmes, pas la présence du mot :
    // `c.metadata` apparaît légitimement dans la CTE `valeurs`, qui extrait les
    // cibles UNE fois par carreau — c'est justement le second correctif.
    const tuples = [...s.matchAll(/\(carreau[^)]*\)/g)].map((m) => m[0]);
    expect(tuples.length, 'les tuples de grouping sets doivent exister').toBeGreaterThan(0);
    for (const t of tuples) {
      expect(t, `clé de groupement contenant un jsonb : ${t}`).not.toMatch(/meta/);
    }
  });

  it('extrait les cibles UNE fois par carreau, pas une fois par niveau', () => {
    // `grouping sets` produit quatre niveaux par carreau : extraire les 24
    // cibles à chaque niveau faisait 96 lectures jsonb par carreau au lieu de
    // 24, et une bande d'Île-de-France dépassait alors les 2 min de
    // `statement_timeout`.
    expect(s).toMatch(/select distinct carreau from seaux/);
    expect(s).toMatch(/join public\.carreaux_filosofi c on c\.id = u\.carreau/);
  });

  it('fusionne les populations sans concaténer deux jsonb par ligne', () => {
    // `jsonb_object_keys(a || b)` construisait un jsonb complet POUR CHAQUE
    // ligne en conflit, juste pour en énumérer les clés — et les départements
    // denses, déjà écrits par les bandes précédentes, sont presque tous en
    // conflit. C'était LE goulet : une bande d'Île-de-France passait de
    // « dépasse 2 min » à 26 s.
    // On interdit l'USAGE (`from jsonb_object_keys(...)`), pas la mention :
    // le commentaire de la migration cite la forme abandonnée pour expliquer
    // pourquoi. Troisième fois aujourd'hui qu'un verrou trop large se
    // déclenche sur le texte qui explique le correctif.
    expect(s).not.toMatch(/from jsonb_object_keys\(/);
    expect(s).toMatch(/from unnest\(v_cibles\) k/);
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

  it('garde les bornes de longitude PARAMÉTRABLES, jamais deux constantes', () => {
    // sql/198 découpait entre `-5.5` et `9.8` en dur — la bbox métropole. 1 698
    // sites ICPE tombent hors de cet intervalle, DONT 45 SEVESO, et ils
    // n'apparaissaient sur aucune courbe sans que rien ne le signale : la courbe
    // montre une population, et une population absente ressemble trait pour
    // trait à une population nulle.
    expect(s).toMatch(/p_lon_ouest\s+numeric default -5\.5/);
    expect(s).toMatch(/p_lon_est\s+numeric default 9\.8/);
    expect(s).toMatch(/c_ouest constant numeric := p_lon_ouest/);
    expect(s).toMatch(/c_est\s+constant numeric := p_lon_est/);
  });

  it('sépare la clé de journal de l’index de bande', () => {
    // Une zone lointaine tient en UNE bande, donc son index vaut forcément 0 —
    // or 0 est déjà la clé de la première bande de métropole, qu'elle
    // écraserait. Les deux rôles ne peuvent pas rester portés par le même
    // paramètre.
    expect(s).toMatch(/v_bande_id int := coalesce\(p_bande_id, p_bande\)/);
    expect(s).toMatch(/values \(v_bande_id, v_lon_min, v_lon_max/);
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
    expect(s).toMatch(/public\.courbes_par_palier\([^;]*, 10000\)/);
    expect(COURBES).toMatch(/generate_series\(100, p_rayon_max_m, 100\)/);
    // Et le report du dernier cumul connu sur les paliers vides.
    expect(COURBES).toMatch(/max\(c\.pop_cumulee\) over/);
  });

  it('cumule avec une fenêtre EXPLICITE en `rows`, jamais le `range` par défaut', () => {
    // Le defaut d'une fenetre ordonnee est `range`, qui regrouperait les ex
    // aequo. Sans effet ici, mais un defaut implicite dans un cumul est ce qui
    // se met a mentir quand la cle change.
    expect(COURBES).toMatch(/rows between unbounded preceding and current row/);
  });

  it('décale les paliers de 100 m — « à moins de 0 mètre » n’existe pas', () => {
    // Le palier `b` regroupe les carreaux dans [b, b+100) : la population « a
    // moins de 100 m » est l'increment du palier 0.
    expect(COURBES).toMatch(/rayon_m \+ 100 as rayon_m/);
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
    // `count(*)` aurait compte les NATURES — 14 au lieu de 1 259 (mesure du
    // 2026-09-18). Lit COMPTE_SITES et non `s` : les deux fonctions ne vivent
    // plus dans le meme fichier depuis sql/201.
    expect(COMPTE_SITES.contenu).toMatch(/'n_sites', coalesce\(sum\(n\), 0\)/);
  });

  it('la couverture annoncée ne compte QUE les bandes de métropole', () => {
    // Les zones lointaines sont journalisees sous des cles >= 1000 et couvrent
    // 1,0 et 0,9 degre : additionnees au reste, elles portaient le rapport a
    // 112 % une fois la metropole complete. Or le bandeau d'alerte de l'ecran
    // ne s'affiche QUE sous 99 % — un pre-calcul incomplet aurait cesse d'etre
    // signale. Pas une coquille d'affichage : la disparition de l'avertissement.
    expect(s).toMatch(/from public\.couverture_rayon_bandes where bande < 1000/);
    expect(s).toMatch(/'n_zones_lointaines'/);
  });
});

describe('l’onglet ne recalcule rien au déplacement du curseur', () => {
  const composant = readFileSync(
    join(RACINE, 'components/risques/OngletRayonInfluence.tsx'),
    'utf-8',
  );
  /*
   * ⚠ Le CHARGEMENT a quitté le composant le 2026-09-20 pour
   * `use-courbe-rayon.ts`, afin de survivre au changement d'onglet : il
   * repartait à chaque retour sur Rayons — quatre appels mesurés pour cinq
   * bascules, sans qu'un seul réglage ait bougé.
   *
   * Les deux invariants ci-dessous valent toujours, ils ont seulement changé
   * de fichier. Les laisser pointer sur le composant les aurait rendus verts
   * par accident le jour où quelqu'un y aurait remis un `fetch`.
   */
  const hook = readFileSync(
    join(RACINE, 'components/risques/use-courbe-rayon.ts'),
    'utf-8',
  );

  it('le curseur ne touche QUE l’état local', () => {
    // C'est la promesse de cet onglet, et la correction du defaut signale :
    // dans l'autre onglet, chaque pas de rayon relançait un calcul de 4 s.
    // Le curseur reste DANS le composant ; le chargement n'en sait rien.
    expect(composant).toMatch(/onChange=\{\(e\) => setRayon\(Number\(e\.target\.value\)\)\}/);
    /*
     * ⚠ On lit le TABLEAU DE DÉPENDANCES, pas le fichier entier : le hook
     * s'appelle `use-courbe-rayon` et parle de rayons partout — une recherche
     * large rougirait sur son propre nom. Ce qui compte est que le rayon
     * CHOISI AU CURSEUR n'y figure pas.
     */
    const deps = hook.match(/\}, \[([^\]]*)\]\);/g) ?? [];
    expect(deps.length, 'aucun tableau de dépendances trouvé').toBeGreaterThan(0);
    for (const d of deps) {
      expect(d, 'le chargement ne doit pas dépendre du rayon').not.toMatch(/rayon/);
    }
  });

  it('ignore une réponse dépassée par une plus récente', () => {
    // Sans ce jeton, un filtre change deux fois de suite pouvait afficher le
    // resultat du PREMIER appel, arrive en dernier.
    expect(hook).toMatch(/jeton !== dernier\.current/);
  });

  it('le composant ne charge plus RIEN lui-même', () => {
    /*
     * Le verrou du hissage. Un `fetch` réintroduit ici referait repartir la
     * courbe à chaque bascule d'onglet — le défaut exact que le déplacement
     * corrige, et qui ne se voit pas : la courbe revient identique.
     */
    expect(composant).not.toMatch(/adminFetch|useEffect/);
  });

  it('dit que la courbe totale n’est pas la somme des autres', () => {
    expect(composant).toMatch(/n’est pas la somme des autres/);
  });

  it('n’utilise aucun violet — règle du DESIGN_SYSTEM', () => {
    expect(composant).not.toMatch(/#a855f7|#a78bfa|#818cf8/i);
  });
});
