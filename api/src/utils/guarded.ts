/** Wraps a timer body so a tick that finds the previous one still running is skipped. */
export function guarded<A extends unknown[]>(
  fn: (...args: A) => Promise<unknown>
): (...args: A) => Promise<void> {
  let running = false;
  return async (...args: A) => {
    if (running) return;
    running = true;
    try {
      await fn(...args);
    } finally {
      running = false;
    }
  };
}
