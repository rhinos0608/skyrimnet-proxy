/**
 * Concurrency control for provider requests
 * Prevents overwhelming providers with too many simultaneous requests
 */

/**
 * Semaphore for limiting concurrent operations
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  /**
   * Acquire a permit, waiting if necessary
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    // Wait for a permit to become available
    await new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.permits--;
        resolve();
      });
    });
  }

  /**
   * Release a permit back to the pool
   */
  release(): void {
    this.permits++;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Get current available permits
   */
  available(): number {
    return this.permits;
  }

  /**
   * Get queued requests count
   */
  queued(): number {
    return this.queue.length;
  }
}

/**
 * Concurrency limiter per provider
 */
export class ConcurrencyLimiter {
  private limiters: Map<string, Semaphore> = new Map();
  private readonly DEFAULT_MAX_CONCURRENT = 25; // Per provider

  /**
   * Acquire a permit for the given provider
   */
  async acquire(providerKey: string, maxConcurrent?: number): Promise<() => void> {
    const limit = maxConcurrent ?? this.DEFAULT_MAX_CONCURRENT;

    if (!this.limiters.has(providerKey)) {
      this.limiters.set(providerKey, new Semaphore(limit));
    }

    const semaphore = this.limiters.get(providerKey)!;
    await semaphore.acquire();

    // Return release function
    return () => semaphore.release();
  }

  /**
   * Get current stats for a provider
   */
  getStats(providerKey: string): { available: number; queued: number } {
    const semaphore = this.limiters.get(providerKey);
    if (!semaphore) {
      return { available: this.DEFAULT_MAX_CONCURRENT, queued: 0 };
    }
    return {
      available: semaphore.available(),
      queued: semaphore.queued(),
    };
  }

  /**
   * Reset all limiters (useful for testing)
   */
  reset(): void {
    this.limiters.clear();
  }
}

/**
 * Global concurrency limiter instance
 */
let globalLimiter: ConcurrencyLimiter | null = null;

/**
 * Get or create the global concurrency limiter
 */
export function getConcurrencyLimiter(): ConcurrencyLimiter {
  if (!globalLimiter) {
    globalLimiter = new ConcurrencyLimiter();
  }
  return globalLimiter;
}
