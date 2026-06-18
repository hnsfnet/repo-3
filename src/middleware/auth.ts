import type { Request, Response, NextFunction } from 'express';
import { ConfigLoader } from '../config/loader';
import { sendUnauthorized, sendForbidden } from '../utils/response';
import type { ApiKeyConfig } from '../types';

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const config = ConfigLoader.getInstance().getServerConfig();
  const headerName = config.apiKeyHeader;

  const apiKey = req.header(headerName);

  if (!apiKey || apiKey.trim().length === 0) {
    sendUnauthorized(req, res, '缺少 API Key', 40101);
    return;
  }

  const keyConfig = ConfigLoader.getInstance().getApiKeyByKey(apiKey);

  if (!keyConfig) {
    sendUnauthorized(req, res, '无效的 API Key', 40102);
    return;
  }

  if (!keyConfig.enabled) {
    sendForbidden(req, res, '该 API Key 已被禁用', 40301);
    return;
  }

  (req as Record<string, unknown>)['apiKey'] = apiKey;
  (req as Record<string, unknown>)['keyConfig'] = keyConfig;

  next();
}

export function getApiKeyFromRequest(req: Request): string | undefined {
  return (req as Record<string, unknown>)['apiKey'] as string | undefined;
}

export function getKeyConfigFromRequest(req: Request): ApiKeyConfig | undefined {
  return (req as Record<string, unknown>)['keyConfig'] as ApiKeyConfig | undefined;
}

export function hasApiPermission(keyConfig: ApiKeyConfig, apiId: string): boolean {
  if (keyConfig.allowedApis.includes('*')) {
    return true;
  }
  return keyConfig.allowedApis.includes(apiId);
}

export function checkApiAccessMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const keyConfig = getKeyConfigFromRequest(req);
  if (!keyConfig) {
    sendUnauthorized(req, res, '未认证的请求', 40103);
    return;
  }

  const requestedApis = extractRequestedApis(req);
  const denied: string[] = [];

  for (const apiId of requestedApis) {
    if (!hasApiPermission(keyConfig, apiId)) {
      denied.push(apiId);
    }
  }

  if (denied.length > 0) {
    sendForbidden(
      req,
      res,
      `无权限访问以下 API 源: ${denied.join(', ')}`,
      40302,
    );
    return;
  }

  next();
}

function extractRequestedApis(req: Request): string[] {
  const bodyApis = (req.body as Record<string, unknown> | undefined)?.['apis'];
  if (Array.isArray(bodyApis)) {
    return bodyApis.filter((s) => typeof s === 'string') as string[];
  }

  const paramApi = req.params['apiId'];
  if (typeof paramApi === 'string' && paramApi.length > 0) {
    return [paramApi];
  }

  const queryApi = req.query['api'];
  if (typeof queryApi === 'string' && queryApi.length > 0) {
    return [queryApi];
  }

  return [];
}
