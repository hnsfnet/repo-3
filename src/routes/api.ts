import { Router, type Request, type Response } from 'express';
import { AggregatorService } from '../service/aggregator';
import { getKeyConfigFromRequest } from '../middleware/auth';
import { sendSuccess, sendBadRequest, sendNotFound } from '../utils/response';
import { ConfigLoader } from '../config/loader';
import { CacheService } from '../service/cache';
import type { AggregateRequest } from '../types';

const router = Router();
const aggregator = new AggregatorService();

router.get('/sources', (req: Request, res: Response) => {
  const keyConfig = getKeyConfigFromRequest(req);
  if (!keyConfig) {
    sendBadRequest(req, res, '未找到认证信息', 40001);
    return;
  }
  const sources = aggregator.listAvailableSources(keyConfig);
  sendSuccess(req, res, sources);
});

router.post('/aggregate', async (req: Request, res: Response): Promise<void> => {
  const keyConfig = getKeyConfigFromRequest(req);
  if (!keyConfig) {
    sendBadRequest(req, res, '未找到认证信息', 40001);
    return;
  }

  const body = req.body as AggregateRequest | undefined;

  if (!body || !Array.isArray(body.apis) || body.apis.length === 0) {
    sendBadRequest(req, res, 'apis 参数不能为空且必须是数组', 40002);
    return;
  }

  const validApis = body.apis.filter(
    (apiId) => typeof apiId === 'string' && apiId.trim().length > 0,
  );
  if (validApis.length === 0) {
    sendBadRequest(req, res, 'apis 参数中没有有效的 API ID', 40003);
    return;
  }

  const invalidApis = validApis.filter(
    (apiId) => ConfigLoader.getInstance().getApiSourceById(apiId) === undefined,
  );
  if (invalidApis.length > 0) {
    sendBadRequest(req, res, `以下 API ID 不存在: ${invalidApis.join(', ')}`, 40004);
    return;
  }

  const result = await aggregator.aggregate({
    apiIds: validApis,
    params: body.params,
    keyConfig,
  });

  const cacheHitCount = result.results.filter((r) => r.fromCache).length;
  if (cacheHitCount > 0) {
    (req as Record<string, unknown>)['cacheHitCount'] = cacheHitCount;
  }

  sendSuccess(req, res, result);
});

router.get('/sources/:apiId', async (req: Request, res: Response): Promise<void> => {
  const keyConfig = getKeyConfigFromRequest(req);
  if (!keyConfig) {
    sendBadRequest(req, res, '未找到认证信息', 40001);
    return;
  }

  const apiId = req.params['apiId'];
  const params = extractQueryParams(req);

  const source = ConfigLoader.getInstance().getApiSourceById(apiId);
  if (!source) {
    sendNotFound(req, res, `API 源不存在: ${apiId}`, 40402);
    return;
  }

  if (!source.enabled) {
    sendBadRequest(req, res, `API 源已禁用: ${apiId}`, 40005);
    return;
  }

  const result = await aggregator.callSingle(apiId, params, keyConfig);

  if (result === null) {
    sendNotFound(req, res, `无法访问 API 源: ${apiId}`, 40403);
    return;
  }

  if (result.fromCache) {
    (req as Record<string, unknown>)['cacheHitCount'] = 1;
  }

  sendSuccess(req, res, result);
});

router.get('/cache', (req: Request, res: Response) => {
  const cache = CacheService.getInstance();
  sendSuccess(req, res, {
    size: cache.size(),
    keys: cache.keys(),
  });
});

router.delete('/cache', (req: Request, res: Response) => {
  const cache = CacheService.getInstance();
  const size = cache.size();
  cache.clear();
  sendSuccess(req, res, { cleared: size });
});

function extractQueryParams(req: Request): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(req.query)) {
    if (key === 'api') continue;
    result[key as string] = req.query[key as string] as unknown;
  }
  return result;
}

export default router;
