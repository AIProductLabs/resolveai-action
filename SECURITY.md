# Security Policy

## Overview

The ResolveAI Action is designed as a security-focused **shim** that safely hands off maintenance jobs to a private ECS runner. This document outlines the security measures implemented and best practices for secure deployment.

## Security Architecture

### What the Action Does NOT Do (by design)

- ❌ **Does not clone repositories** - No local access to your code
- ❌ **Does not execute AI models locally** - No local compute or model access
- ❌ **Does not store secrets** - Secrets are passed through only
- ❌ **Does not retain data** - No persistence between runs
- ❌ **Does not make code changes** - Only submits job requests

### What the Action DOES Do

- ✅ **Validates all inputs** using strict Zod schemas
- ✅ **Signs requests** with HMAC-SHA256 for authenticity
- ✅ **Redacts secrets** from all GitHub Actions logs
- ✅ **Implements retry logic** with exponential backoff
- ✅ **Uses secure HTTP** (HTTPS required for ECS endpoints)

## Cryptographic Security

### HMAC Signature Verification

Every request is signed using HMAC-SHA256:

```javascript
// Signing process (in action)
const jsonPayload = JSON.stringify(payload, Object.keys(payload).sort());
const signature = `sha256=${hmac('sha256', hmacSecret, jsonPayload)}`;

// Verification process (in ECS service)
function verifySignature(body, signature, secret) {
  const expectedSignature = `sha256=${hmac('sha256', secret, body)}`;
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedSignature, 'utf8')
  );
}
```

### Key Security Features

1. **Stable JSON Serialization**: Keys are sorted to ensure consistent signatures
2. **Timing-Safe Comparison**: Prevents timing attacks during signature verification  
3. **Full Payload Signing**: Entire request body is authenticated
4. **Separate Secrets**: API token and HMAC secret provide defense in depth

## ECS Service Security Requirements

### Authentication & Authorization

Your ECS service MUST implement these security checks:

```javascript
async function secureRequestHandler(req, res) {
  // 1. Verify API token
  const apiToken = req.headers['x-resolveai-token'];
  if (!apiToken || !timingSafeEqual(apiToken, expectedToken)) {
    return res.status(401).json({ error: 'Invalid API token' });
  }
  
  // 2. Verify HMAC signature
  const signature = req.headers['x-resolveai-signature'];
  if (!verifySignature(req.body, signature, hmacSecret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // 3. Check idempotency (prevent replay attacks)
  const idempotencyKey = req.headers['x-resolveai-idempotency-key'];
  if (await jobExists(idempotencyKey)) {
    const existing = await getJob(idempotencyKey);
    return res.status(202).json({ job_id: existing.id, status: 'accepted' });
  }
  
  // 4. Validate payload structure
  const payload = JSON.parse(req.body);
  if (!isValidPayload(payload)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  
  // 5. Process job securely...
}
```

### Idempotency & Replay Protection

- **Idempotency Key Format**: `{owner}/{repo}/{issue_number|null}/{run_id}`
- **Deduplication**: Same key returns same `job_id` (202 Accepted)
- **Replay Protection**: Prevents duplicate job execution
- **Key Expiration**: Recommend TTL on stored keys (24-48 hours)

## Secret Management

### Required Secrets

| Secret | Purpose | Rotation |
|--------|---------|----------|
| `RESOLVEAI_ECS_ENDPOINT` | ECS service URL | As needed |
| `RESOLVEAI_ECS_API_TOKEN` | Authentication token | Monthly |
| `RESOLVEAI_ECS_HMAC_SECRET` | Request signing | Monthly |

### Secret Rotation Process

1. **Generate new secrets** with sufficient entropy (≥256 bits)
2. **Update ECS service** configuration first
3. **Update GitHub secrets** second
4. **Verify** new requests work correctly
5. **Revoke old secrets** after transition period

### GitHub Token Handling

The action forwards `GITHUB_TOKEN` to the ECS service but we **strongly recommend** using a GitHub App instead:

#### ❌ GitHub Token (Not Recommended)
```yaml
# Limited lifetime, broad permissions
permissions:
  contents: write
  issues: write  
  pull-requests: write
```

#### ✅ GitHub App (Recommended)
```javascript
// ECS service using GitHub App
const app = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
});
const installation = await app.getInstallationOctokit(installationId);
```

**Benefits of GitHub App:**
- Granular permissions per repository
- Longer-lived credentials
- Better audit trail
- Cross-organization support
- Independent credential lifecycle

## Network Security

### Transport Security

- **HTTPS Required**: All ECS endpoints must use HTTPS
- **TLS 1.2+**: Minimum supported TLS version
- **Certificate Validation**: No self-signed certificates in production
- **HSTS**: Recommended for ECS endpoints

### ECS Network Configuration

```yaml
# Example AWS ECS security groups
SecurityGroupRules:
  - IpProtocol: tcp
    FromPort: 443
    ToPort: 443
    CidrIp: 0.0.0.0/0  # GitHub Actions IP ranges if possible
    Description: "HTTPS from GitHub Actions"
```

## Data Security

### Data Minimization

The action only sends necessary data:

```json
{
  "idempotency_key": "owner/repo/123/456",
  "timestamp": "2024-01-01T00:00:00.000Z", 
  "github": {
    "repository": "owner/repo",
    "issue_number": 123,
    "ref": "refs/heads/main",
    "sha": "abc123...",
    "workflow_run": { "id": "456", "attempt": "1" },
    "actor": "username",
    "token": "[GITHUB_TOKEN]"
  },
  "job": { /* job parameters */ },
  "secrets": {
    "forwarded": {
      "vectordb_token": "[VECTORDB_TOKEN]"
    }
  }
}
```

### Secret Redaction

All sensitive values are automatically redacted from GitHub Actions logs:

- `ecs_api_token` → `[REDACTED]`
- `ecs_hmac_secret` → `[REDACTED]`
- `vectordb_token` → `[REDACTED]`
- `github.token` → `[REDACTED]`

## Incident Response

### Security Monitoring

Monitor these indicators in your ECS service:

- **Authentication failures** (401 responses)
- **Signature verification failures** 
- **Unusual request patterns**
- **Repeated idempotency key usage**

### Incident Response Steps

1. **Immediate Response**
   - Rotate compromised secrets immediately
   - Review ECS service logs for anomalous activity
   - Check GitHub Actions audit logs

2. **Investigation**
   - Identify scope of potential compromise
   - Review affected repositories and workflows
   - Analyze request patterns and timing

3. **Recovery**
   - Update all authentication credentials
   - Review and update security configurations
   - Document lessons learned

## Vulnerability Reporting

### Reporting Process

To report a security vulnerability:

1. **DO NOT** open a public GitHub issue
2. **Email** security@aiproductlabs.com with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact assessment
   - Suggested remediation (if any)

### Response Timeline

- **24 hours**: Initial acknowledgment
- **72 hours**: Initial assessment and triage  
- **30 days**: Target resolution for critical vulnerabilities
- **90 days**: Target resolution for non-critical vulnerabilities

## Security Best Practices

### For Action Users

1. **Principle of Least Privilege**
   ```yaml
   permissions:
     contents: read      # Minimum required
     issues: read        # Only if using issue triggers
     pull-requests: write # Only if ECS needs to create PRs
   ```

2. **Secret Management**
   - Use organization-level secrets when possible
   - Implement secret rotation schedule
   - Monitor secret access logs

3. **Path Restrictions**
   ```yaml
   allow_write_paths: "src/**,tests/**"
   deny_write_paths: "infra/**,scripts/**,.github/**"
   ```

### For ECS Service Operators

1. **Infrastructure Security**
   - Use AWS IAM roles with minimal permissions
   - Enable CloudTrail for audit logging  
   - Implement network segmentation
   - Use AWS Secrets Manager for credential storage

2. **Application Security**
   - Validate all input payloads
   - Implement rate limiting
   - Use structured logging for security events
   - Regular security scanning of container images

3. **Monitoring & Alerting**
   - Set up alerts for authentication failures
   - Monitor for unusual job patterns
   - Track resource utilization
   - Implement health checks

## Compliance Considerations

### Data Residency

- Action runs on GitHub-hosted runners (global)
- ECS service runs in your AWS region
- Consider data residency requirements for your jurisdiction

### Audit Requirements

- GitHub Actions provides built-in audit logging
- ECS service should implement structured logging
- Consider log retention and access policies
- Ensure compliance with your organization's requirements

---

**Last Updated**: 2024-01-01  
**Version**: 1.0.0