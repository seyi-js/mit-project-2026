"""Generates the Chapter 4 figures from the logged experimental data.

Inputs (all produced by the analysis pipeline, none re-simulated):
  analysis/transaction_data.csv          one row per logged transaction
  analysis/health_timeseries/*.csv       reconstructed HealthScore trajectories
  analysis/run_metrics_threshold_*.json  per-run metric values
  analysis/condition_split.json          first-attempt rates split by fault window

Output: analysis/figures/*.png at 300 dpi.
"""
import csv
import json
import os
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch

BASE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(BASE, "figures")
os.makedirs(FIG, exist_ok=True)

# Strategy order is fixed everywhere: the three baselines in increasing
# capability, then the proposed strategy last.
STRATEGIES = ["single-provider", "static-rule-based", "cascading-failover", "adaptive-health-scored"]
LABELS = {
    "single-provider": "Single\nprovider",
    "static-rule-based": "Static\nrule-based",
    "cascading-failover": "Cascading\nfailover",
    "adaptive-health-scored": "Adaptive\nhealth-scored",
}
# Okabe-Ito palette: distinguishable under all common forms of colour vision
# deficiency and in greyscale. Baselines muted, proposed strategy emphasised.
COLOURS = {
    "single-provider": "#999999",
    "static-rule-based": "#56B4E9",
    "cascading-failover": "#E69F00",
    "adaptive-health-scored": "#0072B2",
}
PROVIDER_COLOURS = {"A": "#0072B2", "B": "#D55E00", "C": "#009E73"}

FAULT_EVENTS = [
    ("E1", "B", "Degraded latency", 1000, 1500),
    ("E2", "C", "Elevated error rate", 2000, 2400),
    ("E3", "A", "Intermittent timeout", 3500, 3900),
    ("E4", "B", "Full outage", 5000, 5300),
    ("E5", "C", "Degraded latency", 6500, 7000),
    ("E6", "A", "Elevated error rate", 8000, 8300),
    ("E7", "B", "Intermittent timeout", 9000, 9200),
]

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"],
    "font.size": 9,
    "axes.titlesize": 10,
    "axes.labelsize": 9,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "grid.linewidth": 0.6,
    "figure.dpi": 300,
    "savefig.dpi": 300,
    "savefig.bbox": "tight",
})


def save(fig, name):
    path = os.path.join(FIG, name)
    fig.savefig(path, facecolor="white")
    plt.close(fig)
    print(f"  wrote {name}")


# --------------------------------------------------------------------------
# data loading
# --------------------------------------------------------------------------
def load_transactions():
    """Per-transaction rows. Returns dict[strategy] -> dict of numpy arrays."""
    cols = defaultdict(lambda: defaultdict(list))
    with open(os.path.join(BASE, "transaction_data.csv")) as fh:
        for row in csv.DictReader(fh):
            s = cols[row["strategy"]]
            s["rt"].append(int(row["responseTimeMs"]))
            s["success"].append(row["finalOutcome"] == "success")
            s["firstOk"].append(row["firstAttemptOutcome"] == "success")
            s["inside"].append(row["insideWindow"] == "1")
    out = {}
    for strategy, d in cols.items():
        out[strategy] = {k: np.array(v) for k, v in d.items()}
    return out


def load_run_metrics(threshold):
    with open(os.path.join(BASE, f"run_metrics_threshold_{threshold}.json")) as fh:
        return json.load(fh)["results"]


def load_condition_split():
    with open(os.path.join(BASE, "condition_split.json")) as fh:
        return json.load(fh)["results"]


def shade_faults(ax, label_y=None, fontsize=6):
    for code, provider, _kind, start, end in FAULT_EVENTS:
        ax.axvspan(start, end, color=PROVIDER_COLOURS[provider], alpha=0.13, lw=0)
        if label_y is not None:
            ax.text((start + end) / 2, label_y, code, ha="center", va="bottom",
                    fontsize=fontsize, color="#444444")


# --------------------------------------------------------------------------
# Figure 4.1 — response-time distribution (boxplots)
# --------------------------------------------------------------------------
def figure_response_time(tx):
    """Boxplots plus an upper-tail detail.

    The boxes are near-identical across all four strategies: the median
    transaction takes about 3 ms whatever the routing strategy, because 74%
    of transactions occur while every provider is healthy. The reported mean
    differences are produced entirely by the upper tail, so the means are
    marked explicitly and panel (c) shows where the distributions separate.
    """
    fig, axes = plt.subplots(1, 3, figsize=(10.2, 3.7))

    panels = [
        ("(a) All transactions", lambda d: d["rt"]),
        ("(b) Successful transactions only", lambda d: d["rt"][d["success"]]),
    ]
    for ax, (title, pick) in zip(axes[:2], panels):
        data = [pick(tx[s]) for s in STRATEGIES]
        bp = ax.boxplot(data, patch_artist=True, widths=0.55, showfliers=True,
                        showmeans=True, meanprops=dict(marker="D", markersize=4.5,
                                                       markerfacecolor="#B3261E",
                                                       markeredgecolor="white",
                                                       markeredgewidth=0.6),
                        flierprops=dict(marker=".", markersize=1.2, alpha=0.18,
                                        markerfacecolor="#666666", markeredgecolor="none"),
                        medianprops=dict(color="black", lw=1.4),
                        whiskerprops=dict(color="#555555", lw=0.9),
                        capprops=dict(color="#555555", lw=0.9))
        for patch, s in zip(bp["boxes"], STRATEGIES):
            patch.set_facecolor(COLOURS[s]); patch.set_alpha(0.75)
            patch.set_edgecolor("#333333"); patch.set_linewidth(0.8)
        for i, values in enumerate(data, start=1):
            m = np.mean(values)
            ax.text(i, m * 1.9, f"{m:.1f}", fontsize=6.6, color="#B3261E",
                    ha="center", va="bottom")
        ax.set_yscale("symlog", linthresh=1)
        ax.set_xticklabels([LABELS[s] for s in STRATEGIES], fontsize=7)
        ax.set_title(title, loc="left")
        ax.set_ylabel("Response time (ms, symmetric log scale)")
        ax.axhline(3000, color="#B3261E", lw=0.8, ls="--", alpha=0.6)

    ax = axes[2]
    for s in STRATEGIES:
        values = np.sort(tx[s]["rt"])
        y = np.arange(1, values.size + 1) / values.size
        ax.step(np.maximum(values, 1), y, where="post", lw=1.3,
                color=COLOURS[s], label=LABELS[s].replace("\n", " "), alpha=0.9)
    ax.set_xscale("log")
    ax.set_xlim(1, 4000)
    ax.set_ylim(0.90, 1.002)
    ax.axvline(3000, color="#B3261E", lw=0.8, ls="--", alpha=0.6)
    ax.set_xlabel("Response time (ms, log scale)")
    ax.set_ylabel("Cumulative proportion of transactions")
    ax.set_title("(c) Upper-tail detail", loc="left")
    ax.legend(fontsize=6.5, frameon=False, loc="lower right")

    fig.text(0.005, -0.06,
             "Red diamonds mark the mean. Medians sit at 3-4 ms under every strategy; the mean differences "
             "reported in Table 4.12 arise entirely from the upper tail shown in panel (c).",
             fontsize=6.6, color="#555555")
    save(fig, "figure_4_6_response_time_distribution.png")


# --------------------------------------------------------------------------
# Figure 4.2 — provider health over time
# --------------------------------------------------------------------------
def figure_health_over_time():
    fig, axes = plt.subplots(2, 2, figsize=(8.2, 5.2), sharex=True, sharey=True)
    for ax, strategy in zip(axes.flat, STRATEGIES):
        path = os.path.join(BASE, "health_timeseries", f"{strategy}-run-1.csv")
        series = defaultdict(lambda: ([], []))
        with open(path) as fh:
            for row in csv.DictReader(fh):
                xs, ys = series[row["provider"]]
                xs.append(int(row["transactionIndex"]))
                ys.append(float(row["healthScore"]))
        shade_faults(ax, label_y=1.005)
        for provider in ["A", "B", "C"]:
            xs, ys = series[provider]
            if xs:
                ax.plot(xs, ys, lw=0.7, color=PROVIDER_COLOURS[provider],
                        label=f"Provider {provider}", alpha=0.9)
        ax.axhline(0.5, color="#B3261E", lw=0.8, ls="--", alpha=0.8)
        ax.set_title(LABELS[strategy].replace("\n", " "), loc="left")
        ax.set_ylim(0.45, 1.03)
        ax.set_xlim(0, 10000)
    for ax in axes[1]:
        ax.set_xlabel("Transaction index")
    for ax in axes[:, 0]:
        ax.set_ylabel("HealthScore")
    handles = [plt.Line2D([], [], color=PROVIDER_COLOURS[p], lw=1.4, label=f"Provider {p}") for p in "ABC"]
    handles.append(plt.Line2D([], [], color="#B3261E", lw=0.9, ls="--", label="Degradation threshold (0.5)"))
    handles.append(Patch(facecolor="#999999", alpha=0.2, label="Fault window (E1–E7)"))
    fig.legend(handles=handles, loc="lower center", ncol=5, frameon=False,
               bbox_to_anchor=(0.5, -0.04), fontsize=8)
    save(fig, "figure_4_1_provider_health_over_time.png")


# --------------------------------------------------------------------------
# Figure 4.3 — first-attempt success by condition
# --------------------------------------------------------------------------
def figure_condition_split(split):
    fig, ax = plt.subplots(figsize=(6.6, 3.6))
    x = np.arange(len(STRATEGIES))
    width = 0.36
    for offset, key, hatch, tone in [(-width / 2, "outside", "", 0.45), (width / 2, "inside", "//", 0.95)]:
        means = [np.mean(split[s][key]) * 100 for s in STRATEGIES]
        sds = [np.std(split[s][key], ddof=1) * 100 for s in STRATEGIES]
        bars = ax.bar(x + offset, means, width, yerr=sds, capsize=2.5,
                      color=[COLOURS[s] for s in STRATEGIES], alpha=tone,
                      edgecolor="#333333", linewidth=0.7, hatch=hatch,
                      error_kw=dict(lw=0.8, ecolor="#333333"))
        for bar, m in zip(bars, means):
            ax.text(bar.get_x() + bar.get_width() / 2, m + 1.6, f"{m:.1f}",
                    ha="center", fontsize=7)
    ax.set_xticks(x)
    ax.set_xticklabels([LABELS[s] for s in STRATEGIES], fontsize=8)
    ax.set_ylabel("First-attempt success rate (%)")
    ax.set_ylim(0, 112)
    ax.set_yticks([0, 20, 40, 60, 80, 100])
    ax.legend(handles=[
        Patch(facecolor="#888888", alpha=0.45, edgecolor="#333333", label="Outside fault windows (74% of transactions)"),
        Patch(facecolor="#888888", alpha=0.95, edgecolor="#333333", hatch="//", label="Inside fault windows (26% of transactions)"),
    ], loc="lower left", fontsize=7.5, frameon=False)
    save(fig, "figure_4_3_first_attempt_success_by_condition.png")


# --------------------------------------------------------------------------
# Figure 4.4 — transaction success rate, and 4.5 — retries
# --------------------------------------------------------------------------
def figure_success_rate(metrics):
    """Section 4.5.2. The metric cannot discriminate between the two
    retry-capable strategies: with three providers and a three-attempt cap,
    success is order-independent, so both reach exactly 100%."""
    fig, ax = plt.subplots(figsize=(4.6, 3.5))
    data = [[r["successRate"] * 100 for r in metrics[s]] for s in STRATEGIES]
    bp = ax.boxplot(data, patch_artist=True, widths=0.5,
                    medianprops=dict(color="black", lw=1.3))
    for patch, s in zip(bp["boxes"], STRATEGIES):
        patch.set_facecolor(COLOURS[s]); patch.set_alpha(0.75)
        patch.set_edgecolor("#333333"); patch.set_linewidth(0.8)
    ax.set_xticklabels([LABELS[s] for s in STRATEGIES], fontsize=7.5)
    ax.set_ylabel("Transaction success rate (%)")
    ax.set_ylim(93, 101.4)
    ax.annotate("both exactly 100%\n(metric cannot discriminate)",
                xy=(3.5, 100.05), xytext=(2.1, 96.3), fontsize=6.8, color="#B3261E",
                ha="center", arrowprops=dict(arrowstyle="->", color="#B3261E", lw=0.8))
    save(fig, "figure_4_2_transaction_success_rate.png")


def figure_retried_transactions(metrics):
    """Section 4.5.5."""
    fig, ax = plt.subplots(figsize=(4.6, 3.5))
    data = [[r["retriedTransactions"] for r in metrics[s]] for s in STRATEGIES]
    bp = ax.boxplot(data, patch_artist=True, widths=0.5,
                    medianprops=dict(color="black", lw=1.3))
    for patch, s in zip(bp["boxes"], STRATEGIES):
        patch.set_facecolor(COLOURS[s]); patch.set_alpha(0.75)
        patch.set_edgecolor("#333333"); patch.set_linewidth(0.8)
    ax.set_xticklabels([LABELS[s] for s in STRATEGIES], fontsize=7.5)
    ax.set_ylabel("Retried transactions per run")
    ax.annotate("single-provider and static rule-based\nhave no fallback: never retry",
                xy=(1.5, 0), xytext=(1.9, 250), fontsize=6.6, color="#555555", ha="center",
                arrowprops=dict(arrowstyle="->", color="#555555", lw=0.7))
    save(fig, "figure_4_5_retried_transactions.png")


# --------------------------------------------------------------------------
# Figure 4.5 — misrouted first attempts
# --------------------------------------------------------------------------
def figure_misrouting(split):
    fig, ax = plt.subplots(figsize=(6.2, 3.4))
    means = [np.mean(split[s]["misroutedOutcome"]) * 100 for s in STRATEGIES]
    sds = [np.std(split[s]["misroutedOutcome"], ddof=1) * 100 for s in STRATEGIES]
    bars = ax.barh(np.arange(len(STRATEGIES)), means, xerr=sds, capsize=3,
                   color=[COLOURS[s] for s in STRATEGIES], alpha=0.85,
                   edgecolor="#333333", linewidth=0.7, height=0.62,
                   error_kw=dict(lw=0.8, ecolor="#333333"))
    for bar, m, sd, s in zip(bars, means, sds, STRATEGIES):
        ax.text(m + sd + 1.4, bar.get_y() + bar.get_height() / 2, f"{m:.2f}%",
                va="center", fontsize=8,
                fontweight="bold" if s == "adaptive-health-scored" else "normal")
    ax.set_yticks(np.arange(len(STRATEGIES)))
    ax.set_yticklabels([LABELS[s].replace("\n", " ") for s in STRATEGIES], fontsize=8)
    ax.invert_yaxis()
    ax.set_xlabel("First attempts sent to a provider under an active outcome-affecting fault (%)")
    ax.set_xlim(0, 52)
    save(fig, "figure_4_4_misrouted_first_attempts.png")


# --------------------------------------------------------------------------
# Figure 4.6 — adaptation latency per fault event (shows the confound)
# --------------------------------------------------------------------------
def figure_adaptation_latency(metrics06):
    fig, ax = plt.subplots(figsize=(7.4, 3.8))
    n = len(STRATEGIES)
    width = 0.78 / n
    codes = [e[0] for e in FAULT_EVENTS]
    x = np.arange(len(codes))

    for i, strategy in enumerate(STRATEGIES):
        per_event = list(zip(*[r["adaptationByEvent"] for r in metrics06[strategy]]))
        means, detected = [], []
        for values in per_event:
            seen = [v for v in values if v is not None]
            means.append(np.mean(seen) if seen else 0.0)
            detected.append(len(seen))
        offset = (i - (n - 1) / 2) * width
        ax.bar(x + offset, means, width, color=COLOURS[strategy], alpha=0.85,
               edgecolor="#333333", linewidth=0.6,
               label=LABELS[strategy].replace("\n", " "))
        for xi, (m, d) in enumerate(zip(means, detected)):
            if d == 0:
                ax.text(xi + offset, 0.6, "×", ha="center", va="bottom",
                        fontsize=7, color="#B3261E")
            elif d < len(metrics06[strategy]):
                ax.text(xi + offset, m + 0.6, f"{d}/10", ha="center",
                        fontsize=5.6, color="#8A5A00")

    ax.set_xticks(x)
    ax.set_xticklabels([f"{c}\n{p}" for c, (_, p, _, _, _) in zip(codes, FAULT_EVENTS)], fontsize=7.5)
    ax.set_xlabel("Fault event (and affected provider)")
    ax.set_ylabel("Adaptation latency (transactions)")
    ax.legend(fontsize=7, frameon=False, ncol=2)
    ax.text(0.995, 0.97, "×  event never detected by that strategy\nn/10  detected in only n of 10 runs",
            transform=ax.transAxes, fontsize=6.5, va="top", ha="right", color="#555555")
    save(fig, "figure_4_7_adaptation_latency_by_event.png")


if __name__ == "__main__":
    print("Loading data...")
    tx = load_transactions()
    split = load_condition_split()
    metrics05 = load_run_metrics("0.5")
    metrics06 = load_run_metrics("0.6")

    print("Generating figures...")
    figure_response_time(tx)
    figure_health_over_time()
    figure_condition_split(split)
    figure_success_rate(metrics05)
    figure_retried_transactions(metrics05)
    figure_misrouting(split)
    figure_adaptation_latency(metrics06)
    print(f"\nFigures written to {FIG}")
