import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

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
      + 'désigné par CLAUDE.md. Fusionner puis supprimer le doublon.',
    ).toBe(false);
  });

  it('toute variable d env obligatoire du code est documentée', () => {
    // Une variable dont l'absence fait lever une route DOIT être dans la doc,
    // sinon un déploiement neuf casse sans que personne ne sache pourquoi.
    const exemple = lire('.env.example');
    const declarees = Array.from(exemple.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)).map(m => m[1]);
    const critiques = declarees.filter(v =>
      /^(SUPABASE|NEXT_PUBLIC_SUPABASE|ORS|GOOGLE_GENERATIVE|DSP_ENC)/.test(v));

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
    // Modal est retiré depuis le 2026-10-12 (suppression de l'IA) : plus
    // aucun appel, donc plus d'entrée ici.
    const hotesExternes: Array<[string, string]> = [
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

  it('les versions annoncées par la doc correspondent à package.json', () => {
    // Trouvé le 11/09 : ARCHITECTURE.md annonçait Next « ^14.2 » alors que le
    // projet tournait en 15.5.25 depuis le bump du 10/09. Le doc autoritaire
    // lui-même avait dérivé — c'est pour ça qu'on ne peut pas se reposer sur
    // la seule discipline.
    const pkg = JSON.parse(lire('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Une ligne du tableau « Stack technique » : | Libellé | Techno | Version |
    const majeure = (v: string) => v.replace(/^[\^~]/, '').split('.')[0];
    const aVerifier: Array<[string, RegExp]> = [
      ['next',                  /\| Framework web \| Next\.js \(App Router\) \| ([^|]+)\|/],
      ['react',                 /\| Runtime UI \| React \| ([^|]+)\|/],
      ['@supabase/supabase-js', /\| Base de donnees \| Supabase[^|]*\| ([^|]+)\|/],
      ['maplibre-gl',           /\| Cartographie \| MapLibre GL JS \| ([^|]+)\|/],
    ];

    const divergences = aVerifier.flatMap(([paquet, motif]) => {
      const m = archi.match(motif);
      if (!m) return [`${paquet} : ligne introuvable dans le tableau Stack technique`];
      const annoncee = m[1].trim();
      const reelle = deps[paquet];
      if (!reelle) return [`${paquet} : absent de package.json`];
      return majeure(annoncee) === majeure(reelle)
        ? []
        : [`${paquet} : doc annonce ${annoncee}, package.json dit ${reelle}`];
    });

    expect(
      divergences,
      `ARCHITECTURE.md a dérivé de package.json : ${divergences.join(' ; ')}`,
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

  // ── Section « Navigation de /map » (tâche 10, 2026-09-12) ──────────────────
  //
  // Les cinq contrôles ci-dessus ne couvrent rien de cette section : ni les
  // raccourcis, ni LARGEUR_RAIL, ni le nombre de dégradés, ni l'affirmation
  // « ClusteringResultsContent.tsx n'est importé nulle part ». Un relecteur
  // l'a fait remarquer en round de correction 1 : c'est exactement l'angle
  // mort qui a produit l'incident « 70 tables — RLS partout » — une section
  // qui se lit comme un fait vérifié alors qu'aucun test ne la regarde.
  //
  // Le dernier contrôle compte le plus : la décision parquée sur
  // `ClusteringResultsContent.tsx` (garde de périmètre non relayée, laissée
  // en l'état PARCE QU'aucun composant vivant ne le monte) n'est sûre que
  // tant que cette affirmation reste vraie. Le jour où quelqu'un l'importe,
  // ce test doit rougir — sinon la doc ment ET le trou de garde devient
  // vivant sans qu'on le sache.

  const configNav = lire('lib/navigation/config.ts');
  const navSection = archi.slice(archi.indexOf('## Navigation de /map'), archi.indexOf('## Modele multi-tenant'));

  it('LARGEUR_RAIL citée dans la doc correspond à lib/navigation/config.ts', () => {
    const reelle = configNav.match(/export const LARGEUR_RAIL = (\d+);/)?.[1];
    expect(reelle, 'LARGEUR_RAIL introuvable dans lib/navigation/config.ts — a-t-elle été renommée ?').toBeDefined();

    const citee = navSection.match(/`LARGEUR_RAIL`\s*\((\d+)\s*px/)?.[1];
    expect(citee, 'ARCHITECTURE.md ne cite plus LARGEUR_RAIL sous la forme "`LARGEUR_RAIL` (NN px" attendue').toBeDefined();

    expect(
      citee,
      `ARCHITECTURE.md annonce LARGEUR_RAIL = ${citee}, lib/navigation/config.ts dit ${reelle}.`,
    ).toBe(reelle);
  });

  it('les raccourcis du tableau de navigation correspondent à ENTREES_NAVIGATION', () => {
    // Découpe le tableau ENTREES_NAVIGATION en objets `{ ... }` par comptage
    // d'accolades (style repris de tests/unit/carte/pile-echap-usage.test.ts),
    // puis extrait id + raccourci de chaque objet.
    const debutTableau = configNav.indexOf('export const ENTREES_NAVIGATION');
    expect(debutTableau, 'ENTREES_NAVIGATION introuvable dans lib/navigation/config.ts').toBeGreaterThanOrEqual(0);
    // Ne pas confondre avec le `[]` du TYPE `readonly EntreeNavigation[]` qui
    // précède le `= [` du littéral : chercher "= [" d'abord.
    const debutCrochet = configNav.indexOf('[', configNav.indexOf('= [', debutTableau));
    let profondeur = 0;
    let i = debutCrochet;
    for (; i < configNav.length; i++) {
      if (configNav[i] === '[') profondeur++;
      else if (configNav[i] === ']') { profondeur--; if (profondeur === 0) break; }
    }
    const corpsTableau = configNav.slice(debutCrochet, i + 1);

    const raccourcisReels = new Map<string, string | null>();
    for (const m of corpsTableau.matchAll(/\{\s*id:\s*'([a-z]+)'[\s\S]*?\n\s*\},/g)) {
      const bloc = m[0];
      const id = m[1];
      const raccourci = bloc.match(/raccourci:\s*'([^']+)'/)?.[1] ?? null;
      raccourcisReels.set(id, raccourci);
    }
    expect(raccourcisReels.size, 'aucune entrée extraite de ENTREES_NAVIGATION — le motif d\'extraction a-t-il divergé du style du fichier ?').toBeGreaterThanOrEqual(8);

    // Table doc : | Nom francais | ... | `Raccourci` (ou —) | ... |
    const idParLabel: Record<string, string> = {
      Filtre: 'filtre', Calques: 'calques', Analyse: 'analyse', Zones: 'zones',
      Campagne: 'campagne', Assistant: 'assistant',
    };
    const divergences: string[] = [];
    for (const [label, id] of Object.entries(idParLabel)) {
      const ligne = navSection.match(new RegExp(`\\|\\s*${label}\\s*\\|[^|]*\\|\\s*([^|]+)\\|`));
      expect(ligne, `ligne du tableau pour "${label}" introuvable dans la section Navigation`).not.toBeNull();
      const celluleRaccourci = ligne![1].trim();
      const raccourciDoc = celluleRaccourci.match(/`([^`]+)`/)?.[1]?.toLowerCase() ?? null;
      const raccourciReel = raccourcisReels.get(id) ?? null;
      if (raccourciDoc !== raccourciReel) {
        divergences.push(`${label} : doc dit "${raccourciDoc}", config.ts dit "${raccourciReel}"`);
      }
    }
    expect(divergences, divergences.join(' ; ')).toEqual([]);
  });

  it('le nombre de dégradés cité correspond au nombre de DegradeId', () => {
    const degrades = lire('lib/carte/degrades.ts');
    const blocType = degrades.match(/export type DegradeId =\s*([\s\S]*?);/)?.[1];
    expect(blocType, 'union DegradeId introuvable dans lib/carte/degrades.ts').toBeDefined();
    const nombreReel = (blocType!.match(/\|\s*'[^']+'/g) ?? []).length;
    expect(nombreReel, 'aucune valeur DegradeId extraite — le motif a-t-il divergé du style du fichier ?').toBeGreaterThan(0);

    const motsVersNombre: Record<string, number> = {
      deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
    };
    const mot = navSection.match(/jusqu'a\s+(\w+)\s+choroplethes/)?.[1];
    expect(mot, 'ARCHITECTURE.md ne cite plus le nombre de choroplèthes concurrentes avant le dégradé unique').toBeDefined();
    const nombreCite = motsVersNombre[mot!.toLowerCase()];
    expect(nombreCite, `mot-nombre "${mot}" non reconnu par le dictionnaire du test — l'étendre`).toBeDefined();

    expect(
      nombreCite,
      `ARCHITECTURE.md cite "${mot}" (${nombreCite}) choroplèthes, lib/carte/degrades.ts déclare ${nombreReel} DegradeId.`,
    ).toBe(nombreReel);
  });

  it('ClusteringResultsContent.tsx reste SUPPRIME — la garde de perimetre n a pas d amorce', () => {
    // Ce test verrouillait la decision PARQUEE : « le fichier monte ClusterPanel
    // sans relayer la garde de perimetre, mais rien ne l'importe, donc le trou
    // n'est pas atteignable ». La passe knip du 2026-09-22 l'a fait remonter
    // comme dernier fichier mort, et il a ete SUPPRIME plutot que repare.
    //
    // Le test change donc de nature sans changer de but : il ne surveille plus
    // un fichier mort, il verifie qu'il ne REVIENT pas en l'etat. Repris tel
    // quel, il lancerait un clustering sans perimetre — la famille de
    // l'incident du 28/03, contre laquelle lib/carte/garde-perimetre.ts existe.
    const FICHIER_CIBLE = join('components', 'map', 'ClusteringResultsContent.tsx').split(sep).join('/');
    expect(
      existsSync(join(RACINE, FICHIER_CIBLE)),
      `${FICHIER_CIBLE} est de retour. S'il est reintroduit, il DOIT relayer ` +
      '`verifierPerimetreClustering` comme le fait PanneauAnalyse.tsx — puis mettre a jour ' +
      'ARCHITECTURE.md § Navigation de /map et ce test.',
    ).toBe(false);

    expect(
      archi.includes('decision LEVEE et'),
      "ARCHITECTURE.md ne porte plus la trace de la decision levee sur ClusteringResultsContent.tsx. " +
      "Une suppression dont plus rien n'explique la raison sera refaite a l'envers.",
    ).toBe(true);
  });

  // ── Chantier suivi-v2 (taches 1-16, 2026-09-14/15) ────────────────────────
  //
  // Ajoutés le 2026-09-16 : AUCUN des huit contrôles ci-dessus ne regardait une
  // seule affirmation ajoutée par ce chantier, alors que le fichier contenait
  // déjà le patron exact qu'il fallait (le balayage d'importeurs de
  // `ClusteringResultsContent`). Les trois affirmations verrouillées ici sont
  // celles dont dépend une DÉCISION : ne pas supprimer trois fichiers, et
  // pouvoir en supprimer un quatrième plus tard sans casser la production.

  function fichiersDe(dossier: string): string[] {
    const trouves: string[] = [];
    for (const entree of readdirSync(dossier)) {
      if (entree === 'node_modules' || entree === '.next') continue;
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) trouves.push(...fichiersDe(chemin));
      else if (/\.tsx?$/.test(entree)) trouves.push(chemin);
    }
    return trouves;
  }

  it('SuiviMapLayer.tsx est TOUJOURS monte par page.tsx — la decision de ne pas le supprimer tient', () => {
    // ARCHITECTURE.md (§ Tâche 16) justifie de garder ce fichier par le fait
    // qu'il a encore un consommateur vivant, et annonce sa suppression comme
    // « reste à faire ». Le jour où cette tâche sera faite, cette affirmation
    // deviendra fausse et doit rougir ici — sinon le document continuera
    // d'affirmer au présent qu'un fichier supprimé est monté.
    expect(
      archi.includes('`app/map/_components/SuiviMapLayer.tsx` — toujours importe et monte par'),
      "ARCHITECTURE.md n'affirme plus que SuiviMapLayer.tsx est monté par page.tsx. "
      + 'Si le fichier a été supprimé (tâche de suite annoncée), retirer ce test ET le paragraphe. '
      + 'Si la phrase a seulement été reformulée, mettre à jour le test.',
    ).toBe(true);

    const page = lire('app/map/page.tsx');
    expect(
      /SuiviMapLayer/.test(page),
      'ARCHITECTURE.md affirme que SuiviMapLayer.tsx est « toujours importe et monte par '
      + "app/map/page.tsx » — page.tsx ne le mentionne plus. L'un des deux ment.",
    ).toBe(true);

    // Les exports que le même paragraphe dit « toujours consommés », chacun
    // chez SON consommateur. L'attribution du document était collective
    // (« ses exports … consommés par A et B »), donc invérifiable : elle
    // laissait croire que `legendePourMetrique` venait de PanneauCalques, ce
    // qui est faux — il n'a qu'un consommateur, LegendeCarte.
    expect(
      /SuiviMapEventDetail/.test(lire('app/map/_components/panneaux/PanneauCalques.tsx')),
      'ARCHITECTURE.md affirme que le type `SuiviMapEventDetail` est toujours consommé par '
      + "PanneauCalques.tsx (groupe « Campagne active ») — ce n'est plus vrai.",
    ).toBe(true);
    expect(
      /legendePourMetrique/.test(lire('components/map/LegendeCarte.tsx')),
      'ARCHITECTURE.md affirme que `legendePourMetrique` est toujours consommé par '
      + "LegendeCarte.tsx, son SEUL consommateur — ce n'est plus vrai. S'il n'en a plus aucun, "
      + "l'export est mort et la décision de garder SuiviMapLayer.tsx perd un de ses deux motifs.",
    ).toBe(true);
  });

  it('ReconciliationPanel est TOUJOURS reutilise par DetailTechnique — l autre decision de non-suppression', () => {
    expect(
      archi.includes('ReconciliationPanel.tsx'),
      'ARCHITECTURE.md ne parle plus de ReconciliationPanel.tsx.',
    ).toBe(true);
    expect(
      /ReconciliationPanel/.test(lire('components/campagne/suivi-v2/DetailTechnique.tsx')),
      'ARCHITECTURE.md justifie de ne PAS avoir supprimé components/campaign/suivi/'
      + 'ReconciliationPanel.tsx par sa réutilisation « TEL QUEL » dans suivi-v2/DetailTechnique.tsx. '
      + "DetailTechnique ne l'importe plus : soit le panneau est devenu mort (le supprimer avec "
      + 'lib/campaigns/reconciliation-metrics.ts), soit la doc doit dire son nouveau consommateur.',
    ).toBe(true);
  });

  it('l ancien ecran de suivi est bien parti, et la doc ne le ressuscite pas', () => {
    // Le paragraphe de tête liste neuf composants supprimés. S'ils
    // réapparaissaient, le document décrirait une suppression qui n'a pas eu
    // lieu — et `SuiviV2` cesserait d'être le seul écran de suivi.
    const supprimes = [
      'components/campaign/CampaignSuivi.tsx',
      'components/campaign/suivi/SuiviCockpit.tsx',
      'components/campaign/suivi/SuiviCharts.tsx',
      'components/campaign/suivi/SuiviTable.tsx',
      'components/campaign/suivi/SuiviDeriveMap.tsx',
      'components/campaign/suivi/DeriveTable.tsx',
      'components/campaign/suivi/MeshSelector.tsx',
      'components/campaign/suivi/ActorFilter.tsx',
      'components/campaign/suivi/ActorPanel.tsx',
    ];
    const revenus = supprimes.filter((f) => existsSync(join(RACINE, f)));
    expect(
      revenus,
      `ARCHITECTURE.md annonce ces fichiers supprimés (Tâche 16), ils existent : ${revenus.join(', ')}.`,
    ).toEqual([]);
  });

  it('l arborescence de suivi-v2 liste exactement les fichiers reels', () => {
    const reels = readdirSync(join(RACINE, 'components', 'campagne', 'suivi-v2'))
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => f.replace(/\.tsx?$/, ''))
      .sort();
    const section = archi.slice(archi.indexOf('└── suivi-v2/'), archi.indexOf('├── magelian/'));
    expect(section.length, 'section suivi-v2 introuvable dans l arborescence').toBeGreaterThan(100);

    const absents = reels.filter((n) => !section.includes(n));
    expect(
      absents,
      `Fichiers de components/campagne/suivi-v2/ absents de l'arborescence d'ARCHITECTURE.md : `
      + `${absents.join(', ')}. C'est la section qui décrit l'écran de suivi actuel — un fichier `
      + `qui n'y figure pas est invisible pour qui lit le document autoritaire.`,
    ).toEqual([]);
  });

  it('toute route API est documentee — la reciproque du recomptage du 2026-09-16', () => {
    // Ce test a été DÉCLINÉ à l'écriture de ce fichier (« il ne compare pas la
    // liste des 170 routes une par une… un test qu'on désactiverait au premier
    // ajout de route légitime »). L'écart a alors grossi jusqu'à 51 routes
    // absentes sur 204, et la phrase de sécurité « les 146 routes API » est
    // restée fausse pendant des mois.
    //
    // Il est réintroduit maintenant que l'écart est à ZÉRO, et il n'exige rien
    // de plus que la règle déjà écrite dans CLAUDE.md : « un commit qui ajoute
    // ou retire une route met le doc à jour DANS LE MÊME COMMIT ». Une route
    // ajoutée sans sa ligne fait donc rougir la suite, ce qui est le but.
    const routes = fichiersDe(join(RACINE, 'app', 'api'))
      .map((f) => f.slice(RACINE.length + 1).split(sep).join('/'))
      .filter((f) => f.endsWith('/route.ts'))
      .map((f) => '/' + f.replace(/^app\//, '').replace(/\/route\.ts$/, ''));

    expect(routes.length, 'aucune route trouvée sous app/api — le balayage a-t-il divergé ?').toBeGreaterThan(150);

    const absentes = routes.filter((r) => !archi.includes(r)).sort();
    expect(
      absentes,
      `Routes API absentes d'ARCHITECTURE.md :\n${absentes.map((r) => `  ${r}`).join('\n')}\n\n`
      + 'CLAUDE.md § Documentation : « un commit qui ajoute ou retire une route met le doc à jour '
      + 'DANS LE MÊME COMMIT ». Ajouter une ligne au tableau de la section correspondante. '
      + "Si la route n'a rien à y faire (catch-all inerte, diagnostic), le dire — une ligne qui "
      + "explique pourquoi une route existe vaut mieux qu'une absence.",
    ).toEqual([]);
  });
});
