import fetch from 'node-fetch';
import type { ECSResponse, RetryConfig, RequestError } from './types';
import { ecsResponseSchema, type JobPayload } from './schema';
import { createStableJsonString, signPayload } from './crypto';

export class ECSClient {
  constructor(
    private readonly endpoint: string,
    private readonly apiToken: string,
    private readonly hmacSecret: string,
    private readonly retryConfig: RetryConfig
  ) {}

  async submitJob(payload: JobPayload): Promise<ECSResponse> {
    // Enrich payload with duplicated top-level issue_number (if present) before stable stringify/sign
    const enrichedPayload: JobPayload = { ...payload };
    if (typeof payload.github.issue_number === 'number') {
      (enrichedPayload as any).issue_number = payload.github.issue_number;
    }
    const jsonPayload = createStableJsonString(enrichedPayload);
    const signature = signPayload(jsonPayload, this.hmacSecret);
    
    const headers: Record<string,string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'resolveai-action/1.0.0 (+github actions)',
      'X-ResolveAI-Token': this.apiToken,
      'X-ResolveAI-Signature': signature,
      'X-ResolveAI-Idempotency-Key': enrichedPayload.idempotency_key,
      'X-ResolveAI-Repo': enrichedPayload.github.repository,
    };
    if (typeof enrichedPayload.github.issue_number === 'number') {
      headers['X-ResolveAI-Issue'] = String(enrichedPayload.github.issue_number);
    }
    if (enrichedPayload.github.ref) {
      headers['X-ResolveAI-Ref'] = enrichedPayload.github.ref;
    }
    if (enrichedPayload.github.sha) {
      headers['X-ResolveAI-Sha'] = enrichedPayload.github.sha;
    }
    if (enrichedPayload.tenant) {
      headers['X-ResolveAI-Tenant'] = enrichedPayload.tenant;
    }
    if (enrichedPayload.post_comment) {
      headers['X-ResolveAI-Post-Comment'] = '1';
    }
    if (enrichedPayload.github.event_name) {
      headers['X-ResolveAI-Event'] = enrichedPayload.github.event_name;
    }

    return this.makeRequestWithRetry(jsonPayload, headers);
  }

  private async makeRequestWithRetry(
    body: string,
    headers: Record<string, string>
  ): Promise<ECSResponse> {
    let lastError: RequestError | null = null;
    
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.retryConfig.timeoutSeconds * 1000
        );

        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const responseData = await response.json();
          return ecsResponseSchema.parse(responseData);
        }

        const status = response.status;
        const errorText = await response.text().catch(() => 'Unknown error');
        
        const error: RequestError = new Error(`HTTP ${status}: ${errorText}`);
        error.status = status;

        if (this.shouldRetry(status)) {
          lastError = error;
          if (attempt < this.retryConfig.maxRetries) {
            await this.sleep(this.calculateBackoff(attempt));
            continue;
          }
        }

        throw error;

      } catch (err) {
        const error = err as RequestError;
        
        if (error.name === 'AbortError') {
          error.message = 'Request timeout';
          error.code = 'TIMEOUT';
        }

        if (this.shouldRetryError(error) && attempt < this.retryConfig.maxRetries) {
          lastError = error;
          await this.sleep(this.calculateBackoff(attempt));
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('Maximum retries exceeded');
  }

  private shouldRetry(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
  }

  private shouldRetryError(error: RequestError): boolean {
    return error.code === 'TIMEOUT' || 
           error.code === 'ECONNRESET' || 
           error.code === 'ENOTFOUND' ||
           error.code === 'ECONNREFUSED';
  }

  private calculateBackoff(attempt: number): number {
    const baseDelay = this.retryConfig.backoffMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 + 0.85; // 85-115% of base delay
    return Math.floor(baseDelay * jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}