import type { AppError } from "../domain/errors.ts";

/**
 * AppError code → HTTP status. Per AGENTS:
 *
 *   NOT_FOUND      → 404
 *   PATH_TRAVERSAL → 400
 *   READ_FAILED    → 500
 *   CONFIG_INVALID → 500
 *   NOT_READY      → 503
 *   default        → 500
 */
const CODE_TO_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  PATH_TRAVERSAL: 400,
  READ_FAILED: 500,
  CONFIG_INVALID: 500,
  NOT_READY: 503,
};

export function statusFor(err: AppError): number {
  return CODE_TO_STATUS[err.code] ?? 500;
}

export function errorEnvelope(err: AppError): { error: { code: string; message: string } } {
  return {
    error: {
      code: err.code,
      message: err.message,
    },
  };
}
