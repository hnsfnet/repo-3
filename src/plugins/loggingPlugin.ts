import type { IPlugin, PluginContext, AccessLogEntry } from '../types';
import { LoggerService } from '../service/logger';
import { StatsService } from '../service/stats';

function getClientIp(ctx: PluginContext): string {
  const forwarded = ctx.req.header('X-Forwarded-For');
  if (forwarded && forwarded.trim().length > 0) {
    const first = forwarded.split(',')[0];
    if (first) return first.trim();
  }
  const realIp = ctx.req.header('X-Real-IP');
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  return (ctx.req.socket.remoteAddress as string | undefined) ?? '';
}

export class LoggingPlugin implements IPlugin {
  name = 'logging';

  init(_options?: Record<string, unknown>): void {}

  async onRequest(ctx: PluginContext): Promise<PluginContext> {
    const startTime = Date.now();
    ctx.startTime = startTime;

    const logger = LoggerService.getInstance();
    const stats = StatsService.getInstance();
    const keyConfig = ctx.keyConfig;
    const apiKey = ctx.apiKey;

    ctx.res.on('finish', () => {
      const endTime = Date.now();
      const durationMs = endTime - startTime;

      const cacheHitCount = (ctx.cacheHitCount as number) ?? 0;
      const cacheHit = cacheHitCount > 0;

      const entry: AccessLogEntry = {
        timestamp: startTime,
        date: new Date(startTime).toISOString().slice(0, 10),
        requestId: ctx.requestId,
        apiKey: apiKey ?? '',
        keyName: keyConfig?.name ?? (apiKey ? 'Unknown' : 'Anonymous'),
        method: ctx.req.method,
        path: ctx.req.path,
        statusCode: ctx.res.statusCode,
        durationMs,
        cacheHit,
        cacheHitCount,
        userAgent: ctx.req.header('User-Agent') ?? undefined,
        clientIp: getClientIp(ctx) || undefined,
      };

      if (logger.isEnabled()) {
        logger.logAccess(entry);
      }

      stats.record(entry);
    });

    return ctx;
  }

  async onResponse(ctx: PluginContext): Promise<PluginContext> {
    return ctx;
  }

  async onError(ctx: PluginContext, _error: unknown): Promise<PluginContext> {
    return ctx;
  }
}
