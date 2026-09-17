# Fixed Software & Hardware Environment

Recorded per Chapter 3 Section 1 — these are controlled variables of the
experiment and must not change between any of the 40 experimental runs.

## Software (pinned exact versions)

| Component | Version |
| --- | --- |
| Node.js | 24.4.0 |
| npm | 11.4.2 |
| Express | 5.2.1 |
| Mongoose | 8.24.4 (bundles mongodb driver 6.20.0 / bson 6.10.4) |
| MongoDB | 8.0.1 |
| dotenv | 17.4.2 |
| jest (test runner) | 30.5.1 |
| supertest | 7.2.2 |
| nodemon (dev only, not used in experimental runs) | 3.1.14 |

Exact versions are also pinned (no `^`/`~` ranges) in `package.json` /
`package-lock.json`.

**Note:** originally pinned Mongoose 9.10.0 (bson 7.3.2 / mongodb driver 7.6.0),
but that combination has a real bug under Jest's sandboxed VM test environment —
`MongooseServerSelectionError: Missing required sub-document 'driver' in the
client metadata document` on every connection attempt from a test file, while
connecting from a plain `node` script worked fine. Downgraded to Mongoose 8.24.4
(driver 6.20.0 / bson 6.10.4), which does not exhibit the bug, and re-pinned.

## Hardware / machine

| | |
| --- | --- |
| OS | macOS 26.5.1 (build 25F80) |
| Architecture | arm64 |

All 40 experimental runs (Section 9) must execute on this same machine.
