import type { IAdapter, ApiSource } from '../types';
import { HttpAdapter } from './http';

export class AdapterRegistry {
  private static instance: AdapterRegistry | null = null;
  private adapters: Map<string, new (source: ApiSource) => IAdapter>;

  private constructor() {
    this.adapters = new Map<string, new (source: ApiSource) => IAdapter>();
    this.adapters.set('default', HttpAdapter);
    this.adapters.set('http', HttpAdapter);
  }

  public static getInstance(): AdapterRegistry {
    if (AdapterRegistry.instance === null) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  public static reset(): void {
    AdapterRegistry.instance = null;
  }

  public register(name: string, adapterClass: new (source: ApiSource) => IAdapter): void {
    this.adapters.set(name, adapterClass);
  }

  public create(source: ApiSource): IAdapter {
    const adapterName = source.adapter ?? 'default';
    const AdapterClass = this.adapters.get(adapterName);
    if (!AdapterClass) {
      throw new Error(`Unknown adapter: ${adapterName}`);
    }
    return new AdapterClass(source);
  }
}
