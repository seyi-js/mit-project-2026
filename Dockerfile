# Demonstration and deployment image.
#
# NOT the environment in which the reported experiment was executed. Chapter 4
# Table 4.1 records that all forty runs ran natively on macOS 26.5.1 (arm64),
# with the software environment fixed as a controlled variable per Section 3.8.
# This image exists so the prototype can be *demonstrated* on a server with the
# same pinned software versions and a co-located database. It is not used to
# produce results and the experiment should not be re-run inside it.
#
# Node is pinned to the exact version recorded in ENVIRONMENT.md.
FROM node:24.4.0-bookworm-slim

WORKDIR /app

# Install dependencies from the lockfile only, so the pinned versions in
# package-lock.json are reproduced exactly rather than re-resolved.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY README.md ENVIRONMENT.md ./

# The demonstration dashboard is the only process exposed. It starts the
# provider simulators and the orchestration service itself, on internal
# loopback ports that are never published (see src/demo/start.js).
ENV PORT=5050
EXPOSE 5050

CMD ["npm", "run", "demo"]
