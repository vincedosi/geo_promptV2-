'use client';

/**
 * Onglet « Rayon d'influence » de l'overlay population à risque.
 *
 * Répond à une question que l'autre onglet ne pose pas : **quel rayon
 * retenir ?** Plutôt qu'un chiffre pour un rayon choisi d'avance, il montre la
 * courbe entière — population couverte de 100 m à 10 km — et laisse lire où
 * elle décroche.
 *
 * ── AUCUN APPEL RÉSEAU AU DÉPLACEMENT DU CURSEUR ──────────────────────────
 *
 * La série complète (100 points par courbe) arrive en une fois et vit en
 * mémoire. Bouger le curseur relit un tableau, rien de plus. C'est la
 * différence avec le contrôle de rayon de l'autre onglet, où chaque pas
 * relançait un calcul de plusieurs secondes — le défaut signalé qui a conduit
 * à tout ce travail.
 *
 * ── LA COURBE TOTALE N'EST PAS LA SOMME DES AUTRES ───────────────────────
 *
 * Un carreau proche de sites de deux natures compte dans les DEUX courbes par
 * nature. Chacune est donc exacte pour sa propre question, mais leur somme ne
 * veut rien dire. La courbe « toutes natures » vient d'un calcul séparé, au
 * minimum par carreau. L'écran le dit plutôt que de laisser le lecteur faire
 * l'addition de tête.
 */
import React, { useMemo, useState } from 'react';
import type { ResultatCourbe } from '@/components/risques/use-courbe-rayon';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { formaterNombre, formaterNombreAbrege, formaterDecimal } from '@/lib/format/nombre';
import { fInter, fMono } from '@/lib/design/polices';
import { Kpi } from '@/components/risques/Kpi';


/** La courbe « toutes natures confondues », distinguée par cette clé côté base. */
const TOUTES = '*';

/**
 * Palette QUALITATIVE des courbes par nature.
 *
 * Elle ne peut pas être une rampe séquentielle : les natures ne s'ordonnent
 * pas, il n'y a pas de « plus » ni de « moins » entre « Explosibles » et
 * « Déchets ». Il faut donc des teintes distinctes, pas des paliers d'une même.
 *
 * Aucun violet, règle du DESIGN_SYSTEM. Les teintes sont choisies pour rester
 * distinguables en niveaux de gris ET pour un daltonisme deutan — d'où
 * l'alternance chaud/froid plutôt qu'un dégradé rouge-vert.
 *
 * ⚠ Elles étaient écrites EN DUR ici, sans variante de thème clair et hors de
 * tout verrou (constat R-05 de `docs/AUDIT_ZONE_RISQUE.md`) — une violation
 * directe de la règle « jamais de hex en dur » alors que ce fichier prouvait
 * trois lignes plus bas que `var()` fonctionne dans Recharts.
 *
 * Pas de duplication en TypeScript ici, contrairement à `palette-risques.ts` :
 * MapLibre ne résout pas `var()` dans `paint`, Recharts si. Une seule
 * définition suffit donc, dans `app/globals.css`.
 */
const TEINTES = [
  'var(--nature-1)', 'var(--nature-2)', 'var(--nature-3)', 'var(--nature-4)',
  'var(--nature-5)', 'var(--nature-6)', 'var(--nature-7)', 'var(--nature-8)',
];

/** La courbe totale porte l'accent de marque, et elle seule. */
const TEINTE_TOTALE = 'var(--brand-teal)';

/*
 * ⚠ Les types du payload vivent dans `use-courbe-rayon.ts`, avec l'appel qui
 * les produit. Les redéclarer ici en donnerait deux versions, et l'écran
 * finirait par lire un champ que le serveur n'envoie plus.
 */

interface Props {
  cible: string;
  libelleCible: string;
  /** Gravités retenues — mêmes valeurs que l'onglet population. */
  niveaux: string[];
  /** Natures retenues ; vide = toutes. */
  natures: string[];
  /** Territoire courant, dérivé du fil d'Ariane. */
  perim: { niveau: 'region' | 'departement'; code: string } | null;
  nomPerim: string;
  /**
   * La courbe, CHARGÉE PAR L'OVERLAY.
   *
   * ⚠ Elle l'était ici, et repartait donc à chaque retour sur l'onglet —
   * mesuré : quatre appels pour cinq bascules, sans qu'un seul réglage ait
   * bougé. La courbe disparaissait puis revenait, identique.
   */
  courbe: ResultatCourbe;
}

export function OngletRayonInfluence({
  cible, libelleCible, niveaux, natures, perim, nomPerim, courbe,
}: Props) {
  const { data, chargement, erreur, aConstruire } = courbe;
  /** Rayon retenu par le curseur. Purement local — aucun appel réseau. */
  const [rayon, setRayon] = useState(1000);
  /** Courbes masquées par clic sur la légende. */
  const [masquees, setMasquees] = useState<Set<string>>(new Set());


  /**
   * Les points au format attendu par Recharts : une ligne par rayon, une
   * colonne par courbe. La base rend l'inverse (une série par courbe), parce
   * que c'est la forme naturelle d'un `group by`.
   */
  const points = useMemo(() => {
    if (!data) return [];
    const parRayon = new Map<number, Record<string, number>>();
    for (const c of data.courbes) {
      for (const pt of c.points) {
        const ligne = parRayon.get(pt.r) ?? { r: pt.r };
        ligne[c.cle] = pt.p;
        // L'INCRÉMENT de la courbe totale, transporté à part.
        //
        // Il était perdu dans le pivot — la ligne ne gardait que le cumul `p`
        // — et le KPI « au palier suivant » affichait donc 0 en permanence,
        // sans que rien ne le signale. Vu à l'écran, pas en relisant le code.
        //
        // C'est celui de la courbe TOTALE : « combien d'habitants de plus si
        // j'élargis de 100 m » n'a de sens que toutes natures confondues.
        if (c.cle === TOUTES) ligne.increment = pt.i;
        parRayon.set(pt.r, ligne);
      }
    }
    return [...parRayon.values()].sort((a, b) => a.r - b.r);
  }, [data]);

  /** Valeurs au rayon retenu — lues en mémoire, jamais redemandées. */
  const auRayon = useMemo(() => {
    if (points.length === 0) return null;
    // Le point le plus proche SANS dépasser : la courbe est cumulée, prendre
    // le point supérieur annoncerait une population qu'on n'a pas atteinte.
    let choisi = points[0];
    for (const pt of points) if (pt.r <= rayon) choisi = pt;
    return choisi;
  }, [points, rayon]);

  const couleurs = useMemo(() => {
    const m = new Map<string, string>();
    let i = 0;
    for (const c of data?.courbes ?? []) {
      m.set(c.cle, c.cle === TOUTES ? TEINTE_TOTALE : TEINTES[i++ % TEINTES.length]);
    }
    return m;
  }, [data]);

  const totalToutes = data?.courbes.find((c) => c.cle === TOUTES)?.total ?? 0;
  const popAuRayon = auRayon ? (auRayon[TOUTES] ?? 0) : 0;
  const part = totalToutes > 0 ? (popAuRayon / totalToutes) * 100 : 0;

  if (chargement && !data) return <Squelette />;

  if (erreur) {
    return (
      <div style={{ padding: 28, fontFamily: fInter, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        <p style={{ color: aConstruire ? 'var(--warning)' : 'var(--danger)', margin: 0 }}>{erreur}</p>
        {aConstruire && (
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10 }}>
            Construction : <code style={{ fontFamily: fMono }}>node scripts/construire_couverture_rayon.mjs</code>
          </p>
        )}
      </div>
    );
  }

  if (!data || data.courbes.length === 0) {
    return (
      <p style={{ padding: 28, fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)' }}>
        Aucun site à risque pour ces filtres.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ⚠ LE PRÉ-CALCUL PEUT ÊTRE PARTIEL, et il faut le dire AVANT les
          chiffres. Une courbe bâtie sur une France incomplète sous-estime
          sans rien changer à sa forme : elle se lit exactement comme une
          courbe juste. La construction est un traitement lourd qui peut être
          interrompu — elle l'a été le 2026-09-18 sur alerte de budget d'I/O. */}
      {data.couverture_pct < 99 && (
        <p style={{
          margin: 0, padding: '10px 20px',
          background: 'var(--bg-level-2)',
          borderBottom: '0.5px solid var(--warning)',
          fontFamily: fInter, fontSize: 11, color: 'var(--warning)', lineHeight: 1.5,
        }}>
          <strong style={{ fontWeight: 500 }}>Pré-calcul partiel : {data.couverture_pct} % de la
          métropole</strong> ({data.n_bandes_construites} bandes construites
          {data.n_zones_lointaines > 0 && `, plus ${data.n_zones_lointaines} zone${data.n_zones_lointaines > 1 ? 's' : ''} d’outre-mer`}).
          Les chiffres ci-dessous SOUS-ESTIMENT la population couverte — ils ne portent que sur
          la part déjà traitée. Terminer avec{' '}
          <code style={{ fontFamily: fMono }}>node scripts/construire_couverture_rayon.mjs</code>.
        </p>
      )}

      {/* ── KPI ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 34,
        padding: '16px 20px 12px',
      }}>
        <Kpi taille={22}
          valeur={formaterNombre(popAuRayon)}
          libelle={`à moins de ${formaterDecimal(rayon / 1000)} km`}
          note={`${libelleCible.toLowerCase()} · ${nomPerim}`}
          accent
        />
        <Kpi taille={22}
          valeur={`${formaterDecimal(part)} %`}
          libelle="du total à 10 km"
          note={`${formaterNombre(totalToutes)} au maximum`}
        />
        <Kpi taille={22}
          valeur={formaterNombre(data.n_sites)}
          libelle="sites concernés"
          note={`${data.n_departements} département${data.n_departements > 1 ? 's' : ''}`}
        />
        {auRayon && (
          <Kpi taille={22}
            valeur={formaterNombre(auRayon.increment ?? 0)}
            libelle="au palier suivant"
            note="habitants gagnés par 100 m de plus"
          />
        )}
      </div>

      {/* ── LE CURSEUR ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px 14px' }}>
        <input
          type="range"
          min={100}
          max={data.rayon_max_m}
          step={100}
          value={rayon}
          onChange={(e) => setRayon(Number(e.target.value))}
          aria-label="Rayon retenu, en mètres"
          style={{ flex: 1, accentColor: 'var(--brand-teal)' }}
        />
        <span style={{ fontFamily: fMono, fontSize: 12, color: 'var(--text-primary)', minWidth: 66 }}>
          {formaterDecimal(rayon / 1000)} km
        </span>
        {/* Le déplacement ne déclenche AUCUN appel : la série entière est déjà
            en mémoire. C'est la promesse de cet onglet, autant la tenir visible. */}
        <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>
          lecture immédiate, sans recalcul
        </span>
      </div>

      {/* ── LA COURBE ────────────────────────────────────────────────────── */}
      {/*
        ⚠ Hauteur EXPLICITE, et non `flex: 1` + `minHeight`.

        `ResponsiveContainer height="100%"` resout son pourcentage contre la
        hauteur SPECIFIEE du parent. Avec `flex: 1` et `min-height: 240px`, le
        parent mesurait bien 240 px a l'ecran — mais sa hauteur specifiee reste
        `auto`, donc le pourcentage retombe sur `auto`, donc sur zero.

        Mesure du 2026-09-20 : conteneur large de 1 546 px et **haut de 0**,
        aucun `<svg>` emis. La courbe ne s'affichait pas, et rien ne le
        signalait — ni erreur, ni cadre vide : Recharts ne rend simplement rien
        sous une hauteur nulle, et les KPI au-dessus restaient justes.

        C'est le patron de `GraphiqueEcart` (Suivi V2), qui fonctionne : une
        hauteur en pixels sur le conteneur, `100%` sur le ResponsiveContainer.
      */}
      <div style={{ height: 280, padding: '0 8px 0 0' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 20, bottom: 24, left: 8 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="r"
              type="number"
              domain={[100, data.rayon_max_m]}
              ticks={[1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]}
              tickFormatter={(v: number) => `${v / 1000} km`}
              tick={{ fontFamily: fMono, fontSize: 10, fill: 'var(--text-tertiary)' }}
              stroke="var(--border-default)"
            />
            <YAxis
              tickFormatter={(v: number) => formaterNombreAbrege(v)}
              tick={{ fontFamily: fMono, fontSize: 10, fill: 'var(--text-tertiary)' }}
              stroke="var(--border-default)"
              width={54}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--card-overlay)',
                border: '0.5px solid var(--border-default)',
                borderRadius: 6, fontFamily: fInter, fontSize: 11,
              }}
              /* Types laissés à l'inférence de Recharts : ses signatures de
                 formateurs sont des unions larges que l'annotation manuelle
                 n'assigne pas. Même choix que `GraphiqueEcart` du Suivi V2. */
              labelFormatter={(v) => `à moins de ${formaterDecimal(Number(v) / 1000)} km`}
              formatter={(v, nom) => [
                formaterNombre(Number(v)),
                nom === TOUTES ? 'Toutes natures' : String(nom),
              ]}
            />
            {/* Le rayon retenu, matérialisé sur la courbe : sans ce repère, le
                curseur et le graphique se lisent comme deux objets séparés. */}
            <ReferenceLine x={rayon} stroke="var(--brand-teal)" strokeDasharray="3 3" strokeWidth={1} />
            {data.courbes.filter((c) => !masquees.has(c.cle)).map((c) => (
              <Line
                key={c.cle}
                type="monotone"
                dataKey={c.cle}
                stroke={couleurs.get(c.cle)}
                strokeWidth={c.cle === TOUTES ? 2.2 : 1.3}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── LÉGENDE, CLIQUABLE ───────────────────────────────────────────── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '6px 14px',
        padding: '10px 20px 6px', borderTop: '0.5px solid var(--border-subtle)',
      }}>
        {data.courbes.map((c) => {
          const off = masquees.has(c.cle);
          const v = auRayon?.[c.cle];
          return (
            <button
              key={c.cle}
              type="button"
              onClick={() => setMasquees((s) => {
                const n = new Set(s);
                if (n.has(c.cle)) n.delete(c.cle); else n.add(c.cle);
                return n;
              })}
              title={off ? 'Afficher cette courbe' : 'Masquer cette courbe'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                border: 0, background: 'none', padding: 0, cursor: 'pointer',
                fontFamily: fInter, fontSize: 11,
                color: off ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                opacity: off ? 0.5 : 1,
              }}
            >
              <span style={{
                width: 14, height: 2.5, borderRadius: 2,
                background: couleurs.get(c.cle), display: 'inline-block',
              }} />
              {c.cle === TOUTES ? 'Toutes natures' : c.cle}
              <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
                {v !== undefined ? formaterNombre(v) : '—'}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── CE QUE LA COURBE NE DIT PAS ──────────────────────────────────── */}
      <p style={{
        fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)',
        lineHeight: 1.5, padding: '0 20px 14px', margin: 0,
      }}>
        Distance au <strong style={{ fontWeight: 500 }}>site</strong> le plus proche, jamais au
        périmètre PPRT : un rayon d’influence se mesure autour de l’installation.{' '}
        <strong style={{ fontWeight: 500 }}>« Toutes natures » n’est pas la somme des autres
        courbes</strong> — un habitant proche de deux natures compte dans les deux, ce qui est juste
        pour chacune et faux pour leur addition.
        {data.total_est_global && (
          <> Vous avez filtré les natures : la courbe totale, elle, porte toujours sur
          l’ensemble.</>
        )}
      </p>
    </div>
  );
}


/** Squelette de chargement — la forme de l'écran, pas un tourniquet. */
function Squelette() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 34 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ width: 90, height: 22, background: 'var(--bg-level-2)', borderRadius: 4 }} />
            <div style={{ width: 120, height: 10, background: 'var(--bg-level-2)', borderRadius: 3 }} />
          </div>
        ))}
      </div>
      <div style={{ height: 8, background: 'var(--bg-level-2)', borderRadius: 4 }} />
      <div style={{ height: 240, background: 'var(--bg-level-2)', borderRadius: 6 }} />
    </div>
  );
}
