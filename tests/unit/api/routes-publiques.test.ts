import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Garde-fou : aucune route API ne devient publique par accident.
 *
 * ── Le défaut que ce test verrouille (`ARC-001`) ────────────────────────────
 *
 * La protection d'une route dépend de DEUX listes de `middleware.ts` qu'il faut
 * tenir synchronisées à la main :
 *   - le `matcher` (fin de fichier) décide si le middleware S'EXÉCUTE ;
 *   - `PROTECTED_API_PREFIXES` (début de fichier) décide s'il PROTÈGE.
 *
 * Le fichier le documente lui-même : « Une route absente d'ICI n'est JAMAIS
 * protégée, même si son préfixe figure dans PROTECTED_API_PREFIXES. » Ajouter
 * une route sous un préfixe déjà protégé en oubliant le matcher la rend donc
 * publique — sans erreur, sans test rouge, sans rien.
 *
 * Une route peut être protégée de DEUX façons, et il suffit de l'une :
 *   - par le middleware — mais alors elle doit figurer dans les deux listes ;
 *   - par un garde en début de handler (`requireAuth`, `requireAdmin`,
 *     `requireDspAccess`, `getUserFromRequest`).
 *
 * Ce test vérifie qu'aucune route n'échappe aux DEUX à la fois. Il relit les
 * listes dans le code source de `middleware.ts` plutôt que de les recopier :
 * une copie divergerait.
 *
 * `middleware.ts` est un fichier PROTÉGÉ par CLAUDE.md : ce test ne le modifie
 * pas, il le lit.
 *
 * Quand ce test échoue : soit une route a été ajoutée sans être protégée — il
 * faut l'inscrire dans les DEUX listes de `middleware.ts` — soit elle est
 * publique à dessein, et il faut l'ajouter ci-dessous avec sa justification.
 */

const RACINE = process.cwd();

/**
 * Routes publiques ASSUMÉES. Toute entrée ici est une décision, pas un oubli.
 * Ne rien y ajouter sans écrire pourquoi.
 */
const PUBLIQUES_ASSUMEES = new Map<string, string>([
  ['/api/map/categories',
   'Données non sensibles (liste de catégories de POI). Exclusion documentée dans middleware.ts.'],
  ['/api/map/jeux-recommandes',
   'Même justification que /api/map/categories : des clés de jeux de la carte, non sensibles ; sans session ni espace '
   + 'la route rend [] sans aucune lecture. La recommandation range, elle ne donne aucun droit.'],
  ['/api/auth/[...auth]',
   "Flux OAuth Supabase : l'authentification ne peut pas exiger d'être authentifié."],
  ['/api/inngest',
   'Webhook Inngest, signé par Inngest. Hors matcher à dessein.'],
  ['/api/dev/connexion-auto',
   'Connexion automatique du lancement Angular autonome (décision du 02/11) : elle OUVRE une session, elle ne peut '
   + 'donc pas en exiger une. 404 hors `next dev` (NODE_ENV !== development) et sans DEV_CONNEXION_AUTO_* (fichier '
   + '.env.development.local, non suivi) : inexistante en build et dans AIDA.'],
]);

/** Chemin de route Next à partir du chemin de fichier. */
function cheminDeRoute(fichier: string): string {
  const rel = relative(join(RACINE, 'app'), fichier).split(sep).slice(0, -1).join('/');
  return '/' + rel;
}

function listerRoutes(dossier: string, acc: string[] = []): string[] {
  for (const entree of readdirSync(dossier)) {
    const complet = join(dossier, entree);
    if (statSync(complet).isDirectory()) listerRoutes(complet, acc);
    else if (entree === 'route.ts') acc.push(complet);
  }
  return acc;
}

const middlewareBrut = readFileSync(join(RACINE, 'middleware.ts'), 'utf-8');

/**
 * `middleware.ts` SANS ses commentaires de ligne.
 *
 * Les deux listes sont lues par une expression rationnelle qui prend toute
 * apostrophe pour un delimiteur de chaine. Or les commentaires du fichier sont
 * en francais : « a l'identique », « l'entree du matcher »… Un nombre IMPAIR
 * d'apostrophes dans un commentaire decale toutes les chaines suivantes, et la
 * liste lue devient un melange de vrais prefixes et de fragments de phrases.
 *
 * Constate le 2026-09-12 en ajoutant `/api/poi-clusters` : le test a soudain
 * declare non protegees quatre routes `isochrone-battle` qui l'etaient depuis
 * toujours. Le defaut etait DANS CE TEST, pas dans le middleware — et il aurait
 * aussi bien pu produire un faux prefixe qui couvre une route ouverte.
 *
 * La classe `[^\r\n]` est explicite A DESSEIN. `.` ne franchit pas un
 * terminateur de ligne en JavaScript, et `\r` EN EST UN : sur un fichier en
 * CRLF — ce depot est sous Windows — un `/\/\/.*$/` ne matche jamais rien, et
 * le nettoyage ne nettoie rien du tout, en silence. Mesure le 2026-09-12 :
 * 22 « prefixes » lus au lieu de 19, dont des morceaux de phrases francaises.
 */
const middleware = middlewareBrut.replace(/\/\/[^\r\n]*/g, '');

/** Préfixes protégés, lus dans le tableau `PROTECTED_API_PREFIXES`. */
function lirePrefixes(): string[] {
  const bloc = middleware.match(/PROTECTED_API_PREFIXES[^=]*=\s*\[([\s\S]*?)\]/);
  if (!bloc) throw new Error('PROTECTED_API_PREFIXES introuvable dans middleware.ts');
  return Array.from(bloc[1].matchAll(/'([^']+)'/g)).map(m => m[1]);
}

/** Bases du matcher, lues dans `config.matcher`, restreintes aux routes API. */
function lireMatcher(): string[] {
  const bloc = middleware.match(/matcher:\s*\[([\s\S]*?)\]/);
  if (!bloc) throw new Error('config.matcher introuvable dans middleware.ts');
  return Array.from(bloc[1].matchAll(/'([^']+)'/g))
    .map(m => m[1].replace(/\/:path\*$/, ''))
    .filter(base => base.startsWith('/api'));
}

const prefixes = lirePrefixes();
const basesMatcher = lireMatcher();

/** Gardes acceptés en début de handler. `requireDspAccess` enveloppe `getUserFromRequest`. */
const GARDES = ['requireAdmin(', 'requireAuth(', 'requireDspAccess(', 'getUserFromRequest('];

/** Une route porte-t-elle son propre garde ? */
function porteUnGarde(fichier: string): boolean {
  const source = readFileSync(fichier, 'utf-8');
  return GARDES.some(g => source.includes(g));
}

/** Le matcher raisonne PAR SEGMENT : /api/iris ne couvre pas /api/iris-crawler. */
const couvertParMatcher = (route: string) =>
  basesMatcher.some(base => route === base || route.startsWith(base + '/'));

/** Les préfixes, eux, sont testés en `startsWith` — d'où la ligne dédiée iris-crawler. */
const couvertParPrefixe = (route: string) =>
  prefixes.some(p => route.startsWith(p));

describe('aucune route API publique par accident', () => {
  const fichiers = listerRoutes(join(RACINE, 'app', 'api'));
  const routes = fichiers.map(cheminDeRoute).sort();
  const parRoute = new Map(fichiers.map(f => [cheminDeRoute(f), f]));

  it('les deux listes de middleware.ts sont lisibles', () => {
    // Si le format du fichier change, ce test doit crier plutôt que de
    // silencieusement ne plus rien vérifier — le pire des cas pour un garde-fou.
    expect(prefixes.length).toBeGreaterThan(10);
    expect(basesMatcher.length).toBeGreaterThan(10);
  });

  it('aucune route n échappe à la fois au middleware ET aux gardes en route', () => {
    const sansProtection = routes.filter(r => {
      const parMiddleware = couvertParMatcher(r) && couvertParPrefixe(r);
      const parGarde = porteUnGarde(parRoute.get(r)!);
      return !parMiddleware && !parGarde;
    });
    const inattendues = sansProtection.filter(r => !PUBLIQUES_ASSUMEES.has(r));

    expect(
      inattendues,
      'Routes API accessibles SANS AUCUNE authentification :\n'
      + inattendues.map(r => `  ${r}`).join('\n')
      + '\n\nTrois issues : ajouter un garde en début de handler (requireAuth / requireAdmin) ; '
      + 'ou inscrire la route AUX DEUX listes de middleware.ts (PROTECTED_API_PREFIXES ET '
      + 'config.matcher — les deux, sans quoi elle reste publique) ; ou la déclarer dans '
      + 'PUBLIQUES_ASSUMEES avec sa justification.',
    ).toEqual([]);
  });

  it('la liste des publiques assumées ne contient pas de route disparue', () => {
    // Une entrée qui ne correspond plus à aucune route est une exemption
    // fantôme : elle pourrait re-couvrir une future route du même nom.
    const orphelines = [...PUBLIQUES_ASSUMEES.keys()].filter(r => !routes.includes(r));
    expect(orphelines, `Exemptions sans route correspondante : ${orphelines.join(', ')}`).toEqual([]);
  });

  it('être dans le matcher ne suffit pas à être protégé', () => {
    // Verrouille la sémantique elle-même : /api/map/categories est DANS le
    // matcher (via /api/map/:path*) mais hors des préfixes, donc public.
    // Si cette asymétrie disparaissait un jour, ce test le signalerait.
    expect(couvertParMatcher('/api/map/categories')).toBe(true);
    expect(couvertParPrefixe('/api/map/categories')).toBe(false);
  });
});
