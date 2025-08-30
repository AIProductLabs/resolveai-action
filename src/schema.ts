import { z } from 'zod';

export const actionInputSchema = z.object({
  ecs_endpoint: z.string().url('ECS endpoint must be a valid URL'),
  ecs_api_token: z.string().min(1, 'ECS API token is required'),
  ecs_hmac_secret: z.string().min(1, 'ECS HMAC secret is required'),
  action: z.enum(['run', 'plan']).default('run'),
  timeout_seconds: z.number().min(1).max(600).default(120),
  max_retries: z.number().min(0).max(10).default(4),
  backoff_ms: z.number().min(0).max(5000).default(500),
  llm_provider: z.enum(['openai', 'anthropic']).optional(),
  model: z.string().optional(),
  allow_write_paths: z.array(z.string()).default([]),
  deny_write_paths: z.array(z.string()).default([]),
  vectordb_url: z.string().url().optional(),
  vectordb_token: z.string().optional(),
  tenant: z.string().optional(),
  openai_api_key: z.string().optional(),
  llm_api_key: z.string().optional(),
});

export const githubContextSchema = z.object({
  repository: z.string().regex(/^[^/]+\/[^/]+$/, 'Repository must be in format owner/repo'),
  issue_number: z.number().nullable(),
  ref: z.string(),
  sha: z.string().regex(/^[a-f0-9]{40}$/, 'SHA must be a valid 40-character hex string'),
  workflow_run: z.object({
    id: z.string(),
    attempt: z.string(),
  }),
  actor: z.string(),
  token: z.string(),
});

export const jobPayloadSchema = z.object({
  idempotency_key: z.string(),
  timestamp: z.string().datetime(),
  tenant: z.string().optional(),
  github: githubContextSchema,
  job: z.object({
    action: z.enum(['run', 'plan']),
    allow_write_paths: z.array(z.string()),
    deny_write_paths: z.array(z.string()),
    llm: z.object({
      provider: z.string().nullable(),
      model: z.string().nullable(),
    }),
    vectordb: z.object({
      url: z.string().nullable(),
    }),
  }),
  secrets: z.object({
    forwarded: z.object({
      vectordb_token: z.string().nullable(),
    }),
  }),
  openai_api_key: z.string().optional(),
  llm_api_key: z.string().optional(),
});

export const ecsResponseSchema = z.object({
  job_id: z.string(),
  status: z.enum(['accepted', 'rejected']),
});

export type ActionInputs = z.infer<typeof actionInputSchema>;
export type GitHubContext = z.infer<typeof githubContextSchema>;
export type JobPayload = z.infer<typeof jobPayloadSchema>;
export type ECSResponse = z.infer<typeof ecsResponseSchema>;