import { createHmac } from 'crypto';
import type { JobPayload } from './schema';

export function createStableJsonString(payload: JobPayload): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
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