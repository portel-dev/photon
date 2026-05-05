/**
 * Fixture for the standalone-server per-claim instance pool test.
 * Photons that opt into both stateful storage AND auth-bound routing
 * (the directives below) should give alice and bob disjoint task
 * arrays even though they hit the same process.
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
}
