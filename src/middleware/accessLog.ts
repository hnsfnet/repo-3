import type { Request, Response, NextFunction } from 'express';
import { getKeyConfigFromRequest } from './auth';
import type { AccessLogEntry } from '../types';
import { LoggerService } from '../service/logger';
import { StatsService } from '../service/stats';

function getClientIp(req: Request): string {
  const forwarded = req.header('X-Forwarded-For');
  if (forwarded && forwarded.trim().length > 0) {
    const first = forwarded.split(',')[0];
    if (first) return first.trim();
  }
  const realIp = req.header('X-Real-IP');
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  return (req.socket.remoteAddress as string | undefined) ?? '';
}

export function accessLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startTime = Date.now();
  (req as Record<string, unknown>)['startTime'] = startTime;

  const logger = LoggerService.getInstance();
  const stats = StatsService.getInstance();
  const keyConfig = getKeyConfigFromRequest(req);
  const apiKey = (req as Record<string, unknown>)['apiKey'] as string | undefined;

  res.on('finish', () => {
    const endTime = Date.now();
    const durationMs = endTime - startTime;

    const cacheHitCount =
      ((req as Record<string, unknown>)['cacheHitCount'] as number | undefined) ?? 0;
    const cacheHit = cacheHitCount > 0;

    const entry: AccessLogEntry = {
      timestamp: startTime,
      date: new Date(startTime).toISOString().slice(0, 10),
      requestId: ((req as Record<string, unknown>)['requestId'] as string | undefined) ?? '',
      apiKey: apiKey ?? '',
      keyName: keyConfig?.name ?? (apiKey ? 'Unknown' : 'Anonymous'),
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      cacheHit,
      cacheHitCount,
      userAgent: req.header('User-Agent') ?? undefined,
      clientIp: getClientIp(req) || undefined,
    };

    if (logger.isEnabled()) {
      logger.logAccess(entry);
    }

    stats.record(entry);
  });

  next();
}
