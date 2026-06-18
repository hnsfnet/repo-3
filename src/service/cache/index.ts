import type { CacheEntry, CachePolicyConfig } from '../../types';
import { ICacheStore, LruCacheStore, LfuCacheStore, FifoCacheStore } from './strategy';

export { ICacheStore, LruCacheStore, LfuCacheStore, FifoCacheStore } from './strategy';

const DEFAULT_POLICY: CachePolicyConfig = {
  ttlMs: 300000,
  eviction: 'lru',
  maxEntries: 1000,
};

export class CacheManager {
  private static instance: CacheManager | null = null;
  private stores: Map<string, ICacheStore>;
  private defaultStore: ICacheStore;

  private constructor() {
    this.stores = new Map<string, ICacheStore>();
    this.defaultStore = this.createStoreInternal(DEFAULT_POLICY);
  }

  public static getInstance(): CacheManager {
    if (CacheManager.instance === null) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  public createStore(sourceId: string, policy: CachePolicyConfig): ICacheStore {
    const store = this.createStoreInternal(policy);
    this.stores.set(sourceId, store);
    return store;
  }

  public getStore(sourceId: string): ICacheStore | undefined {
    return this.stores.get(sourceId);
  }

  public getStoreNames(): string[] {
    return Array.from(this.stores.keys());
  }

  public getDefaultStore(): ICacheStore {
    return this.defaultStore;
  }

  public clearAll(): void {
    this.defaultStore.clear();
    for (const store of this.stores.values()) {
      store.clear();
    }
  }

  private createStoreInternal(policy: CachePolicyConfig): ICacheStore {
    switch (policy.eviction) {
      case 'lfu':
        return new LfuCacheStore(policy);
      case 'fifo':
        return new FifoCacheStore(policy);
      case 'lru':
      default:
        return new LruCacheStore(policy);
    }
  }
}

export class CacheService {
  private static instance: CacheService | null = null;
  private manager: CacheManager;

  private constructor() {
    this.manager = CacheManager.getInstance();
  }

  public static getInstance(): CacheService {
    if (CacheService.instance === null) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  public set(key: string, data: unknown): void {
    this.manager.getDefaultStore().set(key, data);
  }

  public get(key: string): CacheEntry | undefined {
    return this.manager.getDefaultStore().get(key);
  }

  public getData(key: string): unknown | null {
    const entry = this.manager.getDefaultStore().get(key);
    return entry ? entry.data : null;
  }

  public has(key: string): boolean {
    return this.manager.getDefaultStore().has(key);
  }

  public delete(key: string): boolean {
    return this.manager.getDefaultStore().delete(key);
  }

  public clear(): void {
    this.manager.getDefaultStore().clear();
  }

  public keys(): string[] {
    return this.manager.getDefaultStore().keys();
  }

  public size(): number {
    return this.manager.getDefaultStore().size();
  }

  public getEntryInfo(key: string): { exists: boolean; ageMs?: number; timestamp?: number } {
    return this.manager.getDefaultStore().getEntryInfo(key);
  }

  public cleanByTtl(maxAgeMs: number): number {
    const store = this.manager.getDefaultStore();
    let removed = 0;
    for (const key of store.keys()) {
      const info = store.getEntryInfo(key);
      if (info.exists && info.ageMs !== undefined && info.ageMs > maxAgeMs) {
        store.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
