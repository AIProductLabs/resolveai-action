You are a senior platform engineer. Create a new **public** GitHub repository that defines a reusable GitHub Action to HAND OFF software maintenance jobs to a private runner running in AWS ECS.

Org: AIProductLabs
Repo name: resolveai-action
Action name: resolveai-action
Primary language: TypeScript (Node 20 runtime in Actions)
Package manager: npm
Action type: JavaScript action (bundled with @vercel/ncc)
License: MIT

# Purpose
This action is a thin, auditable SHIM. It collects GitHub context (repo, issue, actor, run), validates inputs, and POSTs a signed job request to a private HTTPS endpoint fronting an ECS service that runs “ResolveAI.” The ECS runner performs the code edits, tests, and PR using its own credentials (ideally via GitHub App). The action itself MUST NOT clone the repo or run ResolveAI locally.

# Files to generate (exact paths)
- action.yml
- package.json
- tsconfig.json
- src/types.ts
- src/schema.ts
- src/crypto.ts
- src/client.ts
- src/index.ts
- .github/workflows/usage_example.yml
- README.md
- SECURITY.md
- LICENSE
- .gitignore

# Action contract
## Inputs (action.yml)
- ecs_endpoint (required): Base URL for ECS job intake, e.g. https://runner.resolveai.example.com/v1/jobs
- ecs_api_token (required, secret): Shared-secret for caller auth
- ecs_hmac_secret (required, secret): Secret for HMAC-SHA256 signing of the exact JSON payload
- action (optional): "run" | "plan" (default "run")
- timeout_seconds (optional): default 120, max 600
- max_retries (optional): default 4
- backoff_ms (optional): default 500
- llm_provider (optional): "openai" | "anthropic"
- model (optional): string (e.g., "gpt-4o-mini")
- allow_write_paths (optional): comma-separated globs → array
- deny_write_paths (optional): comma-separated globs → array
- vectordb_url (optional, secret): forwarded, not logged
- vectordb_token (optional, secret): forwarded, not logged

## Outputs
- job_id: string
- status: "accepted" | "rejected"

## Permissions (document in README; NOT enforced by action)
Recommend callers grant minimal:
- contents: read
- issues: read
- pull-requests: write (only if runner needs GITHUB_TOKEN; prefer GitHub App on runner instead)

# Runtime behavior (src/index.ts)
1) Read inputs and GitHub context (owner, repo, issue number if present, ref, sha, run id/attempt, actor).
2) Validate with zod.
3) Build a JSON payload (use stable key order):
   {
     "idempotency_key": "<owner>/<repo>/<issue_number|null>/<run_id>",
     "timestamp": ISO8601,
     "github": {
       "repository": "owner/repo",
       "issue_number": number | null,
       "ref": env.GITHUB_REF,
       "sha": env.GITHUB_SHA,
       "workflow_run": { "id": env.GITHUB_RUN_ID, "attempt": env.GITHUB_RUN_ATTEMPT },
       "actor": env.GITHUB_ACTOR,
       "token": env.GITHUB_TOKEN // ephemeral; note risks in README
     },
     "job": {
       "action": "run" | "plan",
       "allow_write_paths": string[],
       "deny_write_paths": string[],
       "llm": { "provider": string | null, "model": string | null },
       "vectordb": { "url": string | null }
     },
     "secrets": {
       "forwarded": {
         "vectordb_token": string | null
       }
     }
   }
4) Sign the exact JSON string with HMAC-SHA256 using ecs_hmac_secret.
   - Headers:
     - "X-ResolveAI-Signature: sha256=<hex>"
     - "X-ResolveAI-Token: <ecs_api_token>"
     - "X-ResolveAI-Idempotency-Key: <idempotency_key>"
     - "User-Agent: resolveai-action/<version> (+github actions)"
5) POST to ecs_endpoint. Expect 202 Accepted with body { job_id, status }.
6) Retries with decorrelated jitter on 408/429/5xx/timeouts up to max_retries.
7) Fail fast on non-retryable 4xx.
8) Set outputs (job_id, status). Redact secrets in logs.

# Security requirements
- NEVER log ecs_api_token, ecs_hmac_secret, vectordb_token, or full payload.
- Use a stable JSON stringify (sorted keys) before signing/sending.
- Include idempotency_key and document runner-side at-most-once semantics.
- Prefer runner using a GitHub App; passing GITHUB_TOKEN is optional and discouraged.

# ECS API contract (document in README + SECURITY.md)
- POST /v1/jobs
- Verify:
  - X-ResolveAI-Token equals configured shared secret
  - HMAC over raw body using ecs_hmac_secret matches X-ResolveAI-Signature
  - Idempotency key not previously accepted for same tenant → create job; else return same job_id
- Response: 202 { "job_id": "jr_abc123", "status": "accepted" }
- Return 400 on validation errors; 401/403 on auth errors

# Implementation details
- Use Node 20 / TypeScript.
- HTTP: node-fetch or axios (tiny footprint).
- Zod for schema.
- AbortController for timeouts.
- Backoff with decorrelated jitter.
- Bundle with @vercel/ncc; action.yml uses "dist/index.js".
- .gitignore should exclude node_modules, dist, .DS_Store.

# README.md must include
- What resolveai-action does/doesn’t do
- Inputs/outputs table
- Minimal required permissions and example usage
- How to set secrets
- ECS API verification pseudo-code (HMAC/token/idempotency)
- Guidance to prefer GitHub App on runner (least privilege)
- Example “uses: AIProductLabs/resolveai-action@v1”

# Acceptance criteria
- `npm run build` compiles TS and bundles to dist/index.js.
- Action executes on Node20 runner.
- Logs are minimal and redact secrets.
- Example workflow triggers on label `resolveai:run` and calls the action.

# Now generate files in this order, with full content:

1) action.yml
2) package.json  // include scripts: build (tsc+ncc), package (ncc only), lint (tsc --noEmit)
3) tsconfig.json
4) src/types.ts
5) src/schema.ts
6) src/crypto.ts
7) src/client.ts
8) src/index.ts
9) .github/workflows/usage_example.yml
10) README.md
11) SECURITY.md
12) LICENSE
13) .gitignore

## Conventions
- Use import type where appropriate.
- Pin minimal dependencies; include versions as caret ranges.
- In README usage, show:
  uses: AIProductLabs/resolveai-action@v1
  with:
    ecs_endpoint: ${{ secrets.RESOLVEAI_ECS_ENDPOINT }}
    ecs_api_token: ${{ secrets.RESOLVEAI_ECS_API_TOKEN }}
    ecs_hmac_secret: ${{ secrets.RESOLVEAI_ECS_HMAC_SECRET }}
    action: run
    allow_write_paths: "src/**,tests/**"
    deny_write_paths: "infra/**,scripts/release.sh"