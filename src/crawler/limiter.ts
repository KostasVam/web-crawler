/**
 * Inline concurrency limiter — equivalent to p-limit but avoids
 * the ESM/CJS compatibility issue with p-limit v4+.
 *
 * Returns a function that wraps async tasks, ensuring at most
 * `concurrency` run simultaneously. Excess tasks are queued.
 */
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
}
