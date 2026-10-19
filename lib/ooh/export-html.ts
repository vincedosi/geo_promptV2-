/**
 * @file lib/ooh/export-html.ts
 *
 * Export HTML AUTONOME d'une campagne OOH (bible des priorités, ligne 30 ; premier client : TF4 Marine) : un seul
 * fichier `.html` à envoyer au client, qui n'a pas accès à l'application. Fonction PURE : données de
 * `campagne_ooh_jsonb` (sql/263) → chaîne HTML. La route `GET /api/map/ooh/campagnes/[id]/export-html` la sert en
 * pièce jointe. Constantes (palette, MapLibre, CSP) : `export-html-config.ts` ; feuille de style et script navigateur :
 * `export-html-page.ts`.
 *
 * ── CE QUE LE FICHIER CONTIENT ───────────────────────────────────────────
 * En-tête (nom, vague, période, date de l'export, « dentsu.explore » en texte), synthèse chiffrée (lignes, panneaux
 * sûrs / à vérifier / non placés, montant), carte des emplacements colorés par ligne avec légende et popup au clic,
 * tableau des lignes du plan (DROM compris) dont le pied va de la somme des lignes au total de la campagne en passant
 * par les coûts annexes (`totauxCampagne`), listes des emplacements groupées par régie (`<details>`, dépliés à
 * l'impression).
 *
 * ── AUTONOMIE ────────────────────────────────────────────────────────────
 * Données inlinées (`<script type="application/json">`), CSS inline, aucun appel vers l'application ni vers la base.
 * AUCUN identifiant interne n'est écrit : ni l'UUID de la campagne, ni ceux des lignes, des panneaux ou de l'espace —
 * une ligne est désignée par son rang de teinte, un point par son nom. Deux dépendances externes seulement, bornées par
 * la CSP : MapLibre GL JS épinglé (et vérifié par SRI) sur jsDelivr, et le fond « Clair » d'OpenFreeMap. Sans réseau,
 * la carte ne s'affiche pas — la page le dit — mais les tableaux restent lisibles.
 *
 * ── ÉCHAPPEMENT ──────────────────────────────────────────────────────────
 * Tout texte issu des données passe par `echapper` (HTML) ou par `jsonDansScript` (les `<`, `>`, `&`, U+2028 et
 * U+2029 du JSON inliné deviennent des `\u…` : une adresse ne peut ni fermer le `<script>` ni en ouvrir un). Les popups
 * sont construites par `textContent`, jamais par `innerHTML`.
 */
import { createHash } from 'node:crypto';
import { formaterDecimal, formaterNombre, formaterNombreArrondi } from '@/lib/format/nombre';
import type { CampagneOohLue, EmplacementOohLu, LigneOohLue } from '@/types/campagne-ooh';
import { type TotauxCampagne, totauxCampagne } from './export-html-totaux';
import { CDN_MAPLIBRE, PALETTE_EXPORT_OOH, SRI_MAPLIBRE, URL_FOND_EXPORT, politiqueContenu } from './export-html-config';
import { feuilleDeStyle, scriptPage } from './export-html-page';

const NB_TEINTES = PALETTE_EXPORT_OOH.lignes.length;
const ABSENT = '—';
const SANS_REGIE = 'Régie non renseignée';

export interface OptionsExportHtml {
  /** L'instant de l'export, écrit dans l'en-tête (date de Paris). */
  exporteLe: Date;
}

// ── Petits outils ─────────────────────────────────────────────────────────

/** Échappe un texte pour le HTML, contenu ET valeur d'attribut. */
function echapper(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** U+2028 et U+2029 : valides en JSON, fins de ligne pour un moteur JavaScript ancien. Écrits par code, pas en littéral. */
const SEPARATEURS_JS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g');

/** JSON sûr à poser dans un `<script type="application/json">` : aucun `<`, `>`, `&`, ni séparateur de ligne JS. */
function jsonDansScript(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(SEPARATEURS_JS, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

function dateFr(iso: string | null): string {
  if (!iso) return ABSENT;
  const [a, m, j] = iso.slice(0, 10).split('-');
  return `${j}/${m}/${a}`;
}

/** « 20/09/2026 → 02/10/2026 » ; « — » sans aucune date. */
function periode(debut: string | null, fin: string | null): string {
  return !debut && !fin ? ABSENT : `${dateFr(debut)} → ${dateFr(fin)}`;
}

function dateDeParis(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/** « 48 480 € TTC », arrondi à l'euro ; « — » sans montant. */
function montant(v: number | null): string {
  return v === null || !Number.isFinite(v) ? ABSENT : `${formaterNombreArrondi(v)} € TTC`;
}

function pluriel(n: number, singulier: string, plurielForme = `${singulier}s`): string {
  return `${formaterNombre(n)} ${n > 1 ? plurielForme : singulier}`;
}

function libelleLigne(l: LigneOohLue): string {
  return [l.regie ?? SANS_REGIE, l.reseau ?? l.territoire].filter(Boolean).join(' · ');
}

/**
 * Le rang de teinte (1 à 8) de chaque ligne qui a des emplacements, dans l'ordre du plan — la règle de
 * `rangsDesLignes` côté Angular (`features/carte/logique/campagnes-ooh.ts`) : l'export et la carte de l'application
 * peignent une ligne de la même teinte.
 */
function rangsDesLignes(lignes: readonly LigneOohLue[]): Map<string, number> {
  const rangs = new Map<string, number>();
  [...lignes].filter((l) => l.a_des_emplacements).sort((a, b) => a.ordre - b.ordre)
    .forEach((l, i) => rangs.set(l.id, (i % NB_TEINTES) + 1));
  return rangs;
}

function couleurDuRang(rang: number): string {
  return PALETTE_EXPORT_OOH.lignes[(rang - 1) % NB_TEINTES].valeur;
}

/** L'emprise des points SÛRS ; de tous s'il n'y en a aucun de sûr ; `null` sans point (règle `emprise` de l'Angular). */
function emprise(emplacements: readonly EmplacementOohLu[]): [number, number, number, number] | null {
  const surs = emplacements.filter((e) => e.properties.geoloc_qualite !== 'a_verifier');
  const points = surs.length > 0 ? surs : emplacements;
  if (points.length === 0) return null;
  const lng = points.map((e) => e.geometry.coordinates[0]);
  const lat = points.map((e) => e.geometry.coordinates[1]);
  return [Math.min(...lng), Math.min(...lat), Math.max(...lng), Math.max(...lat)];
}

function nonPlaces(l: LigneOohLue): { nom: string; raison: string }[] {
  return Array.isArray(l.details?.non_places) ? l.details.non_places : [];
}

/**
 * La raison d'un non-placement, dite pour le CLIENT. L'import écrit des raisons techniques (`lib/ooh/plan/
 * geolocaliser.ts`) qui citent « BAN », un sigle interne : on les reformule ; toute autre raison passe telle quelle,
 * « BAN » y étant développé.
 */
function raisonPourClient(raison: string): string {
  if (/^adresse introuvable \(BAN\)$/.test(raison)) return 'adresse introuvable dans la base d’adresses nationale';
  if (/hors du territoire de la ligne/.test(raison)) return 'adresse trouvée hors du territoire de la ligne (outre-mer)';
  if (/^score BAN /.test(raison)) return 'adresse reconnue avec trop peu de certitude';
  return raison.replace(/\bBAN\b/g, 'base d’adresses nationale');
}

function comparerEmplacements(a: EmplacementOohLu, b: EmplacementOohLu): number {
  const pa = a.properties;
  const pb = b.properties;
  return (pa.code_postal ?? '').localeCompare(pb.code_postal ?? '', 'fr')
    || (pa.ville ?? '').localeCompare(pb.ville ?? '', 'fr')
    || (pa.nom_lieu ?? '').localeCompare(pb.nom_lieu ?? '', 'fr');
}

// ── Nom du fichier ────────────────────────────────────────────────────────

/** `Marine nationale — TF4 septembre 2026` → `marine-nationale-tf4-septembre-2026.html` ; repli `campagne-ooh.html`. */
export function nomFichierExport(nom: string): string {
  const base = (nom ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'campagne-ooh'}.html`;
}

// ── Sections ──────────────────────────────────────────────────────────────

function sectionSynthese(d: CampagneOohLue, t: TotauxCampagne): string {
  const places = d.emplacements.length;
  const aVerifier = d.emplacements.filter((e) => e.properties.geoloc_qualite === 'a_verifier').length;
  const nbNonPlaces = d.lignes.reduce((s, l) => s + nonPlaces(l).length, 0);
  const sansListe = d.lignes.filter((l) => !l.a_des_emplacements);
  const ecransSansListe = sansListe.reduce((s, l) => s + (l.nb_ecrans ?? 0), 0);
  const tuile = (cle: string, valeur: string, libelle: string, classe = '') =>
    `<div class="tuile${classe}"><div class="chiffre" data-chiffre="${cle}">${echapper(valeur)}</div><div class="libelle">${echapper(libelle)}</div></div>`;
  return `<section class="bloc" data-synthese>
  <h2 class="entete-section"><span class="point"></span>Synthèse</h2>
  <div class="tuiles">
    ${tuile('lignes', formaterNombre(d.lignes.length), 'lignes du plan')}
    ${tuile('places', formaterNombre(places), 'panneaux placés sur la carte')}
    ${tuile('surs', formaterNombre(places - aVerifier), 'à l’emplacement sûr')}
    ${tuile('a-verifier', formaterNombre(aVerifier), 'à vérifier (cerne pointillé)', ' tuile-a-verifier')}
    ${tuile('non-places', formaterNombre(nbNonPlaces), 'non placés (listés par régie)', nbNonPlaces > 0 ? ' tuile-alerte' : '')}
    ${tuile('montant', montant(t.budget ?? t.total), t.budget !== null ? 'budget de la campagne' : 'total de la campagne')}
  </div>
  ${sansListe.length > 0 ? `<p class="note">${echapper(pluriel(sansListe.length, 'ligne'))} sans liste d’emplacements fournie par la régie (${echapper(pluriel(ecransSansListe, 'écran'))}) : elles figurent au plan, pas sur la carte.</p>` : ''}
</section>`;
}

function sectionCarte(d: CampagneOohLue, rangs: Map<string, number>): string {
  const legende = d.lignes.filter((l) => rangs.has(l.id)).map((l) =>
    `<li><span class="pastille" style="background:${couleurDuRang(rangs.get(l.id)!)}"></span>${echapper(libelleLigne(l))} <span class="mono discret">(${echapper(formaterNombre(l.nb_places))})</span></li>`,
  ).join('\n      ');
  return `<section class="bloc">
  <h2 class="entete-section"><span class="point"></span>Carte des emplacements</h2>
  <div class="carte-cadre">
    <div id="carte" class="carte" role="region" aria-label="Carte des emplacements"></div>
    <p id="carte-indisponible" class="carte-indisponible" hidden>La carte n’a pas pu se charger : elle nécessite une connexion internet. Les tableaux ci-dessous restent complets.</p>
  </div>
  <div class="sous-carte">
    <ul class="legende" data-legende>
      ${legende}
    </ul>
    <p class="note"><span class="anneau-exemple"></span>Cerne pointillé : emplacement à vérifier (position proposée par la géolocalisation, non confirmée). Cliquer un point pour sa fiche.</p>
    <p class="note discret">La carte nécessite une connexion internet (bibliothèque MapLibre et fond OpenFreeMap) ; sans réseau, les tableaux de ce document restent lisibles.</p>
  </div>
</section>`;
}

/** Le pied du tableau du plan : sous-total des lignes, coûts annexes, total de la campagne, et l'écart s'il y en a un. */
function piedDuPlan(t: TotauxCampagne): string {
  const rangee = (libelle: string, valeur: string, attributs = '') =>
    `<tr${attributs}><td colspan="8">${echapper(libelle)}</td><td class="nombre">${echapper(valeur)}</td></tr>`;
  const rangees: string[] = [];
  if (t.annexes.length > 0) {
    rangees.push(rangee('Sous-total des lignes', montant(t.sousTotalLignes), ' class="sous-total"'));
    for (const a of t.annexes) rangees.push(rangee(a.libelle, montant(a.total_ttc), ' data-cout-annexe'));
  }
  rangees.push(rangee('Total de la campagne', montant(t.total), ' class="total"'));
  if (t.ecart !== 0 && t.budget !== null) {
    rangees.push(rangee(`Écart avec le budget du plan (${formaterDecimal(t.budget, 2)} € TTC) : non ventilé par le plan`,
      `${formaterDecimal(t.ecart, 2)} €`, ' class="ecart" data-ecart'));
  }
  return rangees.join('\n      ');
}

function sectionLignes(d: CampagneOohLue, rangs: Map<string, number>, t: TotauxCampagne): string {
  const rangees = d.lignes.map((l) => {
    const rang = rangs.get(l.id);
    const pastille = rang ? `<span class="pastille" style="background:${couleurDuRang(rang)}"></span>` : '<span class="pastille pastille-vide"></span>';
    const np = nonPlaces(l).length;
    const emplacements = l.a_des_emplacements
      ? `<td class="nombre">${echapper(formaterNombre(l.nb_places))}</td><td class="nombre">${l.nb_a_verifier > 0 ? echapper(formaterNombre(l.nb_a_verifier)) : ABSENT}</td><td class="nombre${np > 0 ? ' alerte' : ''}">${np > 0 ? echapper(formaterNombre(np)) : ABSENT}</td>`
      : '<td colspan="3" class="discret">Liste non fournie par la régie</td>';
    const duree = l.duree_libelle ? ` <span class="discret">(${echapper(l.duree_libelle)})</span>` : '';
    return `<tr data-ligne>
        <td class="nombre">${echapper(l.ordre)}</td>
        <td class="sans-coupure">${pastille}${echapper(l.regie ?? SANS_REGIE)}</td>
        <td>${echapper(l.reseau ?? l.territoire ?? ABSENT)}${l.format ? ` <span class="discret">${echapper(l.format)}</span>` : ''}</td>
        <td class="mono">${echapper(periode(l.date_debut, l.date_fin))}${duree}</td>
        <td class="nombre">${echapper(formaterNombre(l.nb_ecrans))}</td>
        ${emplacements}
        <td class="nombre">${echapper(montant(l.total_ttc))}</td>
      </tr>`;
  }).join('\n      ');
  return `<section class="bloc">
  <h2 class="entete-section"><span class="point"></span>Lignes du plan</h2>
  <div class="defilant">
    <table data-lignes>
      <thead><tr>
        <th class="nombre">N°</th><th>Régie</th><th>Réseau ou territoire</th><th>Période</th><th class="nombre">Écrans</th>
        <th class="nombre">Placés</th><th class="nombre">À vérifier</th><th class="nombre">Non placés</th><th class="nombre">Total</th>
      </tr></thead>
      <tbody>
      ${rangees}
      </tbody>
      <tfoot>
      ${piedDuPlan(t)}
      </tfoot>
    </table>
  </div>
</section>`;
}

function rangeeEmplacement(e: EmplacementOohLu): string {
  const p = e.properties;
  const aVerifier = p.geoloc_qualite === 'a_verifier';
  const statut = aVerifier
    ? `<span class="statut statut-a-verifier">À vérifier</span>${p.geoloc_libelle ? `<div class="discret">Position proposée : ${echapper(p.geoloc_libelle)}</div>` : ''}`
    : '<span class="statut">Sûr</span>';
  return `<tr data-emplacement${aVerifier ? ' class="a-verifier"' : ''}>
            <td>${echapper(p.nom_lieu ?? 'Emplacement sans nom')}</td>
            <td>${echapper(p.adresse ?? ABSENT)}</td>
            <td class="mono">${echapper(p.code_postal ?? ABSENT)}</td>
            <td>${echapper(p.ville ?? ABSENT)}</td>
            <td class="nombre">${echapper(formaterNombre(p.nb_ecrans))}</td>
            <td>${statut}</td>
          </tr>`;
}

function blocLigne(l: LigneOohLue, points: readonly EmplacementOohLu[]): string {
  const rangees = [...points].sort(comparerEmplacements).map(rangeeEmplacement).join('\n          ');
  const liste = nonPlaces(l);
  const non = liste.length > 0
    ? `<div class="non-places"><h4>Non placés (${echapper(formaterNombre(liste.length))})</h4><ul>${liste.map((n) => `<li><strong>${echapper(n.nom)}</strong> — ${echapper(raisonPourClient(n.raison))}</li>`).join('')}</ul></div>`
    : '';
  return `<h3>${echapper(libelleLigne(l))}</h3>
      <div class="defilant">
        <table>
          <thead><tr><th>Lieu</th><th>Adresse</th><th>Code postal</th><th>Ville</th><th class="nombre">Écrans</th><th>Statut</th></tr></thead>
          <tbody>
          ${rangees}
          </tbody>
        </table>
      </div>
      ${non}`;
}

function sectionRegies(d: CampagneOohLue): string {
  const groupes = new Map<string, LigneOohLue[]>();
  for (const l of [...d.lignes].sort((a, b) => a.ordre - b.ordre)) {
    if (l.a_des_emplacements) groupes.set(l.regie ?? SANS_REGIE, [...(groupes.get(l.regie ?? SANS_REGIE) ?? []), l]);
  }
  const parLigne = new Map<string, EmplacementOohLu[]>();
  for (const e of d.emplacements) parLigne.set(e.properties.ligne_id, [...(parLigne.get(e.properties.ligne_id) ?? []), e]);

  const blocs = [...groupes].map(([regie, lignes]) => {
    const points = lignes.flatMap((l) => parLigne.get(l.id) ?? []);
    const aVerifier = points.filter((e) => e.properties.geoloc_qualite === 'a_verifier').length;
    const np = lignes.reduce((s, l) => s + nonPlaces(l).length, 0);
    const resume = [pluriel(points.length, 'emplacement'), aVerifier > 0 ? `${formaterNombre(aVerifier)} à vérifier` : null,
      np > 0 ? pluriel(np, 'non placé') : null].filter(Boolean).join(' · ');
    return `<details class="regie" data-regie="${echapper(regie)}">
    <summary><span class="nom-regie">${echapper(regie)}</span> <span class="discret">${echapper(resume)}</span></summary>
    <div class="contenu-regie">
      ${lignes.map((l) => blocLigne(l, parLigne.get(l.id) ?? [])).join('\n')}
    </div>
  </details>`;
  }).join('\n  ');

  return `<section class="bloc">
  <h2 class="entete-section"><span class="point"></span>Emplacements par régie</h2>
  ${blocs || '<p class="note">Aucune régie n’a fourni de liste d’emplacements.</p>'}
</section>`;
}

// ── Le document ───────────────────────────────────────────────────────────

/** Les données de la carte : AUCUN identifiant (ni panneau, ni ligne) — le rang de teinte et des textes. */
function donneesCarte(d: CampagneOohLue, rangs: Map<string, number>) {
  const lignesParId = new Map(d.lignes.map((l) => [l.id, l]));
  return {
    fond: URL_FOND_EXPORT,
    emprise: emprise(d.emplacements),
    palette: {
      lignes: PALETTE_EXPORT_OOH.lignes.map((c) => c.valeur),
      contour: PALETTE_EXPORT_OOH.contour.valeur,
      anneau: PALETTE_EXPORT_OOH.anneau.valeur,
    },
    points: {
      type: 'FeatureCollection',
      features: d.emplacements.map((e) => {
        const p = e.properties;
        const l = lignesParId.get(p.ligne_id);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: e.geometry.coordinates },
          properties: {
            rang: rangs.get(p.ligne_id) ?? 1, ligne: l ? libelleLigne(l) : '', regie: l?.regie ?? p.regie ?? '',
            nom: p.nom_lieu ?? '', adresse: p.adresse ?? '', code_postal: p.code_postal ?? '', ville: p.ville ?? '',
            ecrans: p.nb_ecrans, qualite: p.geoloc_qualite ?? 'sure', geoloc: p.geoloc_libelle ?? '',
          },
        };
      }),
    },
  };
}

/** Le document HTML complet et autonome de la campagne. */
export function genererExportHtml(d: CampagneOohLue, options: OptionsExportHtml): string {
  const rangs = rangsDesLignes(d.lignes);
  const totaux = totauxCampagne(d);
  const script = scriptPage();
  const csp = politiqueContenu(`sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}`);
  const c = d.campagne;
  const meta = [c.annonceur, c.vague ? `Vague ${c.vague}` : null, `Période : ${periode(c.date_debut, c.date_fin)}`]
    .filter(Boolean).map((x) => echapper(x)).join(' · ');
  const exporte = echapper(dateDeParis(options.exporteLe));

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="robots" content="noindex">
<title>${echapper(c.nom)} · dentsu.explore</title>
<link rel="stylesheet" href="${CDN_MAPLIBRE}maplibre-gl.css" integrity="${SRI_MAPLIBRE.css}" crossorigin="anonymous">
<style>${feuilleDeStyle()}
</style>
</head>
<body>
<main class="page">
<header class="entete">
  <div>
    <div class="marque">dentsu.explore · Campagne OOH</div>
    <h1>${echapper(c.nom)}</h1>
    <div class="meta">${meta}</div>
  </div>
  <div class="exporte">Exporté le ${exporte}<br>Document autonome, sans accès à l’application</div>
</header>
${d.tronque ? `<p class="avis-tronque" data-tronque>Campagne tronquée : seuls les ${echapper(formaterNombre(d.emplacements.length))} premiers emplacements figurent dans ce document.</p>` : ''}
${sectionSynthese(d, totaux)}
${sectionCarte(d, rangs)}
${sectionLignes(d, rangs, totaux)}
${sectionRegies(d)}
<footer>Généré par dentsu.explore le ${exporte}. Positions géolocalisées à partir des listes fournies par les régies ; les emplacements « à vérifier » n’ont pas été confirmés. Fond de carte © OpenFreeMap, © contributeurs OpenStreetMap.</footer>
</main>
<script type="application/json" id="donnees-carte">${jsonDansScript(donneesCarte(d, rangs))}</script>
<script src="${CDN_MAPLIBRE}maplibre-gl.js" integrity="${SRI_MAPLIBRE.js}" crossorigin="anonymous"></script>
<script>${script}</script>
</body>
</html>
`;
}
