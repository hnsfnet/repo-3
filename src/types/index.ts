import type { Request as ExpressRequest } from 'express';

export interface RetryPolicy {
  maxRetries: number;
  delayMs: number;
}

export interface ApiSource {
  id: string;
  name: string;
  baseUrl: string;
  timeoutMs: number;
  retry: RetryPolicy;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  endpoint?: string;
  enabled: boolean;
}

export interface ApiKeyConfig {
  key: string;
  name: string;
  allowedApis: string[];
  rateLimitPerMinute?: number;
  enabled: boolean;
}

export interface ServerConfig {
  port: number;
  host: string;
  requestIdHeader: string;
  apiKeyHeader: string;
}

export interface AppConfig {
  server: ServerConfig;
  apiSources: ApiSource[];
  apiKeys: ApiKeyConfig[];
}

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
  requestId?: string;
}

export interface AggregateRequest {
  apis: string[];
  params?: Record<string, unknown>;
}

export interface SourceResult {
  sourceId: string;
  sourceName: string;
  success: boolean;
  fromCache: boolean;
  data?: unknown;
  error?: string;
  timestamp: number;
}

export interface CacheEntry {
  data: unknown;
  timestamp: number;
}

export interface AuthenticatedRequest extends ExpressRequest {
  apiKey?: string;
  keyConfig?: ApiKeyConfig;
  requestId?: string;
}
