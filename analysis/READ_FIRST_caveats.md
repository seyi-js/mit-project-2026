# Read before drafting Chapter 4

These files contain results from 400,000 logged transactions (4 strategies × 10 runs
× 10,000 transactions). Several figures in them are **confounded and must not be
cited**. This note says which, and why.

---

## Use the 0.6 threshold files, not 0.5

`stats_threshold_0.6.txt` is the primary results file.

The default degradation threshold specified in Chapter 3 is 0.5, but at 0.5 **no
provider is ever flagged as degraded in any run**, so adaptation latency and
recovery time are both empty (8 testable comparisons instead of 14).

This is a property of the specified formula, not a bug. With the Chapter 3 weights
(w1=0.25 latency, w2=0.50 errors, w3=0.25 timeouts), the worst `observed_value` for
any single realistic fault is exactly 0.50:

- timeout: `0.25·(1−1) + 0.50·(1−0) + 0.25·(1−1)` = **0.50**
- fast decline: `0.25·(1−0) + 0.50·(1−1) + 0.25·(1−0)` = **0.50**

Since the EWMA starts at the neutral 0.5 and blends toward 0.5, HealthScore
approaches 0.5 asymptotically from above and never crosses it. Observed minimum
across 9,601 updates on one provider: **0.501313**. A threshold of 0.5 with a
strict `<` comparison therefore cannot fire.

**Report this as a finding.** It means the brief's 0.4/0.6 sensitivity analysis is
load-bearing rather than optional.

---

## DO NOT CITE: `Adaptation latency [CONFOUNDED-do not cite]`

`stats_threshold_0.6.txt` contains a row with that literal label showing
`p<0.001, d=-1.87` in adaptive's favour. **It is false.** It is preserved in the
output only so the error is visible next to its correction.

Different strategies detect different subsets of the 7 fault events, because a
strategy only detects a fault on a provider it actually dispatches to:

| | events detected |
|---|---|
| single-provider | 2 of 7 (only Provider A's) |
| cascading-failover | 2 of 7 (only Provider A's) |
| static-rule-based | 5 of 7 |
| adaptive-health-scored | 4 of 7 |

Averaging over different event sets is not a comparison. There is also a censoring
bias: adaptive detects Provider A's `intermittent_timeout` in only **5 of 10 runs**
versus 10/10 for every baseline, and those misses are dropped as null rather than
penalised — so adaptive's mean is computed over its successes only.

**The valid result** is in the `Adaptation latency (COMMON events)` rows, restricted
to events both strategies detected in every run:

- vs cascading-failover: p = 0.672, negligible effect
- vs single-provider: p = 0.786, negligible effect
- vs static-rule-based: p = 0.789, negligible effect

**There is no significant difference in adaptation latency.** Report it as a null
result.

---

## Response time: use the successes-only column against single-provider

`responseTimeMean` (all transactions) mixes successes with failures, so a strategy
that fails fast looks quicker than one that succeeds slowly.

| Strategy | all tx | successes only | failures only |
|---|---|---|---|
| single-provider | 45.3ms | **3.80ms** | 743ms |
| static-rule-based | 76.2ms | 50.3ms | 565ms |
| cascading-failover | 39.1ms | 39.1ms | — |
| adaptive-health-scored | 15.5ms | 15.5ms | — |

single-provider's 45.3ms is almost entirely its slow failures being averaged in. On
successful transactions it is **3.80ms — roughly 4× faster than adaptive**
(p=8.8e-14, d=+8.99, *against* the adaptive strategy).

- **Valid**: adaptive beats cascading (15.5 vs 39.1ms) and static (15.5 vs 50.3ms).
- **Invalid**: the apparent advantage over single-provider. Report that
  single-provider is faster when it succeeds, and that adaptive carries roughly
  11.7ms of per-transaction ranking overhead (a ProviderHealth query per routing
  decision). This is a genuine cost of adaptivity and should be stated.

---

## Transaction success rate measures retries, not adaptivity

Adaptive reaches 100% versus 94.3% (single-provider) and 95.0% (static-rule-based) —
but cascading-failover also reaches 100%. The difference is attributable to *having
a fallback*, not to health-scoring.

With 3 providers and a 3-attempt cap, success rate is **mathematically
order-independent**: every retry-capable strategy attempts the same set of providers,
and P(at least one succeeds) does not depend on the order tried. Adaptive therefore
*cannot* beat cascading on this metric under this design, regardless of the fault
schedule.

**Do not claim improved reliability over cascading-failover.** State the structural
reason; it pre-empts the obvious examiner question.

---

## Other null / negative results to report honestly

- **Recovery time**: 1.0 in every run for every strategy (zero variance) — not
  testable at any threshold. With α=0.3, a single successful dispatch restores the
  score above threshold immediately.
- **Failover latency**: cascading-failover **beats** adaptive (8.1ms vs 12.4ms,
  p=4.3e-07, d=+3.44). Adaptive retries far less often, but when it does, its first
  choice was already the healthiest available, so the fallback is a worse option.
- **Two of seven fault events are undetectable by any strategy** — both
  `degraded_latency` events. At w1=0.25, a 2500ms delay (83% of the way to timeout)
  still scores 0.79, far above any threshold tested. The health score is effectively
  blind to pure latency degradation. This is a finding about the weighting.
- **Weight sensitivity**: the adaptation-latency ordering holds under 3 of 5
  weightings and collapses to a tie under error-heavy and timeout-heavy. See
  `sensitivity.txt`.

---

## What the results DO support

In order of strength:

0. **THE HEADLINE — first-attempt success *during fault windows*: 97.19% (sd 0.37)
   vs 77.78–81.72%**, p ≈ 1e-19 to 1e-22, **Cohen's d = 19.5–26.8**.

   Only 26% of transactions fall inside a fault window; the other 74% occur while
   every provider is healthy and routing choice is irrelevant. Averaging across the
   whole run therefore dilutes the effect roughly fourfold. Split by condition:

   | Strategy | outside windows | inside windows | misrouted 1st attempts |
   |---|---|---|---|
   | single-provider | 99.76% | 78.85% | 26.92% (sd 0.00) |
   | static-rule-based | 99.60% | 81.72% | 31.61% |
   | cascading-failover | 99.82% | 77.78% | 26.92% (sd 0.00) |
   | adaptive-health-scored | 99.60% | **97.19%** | **5.36%** |

   "Misrouted" = first attempt sent to a provider that was degraded at that moment.
   Adaptive reduces this 5–6× with **complete separation** (rank-biserial = 1.00;
   every adaptive run beat every baseline run).

   Two points worth stating explicitly:

   - Cascading and single-provider misroute at an *identical* 26.92% with sd = 0.00
     — the base rate, because both always try Provider A first and exercise no
     routing judgement. Static-rule-based is *worse than chance* (31.61%) because
     its fixed weights send half its traffic to A, which carries two of the seven
     fault events. Only the adaptive strategy makes a decision at all.
   - Adaptive's residual 5.36% is approximately its own **exploration budget**: it
     deliberately routes 10% of first attempts away from the top-ranked provider,
     which with one of three providers degraded predicts ~5% landing on a faulted
     one. The 90% exploitation path is therefore almost never misrouting — the
     remaining errors are by design, not detection failures.

   **The honest counterpart**: outside fault windows adaptive is *slightly worse* —
   99.60% vs 99.82% for cascading (p=0.007, d=-1.35). This is the cost of
   exploration, paid while conditions are calm. The study therefore quantifies the
   exploration/exploitation tradeoff empirically: ~0.2 percentage points conceded
   under healthy conditions to gain ~19 points under degradation.

1. **First-attempt success rate (whole run): 98.97% (sd 0.16) vs 94.09–94.95%**,
   p ≈ 1e-19, Cohen's d = 18–22 against all three baselines. Unconfounded by retries,
   outcome-mixing or event subsetting — this is the measure that isolates routing
   quality from retry capability. Note it is **not** one of Section 7's six DVs; it is
   derived from the same logged data and was added because the Section 7 definitions
   cannot separate good routing from simply retrying. Prefer the condition-split
   version above; this whole-run figure understates the effect.
2. **Retried transactions: 102.5 vs 590.9 per run** (d = -18.8) — a direct
   consequence of (1).
3. **Response time vs cascading and static** — 15.5ms vs 39.1ms / 50.3ms on
   successes.

**Suggested framing**: under provider degradation, health-scored routing selects a
healthy provider on the first attempt 97.2% of the time versus 77.8–81.7% for all
three baselines, reducing misrouted first attempts 5–6×. This yields ~5.7× fewer
provider calls and materially lower latency than retry-based alternatives. The cost
is ~0.2 percentage points of first-attempt accuracy under healthy conditions (the
exploration budget) plus ~11.7ms per transaction of ranking overhead. Final
transaction success rate is provably insensitive to routing under this
configuration — with three providers and a three-attempt cap, every retry-capable
strategy attempts the same set — so it cannot discriminate between strategies and
should not be presented as evidence either way.

---

## Experimental environment

- Node.js 24.4.0, npm 11.4.2, Express 5.2.1, Mongoose 8.24.4 (mongodb driver 6.20.0,
  bson 6.10.4), MongoDB 8.0.1, dotenv 17.4.2, Jest 30.5.1, supertest 7.2.2
- Analysis: Python 3.14.6, scipy 1.18.1, numpy 2.5.3
- macOS 26.5.1 (build 25F80), arm64 — all 40 runs on a single machine
- Fault schedule `chapter4-default-v1`, replayed identically across all runs
- An initial 40-run execution (227 min) was **discarded** due to a circuit-breaker
  defect that stranded breakers open for the remainder of a run; the dataset here is
  from the second execution (279 min).
