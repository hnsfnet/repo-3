import type { Request, Response, NextFunction } from 'express';
import { sendInternalError, sendNotFound } from '../utils/response';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let message = 'Internal Server Error';

  if (err instanceof Error) {
    message = err.message;
  } else if (typeof err === 'string') {
    message = err;
  }

  console.error(`[Error] ${(req as Record<string, unknown>)['requestId'] as string | ''} ${message}`, err);

  sendInternalError(req, res, message);
}

export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  sendNotFound(req, res, `接口不存在: ${req.method} ${req.path}`, 40401);
}

process.on('uncaughtException', (err: Error) => {
  console.error('[UncaughtException]', err);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('[UnhandledRejection]', reason, promise);
});
