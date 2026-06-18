import type { RateLimitConfig, RateLimitResult, GlobalRateLimitResult } from '../types';
import { ConfigLoader } from '../config/loader';

interface PerKeyWindow {
  timestamps: number[];
  limit: number;
}

export class RateLimitService {
  private static instance: RateLimitService | null = null;
  private config: RateLimitConfig;
  private perKeyWindows: Map<string, PerKeyWindow>;
  private globalTimestamps: number[];

  private constructor() {
    this.config = ConfigLoader.getInstance().getRateLimitConfig();
    this.perKeyWindows = new Map<string, PerKeyWindow>();
    this.globalTimestamps = [];
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

    window.timestamps = window.timestamps.filter((ts) => ts >= windowStart);

    if (window.timestamps.length >= limit) {
      const oldestInWindow = window.timestamps[0] as number;
      const resetMs = oldestInWindow - windowStart + 1;
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
      resetMs: Math.max(windowStart + windowSize - now, 0),
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
    const oneSecondAgo = now - 1000;

    this.globalTimestamps = this.globalTimestamps.filter((ts) => ts >= oneSecondAgo);

    const currentQps = this.globalTimestamps.length;
    const limit = this.config.globalQpsLimit;

    if (currentQps >= limit) {
      return {
        allowed: false,
        currentQps,
        limit,
      };
    }

    this.globalTimestamps.push(now);

    return {
      allowed: true,
      currentQps: currentQps + 1,
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
    const validTimestamps = window.timestamps.filter((ts) => ts >= windowStart);
    return Math.max(0, limit - validTimestamps.length);
  }

  public cleanup(): number {
    const now = Date.now();
    const windowStart = now - this.config.windowSizeMs;
    let removed = 0;

    for (const [apiKey, window] of this.perKeyWindows.entries()) {
      window.timestamps = window.timestamps.filter((ts) => ts >= windowStart);
      if (window.timestamps.length === 0) {
        this.perKeyWindows.delete(apiKey);
        removed++;
      }
    }

    const oneSecondAgo = now - 1000;
    this.globalTimestamps = this.globalTimestamps.filter((ts) => ts >= oneSecondAgo);

    return removed;
  }

  public getStats(): {
    activeKeys: number;
    globalTimestampsCount: number;
    totalRequestsInWindows: number;
  } {
    let total = 0;
    for (const window of this.perKeyWindows.values()) {
      total += window.timestamps.length;
    }
    return {
      activeKeys: this.perKeyWindows.size,
      globalTimestampsCount: this.globalTimestamps.length,
      totalRequestsInWindows: total,
    };
  }
}
