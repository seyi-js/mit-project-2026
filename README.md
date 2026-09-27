# Adaptive Payment Orchestration Framework

A prototype cloud-based payment orchestration service built on the MAPE-K autonomic
control loop, together with the controlled experiment used to evaluate it.

Accompanies Chapter 4 of *Design and Evaluation of an Adaptive Payment Orchestration
Framework for Improving Reliability in Cloud-Based Payment Systems*.

The service routes payment requests across three providers using one of four
interchangeable strategies, continuously scoring each provider's health from observed
latency, errors and timeouts, and adapting its routing accordingly. The experiment
compares the adaptive strategy against three conventional baselines over 400,000
logged transactions.

## Prerequisites

- Node.js 24.4.0 and npm 11.4.2
- MongoDB 8.0.1 running locally on the default port
- Python 3.14 (for the statistical analysis and figures only)

Exact pinned versions, and why each is pinned, are in [ENVIRONMENT.md](ENVIRONMENT.md).
These are controlled variables of the experiment.

## Setup

```bash
npm install
cp .env.example .env          # defaults point at a local MongoDB
```

For the analysis and figure scripts:

```bash
python3 -m venv analysis/venv
analysis/venv/bin/pip install scipy numpy matplotlib
```

## Seeing it work

The quickest way is the live dashboard:

```bash
npm run demo
```

This starts the provider simulators, the orchestration service and a dashboard
together, and prints a URL (http://127.0.0.1:5050). The dashboard shows each
provider's health score updating in real time, which strategy is active, where
first attempts are being routed, and a live transaction feed. Faults can be
injected into any provider from the page, and the routing strategy switched
while traffic is running.

It runs against an isolated database (`apo-demo`) which it drops and rebuilds on
each launch, so a demonstration never modifies the experimental dataset. Ctrl+C
stops everything.

The dashboard is a separate process that drives the orchestration service over
HTTP and reads the Knowledge Store for display. It imports none of the modules
whose behaviour Chapter 4 measures, so it cannot affect the evaluated code path.

### Driving the service directly


To drive the API by hand instead, start the two processes yourself. In one terminal:

```bash
npm run start:providers       # port 4000
```

In another, start the orchestration service:

```bash
npm start                     # port 3000
```

Select a routing strategy and submit a payment:

```bash
curl -X PUT http://127.0.0.1:3000/strategy \
  -H 'Content-Type: application/json' \
  -d '{"strategy":"adaptive-health-scored"}'

curl -X POST http://127.0.0.1:3000/transactions \
  -H 'Content-Type: application/json' \
  -d '{"runId":"demo","transactionIndex":1}'
```

The response records every dispatch attempt, the provider chosen, its outcome and its
latency. To watch the framework adapt, inject a fault into a provider and submit more
transactions:

```bash
curl -X PUT http://127.0.0.1:4000/providers/A/fault \
  -H 'Content-Type: application/json' \
  -d '{"faultType":"elevated_error_rate","params":{"errorRate":1.0}}'
```

Subsequent transactions will fail on Provider A, its health score will fall, and the
adaptive strategy will route away from it. Clear the fault with `DELETE` on the same URL.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service liveness |
| `GET` | `/strategy` | The active routing strategy |
| `PUT` | `/strategy` | Select a routing strategy |
| `POST` | `/transactions` | Submit a payment request |
| `GET`/`PUT`/`DELETE` | `:4000/providers/:id/fault` | Inspect, set or clear a provider's fault |

## Tests

```bash
npm test
```

142 tests across 23 suites, covering the health-scoring formulas, the circuit-breaker
state machine, the idempotency guard, all four routing strategies, the Monitor, the
Analyser, the provider simulator, the fault applier, the experiment runner and the
metric computations.

## Reproducing the experiment

**This takes approximately 279 minutes** and writes 400,000 documents. It executes 10
independent runs of 10,000 transactions for each of the four strategies, against an
identical fault schedule, resetting all provider health and circuit-breaker state
between runs.

```bash
npm run start:providers       # must be running
npm run experiment:all
```

A single run, for a quicker check:

```bash
npm run experiment
```

## Reproducing the analysis

Against an existing experimental dataset, in order:

```bash
npm run analyse:metrics       # per-run metric values -> analysis/run_metrics*.json
npm run analyse:conditions    # first-attempt rates split by fault window
npm run analyse:sensitivity   # threshold and weight sensitivity
npm run analyse:stats         # significance tests -> analysis/stats_threshold_*.txt
```

Then the figure inputs and the figures themselves:

```bash
node src/analysis/exportTransactionData.js   # per-transaction export (28 MB)
node src/analysis/reconstructHealth.js       # health trajectories (6.8 MB)
analysis/venv/bin/python analysis/figures.py # -> analysis/figures/*.png
```

`reconstructHealth.js` rebuilds each run's provider health history, which is not
persisted during execution, by replaying the logged observations through the same
scoring functions the experiment used. It validates itself against the final scores
still held in the `ProviderHealth` collection and reports the maximum absolute error,
which is 0.

## Regenerating the evidence pack

```bash
npm run evidence              # -> analysis/evidence/evidence-pack.md
```

Starts the service and providers, drives them over HTTP, and records the actual
requests and responses for each component of the framework. It runs against an
isolated database (`apo-evidence`) which it drops and rebuilds each time, so the
experimental dataset is never modified.

## Repository layout

```
src/
  api/          Transaction API and the per-transaction orchestration pipeline
  monitor/      MAPE-K Monitor: records latency, error and timeout signals
  analyser/     MAPE-K Analyser: health-scoring formulas (pure) and persistence
  planner/      MAPE-K Planner: strategy interface and the four routing strategies
  executor/     Guarded dispatch: circuit breaker, idempotency, provider client
  models/       Mongoose schemas for the Knowledge Store
  providers/    Three independent simulated providers with runtime fault injection
  experiment/   Run orchestration, fault-schedule replay, state reset
  analysis/     Metric computation, condition splitting, sensitivity, exports
  evidence/     Evidence-pack capture
analysis/       Results, statistics, figures and the evidence pack
tests/          142 tests across 23 suites
```

## Reading the results

Start with [analysis/READ_FIRST_caveats.md](analysis/READ_FIRST_caveats.md). Several
reported metrics do not discriminate between the strategies, and two are confounded;
that document says which, why, and which figures should not be cited. It should be
read before any number in `analysis/` is quoted.

Large intermediate exports (`analysis/transaction_data.csv`, `analysis/health_timeseries/`)
are not committed. Both rebuild from the transaction log in about a minute using the
commands above.
