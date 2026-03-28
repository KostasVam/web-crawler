import Redis from "ioredis";
import { VisitedStore } from "../../crawler/visited";

const SET_KEY = "crawler:visited";

export class RedisVisited implements VisitedStore {
  private redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url);
  }

  async add(url: string): Promise<boolean> {
    const added = await this.redis.sadd(SET_KEY, url);
    return added === 1;
  }

  async has(url: string): Promise<boolean> {
    return (await this.redis.sismember(SET_KEY, url)) === 1;
  }

  async size(): Promise<number> {
    return this.redis.scard(SET_KEY);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
