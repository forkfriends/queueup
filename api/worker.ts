export interface Env {
  QUEUE_DO: DurableObjectNamespace;
  QUEUE_KV: KVNamespace;
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HOST_AUTH_SECRET: string;
}

const NOT_IMPLEMENTED = new Response("Not implemented", { status: 501 });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return NOT_IMPLEMENTED;
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Scheduled cleanup will arrive in later checkpoints.
  },
};
