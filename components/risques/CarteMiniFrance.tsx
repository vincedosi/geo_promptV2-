'use client';

/**
 * Mini-carte de France en SVG, à côté du tableau de population exposée.
 *
 * ── POURQUOI DU SVG ET PAS MAPLIBRE ───────────────────────────────────────
 *
 * Il n'y a rien à naviguer. Pas de zoom, pas de fond de carte, pas de tuiles :
 * une seule vue fixe de la France, 104 départements ou 13 régions, qui réagit
 * au même jeu de données que le tableau. Monter une instance MapLibre pour ça
 * coûterait un canvas WebGL, un style à charger et un cycle de vie à gérer,
 * pour un résultat moins net qu'un tracé vectoriel.
 *
 * Conséquence directe et voulue : **cette carte n'entre PAS au registre des
 * dégradés** (`lib/carte/degrades.ts`). Ce registre garantit qu'une seule
 * choroplèthe s'affiche à la fois sur la carte PRINCIPALE ; l'y inscrire
 * éteindrait le calque que l'utilisateur regardait derrière l'overlay.
 *
 * ── LA PROJECTION ─────────────────────────────────────────────────────────
 *
 * Mercator sphérique, comme la carte principale : les deux doivent donner la
 * même silhouette à la France, sinon le passage de l'une à l'autre désoriente.
 * Le calcul tient en trois lignes parce que l'étendue est fixe — on n'a pas
 * besoin d'une bibliothèque de projection pour un cadre qui ne bouge jamais.
 *
 * ── L'ÉCHELLE DE COULEUR ──────────────────────────────────────────────────
 *
 * Par QUANTILES et non linéaire. La population exposée est très concentrée :
 * quelques bassins industriels écrasent tout le reste, et une échelle linéaire
 * rendrait 95 départements de la même teinte pâle. Les quantiles montrent la
 * hiérarchie réelle — au prix, assumé et dit dans la légende, d'une échelle
 * qui n'est pas proportionnelle.
 *
 * Une unité SANS valeur reçoit `--donnee-absente`, jamais la teinte la plus
 * faible de la rampe : « pas de site ici » et « peu de population exposée » ne
 * doivent pas se ressembler.
 */
import React, { useMemo, useState } from 'react';
import { formaterNombre } from '@/lib/format/nombre';

/** Une entité administrative telle que `/api/meteo-geo/zones` la rend. */
export interface ZoneGeo {
  type: 'Feature';
  properties: { code: string; nom: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}

interface Props {
  zones: ZoneGeo[];
  /** Valeur à peindre, par code d'unité. Absente = unité non exposée. */
  valeurs: Map<string, number>;
  /** Ce que la couleur encode — sert la légende et l'infobulle. */
  libelleValeur: string;
  /** Formatage de la valeur dans l'infobulle. */
  formater?: (v: number) => string;
  /**
   * Les couleurs, du plus faible au plus fort. Fournies par l'appelant plutôt
   * que figées ici : c'est le catalogue déjà utilisé par les carreaux et les
   * IRIS (`lib/carreaux/catalogue.ts`), et l'utilisateur choisit.
   *
   * La rampe séquentielle teal du Suivi V2 servait avant ce changement. Elle
   * est dérivée de l'accent de marque, donc très claire à son extrémité basse :
   * sur fond clair, les départements peu exposés — la majorité — devenaient
   * indiscernables du fond. C'est le « on voit des zones blanches » signalé.
   */
  stops: string[];
  /** Unité survolée ou sélectionnée dans le tableau, mise en évidence ici. */
  codeActif?: string | null;
  onSurvol?: (code: string | null) => void;
  onClic?: (code: string) => void;
}

/** Mercator sphérique, borné à la métropole. Les DROM ne sont pas dessinés. */
const BORNES = { ouest: -5.3, est: 9.8, sud: 41.2, nord: 51.2 };
const fInterCarte = 'Inter, system-ui, sans-serif';
const LARGEUR = 300;
const HAUTEUR = 300;

function mercatorY(lat: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

const Y_SUD = mercatorY(BORNES.sud);
const Y_NORD = mercatorY(BORNES.nord);

function projeter(lon: number, lat: number): [number, number] {
  const x = ((lon - BORNES.ouest) / (BORNES.est - BORNES.ouest)) * LARGEUR;
  const y = HAUTEUR - ((mercatorY(lat) - Y_SUD) / (Y_NORD - Y_SUD)) * HAUTEUR;
  return [x, y];
}

/**
 * Anneaux GeoJSON → attribut `d` d'un `<path>`.
 *
 * Tolère une géométrie absente ou vide plutôt que de lever : une seule feature
 * sans coordonnées faisait tomber TOUT le composant dans son `ErrorBoundary`,
 * donc toute la carte, pour un département manquant. Un tracé vide est la
 * bonne réponse — l'unité apparaît simplement en gris.
 */
function versChemin(g: ZoneGeo['geometry'] | null | undefined): string {
  if (!g || !Array.isArray(g.coordinates)) return '';
  const polygones = g.type === 'Polygon'
    ? [g.coordinates as number[][][]]
    : (g.coordinates as number[][][][]);
  if (!Array.isArray(polygones)) return '';
  const morceaux: string[] = [];
  for (const poly of polygones) {
    if (!Array.isArray(poly)) continue;
    for (const anneau of poly) {
      if (!Array.isArray(anneau)) continue;
      if (anneau.length < 3) continue;
      const pts = anneau.map(([lon, lat]) => projeter(lon, lat));
      morceaux.push(
        `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`,
      );
    }
  }
  return morceaux.join('');
}

export function CarteMiniFrance({
  zones,
  valeurs,
  libelleValeur,
  formater = formaterNombre,
  stops,
  codeActif,
  onSurvol,
  onClic,
}: Props) {
  const rampe = stops;
  const [survole, setSurvole] = useState<string | null>(null);

  // Seuils de quantiles, recalculés quand les valeurs changent. Seules les
  // unités RENSEIGNÉES entrent dans le calcul : inclure les zéros écraserait
  // la moitié basse de l'échelle.
  const seuils = useMemo(() => {
    const v = [...valeurs.values()].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (v.length === 0) return [];
    return rampe.slice(1).map((_, i) => v[Math.floor(((i + 1) / rampe.length) * v.length)] ?? v[v.length - 1]);
  }, [valeurs, rampe]);

  const couleur = (code: string): string => {
    const v = valeurs.get(code);
    if (v === undefined || !Number.isFinite(v) || v <= 0) return 'var(--donnee-absente)';
    let i = 0;
    while (i < seuils.length && v >= seuils[i]) i++;
    return rampe[Math.min(i, rampe.length - 1)];
  };

  const chemins = useMemo(
    () => zones.map((z) => ({ code: z.properties.code, nom: z.properties.nom, d: versChemin(z.geometry) })),
    [zones],
  );

  const enAvant = survole ?? codeActif ?? null;
  const infobulle = enAvant
    ? { nom: chemins.find((c) => c.code === enAvant)?.nom ?? enAvant, valeur: valeurs.get(enAvant) }
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <svg
        viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
        role="img"
        aria-label={`Carte de France — ${libelleValeur}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => { setSurvole(null); onSurvol?.(null); }}
      >
        {chemins.map((c) => {
          const actif = enAvant === c.code;
          return (
            <path
              key={c.code}
              d={c.d}
              fill={couleur(c.code)}
              /* Le contour porte la lecture quand le remplissage est pâle ou
                 absent : a 0,4 px il disparaissait, et une unite sans donnee
                 se confondait avec le fond de la page. */
              stroke={actif ? 'var(--brand-teal)' : 'var(--text-tertiary)'}
              strokeWidth={actif ? 1.6 : 0.7}
              style={{ cursor: onClic ? 'pointer' : 'default', transition: 'fill 200ms var(--ease-out)' }}
              onMouseEnter={() => { setSurvole(c.code); onSurvol?.(c.code); }}
              onClick={() => onClic?.(c.code)}
            >
              <title>{`${c.nom} — ${valeurs.has(c.code) ? formater(valeurs.get(c.code) as number) : 'aucune exposition'}`}</title>
            </path>
          );
        })}
      </svg>

      {/* Infobulle textuelle sous la carte plutôt que flottante : elle ne
          recouvre jamais le tracé, et reste lisible au clavier. */}
      <div
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 11,
          color: 'var(--text-secondary)',
          minHeight: 16,
        }}
      >
        {infobulle ? (
          <>
            <span style={{ color: 'var(--text-primary)' }}>{infobulle.nom}</span>
            {' — '}
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {infobulle.valeur !== undefined ? formater(infobulle.valeur) : 'aucune exposition'}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--text-tertiary)' }}>Survolez une unité</span>
        )}
      </div>

      {/* Échelle. Elle dit « par quantiles » parce qu'elle n'est PAS
          proportionnelle : trois départements écrasent la distribution. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden' }}>
          {rampe.map((c, i) => (
            <span key={i} style={{ flex: 1, background: c }} />
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            color: 'var(--text-tertiary)',
          }}
        >
          <span>faible</span>
          <span>{libelleValeur} · quantiles</span>
          <span>fort</span>
        </div>

        {/* « Aucune exposition » n'est PAS la valeur la plus faible de la
            rampe, et la legende doit le montrer : sans cette ligne, un
            departement gris se lit « peu expose » alors qu'il n'a aucun site.
            C'est la meme regle que `--donnee-absente` ailleurs dans le produit. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
          <span
            style={{
              width: 12, height: 6, borderRadius: 2,
              background: 'var(--donnee-absente)',
              border: '0.5px solid var(--text-tertiary)',
            }}
          />
          <span style={{ fontFamily: fInterCarte, fontSize: 9, color: 'var(--text-tertiary)' }}>
            aucune exposition
          </span>
        </div>
      </div>
    </div>
  );
}
