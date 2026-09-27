# Chapter 4 — Evidence Pack

Generated 2026-09-27 by `npm run evidence`.

Every exhibit below was captured by running the prototype, not transcribed by hand.
Exhibits A–H were produced live against an isolated database (`apo-evidence`), which the
script drops and rebuilds on each execution, so the experimental dataset is never modified.
Exhibits I and J are read-only queries against the experimental database that Chapter 4 reports.

---

## Exhibit A — The orchestration service is running

**Evidences:** Working web/API prototype

```
$ curl -s -X GET http://127.0.0.1:3000/health
{
  "status": "ok"
}
```

## Exhibit B — The active routing strategy is selectable at runtime

**Evidences:** API endpoints; the strategy is the only variable across the four experimental conditions

```
$ curl -s -X GET http://127.0.0.1:3000/strategy
{
  "strategy": null
}
$ curl -s -X PUT http://127.0.0.1:3000/strategy \
       -d '{"strategy":"adaptive-health-scored"}'
{
  "strategy": "adaptive-health-scored"
}
$ curl -s -X GET http://127.0.0.1:3000/strategy
{
  "strategy": "adaptive-health-scored"
}
```

## Exhibit C — A payment request is accepted and orchestrated

**Evidences:** API endpoints for payment requests

```
$ curl -s -X POST http://127.0.0.1:3000/transactions \
       -d '{"runId":"evidence","transactionIndex":1}'
{
  "runId": "evidence",
  "transactionIndex": 1,
  "strategy": "adaptive-health-scored",
  "finalOutcome": "success",
  "attempts": [
    {
      "attemptNumber": 1,
      "providerId": "A",
      "dispatchedAt": "2026-09-27T10:11:59.428Z",
      "respondedAt": "2026-09-27T10:11:59.491Z",
      "latencyMs": 17,
      "outcome": "success"
    }
  ],
  "transactionLogId": "6ab8ebef3988f377849ea582"
}
```

## Exhibit D — A fault is injected into Provider A at runtime

**Evidences:** Provider simulation services; fault-injection evidence

```
$ curl -s -X GET http://127.0.0.1:4000/providers/A/fault
{
  "providerId": "A",
  "faultType": null,
  "params": {}
}
$ curl -s -X PUT http://127.0.0.1:4000/providers/A/fault \
       -d '{"faultType":"elevated_error_rate","params":{"errorRate":1}}'
{
  "providerId": "A",
  "faultType": "elevated_error_rate",
  "params": {
    "errorRate": 1
  }
}
```

## Exhibit E — A failed dispatch is retried on a different provider

**Evidences:** Routing decision logs; retry/failover implementation

```
$ curl -s -X POST http://127.0.0.1:3000/transactions \
       -d '{"runId":"evidence","transactionIndex":22}'
{
  "runId": "evidence",
  "transactionIndex": 22,
  "strategy": "adaptive-health-scored",
  "finalOutcome": "success",
  "attempts": [
    {
      "attemptNumber": 1,
      "providerId": "A",
      "dispatchedAt": "2026-09-27T10:11:59.740Z",
      "respondedAt": "2026-09-27T10:11:59.745Z",
      "latencyMs": 1,
      "outcome": "error"
    },
    {
      "attemptNumber": 2,
      "providerId": "B",
      "dispatchedAt": "2026-09-27T10:11:59.749Z",
      "respondedAt": "2026-09-27T10:11:59.753Z",
      "latencyMs": 2,
      "outcome": "success"
    }
  ],
  "transactionLogId": "6ab8ebef3988f377849ea646"
}
```

## Exhibit F — The Analyser lowered the faulted provider’s HealthScore

**Evidences:** MongoDB containing provider health information

```
  Provider A: healthScore=0.849721  observations=21
  Provider B: healthScore=0.755000  observations=2
```

## Exhibit G — The circuit breaker opens after five consecutive failures

**Evidences:** Circuit-breaker implementation. Note that short-circuited attempts report latencyMs=0, which is the signature the analysis pipeline uses to exclude non-observations from the health score.

```
(strategy switched to single-provider, so every request targets the faulted Provider A)

  tx 100: provider=A outcome=error latencyMs=2 final=failed
  tx 101: provider=A outcome=error latencyMs=1 final=failed
  tx 102: provider=A outcome=error latencyMs=1 final=failed
  tx 103: provider=A outcome=error latencyMs=2 final=failed
  tx 104: provider=A outcome=error latencyMs=0 final=failed
  tx 105: provider=A outcome=error latencyMs=0 final=failed
  tx 106: provider=A outcome=error latencyMs=0 final=failed

  --- CircuitBreakerState collection ---
  Provider A: state=open consecutiveFailures=5 blockedAttempts=3
  Provider B: state=closed consecutiveFailures=0 blockedAttempts=0
```

## Exhibit H — A resubmitted transaction is not processed twice

**Evidences:** Idempotency mechanism

```
# first submission
$ curl -s -X POST http://127.0.0.1:3000/transactions \
       -d '{"runId":"evidence","transactionIndex":200,"transactionId":"PAY-2026-0001"}'
{
  "runId": "evidence",
  "transactionIndex": 200,
  "strategy": "cascading-failover",
  "finalOutcome": "success",
  "attempts": [
    {
      "attemptNumber": 1,
      "providerId": "A",
      "dispatchedAt": "2026-09-27T10:11:59.860Z",
      "respondedAt": "2026-09-27T10:11:59.862Z",
      "latencyMs": 0,
      "outcome": "error"
    },
    {
      "attemptNumber": 2,
      "providerId": "B",
      "dispatchedAt": "2026-09-27T10:11:59.862Z",
      "respondedAt": "2026-09-27T10:11:59.865Z",
      "latencyMs": 2,
      "outcome": "success"
    }
  ],
  "transactionLogId": "6ab8ebef3988f377849ea67c"
}
# duplicate submission, declaring transactionIndex 201
$ curl -s -X POST http://127.0.0.1:3000/transactions \
       -d '{"runId":"evidence","transactionIndex":201,"transactionId":"PAY-2026-0001"}'
{
  "runId": "evidence",
  "transactionIndex": 200,
  "strategy": "cascading-failover",
  "finalOutcome": "success",
  "attempts": [
    {
      "attemptNumber": 1,
      "providerId": "A",
      "dispatchedAt": "2026-09-27T10:11:59.860Z",
      "respondedAt": "2026-09-27T10:11:59.862Z",
      "latencyMs": 0,
      "outcome": "error"
    },
    {
      "attemptNumber": 2,
      "providerId": "B",
      "dispatchedAt": "2026-09-27T10:11:59.862Z",
      "respondedAt": "2026-09-27T10:11:59.865Z",
      "latencyMs": 2,
      "outcome": "success"
    }
  ],
  "transactionLogId": "6ab8ebef3988f377849ea67c"
}
  first  transactionLogId: 6ab8ebef3988f377849ea67c
  second transactionLogId: 6ab8ebef3988f377849ea67c
  identical: true
  the duplicate returned transactionIndex 200, not 201 - the retry sequence never re-executed
  TransactionLog documents written for both submissions: 1
```

## Exhibit I — The experimental dataset as stored

**Evidences:** MongoDB/database contents; scale of the evaluation

```
  transactionlogs        documents: 400000
  providerhealths        documents: 3
  circuitbreakerstates   documents: 3
  routingconfigs         documents: 1
  faultschedules         documents: 1
  distinct experimental runs: 40
```

## Exhibit J — A real logged transaction from the experiment

**Evidences:** Routing decision logs, retry/failover and fault injection, in one record from the reported dataset

```
  (inside fault window E3: Provider A under intermittent timeout, transactions 3500-3900)
{
  "_id": "6aaf38c6084feb30c60d9fa3",
  "runId": "adaptive-health-scored-run-1",
  "strategy": "adaptive-health-scored",
  "transactionIndex": 3502,
  "attempts": [
    {
      "attemptNumber": 1,
      "providerId": "A",
      "dispatchedAt": "2026-09-20T01:37:07.814Z",
      "respondedAt": "2026-09-20T01:37:10.831Z",
      "latencyMs": 3000,
      "outcome": "timeout"
    },
    {
      "attemptNumber": 2,
      "providerId": "B",
      "dispatchedAt": "2026-09-20T01:37:10.851Z",
      "respondedAt": "2026-09-20T01:37:10.855Z",
      "latencyMs": 2,
      "outcome": "success"
    }
  ],
  "finalOutcome": "success",
  "completedAt": "2026-09-20T01:37:10.865Z",
  "createdAt": "2026-09-20T01:37:10.866Z",
  "updatedAt": "2026-09-20T01:37:10.866Z",
  "__v": 0
}
```
