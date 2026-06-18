import type { ApiSource, SourceResult, ApiKeyConfig } from '../types';
import { ConfigLoader } from '../config/loader';
import { ApiCallerService } from './apiCaller';
import { hasApiPermission } from '../middleware/auth';

export interface AggregateOptions {
  apiIds: string[];
  params?: Record<string, unknown>;
  keyConfig: ApiKeyConfig;
}

export interface AggregateResult {
  results: SourceResult[];
  summary: {
    total: number;
    success: number;
    failed: number;
    fromCache: number;
  };
}

export class AggregatorService {
  private apiCaller: ApiCallerService;
  private configLoader: ConfigLoader;

  constructor() {
    this.apiCaller = new ApiCallerService();
    this.configLoader = ConfigLoader.getInstance();
  }

  public async aggregate(options: AggregateOptions): Promise<AggregateResult> {
    const { apiIds, params = {}, keyConfig } = options;

    const sources = this.resolveAndValidateSources(apiIds, keyConfig);
    const results = await this.callSourcesInParallel(sources, params);

    const summary = this.buildSummary(results);

    return {
      results,
      summary,
    };
  }

  public async callSingle(
    apiId: string,
    params: Record<string, unknown>,
    keyConfig: ApiKeyConfig,
  ): Promise<SourceResult | null> {
    const source = this.configLoader.getApiSourceById(apiId);
    if (!source) {
      return null;
    }

    if (!source.enabled) {
      return null;
    }

    if (!hasApiPermission(keyConfig, apiId)) {
      return null;
    }

    return this.apiCaller.callSource(source, params);
  }

  public listAvailableSources(keyConfig: ApiKeyConfig): Array<Pick<ApiSource, 'id' | 'name' | 'enabled'>> {
    return this.configLoader
      .getEnabledApiSources()
      .filter((s) => hasApiPermission(keyConfig, s.id))
      .map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }));
  }

  private resolveAndValidateSources(
    apiIds: string[],
    keyConfig: ApiKeyConfig,
  ): ApiSource[] {
    const resolved: ApiSource[] = [];
    const seen = new Set<string>();

    for (const apiId of apiIds) {
      if (seen.has(apiId)) {
        continue;
      }
      seen.add(apiId);

      if (!hasApiPermission(keyConfig, apiId)) {
        continue;
      }

      const source = this.configLoader.getApiSourceById(apiId);
      if (source && source.enabled) {
        resolved.push(source);
      }
    }

    return resolved;
  }

  private async callSourcesInParallel(
    sources: ApiSource[],
    params: Record<string, unknown>,
  ): Promise<SourceResult[]> {
    const promises = sources.map((source) =>
      this.apiCaller.callSource(source, params).catch((error) =>
        this.handleUnexpectedError(source, error),
      ),
    );

    return Promise.all(promises);
  }

  private handleUnexpectedError(
    source: ApiSource,
    error: unknown,
  ): SourceResult {
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? '未知错误');

    return {
      sourceId: source.id,
      sourceName: source.name,
      success: false,
      fromCache: false,
      error: `意外错误: ${errorMessage}`,
      timestamp: Date.now(),
    };
  }

  private buildSummary(results: SourceResult[]): {
    total: number;
    success: number;
    failed: number;
    fromCache: number;
  } {
    let success = 0;
    let failed = 0;
    let fromCache = 0;

    for (const r of results) {
      if (r.success) {
        success++;
        if (r.fromCache) {
          fromCache++;
        }
      } else {
        failed++;
      }
    }

    return {
      total: results.length,
      success,
      failed,
      fromCache,
    };
  }
}
