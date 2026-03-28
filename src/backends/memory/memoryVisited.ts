import { VisitedStore } from "../../crawler/visited";

export class MemoryVisited implements VisitedStore {
  private set = new Set<string>();

  async add(url: string): Promise<boolean> {
    if (this.set.has(url)) return false;
    this.set.add(url);
    return true;
  }

  async has(url: string): Promise<boolean> {
    return this.set.has(url);
  }

  async size(): Promise<number> {
    return this.set.size;
  }
}
