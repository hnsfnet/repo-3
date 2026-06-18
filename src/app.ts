import express from 'express';
import { ConfigLoader } from './config/loader';
import { requestIdMiddleware } from './middleware/requestId';
import { authMiddleware, checkApiAccessMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { accessLogMiddleware } from './middleware/accessLog';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import healthRoutes from './routes/health';
import apiRoutes from './routes/api';
import adminRoutes from './routes/admin';

function createApp(): express.Express {
  const configLoader = ConfigLoader.getInstance();
  const serverConfig = configLoader.getServerConfig();

  const app = express();

  app.set('trust proxy', true);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(requestIdMiddleware);

  app.use('/healthz', (_req, res, next) => next());
  app.use(healthRoutes);

  app.use('/api', authMiddleware);
  app.use('/api', rateLimitMiddleware);
  app.use('/api', accessLogMiddleware);
  app.use('/api/admin', adminRoutes);
  app.use('/api', checkApiAccessMiddleware);
  app.use('/api', apiRoutes);

  app.use(notFoundHandler);

  app.use(errorHandler);

  const server = app.listen(serverConfig.port, serverConfig.host, () => {
    const rlConfig = configLoader.getRateLimitConfig();
    const logConfig = configLoader.getLogConfig();
    console.log(`[聚桥] 服务已启动: http://${serverConfig.host}:${serverConfig.port}`);
    console.log(`[聚桥] 已加载 ${configLoader.getApiSources().length} 个 API 源`);
    console.log(`[聚桥] 已配置 ${configLoader.getApiKeys().length} 个 API Key`);
    console.log(
      `[聚桥] 限流: ${rlConfig.enabled ? '启用' : '禁用'} | 全局QPS: ${rlConfig.globalQpsLimit} | 默认每Key每分钟: ${rlConfig.defaultPerKeyPerMinute}`,
    );
    console.log(
      `[聚桥] 日志: ${logConfig.enabled ? '启用' : '禁用'} | 控制台: ${logConfig.consoleEnabled ? '开' : '关'} | 文件: ${logConfig.fileEnabled ? '开' : '关'} | 目录: ${logConfig.logDir}`,
    );
  });

  function shutdown(signal: string): void {
    console.log(`[聚桥] 收到 ${signal} 信号，开始关闭...`);
    server.close(() => {
      console.log('[聚桥] 服务已关闭');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[聚桥] 强制关闭超时');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return app;
}

try {
  createApp();
} catch (error) {
  console.error('[聚桥] 服务启动失败:', error);
  process.exit(1);
}
