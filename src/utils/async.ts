/**
 * Yields control back to the event loop. Long synchronous stretches (hashing/scanning many large
 * files) otherwise block the whole extension host, making the UI look frozen and cancellation
 * unresponsive even though work is genuinely progressing.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Calls `yieldToEventLoop` every `every`-th call (starting at the `every`-th), so hot loops don't
 * pay the yield cost on every single iteration. */
export function createPeriodicYielder(every = 8): () => Promise<void> {
  let count = 0;
  return async () => {
    count += 1;
    if (count % every === 0) {
      await yieldToEventLoop();
    }
  };
}
