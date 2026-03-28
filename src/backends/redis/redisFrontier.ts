import Redis from "ioredis";
import { Frontier, FrontierItem } from "../../crawler/frontier";

const QUEUE_KEY = "crawler:frontier";

export class RedisFrontier implements Frontier {
  private redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url);
  }

  async enqueue(item: FrontierItem): Promise<void> {
    await this.redis.lpush(QUEUE_KEY, JSON.stringify(item));
  }

  async dequeue(): Promise<FrontierItem | null> {
    const result = await this.redis.brpop(QUEUE_KEY, 2);
    if (!result) return null;
    return JSON.parse(result[1]) as FrontierItem;
  }

  async size(): Promise<number> {
    return this.redis.llen(QUEUE_KEY);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
