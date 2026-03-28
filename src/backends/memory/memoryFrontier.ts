import { Frontier, FrontierItem } from "../../crawler/frontier";

export class MemoryFrontier implements Frontier {
  private queue: FrontierItem[] = [];

  async enqueue(item: FrontierItem): Promise<void> {
    this.queue.push(item);
  }

  async dequeue(): Promise<FrontierItem | null> {
    return this.queue.shift() ?? null;
  }

  async size(): Promise<number> {
    return this.queue.length;
  }
}
