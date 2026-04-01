export interface VisitedStore {
  /** Returns true if the URL was newly added (not seen before). */
  add(url: string): Promise<boolean>;
  has(url: string): Promise<boolean>;
  size(): Promise<number>;
  close?(): Promise<void>;
}
