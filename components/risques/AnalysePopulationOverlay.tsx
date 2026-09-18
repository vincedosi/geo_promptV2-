'use client';

/**
 * Overlay « Analyser la population à risque ».
 *
 * Un tableau croisé à trois axes, dans la grammaire de MAGELIAN :
 *
 *     CIBLE (qui je compte) × DIMENSION (où je regarde) × FILTRES (quel risque)
 *
 * La question qu'il permet de poser : « combien de 18-24 ans vivent en zone à
 * risque toxique dans le Rhône ? »
 *
 * ── TROIS NOMBRES QUI NE SE COMPORTENT PAS PAREIL ─────────────────────────
 *
 * L'écran les affiche côte à côte, et il doit dire lequel s'additionne :
 *
 *   population exposée  la somme des lignes ÉGALE le total. Un carreau de
 *                       200 m appartient à une seule unité.
 *   nombre de sites     NE s'additionne PAS. Un site dont la zone déborde sur
 *                       deux départements compte dans les deux.
 *   dont indicatifs     combien reposent sur un rayon CHOISI plutôt que sur
 *                       une servitude publiée par l'État.
 *
 * ── POURQUOI LE RAYON EST AFFICHÉ EN PERMANENCE ──────────────────────────
 *
 * Parce que tous les chiffres des sites sans PPRT en dépendent. Il est déduit
 * des 664 périmètres réels (moyenne de leurs rayons équivalents, 532 m), et
 * reste ajustable. Un rayon changé sans que l'écran le montre rendrait deux
 * lectures incomparables sans qu'on sache pourquoi.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { formaterNombre } from '@/lib/format/nombre';
import { empiler, depiler } from '@/lib/carte/pile-echap';
import { librellesDuType } from '@/lib/carte/palette-risques';
import type { TypeRisque } from '@/lib/carte/palette-risques';
import { FAMILLES_ICPE_SEED, NATURE_NON_PRECISEE } from '@/lib/import/georisques/familles';
import { CarteMiniFrance, type ZoneGeo } from './CarteMiniFrance';

type Dimension = 'region' | 'departement' | 'code_postal';
type Encodage = 'part' | 'densite' | 'exposee';

const DIMENSIONS: Array<{ id: Dimension; label: string; zones: 'region' | 'departement' | 'cp' }> = [
  { id: 'region', label: 'Région', zones: 'region' },
  { id: 'departement', label: 'Département', zones: 'departement' },
  { id: 'code_postal', label: 'Code postal', zones: 'cp' },
];

/**
 * Les trois encodages de la carte. Ils ne disent PAS la même chose, et chacun
 * porte son propre libellé : basculer sans changer la légende ferait lire des
 * pourcentages comme des habitants.
 */
const ENCODAGES: Array<{ id: Encodage; label: string; aide: string }> = [
  { id: 'part', label: 'Part %', aide: "Part des habitants de l'unité qui vivent en zone à risque" },
  { id: 'densite', label: 'Densité', aide: "Habitants exposés par km² d'unité" },
  { id: 'exposee', label: 'Effectif', aide: "Nombre d'habitants exposés — un grand territoire paraît plus intense" },
];

/**
 * Les deux natures de zone. C'est le filtre le plus important de l'écran :
 * `pprt` ne retient que les sites dont la zone est une servitude PUBLIÉE par
 * l'État, `buffer` ceux dont la zone est un rayon que nous avons choisi.
 * Les décocher séparément permet de répondre à « et si je ne garde que ce qui
 * est opposable ? », qui est la question d'une recommandation client.
 */
const MODES_ZONE: Array<{ id: string; label: string; aide: string }> = [
  { id: 'pprt', label: 'Périmètre PPRT', aide: "Servitude publiée par l'État, opposable" },
  { id: 'buffer', label: 'Rayon calculé', aide: 'Rayon choisi ci-dessus — aucune valeur réglementaire' },
];

/** Niveaux réglementaires, du plus grave au moins. Miroir du panneau Calques. */
const NIVEAUX: Array<{ id: string; label: string }> = [
  { id: 'seveso_haut', label: 'Seveso haut' },
  { id: 'seveso_bas', label: 'Seveso bas' },
  { id: 'ied', label: 'IED' },
  { id: 'autorisation', label: 'Autorisation' },
  { id: 'enregistrement', label: 'Enregistrement' },
  { id: 'autre', label: 'Autre' },
];

interface UniteRef { code: string; nom: string }

interface Ligne {
  cle: string;
  nom: string;
  exposee: number;
  n_sites: number;
  n_indicatifs: number;
  carreaux: number;
  pop_totale: number | null;
  surface_km2: number | null;
  part_pct: number | null;
  densite: number | null;
}

interface Agregat {
  dimension: Dimension;
  cible: string;
  rayon_m: number;
  rayon_deduit: boolean;
  n_unites: number;
  total_exposee: number;
  total_sites: number;
  total_indicatifs: number;
  tronquee: boolean;
  lignes: Ligne[];
  calcule_le: string;
}

interface Cible {
  code: string;
  libelle: string;
  famille: string;
}

interface Props {
  /**
   * Le parent MONTE ce composant quand il veut l'ouvrir et le DÉMONTE pour le
   * fermer — il n'y a pas de prop `ouvert`.
   *
   * Ce n'est pas un détail de style. `empiler()` doit vivre dans un `useEffect`
   * à dépendances VIDES (règle verrouillée par
   * `tests/unit/carte/pile-echap-usage.test.ts`) : un effet qui se ré-exécute
   * repousse son entrée au sommet de la pile Échap, et Échap ferme alors la
   * mauvaise chose. Garder le composant monté avec un booléen imposait
   * `[ouvert]` en dépendances. Le démontage règle le problème à la racine, et
   * libère au passage l'état et les requêtes en cours.
   */
  onFermer: () => void;
  /** Filtres hérités du panneau : on ne redemande pas ce qui vient d'être répondu. */
  gravites: string[];
  /**
   * TYPES de risque (toxique, inflammable…), tels que le panneau les coche.
   *
   * La RPC attend des LIBELLÉS DE NATURE, pas des types. La conversion se fait
   * ici par `librellesDuType`, la MÊME fonction que la couche carte : c'est ce
   * qui garantit qu'un site compté « toxique » dans ce tableau est bien celui
   * que la carte peint en toxique. Passer les types tels quels ne filtrerait
   * RIEN, silencieusement.
   */
  typesRisque: string[];
}

const fInter = 'Inter, system-ui, sans-serif';
const fMono = "'JetBrains Mono', monospace";

export function AnalysePopulationOverlay({ onFermer, gravites, typesRisque }: Props) {
  const [dimension, setDimension] = useState<Dimension>('departement');
  const [cible, setCible] = useState('ind');
  const [encodage, setEncodage] = useState<Encodage>('part');
  const [rayon, setRayon] = useState<number | null>(null);   // null = rayon déduit
  const [cibles, setCibles] = useState<Cible[]>([]);
  const [agregat, setAgregat] = useState<Agregat | null>(null);
  const [zones, setZones] = useState<ZoneGeo[]>([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [actif, setActif] = useState<string | null>(null);
  const [modes, setModes] = useState<string[]>(['pprt', 'buffer']);
  const [niveaux, setNiveaux] = useState<string[]>(gravites.length > 0 ? gravites : ['seveso_haut', 'seveso_bas']);
  const [perimNiveau, setPerimNiveau] = useState<'region' | 'departement'>('region');
  const [perimCodes, setPerimCodes] = useState<string[]>([]);
  const [refGeo, setRefGeo] = useState<{ regions: UniteRef[]; departements: UniteRef[] }>({ regions: [], departements: [] });

  // Cache des géométries par dimension : elles ne changent jamais, et les
  // recharger à chaque bascule de dimension paierait un aller-retour pour rien.
  const cacheZones = useRef<Map<string, ZoneGeo[]>>(new Map());

  // Échap ferme l'overlay, par la pile partagée — quatre écouteurs concurrents
  // sur `keydown` ne garantiraient pas l'ordre (lib/carte/pile-echap.ts).
  const fermerRef = useRef(onFermer);
  fermerRef.current = onFermer;
  useEffect(() => {
    const id = 'analyse-population-risque';
    empiler(id, () => fermerRef.current());
    return () => depiler(id);
  }, []);

  // Le catalogue des cibles vient de la BASE, jamais d'une liste écrite en dur.
  useEffect(() => {
    if (cibles.length > 0) return;
    void (async () => {
      try {
        const r = await adminFetch('/api/risques/exposition/cibles');
        if (r.ok) setCibles(((await r.json()) as { cibles?: Cible[] }).cibles ?? []);
      } catch { /* le menu reste sur la cible par défaut */ }
    })();
  }, [cibles.length]);

  // Le referentiel geographique vient de la BASE (`/api/ref/geo`), jamais d'une
  // liste ecrite en dur : c'est la regle du projet, et une liste figee
  // divergerait au premier redecoupage administratif.
  useEffect(() => {
    void (async () => {
      try {
        const r = await adminFetch('/api/ref/geo');
        if (!r.ok) return;
        // La route rend les départements IMBRIQUÉS dans leur région : on les
        // aplatit ici plutôt que d'ajouter une seconde route pour la même
        // donnée, déjà en cache CDN une heure.
        const j = (await r.json()) as {
          regions?: Array<{
            code_region: string;
            nom_region: string;
            depts?: Array<{ code_dept: string; nom_dept: string }>;
          }>;
        };
        const regions = (j.regions ?? []).map((x) => ({ code: x.code_region, nom: x.nom_region }));
        const departements = (j.regions ?? []).flatMap((x) =>
          (x.depts ?? []).map((d) => ({ code: d.code_dept, nom: d.nom_dept })),
        );
        setRefGeo({ regions, departements });
      } catch { /* le sélecteur reste sur France entière */ }
    })();
  }, []);

  const dimCourante = DIMENSIONS.find((d) => d.id === dimension) ?? DIMENSIONS[1];

  // Les géométries de la dimension courante.
  useEffect(() => {
    const cle = dimCourante.zones;
    const enCache = cacheZones.current.get(cle);
    if (enCache) { setZones(enCache); return; }
    void (async () => {
      try {
        const r = await adminFetch(`/api/meteo-geo/zones?scale=${cle}`);
        if (!r.ok) return;
        const fc = (await r.json()) as { features?: ZoneGeo[] };
        const f = fc.features ?? [];
        cacheZones.current.set(cle, f);
        setZones(f);
      } catch { /* la carte reste vide, le tableau fonctionne */ }
    })();
  }, [dimCourante.zones]);

  // Le calcul.
  // Types → libellés de nature. Mémoïsé : sans ça, le tableau se recalculerait
  // à chaque rendu, ce tableau étant une nouvelle référence à chaque fois.
  const natures = useMemo(() => {
    const n = typesRisque.flatMap((t) => librellesDuType(t as TypeRisque, FAMILLES_ICPE_SEED));
    // « Risque non précisé » n'a pas de libellé de famille : c'est l'absence de
    // rubrique exploitable, et il se demande par son propre libellé.
    if (typesRisque.includes('non_precise')) n.push(NATURE_NON_PRECISEE);
    return n;
  }, [typesRisque]);

  const calculer = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const p = new URLSearchParams({ dimension, cible });
      if (niveaux.length > 0) p.set('gravites', niveaux.join(','));
      if (natures.length > 0) p.set('natures', natures.join(','));
      if (modes.length > 0 && modes.length < MODES_ZONE.length) p.set('modes', modes.join(','));
      if (perimCodes.length > 0) {
        p.set('perim_niveau', perimNiveau);
        p.set('perim_codes', perimCodes.join(','));
      }
      if (rayon !== null) p.set('rayon_m', String(rayon));
      if (dimension === 'code_postal') p.set('limite', '500');
      const r = await adminFetch(`/api/risques/exposition/agregats?${p}`);
      const j = await r.json();
      if (!r.ok) { setErreur(j?.error ?? 'Calcul indisponible.'); setAgregat(null); return; }
      setAgregat(j as Agregat);
    } catch {
      setErreur('Calcul indisponible.');
      setAgregat(null);
    } finally {
      setChargement(false);
    }
  }, [dimension, cible, niveaux, natures, modes, perimNiveau, perimCodes, rayon]);

  useEffect(() => {
    void calculer();
  }, [calculer]);

  const valeurs = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of agregat?.lignes ?? []) {
      const v = encodage === 'part' ? l.part_pct : encodage === 'densite' ? l.densite : l.exposee;
      if (v !== null && Number.isFinite(v)) m.set(l.cle, v);
    }
    return m;
  }, [agregat, encodage]);

  const encCourant = ENCODAGES.find((e) => e.id === encodage) ?? ENCODAGES[0];
  const formaterValeur = useCallback(
    (v: number) =>
      encodage === 'part' ? `${formaterNombre(v)} %`
      : encodage === 'densite' ? `${formaterNombre(v)} hab/km²`
      : formaterNombre(v),
    [encodage],
  );

  const libelleCible = cibles.find((c) => c.code === cible)?.libelle ?? 'Population totale';

  // Les cibles groupées par famille, pour un menu lisible.
  const familles = [...new Set(cibles.map((c) => c.famille))];

  return (
    <div
      role="dialog"
      aria-label="Analyser la population à risque"
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'var(--bg-primary)',
        display: 'flex', flexDirection: 'column',
        animation: 'fadeIn 200ms var(--ease-out) both',
      }}
    >
      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 20px',
          borderBottom: '0.5px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
        }}
      >
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <h2 style={{ margin: 0, fontFamily: fInter, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>
          Population à risque industriel
        </h2>
        <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}>
          {libelleCible} · {dimCourante.label.toLowerCase()}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          disabled
          title="Export Excel — prochaine étape"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: '0.5px solid var(--border-default)',
            borderRadius: 6, padding: '6px 12px', cursor: 'not-allowed',
            fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)',
          }}
        >
          <Download size={13} /> Export Excel
        </button>
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer"
          style={{
            display: 'flex', background: 'transparent', border: 'none',
            padding: 6, cursor: 'pointer', color: 'var(--text-secondary)',
          }}
        >
          <X size={18} />
        </button>
      </header>

      {/* ── Barre de contrôles ──────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap',
          padding: '12px 20px',
          borderBottom: '0.5px solid var(--border-subtle)',
        }}
      >
        <Champ label="Cible">
          <select
            value={cible}
            onChange={(e) => setCible(e.target.value)}
            style={styleSelect}
          >
            {familles.length === 0 && <option value="ind">Population totale</option>}
            {familles.map((f) => (
              <optgroup key={f} label={f}>
                {cibles.filter((c) => c.famille === f).map((c) => (
                  <option key={c.code} value={c.code}>{c.libelle}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </Champ>

        <Champ label="Dimension">
          <div style={{ display: 'flex', gap: 4 }}>
            {DIMENSIONS.map((d) => (
              <Pastille key={d.id} actif={dimension === d.id} onClick={() => setDimension(d.id)}>
                {d.label}
              </Pastille>
            ))}
          </div>
        </Champ>

        <Champ label="Rayon des sites sans PPRT">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min={50}
              max={20000}
              step={50}
              value={rayon ?? agregat?.rayon_m ?? 532}
              onChange={(e) => setRayon(Number(e.target.value) || null)}
              style={{ ...styleSelect, width: 92, fontFamily: fMono }}
            />
            <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>m</span>
            {agregat?.rayon_deduit && (
              <span
                title="Moyenne des rayons équivalents des 664 périmètres PPRT publiés"
                style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}
              >
                déduit des périmètres réels
              </span>
            )}
            {rayon !== null && (
              <button type="button" onClick={() => setRayon(null)} style={styleLien}>
                rétablir
              </button>
            )}
          </div>
        </Champ>
      </div>

      {/* ── Filtres ─────────────────────────────────────────────────────
          Séparés des contrôles du haut à dessein : au-dessus on choisit CE
          QU'ON REGARDE (cible, dimension, rayon), ici on choisit CE QU'ON
          RETIENT. Mélanger les deux oblige à relire toute la barre pour
          savoir d'où vient un chiffre. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
          padding: '10px 20px',
          borderBottom: '0.5px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
        }}
      >
        <Champ label="Nature de la zone">
          <div style={{ display: 'flex', gap: 4 }}>
            {MODES_ZONE.map((m) => (
              <Pastille
                key={m.id}
                actif={modes.includes(m.id)}
                titre={m.aide}
                onClick={() =>
                  setModes((v) => {
                    const suivant = v.includes(m.id) ? v.filter((x) => x !== m.id) : [...v, m.id];
                    // Tout décocher ne rendrait rien : on garde au moins une
                    // nature, plutôt qu'un écran vide sans explication.
                    return suivant.length === 0 ? v : suivant;
                  })
                }
              >
                {m.label}
              </Pastille>
            ))}
          </div>
        </Champ>

        <Champ label="Niveau réglementaire">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {NIVEAUX.map((n) => (
              <Pastille
                key={n.id}
                actif={niveaux.includes(n.id)}
                onClick={() =>
                  setNiveaux((v) => {
                    const suivant = v.includes(n.id) ? v.filter((x) => x !== n.id) : [...v, n.id];
                    return suivant.length === 0 ? v : suivant;
                  })
                }
              >
                {n.label}
              </Pastille>
            ))}
          </div>
        </Champ>

        <Champ label="Périmètre d’étude">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              value={perimNiveau}
              onChange={(e) => { setPerimNiveau(e.target.value as 'region' | 'departement'); setPerimCodes([]); }}
              style={{ ...styleSelect, padding: '6px 8px' }}
            >
              <option value="region">Région</option>
              <option value="departement">Département</option>
            </select>
            <select
              value={perimCodes[0] ?? ''}
              onChange={(e) => setPerimCodes(e.target.value ? [e.target.value] : [])}
              style={{ ...styleSelect, minWidth: 170 }}
            >
              <option value="">France entière</option>
              {(perimNiveau === 'region' ? refGeo.regions : refGeo.departements).map((u) => (
                <option key={u.code} value={u.code}>{u.code} — {u.nom}</option>
              ))}
            </select>
          </div>
        </Champ>

        {/* Le rappel de ce qui a été hérité du panneau, pour que l'utilisateur
            sache d'où vient un filtre qu'il n'a pas posé ici. */}
        {typesRisque.length > 0 && (
          <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', alignSelf: 'flex-end', paddingBottom: 7 }}>
            Types de risque filtrés depuis le panneau Calques ({typesRisque.length})
          </span>
        )}
      </div>

      {/* ── Corps ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Tableau */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', minWidth: 0 }}>
          {erreur && (
            <p style={{ fontFamily: fInter, fontSize: 12, color: 'var(--danger)' }}>{erreur}</p>
          )}

          {agregat && (
            <>
              <div style={{ display: 'flex', gap: 28, marginBottom: 16, flexWrap: 'wrap' }}>
                <Kpi
                  valeur={formaterNombre(agregat.total_exposee)}
                  libelle={libelleCible.toLowerCase()}
                  note="la somme des lignes égale ce total"
                  accent
                />
                <Kpi
                  valeur={formaterNombre(agregat.total_sites)}
                  libelle="sites classés"
                  note="ne s’additionne pas entre lignes"
                />
                <Kpi
                  valeur={formaterNombre(agregat.total_indicatifs)}
                  libelle="sur un rayon choisi"
                  note={`soit ${Math.round((agregat.total_indicatifs / Math.max(1, agregat.total_sites)) * 100)} % des sites`}
                />
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fInter, fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                    <Th align="left">{dimCourante.label}</Th>
                    <Th>{libelleCible}</Th>
                    <Th>Part</Th>
                    <Th>Densité</Th>
                    <Th>Sites</Th>
                    <Th>dont indicatifs</Th>
                  </tr>
                </thead>
                <tbody>
                  {agregat.lignes.map((l) => (
                    <tr
                      key={l.cle}
                      onMouseEnter={() => setActif(l.cle)}
                      onMouseLeave={() => setActif(null)}
                      style={{
                        borderBottom: '0.5px solid var(--border-subtle)',
                        background: actif === l.cle ? 'var(--brand-teal-10)' : 'transparent',
                        transition: 'background-color 150ms var(--ease-out)',
                      }}
                    >
                      <td style={{ padding: '7px 8px', color: 'var(--text-primary)' }}>
                        <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginRight: 7 }}>
                          {l.cle}
                        </span>
                        {l.nom}
                      </td>
                      <Td fort>{formaterNombre(l.exposee)}</Td>
                      <Td>{l.part_pct !== null ? `${formaterNombre(l.part_pct)} %` : '—'}</Td>
                      <Td>{l.densite !== null ? formaterNombre(l.densite) : '—'}</Td>
                      <Td>{formaterNombre(l.n_sites)}</Td>
                      <Td dim>{l.n_indicatifs > 0 ? formaterNombre(l.n_indicatifs) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {agregat.lignes.length === 0 && !chargement && (
                <p style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)' }}>
                  Aucune population exposée pour ces filtres.
                </p>
              )}

              {agregat.tronquee && (
                <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--warning)', marginTop: 10 }}>
                  Liste tronquée : {formaterNombre(agregat.n_unites)} unités exposées, les plus
                  peuplées seulement sont affichées. Le total ci-dessus les compte toutes.
                </p>
              )}

              {/* L'avertissement qui empêche la mauvaise lecture la plus probable. */}
              <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', marginTop: 14, lineHeight: 1.5 }}>
                Un carreau INSEE de 200 m appartient à une seule unité : la somme de la colonne
                population <strong style={{ fontWeight: 500 }}>égale</strong> le total. La colonne
                « sites », elle, ne s’additionne pas — un site dont la zone déborde sur deux unités
                compte dans les deux. Les sites sans périmètre PPRT reposent sur un rayon de{' '}
                {formaterNombre(agregat.rayon_m)} m que vous choisissez, et non sur une servitude
                publiée par l’État.
              </p>
            </>
          )}

          {chargement && !agregat && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontFamily: fInter, fontSize: 12 }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Calcul en cours…
            </div>
          )}
        </div>

        {/* Mini-carte */}
        <aside
          style={{
            width: 340, flexShrink: 0,
            borderLeft: '0.5px solid var(--border-subtle)',
            padding: '16px 18px',
            display: 'flex', flexDirection: 'column', gap: 12,
            overflow: 'auto',
          }}
        >
          <div style={{ display: 'flex', gap: 4 }}>
            {ENCODAGES.map((e) => (
              <Pastille key={e.id} actif={encodage === e.id} onClick={() => setEncodage(e.id)} titre={e.aide}>
                {e.label}
              </Pastille>
            ))}
          </div>

          {zones.length > 0 ? (
            <CarteMiniFrance
              zones={zones}
              valeurs={valeurs}
              libelleValeur={encCourant.label}
              formater={formaterValeur}
              codeActif={actif}
              onSurvol={setActif}
            />
          ) : (
            <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>
              Chargement des contours…
            </p>
          )}

          <p style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.5, margin: 0 }}>
            {encCourant.aide}. Le gris signale une unité <strong style={{ fontWeight: 500 }}>sans
            aucune exposition</strong> — pas une valeur faible. Métropole uniquement : les DROM ne
            sont pas dessinés, mais ils comptent dans le tableau et dans le total.
          </p>
        </aside>
      </div>
    </div>
  );
}

/* ── Briques locales ─────────────────────────────────────────────────────── */

const styleSelect: React.CSSProperties = {
  background: 'var(--bg-level-2)',
  border: '0.5px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '6px 10px',
  fontFamily: fInter,
  fontSize: 12,
  color: 'var(--text-primary)',
};

const styleLien: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontFamily: fInter, fontSize: 10, color: 'var(--brand-teal)',
};

function Champ({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</span>
      {children}
    </label>
  );
}

function Pastille({
  actif, onClick, children, titre,
}: { actif: boolean; onClick: () => void; children: React.ReactNode; titre?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titre}
      aria-pressed={actif}
      style={{
        background: actif ? 'var(--brand-teal-10)' : 'transparent',
        border: `0.5px solid ${actif ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
        color: actif ? 'var(--brand-teal)' : 'var(--text-secondary)',
        borderRadius: 6, padding: '6px 11px', cursor: 'pointer',
        fontFamily: fInter, fontSize: 12,
        transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out)',
      }}
    >
      {children}
    </button>
  );
}

function Kpi({
  valeur, libelle, note, accent,
}: { valeur: string; libelle: string; note: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span
        style={{
          fontFamily: fMono, fontSize: 24, lineHeight: 1.1,
          color: accent ? 'var(--brand-teal)' : 'var(--text-primary)',
        }}
      >
        {valeur}
      </span>
      <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)' }}>{libelle}</span>
      <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>{note}</span>
    </div>
  );
}

function Th({ children, align = 'right' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align, padding: '6px 8px', fontWeight: 400,
        fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, fort, dim }: { children: React.ReactNode; fort?: boolean; dim?: boolean }) {
  return (
    <td
      style={{
        textAlign: 'right', padding: '7px 8px',
        fontFamily: fMono, fontSize: 11,
        color: fort ? 'var(--text-primary)' : dim ? 'var(--text-tertiary)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </td>
  );
}
