import { ApiError } from './api-error.js';

interface SupabaseErrorLike {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export function throwDatabaseError(
  error: SupabaseErrorLike,
  message = 'Database request failed',
): never {
  throw new ApiError(500, 'DATABASE_ERROR', message, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
}
