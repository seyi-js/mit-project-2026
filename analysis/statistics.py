"""
Section 10 statistical analysis: compares the adaptive strategy against each
baseline, separately, for every dependent variable.

Reads analysis/run_metrics.json (produced by `npm run analyse:metrics`, which
computes the 6 DVs per run in Node so it can reuse the live HealthScore
formulas) and applies the Chapter 3 procedure:

    Shapiro-Wilk  ->  normal?  ->  independent-samples t-test + Cohen's d
                  ->  not normal?  ->  Mann-Whitney U + rank-biserial
    alpha = 0.05, p-value and effect size always reported together.

scipy.stats is used rather than hand-rolled implementations so the tests are
the standard, citable ones — Shapiro-Wilk in particular is not something to
reimplement.
"""

import json
import os
import sys

import numpy as np
from scipy import stats

ALPHA = 0.05
ADAPTIVE = "adaptive-health-scored"

# (json key, display name, whether lower is better)
METRICS = [
    ("successRate", "Transaction success rate", False),
    ("responseTimeMean", "Response time (mean, ms)", True),
    ("responseTimeP95", "Response time (p95, ms)", True),
    ("failoverLatencyMean", "Failover latency (mean, ms)", True),
    ("adaptationLatencyMean", "Adaptation latency (transactions)", True),
    ("recoveryTimeMean", "Recovery time (transactions)", True),
]


def cohens_d(a, b):
    """Pooled-SD standardised mean difference."""
    na, nb = len(a), len(b)
    pooled_var = ((na - 1) * np.var(a, ddof=1) + (nb - 1) * np.var(b, ddof=1)) / (na + nb - 2)
    if pooled_var == 0:
        return None
    return (np.mean(a) - np.mean(b)) / np.sqrt(pooled_var)


def rank_biserial(a, b, u_statistic):
    """Effect size matching Mann-Whitney U: 1 - 2U/(n1*n2), range [-1, 1]."""
    return 1 - (2 * u_statistic) / (len(a) * len(b))


def interpret_d(d):
    ad = abs(d)
    if ad < 0.2:
        return "negligible"
    if ad < 0.5:
        return "small"
    if ad < 0.8:
        return "medium"
    return "large"


def compare(adaptive_vals, baseline_vals):
    """Runs the Chapter 3 decision procedure on one metric for one pairing."""
    a = [v for v in adaptive_vals if v is not None]
    b = [v for v in baseline_vals if v is not None]

    if len(a) < 3 or len(b) < 3:
        return {
            "testable": False,
            "reason": f"insufficient data (adaptive n={len(a)}, baseline n={len(b)}); "
                      "metric is undefined for at least one strategy",
        }

    # Zero variance in BOTH groups makes every test undefined: Shapiro-Wilk
    # has no distribution to assess, the t-statistic is 0/0, Mann-Whitney's
    # ranks are all tied, and Cohen's d divides by a pooled SD of zero.
    a_const = np.var(a) == 0
    b_const = np.var(b) == 0
    if a_const and b_const:
        if np.mean(a) == np.mean(b):
            return {
                "testable": False,
                "reason": f"both groups constant at identical value {np.mean(a):.4f} — "
                          "no test is defined (identical, zero-variance samples)",
            }
        return {
            "testable": False,
            "reason": f"both groups constant ({np.mean(a):.4f} vs {np.mean(b):.4f}) — "
                      "difference is deterministic, no variance to test",
        }

    # Shapiro-Wilk on each group; a constant group cannot be assessed and is
    # treated as non-normal, routing the pair to the non-parametric branch.
    if a_const or b_const:
        normal = False
        sw_a = sw_b = None
    else:
        sw_a = stats.shapiro(a)
        sw_b = stats.shapiro(b)
        normal = sw_a.pvalue > ALPHA and sw_b.pvalue > ALPHA

    if normal:
        result = stats.ttest_ind(a, b, equal_var=True)
        d = cohens_d(a, b)
        return {
            "testable": True,
            "normality": f"Shapiro-Wilk p={sw_a.pvalue:.4f} / {sw_b.pvalue:.4f} (normal)",
            "test": "Independent-samples t-test",
            "statistic": float(result.statistic),
            "p_value": float(result.pvalue),
            "effect_name": "Cohen's d",
            "effect_size": float(d) if d is not None else None,
            "effect_label": interpret_d(d) if d is not None else "undefined",
            "adaptive_mean": float(np.mean(a)),
            "baseline_mean": float(np.mean(b)),
        }

    result = stats.mannwhitneyu(a, b, alternative="two-sided")
    r = rank_biserial(a, b, result.statistic)
    normality_note = (
        "one group constant — non-parametric branch"
        if (a_const or b_const)
        else f"Shapiro-Wilk p={sw_a.pvalue:.4f} / {sw_b.pvalue:.4f} (non-normal)"
    )
    return {
        "testable": True,
        "normality": normality_note,
        "test": "Mann-Whitney U",
        "statistic": float(result.statistic),
        "p_value": float(result.pvalue),
        "effect_name": "rank-biserial r",
        "effect_size": float(r),
        "effect_label": interpret_d(r),
        "adaptive_mean": float(np.mean(a)),
        "baseline_mean": float(np.mean(b)),
    }


def main():
    path = os.path.join(os.path.dirname(__file__), "run_metrics.json")
    if not os.path.exists(path):
        sys.exit(f"{path} not found — run `npm run analyse:metrics` first")

    with open(path) as f:
        payload = json.load(f)

    results = payload["results"]
    threshold = payload["degradationThreshold"]
    baselines = [s for s in results if s != ADAPTIVE]

    print(f"Degradation threshold: {threshold}   |   alpha = {ALPHA}")
    print(f"Fault schedule: {payload['scheduleId']}")
    print(f"Runs per strategy: {len(results[ADAPTIVE])}\n")

    summary = {}
    for key, label, lower_better in METRICS:
        print("=" * 100)
        print(f"{label}")
        print("=" * 100)
        adaptive_vals = [r[key] for r in results[ADAPTIVE]]

        for baseline in sorted(baselines):
            baseline_vals = [r[key] for r in results[baseline]]
            outcome = compare(adaptive_vals, baseline_vals)
            summary[(label, baseline)] = outcome

            print(f"\n  {ADAPTIVE}  vs  {baseline}")
            if not outcome["testable"]:
                print(f"    NOT TESTABLE — {outcome['reason']}")
                continue

            direction = "better" if (
                (outcome["adaptive_mean"] < outcome["baseline_mean"]) == lower_better
            ) else "worse"
            sig = "SIGNIFICANT" if outcome["p_value"] < ALPHA else "not significant"

            print(f"    means:      adaptive {outcome['adaptive_mean']:.4f}  |  "
                  f"baseline {outcome['baseline_mean']:.4f}   ({direction} for adaptive)")
            print(f"    normality:  {outcome['normality']}")
            print(f"    test:       {outcome['test']}, statistic={outcome['statistic']:.4f}")
            print(f"    p-value:    {outcome['p_value']:.6g}   ({sig} at alpha={ALPHA})")
            print(f"    effect:     {outcome['effect_name']} = {outcome['effect_size']:.4f} "
                  f"({outcome['effect_label']})")
        print()

    # Chapter 4 summary table
    print("=" * 100)
    print("SUMMARY — adaptive vs each baseline")
    print("=" * 100)
    header = f"{'Metric':<36} {'Baseline':<24} {'p-value':<14} {'Effect size':<22} {'Verdict'}"
    print(header)
    print("-" * 100)
    for (label, baseline), outcome in summary.items():
        if not outcome["testable"]:
            print(f"{label:<36} {baseline:<24} {'n/a':<14} {'n/a':<22} not testable")
        else:
            sig = "significant" if outcome["p_value"] < ALPHA else "not significant"
            eff = f"{outcome['effect_name']}={outcome['effect_size']:.3f}"
            print(f"{label:<36} {baseline:<24} {outcome['p_value']:<14.6g} {eff:<22} {sig}")


if __name__ == "__main__":
    main()
