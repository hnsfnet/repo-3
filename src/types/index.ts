import type { Request as ExpressRequest } from 'express';

export interface RetryPolicy {
  maxRetries: number;
  delayMs: number;
}

export type CacheEvictionPolicy = 'lru' | 'lfu' | 'fifo';

export interface CachePolicyConfig {
  ttlMs: number;
  eviction: CacheEvictionPolicy;
  maxEntries: number;
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
  cache?: CachePolicyConfig;
  adapter?: string;
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

export interface RateLimitConfig {
  enabled: boolean;
  globalQpsLimit: number;
  defaultPerKeyPerMinute: number;
  windowSizeMs: number;
}

export interface LogConfig {
  enabled: boolean;
  level: 'debug' | 'info' | 'warn' | 'error';
  consoleEnabled: boolean;
  fileEnabled: boolean;
  logDir: string;
  maxFileSizeMb: number;
  maxFiles: number;
}

export interface PluginConfig {
  name: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface AppConfig {
  server: ServerConfig;
  rateLimit: RateLimitConfig;
  log: LogConfig;
  plugins: PluginConfig[];
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
  frequency?: number;
}

export interface AuthenticatedRequest extends ExpressRequest {
  apiKey?: string;
  keyConfig?: ApiKeyConfig;
  requestId?: string;
  startTime?: number;
  cacheHitCount?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetMs: number;
  retryAfterMs?: number;
}

export interface GlobalRateLimitResult {
  allowed: boolean;
  currentQps: number;
  limit: number;
}

export interface AccessLogEntry {
  timestamp: number;
  date: string;
  requestId: string;
  apiKey: string;
  keyName: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  cacheHit: boolean;
  cacheHitCount: number;
  error?: string;
  userAgent?: string;
  clientIp?: string;
}

export interface HourlyStatsKey {
  date: string;
  hour: number;
}

export interface PerKeyStats {
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  totalDurationMs: number;
  maxDurationMs: number;
  minDurationMs: number;
  cacheHits: number;
}

export interface EndpointCallRecord {
  method: string;
  path: string;
  durationMs: number;
  timestamp: number;
  apiKey: string;
  statusCode: number;
}

export interface StatsSummary {
  period: {
    from: number;
    to: number;
  };
  totalCalls: number;
  totalSuccess: number;
  totalError: number;
  errorRate: number;
  avgResponseMs: number;
  p95ResponseMs: number;
  perKey: Record<string, {
    keyName: string;
    totalCalls: number;
    errorRate: number;
    avgResponseMs: number;
  }>;
  slowestTop10: EndpointCallRecord[];
}

export interface PluginContext {
  req: ExpressRequest;
  res: import('express').Response;
  requestId: string;
  apiKey?: string;
  keyConfig?: ApiKeyConfig;
  startTime: number;
  cacheHitCount: number;
  [key: string]: unknown;
}

export interface IPlugin {
  name: string;
  init(options?: Record<string, unknown>): void;
  onRequest(ctx: PluginContext): Promise<PluginContext | null>;
  onResponse(ctx: PluginContext): Promise<PluginContext>;
  onError(ctx: PluginContext, error: unknown): Promise<PluginContext>;
}

export interface AdapterFetchOptions {
  params: Record<string, unknown>;
  timeoutMs: number;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
}

export interface IAdapter {
  readonly sourceId: string;
  fetch(options: AdapterFetchOptions): Promise<unknown>;
  transform(rawData: unknown): unknown;
  fallback(cachedData: unknown | null, error: unknown): SourceResult;
}
