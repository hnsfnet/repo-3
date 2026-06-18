import { Router, type Request, type Response } from 'express';
import { sendSuccess } from '../utils/response';
import { CacheService } from '../service/cache';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  sendSuccess(_req, res, {
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cacheSize: CacheService.getInstance().size(),
  });
});

router.get('/health/live', (_req: Request, res: Response) => {
  sendSuccess(_req, res, { status: 'alive' });
});

router.get('/health/ready', (_req: Request, res: Response) => {
  sendSuccess(_req, res, { status: 'ready' });
});

export default router;
