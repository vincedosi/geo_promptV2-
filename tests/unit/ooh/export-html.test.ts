import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { genererExportHtml, nomFichierExport } from '@/lib/ooh/export-html';
import { totauxCampagne } from '@/lib/ooh/export-html-totaux';
import {
  MAPLIBRE_VERSION_EXPORT, PALETTE_EXPORT_OOH, SRI_MAPLIBRE, URL_FOND_EXPORT,
} from '@/lib/ooh/export-html-config';
import type { CampagneOohLue, EmplacementOohLu, LigneOohLue } from '@/types/campagne-ooh';

/**
 * Export HTML autonome d'une campagne OOH (bible des priorités, ligne 30) : un fichier à envoyer au client, sans accès
 * à l'application. On vérifie la STRUCTURE (sections, comptes, palette), l'AUTONOMIE (aucun identifiant interne, aucune
 * adresse de l'application, une seule dépendance épinglée) et l'ÉCHAPPEMENT de tout texte issu des données.
 */

const XSS = '<img src=x onerror=alert(1)>';
const XSS_SCRIPT = '</script><script>alert("x")</script>';

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function ligne(n: number, extra: Partial<LigneOohLue> = {}): LigneOohLue {
  return {
    id: UUID(100 + n), ordre: n, regie: `REGIE ${n}`, reseau: `Réseau ${n}`, territoire: null, nb_ecrans: 10 * n,
    format: null, date_debut: '2026-09-20', date_fin: '2026-10-02', duree_libelle: null, total_ttc: 1000 * n,
    contacts_15_plus: null, contacts_18_24: null, details: {}, a_des_emplacements: true, nb_places: 0, nb_a_verifier: 0,
    nb_non_places: 0, ...extra,
  };
}

function point(n: number, ligneId: string, extra: Partial<EmplacementOohLu['properties']> = {}, lng = 2 + n / 100, lat = 48 + n / 100): EmplacementOohLu {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: {
      id: UUID(1000 + n), ligne_id: ligneId, nom_lieu: `Lieu ${n}`, adresse: `${n} rue de l'essai`, ville: 'Paris',
      code_postal: '75001', regie: null, reseau: null, type_lieu: 'gare', nb_ecrans: 2, formats: ['solo 9/16'],
      geoloc_qualite: 'sure', geoloc_libelle: null, ...extra,
    },
  };
}

const L1 = ligne(1, { regie: 'MEDIATRANSPORTS', reseau: 'DOOH GARE', nb_places: 3, nb_a_verifier: 1, nb_non_places: 1,
  details: { non_places: [
    { nom: `Gare ${XSS}`, raison: 'gare introuvable' },
    { nom: 'Club introuvable', raison: 'adresse introuvable (BAN)' },
    { nom: 'Club homonyme', raison: 'résultat BAN hors du territoire de la ligne (outre-mer)' },
    { nom: 'Club incertain', raison: 'score BAN 0,31 sous 0,40' },
  ] } });
const L2 = ligne(2, { regie: 'BASIC FIT', reseau: XSS, nb_places: 2, total_ttc: 48480 });
const L3 = ligne(3, { regie: 'MEDIAOUTREMER', reseau: null, territoire: 'LA REUNION', nb_ecrans: 200, a_des_emplacements: false, total_ttc: 17149.44 });

/** Lignes : 1 000 + 48 480 + 17 149,44 = 66 629,44 € ; impression 19 975,20 € ; budget du plan arrondi sous le centime, comme TF4. */
const SEP_LIGNE = String.fromCharCode(0x2028);
const DONNEES: CampagneOohLue = {
  campagne: {
    id: UUID(1), nom: `Campagne ${XSS}`, annonceur: 'Annonceur', vague: 'TF4', date_debut: '2026-09-20', date_fin: '2026-10-02',
    budget_total_ttc: 86604.6376, metadata: { couts_annexes: [{ libelle: 'IMPRESSION JUSQU’À 5 VISUELS', total_ttc: 19975.2 }] },
  },
  lignes: [L1, L2, L3],
  emplacements: [
    point(1, L1.id, { nom_lieu: XSS_SCRIPT }),
    point(2, L1.id, { ville: XSS }),
    point(3, L1.id, { geoloc_qualite: 'a_verifier', geoloc_libelle: 'Commune homonyme', nom_lieu: 'Gare douteuse' }, 55.4, -21.1),
    point(4, L2.id, { nom_lieu: '<!-- commentaire', adresse: `rue${SEP_LIGNE}coupée` }),
    point(5, L2.id, { adresse: '"guillemets" & \'apostrophes\'' }),
  ],
  tronque: false,
};
const pied = (html: string) => /<tfoot>([\s\S]*?)<\/tfoot>/.exec(html)![1];

const EXPORTE_LE = new Date('2026-10-19T09:30:00Z');
const HTML = genererExportHtml(DONNEES, { exporteLe: EXPORTE_LE });

/** Les données inlinées pour la carte (`<script type="application/json">`). */
function donneesInlinees(html: string): { type: string; features: { properties: Record<string, unknown>; geometry: { coordinates: number[] } }[] } {
  const m = /<script type="application\/json" id="donnees-carte">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('données de carte absentes');
  return JSON.parse(m[1]).points;
}

describe('genererExportHtml — structure', () => {
  it('est un document HTML complet, en français, avec le nom de la campagne et dentsu.explore en titre', () => {
    expect(HTML.startsWith('<!doctype html>')).toBe(true);
    expect(HTML).toContain('<html lang="fr">');
    expect(HTML).toContain('<meta charset="utf-8">');
    expect(HTML).toMatch(/<title>Campagne &lt;img src=x onerror=alert\(1\)&gt; · dentsu\.explore<\/title>/);
    expect(HTML).toContain('dentsu.explore');
  });

  it('en-tête : période de la campagne et date de l export', () => {
    expect(HTML).toContain('20/09/2026 → 02/10/2026');
    expect(HTML).toContain('Exporté le 19/10/2026');
  });

  it('synthèse : lignes, panneaux par statut sûr / à vérifier / non placé, montant', () => {
    const synthese = /<section[^>]*data-synthese[^>]*>([\s\S]*?)<\/section>/.exec(HTML)![1];
    const valeur = (cle: string) => new RegExp(`data-chiffre="${cle}"[^>]*>([^<]*)<`).exec(synthese)?.[1];
    expect(valeur('lignes')).toBe('3');
    expect(valeur('places')).toBe('5');
    expect(valeur('surs')).toBe('4');
    expect(valeur('a-verifier')).toBe('1');
    expect(valeur('non-places')).toBe('4');
    // Le budget de la campagne, arrondi à l'euro et mis en forme par lib/format/nombre.ts.
    expect(valeur('montant')).toBe(`${(86605).toLocaleString('fr-FR')} € TTC`);
  });

  it('sans budget de campagne, le montant est la somme des lignes ET des coûts annexes', () => {
    const html = genererExportHtml({ ...DONNEES, campagne: { ...DONNEES.campagne, budget_total_ttc: null } }, { exporteLe: EXPORTE_LE });
    expect(html).toMatch(new RegExp(`data-chiffre="montant"[^>]*>${(86605).toLocaleString('fr-FR')} € TTC<`));
    expect(html).toContain('total de la campagne');
  });

  it('les lignes sans liste sont comptées en écrans, comme la colonne du tableau (jamais « faces »)', () => {
    expect(HTML).toContain('(200 écrans)');
    expect(HTML).not.toMatch(/faces/);
  });

  it('les données de la carte portent un point par emplacement, avec le rang de teinte de sa ligne', () => {
    const points = donneesInlinees(HTML);
    expect(points.type).toBe('FeatureCollection');
    expect(points.features).toHaveLength(5);
    expect(points.features.map((f) => f.properties.rang)).toEqual([1, 1, 1, 2, 2]);
    expect(points.features[2].properties.qualite).toBe('a_verifier');
    expect(points.features[0].geometry.coordinates).toEqual([2.01, 48.01]);
  });

  it('le cadrage initial porte sur les points SÛRS : un point à vérifier outre-mer ne l élargit pas', () => {
    const m = /<script type="application\/json" id="donnees-carte">([\s\S]*?)<\/script>/.exec(HTML)!;
    expect(JSON.parse(m[1]).emprise).toEqual([2.01, 48.01, 2.05, 48.05]);
  });

  it('tableau des lignes du plan : une rangée par ligne, dans l ordre du plan, DROM compris', () => {
    const tableau = /<table[^>]*data-lignes[^>]*>([\s\S]*?)<\/table>/.exec(HTML)![1];
    const rangees = tableau.match(/<tr data-ligne/g) ?? [];
    expect(rangees).toHaveLength(3);
    expect(tableau.indexOf('MEDIATRANSPORTS')).toBeLessThan(tableau.indexOf('BASIC FIT'));
    expect(tableau).toContain('LA REUNION');
    expect(tableau).toContain('Liste non fournie par la régie');
  });

  it('légende : une pastille par ligne qui a des emplacements, teinte du thème clair', () => {
    const legende = /<ul[^>]*data-legende[^>]*>([\s\S]*?)<\/ul>/.exec(HTML)![1];
    expect(legende.match(/<li/g)).toHaveLength(2);
    expect(legende).toContain(PALETTE_EXPORT_OOH.lignes[0].valeur);
    expect(legende).toContain(PALETTE_EXPORT_OOH.lignes[1].valeur);
  });

  it('listes par régie : un <details> par régie ayant des emplacements, avec ses lignes et ses non placés', () => {
    const blocs = HTML.match(/<details[^>]*data-regie="[^"]*"/g) ?? [];
    expect(blocs).toHaveLength(2);
    const mt = /<details[^>]*data-regie="MEDIATRANSPORTS"[^>]*>([\s\S]*?)<\/details>/.exec(HTML)![1];
    expect(mt.match(/<tr data-emplacement/g)).toHaveLength(3);
    expect(mt).toContain('À vérifier');
    expect(mt).toContain('Position proposée : Commune homonyme');
    expect(mt).toContain('Non placés (4)');
    expect(mt).toContain('gare introuvable');
  });

  it('les raisons de non-placement sont dites en français clair : aucun « BAN » chez le client', () => {
    const mt = /<details[^>]*data-regie="MEDIATRANSPORTS"[^>]*>([\s\S]*?)<\/details>/.exec(HTML)![1];
    expect(HTML).not.toMatch(/\bBAN\b/);
    expect(mt).toContain('Club introuvable</strong> — adresse introuvable dans la base d’adresses nationale');
    expect(mt).toContain('Club homonyme</strong> — adresse trouvée hors du territoire de la ligne (outre-mer)');
    expect(mt).toContain('Club incertain</strong> — adresse reconnue avec trop peu de certitude');
  });
});

describe('genererExportHtml — budget : lignes + coûts annexes = total de la campagne', () => {
  it('pied du tableau : sous-total des lignes, une rangée par coût annexe, total de la campagne', () => {
    const p = pied(HTML);
    expect(p).toMatch(new RegExp(`Sous-total des lignes</td><td class="nombre">${(66629).toLocaleString('fr-FR')} € TTC`));
    expect(p).toMatch(new RegExp(`data-cout-annexe>[\\s\\S]*Impression jusqu’à 5 visuels</td><td class="nombre">${(19975).toLocaleString('fr-FR')} € TTC`));
    expect(p).toMatch(new RegExp(`Total de la campagne</td><td class="nombre">${(86605).toLocaleString('fr-FR')} € TTC`));
    expect(p).not.toContain('data-ecart');
  });

  it('lignes + annexes = budget du plan, au centime près (l arrondi du fichier source est sous le centime)', () => {
    const t = totauxCampagne(DONNEES);
    expect(t.sousTotalLignes).toBeCloseTo(66629.44, 2);
    expect(t.annexes).toEqual([{ libelle: 'Impression jusqu’à 5 visuels', total_ttc: 19975.2 }]);
    expect(t.total).toBeCloseTo(86604.64, 2);
    expect(Math.round(t.total! * 100)).toBe(Math.round(DONNEES.campagne.budget_total_ttc! * 100));
    expect(t.ecart).toBe(0);
  });

  it('un budget qui diverge au-delà du centime est DIT, avec l écart chiffré, au lieu de deux totaux muets', () => {
    const html = genererExportHtml({ ...DONNEES, campagne: { ...DONNEES.campagne, budget_total_ttc: 90000 } }, { exporteLe: EXPORTE_LE });
    const p = pied(html);
    expect(p).toContain('data-ecart');
    const deux = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(p).toContain(`Écart avec le budget du plan (${deux(90000)} € TTC)`);
    expect(p).toContain(`${deux(3395.36)} €`);
  });

  it('sans coût annexe ni budget : un seul total, celui des lignes', () => {
    const html = genererExportHtml({ ...DONNEES, campagne: { ...DONNEES.campagne, budget_total_ttc: null, metadata: {} } }, { exporteLe: EXPORTE_LE });
    expect(pied(html)).not.toContain('data-cout-annexe');
    expect(pied(html)).toMatch(new RegExp(`Total de la campagne</td><td class="nombre">${(66629).toLocaleString('fr-FR')} € TTC`));
  });

  it('une campagne tronquée le dit', () => {
    const html = genererExportHtml({ ...DONNEES, tronque: true }, { exporteLe: EXPORTE_LE });
    expect(html).toContain('data-tronque');
  });

  it('dit que la carte exige une connexion, et que les tableaux restent lisibles sans', () => {
    expect(HTML).toMatch(/connexion internet/i);
  });
});

describe('genererExportHtml — autonomie', () => {
  it('aucun identifiant interne : ni UUID de campagne, de ligne, d emplacement ou d espace', () => {
    expect(HTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('aucune adresse de l application ni de la base', () => {
    expect(HTML).not.toMatch(/localhost|127\.0\.0\.1|supabase|\/api\//i);
  });

  it('seules dépendances : MapLibre épinglé sur un CDN public et le fond OpenFreeMap', () => {
    const urls = [...new Set(HTML.match(/https?:\/\/[^\s"'<>)]+/g) ?? [])];
    const autorisees = [
      `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION_EXPORT}/dist/maplibre-gl.js`,
      `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION_EXPORT}/dist/maplibre-gl.css`,
      URL_FOND_EXPORT,
    ];
    for (const u of urls) {
      const ok = autorisees.includes(u) || u.startsWith('https://tiles.openfreemap.org')
        || u.startsWith(`https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION_EXPORT}/dist/`);
      expect(ok, u).toBe(true);
    }
    expect(HTML).toContain(autorisees[0]);
    expect(HTML).toContain(autorisees[1]);
  });

  it('MapLibre est chargé avec son empreinte SRI (script et feuille de style)', () => {
    expect(HTML).toContain(`maplibre-gl.js" integrity="${SRI_MAPLIBRE.js}" crossorigin="anonymous"`);
    expect(HTML).toContain(`maplibre-gl.css" integrity="${SRI_MAPLIBRE.css}" crossorigin="anonymous"`);
  });

  it('les empreintes SRI sont celles des fichiers du paquet installé, tant que sa version est celle de l export', (ctx) => {
    const dossier = join(process.cwd(), 'node_modules', 'maplibre-gl');
    const version = existsSync(join(dossier, 'package.json'))
      ? (JSON.parse(readFileSync(join(dossier, 'package.json'), 'utf8')) as { version: string }).version : null;
    if (version !== MAPLIBRE_VERSION_EXPORT) ctx.skip();
    const sri = (f: string) => `sha384-${createHash('sha384').update(readFileSync(join(dossier, 'dist', f))).digest('base64')}`;
    expect(sri('maplibre-gl.js')).toBe(SRI_MAPLIBRE.js);
    expect(sri('maplibre-gl.css')).toBe(SRI_MAPLIBRE.css);
  });

  it('la version de MapLibre est exacte et de la même majeure que celle du projet', () => {
    expect(MAPLIBRE_VERSION_EXPORT).toMatch(/^\d+\.\d+\.\d+$/);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    const majeureProjet = pkg.dependencies['maplibre-gl'].replace(/^[^\d]*/, '').split('.')[0];
    expect(MAPLIBRE_VERSION_EXPORT.split('.')[0]).toBe(majeureProjet);
  });

  it('le fond est le fond « Clair » de l application (OpenFreeMap Positron)', () => {
    expect(URL_FOND_EXPORT).toBe('https://tiles.openfreemap.org/styles/positron');
  });

  it('une politique de sécurité de contenu limite les requêtes au CDN et à OpenFreeMap', () => {
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(HTML)?.[1];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/connect-src[^;]*\*/);
  });

  it('CSP : scripts limités au dossier du paquet MapLibre et au script inline par son empreinte, sans unsafe-inline', () => {
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(HTML)![1];
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '))!;
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toMatch(/https:\/\/cdn\.jsdelivr\.net(\s|$)/);
    expect(scriptSrc).toContain(`https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION_EXPORT}/dist/`);
    const inline = /<script>([\s\S]*?)<\/script>/.exec(HTML)![1];
    expect(scriptSrc).toContain(`'sha256-${createHash('sha256').update(inline, 'utf8').digest('base64')}'`);
  });

  it('impression : boutons de zoom masqués, carte redimensionnée, listes dépliées', () => {
    expect(HTML).toMatch(/@media print \{[\s\S]*\.maplibregl-ctrl-top-right[^{]*\{ display: none; \}/);
    expect(HTML).toContain('carte.resize()');
    expect(HTML).toContain("d.open = true");
  });

  it('carte : libellés du fond en français, anneau des points à vérifier ramené à 18 px', () => {
    expect(HTML).toContain("['get', 'name:fr']");
    expect(HTML).toContain('taille = 18');
  });
});

describe('genererExportHtml — échappement', () => {
  it('aucun texte des données n est interprété comme du HTML', () => {
    expect(HTML).not.toContain(XSS);
    expect(HTML).not.toContain('<img src=x');
    expect(HTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('les données inlinées ne peuvent pas fermer leur <script> ni en ouvrir un', () => {
    expect(HTML).not.toContain(XSS_SCRIPT);
    expect(HTML.match(/<\/script>/g)!.length).toBe(HTML.match(/<script/g)!.length);
    // …et restent lisibles à l'identique une fois parsées.
    const noms = donneesInlinees(HTML).features.map((f) => f.properties.nom);
    expect(noms[0]).toBe(XSS_SCRIPT);
  });

  it('un début de commentaire HTML et un séparateur de ligne U+2028 sont neutralisés', () => {
    expect(HTML).not.toContain('<!-- commentaire');
    expect(HTML).toContain('&lt;!-- commentaire');
    // Dans le JSON inliné, U+2028 est échappé (fin de ligne pour un moteur JavaScript ancien) ; en texte HTML, il est inoffensif.
    const json = /<script type="application\/json" id="donnees-carte">([\s\S]*?)<\/script>/.exec(HTML)![1];
    expect(json).not.toContain(SEP_LIGNE);
    expect(json).toContain('\\u2028');
    const p = donneesInlinees(HTML).features[3].properties;
    expect(p.nom).toBe('<!-- commentaire');
    expect(p.adresse).toBe(`rue${SEP_LIGNE}coupée`);
  });

  it('popup : une ligne vide (régie, ligne) n est pas écrite', () => {
    expect(HTML).toContain("q.regie ? 'Régie : ' + q.regie : ''");
  });

  it('les guillemets et esperluettes d une adresse sont échappés', () => {
    expect(HTML).toContain('&quot;guillemets&quot; &amp; &#39;apostrophes&#39;');
  });

  it('les popups de la carte sont construites par textContent, jamais par innerHTML', () => {
    expect(HTML).not.toMatch(/innerHTML|insertAdjacentHTML|setHTML/);
    expect(HTML).toContain('setDOMContent');
  });
});

describe('PALETTE_EXPORT_OOH — égale au thème clair de app/globals.css', () => {
  const CSS = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
  const blocsClairs: string[] = [];
  let i = 0;
  while ((i = CSS.indexOf('html.light', i)) !== -1) {
    const debut = CSS.indexOf('{', i);
    const fin = CSS.indexOf('}', debut);
    blocsClairs.push(CSS.slice(debut, fin));
    i = debut + 1;
  }
  const valeurClaire = (jeton: string): string | null => {
    for (const b of blocsClairs) {
      const m = new RegExp(`--${jeton}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(b);
      if (m) return m[1].toLowerCase();
    }
    return null;
  };

  const entrees = [...Object.values(PALETTE_EXPORT_OOH).filter((v) => !Array.isArray(v)), ...PALETTE_EXPORT_OOH.lignes] as { jeton: string; valeur: string }[];

  it.each(entrees.map((e) => [e.jeton, e.valeur]))('--%s vaut %s', (jeton, valeur) => {
    expect(valeurClaire(jeton)).toBe(valeur.toLowerCase());
  });

  it('huit teintes de ligne, dans l ordre des jetons --ligne-media-1..8', () => {
    expect(PALETTE_EXPORT_OOH.lignes.map((l) => l.jeton)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `ligne-media-${n}`));
  });

  it('aucun hex de couleur dans la page qui ne vienne de la palette', () => {
    const autorises = new Set(entrees.map((e) => e.valeur.toLowerCase()));
    const vus = [...new Set((HTML.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toLowerCase()))];
    expect(vus.filter((h) => !autorises.has(h))).toEqual([]);
  });
});

describe('nomFichierExport', () => {
  it('dérive le nom du fichier du nom de la campagne, sans accents ni espaces', () => {
    expect(nomFichierExport('Marine nationale — TF4 septembre 2026')).toBe('marine-nationale-tf4-septembre-2026.html');
    expect(nomFichierExport('Été à Noël / Côte d’Azur')).toBe('ete-a-noel-cote-d-azur.html');
  });

  it('un nom vide ou sans caractère utilisable donne un nom de repli', () => {
    expect(nomFichierExport('')).toBe('campagne-ooh.html');
    expect(nomFichierExport('— / —')).toBe('campagne-ooh.html');
  });
});
