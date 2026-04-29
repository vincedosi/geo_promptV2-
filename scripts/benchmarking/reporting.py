"""Rapport markdown + 3 graphiques PNG."""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")  # noqa: E402 — backend non-interactif obligatoire avant pyplot
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ASSETS_DIR = REPO_ROOT / "docs" / "assets"
REPORT_PATH = REPO_ROOT / "docs" / "chantier_a4_2_benchmark_results.md"


def _ensure_dirs() -> None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)


# ─── Plots ─────────────────────────────────────────────────────────────

def plot_lift_curves(curves: dict[str, pd.DataFrame], out_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(9, 5), dpi=120)
    for code, df in curves.items():
        ax.plot(df["date"], df["lift_pct"], marker="o", markersize=3, label=code, linewidth=1.5)
    ax.axvline(pd.Timestamp("2026-03-22"), linestyle=":", color="gray", alpha=0.6)
    ax.text(pd.Timestamp("2026-03-22"), ax.get_ylim()[1] * 0.95 if ax.get_ylim()[1] > 0 else 0,
            " test set start", color="gray", fontsize=8, va="top")
    ax.axhline(0.0, linestyle="-", color="black", alpha=0.3, linewidth=0.5)
    ax.set_xlabel("Date")
    ax.set_ylabel("Lift cumulé (%)")
    ax.set_title("Lift cumulé jour-par-jour sur le test set (22-30 mars)")
    ax.legend(loc="best", fontsize=8)
    ax.grid(True, linestyle=":", alpha=0.4)
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


def plot_leads_by_tier(results: list[dict[str, Any]], out_path: Path) -> None:
    """Bar chart leads_real vs leads_sim par tier × algo."""
    tiers = ["premium_urban", "urban", "suburban", "rural"]
    real_by_tier = {t: 0.0 for t in tiers}
    sim_by_algo: dict[str, dict[str, float]] = {}
    for r in results:
        sim_by_algo[r["code"]] = {t: r["metrics"]["by_tier"].get(t, {}).get("leads_sim", 0.0) for t in tiers}
        for t in tiers:
            real_by_tier[t] = max(real_by_tier[t], r["metrics"]["by_tier"].get(t, {}).get("leads_real", 0.0))

    fig, ax = plt.subplots(figsize=(10, 5), dpi=120)
    n_algos = len(sim_by_algo)
    width = 0.8 / (n_algos + 1)
    x = list(range(len(tiers)))
    ax.bar([i - 0.4 + 0 * width for i in x], [real_by_tier[t] for t in tiers],
           width=width, label="real (no algo)", color="lightgray", edgecolor="black")
    for i, (code, vals) in enumerate(sim_by_algo.items(), start=1):
        ax.bar([j - 0.4 + i * width for j in x], [vals[t] for t in tiers], width=width, label=code)
    ax.set_xticks(x)
    ax.set_xticklabels(tiers)
    ax.set_ylabel("Leads (test set)")
    ax.set_title("Leads simulés vs réels par tier de zone — test set 22-30 mars")
    ax.legend(loc="best", fontsize=8)
    ax.grid(True, axis="y", linestyle=":", alpha=0.4)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


def plot_drift_robustness(results: list[dict[str, Any]], out_path: Path) -> None:
    """Compare lift pre-drift vs post-drift par algo."""
    codes = [r["code"] for r in results]
    pre_lift = []
    post_lift = []
    for r in results:
        m = r["metrics"]
        pr = m["pre_drift"]
        po = m["post_drift"]
        pre_lift.append((pr["leads_sim"] - pr["leads_real"]) / max(pr["leads_real"], 1.0) * 100.0)
        post_lift.append((po["leads_sim"] - po["leads_real"]) / max(po["leads_real"], 1.0) * 100.0)

    fig, ax = plt.subplots(figsize=(9, 5), dpi=120)
    x = list(range(len(codes)))
    ax.bar([i - 0.2 for i in x], pre_lift, width=0.4, label="pre-drift (test pre 16/03)", color="#5b9bd5")
    ax.bar([i + 0.2 for i in x], post_lift, width=0.4, label="post-drift (test post 16/03)", color="#ff5757")
    ax.axhline(0.0, color="black", alpha=0.3, linewidth=0.5)
    ax.set_xticks(x)
    ax.set_xticklabels(codes, rotation=20, ha="right")
    ax.set_ylabel("Lift (%)")
    ax.set_title("Robustesse au drift J+15 — lift pre vs post drift")
    ax.legend(loc="best", fontsize=9)
    ax.grid(True, axis="y", linestyle=":", alpha=0.4)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


# ─── Markdown ──────────────────────────────────────────────────────────

def write_report(
    results: list[dict[str, Any]],
    winner_code: str,
    baseline: dict[str, Any],
    winner_metrics: dict[str, Any],
    train_window: tuple[Any, Any],
    test_window: tuple[Any, Any],
    plot_paths: dict[str, str],
) -> None:
    _ensure_dirs()
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    sorted_results = sorted(results, key=lambda r: r["metrics"]["lift_pct"], reverse=True)

    lines: list[str] = []
    lines.append(f"# Chantier A4.2 — Benchmark des 5 algorithmes ML\n")
    lines.append(f"> Run : {now} · Train : {train_window[0]} → {train_window[1]} · Test : {test_window[0]} → {test_window[1]}\n")
    lines.append("")
    lines.append("## 1 — Résumé exécutif\n")
    lines.append(f"**Algo gagnant : `{winner_code}`** — lift `{winner_metrics['lift_pct']:.2f} %`,")
    lines.append(f" CPL `{winner_metrics['cpl_sim']:.2f} €` (vs réel `{winner_metrics['cpl_real']:.2f} €`,")
    lines.append(f" Δ = `{winner_metrics['cpl_delta_eur']:+.2f} €/lead`).")
    lines.append("")
    lines.append("## 2 — Tableau comparatif\n")
    lines.append("| Algo | Lift % | Leads sim | CPL sim € | Δ CPL € | Drift robustness % | Latency train ms | Latency predict ms (mean) |")
    lines.append("|------|--------|-----------|-----------|---------|---------------------|------------------|---------------------------|")
    for r in sorted_results:
        m = r["metrics"]
        lines.append(
            f"| `{r['code']}` | {m['lift_pct']:+.2f} | {m['leads_sim']:.1f} | "
            f"{m['cpl_sim']:.2f} | {m['cpl_delta_eur']:+.2f} | "
            f"{m['drift_robustness_pct']:+.2f} | {r['train_ms']:.0f} | {m['latency_predict_ms_mean']:.3f} |"
        )
    lines.append("")
    lines.append("## 3 — Graphiques\n")
    lines.append(f"![Lift cumulé jour par jour](assets/{Path(plot_paths['lift_curves']).name})\n")
    lines.append(f"![Leads par tier](assets/{Path(plot_paths['leads_by_tier']).name})\n")
    lines.append(f"![Robustesse au drift](assets/{Path(plot_paths['drift_robustness']).name})\n")
    lines.append("")
    lines.append("## 4 — Discussion\n")
    best = sorted_results[0]
    worst = sorted_results[-1]
    lines.append(f"Le gagnant **`{best['code']}`** présente un lift de `{best['metrics']['lift_pct']:+.2f} %` ")
    lines.append(f"sur le test set (22-30 mars) avec un CPL simulé de `{best['metrics']['cpl_sim']:.2f} €`. ")
    lines.append("L'écart pre/post drift est instructif : un algo qui maintient (voire améliore) son lift après le 16 mars ")
    lines.append("démontre une bonne adaptation online.\n")
    lines.append(f"À l'opposé, **`{worst['code']}`** termine dernier avec un lift de `{worst['metrics']['lift_pct']:+.2f} %`, ")
    lines.append("ce qui en fait notre baseline naturelle pour valider la valeur ajoutée des autres algos.\n")
    lines.append("")
    lines.append("## 5 — Décision\n")
    lines.append(f"**Algo retenu pour A4.3** : `{winner_code}` — paramètres recommandés : ceux du seed initial dans `bidding_algorithms.config_schema`.\n")
    lines.append("Marqué `is_active=true` dans `adaptive_model_state` (le partial unique index garantit l'unicité par stratégie).\n")
    lines.append("")
    lines.append("## 6 — Limitations\n")
    lines.append("- **Modèle de simulation linéaire** : `leads_sim = leads_observed × multiplier`. Réaliste qualitativement mais ne capture pas la saturation, l'effet réseau, ni le coût d'opportunité.\n")
    lines.append("- Test set de 9 jours seulement (drift J+15 cumulé sur 9 jours en test). Un test plus long affinerait la convergence.\n")
    lines.append("- Le reward = `leads − (1/12.5) × spend` calibré sur kpi_target=12.5€. Si le target change, la calibration aussi.\n")
    lines.append("- Bandits LinUCB / Thompson n'utilisent pas le full feature space comme les arbres river.\n")

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


def generate_all(
    results: list[dict[str, Any]],
    curves: dict[str, pd.DataFrame],
    winner_code: str,
    baseline: dict[str, Any],
    winner_metrics: dict[str, Any],
    train_window: tuple[Any, Any],
    test_window: tuple[Any, Any],
) -> dict[str, str]:
    """Génère les 3 plots + le markdown. Retourne les chemins relatifs."""
    _ensure_dirs()
    paths = {
        "lift_curves": str(ASSETS_DIR / "a4_2_lift_curves.png"),
        "leads_by_tier": str(ASSETS_DIR / "a4_2_leads_by_tier.png"),
        "drift_robustness": str(ASSETS_DIR / "a4_2_drift_robustness.png"),
    }
    plot_lift_curves(curves, Path(paths["lift_curves"]))
    plot_leads_by_tier(results, Path(paths["leads_by_tier"]))
    plot_drift_robustness(results, Path(paths["drift_robustness"]))
    write_report(results, winner_code, baseline, winner_metrics, train_window, test_window, paths)
    return paths
