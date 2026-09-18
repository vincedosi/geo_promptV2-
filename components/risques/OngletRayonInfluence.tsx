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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { adminFetch } from '@/lib/admin-fetch';
import { formaterNombre, formaterNombreAbrege } from '@/lib/format/nombre';

const fInter = 'Inter, system-ui, sans-serif';
const fMono = "'JetBrains Mono', monospace";

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
 */
const TEINTES = [
  '#e07a3f', '#3d8bb5', '#4aa06b', '#c2554e',
  '#6d8fa8', '#b58b34', '#4f7d7a', '#a06c8c',
];

/** La courbe totale porte l'accent de marque, et elle seule. */
const TEINTE_TOTALE = 'var(--brand-teal)';

interface Point { r: number; p: number; i: number }
interface Courbe { cle: string; total: number; carreaux: number; points: Point[] }
interface Reponse {
  cible: string;
  gravite: string;
  rayon_max_m: number;
  total_est_global: boolean;
  n_departements: number;
  n_sites: number;
  courbes: Courbe[];
  calcule_le: string;
}

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
}

export function OngletRayonInfluence({
  cible, libelleCible, niveaux, natures, perim, nomPerim,
}: Props) {
  const [data, setData] = useState<Reponse | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [aConstruire, setAConstruire] = useState(false);
  /** Rayon retenu par le curseur. Purement local — aucun appel réseau. */
  const [rayon, setRayon] = useState(1000);
  /** Courbes masquées par clic sur la légende. */
  const [masquees, setMasquees] = useState<Set<string>>(new Set());

  const dernier = useRef(0);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    setAConstruire(false);
    const jeton = ++dernier.current;
    try {
      const p = new URLSearchParams({ cible });
      if (niveaux.length > 0) p.set('gravites', niveaux.join(','));
      if (natures.length > 0) p.set('natures', natures.join(','));
      if (perim) {
        p.set('perim_niveau', perim.niveau);
        p.set('perim_codes', perim.code);
      }
      const r = await adminFetch(`/api/risques/exposition/rayon?${p}`);
      const j = await r.json();
      // Une réponse arrivée après une autre plus récente est ignorée : sans ce
      // jeton, un filtre changé deux fois de suite pouvait afficher le
      // résultat du PREMIER, arrivé en dernier.
      if (jeton !== dernier.current) return;
      if (!r.ok) {
        setErreur(j?.error ?? 'Courbe indisponible.');
        setAConstruire(Boolean(j?.a_construire));
        setData(null);
        return;
      }
      setData(j as Reponse);
    } catch {
      if (jeton === dernier.current) { setErreur('Courbe indisponible.'); setData(null); }
    } finally {
      if (jeton === dernier.current) setChargement(false);
    }
  }, [cible, niveaux, natures, perim]);

  useEffect(() => { void charger(); }, [charger]);

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
      {/* ── KPI ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 34,
        padding: '16px 20px 12px',
      }}>
        <Kpi
          valeur={formaterNombre(popAuRayon)}
          libelle={`à moins de ${(rayon / 1000).toFixed(1).replace('.', ',')} km`}
          note={`${libelleCible.toLowerCase()} · ${nomPerim}`}
          accent
        />
        <Kpi
          valeur={`${part.toFixed(1).replace('.', ',')} %`}
          libelle="du total à 10 km"
          note={`${formaterNombre(totalToutes)} au maximum`}
        />
        <Kpi
          valeur={formaterNombre(data.n_sites)}
          libelle="sites concernés"
          note={`${data.n_departements} département${data.n_departements > 1 ? 's' : ''}`}
        />
        {auRayon && (
          <Kpi
            valeur={formaterNombre(auRayon.i ?? 0)}
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
          {(rayon / 1000).toFixed(1).replace('.', ',')} km
        </span>
        {/* Le déplacement ne déclenche AUCUN appel : la série entière est déjà
            en mémoire. C'est la promesse de cet onglet, autant la tenir visible. */}
        <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>
          lecture immédiate, sans recalcul
        </span>
      </div>

      {/* ── LA COURBE ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 240, padding: '0 8px 0 0' }}>
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
              labelFormatter={(v) => `à moins de ${(Number(v) / 1000).toFixed(1).replace('.', ',')} km`}
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

function Kpi({ valeur, libelle, note, accent }: {
  valeur: string; libelle: string; note: string; accent?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{
        fontFamily: fMono, fontSize: 22, lineHeight: 1.1,
        color: accent ? 'var(--brand-teal)' : 'var(--text-primary)',
      }}>
        {valeur}
      </span>
      <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)' }}>{libelle}</span>
      <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>{note}</span>
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
