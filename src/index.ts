import * as core from '@actions/core';
import * as github from '@actions/github';
import { actionInputSchema, type ActionInputs, type GitHubContext, type JobPayload } from './schema';
import { ECSClient } from './client';
import { createIdempotencyKey, redactSecrets } from './crypto';

async function run(): Promise<void> {
  try {
    const inputs = getAndValidateInputs();
    const githubContext = getGitHubContext();
    const payload = buildJobPayload(inputs, githubContext);
    
    core.info('Submitting job to ECS service...');
    core.debug(`Payload (redacted): ${JSON.stringify(redactSecrets(payload), null, 2)}`);

    const client = new ECSClient(
      inputs.ecs_endpoint,
      inputs.ecs_api_token,
      inputs.ecs_hmac_secret,
      {
        maxRetries: inputs.max_retries,
        backoffMs: inputs.backoff_ms,
        timeoutSeconds: inputs.timeout_seconds,
      }
    );

    const response = await client.submitJob(payload);
    
    core.info(`Job submitted successfully: ${response.job_id} (${response.status})`);
    core.setOutput('job_id', response.job_id);
    core.setOutput('status', response.status);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed: ${message}`);
  }
}

function getAndValidateInputs(): ActionInputs {
  const rawInputs = {
    ecs_endpoint: core.getInput('ecs_endpoint', { required: true }),
    ecs_api_token: core.getInput('ecs_api_token', { required: true }),
    ecs_hmac_secret: core.getInput('ecs_hmac_secret', { required: true }),
    action: core.getInput('action') || 'run',
    timeout_seconds: parseInt(core.getInput('timeout_seconds') || '120', 10),
    max_retries: parseInt(core.getInput('max_retries') || '4', 10),
    backoff_ms: parseInt(core.getInput('backoff_ms') || '500', 10),
    llm_provider: core.getInput('llm_provider') || undefined,
    model: core.getInput('model') || undefined,
    allow_write_paths: parseCommaSeparated(core.getInput('allow_write_paths')),
    deny_write_paths: parseCommaSeparated(core.getInput('deny_write_paths')),
    vectordb_url: core.getInput('vectordb_url') || undefined,
    vectordb_token: core.getInput('vectordb_token') || undefined,
  tenant: core.getInput('tenant') || undefined,
  openai_api_key: core.getInput('openai_api_key') || undefined,
  llm_api_key: core.getInput('llm_api_key') || undefined,
  post_comment: core.getInput('post_comment') || undefined,
  };

  try {
    return actionInputSchema.parse(rawInputs);
  } catch (error) {
    throw new Error(`Invalid inputs: ${error}`);
  }
}

function getGitHubContext(): GitHubContext {
  const context = github.context;
  
  let issueNumber: number | null = null;
  if (context.eventName === 'issues' || context.eventName === 'issue_comment') {
    issueNumber = context.issue.number;
  } else if (context.eventName === 'pull_request' || context.eventName === 'pull_request_target') {
    issueNumber = context.payload.pull_request?.number || null;
  }

  return {
    repository: context.repo.owner + '/' + context.repo.repo,
    issue_number: issueNumber,
    ref: process.env.GITHUB_REF || context.ref,
    sha: process.env.GITHUB_SHA || context.sha,
    workflow_run: {
      id: process.env.GITHUB_RUN_ID || '',
      attempt: process.env.GITHUB_RUN_ATTEMPT || '1',
    },
    actor: process.env.GITHUB_ACTOR || context.actor,
    token: process.env.GITHUB_TOKEN || '',
  };
}

function buildJobPayload(inputs: ActionInputs, githubContext: GitHubContext): JobPayload {
  const idempotencyKey = createIdempotencyKey(
    github.context.repo.owner,
    github.context.repo.repo,
    githubContext.issue_number,
    githubContext.workflow_run.id
  );

  return {
    idempotency_key: idempotencyKey,
    timestamp: new Date().toISOString(),
  tenant: inputs.tenant || undefined,
    github: githubContext,
    job: {
      action: inputs.action,
      allow_write_paths: inputs.allow_write_paths,
      deny_write_paths: inputs.deny_write_paths,
      llm: {
        provider: inputs.llm_provider || null,
        model: inputs.model || null,
      },
      vectordb: {
        url: inputs.vectordb_url || null,
      },
    },
    secrets: {
      forwarded: {
        vectordb_token: inputs.vectordb_token || null,
      },
    },
  openai_api_key: inputs.openai_api_key || undefined,
  llm_api_key: inputs.openai_api_key ? undefined : (inputs.llm_api_key || undefined),
    post_comment: ((): boolean | undefined => {
      const v = inputs.post_comment as unknown;
      if (v === undefined) return undefined;
      if (typeof v === 'boolean') return v ? true : undefined;
      if (typeof v === 'string') {
        const lowered = v.toLowerCase().trim();
        if (['1','true','yes','on'].includes(lowered)) return true;
      }
      return undefined;
    })(),
  };
}

function parseCommaSeparated(input: string): string[] {
  if (!input.trim()) return [];
  return input.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

if (require.main === module) {
  run().catch(error => {
    core.setFailed(error.message);
    process.exit(1);
  });
}