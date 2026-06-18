import type { CacheEntry, CachePolicyConfig } from '../../types';

export interface ICacheStore {
  get(key: string): CacheEntry | undefined;
  set(key: string, data: unknown): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  clear(): void;
  keys(): string[];
  size(): number;
  getEntryInfo(key: string): { exists: boolean; ageMs?: number; timestamp?: number };
  cleanExpired(): number;
}

export class LruCacheStore implements ICacheStore {
  private store: Map<string, CacheEntry>;
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(policy: CachePolicyConfig) {
    this.store = new Map<string, CacheEntry>();
    this.maxEntries = policy.maxEntries;
    this.ttlMs = policy.ttlMs;
  }

  public get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  public set(key: string, data: unknown): void {
    this.store.delete(key);
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }
    this.store.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  public has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  public clear(): void {
    this.store.clear();
  }

  public keys(): string[] {
    return Array.from(this.store.keys());
  }

  public size(): number {
    return this.store.size;
  }

  public getEntryInfo(key: string): { exists: boolean; ageMs?: number; timestamp?: number } {
    const entry = this.store.get(key);
    if (!entry) {
      return { exists: false };
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return { exists: false };
    }
    return {
      exists: true,
      ageMs: Date.now() - entry.timestamp,
      timestamp: entry.timestamp,
    };
  }

  public cleanExpired(): number {
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.ttlMs;
  }
}

export class LfuCacheStore implements ICacheStore {
  private store: Map<string, CacheEntry>;
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(policy: CachePolicyConfig) {
    this.store = new Map<string, CacheEntry>();
    this.maxEntries = policy.maxEntries;
    this.ttlMs = policy.ttlMs;
  }

  public get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    entry.frequency = (entry.frequency ?? 0) + 1;
    return entry;
  }

  public set(key: string, data: unknown): void {
    const existing = this.store.get(key);
    if (existing) {
      existing.data = data;
      existing.timestamp = Date.now();
      existing.frequency = (existing.frequency ?? 0) + 1;
      return;
    }
    if (this.store.size >= this.maxEntries) {
      this.evictLfu();
    }
    this.store.set(key, {
      data,
      timestamp: Date.now(),
      frequency: 1,
    });
  }

  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  public has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  public clear(): void {
    this.store.clear();
  }

  public keys(): string[] {
    return Array.from(this.store.keys());
  }

  public size(): number {
    return this.store.size;
  }

  public getEntryInfo(key: string): { exists: boolean; ageMs?: number; timestamp?: number } {
    const entry = this.store.get(key);
    if (!entry) {
      return { exists: false };
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return { exists: false };
    }
    return {
      exists: true,
      ageMs: Date.now() - entry.timestamp,
      timestamp: entry.timestamp,
    };
  }

  public cleanExpired(): number {
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private evictLfu(): void {
    let minFreq = Infinity;
    let evictKey: string | undefined;
    for (const [key, entry] of this.store.entries()) {
      if ((entry.frequency ?? 0) < minFreq) {
        minFreq = entry.frequency ?? 0;
        evictKey = key;
      }
    }
    if (evictKey !== undefined) {
      this.store.delete(evictKey);
    }
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.ttlMs;
  }
}

export class FifoCacheStore implements ICacheStore {
  private store: Map<string, CacheEntry>;
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(policy: CachePolicyConfig) {
    this.store = new Map<string, CacheEntry>();
    this.maxEntries = policy.maxEntries;
    this.ttlMs = policy.ttlMs;
  }

  public get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  public set(key: string, data: unknown): void {
    if (this.store.has(key)) {
      this.store.delete(key);
      this.store.set(key, {
        data,
        timestamp: Date.now(),
      });
      return;
    }
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }
    this.store.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  public has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  public clear(): void {
    this.store.clear();
  }

  public keys(): string[] {
    return Array.from(this.store.keys());
  }

  public size(): number {
    return this.store.size;
  }

  public getEntryInfo(key: string): { exists: boolean; ageMs?: number; timestamp?: number } {
    const entry = this.store.get(key);
    if (!entry) {
      return { exists: false };
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return { exists: false };
    }
    return {
      exists: true,
      ageMs: Date.now() - entry.timestamp,
      timestamp: entry.timestamp,
    };
  }

  public cleanExpired(): number {
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.ttlMs;
  }
}
