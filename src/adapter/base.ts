import axios, { AxiosError } from 'axios';
import type { IAdapter, AdapterFetchOptions, ApiSource, SourceResult } from '../types';

export abstract class BaseAdapter implements IAdapter {
  protected source: ApiSource;

  constructor(source: ApiSource) {
    this.source = source;
  }

  get sourceId(): string {
    return this.source.id;
  }

  abstract fetch(options: AdapterFetchOptions): Promise<unknown>;

  transform(rawData: unknown): unknown {
    return rawData;
  }

  fallback(cachedData: unknown | null, error: unknown): SourceResult {
    const errorMsg = this.extractErrorMessage(error);

    if (cachedData !== null && cachedData !== undefined) {
      return {
        sourceId: this.source.id,
        sourceName: this.source.name,
        success: true,
        fromCache: true,
        data: cachedData,
        error: `降级响应 (原始错误: ${errorMsg})`,
        timestamp: Date.now(),
      };
    }

    return {
      sourceId: this.source.id,
      sourceName: this.source.name,
      success: false,
      fromCache: false,
      error: errorMsg,
      timestamp: Date.now(),
    };
  }

  protected buildUrl(params: Record<string, unknown>): string {
    let url = this.source.baseUrl;
    if (this.source.endpoint) {
      const processedEndpoint = this.source.endpoint.replace(
        /\{([^}]+)\}/g,
        (_match, key) => {
          const value = params[key as string];
          return value !== undefined ? encodeURIComponent(String(value)) : '';
        },
      );
      url = url.replace(/\/$/, '') + '/' + processedEndpoint.replace(/^\//, '');
    }
    return url;
  }

  protected stringifyParams(params: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of Object.keys(params)) {
      const value = params[key];
      if (value !== undefined && value !== null) {
        result[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
      }
    }
    return result;
  }

  protected extractErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.code === 'ECONNABORTED') {
        return '请求超时';
      }
      if (axiosError.response) {
        const { status, statusText } = axiosError.response;
        return `HTTP ${status} ${statusText}`;
      }
      if (axiosError.message) {
        return axiosError.message;
      }
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return '未知错误';
  }
}
