export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, 'BAD_REQUEST', message, details);
}

export function conflict(message = 'Resource already exists'): ApiError {
  return new ApiError(409, 'CONFLICT', message);
}

export function unauthorized(message = 'Authentication required'): ApiError {
  return new ApiError(401, 'UNAUTHORIZED', message);
}

export function forbidden(message = 'Forbidden'): ApiError {
  return new ApiError(403, 'FORBIDDEN', message);
}

export function notFound(message = 'Resource not found'): ApiError {
  return new ApiError(404, 'NOT_FOUND', message);
}

export function serviceUnavailable(message = 'Backend storage is not configured'): ApiError {
  return new ApiError(503, 'SUPABASE_NOT_CONFIGURED', message);
}
