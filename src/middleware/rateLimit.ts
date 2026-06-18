import type { Request, Response, NextFunction } from 'express';
import { RateLimitService } from '../service/rateLimit';
import { getKeyConfigFromRequest } from './auth';
import type { ApiResponse } from '../types';

export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const rateLimitService = RateLimitService.getInstance();

  if (!rateLimitService.isEnabled()) {
    next();
    return;
  }

  const globalResult = rateLimitService.checkGlobalQps();

  res.setHeader('X-Global-QPS-Limit', String(globalResult.limit));
  res.setHeader('X-Global-QPS-Current', String(globalResult.currentQps));

  if (!globalResult.allowed) {
    const response: ApiResponse<Record<string, unknown>> = {
      code: 50300,
      message: `服务繁忙，全局限流触发（当前QPS: ${globalResult.currentQps}, 阈值: ${globalResult.limit}）`,
      data: {
        currentQps: globalResult.currentQps,
        limit: globalResult.limit,
        retryAfter: 1,
      },
      requestId: (req as Record<string, unknown>)['requestId'] as string | undefined,
    };
    res.setHeader('Retry-After', '1');
    res.status(503).json(response);
    return;
  }

  const keyConfig = getKeyConfigFromRequest(req);
  const apiKey = (req as Record<string, unknown>)['apiKey'] as string | undefined;

  if (!keyConfig || !apiKey) {
    next();
    return;
  }

  const keyResult = rateLimitService.checkAndConsume(apiKey, keyConfig.rateLimitPerMinute);

  res.setHeader('X-RateLimit-Limit', String(keyResult.limit));
  res.setHeader('X-RateLimit-Remaining', String(keyResult.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(keyResult.resetMs / 1000)));

  if (!keyResult.allowed) {
    const retrySeconds = Math.ceil((keyResult.retryAfterMs ?? keyResult.resetMs) / 1000);
    const response: ApiResponse<Record<string, unknown>> = {
      code: 42900,
      message: `请求过于频繁，请 ${retrySeconds} 秒后重试`,
      data: {
        limit: keyResult.limit,
        remaining: keyResult.remaining,
        resetMs: keyResult.resetMs,
        retryAfterSeconds: retrySeconds,
      },
      requestId: (req as Record<string, unknown>)['requestId'] as string | undefined,
    };
    res.setHeader('Retry-After', String(retrySeconds));
    res.status(429).json(response);
    return;
  }

  next();
}
