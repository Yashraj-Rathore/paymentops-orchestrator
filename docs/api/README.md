# API Foundation

The API is versioned under `/v1` once domain routes are added. The foundation milestone exposes:

- `GET /health` for liveness and local smoke checks.
- `/docs` for Swagger UI.
- `/docs-json` for the OpenAPI JSON document.

Future public mutating endpoints must support idempotency and write audit events.
