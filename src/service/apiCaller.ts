import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import type { ApiSource, SourceResult } from '../types';
import { CacheService } from './cache';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ApiCallerService {
  private cache: CacheService;

  constructor() {
    this.cache = CacheService.getInstance();
  }

  public async callSource(
    source: ApiSource,
    params: Record<string, unknown> = {},
  ): Promise<SourceResult> {
    const cacheKey = this.buildCacheKey(source.id, params);

    try {
      const data = await this.executeWithRetry(source, params);
      this.cache.set(cacheKey, data);

      return {
        sourceId: source.id,
        sourceName: source.name,
        success: true,
        fromCache: false,
        data,
        timestamp: Date.now(),
      };
    } catch (error) {
      return this.buildDegradedResult(source, cacheKey, error);
    }
  }

  private async executeWithRetry(
    source: ApiSource,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const { maxRetries, delayMs } = source.retry;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.doHttpRequest(source, params);
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

  private async doHttpRequest(
    source: ApiSource,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const url = this.buildUrl(source, params);
    const requestConfig: AxiosRequestConfig = {
      method: 'GET',
      url,
      timeout: source.timeoutMs,
      headers: {
        Accept: 'application/json',
        ...(source.headers ?? {}),
      },
      params: {
        ...(source.queryParams ?? {}),
        ...this.stringifyParams(params),
      },
      validateStatus: (status: number) => status >= 200 && status < 300,
    };

    const response = await axios.request(requestConfig);
    return response.data;
  }

  private buildDegradedResult(
    source: ApiSource,
    cacheKey: string,
    error: unknown,
  ): SourceResult {
    const cachedEntry = this.cache.get(cacheKey);
    const errorMsg = this.extractErrorMessage(error);

    if (cachedEntry) {
      return {
        sourceId: source.id,
        sourceName: source.name,
        success: true,
        fromCache: true,
        data: cachedEntry.data,
        error: `降级响应 (原始错误: ${errorMsg})`,
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

  private extractErrorMessage(error: unknown): string {
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

  private buildCacheKey(sourceId: string, params: Record<string, unknown>): string {
    const sortedKeys = Object.keys(params).sort();
    const paramsStr = sortedKeys
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k] ?? ''))}`)
      .join('&');
    return paramsStr.length > 0 ? `${sourceId}:${paramsStr}` : sourceId;
  }

  private buildUrl(source: ApiSource, params: Record<string, unknown>): string {
    let url = source.baseUrl;
    if (source.endpoint) {
      const processedEndpoint = source.endpoint.replace(
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

  private stringifyParams(
    params: Record<string, unknown>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of Object.keys(params)) {
      const value = params[key as string];
      if (value !== undefined && value !== null) {
        result[key as string] = typeof value === 'object' ? JSON.stringify(value) : String(value);
      }
    }
    return result;
  }
}
