import type { RateLimitConfig, RateLimitResult, GlobalRateLimitResult } from '../types';
import { ConfigLoader } from '../config/loader';

interface PerKeyWindow {
  timestamps: number[];
  limit: number;
}

interface GlobalQpsBucket {
  second: number;
  count: number;
}

export class RateLimitService {
  private static instance: RateLimitService | null = null;
  private config: RateLimitConfig;
  private perKeyWindows: Map<string, PerKeyWindow>;
  private globalQpsBuckets: GlobalQpsBucket[];
  private readonly maxGlobalBuckets = 5;

  private constructor() {
    this.config = ConfigLoader.getInstance().getRateLimitConfig();
    this.perKeyWindows = new Map<string, PerKeyWindow>();
    this.globalQpsBuckets = [];
  }

  public static getInstance(): RateLimitService {
    if (RateLimitService.instance === null) {
      RateLimitService.instance = new RateLimitService();
    }
    return RateLimitService.instance;
  }

  public static reset(): void {
    RateLimitService.instance = null;
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public checkAndConsume(apiKey: string, keyLimit: number | undefined): RateLimitResult {
    if (!this.config.enabled) {
      return {
        allowed: true,
        remaining: 999999,
        limit: 999999,
        resetMs: 0,
      };
    }

    const limit = keyLimit ?? this.config.defaultPerKeyPerMinute;
    const windowSize = this.config.windowSizeMs;
    const now = Date.now();
    const windowStart = now - windowSize;

    let window = this.perKeyWindows.get(apiKey);
    if (!window) {
      window = { timestamps: [], limit };
      this.perKeyWindows.set(apiKey, window);
    }

    if (window.limit !== limit) {
      window.limit = limit;
    }

    window.timestamps = window.timestamps.filter((ts) => ts > windowStart);

    if (window.timestamps.length >= limit) {
      const oldestInWindow = window.timestamps[0] as number;
      const resetMs = oldestInWindow + windowSize - now;
      return {
        allowed: false,
        remaining: 0,
        limit,
        resetMs: Math.max(resetMs, 0),
        retryAfterMs: Math.ceil(Math.max(resetMs, 1000) / 1000) * 1000,
      };
    }

    window.timestamps.push(now);

    return {
      allowed: true,
      remaining: limit - window.timestamps.length,
      limit,
      resetMs: windowStart + windowSize - now,
    };
  }

  public checkGlobalQps(): GlobalRateLimitResult {
    if (!this.config.enabled) {
      return {
        allowed: true,
        currentQps: 0,
        limit: 999999,
      };
    }

    const now = Date.now();
    const currentSecond = Math.floor(now / 1000);

    this.globalQpsBuckets = this.globalQpsBuckets.filter(
      (b) => currentSecond - b.second < this.maxGlobalBuckets,
    );

    let currentBucket = this.globalQpsBuckets.find((b) => b.second === currentSecond);
    if (!currentBucket) {
      currentBucket = { second: currentSecond, count: 0 };
      this.globalQpsBuckets.push(currentBucket);
    }

    currentBucket.count++;

    const limit = this.config.globalQpsLimit;

    return {
      allowed: currentBucket.count <= limit,
      currentQps: currentBucket.count,
      limit,
    };
  }

  public getKeyRemaining(apiKey: string, keyLimit: number | undefined): number {
    if (!this.config.enabled) {
      return 999999;
    }
    const limit = keyLimit ?? this.config.defaultPerKeyPerMinute;
    const now = Date.now();
    const windowStart = now - this.config.windowSizeMs;
    const window = this.perKeyWindows.get(apiKey);
    if (!window) {
      return limit;
    }
    const validTimestamps = window.timestamps.filter((ts) => ts > windowStart);
    return Math.max(0, limit - validTimestamps.length);
  }

  public cleanup(): number {
    const now = Date.now();
    const windowStart = now - this.config.windowSizeMs;
    let removed = 0;

    for (const [apiKey, window] of this.perKeyWindows.entries()) {
      window.timestamps = window.timestamps.filter((ts) => ts > windowStart);
      if (window.timestamps.length === 0) {
        this.perKeyWindows.delete(apiKey);
        removed++;
      }
    }

    const currentSecond = Math.floor(now / 1000);
    this.globalQpsBuckets = this.globalQpsBuckets.filter(
      (b) => currentSecond - b.second < this.maxGlobalBuckets,
    );

    return removed;
  }

  public getStats(): {
    activeKeys: number;
    globalQpsBuckets: number;
    totalRequestsInWindows: number;
  } {
    let total = 0;
    for (const window of this.perKeyWindows.values()) {
      total += window.timestamps.length;
    }
    return {
      activeKeys: this.perKeyWindows.size,
      globalQpsBuckets: this.globalQpsBuckets.length,
      totalRequestsInWindows: total,
    };
  }
}
