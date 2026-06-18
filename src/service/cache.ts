import type { CacheEntry } from '../types';

export class CacheService {
  private static instance: CacheService | null = null;
  private cache: Map<string, CacheEntry>;

  private constructor() {
    this.cache = new Map<string, CacheEntry>();
  }

  public static getInstance(): CacheService {
    if (CacheService.instance === null) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  public set(key: string, data: unknown): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  public get(key: string): CacheEntry | undefined {
    return this.cache.get(key);
  }

  public getData(key: string): unknown | null {
    const entry = this.cache.get(key);
    return entry ? entry.data : null;
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public delete(key: string): boolean {
    return this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  public keys(): string[] {
    return Array.from(this.cache.keys());
  }

  public size(): number {
    return this.cache.size;
  }

  public getEntryInfo(key: string): { exists: boolean; ageMs?: number; timestamp?: number } {
    const entry = this.cache.get(key);
    if (!entry) {
      return { exists: false };
    }
    return {
      exists: true,
      ageMs: Date.now() - entry.timestamp,
      timestamp: entry.timestamp,
    };
  }

  public cleanByTtl(maxAgeMs: number): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > maxAgeMs) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
