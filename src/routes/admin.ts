import { Router, type Request, type Response } from 'express';
import { StatsService } from '../service/stats';
import { RateLimitService } from '../service/rateLimit';
import { LoggerService } from '../service/logger';
import { CacheService } from '../service/cache';
import { ConfigLoader } from '../config/loader';
import { getKeyConfigFromRequest } from '../middleware/auth';
import { sendSuccess, sendForbidden, sendBadRequest } from '../utils/response';

const router = Router();
const stats = StatsService.getInstance();
const rateLimit = RateLimitService.getInstance();
const logger = LoggerService.getInstance();
const cache = CacheService.getInstance();
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
    sendSuccess(req, res, { message: '配置已重新加载' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendBadRequest(req, res, `配置加载失败: ${message}`, 40013);
  }
});

router.get('/cache', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const keys = cache.keys();
  const entries = keys.map((k) => ({
    key: k,
    info: cache.getEntryInfo(k),
  }));

  sendSuccess(req, res, {
    size: cache.size(),
    entries,
  });
});

router.delete('/cache', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const size = cache.size();
  cache.clear();
  sendSuccess(req, res, { clearedEntries: size });
});

export default router;
