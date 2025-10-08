import type { Env } from "./worker";

export class QueueDO implements DurableObject {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response("QueueDO not implemented", { status: 501 });
  }

  async alarm(): Promise<void> {
    // Alarm handling will be implemented in later checkpoints.
  }
}
