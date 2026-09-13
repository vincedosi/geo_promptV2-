'use client';

/**
 * /admin/qualite-donnees — état des données manquantes, partielles, périmées
 * ou fausses (2026-09-13).
 *
 * Distincte de `/admin/health`, qui regarde l'INFRASTRUCTURE (variables
 * d'environnement, connectivité, taille des tables). Cette page-ci regarde le
 * CONTENU : ce que les tables contiennent réellement, et ce qu'elles ne
 * contiennent pas.
 *
 * **Rien ne se lance au chargement.** La page lit les derniers relevés
 * persistés et affiche leur date ; chaque vérification se relance par un
 * bouton, une par une. Le balayage des colonnes d'`iris` coûte ~220 Mo de
 * lecture : un affichage qui se rafraîchit tout seul ferait payer ce prix à
 * chaque coup d'œil, sur un Nano plafonné à 5 Mo/s.
 *
 * **Il n'y a délibérément AUCUN bouton « tout vérifier ».** Voir l'en-tête de
 * `app/api/admin/qualite-donnees/route.ts`.
 *
 * Parti pris d'affichage : une vérification jamais lancée s'affiche « jamais
 * lancée », pas « rien à signaler ». Un tableau de bord vert qui ne garantit
 * rien fait cesser de chercher — c'est le seul risque qui rendrait cette page
 * nuisible.
 */
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { formaterNombre } from '@/lib/format/nombre';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

type CleVerification = 'indicateurs' | 'fraicheur' | 'invariants' | 'colonnes';

interface Verification {
  cle: CleVerification;
  libelle: string;
  cout: string;
  releve: unknown;
  calcule_le: string | null;
  duree_ms: number | null;
}

interface LigneIndicateur {
  indicator_code: string;
  label: string;
  famille: string | null;
  data_source: string;
  data_column: string | null;
  n_source: number | null;
  n_total_source: number | null;
  n_cp: number | null;
  cp_calcules_le: string | null;
  verdict: 'colonne_absente' | 'source_vide' | 'partiel' | 'ok';
}

interface LigneSource {
  table: string;
  libelle: string;
  derniere_donnee: string | null;
  n_lignes: number;
  cadence_attendue_jours: number | null;
  alimentation: string;
  age_jours: number | null;
}

interface Controle {
  cle: string;
  libelle: string;
  unite: string;
  attendu: number;
  mesure: number;
  ecart_relatif: number | null;
  tolerance: number;
  ok: boolean;
}

/** Les quatre familles, dites en clair — un verdict brut ne se lit pas seul. */
const VERDICTS: Record<LigneIndicateur['verdict'], { texte: string; couleur: string; fond: string }> = {
  colonne_absente: { texte: 'colonne absente du schéma', couleur: 'var(--danger)', fond: 'rgba(255,87,87,0.08)' },
  source_vide:     { texte: 'source vide — ne produira jamais rien', couleur: 'var(--danger)', fond: 'rgba(255,87,87,0.08)' },
  partiel:         { texte: 'couverture partielle', couleur: 'var(--warning)', fond: 'rgba(247,183,49,0.08)' },
  ok:              { texte: 'ok', couleur: 'var(--text-tertiary)', fond: 'transparent' },
};

function dateCourte(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function QualiteDonneesPage() {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState<CleVerification | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const res = await adminFetch('/api/admin/qualite-donnees', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVerifications(data.verifications ?? []);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setChargement(false);
    }
  }, []);

  // Lecture des relevés PERSISTÉS, jamais un calcul.
  useEffect(() => { void charger(); }, [charger]);

  const relancer = async (cle: CleVerification) => {
    if (enCours) return; // une à la fois, y compris côté client
    setEnCours(cle);
    setErreur(null);
    try {
      const res = await adminFetch('/api/admin/qualite-donnees', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verification: cle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setVerifications((prev) => prev.map((v) => (
        v.cle === cle ? { ...v, releve: data.releve, calcule_le: data.calcule_le, duree_ms: data.duree_ms } : v
      )));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, fontFamily: fInter, color: 'var(--text-secondary)' }}>

      <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0 }}>
        Qualité des données
      </h1>
      <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 8, marginBottom: 28, maxWidth: 720 }}>
        Les trous de données ne lèvent aucune erreur : une valeur absente se lit comme
        un résultat. Cette page les rend visibles. Chaque vérification se lance à la
        demande — il n’y a pas de bouton « tout vérifier », et rouvrir cette page ne
        recalcule rien.
      </p>

      {erreur && (
        <div style={{
          padding: '10px 12px', borderRadius: 6, marginBottom: 20,
          background: 'rgba(255,87,87,0.08)', border: '0.5px solid rgba(255,87,87,0.25)',
          color: 'var(--danger)', fontSize: 12,
        }}>{erreur}</div>
      )}

      {chargement ? (
        <div style={{ fontFamily: fMono, fontSize: 12, color: 'var(--text-tertiary)' }}>Chargement des relevés…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {verifications.map((v) => (
            <section key={v.cle} style={{
              background: 'var(--card)', border: '0.5px solid var(--border-subtle)', borderRadius: 8,
            }}>
              <header style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                background: 'var(--elevated)', borderTop: '1px solid var(--border-subtle)',
                borderRadius: '8px 8px 0 0',
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
                  {v.libelle}
                </span>
                <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
                  {v.calcule_le
                    ? `mesuré le ${dateCourte(v.calcule_le)}${v.duree_ms ? ` · ${formaterNombre(v.duree_ms)} ms` : ''}`
                    : 'jamais lancée'}
                </span>
                <button
                  onClick={() => relancer(v.cle)}
                  disabled={enCours !== null}
                  title={`Coût : ${v.cout}`}
                  style={{
                    background: 'transparent', border: '0.5px solid var(--brand-teal)',
                    color: 'var(--brand-teal)', borderRadius: 6, padding: '5px 12px',
                    fontFamily: fInter, fontSize: 11, fontWeight: 500,
                    cursor: enCours ? 'not-allowed' : 'pointer', opacity: enCours ? 0.4 : 1,
                  }}
                >
                  {enCours === v.cle ? 'Mesure…' : v.calcule_le ? 'Relancer' : 'Lancer'}
                </button>
              </header>

              <div style={{ padding: 14 }}>
                {/* Le coût est annoncé AVANT de cliquer, pas découvert après. */}
                <div style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginBottom: v.releve ? 12 : 0 }}>
                  coût d’une mesure : {v.cout}
                </div>

                {!v.releve && (
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    Jamais lancée — ce n’est pas « rien à signaler ».
                  </div>
                )}

                {v.releve != null && v.cle === 'indicateurs' && <VueIndicateurs releve={v.releve} />}
                {v.releve != null && v.cle === 'fraicheur' && <VueFraicheur releve={v.releve} />}
                {v.releve != null && v.cle === 'invariants' && <VueInvariants releve={v.releve} />}
                {v.releve != null && v.cle === 'colonnes' && <VueColonnes releve={v.releve} />}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left', fontFamily: fInter, fontSize: 11, fontWeight: 400,
  color: 'var(--text-tertiary)', padding: '6px 10px', borderBottom: '0.5px solid var(--border-subtle)',
};
const td: React.CSSProperties = {
  fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)',
  padding: '7px 10px', borderBottom: '0.5px solid var(--border-subtle)',
};
const tdMono: React.CSSProperties = { ...td, fontFamily: fMono, fontSize: 11 };

function VueIndicateurs({ releve }: { releve: unknown }) {
  const d = releve as { n_iris: number; indicateurs: LigneIndicateur[] };
  const lignes = d.indicateurs ?? [];
  const problemes = lignes.filter((l) => l.verdict !== 'ok');

  return (
    <>
      <div style={{ fontSize: 12, marginBottom: 10 }}>
        {problemes.length === 0
          ? `Les ${lignes.length} indicateurs actifs pointent vers des données exploitables.`
          : <><strong style={{ color: 'var(--text-primary)' }}>{problemes.length}</strong> indicateur
             {problemes.length > 1 ? 's' : ''} sur {lignes.length} {problemes.length > 1 ? 'posent' : 'pose'} problème,
             et {problemes.length > 1 ? 'sont proposés' : 'est proposé'} à l’utilisateur.</>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead>
            <tr>
              <th style={th}>Indicateur</th>
              <th style={th}>Colonne source</th>
              <th style={{ ...th, textAlign: 'right' }}>IRIS renseignés</th>
              <th style={{ ...th, textAlign: 'right' }}>CP calculés</th>
              <th style={th}>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {/* Les problèmes d'abord : on ne fait pas défiler pour les trouver. */}
            {[...problemes, ...lignes.filter((l) => l.verdict === 'ok')].map((l) => {
              const v = VERDICTS[l.verdict];
              const part = l.n_source != null && l.n_total_source
                ? Math.round((l.n_source / l.n_total_source) * 100) : null;
              return (
                <tr key={l.indicator_code} style={{ background: v.fond }}>
                  <td style={td}>{l.label}</td>
                  <td style={tdMono}>{l.data_column ?? `(${l.data_source})`}</td>
                  <td style={{ ...tdMono, textAlign: 'right' }}>
                    {l.n_source != null
                      ? `${formaterNombre(l.n_source)}${part != null ? ` · ${part} %` : ''}`
                      : '—'}
                  </td>
                  <td style={{ ...tdMono, textAlign: 'right' }}>
                    {l.n_cp != null ? formaterNombre(l.n_cp) : '—'}
                  </td>
                  <td style={{ ...td, color: v.couleur, fontSize: 11 }}>{v.texte}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function VueFraicheur({ releve }: { releve: unknown }) {
  const d = releve as { sources: LigneSource[] };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
        <thead>
          <tr>
            <th style={th}>Source</th>
            <th style={{ ...th, textAlign: 'right' }}>Dernière donnée</th>
            <th style={{ ...th, textAlign: 'right' }}>Âge</th>
            <th style={{ ...th, textAlign: 'right' }}>Lignes</th>
            <th style={th}>Alimentation</th>
          </tr>
        </thead>
        <tbody>
          {(d.sources ?? []).map((s) => {
            // Périmé = plus de 3 cadences de retard. Sans cadence attendue
            // (matérialisation à la demande), l'âge n'est pas un défaut.
            const perime = s.cadence_attendue_jours != null
              && s.age_jours != null && s.age_jours > s.cadence_attendue_jours * 3;
            return (
              <tr key={s.table} style={{ background: perime ? 'rgba(247,183,49,0.08)' : 'transparent' }}>
                <td style={td}>
                  {s.libelle}
                  <div style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>{s.table}</div>
                </td>
                <td style={{ ...tdMono, textAlign: 'right' }}>{s.derniere_donnee ?? '—'}</td>
                <td style={{ ...tdMono, textAlign: 'right', color: perime ? 'var(--warning)' : undefined }}>
                  {s.age_jours != null ? `${formaterNombre(s.age_jours)} j` : '—'}
                </td>
                <td style={{ ...tdMono, textAlign: 'right' }}>{formaterNombre(s.n_lignes)}</td>
                <td style={{ ...td, fontSize: 11, color: 'var(--text-tertiary)' }}>{s.alimentation}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* LE contresens à éviter : une table figée alimentée par un cron ne dit
          pas que la source est muette, mais que le cron ne tourne pas. */}
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10, lineHeight: 1.6 }}>
        Une source alimentée par un cron et figée depuis longtemps signale un cron qui ne
        tourne pas, pas une donnée absente à la source — regardez d’abord la colonne
        « alimentation » avant de soupçonner le fournisseur.
      </div>
    </div>
  );
}

function VueInvariants({ releve }: { releve: unknown }) {
  const d = releve as { controles: Controle[] };
  const controles = d.controles ?? [];
  const echecs = controles.filter((c) => !c.ok);

  return (
    <>
      <div style={{ fontSize: 12, marginBottom: 10 }}>
        {echecs.length === 0
          ? `Les ${controles.length} invariants tiennent.`
          : <strong style={{ color: 'var(--danger)' }}>{echecs.length} invariant{echecs.length > 1 ? 's' : ''} rompu{echecs.length > 1 ? 's' : ''}.</strong>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead>
            <tr>
              <th style={th}>Contrôle</th>
              <th style={{ ...th, textAlign: 'right' }}>Attendu</th>
              <th style={{ ...th, textAlign: 'right' }}>Mesuré</th>
              <th style={{ ...th, textAlign: 'right' }}>Écart</th>
            </tr>
          </thead>
          <tbody>
            {controles.map((c) => (
              <tr key={c.cle} style={{ background: c.ok ? 'transparent' : 'rgba(255,87,87,0.08)' }}>
                <td style={td}>{c.libelle}</td>
                <td style={{ ...tdMono, textAlign: 'right' }}>{formaterNombre(c.attendu)} {c.unite}</td>
                <td style={{ ...tdMono, textAlign: 'right', color: c.ok ? undefined : 'var(--danger)' }}>
                  {formaterNombre(c.mesure)} {c.unite}
                </td>
                <td style={{ ...tdMono, textAlign: 'right', color: c.ok ? 'var(--text-tertiary)' : 'var(--danger)' }}>
                  {c.ecart_relatif != null ? `${(c.ecart_relatif * 100).toFixed(3)} %` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function VueColonnes({ releve }: { releve: unknown }) {
  const d = releve as { n_lignes: number; colonnes: Record<string, { renseignes: number; non_nuls: number }> };
  const entrees = Object.entries(d.colonnes ?? {})
    .map(([nom, v]) => ({ nom, ...v, part: d.n_lignes ? v.renseignes / d.n_lignes : 0 }))
    .sort((a, b) => a.part - b.part);

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ fontSize: 12, marginBottom: 10 }}>
        {formaterNombre(entrees.filter((e) => e.renseignes === 0).length)} colonne(s) entièrement vide(s)
        sur {entrees.length}, mesurées sur {formaterNombre(d.n_lignes)} IRIS.
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead>
          <tr>
            <th style={th}>Colonne</th>
            <th style={{ ...th, textAlign: 'right' }}>Renseignées</th>
            <th style={{ ...th, textAlign: 'right' }}>Non nulles</th>
            <th style={{ ...th, textAlign: 'right' }}>Couverture</th>
          </tr>
        </thead>
        <tbody>
          {entrees.map((e) => (
            <tr key={e.nom} style={{ background: e.renseignes === 0 ? 'rgba(255,87,87,0.08)' : 'transparent' }}>
              <td style={tdMono}>{e.nom}</td>
              <td style={{ ...tdMono, textAlign: 'right' }}>{formaterNombre(e.renseignes)}</td>
              {/* « Renseignée » et « non nulle » sont distinguées : une colonne
                  légitimement pleine de zéros n'est PAS une colonne vide. */}
              <td style={{ ...tdMono, textAlign: 'right' }}>{formaterNombre(e.non_nuls)}</td>
              <td style={{
                ...tdMono, textAlign: 'right',
                color: e.renseignes === 0 ? 'var(--danger)' : e.part < 0.5 ? 'var(--warning)' : 'var(--text-tertiary)',
              }}>
                {Math.round(e.part * 100)} %
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
