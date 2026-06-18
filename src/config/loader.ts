import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  AppConfig,
  ApiSource,
  ApiKeyConfig,
  ServerConfig,
  RateLimitConfig,
  LogConfig,
} from '../types';

const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type ValidLogLevel = (typeof VALID_LOG_LEVELS)[number];

export class ConfigLoader {
  private static instance: ConfigLoader | null = null;
  private fileConfig: AppConfig;
  private runtimeApiKeys: ApiKeyConfig[];
  private runtimeApiSources: ApiSource[];

  private constructor(configPath?: string) {
    const resolvedPath = configPath ?? this.getDefaultConfigPath();
    this.fileConfig = this.loadConfig(resolvedPath);
    this.runtimeApiKeys = [];
    this.runtimeApiSources = [];
    this.validateConfig(this.getMergedConfig());
  }

  public static getInstance(configPath?: string): ConfigLoader {
    if (ConfigLoader.instance === null) {
      ConfigLoader.instance = new ConfigLoader(configPath);
    }
    return ConfigLoader.instance;
  }

  public static reset(): void {
    ConfigLoader.instance = null;
  }

  public getConfig(): AppConfig {
    return this.getMergedConfig();
  }

  public getServerConfig(): ServerConfig {
    return this.fileConfig.server;
  }

  public getRateLimitConfig(): RateLimitConfig {
    return this.fileConfig.rateLimit;
  }

  public getLogConfig(): LogConfig {
    return this.fileConfig.log;
  }

  public getApiSources(): ApiSource[] {
    const fileSources = this.fileConfig.apiSources;
    const runtimeSources = this.runtimeApiSources.filter(
      (rs) => !fileSources.some((fs) => fs.id === rs.id),
    );
    return [...fileSources, ...runtimeSources];
  }

  public getEnabledApiSources(): ApiSource[] {
    return this.getApiSources().filter((s) => s.enabled);
  }

  public getApiSourceById(id: string): ApiSource | undefined {
    const runtime = this.runtimeApiSources.find((s) => s.id === id);
    if (runtime) return runtime;
    return this.fileConfig.apiSources.find((s) => s.id === id);
  }

  public getApiKeys(): ApiKeyConfig[] {
    const fileKeys = this.fileConfig.apiKeys;
    const runtimeKeys = this.runtimeApiKeys.filter(
      (rk) => !fileKeys.some((fk) => fk.key === rk.key),
    );
    return [...fileKeys, ...runtimeKeys];
  }

  public getApiKeyByKey(key: string): ApiKeyConfig | undefined {
    const runtime = this.runtimeApiKeys.find((k) => k.key === key);
    if (runtime) return runtime;
    return this.fileConfig.apiKeys.find((k) => k.key === key);
  }

  public addRuntimeApiKey(keyConfig: ApiKeyConfig): void {
    const existing = this.getApiKeyByKey(keyConfig.key);
    if (existing) {
      const runtimeIdx = this.runtimeApiKeys.findIndex((k) => k.key === keyConfig.key);
      if (runtimeIdx >= 0) {
        this.runtimeApiKeys[runtimeIdx] = keyConfig;
      } else {
        const fileIdx = this.fileConfig.apiKeys.findIndex((k) => k.key === keyConfig.key);
        if (fileIdx >= 0) {
          this.fileConfig.apiKeys[fileIdx] = keyConfig;
        }
      }
    } else {
      this.runtimeApiKeys.push(keyConfig);
    }
  }

  public removeRuntimeApiKey(key: string): boolean {
    const idx = this.runtimeApiKeys.findIndex((k) => k.key === key);
    if (idx >= 0) {
      this.runtimeApiKeys.splice(idx, 1);
      return true;
    }
    return false;
  }

  public addRuntimeApiSource(source: ApiSource): void {
    const existing = this.getApiSourceById(source.id);
    if (existing) {
      const runtimeIdx = this.runtimeApiSources.findIndex((s) => s.id === source.id);
      if (runtimeIdx >= 0) {
        this.runtimeApiSources[runtimeIdx] = source;
      } else {
        const fileIdx = this.fileConfig.apiSources.findIndex((s) => s.id === source.id);
        if (fileIdx >= 0) {
          this.fileConfig.apiSources[fileIdx] = source;
        }
      }
    } else {
      this.runtimeApiSources.push(source);
    }
  }

  public removeRuntimeApiSource(id: string): boolean {
    const idx = this.runtimeApiSources.findIndex((s) => s.id === id);
    if (idx >= 0) {
      this.runtimeApiSources.splice(idx, 1);
      return true;
    }
    return false;
  }

  public getRuntimeApiKeys(): ApiKeyConfig[] {
    return [...this.runtimeApiKeys];
  }

  public getRuntimeApiSources(): ApiSource[] {
    return [...this.runtimeApiSources];
  }

  public reload(configPath?: string): void {
    const resolvedPath = configPath ?? this.getDefaultConfigPath();
    const newFileConfig = this.loadConfig(resolvedPath);
    this.validateConfig(this.buildMergedConfig(newFileConfig));
    this.fileConfig = newFileConfig;
    this.runtimeApiSources = this.runtimeApiSources.filter(
      (rs) => !newFileConfig.apiSources.some((fs) => fs.id === rs.id),
    );
    this.runtimeApiKeys = this.runtimeApiKeys.filter(
      (rk) => !newFileConfig.apiKeys.some((fk) => fk.key === rk.key),
    );
  }

  private getMergedConfig(): AppConfig {
    return this.buildMergedConfig(this.fileConfig);
  }

  private buildMergedConfig(fileConfig: AppConfig): AppConfig {
    const mergedApiSources = [
      ...fileConfig.apiSources,
      ...this.runtimeApiSources.filter(
        (rs) => !fileConfig.apiSources.some((fs) => fs.id === rs.id),
      ),
    ];

    const mergedApiKeys = [
      ...fileConfig.apiKeys,
      ...this.runtimeApiKeys.filter(
        (rk) => !fileConfig.apiKeys.some((fk) => fk.key === rk.key),
      ),
    ];

    return {
      server: fileConfig.server,
      rateLimit: fileConfig.rateLimit,
      log: fileConfig.log,
      apiSources: mergedApiSources,
      apiKeys: mergedApiKeys,
    };
  }

  private getDefaultConfigPath(): string {
    const envPath = process.env['JUQIAO_CONFIG_PATH'];
    if (envPath) {
      return path.resolve(envPath);
    }
    return path.resolve(process.cwd(), 'config', 'app.yaml');
  }

  private loadConfig(configPath: string): AppConfig {
    if (!fs.existsSync(configPath)) {
      throw new Error(`配置文件不存在: ${configPath}`);
    }

    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const rawConfig = yaml.load(fileContent) as Record<string, unknown>;

    return this.parseConfig(rawConfig);
  }

  private parseConfig(raw: Record<string, unknown>): AppConfig {
    const server = this.parseServerConfig(raw['server'] as Record<string, unknown> | undefined);
    const rateLimit = this.parseRateLimitConfig(raw['rateLimit'] as Record<string, unknown> | undefined);
    const log = this.parseLogConfig(raw['log'] as Record<string, unknown> | undefined);
    const apiSources = this.parseApiSources(raw['apiSources'] as unknown[] | undefined);
    const apiKeys = this.parseApiKeys(raw['apiKeys'] as unknown[] | undefined);

    return { server, rateLimit, log, apiSources, apiKeys };
  }

  private parseServerConfig(raw: Record<string, unknown> | undefined): ServerConfig {
    const port = typeof raw?.['port'] === 'number' ? raw['port'] : 3000;
    const host = typeof raw?.['host'] === 'string' ? raw['host'] : '0.0.0.0';
    const requestIdHeader =
      typeof raw?.['requestIdHeader'] === 'string' ? raw['requestIdHeader'] : 'X-Request-Id';
    const apiKeyHeader =
      typeof raw?.['apiKeyHeader'] === 'string' ? raw['apiKeyHeader'] : 'X-API-Key';

    return { port, host, requestIdHeader, apiKeyHeader };
  }

  private parseRateLimitConfig(raw: Record<string, unknown> | undefined): RateLimitConfig {
    const enabled = typeof raw?.['enabled'] === 'boolean' ? raw['enabled'] : true;
    const globalQpsLimit = typeof raw?.['globalQpsLimit'] === 'number' ? raw['globalQpsLimit'] : 500;
    const defaultPerKeyPerMinute =
      typeof raw?.['defaultPerKeyPerMinute'] === 'number' ? raw['defaultPerKeyPerMinute'] : 60;
    const windowSizeMs =
      typeof raw?.['windowSizeMs'] === 'number' ? raw['windowSizeMs'] : 60000;

    return { enabled, globalQpsLimit, defaultPerKeyPerMinute, windowSizeMs };
  }

  private parseLogConfig(raw: Record<string, unknown> | undefined): LogConfig {
    const enabled = typeof raw?.['enabled'] === 'boolean' ? raw['enabled'] : true;
    const levelRaw = raw?.['level'];
    const level: ValidLogLevel =
      typeof levelRaw === 'string' && VALID_LOG_LEVELS.includes(levelRaw as ValidLogLevel)
        ? (levelRaw as ValidLogLevel)
        : 'info';
    const consoleEnabled =
      typeof raw?.['consoleEnabled'] === 'boolean' ? raw['consoleEnabled'] : true;
    const fileEnabled = typeof raw?.['fileEnabled'] === 'boolean' ? raw['fileEnabled'] : true;
    const logDir = typeof raw?.['logDir'] === 'string' ? raw['logDir'] : 'logs';
    const maxFileSizeMb =
      typeof raw?.['maxFileSizeMb'] === 'number' ? raw['maxFileSizeMb'] : 50;
    const maxFiles = typeof raw?.['maxFiles'] === 'number' ? raw['maxFiles'] : 30;

    return { enabled, level, consoleEnabled, fileEnabled, logDir, maxFileSizeMb, maxFiles };
  }

  private parseApiSources(raw: unknown[] | undefined): ApiSource[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((item, index) => {
      const source = item as Record<string, unknown>;
      const id = typeof source['id'] === 'string' ? source['id'] : `source-${index}`;
      const name = typeof source['name'] === 'string' ? source['name'] : id;
      const baseUrl = typeof source['baseUrl'] === 'string' ? source['baseUrl'] : '';
      const timeoutMs = typeof source['timeoutMs'] === 'number' ? source['timeoutMs'] : 5000;
      const enabled = typeof source['enabled'] === 'boolean' ? source['enabled'] : true;

      const retryRaw = source['retry'] as Record<string, unknown> | undefined;
      const retry = {
        maxRetries: typeof retryRaw?.['maxRetries'] === 'number' ? retryRaw['maxRetries'] : 2,
        delayMs: typeof retryRaw?.['delayMs'] === 'number' ? retryRaw['delayMs'] : 300,
      };

      const headers = this.parseRecord(source['headers']);
      const queryParams = this.parseRecord(source['queryParams']);
      const endpoint = typeof source['endpoint'] === 'string' ? source['endpoint'] : undefined;

      return { id, name, baseUrl, timeoutMs, retry, headers, queryParams, endpoint, enabled };
    });
  }

  private parseApiKeys(raw: unknown[] | undefined): ApiKeyConfig[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((item) => {
      const keyObj = item as Record<string, unknown>;
      const key = typeof keyObj['key'] === 'string' ? keyObj['key'] : '';
      const name = typeof keyObj['name'] === 'string' ? keyObj['name'] : 'Unknown';
      const allowedApis = Array.isArray(keyObj['allowedApis'])
        ? (keyObj['allowedApis'] as string[]).filter((s) => typeof s === 'string')
        : [];
      const rateLimitPerMinute =
        typeof keyObj['rateLimitPerMinute'] === 'number' ? keyObj['rateLimitPerMinute'] : undefined;
      const enabled = typeof keyObj['enabled'] === 'boolean' ? keyObj['enabled'] : true;

      return { key, name, allowedApis, rateLimitPerMinute, enabled };
    });
  }

  private parseRecord(value: unknown): Record<string, string> | undefined {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const result: Record<string, string> = {};
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string') {
        result[k] = v;
      } else if (v !== undefined && v !== null) {
        result[k] = String(v);
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  private validateConfig(config: AppConfig): void {
    const errors: string[] = [];

    if (config.rateLimit.globalQpsLimit <= 0) {
      errors.push('全局限流 globalQpsLimit 必须大于 0');
    }
    if (config.rateLimit.defaultPerKeyPerMinute <= 0) {
      errors.push('默认限流 defaultPerKeyPerMinute 必须大于 0');
    }
    if (config.rateLimit.windowSizeMs <= 0) {
      errors.push('限流窗口 windowSizeMs 必须大于 0');
    }

    if (config.log.maxFileSizeMb <= 0) {
      errors.push('日志文件大小 maxFileSizeMb 必须大于 0');
    }
    if (config.log.maxFiles <= 0) {
      errors.push('日志保留数量 maxFiles 必须大于 0');
    }

    if (config.apiSources.length === 0) {
      errors.push('至少需要配置一个 API 源');
    }

    const sourceIds = new Set<string>();
    for (const source of config.apiSources) {
      if (sourceIds.has(source.id)) {
        errors.push(`API 源 ID 重复: ${source.id}`);
      }
      sourceIds.add(source.id);

      if (!source.baseUrl) {
        errors.push(`API 源 ${source.id} 缺少 baseUrl`);
      }
    }

    const apiKeys = new Set<string>();
    for (const key of config.apiKeys) {
      if (!key.key) {
        errors.push('存在空的 API Key');
        continue;
      }
      if (apiKeys.has(key.key)) {
        errors.push(`API Key 重复: ${key.key}`);
      }
      apiKeys.add(key.key);

      if (key.rateLimitPerMinute !== undefined && key.rateLimitPerMinute <= 0) {
        errors.push(`API Key ${key.key} 的 rateLimitPerMinute 必须大于 0`);
      }

      for (const apiId of key.allowedApis) {
        if (apiId !== '*' && !sourceIds.has(apiId)) {
          errors.push(`API Key ${key.key} 引用了不存在的 API 源: ${apiId}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`配置校验失败:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    }
  }
}
