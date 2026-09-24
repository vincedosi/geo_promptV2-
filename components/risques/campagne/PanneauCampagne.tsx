'use client';

/**
 * Le panneau de l'étape ⑤ Campagne.
 *
 * ── DE HAUT EN BAS, DANS L'ORDRE DU GESTE ─────────────────────────────────
 *
 * 1. **La campagne** : l'extraction qu'on fait diffuser, les réglages, puis
 *    Simuler, Recaler, Exporter, Purger.
 * 2. **La période** : v1, v2 ou la campagne entière — elle pilote TOUT l'écran,
 *    bandeau, carte et tableau compris.
 * 3. **L'alignement jour par jour**, avec le recalage annoté, et le bilan avant
 *    et après.
 * 4. **Ce qu'il faut corriger**, **les partenaires**, **les sites sous-servis**.
 *
 * ⚠ Aucun badge « Simulation » : arbitrage du 2026-09-24. Le drapeau vit en
 * base (`dsp_campaigns.est_simulation`), où il empêche la campagne de passer
 * pour une vraie ; l'écran, lui, sert à une démonstration.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react';
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { adminFetch } from '@/lib/admin-fetch';
import { fInter, fMono } from '@/lib/design/polices';
import { formaterDecimal, formaterNombre, formaterNombreCourt } from '@/lib/format/nombre';
import { PARAMS_DEFAUT } from '@/lib/simulation/generateur';
import { constats, construireVue, etatSite, LIBELLE_PERIODE, type Periode } from '@/lib/simulation/vue';
import { useSimulation, type ReglagesSimulation } from '@/components/risques/campagne/ContexteSimulation';

interface ExtractionListe {
  id: string;
  version: number;
  origine: 'initiale' | 'recalage';
  n_retenus: number;
  created_at: string;
}

const REGLAGES: {
  cle: keyof ReglagesSimulation; libelle: string; min: number; max: number; pas: number;
  format: (v: number) => string;
}[] = [
  { cle: 'budget', libelle: 'Budget', min: 20_000, max: 1_000_000, pas: 10_000, format: (v) => `${formaterNombre(v)} €` },
  { cle: 'intensite', libelle: 'Effet inventaire', min: 1, max: 2.2, pas: 0.05, format: (v) => formaterDecimal(v, 2) },
  { cle: 'fuite', libelle: 'Fuite hors zone', min: 0, max: 0.15, pas: 0.005, format: (v) => `${formaterDecimal(v * 100, 1)} %` },
  { cle: 'bruit', libelle: 'Bruit journalier', min: 0, max: 0.5, pas: 0.02, format: (v) => `${formaterDecimal(v * 100, 0)} %` },
  { cle: 'amortissement', libelle: 'Force du recalage', min: 0, max: 1, pas: 0.05, format: (v) => `${formaterDecimal(v * 100, 0)} %` },
  { cle: 'graine', libelle: 'Graine', min: 1, max: 99_999, pas: 1, format: (v) => String(v) },
];

const DEFAUTS: ReglagesSimulation = {
  budget: PARAMS_DEFAUT.budget,
  intensite: PARAMS_DEFAUT.intensite,
  fuite: PARAMS_DEFAUT.fuite,
  bruit: PARAMS_DEFAUT.bruit,
  amortissement: PARAMS_DEFAUT.amortissement,
  graine: PARAMS_DEFAUT.graine % 100_000,
};

export function PanneauCampagne() {
  const s = useSimulation();
  const { jeuId, reponse, vue, courbe, periode, setPeriode, progression, etat, erreur } = s;
  const sim = reponse?.simulation ?? null;

  const [extractions, setExtractions] = useState<ExtractionListe[] | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [reglages, setReglages] = useState<ReglagesSimulation>(DEFAUTS);
  const [confirmerPurge, setConfirmerPurge] = useState(false);

  // Les extractions du jeu : relues quand la simulation change, puisqu'un
  // recalage en crée une.
  useEffect(() => {
    if (!jeuId) { setExtractions(null); return; }
    let vivant = true;
    adminFetch(`/api/zones/jeux/${jeuId}/extractions`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivant) return;
        const liste = (d?.extractions ?? []) as ExtractionListe[];
        setExtractions(liste);
        // Par défaut, la dernière extraction INITIALE : une v2 de recalage est
        // un produit de simulation, pas un plan qu'on a décidé.
        setVersion((v) => v ?? liste.find((e) => e.origine === 'initiale')?.version ?? liste[0]?.version ?? null);
      })
      .catch(() => { if (vivant) setExtractions([]); });
    return () => { vivant = false; };
  }, [jeuId, sim?.id, sim?.statut]);

  const occupe = progression !== null;

  // ── États vides ──────────────────────────────────────────────────────────
  if (!jeuId) {
    return (
      <Cadre>
        <Vide titre="Aucun jeu de zones ouvert">
          Ouvrez un jeu enregistré à l’étape ④ Zones : la campagne diffuse sur le plan
          d’une de ses extractions.
        </Vide>
      </Cadre>
    );
  }

  return (
    <Cadre>
      <Section titre="La campagne">
        {extractions && extractions.length === 0 ? (
          <Vide titre="Aucune extraction">
            Extrayez d’abord le plan à l’étape ④ Zones (« Extractions pour le custom bidding ») :
            une campagne diffuse sur ce qui part au DSP, pas sur le jeu en cours de réglage.
          </Vide>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sim && (
              <p style={texte}>
                Campagne de <strong style={fort}>{sim.jours} jours</strong> depuis le{' '}
                {new Date(`${sim.date_debut}T00:00:00Z`).toLocaleDateString('fr-FR')}, diffusée sur
                la <strong style={fort}>v{sim.extraction_v1.version}</strong>
                {sim.extraction_v2
                  ? <> puis, à partir du jour {sim.jour_recalage}, sur la <strong style={fort}>v{sim.extraction_v2.version}</strong> recalée.</>
                  : <> — semaines 1 et 2. Recalez pour diffuser les semaines 3 et 4 sur un plan corrigé.</>}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ ...texte, display: 'flex', alignItems: 'center', gap: 6 }}>
                Extraction
                <select
                  value={version ?? ''}
                  onChange={(e) => setVersion(Number(e.target.value))}
                  disabled={occupe || !extractions}
                  style={select}
                >
                  {(extractions ?? []).map((e) => (
                    <option key={e.id} value={e.version}>
                      v{e.version} · {e.origine === 'recalage' ? 'recalage' : 'initiale'} · {formaterNombre(e.n_retenus)} CP
                    </option>
                  ))}
                </select>
              </label>
              <Bouton
                onClick={() => version != null && s.simuler(version, reglages)}
                desactive={occupe || version == null}
                icone={<Play size={12} />}
                principal
              >
                {sim ? 'Relancer la simulation' : 'Simuler une campagne'}
              </Bouton>
            </div>

            <details>
              <summary style={{ ...texte, cursor: 'pointer' }}>Réglages de la diffusion</summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 16px', marginTop: 10 }}>
                {REGLAGES.map((r) => (
                  <label key={r.cle} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ ...texte, display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span>{r.libelle}</span>
                      <span style={{ fontFamily: fMono }}>{r.format(reglages[r.cle])}</span>
                    </span>
                    <input
                      type="range" min={r.min} max={r.max} step={r.pas}
                      value={reglages[r.cle]}
                      disabled={occupe}
                      onChange={(e) => setReglages((g) => ({ ...g, [r.cle]: Number(e.target.value) }))}
                      style={{ accentColor: 'var(--text-primary)' }}
                    />
                  </label>
                ))}
              </div>
              <p style={{ ...note, marginTop: 8 }}>
                L’effet inventaire dit combien l’offre publicitaire se concentre là où les gens
                vivent serrés. Aucun réglage ne fixe un score : l’alignement en découle.
              </p>
            </details>

            {sim && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {sim.statut === 'v1' && (
                  <Bouton onClick={() => s.recaler()} desactive={occupe} icone={<RefreshCw size={12} />} principal>
                    Recaler (v2)
                  </Bouton>
                )}
                <a
                  href={`/api/zones/jeux/${jeuId}/simulation/export`}
                  style={{ ...styleBouton(false), textDecoration: 'none' }}
                >
                  <Download size={12} /> Exporter en Excel
                </a>
                {confirmerPurge ? (
                  <>
                    <Bouton onClick={() => { setConfirmerPurge(false); void s.purger(); }} desactive={occupe} icone={<Trash2 size={12} />}>
                      Confirmer la purge
                    </Bouton>
                    <Bouton onClick={() => setConfirmerPurge(false)} desactive={occupe}>Annuler</Bouton>
                  </>
                ) : (
                  <Bouton onClick={() => setConfirmerPurge(true)} desactive={occupe} icone={<Trash2 size={12} />}>
                    Purger
                  </Bouton>
                )}
              </div>
            )}

            {progression && <BarreProgression {...progression} />}
            {erreur && (
              <p role="alert" style={{ ...texte, color: 'var(--danger)' }}>{erreur}</p>
            )}
          </div>
        )}
      </Section>

      {etat === 'chargement' && !sim && (
        <p style={{ ...texte, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Loader2 size={12} className="animate-spin" /> Lecture de la simulation…
        </p>
      )}

      {sim && vue && (
        <>
          <Section titre="Période">
            <div role="group" aria-label="Période" style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {(['v1', 'v2', 'tout'] as Periode[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriode(p)}
                  disabled={p === 'v2' && sim.statut !== 'v2'}
                  aria-pressed={vue.periode === p}
                  title={p === 'v2' && sim.statut !== 'v2' ? 'Recalez d’abord la campagne' : undefined}
                  style={{
                    padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
                    border: '0.5px solid var(--border-default)',
                    fontFamily: fInter, fontSize: 11,
                    opacity: p === 'v2' && sim.statut !== 'v2' ? 0.45 : 1,
                    background: vue.periode === p ? 'var(--brand-teal-10)' : 'transparent',
                    color: vue.periode === p ? 'var(--brand-teal)' : 'var(--text-secondary)',
                  }}
                >
                  {LIBELLE_PERIODE[p]}
                </button>
              ))}
            </div>
            {periode === 'v2' && sim.statut !== 'v2' && (
              <p style={note}>Pas encore de semaines 3 et 4 : l’écran montre la v1.</p>
            )}
          </Section>

          <Section titre="Alignement jour par jour">
            <Courbe points={courbe} recalage={sim.jour_recalage} jours={sim.jours} />
            <Bilan />
          </Section>

          <Section titre="Ce qu’il faut corriger">
            <Corriger />
          </Section>

          <Section titre="Partenaires">
            <Partenaires />
          </Section>

          <Section titre="Sites sous-servis">
            <SitesSousServis />
          </Section>
        </>
      )}

      {sim === null && etat === 'pret' && extractions && extractions.length > 0 && (
        <p style={note}>
          Aucune campagne simulée sur ce jeu. Choisissez une extraction et lancez la
          simulation : les semaines 1 et 2 diffusent sur son plan, avec l’effet inventaire
          qui pousse vers les zones denses.
        </p>
      )}
    </Cadre>
  );
}

// ── La courbe ────────────────────────────────────────────────────────────────

function Courbe({ points, recalage, jours }: {
  points: { jour: number; version: 1 | 2; score: number | null }[];
  recalage: number; jours: number;
}) {
  // Deux séries et non une colorée par segment : Recharts ne sait pas changer
  // la couleur d'une ligne en cours de route, et la rupture EST l'information.
  const donnees = points.map((p) => ({
    jour: p.jour,
    v1: p.version === 1 ? p.score : null,
    v2: p.version === 2 ? p.score : null,
  }));
  if (donnees.length === 0) return <p style={note}>Aucun jour diffusé.</p>;
  return (
    <div style={{ height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={donnees} margin={{ top: 14, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="jour" type="number" domain={[1, jours]} ticks={[1, 7, 14, 21, 28].filter((t) => t <= jours)}
            tick={{ fontSize: 10, fontFamily: fMono, fill: 'var(--text-tertiary)' }}
            tickFormatter={(v) => `j${v}`} stroke="var(--border-default)"
          />
          <YAxis
            domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
            tick={{ fontSize: 10, fontFamily: fMono, fill: 'var(--text-tertiary)' }}
            stroke="var(--border-default)"
          />
          <ReferenceLine
            x={recalage} stroke="var(--text-tertiary)" strokeDasharray="3 3"
            label={{ value: 'Recalage v2', position: 'top', fontSize: 10, fill: 'var(--text-secondary)' }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-level-2)', border: '0.5px solid var(--border-default)',
              borderRadius: 6, fontFamily: fInter, fontSize: 11,
            }}
            labelFormatter={(v) => `Jour ${v}`}
            formatter={(v) => [Math.round(Number(v)), 'Alignement']}
          />
          <Line type="monotone" dataKey="v1" stroke="var(--diverge-sous-2)" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="v2" stroke="var(--brand-teal)" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Bilan() {
  const { reponse } = useSimulation();
  const [a, b] = useMemo(() => (reponse
    ? [construireVue(reponse, 'v1'), reponse.simulation?.statut === 'v2' ? construireVue(reponse, 'v2') : null]
    : [null, null]), [reponse]);
  if (!a) return null;
  const pct = (x: number | null | undefined) => (x == null ? '—' : `${formaterDecimal(x * 100, 1)} %`);
  const lignes: [string, (v: NonNullable<typeof a>) => string][] = [
    ['Alignement', (v) => (v.indicateurs.score == null ? 'non calculable' : String(Math.round(v.indicateurs.score)))],
    ['Part en zone', (v) => pct(v.indicateurs.part_en_zone)],
    ['Taux d’utile', (v) => pct(v.indicateurs.taux_utile_reel)],
    ['Coût par exposé touché', (v) => (v.indicateurs.cout_expose_touche == null ? '—' : `${formaterDecimal(v.indicateurs.cout_expose_touche, 3)} €`)],
  ];
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontFamily: fInter, fontSize: 11 }}>
      <thead>
        <tr>
          <th style={thStyle('left')}>Bilan</th>
          <th style={thStyle()}>Semaines 1-2 · v1</th>
          <th style={thStyle()}>Semaines 3-4 · v2</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map(([nom, f]) => (
          <tr key={nom}>
            <td style={tdStyle(true)}>{nom}</td>
            <td style={tdStyle()}>{f(a)}</td>
            <td style={tdStyle()}>{b ? f(b) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Corriger() {
  const { vue, reponse } = useSimulation();
  if (!vue || !reponse?.entrees) return null;
  const c = constats(vue, reponse.entrees);
  const noms = (l: typeof c.sur) => l.map((z) => `${z.nom} (${Math.round(z.indice)})`).join(', ');
  const somme = (l: typeof c.sur, k: 'impressions' | 'euros') => l.reduce((t, z) => t + z[k], 0);
  if (c.sur.length === 0 && c.sous.length === 0) {
    return <p style={texte}>Toutes les zones tiennent leur plan à 10 % près sur cette période.</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {c.sur.length > 0 && (
        <p style={texte}>
          <strong style={fort}>Sur-pression</strong> · {noms(c.sur)}.{' '}
          <span style={{ fontFamily: fMono }}>{formaterNombreCourt(Math.round(somme(c.sur, 'impressions')))}</span>{' '}
          impressions, soit <span style={{ fontFamily: fMono }}>{formaterNombre(Math.round(somme(c.sur, 'euros')))} €</span>, à redéployer.
        </p>
      )}
      {c.sous.length > 0 && (
        <p style={texte}>
          <strong style={fort}>Sous-pression</strong> · {noms(c.sous)}. Il manque{' '}
          <span style={{ fontFamily: fMono }}>{formaterNombreCourt(Math.round(somme(c.sous, 'impressions')))}</span>{' '}
          impressions pour tenir le plan, soit <span style={{ fontFamily: fMono }}>{formaterNombre(Math.round(somme(c.sous, 'euros')))} €</span>.
        </p>
      )}
      {c.dilues.length > 0 && (
        <p style={texte}>
          <strong style={fort}>Codes postaux les plus dilués</strong> ·{' '}
          {c.dilues.map((d) => `${d.code_postal} (${formaterDecimal(d.part_en_zone, 1)} % d’exposés)`).join(', ')}.
          Chaque impression y touche surtout des habitants hors zone.
        </p>
      )}
    </div>
  );
}

function Partenaires() {
  const { vue } = useSimulation();
  if (!vue) return null;
  const pct = (x: number | null) => (x == null ? '—' : `${formaterDecimal(x * 100, 1)} %`);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fInter, fontSize: 11 }}>
      <thead>
        <tr>
          <th style={thStyle('left')}>Partenaire</th>
          <th style={thStyle()}>Impressions</th>
          <th style={thStyle()}>CPM</th>
          <th style={thStyle()}>Part en zone</th>
          <th style={thStyle()}>Taux d’utile</th>
        </tr>
      </thead>
      <tbody>
        {vue.partenaires.map((p) => (
          <tr key={p.nom}>
            <td style={tdStyle(true)}>{p.nom}</td>
            <td style={tdStyle()}>{formaterNombreCourt(p.impressions)}</td>
            <td style={tdStyle()}>{p.cpm == null ? '—' : `${formaterDecimal(p.cpm, 2)} €`}</td>
            <td style={tdStyle()}>{pct(p.part_en_zone)}</td>
            <td style={tdStyle()}>{pct(p.taux_utile)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SitesSousServis() {
  const { vue, setZoneActive } = useSimulation();
  if (!vue) return null;
  const sous = vue.zones
    .filter((z) => z.part_plan > 0 && etatSite(z.indice) !== 'servi')
    .sort((a, b) => (a.indice ?? 0) - (b.indice ?? 0));
  const nSites = sous.reduce((t, z) => t + z.n_sites, 0);
  if (sous.length === 0) return <p style={texte}>Tous les sites reçoivent au moins 90 % de leur part.</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={texte}>
        <span style={{ fontFamily: fMono }}>{formaterNombre(nSites)}</span> sites dans{' '}
        <span style={{ fontFamily: fMono }}>{formaterNombre(sous.length)}</span> bassins reçoivent moins de
        90 % de leur part du plan. Sur la carte, leurs points sont rouges (sous 50) ou orange.
      </p>
      <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sous.slice(0, 8).map((z) => (
          <li key={z.id} style={texte}>
            <button
              type="button" onClick={() => setZoneActive(z.id)}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--brand-teal)', fontFamily: fInter, fontSize: 12 }}
            >
              {z.nom}
            </button>{' '}
            · {formaterNombre(z.n_sites)} site{z.n_sites > 1 ? 's' : ''} · indice{' '}
            <span style={{ fontFamily: fMono }}>{z.indice == null ? '—' : Math.round(z.indice)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Briques ──────────────────────────────────────────────────────────────────

function Cadre({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {children}
    </div>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px', marginBottom: 12,
        background: 'var(--bg-level-2)', borderTop: '1px solid var(--border-subtle)',
      }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <h3 style={{ margin: 0, fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          {titre}
        </h3>
      </div>
      <div style={{ padding: '0 2px' }}>{children}</div>
    </section>
  );
}

function Vide({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ ...texte, color: 'var(--text-primary)', fontWeight: 500 }}>{titre}</p>
      <p style={texte}>{children}</p>
    </div>
  );
}

function BarreProgression({ message, pourcentage, faites, total }: {
  message: string; pourcentage: number | null; faites?: number; total?: number;
}) {
  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ ...texte, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Loader2 size={12} className="animate-spin" /> {message}
        </span>
        {pourcentage != null && (
          <span style={{ fontFamily: fMono }}>
            {pourcentage} %{faites != null && total != null ? ` · ${formaterNombre(faites)} / ${formaterNombre(total)} lignes` : ''}
          </span>
        )}
      </div>
      <div style={{ height: 3, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', background: 'var(--brand-teal)',
          width: pourcentage == null ? '30%' : `${pourcentage}%`,
          transition: 'width 200ms ease-out',
        }} />
      </div>
    </div>
  );
}

function Bouton({ children, onClick, desactive, icone, principal }: {
  children: React.ReactNode; onClick: () => void; desactive?: boolean;
  icone?: React.ReactNode; principal?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={desactive} style={{
      ...styleBouton(!!principal), opacity: desactive ? 0.5 : 1, cursor: desactive ? 'not-allowed' : 'pointer',
    }}>
      {icone}{children}
    </button>
  );
}

function styleBouton(principal: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', borderRadius: 6,
    background: 'transparent',
    border: `0.5px solid ${principal ? 'var(--brand-teal)' : 'var(--border-default)'}`,
    color: principal ? 'var(--brand-teal)' : 'var(--text-secondary)',
    fontFamily: fInter, fontSize: 12, fontWeight: 500, cursor: 'pointer',
  };
}

const texte: React.CSSProperties = {
  margin: 0, fontFamily: fInter, fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary)',
};
const note: React.CSSProperties = { ...texte, fontSize: 11, color: 'var(--text-tertiary)' };
const fort: React.CSSProperties = { fontWeight: 500, color: 'var(--text-primary)' };
const select: React.CSSProperties = {
  background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6,
  padding: '5px 8px', fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)',
};
function thStyle(align: 'left' | 'right' = 'right'): React.CSSProperties {
  return {
    textAlign: align, fontWeight: 400, color: 'var(--text-tertiary)', padding: '5px 6px',
    borderBottom: '0.5px solid var(--border-default)', whiteSpace: 'nowrap',
  };
}
function tdStyle(premiere = false): React.CSSProperties {
  return {
    textAlign: premiere ? 'left' : 'right', padding: '5px 6px',
    borderBottom: '0.5px solid var(--border-subtle)',
    fontFamily: premiere ? fInter : fMono, color: 'var(--text-primary)', whiteSpace: 'nowrap',
  };
}
