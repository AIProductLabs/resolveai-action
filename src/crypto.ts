import { createHmac } from 'crypto';
import type { JobPayload } from './schema';

// Deep stable stringify: recursively sorts object keys to produce deterministic JSON.
// Avoids using the whitelist-array replacer (which previously stripped nested fields).
export function createStableJsonString(payload: JobPayload): string {
  const seen = new WeakSet();
  const normalize = (val: any): any => {
    if (val === null || typeof val !== 'object') return val;
    if (seen.has(val)) return null; // cycle guard (shouldn't occur in our payload)
    seen.add(val);
    if (Array.isArray(val)) return val.map(v => normalize(v));
    // Plain object
    return Object.fromEntries(
      Object.keys(val)
        .sort()
        .map(k => [k, normalize(val[k])])
    );
  };
  return JSON.stringify(normalize(payload));
}

export function signPayload(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  // Use base64 digest to match server expectation (Lambda verifies base64 form)
  return `sha256=${hmac.digest('base64')}`;
}

export function createIdempotencyKey(
  owner: string,
  repo: string,
  issueNumber: number | null,
  runId: string
): string {
  return `${owner}/${repo}/${issueNumber ?? 'null'}/${runId}`;
}

export function redactSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = [
    'ecs_api_token',
    'ecs_hmac_secret',
    'vectordb_token',
    'openai_api_key',
    'llm_api_key',
    'token',
    'forwarded'
  ];
  
  const redacted: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive.toLowerCase()))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSecrets(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  
  return redacted;
}