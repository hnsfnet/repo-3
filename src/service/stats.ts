import type {
  HourlyStatsKey,
  PerKeyStats,
  EndpointCallRecord,
  StatsSummary,
  AccessLogEntry,
  ApiKeyConfig,
} from '../types';
import { ConfigLoader } from '../config/loader';

interface HourlyBucket {
  key: HourlyStatsKey;
  createdAt: number;
  global: PerKeyStats;
  perKey: Map<string, PerKeyStats>;
  durations: number[];
  slowest: EndpointCallRecord[];
  keyNameMap: Map<string, string>;
}

const MAX_HOURS_TO_KEEP = 48;
const MAX_SLOWEST_PER_HOUR = 100;

function createEmptyStats(): PerKeyStats {
  return {
    totalCalls: 0,
    successCalls: 0,
    errorCalls: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    minDurationMs: Number.POSITIVE_INFINITY,
    cacheHits: 0,
  };
}

function getHourKey(date: Date): HourlyStatsKey {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return {
    date: `${y}-${m}-${d}`,
    hour: date.getHours(),
  };
}

function hourKeyToString(key: HourlyStatsKey): string {
  return `${key.date}-${String(key.hour).padStart(2, '0')}`;
}

function keyToTimestamp(key: HourlyStatsKey): number {
  const [yStr, mStr, dStr] = key.date.split('-') as [string, string, string];
  const d = new Date(
    parseInt(yStr, 10),
    parseInt(mStr, 10) - 1,
    parseInt(dStr, 10),
    key.hour,
    0,
    0,
    0,
  );
  return d.getTime();
}

export class StatsService {
  private static instance: StatsService | null = null;
  private hourlyBuckets: Map<string, HourlyBucket>;
  private configLoader: ConfigLoader;

  private constructor() {
    this.hourlyBuckets = new Map<string, HourlyBucket>();
    this.configLoader = ConfigLoader.getInstance();
  }

  public static getInstance(): StatsService {
    if (StatsService.instance === null) {
      StatsService.instance = new StatsService();
    }
    return StatsService.instance;
  }

  public static reset(): void {
    StatsService.instance = null;
  }

  public record(entry: AccessLogEntry): void {
    this.cleanupOldBuckets();

    const key = getHourKey(new Date(entry.timestamp));
    const keyStr = hourKeyToString(key);

    let bucket = this.hourlyBuckets.get(keyStr);
    if (!bucket) {
      bucket = this.createBucket(key);
      this.hourlyBuckets.set(keyStr, bucket);
    }

    const isSuccess = entry.statusCode >= 200 && entry.statusCode < 500;

    const globalStats = bucket.global;
    globalStats.totalCalls++;
    globalStats.totalDurationMs += entry.durationMs;
    globalStats.maxDurationMs = Math.max(globalStats.maxDurationMs, entry.durationMs);
    globalStats.minDurationMs = Math.min(globalStats.minDurationMs, entry.durationMs);
    if (isSuccess) {
      globalStats.successCalls++;
    } else {
      globalStats.errorCalls++;
    }
    if (entry.cacheHit) {
      globalStats.cacheHits++;
    }

    if (entry.apiKey) {
      let keyStats = bucket.perKey.get(entry.apiKey);
      if (!keyStats) {
        keyStats = createEmptyStats();
        bucket.perKey.set(entry.apiKey, keyStats);
      }
      keyStats.totalCalls++;
      keyStats.totalDurationMs += entry.durationMs;
      keyStats.maxDurationMs = Math.max(keyStats.maxDurationMs, entry.durationMs);
      keyStats.minDurationMs = Math.min(keyStats.minDurationMs, entry.durationMs);
      if (isSuccess) {
        keyStats.successCalls++;
      } else {
        keyStats.errorCalls++;
      }
      if (entry.cacheHit) {
        keyStats.cacheHits++;
      }
      bucket.keyNameMap.set(entry.apiKey, entry.keyName);
    }

    bucket.durations.push(entry.durationMs);
    if (bucket.durations.length > 10000) {
      bucket.durations = bucket.durations.slice(-5000);
    }

    const record: EndpointCallRecord = {
      method: entry.method,
      path: entry.path,
      durationMs: entry.durationMs,
      timestamp: entry.timestamp,
      apiKey: entry.apiKey,
      statusCode: entry.statusCode,
    };
    bucket.slowest.push(record);
    bucket.slowest.sort((a, b) => b.durationMs - a.durationMs);
    if (bucket.slowest.length > MAX_SLOWEST_PER_HOUR) {
      bucket.slowest.length = MAX_SLOWEST_PER_HOUR;
    }
  }

  public getSummary(hours: number = 24): StatsSummary {
    const now = new Date();
    const buckets = this.getBucketsForLastHours(hours);

    const nowTs = now.getTime();
    const fromTs = buckets.length > 0 ? Math.min(...buckets.map((b) => keyToTimestamp(b.key))) : nowTs;
    const toTs = buckets.length > 0 ? Math.max(...buckets.map((b) => keyToTimestamp(b.key))) + 3600000 : nowTs;

    const combinedGlobal = buckets.reduce(
      (acc, b) => this.mergeStats(acc, b.global),
      createEmptyStats(),
    );

    const perKeyMap = new Map<string, { keyName: string; stats: PerKeyStats }>();
    for (const bucket of buckets) {
      for (const [apiKey, stats] of bucket.perKey.entries()) {
        const existing = perKeyMap.get(apiKey);
        const keyName = bucket.keyNameMap.get(apiKey) ?? apiKey;
        if (existing) {
          existing.stats = this.mergeStats(existing.stats, stats);
        } else {
          perKeyMap.set(apiKey, { keyName, stats: { ...stats } });
        }
      }
    }

    const perKeyResult: StatsSummary['perKey'] = {};
    for (const [apiKey, { keyName, stats }] of perKeyMap.entries()) {
      perKeyResult[apiKey] = {
        keyName,
        totalCalls: stats.totalCalls,
        errorRate: stats.totalCalls > 0 ? stats.errorCalls / stats.totalCalls : 0,
        avgResponseMs: stats.totalCalls > 0 ? stats.totalDurationMs / stats.totalCalls : 0,
      };
    }

    const allSlowest: EndpointCallRecord[] = [];
    for (const bucket of buckets) {
      allSlowest.push(...bucket.slowest);
    }
    allSlowest.sort((a, b) => b.durationMs - a.durationMs);
    const slowestTop10 = allSlowest.slice(0, 10);

    const allDurations: number[] = [];
    for (const bucket of buckets) {
      allDurations.push(...bucket.durations);
    }
    allDurations.sort((a, b) => a - b);

    const totalCalls = combinedGlobal.totalCalls;
    const totalError = combinedGlobal.errorCalls;
    const totalSuccess = combinedGlobal.successCalls;

    let p95 = 0;
    if (allDurations.length > 0) {
      const p95Idx = Math.floor(allDurations.length * 0.95);
      p95 = allDurations[Math.min(p95Idx, allDurations.length - 1)] as number;
    }

    return {
      period: { from: fromTs, to: toTs },
      totalCalls,
      totalSuccess,
      totalError,
      errorRate: totalCalls > 0 ? totalError / totalCalls : 0,
      avgResponseMs: totalCalls > 0 ? combinedGlobal.totalDurationMs / totalCalls : 0,
      p95ResponseMs: p95,
      perKey: perKeyResult,
      slowestTop10,
    };
  }

  public getStatsForHour(key: HourlyStatsKey): {
    global: PerKeyStats;
    perKey: Record<string, PerKeyStats & { keyName: string }>;
  } | null {
    const bucket = this.hourlyBuckets.get(hourKeyToString(key));
    if (!bucket) return null;

    const perKey: Record<string, PerKeyStats & { keyName: string }> = {};
    for (const [apiKey, stats] of bucket.perKey.entries()) {
      perKey[apiKey] = {
        ...stats,
        keyName: bucket.keyNameMap.get(apiKey) ?? apiKey,
      };
    }

    return {
      global: bucket.global,
      perKey,
    };
  }

  public clear(): void {
    this.hourlyBuckets.clear();
  }

  public getActiveHourCount(): number {
    return this.hourlyBuckets.size;
  }

  private createBucket(key: HourlyStatsKey): HourlyBucket {
    return {
      key,
      createdAt: Date.now(),
      global: createEmptyStats(),
      perKey: new Map<string, PerKeyStats>(),
      durations: [],
      slowest: [],
      keyNameMap: new Map<string, string>(),
    };
  }

  private mergeStats(a: PerKeyStats, b: PerKeyStats): PerKeyStats {
    return {
      totalCalls: a.totalCalls + b.totalCalls,
      successCalls: a.successCalls + b.successCalls,
      errorCalls: a.errorCalls + b.errorCalls,
      totalDurationMs: a.totalDurationMs + b.totalDurationMs,
      maxDurationMs: Math.max(a.maxDurationMs, b.maxDurationMs),
      minDurationMs: Math.min(
        a.minDurationMs === Number.POSITIVE_INFINITY ? b.minDurationMs : a.minDurationMs,
        b.minDurationMs === Number.POSITIVE_INFINITY ? a.minDurationMs : b.minDurationMs,
      ),
      cacheHits: a.cacheHits + b.cacheHits,
    };
  }

  private getBucketsForLastHours(hours: number): HourlyBucket[] {
    const now = new Date();
    const nowTs = now.getTime();
    const cutoffTs = nowTs - hours * 3600 * 1000;

    const result: HourlyBucket[] = [];
    for (const bucket of this.hourlyBuckets.values()) {
      const bucketTs = keyToTimestamp(bucket.key);
      if (bucketTs >= cutoffTs) {
        result.push(bucket);
      }
    }

    result.sort((a, b) => keyToTimestamp(a.key) - keyToTimestamp(b.key));
    return result;
  }

  private cleanupOldBuckets(): void {
    const nowTs = Date.now();
    const cutoffTs = nowTs - MAX_HOURS_TO_KEEP * 3600 * 1000;
    const toDelete: string[] = [];

    for (const [keyStr, bucket] of this.hourlyBuckets.entries()) {
      const bucketTs = keyToTimestamp(bucket.key);
      if (bucketTs < cutoffTs) {
        toDelete.push(keyStr);
      }
    }

    for (const keyStr of toDelete) {
      this.hourlyBuckets.delete(keyStr);
    }
  }

  public getAllKeyConfigs(): ApiKeyConfig[] {
    return this.configLoader.getApiKeys();
  }
}
