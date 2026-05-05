/**
 * Fixture for the standalone-server per-claim instance pool test.
 * Photons that opt into both stateful storage AND auth-bound routing
 * (the directives below) should give alice and bob disjoint task
 * arrays even though they hit the same process.
 *
 * The exposeAddTask / exposeListTasks methods hit the auto-RPC HTTP
 * surface so the same isolation contract holds when callers go through
 * the SPA fetch path instead of MCP tools/call.
 *
 * @stateful
 * @auth cf-access
 */
export default class MultiTenantPhoton {
  tasks: string[] = [];

  /**
   * Add a task. Returns the post-add length so the caller can assert
   * isolation without a follow-up listTasks round-trip.
   */
  async addTask(input: { title: string }): Promise<{ count: number }> {
    this.tasks.push(input.title);
    return { count: this.tasks.length };
  }

  async listTasks(): Promise<string[]> {
    return [...this.tasks];
  }

  /**
   * SPA-callable add. Mirrors addTask but bound to POST /api/expose-add-task
   * via the @expose tag, so the test can prove HTTP-route dispatch also
   * routes through the per-claim pool.
   * @expose public
   */
  async exposeAddTask(input: { title: string }): Promise<{ count: number }> {
    this.tasks.push(input.title);
    return { count: this.tasks.length };
  }

  /**
   * SPA-callable list, paired with exposeAddTask above.
   * @expose public
   */
  async exposeListTasks(): Promise<string[]> {
    return [...this.tasks];
  }
}
