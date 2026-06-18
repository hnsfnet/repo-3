import type { IPlugin, PluginContext, ApiResponse } from '../types';
import { RateLimitService } from '../service/rateLimit';

export class RateLimitPlugin implements IPlugin {
  name = 'rate-limit';

  init(_options?: Record<string, unknown>): void {}

  async onRequest(ctx: PluginContext): Promise<PluginContext | null> {
    const rateLimitService = RateLimitService.getInstance();

    if (!rateLimitService.isEnabled()) {
      return ctx;
    }

    const globalResult = rateLimitService.checkGlobalQps();

    ctx.res.setHeader('X-Global-QPS-Limit', String(globalResult.limit));
    ctx.res.setHeader('X-Global-QPS-Current', String(globalResult.currentQps));

    if (!globalResult.allowed) {
      const response: ApiResponse<Record<string, unknown>> = {
        code: 50300,
        message: `服务繁忙，全局限流触发（当前QPS: ${globalResult.currentQps}, 阈值: ${globalResult.limit}）`,
        data: {
          currentQps: globalResult.currentQps,
          limit: globalResult.limit,
          retryAfter: 1,
        },
        requestId: ctx.requestId,
      };
      ctx.res.setHeader('Retry-After', '1');
      ctx.res.status(503).json(response);
      return null;
    }

    const keyConfig = ctx.keyConfig;
    const apiKey = ctx.apiKey;

    if (!keyConfig || !apiKey) {
      return ctx;
    }

    const keyResult = rateLimitService.checkAndConsume(apiKey, keyConfig.rateLimitPerMinute);

    ctx.res.setHeader('X-RateLimit-Limit', String(keyResult.limit));
    ctx.res.setHeader('X-RateLimit-Remaining', String(keyResult.remaining));
    ctx.res.setHeader('X-RateLimit-Reset', String(Math.ceil(keyResult.resetMs / 1000)));

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
        requestId: ctx.requestId,
      };
      ctx.res.setHeader('Retry-After', String(retrySeconds));
      ctx.res.status(429).json(response);
      return null;
    }

    return ctx;
  }

  async onResponse(ctx: PluginContext): Promise<PluginContext> {
    return ctx;
  }

  async onError(ctx: PluginContext, _error: unknown): Promise<PluginContext> {
    return ctx;
  }
}
