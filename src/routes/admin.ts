import { Router, type Request, type Response } from 'express';
import { StatsService } from '../service/stats';
import { RateLimitService } from '../service/rateLimit';
import { LoggerService } from '../service/logger';
import { CacheManager } from '../service/cache';
import { ConfigLoader } from '../config/loader';
import { getKeyConfigFromRequest } from '../middleware/auth';
import { sendSuccess, sendForbidden, sendBadRequest, sendNotFound } from '../utils/response';
import type { ApiKeyConfig, ApiSource } from '../types';

const router = Router();
const stats = StatsService.getInstance();
const rateLimit = RateLimitService.getInstance();
const logger = LoggerService.getInstance();
const cacheManager = CacheManager.getInstance();
const configLoader = ConfigLoader.getInstance();

function requireAdmin(req: Request, res: Response): boolean {
  const keyConfig = getKeyConfigFromRequest(req);
  if (!keyConfig || !keyConfig.allowedApis.includes('*')) {
    sendForbidden(req, res, '需要管理员权限', 40310);
    return false;
  }
  return true;
}

router.get('/stats', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const hoursParam = req.query['hours'];
  let hours = 24;
  if (typeof hoursParam === 'string') {
    const parsed = parseInt(hoursParam, 10);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 48) {
      hours = parsed;
    }
  }

  const summary = stats.getSummary(hours);
  sendSuccess(req, res, summary);
});

router.get('/stats/hour', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const dateParam = req.query['date'];
  const hourParam = req.query['hour'];

  if (typeof dateParam !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    sendBadRequest(req, res, 'date 参数格式错误，应为 YYYY-MM-DD', 40010);
    return;
  }
  if (typeof hourParam !== 'string') {
    sendBadRequest(req, res, 'hour 参数必填', 40011);
    return;
  }
  const hour = parseInt(hourParam, 10);
  if (Number.isNaN(hour) || hour < 0 || hour > 23) {
    sendBadRequest(req, res, 'hour 参数应在 0-23 之间', 40012);
    return;
  }

  const data = stats.getStatsForHour({ date: dateParam, hour });
  sendSuccess(req, res, data);
});

router.delete('/stats', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const cleared = stats.getActiveHourCount();
  stats.clear();
  sendSuccess(req, res, { clearedBuckets: cleared });
});

router.get('/rate-limit', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const rlConfig = configLoader.getRateLimitConfig();
  const rlStats = rateLimit.getStats();

  sendSuccess(req, res, {
    config: rlConfig,
    stats: rlStats,
    enabled: rateLimit.isEnabled(),
  });
});

router.get('/logger', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const logConfig = configLoader.getLogConfig();
  sendSuccess(req, res, {
    config: logConfig,
    logDir: logger.getLogDir(),
    currentLogFile: logger.getCurrentLogFileName(),
    enabled: logger.isEnabled(),
  });
});

router.get('/config', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const appConfig = configLoader.getConfig();
  const sanitizedKeys = appConfig.apiKeys.map((k) => ({
    ...k,
    key: k.key.slice(0, 8) + '****' + k.key.slice(-4),
  }));
  const sanitizedSources = appConfig.apiSources.map((s) => ({
    ...s,
    headers: s.headers
      ? Object.fromEntries(
          Object.entries(s.headers).map(([k, v]) => [
            k,
            k.toLowerCase().includes('token') || k.toLowerCase().includes('key')
              ? '****'
              : v,
          ]),
        )
      : undefined,
    queryParams: s.queryParams
      ? Object.fromEntries(
          Object.entries(s.queryParams).map(([k, v]) => [
            k,
            k.toLowerCase().includes('token') || k.toLowerCase().includes('key') || k.toLowerCase().includes('api')
              ? '****'
              : v,
          ]),
        )
      : undefined,
  }));

  sendSuccess(req, res, {
    server: appConfig.server,
    rateLimit: appConfig.rateLimit,
    log: appConfig.log,
    apiSources: sanitizedSources,
    apiKeys: sanitizedKeys,
  });
});

router.post('/reload-config', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  try {
    configLoader.reload();
    RateLimitService.reset();
    LoggerService.reset();
    const runtimeKeys = configLoader.getRuntimeApiKeys();
    const runtimeSources = configLoader.getRuntimeApiSources();
    sendSuccess(req, res, {
      message: '配置已重新加载（运行时配置已保留）',
      retainedRuntimeKeys: runtimeKeys.length,
      retainedRuntimeSources: runtimeSources.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendBadRequest(req, res, `配置加载失败: ${message}`, 40013);
  }
});

router.post('/keys', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const body = req.body as Partial<ApiKeyConfig> | undefined;
  if (!body || !body.key || typeof body.key !== 'string') {
    sendBadRequest(req, res, 'key 字段必填', 40014);
    return;
  }
  if (!Array.isArray(body.allowedApis)) {
    sendBadRequest(req, res, 'allowedApis 必须是数组', 40015);
    return;
  }

  const keyConfig: ApiKeyConfig = {
    key: body.key,
    name: body.name ?? body.key.slice(0, 8),
    allowedApis: body.allowedApis,
    rateLimitPerMinute: body.rateLimitPerMinute,
    enabled: body.enabled ?? true,
  };

  configLoader.addRuntimeApiKey(keyConfig);
  sendSuccess(req, res, { key: keyConfig.key, name: keyConfig.name, runtime: true });
});

router.delete('/keys/:keyId', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const keyId = req.params['keyId'];
  const removed = configLoader.removeRuntimeApiKey(keyId);
  if (!removed) {
    sendNotFound(req, res, `运行时 API Key 不存在: ${keyId}`, 40404);
    return;
  }
  sendSuccess(req, res, { removed: keyId });
});

router.get('/keys/runtime', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const runtimeKeys = configLoader.getRuntimeApiKeys().map((k) => ({
    ...k,
    key: k.key.slice(0, 8) + '****' + k.key.slice(-4),
  }));
  sendSuccess(req, res, runtimeKeys);
});

router.post('/sources', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const body = req.body as Partial<ApiSource> | undefined;
  if (!body || !body.id || typeof body.id !== 'string') {
    sendBadRequest(req, res, 'id 字段必填', 40016);
    return;
  }
  if (!body.baseUrl || typeof body.baseUrl !== 'string') {
    sendBadRequest(req, res, 'baseUrl 字段必填', 40017);
    return;
  }

  const source: ApiSource = {
    id: body.id,
    name: body.name ?? body.id,
    baseUrl: body.baseUrl,
    timeoutMs: body.timeoutMs ?? 5000,
    retry: body.retry ?? { maxRetries: 2, delayMs: 300 },
    headers: body.headers,
    queryParams: body.queryParams,
    endpoint: body.endpoint,
    enabled: body.enabled ?? true,
  };

  configLoader.addRuntimeApiSource(source);
  sendSuccess(req, res, { id: source.id, name: source.name, runtime: true });
});

router.delete('/sources/:sourceId', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const sourceId = req.params['sourceId'];
  const removed = configLoader.removeRuntimeApiSource(sourceId);
  if (!removed) {
    sendNotFound(req, res, `运行时 API 源不存在: ${sourceId}`, 40405);
    return;
  }
  sendSuccess(req, res, { removed: sourceId });
});

router.get('/sources/runtime', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  sendSuccess(req, res, configLoader.getRuntimeApiSources());
});

router.get('/cache', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const defaultStore = cacheManager.getDefaultStore();
  const keys = defaultStore.keys();
  const entries = keys.map((k) => ({
    key: k,
    info: defaultStore.getEntryInfo(k),
  }));
  const storeNames = cacheManager.getStoreNames();
  const storesInfo: Record<string, unknown> = {};
  for (const name of storeNames) {
    const store = cacheManager.getStore(name);
    if (store) {
      storesInfo[name] = { size: store.size(), keys: store.keys() };
    }
  }

  sendSuccess(req, res, {
    defaultStore: { size: defaultStore.size(), entries },
    stores: storesInfo,
  });
});

router.delete('/cache', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const defaultStore = cacheManager.getDefaultStore();
  const size = defaultStore.size();
  cacheManager.clearAll();
  sendSuccess(req, res, { clearedEntries: size });
});

export default router;
