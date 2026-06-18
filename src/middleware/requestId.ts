import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ConfigLoader } from '../config/loader';

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const config = ConfigLoader.getInstance().getServerConfig();
  const headerName = config.requestIdHeader;

  const existingId = req.header(headerName);
  const requestId = existingId && existingId.trim().length > 0 ? existingId : uuidv4();

  (req as Record<string, unknown>)['requestId'] = requestId;
  res.setHeader(headerName, requestId);

  next();
}
