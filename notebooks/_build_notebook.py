#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Génère `notebooks/geo_alignment_explorer.ipynb` via nbformat.

Source de vérité du notebook — relancer ce script si l'on veut éditer le contenu
de manière reproductible. Les cellules sont écrites en Python natif (pas de
JSON), ce qui évite les pièges d'échappement.
"""
from __future__ import annotations

from pathlib import Path

import nbformat as nbf

OUT = Path(__file__).resolve().parent / "geo_alignment_explorer.ipynb"


def md(text: str) -> nbf.NotebookNode:
    return nbf.v4.new_markdown_cell(text)


def code(src: str) -> nbf.NotebookNode:
    return nbf.v4.new_code_cell(src)


cells: list[nbf.NotebookNode] = []

# ─────────────────────────────────────────────────────────────────────────────
# Header
cells.append(md(
    "# Geo Alignment Explorer\n\n"
    "Notebook d'exploration du score d'alignement géo socio-démo sur batch de "
    "campagnes Adform.\n\n"
    "**1 vague = 1 fichier Excel = 1 campagne.** Le notebook scanne `TEST/` et "
    "permet de tester rapidement plusieurs cibles socio-démo, comparer leurs "
    "scores, et générer un dashboard HTML autonome.\n\n"
    "*Cible par défaut au Run All : `pop_15_29` (avec fallback dynamique sur la "
    "première colonne `pop_*` disponible).*"
))

# ─────────────────────────────────────────────────────────────────────────────
# Section 1 — Setup
cells.append(md(
    "## 1. Setup\n\n"
    "Imports, chemin du repo, connexion Supabase via le client HTTPS + RPCs "
    "(`geo_alignment_*`). Les fonctions clés sont importées du module "
    "`scripts/scoring/geo_alignment.py`."
))

cells.append(code(
    "from __future__ import annotations\n"
    "import sys, json, hashlib\n"
    "from pathlib import Path\n"
    "import numpy as np\n"
    "import pandas as pd\n"
    "import plotly.express as px\n"
    "import plotly.graph_objects as go\n"
    "from plotly.subplots import make_subplots\n"
    "import ipywidgets as widgets\n"
    "from IPython.display import display\n"
    "import jinja2\n"
    "\n"
    "# Ajout du repo au PYTHONPATH pour importer le module\n"
    "REPO = Path.cwd().parent if (Path.cwd().name == 'notebooks') else Path.cwd()\n"
    "if str(REPO) not in sys.path:\n"
    "    sys.path.insert(0, str(REPO))\n"
    "\n"
    "from scripts.scoring.geo_alignment import (\n"
    "    connect_db,\n"
    "    discover_iris_columns,\n"
    "    group_columns,\n"
    "    detect_denominator,\n"
    "    load_campaigns,\n"
    "    match_iris,\n"
    "    compute_affinity,\n"
    "    score_campaign,\n"
    "    score_department,\n"
    "    fetch_baseline,\n"
    "    top_n_iris,\n"
    "    DEFAULT_MIN_POPULATION,\n"
    "    DEPT_NAMES,\n"
    ")\n"
    "\n"
    "INPUT_DIR  = REPO / 'TEST'\n"
    "OUTPUT_DIR = INPUT_DIR / '_output'\n"
    "CACHE_DIR  = REPO / 'notebooks' / '.cache'\n"
    "OUTPUT_DIR.mkdir(parents=True, exist_ok=True)\n"
    "CACHE_DIR.mkdir(parents=True, exist_ok=True)\n"
    "\n"
    "client = connect_db()\n"
    "print('Repo  :', REPO)\n"
    "print('Input :', INPUT_DIR)\n"
    "print('Cache :', CACHE_DIR)"
))

# ─────────────────────────────────────────────────────────────────────────────
# Section 2 — Load campaigns
cells.append(md(
    "## 2. Chargement des campagnes (1 fois)\n\n"
    "Scan dynamique de `TEST/` → lecture de l'onglet `Sheet` de chaque fichier "
    "→ filtre `Country=France` → DataFrame `df_camp` (postal codes en string, "
    "tracked_ads nettoyé)."
))

cells.append(code(
    "df_camp, load_stats = load_campaigns(INPUT_DIR)\n"
    "n_files     = load_stats['detected']\n"
    "n_campaigns = df_camp['campaign_name'].nunique() if not df_camp.empty else 0\n"
    "tot_imp     = int(df_camp['tracked_ads'].sum()) if not df_camp.empty else 0\n"
    "print(f'Fichiers détectés : {n_files}  (chargés={load_stats[\"loaded\"]}, '\n"
    "      f'erreurs={load_stats[\"errors\"]})')\n"
    "print(f'Campagnes uniques : {n_campaigns}')\n"
    "print(f'Total impressions : {tot_imp:,}'.replace(',', ' '))\n"
    "df_camp.head(3)"
))

# ─────────────────────────────────────────────────────────────────────────────
# Section 3 — Postal→IRIS match with cache
cells.append(md(
    "## 3. Matching postal → IRIS (cache parquet)\n\n"
    "Une seule passe Supabase pour tout le batch. Le résultat est mis en cache "
    "sous `notebooks/.cache/iris_match.parquet`. Le cache est invalidé "
    "automatiquement si la liste des fichiers `TEST/` change.\n\n"
    "⚠ Le matching récupère uniquement les colonnes minimales (`code_iris`, "
    "`code_commune`, `nom_commune`, `share`). Les valeurs de cible `target_value` "
    "et `denom_value` sont recalculées dans la section 6 (variables selon la "
    "cible choisie)."
))

cells.append(code(
    "# Cache invalidation : signature = liste des fichiers + leur taille\n"
    "def files_signature(p: Path) -> str:\n"
    "    items = sorted(\n"
    "        (f.name, f.stat().st_size) for f in p.iterdir()\n"
    "        if f.is_file() and not f.name.startswith(('.', '_'))\n"
    "    )\n"
    "    h = hashlib.md5(json.dumps(items).encode()).hexdigest()\n"
    "    return h\n"
    "\n"
    "SIG_FILE       = CACHE_DIR / 'iris_match.sig'\n"
    "MATCH_FILE     = CACHE_DIR / 'iris_match.parquet'\n"
    "current_sig    = files_signature(INPUT_DIR)\n"
    "cached_sig     = SIG_FILE.read_text() if SIG_FILE.exists() else None\n"
    "cache_is_valid = (cached_sig == current_sig and MATCH_FILE.exists())\n"
    "\n"
    "if cache_is_valid:\n"
    "    df_match_min = pd.read_parquet(MATCH_FILE)\n"
    "    print(f'✅ Cache hit : {len(df_match_min):,} lignes IRIS chargées depuis parquet'.replace(',', ' '))\n"
    "else:\n"
    "    print('⚠ Cache invalide — appel Supabase…')\n"
    "    # On utilise une cible 'jetable' juste pour le matching ; on recalculera\n"
    "    # target_value/denom_value section 6 selon la cible réelle.\n"
    "    df_match_full = match_iris(client, df_camp, target_cols=['population'], denominator='population')\n"
    "    df_match_min = (df_match_full\n"
    "                    .loc[:, ['source_file','campaign_name','media_source','city','country',\n"
    "                             'dma_region','region','postal_code','tracked_ads','unique_reach',\n"
    "                             'unique_reach_row','code_iris','code_commune','nom_commune',\n"
    "                             'is_true_iris','share','matched','imp']]\n"
    "                    .copy())\n"
    "    df_match_min.to_parquet(MATCH_FILE, index=False)\n"
    "    SIG_FILE.write_text(current_sig)\n"
    "    print(f'💾 Cache écrit : {len(df_match_min):,} lignes IRIS'.replace(',', ' '))\n"
    "\n"
    "# Stat globale match rate\n"
    "tot_imp_check = df_match_min.groupby(['source_file','campaign_name'], dropna=False, sort=False)['imp'].sum().sum()\n"
    "matched_imp   = df_match_min.loc[df_match_min['matched'], 'imp'].sum()\n"
    "print(f'iris_match_rate global (par impressions) : {matched_imp/tot_imp_check*100:.2f}%')\n"
    "df_match_min.head(3)"
))

# ─────────────────────────────────────────────────────────────────────────────
# Section 4 — Découverte colonnes IRIS
cells.append(md(
    "## 4. Découverte dynamique des colonnes IRIS\n\n"
    "Récupération des colonnes numériques de la table `iris` via la RPC "
    "`geo_alignment_numeric_columns` (filtre côté serveur), puis groupement par "
    "préfixe sémantique."
))

cells.append(code(
    "iris_cols = discover_iris_columns(client)\n"
    "grouped   = group_columns(iris_cols)\n"
    "print(f'{len(iris_cols)} colonnes IRIS numériques\\n')\n"
    "for group, cols in grouped:\n"
    "    print(f'  {group}  ({len(cols)})')\n"
    "    for c in cols:\n"
    "        print(f'    · {c}')\n"
    "    print()"
))

# ─────────────────────────────────────────────────────────────────────────────
# Section 5 — Interactive selector
cells.append(md(
    "## 5. Sélecteur de cible interactif\n\n"
    "`SelectMultiple` (Ctrl/Shift pour la sélection multiple = somme des "
    "colonnes), `min_population` modifiable (slider), bouton « Calculer le "
    "score ». Les colonnes sont préfixées par leur groupe pour faciliter la "
    "navigation."
))

cells.append(code(
    "DEFAULT_TARGET_PREF = ['pop_18_24', 'pop_15_29', 'pop_25_34']\n"
    "default_target = next((c for c in DEFAULT_TARGET_PREF if c in iris_cols),\n"
    "                     ([c for c in iris_cols if c.startswith('pop_')] or iris_cols)[0])\n"
    "denominator = detect_denominator(iris_cols, override=None)\n"
    "\n"
    "labelled_options = []\n"
    "for group, cols in grouped:\n"
    "    for c in cols:\n"
    "        labelled_options.append((f'[{group[:6]}] {c}', c))\n"
    "\n"
    "w_target  = widgets.SelectMultiple(\n"
    "    options=labelled_options, value=(default_target,), rows=14,\n"
    "    description='Cible :', layout=widgets.Layout(width='520px'),\n"
    "    style={'description_width': '90px'},\n"
    ")\n"
    "w_minpop  = widgets.IntSlider(\n"
    "    value=DEFAULT_MIN_POPULATION, min=0, max=1000, step=50,\n"
    "    description='min_pop :', layout=widgets.Layout(width='520px'),\n"
    "    style={'description_width': '90px'},\n"
    ")\n"
    "w_button  = widgets.Button(description='Calculer le score', button_style='info',\n"
    "                          layout=widgets.Layout(width='220px'))\n"
    "w_status  = widgets.HTML(value='')\n"
    "\n"
    "def _refresh_status(*_):\n"
    "    sel = list(w_target.value)\n"
    "    if not sel:\n"
    "        w_status.value = '<span style=\"color:#aa0\">⚠ Aucune cible sélectionnée</span>'\n"
    "        return\n"
    "    label = '+'.join(sel)\n"
    "    w_status.value = (f'<b>Cible</b>: {label} &nbsp;|&nbsp; '\n"
    "                      f'<b>denom</b>: {denominator} &nbsp;|&nbsp; '\n"
    "                      f'<b>min_pop</b>: {w_minpop.value}')\n"
    "\n"
    "w_target.observe(_refresh_status, 'value')\n"
    "w_minpop.observe(_refresh_status, 'value')\n"
    "_refresh_status()\n"
    "\n"
    "display(widgets.VBox([w_target, w_minpop, w_button, w_status]))"
))

# ─────────────────────────────────────────────────────────────────────────────
# Section 6 — Compute score (rerunnable)
cells.append(md(
    "## 6. Compute du score (rerunnable)\n\n"
    "Calcule `target_value` / `denom_value` pour la cible courante (depuis le "
    "widget OU `current_target` si on script), puis baseline national → "
    "affinity → score par campagne. Stocke le résultat dans `runs[label]` pour "
    "comparer plusieurs cibles plus tard.\n\n"
    "Re-lance cette cellule autant de fois que de cibles à explorer (chaque run "
    "ajoute une entrée à `runs`)."
))

cells.append(code(
    "runs = locals().get('runs', {})  # persiste entre re-runs\n"
    "\n"
    "def run_score(target_cols: list[str], min_population: int = DEFAULT_MIN_POPULATION,\n"
    "              denom_col: str = denominator) -> tuple[pd.DataFrame, pd.DataFrame, dict]:\n"
    "    \"\"\"1 passe Supabase : match_iris → baseline → score. Retourne\n"
    "    (df_scored par campagne, df_full IRIS-level réutilisable, meta).\"\"\"\n"
    "    target_label = '+'.join(target_cols)\n"
    "    print(f'▶ Run target={target_label}, denom={denom_col}, min_pop={min_population}')\n"
    "    df_full   = match_iris(client, df_camp, target_cols=target_cols, denominator=denom_col)\n"
    "    base, st, sd = fetch_baseline(client, target_cols, denom_col, min_population=min_population)\n"
    "    print(f'  baseline FR (pop≥{min_population}) : {base*100:.2f}%  (Σtarget={st:,.0f} / Σdenom={sd:,.0f})')\n"
    "    df_scored = score_campaign(df_full, base, min_population=min_population)\n"
    "    meta = {\n"
    "        'target_cols': target_cols,\n"
    "        'target_label': target_label,\n"
    "        'denominator': denom_col,\n"
    "        'min_population': min_population,\n"
    "        'baseline_pct': round(base*100, 4),\n"
    "        'baseline_ratio': base,\n"
    "    }\n"
    "    return df_scored, df_full, meta\n"
    "\n"
    "# Récupère cible : widget si dispo, sinon fallback default_target\n"
    "current_target = list(w_target.value) or [default_target]\n"
    "current_minpop = int(w_minpop.value)\n"
    "\n"
    "df_run, df_full_run, meta_run = run_score(current_target, min_population=current_minpop, denom_col=denominator)\n"
    "runs[meta_run['target_label']] = {'df': df_run, 'df_full': df_full_run, 'meta': meta_run}\n"
    "\n"
    "# Affichage formaté avec couleur conditionnelle\n"
    "def _style_score(v):\n"
    "    if pd.isna(v): return ''\n"
    "    if v < 90:  return 'color:#c33;font-weight:600'\n"
    "    if v > 110: return 'color:#080;font-weight:600'\n"
    "    return ''\n"
    "\n"
    "show_cols = ['campaign_name','total_impressions','iris_match_rate',\n"
    "             'score_alignment','pct_imp_on_target','pct_imp_neutral',\n"
    "             'pct_imp_off_target','gini_concentration']\n"
    "df_show = df_run.drop(columns=['_per_iris_internal'], errors='ignore')[show_cols]\n"
    "display(df_show.style.map(_style_score, subset=['score_alignment'])\n"
    "                       .format({'total_impressions':'{:,.0f}',\n"
    "                                'iris_match_rate':'{:.1f}%',\n"
    "                                'score_alignment':'{:.1f}',\n"
    "                                'pct_imp_on_target':'{:.1f}%',\n"
    "                                'pct_imp_neutral':'{:.1f}%',\n"
    "                                'pct_imp_off_target':'{:.1f}%',\n"
    "                                'gini_concentration':'{:.3f}'}))\n"
    "\n"
    "# Validation console\n"
    "valid = df_run.dropna(subset=['score_alignment'])\n"
    "if not valid.empty:\n"
    "    print()\n"
    "    print(f'  Cible        : {meta_run[\"target_label\"]} (réf. nationale {meta_run[\"baseline_pct\"]:.2f}%)')\n"
    "    print(f'  Score moyen  : {valid[\"score_alignment\"].mean():.2f}')\n"
    "    print(f'  🥇 Mieux     : {valid.loc[valid[\"score_alignment\"].idxmax(), \"campaign_name\"][:60]} '\n"
    "          f'({valid[\"score_alignment\"].max():.1f})')\n"
    "    print(f'  🥉 Pire      : {valid.loc[valid[\"score_alignment\"].idxmin(), \"campaign_name\"][:60]} '\n"
    "          f'({valid[\"score_alignment\"].min():.1f})')"
))

# ─────────────────────────────────────────────────────────────────────────────
# Section 7 — Viz exploratoire
cells.append(md(
    "## 7. Viz exploratoire (cible courante)\n\n"
    "Trois graphiques Plotly :\n\n"
    "1. **Scatter `affinity × imp`** par IRIS — détecter les concentrations\n"
    "2. **Histogramme** distribution affinity par campagne\n"
    "3. **Bar horizontal** classement campagnes par score"
))

cells.append(code(
    "# 1. Reconstitue df_iris (1 ligne par IRIS pour la cible courante)\n"
    "all_iris = []\n"
    "for _, r in df_run.iterrows():\n"
    "    pi = r.get('_per_iris_internal')\n"
    "    if pi is None or pi.empty:\n"
    "        continue\n"
    "    pi = pi.copy()\n"
    "    pi['campaign_name'] = r['campaign_name']\n"
    "    pi['source_file']   = r['source_file']\n"
    "    all_iris.append(pi)\n"
    "df_iris_run = pd.concat(all_iris, ignore_index=True) if all_iris else pd.DataFrame()\n"
    "df_iris_plot = df_iris_run.dropna(subset=['affinity']).copy()\n"
    "\n"
    "if df_iris_plot.empty:\n"
    "    print('Aucune donnée IRIS pour la cible courante.')\n"
    "else:\n"
    "    fig = px.scatter(\n"
    "        df_iris_plot, x='affinity', y='imp', color='campaign_name',\n"
    "        hover_data=['code_iris','nom_commune'],\n"
    "        opacity=0.55, log_y=True, height=520,\n"
    "        title=f'Affinity × Impressions — cible {meta_run[\"target_label\"]} (min_pop={meta_run[\"min_population\"]})',\n"
    "    )\n"
    "    fig.add_vline(x=80,  line_dash='dot', line_color='#aaa', annotation_text='80')\n"
    "    fig.add_vline(x=100, line_dash='dash', line_color='#666', annotation_text='100 (neutre)')\n"
    "    fig.add_vline(x=120, line_dash='dot', line_color='#aaa', annotation_text='120')\n"
    "    fig.update_layout(template='plotly_white')\n"
    "    fig.show()"
))

cells.append(code(
    "# 2. Histogrammes affinity par campagne (subplots)\n"
    "campaigns = df_iris_plot['campaign_name'].unique().tolist()\n"
    "n         = max(len(campaigns), 1)\n"
    "ncols     = min(3, n)\n"
    "nrows     = (n + ncols - 1) // ncols\n"
    "fig2 = make_subplots(rows=nrows, cols=ncols, subplot_titles=campaigns)\n"
    "for i, c in enumerate(campaigns):\n"
    "    sub = df_iris_plot[df_iris_plot['campaign_name'] == c]\n"
    "    r, col = i // ncols + 1, i % ncols + 1\n"
    "    fig2.add_trace(go.Histogram(x=sub['affinity'], name=c, nbinsx=40,\n"
    "                                marker_color='#5a8'), row=r, col=col)\n"
    "    for x, dash in [(80, 'dot'), (100, 'dash'), (120, 'dot')]:\n"
    "        fig2.add_vline(x=x, line_dash=dash, line_color='#aaa', row=r, col=col)\n"
    "fig2.update_layout(height=300*nrows, showlegend=False, template='plotly_white',\n"
    "                   title_text=f'Distribution affinity par campagne — {meta_run[\"target_label\"]}')\n"
    "fig2.show()"
))

cells.append(code(
    "# 3. Bar horizontal — classement campagnes par score\n"
    "df_bar = df_run.dropna(subset=['score_alignment']).sort_values('score_alignment')\n"
    "fig3 = go.Figure(go.Bar(\n"
    "    x=df_bar['score_alignment'], y=df_bar['campaign_name'], orientation='h',\n"
    "    marker_color=['#c33' if v < 90 else ('#080' if v > 110 else '#888') for v in df_bar['score_alignment']],\n"
    "    text=df_bar['score_alignment'].round(1), textposition='outside',\n"
    "))\n"
    "fig3.add_vline(x=100, line_dash='dash', line_color='#666', annotation_text='neutre')\n"
    "fig3.update_layout(height=max(400, 28*len(df_bar)+120), template='plotly_white',\n"
    "                   title=f'Score d\\'alignement par campagne — {meta_run[\"target_label\"]}',\n"
    "                   xaxis_title='score_alignment', yaxis_title='')\n"
    "fig3.show()"
))

# ─────────────────────────────────────────────────────────────────────────────
# Section 7bis — Analyse par département
cells.append(md(
    "## 7bis. Analyse par département (rollup IRIS → dept)\n\n"
    "Le matching IRIS reste l'unité de calcul (granularité fine), mais on agrège "
    "par département pour voir où la campagne sur/sous-livre à l'échelle "
    "régionale. Le drill-down IRIS reste accessible via `df_run`."
))

cells.append(code(
    "# Réutilise le df_full IRIS-level déjà calculé en section 6 — zéro appel Supabase\n"
    "# supplémentaire (cf. runs[...]['df_full']).\n"
    "df_full_dept = df_full_run\n"
    "df_dept_run  = score_department(df_full_dept, meta_run['baseline_ratio'],\n"
    "                                min_population=meta_run['min_population'])\n"
    "df_dept_run.insert(2, 'target_label', meta_run['target_label'])\n"
    "print(f'Départements couverts : {df_dept_run[\"code_departement\"].nunique()}')\n"
    "\n"
    "# Top 10 par impressions\n"
    "show_cols_d = ['code_departement','nom_departement','nb_iris_touched',\n"
    "               'total_impressions','pct_total_imp','score_alignment',\n"
    "               'pct_imp_on_target','pct_imp_off_target']\n"
    "top10 = df_dept_run.nlargest(10, 'total_impressions')[show_cols_d]\n"
    "display(top10.style.map(_style_score, subset=['score_alignment'])\n"
    "                   .format({'total_impressions':'{:,.0f}',\n"
    "                            'pct_total_imp':'{:.1f}%',\n"
    "                            'score_alignment':'{:.1f}',\n"
    "                            'pct_imp_on_target':'{:.1f}%',\n"
    "                            'pct_imp_off_target':'{:.1f}%'}))"
))

cells.append(code(
    "# Bar horizontal — top 15 dépts mieux alignés vs top 15 pires (split couleur)\n"
    "df_dept_clean = df_dept_run.dropna(subset=['score_alignment']).copy()\n"
    "df_dept_clean['label'] = df_dept_clean['code_departement'] + ' · ' + df_dept_clean['nom_departement']\n"
    "best  = df_dept_clean.nlargest(15, 'score_alignment')\n"
    "worst = df_dept_clean.nsmallest(15, 'score_alignment')\n"
    "\n"
    "fig_dept_bar = make_subplots(rows=1, cols=2, horizontal_spacing=0.18,\n"
    "                             subplot_titles=('🥇 Top 15 mieux alignés', '🥉 Top 15 moins alignés'))\n"
    "fig_dept_bar.add_trace(go.Bar(\n"
    "    x=best['score_alignment'], y=best['label'], orientation='h',\n"
    "    marker_color='#080', text=best['score_alignment'].round(1), textposition='outside',\n"
    "    customdata=best[['total_impressions','pct_total_imp']].values,\n"
    "    hovertemplate='%{y}<br>score=%{x:.1f}<br>imp=%{customdata[0]:,}<br>%{customdata[1]:.1f}%% du batch<extra></extra>',\n"
    "), row=1, col=1)\n"
    "fig_dept_bar.add_trace(go.Bar(\n"
    "    x=worst['score_alignment'], y=worst['label'], orientation='h',\n"
    "    marker_color='#c33', text=worst['score_alignment'].round(1), textposition='outside',\n"
    "    customdata=worst[['total_impressions','pct_total_imp']].values,\n"
    "    hovertemplate='%{y}<br>score=%{x:.1f}<br>imp=%{customdata[0]:,}<br>%{customdata[1]:.1f}%% du batch<extra></extra>',\n"
    "), row=1, col=2)\n"
    "for col in (1, 2):\n"
    "    fig_dept_bar.add_vline(x=100, line_dash='dash', line_color='#666', row=1, col=col)\n"
    "fig_dept_bar.update_layout(\n"
    "    height=540, showlegend=False, template='plotly_white',\n"
    "    title=f'Score d\\'alignement par département — {meta_run[\"target_label\"]}',\n"
    ")\n"
    "fig_dept_bar.show()"
))

cells.append(code(
    "# Choroplèthe France métro par département via geojson opendata\n"
    "# (téléchargé une fois dans .cache/ ; skip silencieux si pas de réseau)\n"
    "import urllib.request\n"
    "GEOJSON_URL = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements.geojson'\n"
    "geojson_path = CACHE_DIR / 'departements.geojson'\n"
    "fig_dept_map = None\n"
    "if not geojson_path.exists():\n"
    "    try:\n"
    "        urllib.request.urlretrieve(GEOJSON_URL, geojson_path)\n"
    "        print(f'GeoJSON téléchargé : {geojson_path.stat().st_size // 1024} KB')\n"
    "    except Exception as e:\n"
    "        print(f'Téléchargement geojson échoué (mode offline) : {e}')\n"
    "if geojson_path.exists():\n"
    "    geojson = json.loads(geojson_path.read_text(encoding='utf-8'))\n"
    "    fig_dept_map = px.choropleth(\n"
    "        df_dept_clean, geojson=geojson,\n"
    "        locations='code_departement', featureidkey='properties.code',\n"
    "        color='score_alignment', color_continuous_scale='RdYlGn',\n"
    "        range_color=[60, 140],\n"
    "        hover_name='nom_departement',\n"
    "        hover_data={'code_departement': True, 'total_impressions': ':,',\n"
    "                    'pct_total_imp': ':.1f', 'score_alignment': ':.1f'},\n"
    "        title=f'France — score alignement par département ({meta_run[\"target_label\"]})',\n"
    "    )\n"
    "    fig_dept_map.update_geos(fitbounds='locations', visible=False)\n"
    "    fig_dept_map.update_layout(template='plotly_white', height=620,\n"
    "                               margin=dict(l=0, r=0, t=60, b=0))\n"
    "    fig_dept_map.show()\n"
    "else:\n"
    "    print('Choroplèthe skippée — pas de geojson dispo.')"
))

# ─────────────────────────────────────────────────────────────────────────────
# Section 8 — Comparaison multi-cibles
cells.append(md(
    "## 8. Comparaison multi-cibles\n\n"
    "Pour chaque cible déjà testée (clés de `runs`), on aligne les scores par "
    "campagne. La meilleure cible (`best_target`) est calculée par campagne.\n\n"
    "👉 Pour ajouter une cible, retourner section 5, choisir la cible, puis "
    "relancer la section 6. Cette cellule ré-exécutée mettra à jour la matrice."
))

cells.append(code(
    "if not runs:\n"
    "    print('Aucun run effectué — exécute la section 6 d\\'abord.')\n"
    "else:\n"
    "    matrix = {}\n"
    "    for label, run in runs.items():\n"
    "        df = run['df'].dropna(subset=['score_alignment']).copy()\n"
    "        matrix[label] = dict(zip(df['campaign_name'], df['score_alignment']))\n"
    "    df_matrix = pd.DataFrame(matrix).round(1)\n"
    "    df_matrix['best_target'] = df_matrix.idxmax(axis=1)\n"
    "    df_matrix['best_score']  = df_matrix.iloc[:, :-1].max(axis=1)\n"
    "    print(f'{len(runs)} cible(s) testée(s) : {list(runs.keys())}\\n')\n"
    "    display(df_matrix)\n"
    "\n"
    "    # Heatmap\n"
    "    if df_matrix.shape[1] > 2:\n"
    "        z = df_matrix.drop(columns=['best_target','best_score']).values\n"
    "        fig4 = go.Figure(go.Heatmap(\n"
    "            z=z,\n"
    "            x=list(df_matrix.columns[:-2]),\n"
    "            y=[c[:50] for c in df_matrix.index],\n"
    "            colorscale='RdYlGn', zmid=100,\n"
    "            text=z, texttemplate='%{text:.0f}',\n"
    "            colorbar=dict(title='score'),\n"
    "        ))\n"
    "        fig4.update_layout(\n"
    "            template='plotly_white', height=max(380, 28*len(df_matrix)+120),\n"
    "            title='Heatmap multi-cibles (score d\\'alignement par campagne × cible)',\n"
    "        )\n"
    "        fig4.show()"
))

# ─────────────────────────────────────────────────────────────────────────────
# Section 9 — Export CSV + Dashboard HTML
cells.append(md(
    "## 9. Export — CSV + dashboard HTML autonome\n\n"
    "- `_output/score_campaigns_<target_label>.csv` — dernière vague\n"
    "- `_output/score_matrix_multi_target.csv` — comparatif multi-cibles\n"
    "- `_output/dashboard.html` — dashboard offline (Plotly + CSS embarqués)\n"
))

cells.append(code(
    "# CSV — dernière vague\n"
    "csv_last = OUTPUT_DIR / f'score_campaigns_{meta_run[\"target_label\"]}.csv'\n"
    "df_run.drop(columns=['_per_iris_internal'], errors='ignore').to_csv(csv_last, index=False, encoding='utf-8')\n"
    "print(f'💾 {csv_last}')\n"
    "\n"
    "# CSV — rollup département\n"
    "csv_dept = OUTPUT_DIR / f'score_departments_{meta_run[\"target_label\"]}.csv'\n"
    "df_dept_run.to_csv(csv_dept, index=False, encoding='utf-8')\n"
    "print(f'💾 {csv_dept}')\n"
    "\n"
    "# CSV matrix multi-cibles\n"
    "if runs and len(runs) >= 1:\n"
    "    matrix = {label: dict(zip(run['df']['campaign_name'], run['df']['score_alignment']))\n"
    "              for label, run in runs.items()}\n"
    "    df_matrix_csv = pd.DataFrame(matrix).round(2)\n"
    "    df_matrix_csv['best_target'] = df_matrix_csv.idxmax(axis=1)\n"
    "    df_matrix_csv['best_score']  = df_matrix_csv.iloc[:, :-1].max(axis=1)\n"
    "    csv_matrix = OUTPUT_DIR / 'score_matrix_multi_target.csv'\n"
    "    df_matrix_csv.to_csv(csv_matrix, encoding='utf-8')\n"
    "    print(f'💾 {csv_matrix}')"
))

cells.append(code(
    "# Dashboard HTML autonome (Plotly inliné, pas de CDN)\n"
    "TEMPLATE = '''<!DOCTYPE html>\n"
    "<html lang=\"fr\"><head>\n"
    "<meta charset=\"utf-8\"><title>Geo Alignment Dashboard — {{target_label}}</title>\n"
    "<style>\n"
    "  body{font-family:-apple-system,Inter,Segoe UI,Roboto,sans-serif;background:#fafafa;color:#222;margin:0;padding:24px;line-height:1.45}\n"
    "  h1{font-weight:600;font-size:22px;letter-spacing:-.01em;margin:0 0 4px}\n"
    "  h2{font-weight:600;font-size:16px;margin:32px 0 8px;color:#444}\n"
    "  .muted{color:#888;font-size:13px}\n"
    "  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0 8px}\n"
    "  .kpi{background:#fff;border:1px solid #eee;border-radius:8px;padding:12px 14px}\n"
    "  .kpi .v{font-family:JetBrains Mono,monospace;font-size:22px;font-weight:600}\n"
    "  .kpi .l{color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.05em}\n"
    "  table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #eee;border-radius:8px;overflow:hidden;font-size:13px}\n"
    "  th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #f0f0f0}\n"
    "  th{background:#f5f5f5;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#666}\n"
    "  tr:last-child td{border-bottom:none}\n"
    "  .score-bad{color:#c33;font-weight:600}\n"
    "  .score-good{color:#080;font-weight:600}\n"
    "  .plot{background:#fff;border:1px solid #eee;border-radius:8px;padding:8px;margin:14px 0}\n"
    "  code{background:#f0f0f0;padding:1px 6px;border-radius:3px;font-size:12px}\n"
    "</style></head><body>\n"
    "  <h1>Geo Alignment — dashboard</h1>\n"
    "  <div class=\"muted\">Cible <code>{{target_label}}</code> · denom <code>{{denom}}</code> · min_pop {{min_pop}} · baseline FR {{baseline_pct}}% · généré {{generated_at}}</div>\n"
    "\n"
    "  <div class=\"grid\">\n"
    "    <div class=\"kpi\"><div class=\"l\">Campagnes</div><div class=\"v\">{{n_campaigns}}</div></div>\n"
    "    <div class=\"kpi\"><div class=\"l\">Impressions</div><div class=\"v\">{{tot_imp}}</div></div>\n"
    "    <div class=\"kpi\"><div class=\"l\">Match rate moyen</div><div class=\"v\">{{avg_match}}%</div></div>\n"
    "    <div class=\"kpi\"><div class=\"l\">Score moyen</div><div class=\"v\">{{avg_score}}</div></div>\n"
    "  </div>\n"
    "\n"
    "  <h2>Top / Flop</h2>\n"
    "  <table><thead><tr><th>Campagne</th><th>Score</th><th>Match rate</th><th>On-target</th><th>Off-target</th><th>Gini</th></tr></thead>\n"
    "    <tbody>{% for r in topflop %}\n"
    "      <tr><td>{{r.campaign}}</td><td class=\"{{r.cls}}\">{{r.score}}</td><td>{{r.match}}%</td><td>{{r.on}}%</td><td>{{r.off}}%</td><td>{{r.gini}}</td></tr>\n"
    "    {% endfor %}</tbody></table>\n"
    "\n"
    "  {% if heatmap_html %}<h2>Heatmap multi-cibles</h2><div class=\"plot\">{{heatmap_html|safe}}</div>{% endif %}\n"
    "  <h2>Affinity × Impressions (cible courante)</h2><div class=\"plot\">{{scatter_html|safe}}</div>\n"
    "  <h2>Classement campagnes</h2><div class=\"plot\">{{bar_html|safe}}</div>\n"
    "\n"
    "  <h2>Analyse par département</h2>\n"
    "  {% if dept_map_html %}<div class=\"plot\">{{dept_map_html|safe}}</div>{% endif %}\n"
    "  <div class=\"plot\">{{dept_bar_html|safe}}</div>\n"
    "  <table><thead><tr><th>Code</th><th>Département</th><th>Imp</th><th>%batch</th><th>Score</th><th>On-target</th><th>Off-target</th></tr></thead>\n"
    "    <tbody>{% for r in depts %}\n"
    "      <tr><td><code>{{r.code}}</code></td><td>{{r.nom}}</td><td>{{r.imp}}</td><td>{{r.pct}}%</td><td class=\"{{r.cls}}\">{{r.score}}</td><td>{{r.on}}%</td><td>{{r.off}}%</td></tr>\n"
    "    {% endfor %}</tbody></table>\n"
    "\n"
    "  <h2>Top 3 dérives par campagne (forte livraison × faible affinity)</h2>\n"
    "  <table><thead><tr><th>Campagne</th><th>IRIS</th><th>Ville</th><th>Affinity</th><th>Imp</th></tr></thead>\n"
    "    <tbody>{% for r in drifts %}\n"
    "      <tr><td>{{r.campaign}}</td><td><code>{{r.code_iris}}</code></td><td>{{r.ville}}</td><td class=\"score-bad\">{{r.affinity}}</td><td>{{r.imp}}</td></tr>\n"
    "    {% endfor %}</tbody></table>\n"
    "</body></html>'''\n"
    "\n"
    "from datetime import datetime\n"
    "valid = df_run.dropna(subset=['score_alignment'])\n"
    "topflop_rows = []\n"
    "for _, r in valid.sort_values('score_alignment', ascending=False).iterrows():\n"
    "    s = r['score_alignment']\n"
    "    cls = 'score-good' if s > 110 else ('score-bad' if s < 90 else '')\n"
    "    topflop_rows.append({\n"
    "        'campaign': r['campaign_name'][:60], 'score': f'{s:.1f}', 'cls': cls,\n"
    "        'match': f'{r[\"iris_match_rate\"]:.1f}',\n"
    "        'on': f'{r[\"pct_imp_on_target\"]:.1f}',\n"
    "        'off': f'{r[\"pct_imp_off_target\"]:.1f}',\n"
    "        'gini': f'{r[\"gini_concentration\"]:.2f}',\n"
    "    })\n"
    "\n"
    "drifts_rows = []\n"
    "for _, r in df_run.iterrows():\n"
    "    over = json.loads(r['top3_overdelivered_iris'])\n"
    "    for o in over:\n"
    "        drifts_rows.append({\n"
    "            'campaign': r['campaign_name'][:50], 'code_iris': o['code_iris'],\n"
    "            'ville': o['ville'][:30], 'affinity': f'{o[\"affinity\"]:.1f}',\n"
    "            'imp': f'{o[\"imp\"]:,}'.replace(',', ' '),\n"
    "        })\n"
    "drifts_rows = sorted(drifts_rows, key=lambda d: -float(d['imp'].replace(' ', '')))[:15]\n"
    "\n"
    "# Top 10 départements par impressions pour la table dashboard\n"
    "dept_table_rows = []\n"
    "for _, r in df_dept_run.nlargest(20, 'total_impressions').iterrows():\n"
    "    s = r['score_alignment']\n"
    "    cls = ('score-good' if (s is not None and s > 110) else\n"
    "           'score-bad'  if (s is not None and s < 90)  else '')\n"
    "    dept_table_rows.append({\n"
    "        'code': r['code_departement'], 'nom': r['nom_departement'],\n"
    "        'imp': f'{int(r[\"total_impressions\"]):,}'.replace(',', ' '),\n"
    "        'pct': f'{r[\"pct_total_imp\"]:.1f}',\n"
    "        'score': f'{s:.1f}' if s is not None and not pd.isna(s) else '—',\n"
    "        'cls': cls,\n"
    "        'on': f'{r[\"pct_imp_on_target\"]:.1f}',\n"
    "        'off': f'{r[\"pct_imp_off_target\"]:.1f}',\n"
    "    })\n"
    "\n"
    "# Plotly figs → HTML inline (pas de CDN)\n"
    "scatter_html  = fig.to_html(full_html=False, include_plotlyjs='inline') if not df_iris_plot.empty else '<i>aucune donnée</i>'\n"
    "bar_html      = fig3.to_html(full_html=False, include_plotlyjs=False)\n"
    "heatmap_html  = fig4.to_html(full_html=False, include_plotlyjs=False) if 'fig4' in dir() else ''\n"
    "dept_bar_html = fig_dept_bar.to_html(full_html=False, include_plotlyjs=False)\n"
    "dept_map_html = (fig_dept_map.to_html(full_html=False, include_plotlyjs=False)\n"
    "                 if fig_dept_map is not None else '')\n"
    "\n"
    "ctx = {\n"
    "    'target_label': meta_run['target_label'], 'denom': meta_run['denominator'],\n"
    "    'min_pop': meta_run['min_population'], 'baseline_pct': f'{meta_run[\"baseline_pct\"]:.2f}',\n"
    "    'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M'),\n"
    "    'n_campaigns': len(df_run),\n"
    "    'tot_imp': f'{int(df_run[\"total_impressions\"].sum()):,}'.replace(',', ' '),\n"
    "    'avg_match': f'{df_run[\"iris_match_rate\"].mean():.1f}',\n"
    "    'avg_score': f'{valid[\"score_alignment\"].mean():.1f}' if not valid.empty else '—',\n"
    "    'topflop': topflop_rows, 'drifts': drifts_rows, 'depts': dept_table_rows,\n"
    "    'scatter_html': scatter_html, 'bar_html': bar_html, 'heatmap_html': heatmap_html,\n"
    "    'dept_bar_html': dept_bar_html, 'dept_map_html': dept_map_html,\n"
    "}\n"
    "\n"
    "html = jinja2.Template(TEMPLATE).render(**ctx)\n"
    "dash_path = OUTPUT_DIR / 'dashboard.html'\n"
    "dash_path.write_text(html, encoding='utf-8')\n"
    "size_kb = dash_path.stat().st_size // 1024\n"
    "print(f'💾 {dash_path}  ({size_kb} KB, autonome — ouvre dans n\\'importe quel navigateur)')"
))

# ─────────────────────────────────────────────────────────────────────────────
# Footer
cells.append(md(
    "---\n\n"
    "**Pour comparer plusieurs cibles** : retourne en section 5, change la cible, "
    "ré-exécute la section 6, puis relance la section 8 — le DataFrame `runs` "
    "accumule chaque cible testée, et la matrice se met à jour.\n\n"
    "**Pour invalider le cache postal→IRIS** : supprime `notebooks/.cache/` ou "
    "ajoute/enlève un fichier dans `TEST/` (la signature change → recalcul auto)."
))

# ─────────────────────────────────────────────────────────────────────────────
nb = nbf.v4.new_notebook()
nb.cells = cells
nb.metadata = {
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {
        "name": "python",
        "version": "3.13",
        "mimetype": "text/x-python",
        "file_extension": ".py",
    },
}

nbf.write(nb, OUT)
print(f"OK Notebook ecrit : {OUT}  ({OUT.stat().st_size // 1024} KB, {len(cells)} cellules)")
