/**
 * A plain sync class — no async, no PhotonMCP, no JSDoc.
 * Used to verify that photons work with minimal boilerplate.
 */
export default class SyncList {
  items: string[] = [];

  add(item: string): void {
    this.items.push(item);
  }

  remove(item: string): boolean {
    const index = this.items.indexOf(item);
    if (index !== -1) {
      this.items.splice(index, 1);
      return true;
    }
    return false;
  }

  getAll(): string[] {
    return this.items;
  }
}
