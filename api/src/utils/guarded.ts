import type { Untrusted } from './untrusted';
/** Wraps a timer body so a tick that finds the previous one still running is skipped. */
export function guarded<A extends Untrusted[]>(
  fn: (...args: A) => Promise<Untrusted>
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
