/**
 * @file lib/ooh/export-html-page.ts
 *
 * La feuille de style et le script navigateur de l'export HTML autonome d'une campagne OOH (`lib/ooh/export-html.ts`).
 * Deux chaînes CONSTANTES : aucune donnée de la campagne n'y entre (elles passent par le JSON inliné, échappé), ce qui
 * permet d'autoriser le script par son empreinte dans la CSP.
 */
import { couleursSimples } from './export-html-config';

/**
 * La feuille de style. Ses variables portent les NOMS des jetons de `globals.css` (`--text-primary`,
 * `--border-subtle`…), déclarés dans le `:root` du document avec la valeur du thème clair : le CSS se lit comme celui
 * de l'application, et `tests/unit/design/jetons-css.test.ts` reconnaît chaque `var()`.
 */
export function feuilleDeStyle(): string {
  const jetonsCss = couleursSimples().map((c) => `--${c.jeton}: ${c.valeur};`).join(' ');
  return `
:root {
  ${jetonsCss}
  color-scheme: light;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg-level-0); color: var(--text-primary); }
body { font: 400 13px/1.5 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.page { max-width: 1120px; margin: 0 auto; padding: 32px 16px 48px; }
.mono, .nombre, .chiffre { font-family: "JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, monospace; }
.discret { color: var(--text-tertiary); }
header.entete { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 16px; }
.marque { font-weight: 500; font-size: 13px; color: var(--text-secondary); }
h1 { margin: 4px 0 2px; font-size: 22px; font-weight: 500; letter-spacing: -0.02em; }
.meta { color: var(--text-secondary); }
.exporte { color: var(--text-tertiary); font-size: 12px; text-align: right; }
.bloc { margin-top: 28px; }
.entete-section { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; padding: 10px 14px; background: var(--bg-level-2); border-top: 1px solid var(--border-subtle); font-size: 13px; font-weight: 500; }
.point { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-teal); flex: none; }
.tuiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.tuile { border: 0.5px solid var(--border-default); border-radius: 6px; padding: 10px 12px; background: var(--bg-level-0); }
.chiffre { font-size: 18px; font-weight: 500; }
.libelle { color: var(--text-secondary); font-size: 12px; }
.tuile-a-verifier { border-style: dashed; border-color: var(--anneau-a-verifier); }
.tuile-alerte .chiffre, .alerte { color: var(--warning); }
.note { color: var(--text-secondary); font-size: 12px; margin: 8px 0 0; }
.carte-cadre { position: relative; }
.carte { height: 520px; border: 0.5px solid var(--border-default); border-radius: 6px; background: var(--bg-level-1); }
.carte-indisponible { position: absolute; inset: 0; margin: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 24px; color: var(--text-secondary); }
.carte-indisponible[hidden] { display: none; }
.legende { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; }
.legende li { display: flex; align-items: center; gap: 6px; }
.pastille { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 1px solid var(--poi-contour); vertical-align: middle; margin-right: 6px; flex: none; }
.pastille-vide { border: 0.5px dashed var(--border-default); }
.anneau-exemple { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 1.5px dashed var(--anneau-a-verifier); vertical-align: middle; margin-right: 6px; }
.defilant { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; font-weight: 500; color: var(--text-secondary); border-bottom: 1px solid var(--border-default); padding: 6px 8px; white-space: nowrap; }
td { border-bottom: 0.5px solid var(--border-subtle); padding: 6px 8px; vertical-align: top; }
td.nombre, th.nombre { text-align: right; white-space: nowrap; }
th.nombre { font-family: inherit; }
.sans-coupure { white-space: nowrap; }
tfoot td { border-bottom: none; }
tfoot tr.sous-total td { border-top: 1px solid var(--border-default); }
tfoot tr.total td { font-weight: 500; border-top: 1px solid var(--border-default); }
tfoot tr.ecart td { color: var(--warning); }
tr.a-verifier td { background: var(--bg-level-1); }
.statut { display: inline-block; border: 0.5px solid var(--border-default); border-radius: 4px; padding: 0 6px; font-size: 11px; color: var(--text-secondary); }
.statut-a-verifier { border: 1px dashed var(--anneau-a-verifier); color: var(--text-primary); }
details.regie { border: 0.5px solid var(--border-default); border-radius: 6px; margin-top: 8px; }
details.regie > summary { cursor: pointer; padding: 10px 12px; }
.nom-regie { font-weight: 500; }
.contenu-regie { padding: 0 12px 12px; }
h3 { font-size: 13px; font-weight: 500; margin: 12px 0 6px; }
h4 { font-size: 12px; font-weight: 500; margin: 10px 0 4px; color: var(--warning); }
.non-places ul { margin: 0; padding-left: 18px; color: var(--text-secondary); }
.avis-tronque { margin-top: 16px; padding: 8px 12px; border: 0.5px solid var(--warning); border-radius: 6px; color: var(--warning); }
footer { margin-top: 32px; color: var(--text-tertiary); font-size: 11px; border-top: 1px solid var(--border-subtle); padding-top: 12px; }
.maplibregl-popup-content { font: 400 12px/1.5 Inter, system-ui, sans-serif; color: var(--text-primary); padding: 10px 12px; }
.popup-titre { font-weight: 500; margin-bottom: 4px; padding-right: 12px; }
.popup-ligne { color: var(--text-secondary); }
@media (max-width: 640px) { .carte { height: 380px; } .exporte { text-align: left; } }
@media print {
  .page { max-width: none; padding: 0; }
  .carte { height: 120mm; }
  .bloc { break-inside: auto; }
  details.regie > summary { list-style: none; }
  tr { break-inside: avoid; }
  /* Les boutons de zoom ne servent à rien sur papier ; l'attribution reste (licence OSM). */
  .maplibregl-ctrl-top-right, .maplibregl-popup { display: none; }
}`;
}

/**
 * Le script de la page (navigateur du client). Aucune requête autre que MapLibre et son fond ; popups par
 * `textContent`. L'anneau pointillé bicolore des points à vérifier reprend `imageAnneauPointille`
 * (`couche-campagne-ooh.ts` côté Angular) — 16 segments alternant cerne clair et sombre —, ramené à 18 px pour que
 * deux points voisins ne se chevauchent pas d'anneau à anneau. Les libellés du fond passent en français (`name:fr`,
 * repli `name`) : le style Positron écrit « Germany », « Brussels » par défaut.
 */
export function scriptPage(): string {
  return `
(function () {
  var donnees = JSON.parse(document.getElementById('donnees-carte').textContent);
  var carte = null;
  // À l'impression, toutes les listes par régie sont dépliées, et la carte reprend la taille de son cadre imprimé.
  window.addEventListener('beforeprint', function () {
    document.querySelectorAll('details').forEach(function (d) { d.open = true; });
    if (carte) carte.resize();
  });
  var indisponible = document.getElementById('carte-indisponible');
  function sansCarte() { indisponible.hidden = false; }
  if (typeof maplibregl === 'undefined') { sansCarte(); return; }

  function rgba(hex) {
    var h = hex.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
  }
  function anneau(clair, sombre) {
    var taille = 18, centre = taille / 2, rayon = centre - 1.5, couleurs = [rgba(clair), rgba(sombre)];
    var data = new Uint8Array(taille * taille * 4);
    for (var y = 0; y < taille; y++) {
      for (var x = 0; x < taille; x++) {
        var dx = x + 0.5 - centre, dy = y + 0.5 - centre;
        if (Math.abs(Math.hypot(dx, dy) - rayon) > 1) continue;
        var angle = Math.atan2(dy, dx) + Math.PI;
        var c = couleurs[Math.floor((angle / (2 * Math.PI)) * 16) % 2];
        var i = (y * taille + x) * 4;
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3];
      }
    }
    return { width: taille, height: taille, data: data };
  }
  function libellesEnFrancais() {
    carte.getStyle().layers.forEach(function (couche) {
      if (couche.type !== 'symbol') return;
      var champ = carte.getLayoutProperty(couche.id, 'text-field');
      if (champ && JSON.stringify(champ).indexOf('name') !== -1) {
        carte.setLayoutProperty(couche.id, 'text-field', ['coalesce', ['get', 'name:fr'], ['get', 'name']]);
      }
    });
  }

  try {
    carte = new maplibregl.Map({
      container: 'carte', style: donnees.fond, center: [2.5, 46.5], zoom: 4.6, attributionControl: { compact: true },
      // Tampon conservé : sans lui, l'impression et les captures pleine page rendent une carte vide ou partielle.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
  } catch (e) { sansCarte(); return; }
  carte.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  carte.on('error', function () { if (!carte.isStyleLoaded()) sansCarte(); });

  carte.on('load', function () {
    libellesEnFrancais();
    var p = donnees.palette;
    var couleur = ['match', ['get', 'rang']];
    p.lignes.forEach(function (c, i) { couleur.push(i + 1, c); });
    couleur.push(p.lignes[0]);
    carte.addSource('emplacements', { type: 'geojson', data: donnees.points });
    carte.addImage('anneau-a-verifier', anneau(p.contour, p.anneau));
    carte.addLayer({ id: 'emplacements', type: 'circle', source: 'emplacements', paint: {
      'circle-color': couleur, 'circle-radius': 5.5, 'circle-opacity': 0.92,
      'circle-stroke-color': p.contour,
      'circle-stroke-width': ['case', ['==', ['get', 'qualite'], 'a_verifier'], 0, 1.5],
    } });
    carte.addLayer({ id: 'emplacements-a-verifier', type: 'symbol', source: 'emplacements',
      filter: ['==', ['get', 'qualite'], 'a_verifier'],
      layout: { 'icon-image': 'anneau-a-verifier', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    if (donnees.emprise) {
      var b = donnees.emprise;
      carte.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 13, duration: 0 });
    }

    function ligneTexte(parent, texte, classe) {
      if (!texte) return;
      var el = document.createElement('div');
      el.className = classe || 'popup-ligne';
      el.textContent = texte;
      parent.appendChild(el);
    }
    carte.on('click', 'emplacements', function (e) {
      var f = e.features && e.features[0];
      if (!f) return;
      var q = f.properties;
      var boite = document.createElement('div');
      ligneTexte(boite, q.nom || 'Emplacement sans nom', 'popup-titre');
      ligneTexte(boite, q.ligne ? 'Ligne : ' + q.ligne : '');
      ligneTexte(boite, q.regie ? 'Régie : ' + q.regie : '');
      ligneTexte(boite, [q.adresse, [q.code_postal, q.ville].filter(Boolean).join(' ')].filter(Boolean).join(', '));
      ligneTexte(boite, q.ecrans ? 'Écrans : ' + q.ecrans : '');
      ligneTexte(boite, 'Statut : ' + (q.qualite === 'a_verifier'
        ? 'à vérifier' + (q.geoloc ? ' (position proposée : ' + q.geoloc + ')' : '') : 'emplacement sûr'));
      new maplibregl.Popup({ maxWidth: '300px' }).setLngLat(f.geometry.coordinates).setDOMContent(boite).addTo(carte);
    });
    carte.on('mouseenter', 'emplacements', function () { carte.getCanvas().style.cursor = 'pointer'; });
    carte.on('mouseleave', 'emplacements', function () { carte.getCanvas().style.cursor = ''; });
  });
})();`;
}
