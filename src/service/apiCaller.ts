import type { ApiSource, SourceResult, ICacheStore } from '../types';
import { CacheManager } from './cache';
import { AdapterRegistry } from '../adapter';

interface PendingRequest {
  promise: Promise<SourceResult>;
  resolve: (result: SourceResult) => void;
  reject: (error: unknown) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_WAIT_MS = 30000;

export class ApiCallerService {
  private cacheManager: CacheManager;
  private adapterRegistry: AdapterRegistry;
  private pendingRequests: Map<string, PendingRequest>;

  constructor() {
    this.cacheManager = CacheManager.getInstance();
    this.adapterRegistry = AdapterRegistry.getInstance();
    this.pendingRequests = new Map<string, PendingRequest>();
  }

  public async callSource(
    source: ApiSource,
    params: Record<string, unknown> = {},
  ): Promise<SourceResult> {
    const cacheKey = this.buildCacheKey(source.id, params);
    const cacheStore = this.resolveCacheStore(source);

    const cached = cacheStore.get(cacheKey);
    if (cached && !this.isExpired(cached.timestamp, source)) {
      return {
        sourceId: source.id,
        sourceName: source.name,
        success: true,
        fromCache: true,
        data: cached.data,
        timestamp: cached.timestamp,
      };
    }

    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return this.waitForPendingResult(source, cacheKey, pending.promise, cacheStore);
    }

    return this.executeAsLeader(source, cacheKey, params, cacheStore);
  }

  private isExpired(timestamp: number, source: ApiSource): boolean {
    const ttlMs = source.cache?.ttlMs ?? 300000;
    return Date.now() - timestamp > ttlMs;
  }

  private resolveCacheStore(source: ApiSource): ICacheStore {
    if (source.cache) {
      let store = this.cacheManager.getStore(source.id);
      if (!store) {
        store = this.cacheManager.createStore(source.id, source.cache);
      }
      return store;
    }
    return this.cacheManager.getDefaultStore();
  }

  private async waitForPendingResult(
    source: ApiSource,
    cacheKey: string,
    pendingPromise: Promise<SourceResult>,
    cacheStore: ICacheStore,
  ): Promise<SourceResult> {
    const startWait = Date.now();

    try {
      const result = await Promise.race([
        pendingPromise,
        this.createWaitTimeout(startWait),
      ]);
      return result;
    } catch {
      return this.buildDegradedFromCache(source, cacheKey, cacheStore, '等待上游请求超时');
    }
  }

  private createWaitTimeout(startWait: number): Promise<never> {
    return new Promise<never>((_resolve, reject) => {
      const remaining = MAX_WAIT_MS - (Date.now() - startWait);
      if (remaining <= 0) {
        reject(new Error('wait_timeout'));
        return;
      }
      setTimeout(() => reject(new Error('wait_timeout')), remaining);
    });
  }

  private async executeAsLeader(
    source: ApiSource,
    cacheKey: string,
    params: Record<string, unknown>,
    cacheStore: ICacheStore,
  ): Promise<SourceResult> {
    let resolveFunc: (result: SourceResult) => void;
    let rejectFunc: (error: unknown) => void;

    const promise = new Promise<SourceResult>((resolve, reject) => {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    this.pendingRequests.set(cacheKey, {
      promise,
      resolve: resolveFunc!,
      reject: rejectFunc!,
    });

    try {
      const data = await this.executeWithRetry(source, params);
      const transformed = this.transformResponse(source, data);
      cacheStore.set(cacheKey, transformed);

      const result: SourceResult = {
        sourceId: source.id,
        sourceName: source.name,
        success: true,
        fromCache: false,
        data: transformed,
        timestamp: Date.now(),
      };

      this.resolvePending(cacheKey, result);
      return result;
    } catch (error) {
      const adapter = this.adapterRegistry.create(source);
      const result = adapter.fallback(cacheStore.get(cacheKey)?.data ?? null, error);
      this.resolvePending(cacheKey, result);
      return result;
    }
  }

  private resolvePending(cacheKey: string, result: SourceResult): void {
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      pending.resolve(result);
      this.pendingRequests.delete(cacheKey);
    }
  }

  private buildDegradedFromCache(
    source: ApiSource,
    cacheKey: string,
    cacheStore: ICacheStore,
    errorMsg: string,
  ): SourceResult {
    const cachedEntry = cacheStore.get(cacheKey);

    if (cachedEntry) {
      return {
        sourceId: source.id,
        sourceName: source.name,
        success: true,
        fromCache: true,
        data: cachedEntry.data,
        error: `降级响应 (原因: ${errorMsg})`,
        timestamp: cachedEntry.timestamp,
      };
    }

    return {
      sourceId: source.id,
      sourceName: source.name,
      success: false,
      fromCache: false,
      error: errorMsg,
      timestamp: Date.now(),
    };
  }

  private async executeWithRetry(
    source: ApiSource,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const { maxRetries, delayMs } = source.retry;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const adapter = this.adapterRegistry.create(source);
        return await adapter.fetch({
          params,
          timeoutMs: source.timeoutMs,
          headers: source.headers,
          queryParams: source.queryParams,
        });
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          const waitTime = delayMs * Math.pow(2, attempt);
          await sleep(waitTime);
        }
      }
    }

    throw lastError;
  }

  private transformResponse(source: ApiSource, rawData: unknown): unknown {
    const adapter = this.adapterRegistry.create(source);
    return adapter.transform(rawData);
  }

  private buildCacheKey(sourceId: string, params: Record<string, unknown>): string {
    const sortedKeys = Object.keys(params).sort();
    const paramsStr = sortedKeys
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k] ?? ''))}`)
      .join('&');
    return paramsStr.length > 0 ? `${sourceId}:${paramsStr}` : sourceId;
  }
}
