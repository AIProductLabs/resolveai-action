export interface ActionInputs {
  ecs_endpoint: string;
  ecs_api_token: string;
  ecs_hmac_secret: string;
  action: 'run' | 'plan';
  timeout_seconds: number;
  max_retries: number;
  backoff_ms: number;
  llm_provider?: string;
  model?: string;
  allow_write_paths?: string[];
  deny_write_paths?: string[];
  vectordb_url?: string;
  vectordb_token?: string;
  tenant?: string;
  openai_api_key?: string;
  llm_api_key?: string;
  post_comment?: boolean | string; // string form before validation
}

export interface GitHubContext {
  repository: string;
  issue_number: number | null;
  ref: string;
  sha: string;
  workflow_run: {
    id: string;
    attempt: string;
  };
  actor: string;
  token: string;
}

export interface JobPayload {
  idempotency_key: string;
  timestamp: string;
  tenant?: string;
  // Duplicate issue number at top-level (in addition to github.issue_number) for Lambda convenience
  issue_number?: number;
  github: GitHubContext;
  job: {
    action: 'run' | 'plan';
    allow_write_paths: string[];
    deny_write_paths: string[];
    llm: {
      provider: string | null;
      model: string | null;
    };
    vectordb: {
      url: string | null;
    };
  };
  openai_api_key?: string;
  llm_api_key?: string;
  post_comment?: boolean;
  secrets: {
    forwarded: {
      vectordb_token: string | null;
    };
  };
}

export interface ECSResponse {
  job_id: string;
  status: 'accepted' | 'rejected';
}

export interface ActionOutputs {
  job_id: string;
  status: 'accepted' | 'rejected';
}

export interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  timeoutSeconds: number;
}

export interface RequestError extends Error {
  status?: number;
  code?: string;
}