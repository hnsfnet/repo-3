import type { Response, Request } from 'express';
import type { ApiResponse } from '../types';

export function buildResponse<T>(
  code: number,
  message: string,
  data: T | null = null,
): ApiResponse<T> {
  return {
    code,
    message,
    data,
  };
}

export function sendResponse<T>(
  req: Request,
  res: Response,
  httpStatus: number,
  code: number,
  message: string,
  data: T | null = null,
): void {
  const response: ApiResponse<T> = {
    code,
    message,
    data,
    requestId: (req as Record<string, unknown>)['requestId'] as string | undefined,
  };
  res.status(httpStatus).json(response);
}

export function sendSuccess<T>(
  req: Request,
  res: Response,
  data: T | null = null,
  message: string = 'success',
): void {
  sendResponse(req, res, 200, 0, message, data);
}

export function sendBadRequest(
  req: Request,
  res: Response,
  message: string = 'Bad Request',
  code: number = 40000,
): void {
  sendResponse(req, res, 400, code, message);
}

export function sendUnauthorized(
  req: Request,
  res: Response,
  message: string = 'Unauthorized',
  code: number = 40100,
): void {
  sendResponse(req, res, 401, code, message);
}

export function sendForbidden(
  req: Request,
  res: Response,
  message: string = 'Forbidden',
  code: number = 40300,
): void {
  sendResponse(req, res, 403, code, message);
}

export function sendNotFound(
  req: Request,
  res: Response,
  message: string = 'Not Found',
  code: number = 40400,
): void {
  sendResponse(req, res, 404, code, message);
}

export function sendInternalError(
  req: Request,
  res: Response,
  message: string = 'Internal Server Error',
  code: number = 50000,
): void {
  sendResponse(req, res, 500, code, message);
}
