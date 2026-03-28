export interface FrontierItem {
  url: string;
  depth: number;
}

export interface Frontier {
  enqueue(item: FrontierItem): Promise<void>;
  dequeue(): Promise<FrontierItem | null>;
  size(): Promise<number>;
}
