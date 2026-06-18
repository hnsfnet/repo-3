import type { IPlugin, PluginContext, ApiKeyConfig } from '../types';
import { ConfigLoader } from '../config/loader';
import { sendUnauthorized, sendForbidden } from '../utils/response';

function hasApiPermission(keyConfig: ApiKeyConfig, apiId: string): boolean {
  if (keyConfig.allowedApis.includes('*')) {
    return true;
  }
  return keyConfig.allowedApis.includes(apiId);
}

function extractRequestedApis(ctx: PluginContext): string[] {
  const bodyApis = (ctx.req.body as Record<string, unknown> | undefined)?.['apis'];
  if (Array.isArray(bodyApis)) {
    return bodyApis.filter((s) => typeof s === 'string') as string[];
  }

  const paramApi = ctx.req.params['apiId'];
  if (typeof paramApi === 'string' && paramApi.length > 0) {
    return [paramApi];
  }

  const queryApi = ctx.req.query['api'];
  if (typeof queryApi === 'string' && queryApi.length > 0) {
    return [queryApi];
  }

  return [];
}

export class AuthPlugin implements IPlugin {
  name = 'auth';

  init(_options?: Record<string, unknown>): void {}

  async onRequest(ctx: PluginContext): Promise<PluginContext | null> {
    const config = ConfigLoader.getInstance().getServerConfig();
    const headerName = config.apiKeyHeader;

    const apiKey = ctx.req.header(headerName);

    if (!apiKey || apiKey.trim().length === 0) {
      sendUnauthorized(ctx.req, ctx.res, '缺少 API Key', 40101);
      return null;
    }

    const keyConfig = ConfigLoader.getInstance().getApiKeyByKey(apiKey);

    if (!keyConfig) {
      sendUnauthorized(ctx.req, ctx.res, '无效的 API Key', 40102);
      return null;
    }

    if (!keyConfig.enabled) {
      sendForbidden(ctx.req, ctx.res, '该 API Key 已被禁用', 40301);
      return null;
    }

    ctx.apiKey = apiKey;
    ctx.keyConfig = keyConfig;

    const requestedApis = extractRequestedApis(ctx);
    const denied: string[] = [];

    for (const apiId of requestedApis) {
      if (!hasApiPermission(keyConfig, apiId)) {
        denied.push(apiId);
      }
    }

    if (denied.length > 0) {
      sendForbidden(
        ctx.req,
        ctx.res,
        `无权限访问以下 API 源: ${denied.join(', ')}`,
        40302,
      );
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
