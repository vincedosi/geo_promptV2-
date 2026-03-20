#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GENESIS -- Clustering POI par profil sociodemographique Filosofi
================================================================
Clusterise les POI selon le profil sociodemographique de leur bassin de
chalandise (isochrone voiture) en aggregant les carreaux Filosofi.

Usage:
  python scripts/clustering_poi_filosofi.py --mode full-retrain
  python scripts/clustering_poi_filosofi.py --mode assign-new
  python scripts/clustering_poi_filosofi.py --mode update-affected --since 2025-03-01
  python scripts/clustering_poi_filosofi.py --mode pipeline-new [--poi-id UUID]
  python scripts/clustering_poi_filosofi.py --mode cache-isochrones [--poi-type TYPE]
  python scripts/clustering_poi_filosofi.py --mode fix-geometries
  python scripts/clustering_poi_filosofi.py --mode recon-secret-stat
  python scripts/clustering_poi_filosofi.py --mode compute-france-averages

Options:
  --duration 60        Duree isochrone en minutes (defaut: 60)
  --transport drive    Mode: drive|walk|bike (defaut: drive)
  --force-k N          Forcer K clusters
  --features SPEC      Variables a utiliser : thematique(s) ou noms individuels
                       Ex: demographie | demographie,revenus | pct_0_17,pct_18_39
                       Omis = toutes les 16 variables (comportement par defaut)
  --dry-run            Simuler sans ecrire en base
  --verbose / -v       Logs detailles
  --limit N            Limiter nb POI (tests)

Phase 3 : Gestion du secret statistique INSEE
  - cov_rate = n_carreaux_inclus (ind > 11) / n_carreaux_total dans l'isochrone
  - Si cov_rate < COVERAGE_THRESHOLD (0.5) -> toutes les features = NaN
  - NaN imputes par mediane de la feature sur les autres POI
  - imputed_features stocke dans poi_clusters
"""

import os
import sys
import json
import math
import time
import logging
import argparse
from datetime import datetime, timezone
from typing import Optional, Dict, List, Tuple, Any

try:
    import requests as _requests
except ImportError:
    print("ERR: pip install requests")
    sys.exit(1)

# Force UTF-8 pour la sortie console (Windows)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import numpy as np

try:
    from supabase import create_client, Client as SupabaseClient
except ImportError:
    print("ERR: pip install supabase")
    sys.exit(1)

# Fix hang joblib/loky sur Windows lors de la detection des coeurs CPU
os.environ.setdefault('LOKY_MAX_CPU_COUNT', '4')

try:
    from sklearn.preprocessing import StandardScaler
    from sklearn.decomposition import PCA
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score, silhouette_samples, adjusted_rand_score
except ImportError:
    print("ERR: pip install scikit-learn")
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(**kwargs):
        pass

# -- Config -------------------------------------------------------------------

_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
load_dotenv(dotenv_path=os.path.join(_root, '.env.local'))

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL', '')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')

TABLE_POI       = 'poi_france'
TABLE_ISO_CACHE = 'isochrones_cache'
TABLE_CLUSTERS  = 'poi_clusters'
TABLE_MODELS    = 'clustering_models'
TABLE_HISTORY   = 'poi_cluster_history'
TABLE_SANITY    = 'clustering_sanity_reports'  # Phase 10 (optionnel)

# Secret statistique INSEE : carreaux avec ind <= seuil exclus du calcul
SECRET_STAT_SEUIL = 11

# Fiabilite : si moins de X% des carreaux de l'isochrone passent le filtre
# secret stat, les features sont marquees NaN (profil peu fiable).
# NOTE : pour les isochrones 60min voiture en France, cov_rate de 25-35% est
# NORMAL (64% des carreaux nationaux sont secret stat, zones rurales/peu denses).
# Le seuil de 5% attrape uniquement les isochrones vraiment vides/degeneres.
COVERAGE_THRESHOLD = 0.05

# -- ORS (OpenRouteService) ---------------------------------------------------

ORS_API_KEY  = os.getenv('ORS_API_KEY', '')
ORS_BASE_URL = 'https://api.openrouteservice.org/v2/isochrones'
ORS_PROFILES = {
    'drive': 'driving-car',
    'walk':  'foot-walking',
    'bike':  'cycling-regular',
}
ORS_DELAY_DEFAULT = 3.0  # secondes entre appels ORS

# Phase 9 : durées supportées pour --duration all
DURATIONS_ALL = [30, 45, 60]

# Categorie par defaut quand le champ est NULL en base
# (ne doit jamais apparaître en dur ailleurs — utilisé uniquement ici)
POI_CAT_DEFAULT = 'poi'

# -- Features (proportions/ratios -- jamais de volumes bruts) -----------------

FEATURE_NAMES: List[str] = [
    'pct_0_17',           # % enfants + ados (0-17 ans)
    'pct_18_39',          # % jeunes adultes (18-39 ans)
    'pct_40_54',          # % adultes actifs (40-54 ans)
    'pct_55_79',          # % seniors (55-79 ans)
    'pct_80p',            # % tres ages (80 ans et +)
    'revenu_moyen',       # revenu moyen par individu (ind_snv / ind / 20000)
    'taux_pauvrete',      # menages pauvres / menages totaux
    'taux_proprietaires', # menages proprietaires / menages totaux
    'taux_collectif',     # logement collectif / (collectif + individuel)
    'taux_hlm',           # logements sociaux / logements totaux
    'taux_isoles',        # menages 1 personne / menages totaux
    'taux_grandes_fam',   # menages 5+ personnes / menages totaux
    'taux_mono_parental', # familles mono-parentales / menages totaux
    'taux_ancien',        # logements avant 1945 / logements totaux
    'taux_recent',        # logements apres 1990 / logements totaux
    'surface_moyenne',    # surface moyenne logement (men_surf / men)
]

# -- Thematiques (doit rester en sync avec lib/clustering/feature-themes.ts) ---

FEATURE_THEMES: Dict[str, List[str]] = {
    'demographie': ['pct_0_17', 'pct_18_39', 'pct_40_54', 'pct_55_79', 'pct_80p'],
    'revenus':     ['revenu_moyen', 'taux_pauvrete'],
    'logement':    ['taux_proprietaires', 'taux_collectif', 'taux_hlm',
                    'taux_ancien', 'taux_recent', 'surface_moyenne'],
    'menages':     ['taux_isoles', 'taux_grandes_fam', 'taux_mono_parental'],
}


def resolve_features(features_arg: Optional[str]) -> List[str]:
    """
    Resout l'argument --features en liste ordonnee de noms de features.

    features_arg peut etre :
      - None / omis       -> toutes les 16 features (comportement par defaut)
      - 'demographie'     -> expansion de la thematique
      - 'demographie,revenus' -> plusieurs thematiques
      - 'pct_0_17,pct_18_39' -> variables individuelles
      - mix autorise      -> 'demographie,revenu_moyen'

    Leve ValueError si une thematique ou variable est inconnue, ou si < 2 vars.
    """
    if not features_arg:
        return list(FEATURE_NAMES)

    selected: List[str] = []
    for item in features_arg.split(','):
        item = item.strip()
        if not item:
            continue
        if item in FEATURE_THEMES:
            selected.extend(FEATURE_THEMES[item])
        elif item in FEATURE_NAMES:
            selected.append(item)
        else:
            raise ValueError(
                f"Feature ou thematique inconnue : '{item}'. "
                f"Thematiques : {list(FEATURE_THEMES.keys())}. "
                f"Variables : {FEATURE_NAMES}"
            )

    # Deduplique en preservant l'ordre
    seen: set = set()
    unique: List[str] = []
    for f in selected:
        if f not in seen:
            seen.add(f)
            unique.append(f)

    if len(unique) < 2:
        raise ValueError(
            f"Minimum 2 variables requises, {len(unique)} selectionnee(s) : {unique}"
        )
    return unique


def themes_from_features(feature_names: List[str]) -> List[str]:
    """Retourne la liste des thematiques dont TOUTES les features sont presentes."""
    result = []
    for tid, feats in FEATURE_THEMES.items():
        if all(f in feature_names for f in feats):
            result.append(tid)
    return result


_LBL_POS = {
    'pct_0_17':           'Familial (enfants)',
    'pct_18_39':          'Jeune adulte',
    'pct_40_54':          'Actifs mid',
    'pct_55_79':          'Seniors actifs',
    'pct_80p':            'Grand age',
    'revenu_moyen':       'Revenus eleves',
    'taux_pauvrete':      'Precarite elevee',
    'taux_proprietaires': 'Proprietaires',
    'taux_collectif':     'Logement collectif',
    'taux_hlm':           'HLM / Social',
    'taux_isoles':        'Isoles',
    'taux_grandes_fam':   'Grandes familles',
    'taux_mono_parental': 'Mono-parentales',
    'taux_ancien':        'Parc ancien',
    'taux_recent':        'Parc recent',
    'surface_moyenne':    'Grands logements',
}
_LBL_NEG = {
    'pct_0_17':           'Sans enfants',
    'pct_18_39':          'Peu de jeunes',
    'pct_80p':            'Peu de tres ages',
    'revenu_moyen':       'Revenus modestes',
    'taux_pauvrete':      'Peu de precarite',
    'taux_proprietaires': 'Locataires',
    'taux_hlm':           'Peu de HLM',
    'taux_isoles':        "Peu d'isoles",
    'taux_collectif':     'Maisons indiv.',
    'taux_grandes_fam':   'Petits menages',
    'taux_ancien':        'Parc recent',
    'taux_recent':        'Parc ancien',
    'surface_moyenne':    'Petits logements',
}

# -- Logging ------------------------------------------------------------------

def setup_logging(verbose: bool) -> logging.Logger:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        '%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S'
    ))
    log = logging.getLogger('genesis.clustering')
    log.setLevel(logging.DEBUG if verbose else logging.INFO)
    log.addHandler(handler)
    log.propagate = False
    return log


# -- Supabase client ----------------------------------------------------------

def get_supabase() -> SupabaseClient:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError(
            "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env.local"
        )
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# -- Isochrone cache helpers --------------------------------------------------

def build_battle_cache_key(poi_id: str, categorie: str, minutes: int, mode: str) -> str:
    return f"battle__{categorie}__{poi_id.replace('-', '_')}__{minutes}min__{mode}"


def get_isochrone_geom_json(
    poi_id: str,
    categorie: str,
    minutes: int,
    mode: str,
    sb: SupabaseClient,
    log: logging.Logger,
) -> Optional[str]:
    key = build_battle_cache_key(poi_id, categorie, minutes, mode)
    res = (
        sb.table(TABLE_ISO_CACHE)
        .select('geojson')
        .eq('cache_key', key)
        .limit(1)
        .execute()
    )
    if not res.data:
        log.debug(f"Cache MISS: {key}")
        return None
    geojson = (res.data[0] if isinstance(res.data, list) else res.data).get('geojson') or {}
    features = geojson.get('features') or []
    if not features:
        return None
    geom = features[0].get('geometry')
    return json.dumps(geom) if geom else None


# -- Profile computation via RPC Supabase -------------------------------------

def compute_profile(
    iso_geom_json: str,
    sb: SupabaseClient,
) -> Optional[Dict[str, Any]]:
    """
    Appelle get_filosofi_profile_for_isochrone (v6).
    Retourne le profil brut incluant n_carreaux, n_carreaux_total, cov_rate.
    Retourne None si aucun carreau.
    """
    res = sb.rpc(
        'get_filosofi_profile_for_isochrone',
        {'p_iso_geojson': iso_geom_json, 'p_secret_stat': float(SECRET_STAT_SEUIL)},
    ).execute()
    if not res.data:
        return None
    row = res.data[0] if isinstance(res.data, list) else res.data
    if int(row.get('n_carreaux') or 0) == 0:
        return None
    return dict(row)


def compute_profiles_batch(
    entries: List[Dict[str, str]],  # [{poi_id, cache_key}, ...]
    sb: SupabaseClient,
    log: logging.Logger,
) -> Dict[str, Dict]:
    """
    Phase 7 : appel batch compute_filosofi_profiles_batch.
    Remplace N appels séquentiels à get_filosofi_profile_for_isochrone par 1 seule RPC.
    Retourne {poi_id: profile_dict} pour les POI ayant des carreaux valides.
    """
    if not entries:
        return {}

    payload = [{'poi_id': e['poi_id'], 'cache_key': e['cache_key']} for e in entries]
    t0 = time.time()
    try:
        res = sb.rpc(
            'compute_filosofi_profiles_batch',
            {'p_entries': payload, 'p_secret_stat': float(SECRET_STAT_SEUIL)},
        ).execute()
    except Exception as exc:
        log.warning(f"Batch RPC echoue ({exc}), fallback sequentiel")
        return {}

    elapsed = time.time() - t0
    data = res.data
    if not data:
        return {}

    # La RPC retourne un seul objet JSONB {poi_id: profil}
    if isinstance(data, list):
        data = data[0] if data else {}

    n_ok = len(data)
    log.info(
        f"Batch RPC: {n_ok}/{len(entries)} profils calcules en {elapsed:.1f}s "
        f"({elapsed / max(len(entries), 1) * 1000:.0f}ms/POI)"
    )
    return data


def check_iso_hits_new_carreaux(
    iso_geom_json: str,
    since: str,
    sb: SupabaseClient,
) -> bool:
    res = sb.rpc(
        'check_iso_hits_new_carreaux',
        {'p_iso_geojson': iso_geom_json, 'p_since': since},
    ).execute()
    if isinstance(res.data, list):
        return bool(res.data[0]) if res.data else False
    return bool(res.data)


# -- Phase 3 : secret statistique coverage -----------------------------------

def apply_coverage_threshold(
    profile: Dict,
    threshold: float = COVERAGE_THRESHOLD,
) -> Tuple[Dict, List[str]]:
    """
    Phase 3 : si cov_rate < threshold, marquer TOUTES les features comme NaN.
    cov_rate = n_carreaux_inclus (ind > 11) / n_carreaux_total dans isochrone.

    Retourne (profil_modifie, features_masquees).
    Un profil avec cov_rate >= threshold n'est pas modifie.
    """
    cov_rate = float(profile.get('cov_rate') or 1.0)
    if cov_rate < threshold:
        result = dict(profile)
        for feat in FEATURE_NAMES:
            result[feat] = float('nan')
        return result, list(FEATURE_NAMES)
    return profile, []


# -- Feature matrix -----------------------------------------------------------

def profiles_to_matrix(
    profiles: Dict[str, Dict],
    log: Optional[logging.Logger] = None,
    feature_names: Optional[List[str]] = None,
) -> Tuple[List[str], np.ndarray, Dict[str, Dict], Dict[str, List[str]]]:
    """
    Convertit {poi_id: profile_row} -> (poi_ids, X_float, coverage_stats, imputed_map).

    Phase 3 :
    - Les profiles peuvent contenir des NaN (features sous seuil de couverture)
    - NaN imputes par mediane de la feature sur les autres POI
    - imputed_map[poi_id] = liste des features imputees pour ce POI
    - Les imputations sont loguees en console

    feature_names : sous-ensemble de features a utiliser (None = toutes).
    Retourne 4-tuple.
    """
    _feats = feature_names if feature_names is not None else FEATURE_NAMES
    poi_ids: List[str] = []
    rows: List[List[float]] = []
    coverage: Dict[str, Dict] = {}

    for poi_id, p in profiles.items():
        vec: List[float] = []
        for f in _feats:
            v = p.get(f)
            if v is None:
                vec.append(float('nan'))
            else:
                try:
                    fv = float(v)
                    vec.append(fv)  # NaN preserved si set par apply_coverage_threshold
                except (TypeError, ValueError):
                    vec.append(float('nan'))

        # Exclure POI tout-zero ou tout-NaN
        non_nan = [v for v in vec if v == v]
        if not non_nan or all(v == 0 for v in non_nan):
            continue

        poi_ids.append(poi_id)
        rows.append(vec)
        coverage[poi_id] = {
            'n_carreaux':  int(p.get('n_carreaux') or 0),
            'n_total':     int(p.get('n_carreaux_total') or p.get('n_carreaux') or 0),
            'pop_totale':  float(p.get('population_totale') or 0),
            'cov_rate':    float(p.get('cov_rate') or 1.0),
        }

    if not poi_ids:
        return [], np.array([]), {}, {}

    X = np.array(rows, dtype=float)
    imputed_map: Dict[str, List[str]] = {pid: [] for pid in poi_ids}

    # Imputation mediane par feature
    for j, feat in enumerate(_feats):
        col = X[:, j]
        nan_mask = np.isnan(col)
        if not nan_mask.any():
            continue

        valid = col[~nan_mask]
        if len(valid) == 0:
            median_val = 0.0
            if log:
                log.warning(f"  {feat}: 100% NaN -> imputation par 0")
        else:
            median_val = float(np.median(valid))

        for idx in np.where(nan_mask)[0]:
            imputed_map[poi_ids[idx]].append(feat)

        X[nan_mask, j] = median_val

        if log:
            pct = nan_mask.sum() / len(col) * 100
            log.info(
                f"  Imputation {feat}: {nan_mask.sum()}/{len(col)} POI "
                f"({pct:.0f}% | mediane={median_val:.4f})"
            )

    return poi_ids, X, coverage, imputed_map


# -- Clustering pipeline ------------------------------------------------------

def train_clustering(
    X: np.ndarray,
    force_k: Optional[int],
    log: logging.Logger,
    feature_names: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Pipeline: StandardScaler -> PCA (85% variance, si >= 4 features) -> KMeans (K optimal).
    Si < 4 features : pas de PCA, clustering direct sur les features normalisees.
    """
    _feats = feature_names if feature_names is not None else FEATURE_NAMES
    n = X.shape[0]
    n_features = X.shape[1]
    log.info(f"Entrainement sur {n} POI x {n_features} features")

    scaler = StandardScaler()
    X_sc = scaler.fit_transform(X)

    # PCA seulement si >= 4 features (sinon inutile/instable)
    if n_features >= 4:
        pca = PCA(n_components=0.85, random_state=42)
        X_pca = pca.fit_transform(X_sc)
        n_comp = X_pca.shape[1]
        var_exp = float(np.sum(pca.explained_variance_ratio_))
        pca_components = pca.components_.tolist()
        pca_mean = pca.mean_.tolist()
        log.info(f"PCA: {n_comp} composantes -> {var_exp:.1%} variance expliquee")
    else:
        X_pca = X_sc
        n_comp = n_features
        var_exp = 1.0
        pca_components = np.eye(n_features).tolist()
        pca_mean = [0.0] * n_features
        log.info(f"PCA ignoree ({n_features} features < 4) — clustering direct sur features normalisees")

    if n < 3:
        raise RuntimeError(f"Pas assez de POI pour le clustering (n={n}, min=3)")

    if force_k:
        best_k = min(force_k, n - 1) if force_k >= n else force_k
        km = KMeans(n_clusters=best_k, random_state=42, n_init=10)
        labels = km.fit_predict(X_pca)
        best_score = float(silhouette_score(X_pca, labels)) if n > best_k else 0.0
        km_final = km
        log.info(f"K force={best_k}, silhouette={best_score:.4f}")
    else:
        k_max = min(10, n - 1)
        k_min = min(3, k_max)
        best_k, best_score, km_final = k_min, -1.0, None
        for k in range(k_min, k_max + 1):
            km = KMeans(n_clusters=k, random_state=42, n_init=10)
            lbl = km.fit_predict(X_pca)
            if len(set(lbl.tolist())) < 2:
                continue
            sc = float(silhouette_score(X_pca, lbl))
            log.debug(f"  K={k}: silhouette={sc:.4f}")
            if sc > best_score:
                best_k, best_score, km_final = k, sc, km
        if km_final is None:
            raise RuntimeError("Impossible d'entrainer le clustering (pas assez de POI?)")
        log.info(f"K optimal={best_k}, silhouette={best_score:.4f}")

    cluster_ids_arr = km_final.predict(X_pca)

    return {
        'k':                  best_k,
        'silhouette_score':   best_score,
        'n_pca_components':   n_comp,
        'variance_explained': var_exp,
        'feature_names':      _feats,
        'scaler_mean':        scaler.mean_.tolist(),
        'scaler_scale':       scaler.scale_.tolist(),
        'pca_components':     pca_components,
        'pca_mean':           pca_mean,
        'centroids':          km_final.cluster_centers_.tolist(),
        '_cluster_ids':       cluster_ids_arr,
        '_X_pca':             X_pca,
        '_X_orig':            X,
    }


def apply_model(
    X: np.ndarray,
    model: Dict,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Applique le modele persiste: scaler.transform -> PCA.transform -> predict.
    Utilise UNIQUEMENT transform(), jamais fit_transform().
    """
    s_mean    = np.array(model['scaler_mean'])
    s_scale   = np.array(model['scaler_scale'])
    p_comps   = np.array(model['pca_components'])
    p_mean    = np.array(model['pca_mean'])
    centroids = np.array(model['centroids'])

    X_sc  = (X - s_mean) / s_scale
    X_pca = (X_sc - p_mean) @ p_comps.T
    dists = np.linalg.norm(X_pca[:, np.newaxis] - centroids[np.newaxis], axis=2)
    cluster_ids = np.argmin(dists, axis=1)

    return cluster_ids, X_pca


# -- Cluster labels -----------------------------------------------------------

def generate_cluster_labels(
    cluster_ids: np.ndarray,
    X: np.ndarray,
    feature_names: Optional[List[str]] = None,
) -> Tuple[Dict[int, str], Dict[int, Dict]]:
    _feats = feature_names if feature_names is not None else FEATURE_NAMES
    global_avg = X.mean(axis=0)
    global_std = X.std(axis=0) + 1e-9
    cluster_labels: Dict[int, str] = {}
    cluster_avg_profiles: Dict[int, Dict] = {}

    for cid in sorted(set(cluster_ids.tolist())):
        mask = cluster_ids == cid
        avg = X[mask].mean(axis=0)
        cluster_avg_profiles[cid] = {
            feat: float(avg[i]) for i, feat in enumerate(_feats)
        }
        devs = [
            (_feats[i], float((avg[i] - global_avg[i]) / global_std[i]))
            for i in range(len(_feats))
        ]
        devs.sort(key=lambda x: abs(x[1]), reverse=True)
        parts = [
            (_LBL_POS if dev > 0 else _LBL_NEG).get(feat, feat)
            for feat, dev in devs[:3]
        ]
        cluster_labels[cid] = ' / '.join(parts) if parts else f'Cluster {cid}'

    return cluster_labels, cluster_avg_profiles


# -- Rapports console ---------------------------------------------------------

def print_report(
    cluster_ids: np.ndarray,
    cluster_labels: Dict[int, str],
    cluster_avg_profiles: Dict[int, Dict],
    model: Dict,
) -> None:
    sep = '=' * 72
    print(f"\n{sep}")
    print("  RAPPORT CLUSTERING POI FILOSOFI")
    print(f"  K={model['k']} | PCA {model['n_pca_components']} comp. "
          f"({model['variance_explained']:.1%} var.) | "
          f"Silhouette={model['silhouette_score']:.4f}")
    print(sep)
    unique, counts = np.unique(cluster_ids, return_counts=True)
    for cid, cnt in zip(unique.tolist(), counts.tolist()):
        label = cluster_labels.get(int(cid), f'Cluster {cid}')
        avg = cluster_avg_profiles.get(int(cid), {})
        print(f"\n  [CLUSTER {cid}] {label}  --  {cnt} POI")
        print(f"  {'-' * 68}")
        sorted_feats = sorted(
            ((f, float(avg.get(f, 0))) for f in FEATURE_NAMES),
            key=lambda x: abs(x[1]), reverse=True,
        )
        for feat, val in sorted_feats[:5]:
            bar_len = int(min(max(val, 0), 1) * 28) if val <= 1 else 28
            bar = '#' * bar_len + '.' * (28 - bar_len)
            print(f"    {feat:25s} {val:8.4f}  {bar}")
    print(f"\n{sep}\n")


def print_secret_stat_report(
    profiles: Dict[str, Dict],
    masked_per_poi: Dict[str, List[str]],
    imputed_map: Dict[str, List[str]],
    log: logging.Logger,
) -> None:
    """
    Phase 3 : rapport diagnostic du secret statistique.
    - Distribution des cov_rate par POI
    - Taux de zeros par feature (sur POI fiables)
    - Recap des imputations
    """
    if not profiles:
        return

    cov_rates = [float(p.get('cov_rate') or 1.0) for p in profiles.values()]
    n_unreliable = sum(1 for r in cov_rates if r < COVERAGE_THRESHOLD)
    sep = '-' * 72

    print(f"\n{sep}")
    print("  DIAGNOSTIC SECRET STATISTIQUE INSEE (Phase 3)")
    print(f"  {len(profiles)} POI | Seuil ind > {SECRET_STAT_SEUIL} | "
          f"Seuil fiabilite: cov_rate >= {COVERAGE_THRESHOLD:.0%}")
    print(sep)

    print(f"\n  Couverture par POI (carreaux inclus / total dans isochrone) :")
    if cov_rates:
        cov_arr = np.array(cov_rates)
        print(f"    min={cov_arr.min():.1%}  moy={cov_arr.mean():.1%}  "
              f"max={cov_arr.max():.1%}  med={float(np.median(cov_arr)):.1%}")
        buckets = [(0.3, 0.5, 'critique'), (0.5, 0.75, 'faible'), (0.75, 1.01, 'bon')]
        for lo, hi, label in buckets:
            n = sum(1 for r in cov_rates if lo <= r < hi)
            print(f"    [{lo:.0%}-{hi:.0%}[  {n:3d} POI  ({label})")
    print(f"    POI avec cov_rate < {COVERAGE_THRESHOLD:.0%} -> features NaN : {n_unreliable}")

    # Taux de zeros par feature sur POI fiables
    reliable_profiles = [p for p in profiles.values()
                         if float(p.get('cov_rate') or 1.0) >= COVERAGE_THRESHOLD]
    if reliable_profiles:
        print(f"\n  Taux de zeros par feature (sur {len(reliable_profiles)} POI fiables) :")
        for feat in FEATURE_NAMES:
            vals = [float(p.get(feat) or 0) for p in reliable_profiles
                    if p.get(feat) is not None and p.get(feat) == p.get(feat)]  # excl. NaN
            if vals:
                zero_pct = sum(1 for v in vals if v == 0.0) / len(vals) * 100
                flag = ' !! zero tres frequent' if zero_pct > 80 else ''
                if zero_pct > 0:
                    print(f"    {feat:25s}: {zero_pct:5.1f}% a zero{flag}")

    # Imputations
    all_imputed_feats: Dict[str, int] = {}
    for feats in imputed_map.values():
        for f in feats:
            all_imputed_feats[f] = all_imputed_feats.get(f, 0) + 1

    if all_imputed_feats:
        print(f"\n  Features imputees par mediane (cov_rate < {COVERAGE_THRESHOLD:.0%}) :")
        for feat, cnt in sorted(all_imputed_feats.items(), key=lambda x: -x[1]):
            print(f"    {feat:25s}: {cnt} POI imputes")
    else:
        print(f"\n  Aucune imputation -- tous les POI ont cov_rate >= {COVERAGE_THRESHOLD:.0%}")

    print(f"{sep}\n")


# -- Supabase persistence -----------------------------------------------------

def _next_model_version(sb: SupabaseClient) -> int:
    res = (
        sb.table(TABLE_MODELS)
        .select('version')
        .order('version', desc=True)
        .limit(1)
        .execute()
    )
    return (res.data[0]['version'] + 1) if res.data else 1


def persist_model(
    model: Dict,
    cluster_labels: Dict[int, str],
    cluster_avg_profiles: Dict[int, Dict],
    n_poi: int,
    duration: int,
    mode: str,
    sb: SupabaseClient,
    dry_run: bool,
    log: logging.Logger,
) -> int:
    version = _next_model_version(sb)
    feat_names = model['feature_names']
    feat_themes = themes_from_features(feat_names)
    payload = {
        'version':              version,
        'k':                    model['k'],
        'silhouette_score':     model['silhouette_score'],
        'n_pca_components':     model['n_pca_components'],
        'variance_explained':   model['variance_explained'],
        'feature_names':        feat_names,
        'feature_themes':       feat_themes if feat_themes else None,
        'scaler_mean':          model['scaler_mean'],
        'scaler_scale':         model['scaler_scale'],
        'pca_components':       model['pca_components'],
        'pca_mean':             model['pca_mean'],
        'centroids':            model['centroids'],
        'cluster_labels':       {str(k): v for k, v in cluster_labels.items()},
        'cluster_avg_profiles': {str(k): v for k, v in cluster_avg_profiles.items()},
        'n_poi_trained':        n_poi,
        'duration_minutes':     duration,
        'mode':                 mode,
    }
    if dry_run:
        log.info(f"[DRY-RUN] Modele v{version} non persiste (K={model['k']})")
        return version
    sb.table(TABLE_MODELS).insert(payload).execute()
    log.info(f"Modele v{version} persiste (K={model['k']}, sil={model['silhouette_score']:.4f})")
    return version


def load_latest_model(
    sb: SupabaseClient,
    duration: int,
    mode: str,
) -> Optional[Dict]:
    res = (
        sb.table(TABLE_MODELS)
        .select('*')
        .eq('duration_minutes', duration)
        .eq('mode', mode)
        .order('version', desc=True)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    m = res.data[0]
    m['cluster_labels'] = {
        int(k): v for k, v in (m.get('cluster_labels') or {}).items()
    }
    m['cluster_avg_profiles'] = {
        int(k): v for k, v in (m.get('cluster_avg_profiles') or {}).items()
    }
    return m


def _upsert_cluster(
    poi_id: str,
    cluster_id: int,
    cluster_label: str,
    pca_coords: List[float],
    profile: Dict,
    cluster_avg: Dict,
    n_carreaux: int,
    n_carreaux_total: int,
    pop_totale: float,
    cov_rate: float,
    model_version: int,
    duration: int,
    mode: str,
    imputed_features: List[str],
    sb: SupabaseClient,
    dry_run: bool,
) -> None:
    """
    Upsert POI cluster avec metadata de couverture (Phase 3).
    profile_features inclut les 16 features + cov_rate + n_carreaux_total.
    """
    # Stocker les features (NaN -> None/null en JSON)
    profile_feats: Dict[str, Any] = {}
    for k in FEATURE_NAMES:
        v = profile.get(k)
        if v is None:
            profile_feats[k] = None
        else:
            fv = float(v)
            profile_feats[k] = None if fv != fv else fv  # NaN -> None

    # Ajouter les metadonnees de couverture dans profile_features
    profile_feats['cov_rate']         = cov_rate
    profile_feats['n_carreaux_total'] = n_carreaux_total

    payload = {
        'poi_id':                     poi_id,
        'cluster_id':                 cluster_id,
        'cluster_label':              cluster_label,
        'pca_components':             pca_coords,
        'profile_features':           profile_feats,
        'cluster_avg_profile':        cluster_avg,
        'n_carreaux_intersected':     n_carreaux,
        'population_totale_couverte': pop_totale,
        'model_version':              model_version,
        'duration_minutes':           duration,
        'mode':                       mode,
        'imputed_features':           imputed_features,
        'updated_at':                 datetime.now(timezone.utc).isoformat(),
    }
    if not dry_run:
        sb.table(TABLE_CLUSTERS).upsert(
            payload, on_conflict='poi_id,duration_minutes,mode'
        ).execute()


# -- Phase 5 : historisation --------------------------------------------------

def compute_distance_to_centroid(
    pca_coords: List[float],
    centroids: List[List[float]],
    cluster_id: int,
) -> float:
    pt = np.array(pca_coords, dtype=float)
    ct = np.array(centroids[cluster_id], dtype=float)
    return float(np.linalg.norm(pt - ct))


def get_last_history_cluster(
    poi_id: str,
    sb: SupabaseClient,
    duration: int = 60,
    mode: str = 'drive',
) -> Optional[int]:
    """Retourne le dernier cluster_id connu pour ce POI/durée (None si première assignation)."""
    res = (
        sb.table(TABLE_HISTORY)
        .select('cluster_id')
        .eq('poi_id', poi_id)
        .eq('duration_minutes', duration)
        .eq('mode', mode)
        .order('created_at', desc=True)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    return int(res.data[0]['cluster_id'])


def _build_history_payload(
    poi_id: str,
    cluster_id: int,
    cluster_label: str,
    model_version: int,
    profile: Dict,
    pca_coords: List[float],
    centroids: List[List[float]],
    action: str,
    previous_cluster_id: Optional[int],
    changed: bool,
    duration: int = 60,
    mode: str = 'drive',
    feature_names: Optional[List[str]] = None,
) -> Dict:
    _feats = feature_names if feature_names is not None else FEATURE_NAMES
    profile_feats = {}
    for k in _feats:
        v = profile.get(k)
        if v is None:
            profile_feats[k] = None
        else:
            fv = float(v)
            profile_feats[k] = None if fv != fv else fv  # NaN -> None

    distance = compute_distance_to_centroid(pca_coords, centroids, cluster_id)
    return {
        'poi_id':               poi_id,
        'cluster_id':           cluster_id,
        'cluster_label':        cluster_label,
        'model_version':        model_version,
        'profile_features':     profile_feats,
        'pca_components':       pca_coords,
        'distance_to_centroid': round(distance, 6),
        'action':               action,
        'previous_cluster_id':  previous_cluster_id,
        'changed':              changed,
        'duration_minutes':     duration,   # Phase 9 : multi-durée
        'mode':                 mode,
    }


def insert_history_batch(
    payloads: List[Dict],
    sb: SupabaseClient,
    dry_run: bool,
    log: logging.Logger,
) -> None:
    if not payloads or dry_run:
        return
    # Insérer par batch de 100 pour éviter les timeouts
    for i in range(0, len(payloads), 100):
        sb.table(TABLE_HISTORY).insert(payloads[i:i+100]).execute()
    log.debug(f"Historique: {len(payloads)} lignes inserees")


def compute_cluster_mapping(
    old_assignments: Dict[str, int],
    new_assignments: Dict[str, int],
    old_k: int,
    new_k: int,
) -> Dict[int, int]:
    """
    Calcule la correspondance old_cluster -> new_cluster via algorithme hongrois
    (maximise le recouvrement des POI communs).
    Retourne {old_cluster_id: new_cluster_id}.
    """
    from scipy.optimize import linear_sum_assignment

    overlap = np.zeros((old_k, new_k), dtype=int)
    common = set(old_assignments.keys()) & set(new_assignments.keys())
    for pid in common:
        old_c = old_assignments[pid]
        new_c = new_assignments[pid]
        if 0 <= old_c < old_k and 0 <= new_c < new_k:
            overlap[old_c, new_c] += 1

    # Hungarian: minimiser -overlap (= maximiser overlap)
    row_ind, col_ind = linear_sum_assignment(-overlap)
    mapping = {int(r): int(c) for r, c in zip(row_ind, col_ind)}

    # Clusters anciens sans correspondance (old_k > new_k) : meilleur overlap
    for old_c in range(old_k):
        if old_c not in mapping:
            mapping[old_c] = int(np.argmax(overlap[old_c]))

    return mapping


# -- Mode: full-retrain -------------------------------------------------------

def _load_all_cached_isochrones(
    duration: int,
    mode: str,
    sb: SupabaseClient,
    log: logging.Logger,
    poi_types: Optional[List[str]] = None,
) -> List[Dict[str, str]]:
    """
    Cache-first : charge les isochrones battle depuis isochrones_cache.
    Retourne [{poi_id, categorie, cache_key, iso_geom_json}].
    poi_types : si fourni, ne garde que les entrees dont la categorie est dans la liste.
    """
    results = []
    offset = 0
    batch = 1000
    while True:
        res = (
            sb.table(TABLE_ISO_CACHE)
            .select('cache_key, geojson')
            .like('cache_key', 'battle__%')
            .eq('minutes', duration)
            .eq('mode', mode)
            .range(offset, offset + batch - 1)
            .execute()
        )
        rows = res.data or []
        for row in rows:
            key = row.get('cache_key', '')
            parts = key.split('__')
            if len(parts) < 5:
                continue
            categorie = parts[1]
            # Filtre par type de POI si demande
            if poi_types and categorie not in poi_types:
                continue
            poi_id = parts[2].replace('_', '-')
            geojson = row.get('geojson') or {}
            features = geojson.get('features') or []
            if not features:
                continue
            geom = features[0].get('geometry')
            if not geom:
                continue
            results.append({
                'poi_id':        poi_id,
                'categorie':     categorie,
                'cache_key':     key,
                'iso_geom_json': json.dumps(geom),
            })
        if len(rows) < batch:
            break
        offset += batch
    type_info = f" (types: {','.join(poi_types)})" if poi_types else ''
    log.info(f"{len(results)} entrees de cache battle {duration}min/{mode}{type_info} trouvees")
    return results


def run_full_retrain(
    duration: int,
    mode: str,
    force_k: Optional[int],
    dry_run: bool,
    verbose: bool,
    limit: Optional[int],
    log: logging.Logger,
    poi_types: Optional[List[str]] = None,
    feature_names: Optional[List[str]] = None,
) -> None:
    sb = get_supabase()

    # 1. Charger les isochrones depuis le cache
    log.info("Chargement des isochrones battle depuis isochrones_cache...")
    cached_entries = _load_all_cached_isochrones(duration, mode, sb, log, poi_types=poi_types)
    if limit:
        cached_entries = cached_entries[:limit]
        log.info(f"Limite: {limit} entrees")
    log.info(f"{len(cached_entries)} POI avec isochrone a traiter")

    if not cached_entries:
        log.error(
            f"Aucune isochrone battle en cache pour {duration}min/{mode}. "
            "Generez les isochrones via l'interface /map (bataille) d'abord."
        )
        return

    # 2. Calculer les profils (Phase 7 : batch RPC, fallback séquentiel)
    profiles: Dict[str, Dict] = {}
    masked_per_poi: Dict[str, List[str]] = {}
    skip_no_carreaux = 0
    skip_error = 0

    # Phase 7 : essayer le batch RPC compute_filosofi_profiles_batch
    log.info(f"Phase 7 — appel batch RPC pour {len(cached_entries)} POI...")
    t_batch_start = time.time()
    batch_result = compute_profiles_batch(cached_entries, sb, log)
    t_batch_total = time.time() - t_batch_start

    # POI résolus par le batch
    batch_poi_ids = set(batch_result.keys())
    # POI manquants dans la réponse batch -> fallback séquentiel
    missing_entries = [e for e in cached_entries if e['poi_id'] not in batch_poi_ids]

    if missing_entries:
        log.info(f"Fallback sequentiel pour {len(missing_entries)} POI non resolus par le batch")
        for i, entry in enumerate(missing_entries):
            poi_id = entry['poi_id']
            iso    = entry['iso_geom_json']
            try:
                profile = compute_profile(iso, sb)
            except Exception as exc:
                log.warning(f"Erreur profil {poi_id[:8]}: {exc}")
                skip_error += 1
                continue
            if profile is None:
                skip_no_carreaux += 1
                continue
            batch_result[poi_id] = profile

    # Appliquer seuil de couverture (Phase 3)
    for poi_id, profile in batch_result.items():
        profile, masked = apply_coverage_threshold(profile)
        if masked:
            log.warning(
                f"  {poi_id[:8]}: cov_rate={profile.get('cov_rate', 0):.1%} < "
                f"{COVERAGE_THRESHOLD:.0%} -> {len(masked)} features NaN"
            )
        profiles[poi_id] = profile
        masked_per_poi[poi_id] = masked

    log.info(
        f"Profils OK: {len(profiles)} | "
        f"sans carreaux: {skip_no_carreaux} | "
        f"erreurs: {skip_error} | "
        f"temps total batch: {t_batch_total:.1f}s"
    )

    if len(profiles) < 3:
        log.error(
            "Pas assez de POI avec profil (min 3). "
            "Verifiez que les isochrones battle 60min/drive sont en cache."
        )
        return

    # 3. Matrice de features (avec imputation mediane des NaN)
    _feat_names = feature_names if feature_names is not None else list(FEATURE_NAMES)
    if feature_names:
        log.info(f"Features selectionnees ({len(_feat_names)}) : {', '.join(_feat_names)}")
    poi_ids, X, coverage, imputed_map = profiles_to_matrix(profiles, log, feature_names=_feat_names)
    if len(poi_ids) < 3:
        log.error(
            f"Seulement {len(poi_ids)} POI avec vecteur valide apres filtrage. "
            "Verifiez COVERAGE_THRESHOLD ou augmentez le nombre de POI."
        )
        return
    log.info(f"Matrice: {X.shape[0]} POI x {X.shape[1]} features")

    # 4. Rapport secret statistique (Phase 3)
    print_secret_stat_report(profiles, masked_per_poi, imputed_map, log)

    # 5. Entrainer le clustering
    model = train_clustering(X, force_k=force_k, log=log, feature_names=_feat_names)
    cluster_ids_arr = model.pop('_cluster_ids')
    X_pca           = model.pop('_X_pca')
    X_orig          = model.pop('_X_orig')

    # 6. Labels descriptifs
    cluster_labels, cluster_avg_profiles = generate_cluster_labels(cluster_ids_arr, X_orig, feature_names=_feat_names)
    model['cluster_labels']       = cluster_labels
    model['cluster_avg_profiles'] = cluster_avg_profiles

    # 7. Rapport clustering
    print_report(cluster_ids_arr, cluster_labels, cluster_avg_profiles, model)

    # 8. Phase 5 : récupérer les anciens clusters pour le mapping hongrois
    old_model = load_latest_model(sb, duration, mode)
    old_assignments: Dict[str, int] = {}
    if old_model:
        old_res = (
            sb.table(TABLE_CLUSTERS)
            .select('poi_id, cluster_id')
            .eq('duration_minutes', duration)
            .eq('mode', mode)
            .execute()
        )
        old_assignments = {r['poi_id']: int(r['cluster_id']) for r in (old_res.data or [])}

    # 9. Persister le modele (version est incrémentée ici)
    version = persist_model(
        model, cluster_labels, cluster_avg_profiles,
        len(poi_ids), duration, mode, sb, dry_run, log,
    )

    # 10. Phase 5 : calculer le mapping hongrois entre anciens et nouveaux clusters
    cluster_mapping: Dict[int, int] = {}
    new_k = model['k']
    if old_model and old_assignments:
        old_k = int(old_model['k'])
        new_assignments_map = {poi_ids[i]: int(cluster_ids_arr[i]) for i in range(len(poi_ids))}
        cluster_mapping = compute_cluster_mapping(old_assignments, new_assignments_map, old_k, new_k)
        mapping_str = ', '.join(f'{o}->{n}' for o, n in sorted(cluster_mapping.items()))
        log.info(f"Mapping hongrois (old->new): {mapping_str}")
        # Stocker dans le modele
        if not dry_run:
            sb.table(TABLE_MODELS).update(
                {'cluster_mapping_from_previous': {str(k): v for k, v in cluster_mapping.items()}}
            ).eq('version', version).execute()

    # 11. Persister les clusters POI + historique
    log.info("Sauvegarde des clusters POI...")
    saved = 0
    history_payloads: List[Dict] = []
    centroids = model['centroids']

    for i, pid in enumerate(poi_ids):
        cid  = int(cluster_ids_arr[i])
        clbl = cluster_labels.get(cid, f'Cluster {cid}')
        cavg = cluster_avg_profiles.get(cid, {})
        cov  = coverage[pid]
        pca_coords = X_pca[i].tolist()
        try:
            _upsert_cluster(
                pid, cid, clbl, pca_coords,
                profiles[pid], cavg,
                cov['n_carreaux'], cov['n_total'],
                cov['pop_totale'], cov['cov_rate'],
                version, duration, mode,
                imputed_map.get(pid, []),
                sb, dry_run,
            )
            saved += 1
        except Exception as exc:
            log.warning(f"UPSERT {pid[:8]}: {exc}")
            continue

        # Historique Phase 5
        old_cid = old_assignments.get(pid)
        if old_cid is not None and cluster_mapping:
            # Comparer l'ancien cluster mappé au nouveau
            mapped_new = cluster_mapping.get(old_cid, old_cid)
            changed = (mapped_new != cid)
        else:
            changed = False  # première assignation

        history_payloads.append(_build_history_payload(
            pid, cid, clbl, version, profiles[pid], pca_coords,
            centroids, 'full-retrain', old_cid, changed,
            duration=duration, mode=mode,
            feature_names=_feat_names,
        ))

    insert_history_batch(history_payloads, sb, dry_run, log)

    prefix = '[DRY-RUN] ' if dry_run else ''
    log.info(f"{prefix}{saved}/{len(poi_ids)} POI sauvegardes dans {TABLE_CLUSTERS}")
    log.info(f"{prefix}{len(history_payloads)} lignes dans {TABLE_HISTORY}")

    # Phase 10 : checks de sanite automatiques
    run_sanity_checks(
        cluster_ids_arr=cluster_ids_arr,
        X_pca=X_pca,
        X_orig=X_orig,
        poi_ids=poi_ids,
        coverage=coverage,
        model=model,
        cluster_labels=cluster_labels,
        cluster_avg_profiles=cluster_avg_profiles,
        model_version=version,
        duration=duration,
        mode=mode,
        sb=sb,
        verbose=verbose,
        dry_run=dry_run,
        log=log,
    )


# -- Mode: assign-new ---------------------------------------------------------

def run_assign_new(
    duration: int,
    mode: str,
    dry_run: bool,
    verbose: bool,
    log: logging.Logger,
    poi_types: Optional[List[str]] = None,
) -> None:
    sb = get_supabase()

    model = load_latest_model(sb, duration, mode)
    if not model:
        log.error(f"Aucun modele pour {duration}min/{mode}. Lancer --mode full-retrain.")
        return
    log.info(f"Modele v{model['version']} charge (K={model['k']}, "
             f"sil={model['silhouette_score']:.4f})")

    all_res = sb.table(TABLE_POI).select('id, categorie').execute()
    all_pois_raw = {p['id']: p.get('categorie') or POI_CAT_DEFAULT for p in (all_res.data or [])}
    if poi_types:
        all_pois = {pid: cat for pid, cat in all_pois_raw.items() if cat in poi_types}
        log.info(f"Filtre poi_types={poi_types}: {len(all_pois)}/{len(all_pois_raw)} POI retenus")
    else:
        all_pois = all_pois_raw
    existing_res = (
        sb.table(TABLE_CLUSTERS)
        .select('poi_id')
        .eq('duration_minutes', duration)
        .eq('mode', mode)
        .execute()
    )
    existing = {r['poi_id'] for r in (existing_res.data or [])}
    new_pois = [(pid, cat) for pid, cat in all_pois.items() if pid not in existing]
    log.info(f"{len(new_pois)} nouveaux POI a assigner")
    if not new_pois:
        log.info("Aucun nouveau POI -- rien a faire.")
        return

    profiles: Dict[str, Dict] = {}
    masked_per_poi: Dict[str, List[str]] = {}
    for i, (pid, categorie) in enumerate(new_pois):
        log.info(f"[{i+1}/{len(new_pois)}] {pid[:8]}...")
        iso = get_isochrone_geom_json(pid, categorie, duration, mode, sb, log)
        if iso is None:
            continue
        try:
            profile = compute_profile(iso, sb)
        except Exception as exc:
            log.warning(f"Erreur profil {pid[:8]}: {exc}")
            continue
        if profile:
            profile, masked = apply_coverage_threshold(profile)
            if masked:
                log.warning(f"  {pid[:8]}: cov_rate={profile.get('cov_rate', 0):.1%} < {COVERAGE_THRESHOLD:.0%}")
            profiles[pid] = profile
            masked_per_poi[pid] = masked

    if not profiles:
        log.info("Aucun profil calcule.")
        return

    # Appliquer le modele (transform -- jamais fit_transform)
    poi_ids, X, coverage, imputed_map = profiles_to_matrix(profiles, log)

    if len(imputed_map) and any(imputed_map.values()):
        log.info("Imputations effectuees (voir detail ci-dessus)")

    cluster_ids, X_pca = apply_model(X, model)
    cluster_labels       = model['cluster_labels']
    cluster_avg_profiles = model['cluster_avg_profiles']

    # Detection de drift
    centroids = np.array(model['centroids'])
    min_dists = np.min(
        np.linalg.norm(X_pca[:, np.newaxis] - centroids[np.newaxis], axis=2), axis=1
    )
    if len(min_dists) > 0:
        mean_d, std_d = float(min_dists.mean()), float(min_dists.std())
        far_pct = float((min_dists > mean_d + 2 * std_d).sum()) / len(min_dists)
        if far_pct > 0.3:
            log.warning(
                f"DRIFT: {far_pct:.0%} des nouveaux POI loin des centroids "
                "-- envisager --mode full-retrain"
            )

    saved = 0
    history_payloads: List[Dict] = []
    centroids_an = model['centroids']

    for i, pid in enumerate(poi_ids):
        cid  = int(cluster_ids[i])
        clbl = cluster_labels.get(cid, f'Cluster {cid}')
        cavg = cluster_avg_profiles.get(cid, {})
        cov  = coverage[pid]
        pca_coords = X_pca[i].tolist()
        try:
            _upsert_cluster(
                pid, cid, clbl, pca_coords,
                profiles[pid], cavg,
                cov['n_carreaux'], cov['n_total'],
                cov['pop_totale'], cov['cov_rate'],
                model['version'], duration, mode,
                imputed_map.get(pid, []),
                sb, dry_run,
            )
            saved += 1
        except Exception as exc:
            log.warning(f"UPSERT {pid[:8]}: {exc}")
            continue

        # Historique Phase 5
        prev_cid = get_last_history_cluster(pid, sb, duration=duration, mode=mode)
        changed = (prev_cid is not None and prev_cid != cid)
        history_payloads.append(_build_history_payload(
            pid, cid, clbl, model['version'], profiles[pid], pca_coords,
            centroids_an, 'assign-new', prev_cid, changed,
            duration=duration, mode=mode,
        ))

    insert_history_batch(history_payloads, sb, dry_run, log)

    unique, counts = np.unique(cluster_ids, return_counts=True)
    log.info("Repartition par cluster:")
    for cid, cnt in zip(unique.tolist(), counts.tolist()):
        log.info(f"  Cluster {cid} ({cluster_labels.get(int(cid), '?')}): {cnt} POI")
    prefix = '[DRY-RUN] ' if dry_run else ''
    log.info(f"{prefix}{saved}/{len(poi_ids)} POI assignes")


# -- Mode: update-affected ----------------------------------------------------

def run_update_affected(
    since: str,
    duration: int,
    mode: str,
    dry_run: bool,
    verbose: bool,
    log: logging.Logger,
    poi_types: Optional[List[str]] = None,
) -> None:
    sb = get_supabase()

    model = load_latest_model(sb, duration, mode)
    if not model:
        log.error("Aucun modele. Lancer --mode full-retrain.")
        return
    log.info(f"Modele v{model['version']} charge")

    existing_res = (
        sb.table(TABLE_CLUSTERS)
        .select('poi_id')
        .eq('duration_minutes', duration)
        .eq('mode', mode)
        .execute()
    )
    existing_pois = [r['poi_id'] for r in (existing_res.data or [])]
    poi_cat_res = sb.table(TABLE_POI).select('id, categorie').execute()
    poi_cat_map = {p['id']: p.get('categorie') or POI_CAT_DEFAULT for p in (poi_cat_res.data or [])}
    # Filtrer par type si demande
    if poi_types:
        existing_pois = [pid for pid in existing_pois
                         if poi_cat_map.get(pid, POI_CAT_DEFAULT) in poi_types]
        log.info(f"Filtre poi_types={poi_types}: {len(existing_pois)} POI retenus")

    log.info(f"Verification de {len(existing_pois)} POI pour impact...")
    affected: List[Tuple[str, str, str]] = []
    for pid in existing_pois:
        cat = poi_cat_map.get(pid, POI_CAT_DEFAULT)
        iso = get_isochrone_geom_json(pid, cat, duration, mode, sb, log)
        if iso is None:
            continue
        try:
            hit = check_iso_hits_new_carreaux(iso, since, sb)
        except Exception as exc:
            log.warning(f"check_iso {pid[:8]}: {exc}")
            continue
        if hit:
            affected.append((pid, cat, iso))

    log.info(f"{len(affected)} POI impactes par nouveaux carreaux depuis {since}")
    if not affected:
        return

    profiles: Dict[str, Dict] = {}
    for pid, cat, iso in affected:
        try:
            profile = compute_profile(iso, sb)
        except Exception as exc:
            log.warning(f"Erreur profil {pid[:8]}: {exc}")
            continue
        if profile:
            profile, masked = apply_coverage_threshold(profile)
            profiles[pid] = profile

    if not profiles:
        return

    poi_ids, X, coverage, imputed_map = profiles_to_matrix(profiles, log)
    cluster_ids, X_pca = apply_model(X, model)
    cluster_labels       = model['cluster_labels']
    cluster_avg_profiles = model['cluster_avg_profiles']

    old_res = (
        sb.table(TABLE_CLUSTERS)
        .select('poi_id, cluster_id')
        .in_('poi_id', list(profiles.keys()))
        .eq('duration_minutes', duration)
        .eq('mode', mode)
        .execute()
    )
    old_clusters = {r['poi_id']: r['cluster_id'] for r in (old_res.data or [])}

    saved = changed_count = 0
    history_payloads: List[Dict] = []
    centroids_ua = model['centroids']

    for i, pid in enumerate(poi_ids):
        new_cid = int(cluster_ids[i])
        old_cid = old_clusters.get(pid, -1)
        if old_cid != new_cid:
            changed_count += 1
            log.info(f"  {pid[:8]}: cluster {old_cid if old_cid != -1 else '?'} -> {new_cid}")
        clbl = cluster_labels.get(new_cid, f'Cluster {new_cid}')
        cavg = cluster_avg_profiles.get(new_cid, {})
        cov  = coverage[pid]
        pca_coords = X_pca[i].tolist()
        try:
            _upsert_cluster(
                pid, new_cid, clbl, pca_coords,
                profiles[pid], cavg,
                cov['n_carreaux'], cov['n_total'],
                cov['pop_totale'], cov['cov_rate'],
                model['version'], duration, mode,
                imputed_map.get(pid, []),
                sb, dry_run,
            )
            saved += 1
        except Exception as exc:
            log.warning(f"UPSERT {pid[:8]}: {exc}")
            continue

        # Historique Phase 5
        prev_cid = get_last_history_cluster(pid, sb, duration=duration, mode=mode)
        hist_changed = (prev_cid is not None and prev_cid != new_cid)
        history_payloads.append(_build_history_payload(
            pid, new_cid, clbl, model['version'], profiles[pid], pca_coords,
            centroids_ua, 'update-affected', prev_cid, hist_changed,
            duration=duration, mode=mode,
        ))

    insert_history_batch(history_payloads, sb, dry_run, log)

    prefix = '[DRY-RUN] ' if dry_run else ''
    log.info(
        f"{prefix}{len(affected)} POI analyses | "
        f"{saved} recalcules | {changed_count} ont change de cluster"
    )


# -- Phase 10 : checks de sanite automatiques ---------------------------------

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance orthodromique en km entre deux points GPS."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(max(0.0, min(1.0, a))))


def run_sanity_checks(
    cluster_ids_arr:      np.ndarray,
    X_pca:                np.ndarray,
    X_orig:               np.ndarray,
    poi_ids:              List[str],
    coverage:             Dict[str, Dict],
    model:                Dict,
    cluster_labels:       Dict[int, str],
    cluster_avg_profiles: Dict[int, Dict],
    model_version:        int,
    duration:             int,
    mode:                 str,
    sb:                   'SupabaseClient',
    verbose:              bool,
    dry_run:              bool,
    log:                  logging.Logger,
) -> None:
    """
    Phase 10 : 9 checks de sanite apres full-retrain.
    Affiche un rapport structure en console.
    Ecrit optionnellement dans clustering_sanity_reports.
    """
    SEP = '=' * 54
    n_poi = len(poi_ids)
    k     = model['k']

    # Chaque check : {id, icon, label, detail, lines, ok, warn}
    checks: List[Dict] = []

    def add_check(
        cid:    int,
        icon:   str,   # 'OK' | 'WARN' | 'INFO'
        label:  str,
        detail: str,
        lines:  Optional[List[str]] = None,
        ok:     bool = True,
        warn:   bool = False,
    ) -> None:
        checks.append({
            'id': cid, 'icon': icon, 'label': label,
            'detail': detail, 'lines': lines or [],
            'ok': ok, 'warn': warn,
        })

    # ── CHECK 1 — Taille des clusters ─────────────────────────────────────────
    unique_ids, counts = np.unique(cluster_ids_arr, return_counts=True)
    min_sz  = int(counts.min())
    max_sz  = int(counts.max())
    ratio   = max_sz / max(min_sz, 1)
    c1_too_small   = min_sz < 2
    c1_too_dominant = max_sz > n_poi * 0.6
    c1_warn = ratio > 5

    if not c1_too_small and not c1_too_dominant and not c1_warn:
        add_check(1, 'OK', 'CHECK 1 — Taille clusters',
                  f'OK (min={min_sz}, max={max_sz}, ratio={ratio:.1f})')
    elif c1_too_small or c1_too_dominant:
        parts = []
        if c1_too_small:
            parts.append(f'cluster avec {min_sz} POI (min requis: 2)')
        if c1_too_dominant:
            parts.append(f'cluster dominant: {max_sz}/{n_poi} POI ({max_sz/n_poi:.0%} > 60%)')
        add_check(1, 'WARN', 'CHECK 1 — Taille clusters',
                  ' | '.join(parts), ok=False, warn=True)
    else:
        add_check(1, 'WARN', 'CHECK 1 — Taille clusters',
                  f'Repartition desequilibree (ratio={ratio:.1f} > 5, min={min_sz}, max={max_sz})',
                  ok=True, warn=True)

    # ── CHECK 2 — Silhouette individuel ───────────────────────────────────────
    if k >= 2 and n_poi >= 4:
        try:
            sil_arr = silhouette_samples(X_pca, cluster_ids_arr)
            n_neg   = int((sil_arr < 0).sum())
            pct_neg = n_neg / n_poi * 100
            c2_warn = pct_neg > 20
            detail2 = (f'WARNING: {pct_neg:.0f}% de POI mal classes (> 20%) -- clusters instables'
                       if c2_warn else f'OK ({pct_neg:.0f}% de POI mal classes)')
            lines2: List[str] = []
            if verbose and c2_warn:
                neg_idx = np.where(sil_arr < 0)[0]
                for idx in neg_idx[:10]:
                    lines2.append(
                        f'  POI mal classe: {poi_ids[idx][:8]} '
                        f'(sil={sil_arr[idx]:.3f}, cluster={cluster_ids_arr[idx]})'
                    )
            add_check(2, 'WARN' if c2_warn else 'OK', 'CHECK 2 — Silhouette individuel',
                      detail2, lines=lines2, ok=not c2_warn, warn=c2_warn)
        except Exception as exc:
            add_check(2, 'INFO', 'CHECK 2 — Silhouette individuel', f'Non calcule ({exc})')
    else:
        add_check(2, 'INFO', 'CHECK 2 — Silhouette individuel',
                  f'Non calcule (k={k}, n_poi={n_poi})')

    # ── CHECK 3 — Silhouette global ───────────────────────────────────────────
    sil_g = model['silhouette_score']
    if sil_g < 0.25:
        add_check(3, 'WARN', 'CHECK 3 — Silhouette global',
                  f'{sil_g:.4f} -- structure faible, envisager K different', ok=False, warn=True)
    elif sil_g < 0.50:
        add_check(3, 'OK', 'CHECK 3 — Silhouette global', f'{sil_g:.4f} (structure raisonnable)')
    elif sil_g < 0.70:
        add_check(3, 'OK', 'CHECK 3 — Silhouette global', f'{sil_g:.4f} (structure forte)')
    else:
        add_check(3, 'INFO', 'CHECK 3 — Silhouette global',
                  f'{sil_g:.4f} -- possible sur-segmentation ou donnees homogenes')

    # ── CHECK 4 — Stabilite bootstrap ─────────────────────────────────────────
    try:
        boot_labels = []
        for seed in range(5):
            km_b   = KMeans(n_clusters=k, random_state=seed * 7 + 1, n_init=10)
            lbl_b  = km_b.fit_predict(X_pca)
            boot_labels.append(lbl_b)

        aris = [
            adjusted_rand_score(boot_labels[i], boot_labels[j])
            for i in range(len(boot_labels))
            for j in range(i + 1, len(boot_labels))
        ]
        ari_mean = float(np.mean(aris))

        if ari_mean >= 0.85:
            add_check(4, 'OK', 'CHECK 4 — Stabilite bootstrap',
                      f'ARI={ari_mean:.3f} (stable)')
        elif ari_mean >= 0.70:
            add_check(4, 'WARN', 'CHECK 4 — Stabilite bootstrap',
                      f'ARI={ari_mean:.3f} (limite)', ok=True, warn=True)
        else:
            add_check(4, 'WARN', 'CHECK 4 — Stabilite bootstrap',
                      f'ARI={ari_mean:.3f} -- resultats instables, clustering non robuste',
                      ok=False, warn=True)
    except Exception as exc:
        add_check(4, 'INFO', 'CHECK 4 — Stabilite bootstrap', f'Non calcule ({exc})')
        ari_mean = 0.0

    # ── CHECK 5 — Variance PCA ────────────────────────────────────────────────
    var_pct = model['variance_explained'] * 100
    n_comp  = model['n_pca_components']
    if var_pct < 60:
        add_check(5, 'WARN', 'CHECK 5 — Variance PCA',
                  f'{var_pct:.0f}% sur {n_comp} comp. -- features trop heterogenes',
                  ok=False, warn=True)
    elif var_pct > 95:
        add_check(5, 'INFO', 'CHECK 5 — Variance PCA',
                  f'{var_pct:.0f}% sur {n_comp} comp. -- peu de features utiles, PCA peut-etre inutile')
    else:
        add_check(5, 'OK', 'CHECK 5 — Variance PCA',
                  f'{var_pct:.0f}% sur {n_comp} composantes')

    # ── CHECKs 6 & 7 — Coherence spatiale (necessite lat/lng) ────────────────
    poi_coords: Dict[str, Tuple[float, float]] = {}
    try:
        for i_b in range(0, len(poi_ids), 200):
            chunk = poi_ids[i_b:i_b + 200]
            res_c = sb.table(TABLE_POI).select('id, lat, lng').in_('id', chunk).execute()
            for r in (res_c.data or []):
                pid_r = str(r.get('id', ''))
                lat_r = float(r.get('lat') or 0)
                lng_r = float(r.get('lng') or 0)
                if pid_r and lat_r and lng_r:
                    poi_coords[pid_r] = (lat_r, lng_r)
    except Exception as exc:
        log.debug(f'Impossible de charger lat/lng pour checks geo: {exc}')

    pid_to_cluster = {poi_ids[idx]: int(cluster_ids_arr[idx]) for idx in range(n_poi)}
    poi_idx_map    = {poi_ids[idx]: idx for idx in range(n_poi)}

    if len(poi_coords) >= 3:
        # ── CHECK 6 ───────────────────────────────────────────────────────────
        geo_details: List[str] = []
        for cid_g in sorted(set(cluster_ids_arr.tolist())):
            pids_c = [poi_ids[i] for i in np.where(cluster_ids_arr == cid_g)[0]
                      if poi_ids[i] in poi_coords]
            if len(pids_c) < 2:
                continue
            coords_c = [poi_coords[p] for p in pids_c]
            dists_c  = [
                _haversine_km(coords_c[ii][0], coords_c[ii][1],
                              coords_c[jj][0], coords_c[jj][1])
                for ii in range(len(coords_c))
                for jj in range(ii + 1, len(coords_c))
            ]
            avg_d = float(np.mean(dists_c)) if dists_c else 0.0
            lbl_g = cluster_labels.get(int(cid_g), f'Cluster {cid_g}')
            geo_details.append(f'C{cid_g} ({lbl_g[:18]}): {avg_d:.0f}km moy.')
        add_check(6, 'INFO', 'CHECK 6 — Coherence spatiale',
                  ' | '.join(geo_details) if geo_details else 'Insuffisant')

        # ── CHECK 7 ───────────────────────────────────────────────────────────
        NEAR_KM = 50.0
        geo_list = [(pid, poi_coords[pid]) for pid in poi_ids if pid in poi_coords]
        close_pairs: List[Tuple] = []
        for ii in range(len(geo_list)):
            for jj in range(ii + 1, len(geo_list)):
                pid_a, (la, lna) = geo_list[ii]
                pid_b, (lb, lnb) = geo_list[jj]
                if pid_to_cluster.get(pid_a) == pid_to_cluster.get(pid_b):
                    continue
                d_km = _haversine_km(la, lna, lb, lnb)
                if d_km >= NEAR_KM:
                    continue
                ia = poi_idx_map.get(pid_a)
                ib = poi_idx_map.get(pid_b)
                if ia is None or ib is None:
                    continue
                feat_deltas = sorted(
                    [(FEATURE_NAMES[fi],
                      float(X_orig[ia, fi]),
                      float(X_orig[ib, fi]),
                      abs(float(X_orig[ia, fi]) - float(X_orig[ib, fi])))
                     for fi in range(len(FEATURE_NAMES))],
                    key=lambda x: -x[3],
                )
                close_pairs.append((d_km, pid_a, pid_b,
                                    pid_to_cluster.get(pid_a),
                                    pid_to_cluster.get(pid_b),
                                    feat_deltas[:3]))

        close_pairs.sort(key=lambda x: x[0])

        if not close_pairs:
            add_check(7, 'OK', 'CHECK 7 — POI voisins en clusters differents',
                      f'Aucune paire < {NEAR_KM:.0f}km dans des clusters differents')
        else:
            pair_lines: List[str] = []
            for pair in close_pairs[:5]:
                d_km, pid_a, pid_b, ca, cb, top3 = pair
                feat, va, vb, delta = top3[0]
                sign = '+' if va >= vb else '-'
                pair_lines.append(
                    f'  -> {pid_a[:8]}/{pid_b[:8]} ({d_km:.0f}km, C{ca} vs C{cb}): '
                    f'{feat}={sign}{delta*100:.1f}% ({va*100:.1f}% vs {vb*100:.1f}%)'
                )
                if len(top3) > 1:
                    f2, va2, vb2, d2 = top3[1]
                    s2 = '+' if va2 >= vb2 else '-'
                    pair_lines.append(
                        f'              {f2}={s2}{d2*100:.1f}%'
                        f' ({va2*100:.1f}% vs {vb2*100:.1f}%)'
                    )
            add_check(7, 'WARN', 'CHECK 7 — POI voisins en clusters differents',
                      f'{len(close_pairs)} paire(s) < {NEAR_KM:.0f}km dans des clusters differents',
                      lines=pair_lines, ok=True, warn=True)
    else:
        add_check(6, 'INFO', 'CHECK 6 — Coherence spatiale',
                  'Non calcule (lat/lng indisponibles)')
        add_check(7, 'INFO', 'CHECK 7 — POI voisins en clusters differents',
                  'Non calcule (lat/lng indisponibles)')
        close_pairs = []

    # ── CHECK 8 — Qualite des profils ─────────────────────────────────────────
    cov_rates = [coverage[pid]['cov_rate'] for pid in poi_ids if pid in coverage]
    if cov_rates:
        avg_cov  = float(np.mean(cov_rates))
        min_cov  = float(np.min(cov_rates))
        n_low70  = sum(1 for r in cov_rates if r < 0.70)
        n_low50  = sum(1 for r in cov_rates if r < 0.50)
        detail8  = f'{avg_cov*100:.0f}% en moyenne (min={min_cov*100:.0f}%)'
        if n_low50 > 0:
            detail8 += f' -- {n_low50} POI < 50% (profil non fiable)'
            add_check(8, 'WARN', 'CHECK 8 — Couverture donnees',
                      detail8, ok=False, warn=True)
        elif n_low70 > 0:
            detail8 += f' -- {n_low70} POI < 70% (donnees lacunaires)'
            add_check(8, 'WARN', 'CHECK 8 — Couverture donnees',
                      detail8, ok=True, warn=True)
        else:
            add_check(8, 'OK', 'CHECK 8 — Couverture donnees', detail8)
    else:
        add_check(8, 'INFO', 'CHECK 8 — Couverture donnees', 'Non calcule')
        avg_cov = min_cov = 0.0

    # ── CHECK 9 — Carreaux par POI ────────────────────────────────────────────
    n_carr_list = [coverage[pid]['n_carreaux'] for pid in poi_ids if pid in coverage]
    if n_carr_list:
        arr_c  = np.array(n_carr_list)
        med_c  = int(np.median(arr_c))
        min_c  = int(arr_c.min())
        max_c  = int(arr_c.max())
        q1_c   = int(np.percentile(arr_c, 25))
        q3_c   = int(np.percentile(arr_c, 75))
        n_low  = int((arr_c < 100).sum())
        detail9 = (f'mediane={med_c:,} (min={min_c:,}, max={max_c:,}, '
                   f'Q1={q1_c:,}, Q3={q3_c:,})')
        if n_low > 0:
            detail9 += f' -- {n_low} POI < 100 carreaux (bassin trop petit)'
            add_check(9, 'WARN', 'CHECK 9 — Carreaux par POI',
                      detail9, ok=True, warn=True)
        else:
            add_check(9, 'OK', 'CHECK 9 — Carreaux par POI', detail9)
    else:
        add_check(9, 'INFO', 'CHECK 9 — Carreaux par POI', 'Non calcule')
        med_c = min_c = max_c = q1_c = q3_c = 0

    # ── Rapport console ───────────────────────────────────────────────────────
    ICONS = {'OK': '\u2705', 'WARN': '\u26a0\ufe0f', 'INFO': '\u2139\ufe0f'}

    print(f'\n{SEP}')
    print(f'  RAPPORT DE SANTE -- Clustering v{model_version} ({duration}min/{mode})')
    print(SEP)
    for c in checks:
        sym = ICONS.get(c['icon'], c['icon'])
        print(f'  {sym} {c["label"]} : {c["detail"]}')
        if verbose or c['warn']:
            for line in c['lines']:
                print(line)
    print(SEP)

    n_ok   = sum(1 for c in checks if c['ok'] and not c['warn'])
    n_warn = sum(1 for c in checks if c['warn'])
    total  = len(checks)
    bilan_ok = sum(1 for c in checks if c['ok'])
    print(f'  BILAN : {bilan_ok}/{total} OK, {n_warn} warning(s)')
    if n_warn == 0:
        print('  => Clustering robuste et exploitable')
    elif n_warn <= 2:
        print('  => Clustering exploitable avec reservations mineures')
    else:
        print('  => Clustering a revoir -- trop de warnings')
    print(f'{SEP}\n')

    # ── Persistance Supabase (optionnel) ──────────────────────────────────────
    # Necessite la table clustering_sanity_reports :
    #   CREATE TABLE clustering_sanity_reports (
    #     id SERIAL PRIMARY KEY, model_version INT, duration_minutes INT,
    #     mode TEXT, n_ok INT, n_warn INT, checks JSONB,
    #     created_at TIMESTAMPTZ DEFAULT NOW()
    #   );
    if not dry_run:
        try:
            payload_sanity = {
                'model_version':    model_version,
                'duration_minutes': duration,
                'mode':             mode,
                'n_ok':             bilan_ok,
                'n_warn':           n_warn,
                'checks':           [
                    {k: v for k, v in c.items() if k != 'lines'}
                    for c in checks
                ],
            }
            sb.table(TABLE_SANITY).insert(payload_sanity).execute()
            log.debug(f'Rapport sanite persiste dans {TABLE_SANITY}')
        except Exception:
            pass  # table optionnelle — ignorer si absente


# -- Mode: fix-geometries -----------------------------------------------------

def run_fix_geometries(dry_run: bool, log: logging.Logger) -> None:
    """
    Phase 8 : nettoyage rétroactif des géométries invalides dans isochrones_cache.
    Appelle repair_iso_cache_geoms() via RPC Supabase.
    Affiche le rapport : X scannées, Y invalides, Z réparées.
    """
    sb = get_supabase()
    sep = '=' * 72

    log.info("Scan des geometries isochrones en cache (ST_IsValid)...")

    if dry_run:
        # En dry-run : compter seulement, sans réparer
        res = sb.rpc('count_invalid_iso_geoms', {}).execute()
        stats = (res.data[0] if isinstance(res.data, list) else res.data) or {}
        n_total   = int(stats.get('n_total',   0))
        n_invalid = int(stats.get('n_invalid', 0))
        print(f"\n{sep}")
        print("  RAPPORT FIX-GEOMETRIES [DRY-RUN]")
        print(sep)
        print(f"  Isochrones scannees : {n_total}")
        print(f"  Geometries invalides: {n_invalid}")
        print(f"  Reparation         : [DRY-RUN] non appliquee")
        print(f"{sep}\n")
        return

    # Appel RPC repair (ST_MakeValid + ST_CollectionExtract + Buffer(0) fallback)
    log.info("Application ST_MakeValid + ST_CollectionExtract(polygones) + Buffer(0) fallback...")
    try:
        res = sb.rpc('repair_iso_cache_geoms', {}).execute()
    except Exception as exc:
        log.error(f"repair_iso_cache_geoms RPC echoue: {exc}")
        return

    data = res.data
    if isinstance(data, list):
        data = data[0] if data else {}
    stats = data or {}

    n_scanned  = int(stats.get('n_scanned',  0))
    n_invalid  = int(stats.get('n_invalid',  0))
    n_repaired = int(stats.get('n_repaired', 0))
    n_failed   = int(stats.get('n_failed',   0))

    print(f"\n{sep}")
    print("  RAPPORT FIX-GEOMETRIES — Phase 8")
    print(sep)
    print(f"  Isochrones scannees  : {n_scanned}")
    print(f"  Geometries invalides : {n_invalid}")
    print(f"  Reparees             : {n_repaired}")
    print(f"  Echecs               : {n_failed}")
    if n_invalid == 0:
        print(f"\n  OK — toutes les geometries sont valides (ST_IsValid)")
    elif n_repaired == n_invalid:
        print(f"\n  OK — toutes les geometries invalides ont ete reparees")
    else:
        print(f"\n  ATTENTION — {n_failed} geometrie(s) non reparees")
        print(f"  → Ces POI seront exclus du clustering (profil=None)")
    print(f"{sep}\n")


# -- Mode: recon-secret-stat --------------------------------------------------

def run_recon_secret_stat(log: logging.Logger) -> None:
    """
    Phase 3 : diagnostic global du secret statistique INSEE.
    Appelle get_filosofi_secret_stat_diagnostic() sur echantillon 10%.
    """
    sb = get_supabase()
    log.info("Diagnostic secret statistique (echantillon 10% des carreaux)...")
    try:
        res = sb.rpc(
            'get_filosofi_secret_stat_diagnostic',
            {'p_secret_stat': float(SECRET_STAT_SEUIL)},
        ).execute()
        row = res.data[0] if isinstance(res.data, list) else res.data
    except Exception as exc:
        log.error(f"Erreur RPC diagnostic: {exc}")
        return

    sep = '=' * 72
    print(f"\n{sep}")
    print("  DIAGNOSTIC GLOBAL CARREAUX FILOSOFI -- SECRET STATISTIQUE INSEE")
    print(sep)
    print(f"  {row.get('note', '')}")
    print(f"  Echantillon  : {row.get('n_echantillon', '?'):>10} carreaux")
    print(f"  Inclus       : {row.get('n_inclus', '?'):>10} carreaux (ind > {SECRET_STAT_SEUIL})")
    print(f"  Secret stat  : {row.get('n_secret_stat', '?'):>10} carreaux "
          f"({row.get('pct_secret_stat', '?')}% -- exclus du calcul de profil)")

    print(f"\n  Taux de NULL sur carreaux inclus (ind > {SECRET_STAT_SEUIL}) :")
    fields = [
        ('pct_null_age',      'Variables age (ind_0_3...)'),
        ('pct_null_snv',      'Revenu (ind_snv)'),
        ('pct_null_men_pauv', 'Menages pauvres (men_pauv)'),
        ('pct_null_log_soc',  'Logements sociaux (log_soc)'),
    ]
    for key, label in fields:
        val = row.get(key, '?')
        print(f"    {label:35s}: {val}% NULL")

    print(f"\n  Taux de ZEROS sur carreaux inclus (ind > {SECRET_STAT_SEUIL}) :")
    zero_fields = [
        ('pct_zero_log_soc',  'log_soc  (normal: zones sans HLM)'),
        ('pct_zero_men_pauv', 'men_pauv'),
        ('pct_zero_log_av45', 'log_av45 (normal: bati recent)'),
        ('pct_zero_log_ap90', 'log_ap90 (normal: bati ancien)'),
    ]
    for key, label in zero_fields:
        val = row.get(key, '?')
        print(f"    {label:40s}: {val}% a zero")

    print(f"\n  Interpretation :")
    pct_ss = float(row.get('pct_secret_stat') or 0)
    if pct_ss > 50:
        print(f"  ! {pct_ss:.0f}% des carreaux sont secret stat -- zones rurales/peu denses.")
        print(f"    Les isochrones en zone urbaine auront une meilleure couverture.")
    print(f"  Seuil de fiabilite POI : cov_rate >= {COVERAGE_THRESHOLD:.0%}")
    print(f"  (cov_rate = carreaux inclus / carreaux totaux dans l'isochrone)")
    print(f"{sep}\n")


# -- Mode: pipeline-new -------------------------------------------------------

def call_ors_isochrone(
    lat: float,
    lng: float,
    minutes: int,
    mode: str,
    log: logging.Logger,
    max_retries: int = 3,
) -> Optional[Dict]:
    """
    Appelle ORS pour calculer un isochrone.
    - 429 -> backoff 15s * 2^n
    - timeout/erreur reseau -> backoff 5s * 2^n
    Retourne le JSON ORS brut (FeatureCollection) ou None.
    """
    if not ORS_API_KEY:
        raise RuntimeError("ORS_API_KEY manquant dans .env.local")
    profile = ORS_PROFILES.get(mode, 'driving-car')
    url     = f"{ORS_BASE_URL}/{profile}"
    headers = {
        'Authorization': f'Bearer {ORS_API_KEY}',
        'Content-Type':  'application/json',
    }
    body = {
        'locations':  [[lng, lat]],
        'range':      [minutes * 60],
        'range_type': 'time',
    }
    for attempt in range(max_retries):
        try:
            resp = _requests.post(url, headers=headers, json=body, timeout=30)
            if resp.status_code == 429:
                wait = 15 * (2 ** attempt)
                log.warning(f"  ORS 429 rate-limit -> attente {wait}s (tentative {attempt+1})")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            data = resp.json()
            # Vider properties de chaque feature (format cache battle)
            for feat in data.get('features') or []:
                feat['properties'] = {}
            return data
        except _requests.exceptions.Timeout:
            wait = 5 * (2 ** attempt)
            log.warning(f"  ORS timeout -> attente {wait}s (tentative {attempt+1})")
            time.sleep(wait)
        except _requests.exceptions.RequestException as exc:
            wait = 5 * (2 ** attempt)
            log.warning(f"  ORS erreur {exc} -> attente {wait}s (tentative {attempt+1})")
            time.sleep(wait)
    log.error(f"ORS echec apres {max_retries} tentatives ({lat},{lng} {minutes}min {mode})")
    return None


def _validate_ors_geometry(ors_response: Dict, log: logging.Logger) -> bool:
    """
    Phase 8 : validation Python-side avant stockage en cache.
    Vérifie que l'ORS response contient une géométrie Polygon/MultiPolygon valide.
    Retourne True si OK, False si la réponse est suspecte (loggue un warning).
    """
    features = (ors_response or {}).get('features') or []
    if not features:
        log.warning("  Geometrie invalide: pas de features dans la reponse ORS")
        return False

    geom = features[0].get('geometry') or {}
    geom_type = geom.get('type', '')
    coords    = geom.get('coordinates')

    if geom_type not in ('Polygon', 'MultiPolygon'):
        log.warning(f"  Geometrie invalide: type inattendu '{geom_type}' (attendu Polygon/MultiPolygon)")
        return False

    if not coords:
        log.warning(f"  Geometrie invalide: coordonnees vides ({geom_type})")
        return False

    # Vérifier que les rings ont au moins 4 points (minimum pour un polygone fermé)
    try:
        if geom_type == 'Polygon':
            outer_ring = coords[0] if coords else []
            if len(outer_ring) < 4:
                log.warning(f"  Geometrie suspecte: ring exterieur avec {len(outer_ring)} points (min 4)")
                return False
        elif geom_type == 'MultiPolygon':
            n_parts = len(coords)
            if n_parts == 0:
                log.warning("  Geometrie invalide: MultiPolygon vide")
                return False
    except (IndexError, TypeError):
        log.warning("  Geometrie invalide: structure de coordonnees malformee")
        return False

    return True


def store_isochrone_in_cache(
    poi_id: str,
    categorie: str,
    ville: str,
    ors_response: Dict,
    minutes: int,
    mode: str,
    sb: SupabaseClient,
    dry_run: bool,
    log: logging.Logger,
) -> None:
    """
    Stocke l'isochrone ORS dans isochrones_cache au format battle.
    Phase 8 : validation géométrie avant stockage — ST_MakeValid appliqué via trigger SQL.
    """
    cache_key = build_battle_cache_key(poi_id, categorie, minutes, mode)

    # Phase 8 : validation Python-side avant stockage
    geom_ok = _validate_ors_geometry(ors_response, log)
    if not geom_ok:
        log.warning(
            f"  Isochrone {poi_id[:8]} stockee malgre geometrie suspecte — "
            "ST_MakeValid sera applique par le trigger SQL"
        )

    if dry_run:
        log.debug(f"  [DRY-RUN] cache {cache_key} non stocke")
        return

    sb.table(TABLE_ISO_CACHE).upsert(
        {
            'cache_key': cache_key,
            'ville':     ville or '',
            'categorie': categorie,
            'geojson':   ors_response,
            'minutes':   minutes,
            'mode':      mode,
        },
        on_conflict='cache_key',
    ).execute()
    log.debug(f"  Cache stocke: {cache_key}{' [geom suspecte -> ST_MakeValid trigger]' if not geom_ok else ''}")


def run_pipeline_new(
    poi_id_filter: Optional[str],
    durations: List[int],
    mode: str,
    ors_delay: float,
    dry_run: bool,
    verbose: bool,
    log: logging.Logger,
    poi_types: Optional[List[str]] = None,
) -> None:
    """
    Phase 4 : orchestration isochrone -> clustering automatique.
    Phase 9 : supporte plusieurs durées (durations=[30,45,60]).

    Pour chaque POI avec needs_clustering=TRUE (ou le POI specifie) :
    1. Pour chaque durée : verifie le cache isochrone
    2. Si absent -> appelle ORS (1 appel par durée) -> stocke en cache
    3. Calcule le profil Filosofi
    4. Applique le modele de clustering
    5. Upsert le cluster dans poi_clusters
    6. Remet needs_clustering=FALSE (après toutes les durées)
    """
    sb = get_supabase()

    # 1. Charger les modeles pour toutes les durées
    models: Dict[int, Dict] = {}
    for duration in durations:
        model = load_latest_model(sb, duration, mode)
        if not model:
            log.warning(f"Aucun modele pour {duration}min/{mode} -- cette duree sera ignoree")
        else:
            models[duration] = model
            log.info(f"Modele {duration}min v{model['version']} charge (K={model['k']})")

    if not models:
        log.error("Aucun modele disponible. Lancer --mode full-retrain d'abord.")
        return

    # Compatibilité : duration principale = première durée avec modèle
    duration = next(iter(models))

    # 2. Trouver les POI a traiter (table poi_france, pas la vue)
    if poi_id_filter:
        res = (
            sb.table(TABLE_POI)
            .select('id, categorie, lat, lng, nom, ville')
            .eq('id', poi_id_filter)
            .execute()
        )
    else:
        res = (
            sb.table(TABLE_POI)
            .select('id, categorie, lat, lng, nom, ville')
            .eq('needs_clustering', True)
            .execute()
        )

    pois = res.data or []
    # Filtrer par type si demande
    if poi_types and not poi_id_filter:
        pois = [p for p in pois if (p.get('categorie') or POI_CAT_DEFAULT) in poi_types]
        log.info(f"Filtre poi_types={poi_types}: {len(pois)} POI retenus")
    if not pois:
        log.info("Aucun POI a traiter (needs_clustering=TRUE).")
        return
    log.info(f"{len(pois)} POI a traiter | durées: {durations}min | modeles: {list(models.keys())}min")

    ok = 0
    skip = 0

    for i, poi in enumerate(pois):
        pid      = str(poi['id'])
        cat      = poi.get('categorie') or POI_CAT_DEFAULT
        lat      = float(poi.get('lat') or 0)
        lng      = float(poi.get('lng') or 0)
        nom      = poi.get('nom') or pid[:8]
        ville    = poi.get('ville') or ''

        log.info(f"[{i+1}/{len(pois)}] {pid[:8]}... ({nom})")

        if lat == 0 or lng == 0:
            log.warning(f"  {pid[:8]}: lat/lng invalides ({lat},{lng}) -- ignore")
            skip += 1
            continue

        poi_ok_any = False

        # Phase 9 : boucle sur les durées — 1 appel ORS par durée si cache absent
        for dur in durations:
            model = models.get(dur)
            if model is None:
                log.debug(f"  {dur}min: pas de modele -- ignore")
                continue

            # 3. Vérifier le cache pour cette durée
            iso_geom_json = get_isochrone_geom_json(pid, cat, dur, mode, sb, log)

            if iso_geom_json is None:
                # 4. Appel ORS
                log.info(f"  ORS: ({lat},{lng}) {dur}min {mode}")
                ors_resp = call_ors_isochrone(lat, lng, dur, mode, log)
                if ors_resp is None:
                    log.warning(f"  {pid[:8]} {dur}min: ORS echec -- ignore")
                    continue

                # 5. Stocker en cache (Phase 8 : validation + trigger ST_MakeValid)
                store_isochrone_in_cache(pid, cat, ville, ors_resp, dur, mode, sb, dry_run, log)

                # Extraire la géométrie pour le profil
                features = ors_resp.get('features') or []
                if not features or not features[0].get('geometry'):
                    log.warning(f"  {pid[:8]} {dur}min: geometrie ORS vide -- ignore")
                    continue
                iso_geom_json = json.dumps(features[0]['geometry'])

                # Pause ORS entre appels (sauf dernier)
                if ors_delay > 0:
                    time.sleep(ors_delay)

            # 6. Calculer le profil Filosofi
            try:
                profile = compute_profile(iso_geom_json, sb)
            except Exception as exc:
                log.warning(f"  {pid[:8]} {dur}min: erreur profil {exc} -- ignore")
                continue

            if profile is None:
                log.warning(f"  {pid[:8]} {dur}min: 0 carreaux -- ignore")
                continue

            # 7. Appliquer seuil de couverture (Phase 3)
            profile, masked = apply_coverage_threshold(profile)
            if masked:
                log.info(
                    f"  {pid[:8]} {dur}min: cov_rate={profile.get('cov_rate', 0):.1%} < "
                    f"{COVERAGE_THRESHOLD:.0%} -> {len(masked)} features NaN"
                )

            # 8. Matrice 1 POI
            poi_ids, X, coverage, imputed_map = profiles_to_matrix({pid: profile}, log)
            if not poi_ids:
                log.warning(f"  {pid[:8]} {dur}min: profil vide -- ignore")
                continue

            # 9. Appliquer le modele (transform)
            cluster_ids, X_pca = apply_model(X, model)
            cid  = int(cluster_ids[0])
            clbl = model['cluster_labels'].get(cid, f'Cluster {cid}')
            cavg = model['cluster_avg_profiles'].get(cid, {})
            cov  = coverage[pid]

            log.info(f"  {dur}min -> Cluster {cid} ({clbl}), cov_rate={cov['cov_rate']:.1%}")

            pca_coords = X_pca[0].tolist()

            # 10. Upsert cluster
            try:
                _upsert_cluster(
                    pid, cid, clbl, pca_coords,
                    profile, cavg,
                    cov['n_carreaux'], cov['n_total'],
                    cov['pop_totale'], cov['cov_rate'],
                    model['version'], dur, mode,
                    imputed_map.get(pid, []),
                    sb, dry_run,
                )
            except Exception as exc:
                log.warning(f"  UPSERT {pid[:8]} {dur}min: {exc}")
                continue

            # 11. Historique
            prev_cid = get_last_history_cluster(pid, sb, duration=dur, mode=mode)
            hist_changed = (prev_cid is not None and prev_cid != cid)
            hist_payload = _build_history_payload(
                pid, cid, clbl, model['version'], profile, pca_coords,
                model['centroids'], 'pipeline-new', prev_cid, hist_changed,
                duration=dur, mode=mode,
            )
            insert_history_batch([hist_payload], sb, dry_run, log)
            poi_ok_any = True

        if poi_ok_any:
            # 12. Remettre needs_clustering = FALSE (après toutes les durées)
            if not dry_run:
                try:
                    sb.table(TABLE_POI).update(
                        {'needs_clustering': False}
                    ).eq('id', pid).execute()
                except Exception as exc:
                    log.warning(f"  needs_clustering reset {pid[:8]}: {exc}")
            ok += 1
        else:
            skip += 1

    prefix = '[DRY-RUN] ' if dry_run else ''
    log.info(f"{prefix}{ok}/{len(pois)} POI traites | {skip} ignores")


# -- Mode: list-poi-types -----------------------------------------------------

def run_list_poi_types(log: logging.Logger) -> None:
    """
    Liste les types de POI disponibles dans la base, avec leur nombre
    et leur statut de clustering.
    """
    sb = get_supabase()
    sep = '=' * 72

    # Tous les types dans la table POI
    try:
        res_all = sb.table(TABLE_POI).select('categorie').execute()
        from collections import Counter
        cat_counts: Counter = Counter(
            (r.get('categorie') or POI_CAT_DEFAULT) for r in (res_all.data or [])
        )
    except Exception as exc:
        log.error(f"Erreur lecture {TABLE_POI}: {exc}")
        return

    # Types ayant des clusters
    try:
        res_cl = sb.table(TABLE_CLUSTERS).select('poi_id').execute()
        clustered_ids = {r['poi_id'] for r in (res_cl.data or [])}
        # Recharger les catégories pour les POI clustérisés
        if clustered_ids:
            res_cat = sb.table(TABLE_POI).select('id, categorie').in_('id', list(clustered_ids)).execute()
            cat_clustered: Counter = Counter(
                (r.get('categorie') or POI_CAT_DEFAULT) for r in (res_cat.data or [])
            )
        else:
            cat_clustered = Counter()
    except Exception:
        cat_clustered = Counter()

    print(f'\n{sep}')
    print('  TYPES DE POI DISPONIBLES')
    print(sep)
    print(f'  {"TYPE":20s}  {"TOTAL":>7}  {"CLUSTERES":>10}  {"STATUT"}')
    print(f'  {"-"*20}  {"-"*7}  {"-"*10}  {"-"*20}')
    for cat, total in sorted(cat_counts.items(), key=lambda x: -x[1]):
        clustered = cat_clustered.get(cat, 0)
        if clustered == total:
            statut = '[OK] tous clusteres'
        elif clustered > 0:
            statut = f'[PARTIEL] {total - clustered} sans cluster'
        else:
            statut = '[AUCUN] aucun cluster'
        print(f'  {cat:20s}  {total:>7}  {clustered:>10}  {statut}')
    print(sep)
    print(f'  Total: {sum(cat_counts.values())} POI | {len(cat_counts)} type(s)')
    print(f'\n  Usage: --poi-type <type> (ex: --poi-type cirfa)')
    print(f'         --poi-type <t1,t2> pour plusieurs types')
    print(f'         omis = tous les types\n')


# -- Mode: cache-isochrones ---------------------------------------------------

def run_cache_isochrones(
    durations: List[int],
    mode: str,
    ors_delay: float,
    dry_run: bool,
    log: logging.Logger,
    poi_types: Optional[List[str]] = None,
    limit: Optional[int] = None,
    geo_filter: Optional[Dict[str, Any]] = None,
    job_id: Optional[str] = None,
    feature_names: Optional[List[str]] = None,
    force_k: Optional[int] = None,
) -> None:
    """
    Calcule et stocke les isochrones ORS pour tous les POI qui n'ont pas encore
    d'entrée dans isochrones_cache pour la (durée, mode) demandée.

    Si feature_names est fourni (ou None = toutes), enchaîne automatiquement
    sur run_full_retrain après la mise en cache.

    Log par POI : "[i/n] <nom>, <ville> — <dur>min — OK (xs) | CACHE | SKIP"

    geo_filter : { metropolitaine: bool, regions: list[str], depts: list[str] }
    job_id     : UUID clustering_jobs — met à jour log_tail toutes les 50 POIs
    """
    sb = get_supabase()

    # Codes département DROM-COM (exclus si metropolitaine=True)
    DROM_COM_DEPTS = {'971', '972', '973', '974', '975', '976'}

    # 1. Charger tous les POI (ou filtrés par type + geo)
    q = sb.table(TABLE_POI).select('id, categorie, lat, lng, nom, ville, code_departement, region')
    if poi_types:
        q = q.in_('categorie', poi_types)

    # Filtre géographique
    metropolitaine = True  # défaut
    if geo_filter:
        metropolitaine = geo_filter.get('metropolitaine', True)
        depts_filter   = [str(d) for d in (geo_filter.get('depts') or [])]
        if depts_filter:
            # Exclure les DROM-COM du filtre si metropolitaine
            if metropolitaine:
                depts_filter = [d for d in depts_filter if d not in DROM_COM_DEPTS]
            if depts_filter:
                q = q.in_('code_departement', depts_filter)

    if metropolitaine and not (geo_filter and geo_filter.get('depts')):
        # Bounding box France métropolitaine (exclut DOM-TOM sans filtre dept explicite)
        q = q.gte('lng', -5.5).lte('lng', 9.6).gte('lat', 41.3).lte('lat', 51.1)

    res = q.execute()
    pois_raw = res.data or []

    # Note : le filtre "régions" est résolu côté UI en liste de code_departement,
    # puis passé dans geo_filter.depts. Le champ geo_filter.regions est conservé
    # pour les logs uniquement — pas de post-filtre Python supplémentaire nécessaire.
    pois = pois_raw

    if not pois:
        log.info("Aucun POI trouvé en base.")
        return

    if limit:
        pois = pois[:limit]

    total = len(pois)
    type_info = f" | types={poi_types}" if poi_types else ''
    log.info(
        f"cache-isochrones | {total} POI | durées: {durations}min | {mode}"
        f"{type_info} | delay={ors_delay}s/appel"
    )

    # Compteurs globaux
    n_cached  = 0  # déjà en cache au départ
    n_ok      = 0  # appelé ORS + stocké avec succès
    n_skip    = 0  # lat/lng invalides
    n_fail    = 0  # ORS échec persistant

    for i, poi in enumerate(pois):
        pid   = str(poi['id'])
        cat   = poi.get('categorie') or POI_CAT_DEFAULT
        lat   = float(poi.get('lat') or 0)
        lng   = float(poi.get('lng') or 0)
        nom   = poi.get('nom') or pid[:8]
        ville = poi.get('ville') or ''
        label = f"{nom}{', ' + ville if ville else ''}"

        if lat == 0 or lng == 0:
            log.warning(f"[{i+1}/{total}] {label} — lat/lng invalides ({lat},{lng}) — SKIP")
            n_skip += 1
            continue

        for dur in durations:
            cache_key = build_battle_cache_key(pid, cat, dur, mode)

            # Vérifier le cache (reprise automatique)
            hit = sb.table(TABLE_ISO_CACHE).select('cache_key').eq('cache_key', cache_key).limit(1).execute()
            if hit.data:
                log.debug(f"[{i+1}/{total}] {label} — {dur}min — CACHE (déjà stocké)")
                n_cached += 1
                continue

            # Appel ORS
            t0 = time.time()
            log.info(f"[{i+1}/{total}] {label} — {dur}min — ORS en cours…")
            ors_resp = call_ors_isochrone(lat, lng, dur, mode, log)
            elapsed  = time.time() - t0

            if ors_resp is None:
                log.warning(f"[{i+1}/{total}] {label} — {dur}min — ECHEC ORS (skip)")
                n_fail += 1
                continue

            store_isochrone_in_cache(pid, cat, ville, ors_resp, dur, mode, sb, dry_run, log)
            log.info(f"[{i+1}/{total}] {label} — {dur}min — OK ({elapsed:.1f}s)")
            n_ok += 1

            # Pause entre appels ORS
            if ors_delay > 0:
                time.sleep(ors_delay)

    prefix = '[DRY-RUN] ' if dry_run else ''
    log.info(
        f"\n{prefix}=== RÉSUMÉ cache-isochrones ==="
        f"\n  POI traités    : {total}"
        f"\n  Déjà en cache  : {n_cached}"
        f"\n  Nouveaux ORS   : {n_ok}"
        f"\n  Échecs ORS     : {n_fail}"
        f"\n  Skip (coords)  : {n_skip}"
    )
    if n_fail > 0:
        log.warning(f"  {n_fail} isochrones non calculés — relancez pour les retenter")

    # Mise à jour du job en base si --job-id fourni
    if job_id and not dry_run:
        try:
            # Récupérer la version du modèle le plus récent pour la lier au job
            latest_model_version: Optional[int] = None
            try:
                mv_res = sb.table('clustering_models') \
                    .select('version') \
                    .order('version', desc=True) \
                    .limit(1) \
                    .execute()
                if mv_res.data:
                    latest_model_version = int(mv_res.data[0]['version'])
            except Exception:
                pass

            sb.table('clustering_jobs').update({
                'result_meta': {
                    'poi_count':            total,
                    'n_cached':             n_cached,
                    'n_ok':                 n_ok,
                    'n_fail':               n_fail,
                    'n_skip':               n_skip,
                    'latest_model_version': latest_model_version,
                },
            }).eq('id', job_id).execute()
        except Exception as exc:
            log.warning(f"Impossible de mettre à jour clustering_jobs ({job_id}): {exc}")

    # -- Chainage automatique vers full-retrain --------------------------------
    # Déclenché quand feature_names est fourni (sélection thématique via wizard)
    # ou quand feature_names=[] signifie "toutes les variables"
    # (None = pas de chainage, comportement historique)
    if feature_names is not None:
        feat_label = ', '.join(feature_names) if feature_names else 'toutes (16)'
        log.info(
            f"\n{'='*60}\n"
            f"  AUTO-RETRAIN apres cache-isochrones\n"
            f"  Features : {feat_label}\n"
            f"{'='*60}"
        )
        _ft = feature_names if feature_names else None
        for dur in durations:
            if len(durations) > 1:
                log.info(f"\n  full-retrain {dur}min/{mode}\n")
            run_full_retrain(
                duration=dur, mode=mode,
                force_k=force_k, dry_run=dry_run,
                verbose=False, limit=None, log=log,
                poi_types=poi_types,
                feature_names=_ft,
            )


# -- CLI ----------------------------------------------------------------------

def run_compute_france_averages(log: logging.Logger) -> None:
    """
    Recalcule les moyennes nationales Filosofi (16 features) via RPC SQL.
    Appelle refresh_filosofi_national_averages() en base (scan unique ~822K carreaux).
    Résultats stockés dans filosofi_national_averages.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants")
        sys.exit(1)

    log.info("Calcul des moyennes nationales Filosofi (RPC refresh_filosofi_national_averages)...")
    log.info("Scan en cours sur carreaux_filosofi (ind > 11) — peut prendre 1-2 minutes...")

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    try:
        res = sb.rpc('refresh_filosofi_national_averages', {}).execute()
    except Exception as exc:
        log.error(f"RPC echoue: {exc}")
        sys.exit(1)

    result = res.data
    if isinstance(result, list):
        result = result[0] if result else None

    log.info(f"Terminé: {result}")

    # Vérification : lire les valeurs calculées
    rows_res = sb.from_('filosofi_national_averages') \
        .select('feature_name, avg_value, n_carreaux') \
        .order('feature_name') \
        .execute()
    if rows_res.data:
        log.info(f"{'Feature':<22} {'Moyenne':>10}  {'N carreaux':>12}")
        log.info('-' * 48)
        for row in rows_res.data:
            log.info(
                f"{row['feature_name']:<22} {float(row['avg_value'] or 0):>10.4f}"
                f"  {(row['n_carreaux'] or 0):>12,}"
            )


def main() -> None:
    parser = argparse.ArgumentParser(
        description='GENESIS -- Clustering POI par profil Filosofi',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        '--mode', required=True,
        choices=[
            'full-retrain', 'assign-new', 'update-affected',
            'pipeline-new', 'fix-geometries', 'recon-secret-stat',
            'list-poi-types', 'cache-isochrones', 'compute-france-averages',
        ],
    )
    parser.add_argument('--since',     help='Date ISO pour update-affected (ex: 2025-03-01)')
    parser.add_argument('--poi-id',    help='UUID POI pour pipeline-new')
    parser.add_argument(
        '--poi-type', default=None,
        help=(
            'Filtrer par type(s) de POI (ex: cirfa, concession, ou "cirfa,lycee"). '
            'Omis = tous les types. Non applicable aux modes fix-geometries et recon-secret-stat.'
        ),
    )
    parser.add_argument(
        '--duration', default='60',
        help='Duree isochrone en minutes (ex: 30, 45, 60) ou "all" pour 30+45+60',
    )
    parser.add_argument('--transport', default='drive', choices=['drive', 'walk', 'bike'])
    parser.add_argument('--force-k',   type=int, help='Forcer K clusters')
    parser.add_argument(
        '--features', default=None,
        help=(
            'Variables a utiliser pour le clustering. Peut etre une ou plusieurs '
            'thematiques (demographie, revenus, logement, menages) ou des noms de '
            'variables individuelles, separes par des virgules. '
            'Ex: demographie | demographie,revenus | pct_0_17,pct_18_39,revenu_moyen. '
            'Omis = toutes les 16 variables. '
            'En mode cache-isochrones avec --features : enchaîne automatiquement full-retrain.'
        ),
    )
    parser.add_argument('--dry-run',   action='store_true')
    parser.add_argument('--verbose', '-v', action='store_true')
    parser.add_argument('--limit',     type=int, help='Limiter nb POI (tests)')
    parser.add_argument(
        '--ors-delay', type=float, default=ORS_DELAY_DEFAULT,
        help=f'Pause en secondes entre appels ORS (defaut: {ORS_DELAY_DEFAULT})',
    )
    parser.add_argument(
        '--geo-filter', default=None,
        help=(
            'Filtre géographique JSON (wizard UI). '
            'Ex: \'{"metropolitaine":true,"regions":["ara"],"depts":["69","38"]}\''
        ),
    )
    parser.add_argument(
        '--job-id', default=None,
        help='UUID du job clustering_jobs — met à jour le statut/log en base si fourni',
    )
    args = parser.parse_args()

    log = setup_logging(args.verbose)

    # Phase 9 : parser --duration (int ou "all")
    if args.duration.lower() == 'all':
        durations = DURATIONS_ALL
    else:
        try:
            durations = [int(args.duration)]
        except ValueError:
            log.error(f"--duration invalide: '{args.duration}' (attendu: 30/45/60/all)")
            sys.exit(1)

    # Parser --poi-type (CSV ou None = tous)
    poi_types: Optional[List[str]] = None
    if args.poi_type:
        poi_types = [t.strip() for t in args.poi_type.split(',') if t.strip()]
        if not poi_types:
            poi_types = None

    # Parser --geo-filter (JSON optionnel)
    geo_filter: Optional[Dict[str, Any]] = None
    if args.geo_filter:
        try:
            geo_filter = json.loads(args.geo_filter)
        except json.JSONDecodeError as exc:
            log.error(f"--geo-filter JSON invalide: {exc}")
            sys.exit(1)

    # --job-id : UUID du job clustering_jobs (polling statut depuis l'UI)
    job_id: Optional[str] = args.job_id if hasattr(args, 'job_id') else None

    # Parser --features
    resolved_features: Optional[List[str]] = None
    if args.features is not None:
        try:
            resolved_features = resolve_features(args.features)
            log.info(f"Features resolues ({len(resolved_features)}) : {', '.join(resolved_features)}")
        except ValueError as exc:
            log.error(f"--features invalide : {exc}")
            sys.exit(1)

    if args.dry_run:
        log.info("=== MODE DRY-RUN -- aucune ecriture en base ===")

    if args.mode != 'list-poi-types':
        type_info = f" | types: {poi_types}" if poi_types else ''
        log.info(
            f"Mode: {args.mode} | {'+'.join(str(d) for d in durations)}min | {args.transport}"
            f"{type_info} | "
            f"Secret stat seuil: ind>{SECRET_STAT_SEUIL} | "
            f"Coverage min: {COVERAGE_THRESHOLD:.0%}"
        )

    if args.mode == 'list-poi-types':
        run_list_poi_types(log)
    elif args.mode == 'full-retrain':
        for dur in durations:
            if len(durations) > 1:
                log.info(f"\n{'='*60}\n  full-retrain {dur}min/{args.transport}\n{'='*60}")
            run_full_retrain(
                duration=dur, mode=args.transport,
                force_k=args.force_k, dry_run=args.dry_run,
                verbose=args.verbose, limit=args.limit, log=log,
                poi_types=poi_types,
                feature_names=resolved_features,
            )
    elif args.mode == 'assign-new':
        for dur in durations:
            if len(durations) > 1:
                log.info(f"\n{'='*60}\n  assign-new {dur}min/{args.transport}\n{'='*60}")
            run_assign_new(
                duration=dur, mode=args.transport,
                dry_run=args.dry_run, verbose=args.verbose, log=log,
                poi_types=poi_types,
            )
    elif args.mode == 'update-affected':
        if not args.since:
            log.error("--since YYYY-MM-DD requis pour update-affected")
            sys.exit(1)
        for dur in durations:
            if len(durations) > 1:
                log.info(f"\n{'='*60}\n  update-affected {dur}min/{args.transport}\n{'='*60}")
            run_update_affected(
                since=args.since, duration=dur, mode=args.transport,
                dry_run=args.dry_run, verbose=args.verbose, log=log,
                poi_types=poi_types,
            )
    elif args.mode == 'pipeline-new':
        run_pipeline_new(
            poi_id_filter=args.poi_id,
            durations=durations,
            mode=args.transport,
            ors_delay=args.ors_delay,
            dry_run=args.dry_run,
            verbose=args.verbose,
            log=log,
            poi_types=poi_types,
        )
    elif args.mode == 'fix-geometries':
        run_fix_geometries(dry_run=args.dry_run, log=log)
    elif args.mode == 'recon-secret-stat':
        run_recon_secret_stat(log)
    elif args.mode == 'cache-isochrones':
        # resolved_features=None  -> pas de chainage (comportement historique)
        # resolved_features=liste -> chainage automatique vers full-retrain apres cache
        run_cache_isochrones(
            durations=durations,
            mode=args.transport,
            ors_delay=args.ors_delay,
            dry_run=args.dry_run,
            log=log,
            poi_types=poi_types,
            limit=args.limit,
            geo_filter=geo_filter,
            job_id=job_id,
            feature_names=resolved_features,
            force_k=args.force_k,
        )
    elif args.mode == 'compute-france-averages':
        run_compute_france_averages(log)


if __name__ == '__main__':
    main()
