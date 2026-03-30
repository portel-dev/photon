/**
 * Todo
 *
 * A minimal task tracker.
 *
 * @stateful
 * @ui dashboard ./ui/dashboard.photon.md
 */
export default class Todo {
  constructor(public items: { text: string; done: boolean }[] = []) {}

  /**
   * Add a task
   * @param text What needs to be done
   */
  add(text: string) {
    this.items.push({ text, done: false });
    return this.items;
  }

  /**
   * Toggle a task's completion
   * @param text Task text to toggle
   * @param done New done state
   */
  check(text: string, done: boolean) {
    const item = this.items.find((i) => i.text === text);
    if (item) item.done = done;
    return this.items;
  }

  /**
   * Reorder tasks
   * @param order New order of task texts
   */
  reorder(order: string[]) {
    const byText = new Map(this.items.map((i) => [i.text, i]));
    this.items = order.map((t) => byText.get(t)).filter(Boolean) as {
      text: string;
      done: boolean;
    }[];
    return this.items;
  }

  /**
   * Remove a task
   * @param text Task text to remove
   */
  remove(text: string) {
    this.items = this.items.filter((i) => i.text !== text);
    return this.items;
  }

  /**
   * List all tasks
   * @format checklist
   */
  list() {
    return this.items;
  }
}
