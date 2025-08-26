# ResolveAI Action

A GitHub Action that hands off software maintenance jobs to a private runner running in AWS ECS.

## What it does

This action is a thin, auditable **shim** that:

- ✅ Collects GitHub context (repository, issue, actor, workflow run)
- ✅ Validates inputs using strict schemas
- ✅ Signs requests with HMAC-SHA256 for security
- ✅ POSTs job requests to your private ECS service
- ❌ Does **NOT** clone repositories or run AI locally
- ❌ Does **NOT** execute code changes directly

The actual AI-powered maintenance work happens on your private ECS runner, which can use its own credentials (preferably a GitHub App) to perform code edits, run tests, and create pull requests.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `ecs_endpoint` | ✅ | | Base URL for ECS job intake (e.g., `https://runner.resolveai.example.com/v1/jobs`) |
| `ecs_api_token` | ✅ | | Shared secret for caller authentication |
| `ecs_hmac_secret` | ✅ | | Secret for HMAC-SHA256 signing of the JSON payload |
| `action` | | `run` | Action type: `run` or `plan` |
| `timeout_seconds` | | `120` | Request timeout in seconds (max 600) |
| `max_retries` | | `4` | Maximum number of retries (max 10) |
| `backoff_ms` | | `500` | Initial backoff delay in milliseconds |
| `llm_provider` | | | LLM provider: `openai` or `anthropic` |
| `model` | | | Model name (e.g., `gpt-4o-mini`, `claude-3-5-sonnet-20241022`) |
| `allow_write_paths` | | | Comma-separated glob patterns for allowed write paths |
| `deny_write_paths` | | | Comma-separated glob patterns for denied write paths |
| `vectordb_url` | | | Vector database URL (forwarded to ECS, not logged) |
| `vectordb_token` | | | Vector database token (forwarded to ECS, not logged) |

## Outputs

| Output | Description |
|--------|-------------|
| `job_id` | Unique job identifier returned by the ECS service |
| `status` | Job status: `accepted` or `rejected` |

## Required Permissions

Grant minimal permissions to the workflow:

```yaml
permissions:
  contents: read        # Required: Read repository content
  issues: read         # Required: Read issue details
  pull-requests: write # Optional: Only if runner needs GITHUB_TOKEN
```

**Recommendation:** Configure your ECS runner to use a GitHub App instead of passing `GITHUB_TOKEN` for better security and more granular permissions.

## Usage

### Basic Usage

```yaml
- name: Submit to ResolveAI
  uses: AIProductLabs/resolveai-action@v1
  with:
    ecs_endpoint: ${{ secrets.RESOLVEAI_ECS_ENDPOINT }}
    ecs_api_token: ${{ secrets.RESOLVEAI_ECS_API_TOKEN }}
    ecs_hmac_secret: ${{ secrets.RESOLVEAI_ECS_HMAC_SECRET }}
```

### Advanced Usage

```yaml
- name: Submit to ResolveAI with constraints
  uses: AIProductLabs/resolveai-action@v1
  with:
    ecs_endpoint: ${{ secrets.RESOLVEAI_ECS_ENDPOINT }}
    ecs_api_token: ${{ secrets.RESOLVEAI_ECS_API_TOKEN }}
    ecs_hmac_secret: ${{ secrets.RESOLVEAI_ECS_HMAC_SECRET }}
    action: run
    allow_write_paths: "src/**,tests/**,docs/**"
    deny_write_paths: "infra/**,scripts/release.sh"
    llm_provider: anthropic
    model: claude-3-5-sonnet-20241022
    timeout_seconds: 180
    max_retries: 3
```

### Complete Workflow Example

```yaml
name: ResolveAI Automation

on:
  issues:
    types: [labeled]
  issue_comment:
    types: [created]

permissions:
  contents: read
  issues: read
  pull-requests: write

jobs:
  resolveai:
    if: |
      (github.event_name == 'issues' && contains(github.event.label.name, 'resolveai:run')) ||
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '/resolveai run'))
    runs-on: ubuntu-latest
    steps:
      - uses: AIProductLabs/resolveai-action@v1
        with:
          ecs_endpoint: ${{ secrets.RESOLVEAI_ECS_ENDPOINT }}
          ecs_api_token: ${{ secrets.RESOLVEAI_ECS_API_TOKEN }}
          ecs_hmac_secret: ${{ secrets.RESOLVEAI_ECS_HMAC_SECRET }}
          action: run
          allow_write_paths: "src/**,tests/**"
          deny_write_paths: "infra/**"
```

## Setting Up Secrets

Add these secrets to your repository or organization:

1. **`RESOLVEAI_ECS_ENDPOINT`** - Your ECS service URL
2. **`RESOLVEAI_ECS_API_TOKEN`** - Shared authentication token
3. **`RESOLVEAI_ECS_HMAC_SECRET`** - HMAC signing secret

```bash
# GitHub CLI example
gh secret set RESOLVEAI_ECS_ENDPOINT --body "https://your-ecs-service.example.com/v1/jobs"
gh secret set RESOLVEAI_ECS_API_TOKEN --body "your-api-token-here"
gh secret set RESOLVEAI_ECS_HMAC_SECRET --body "your-hmac-secret-here"
```

## ECS API Contract

Your ECS service should implement:

### Request Verification

```javascript
// Pseudo-code for ECS service verification
function verifyRequest(req) {
  // 1. Verify API token
  const apiToken = req.headers['x-resolveai-token'];
  if (apiToken !== process.env.EXPECTED_API_TOKEN) {
    return { status: 401, body: { error: 'Invalid API token' } };
  }
  
  // 2. Verify HMAC signature
  const signature = req.headers['x-resolveai-signature'];
  const expectedSig = `sha256=${hmac('sha256', hmacSecret, req.body)}`;
  if (signature !== expectedSig) {
    return { status: 401, body: { error: 'Invalid signature' } };
  }
  
  // 3. Check idempotency
  const idempotencyKey = req.headers['x-resolveai-idempotency-key'];
  const existing = await getJobByIdempotencyKey(idempotencyKey);
  if (existing) {
    return { status: 202, body: { job_id: existing.id, status: 'accepted' } };
  }
  
  // 4. Create new job
  const job = await createJob(JSON.parse(req.body));
  return { status: 202, body: { job_id: job.id, status: 'accepted' } };
}
```

### Request Headers

The action sends these headers with each request:

- `X-ResolveAI-Token`: Your API token for authentication
- `X-ResolveAI-Signature`: HMAC-SHA256 signature of the request body
- `X-ResolveAI-Idempotency-Key`: Unique key for deduplication
- `User-Agent`: `resolveai-action/1.0.0 (+github actions)`

### Response Format

Your ECS service should respond with:

```json
{
  "job_id": "jr_abc123",
  "status": "accepted"
}
```

## Security

- Secrets are automatically redacted from GitHub Actions logs
- Request payloads are signed with HMAC-SHA256 to prevent tampering
- Idempotency keys prevent duplicate job execution
- The action does not clone repositories or execute code locally

For detailed security information, see [SECURITY.md](SECURITY.md).

## GitHub App Recommendation

Instead of using `GITHUB_TOKEN`, configure your ECS runner to authenticate with a GitHub App for:

- ✅ More granular permissions
- ✅ Better audit trails
- ✅ Longer-lived credentials
- ✅ Cross-organization support

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Run linting
npm run lint

# Package for distribution
npm run package
```

## License

MIT - see [LICENSE](LICENSE) for details.