import type { ApiResponse } from "../types";

/**
 * Success response helper
 */
export function successResponse<T>(
  data: T,
  message: string = "Success"
): ApiResponse<T> {
  return {
    success: true,
    message,
    data,
  };
}

/**
 * Error response helper
 */
export function errorResponse(error: string, message: string = "Error"): ApiResponse<null> {
  return {
    success: false,
    message,
    error,
  };
}

const SAFE_ERROR_PATTERNS = [
  /^Username /,
  /^Email /,
  /^Invalid email address$/,
  /^maxDevices /,
  /^Device limit /,
  /^User not found$/,
  /^Old password is incorrect$/,
  /^MAC address /,
  /^Could not detect /,
  /^User has reached /,
  /^Device not found$/,
  /^Router /,
  /^Hotspot user not found:/,
  /^Cannot (delete|disable|demote) the last active super admin$/,
  /^Active session not found$/,
  /^Email is required for first MikroTik admin login$/,
];

export function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return SAFE_ERROR_PATTERNS.some((pattern) => pattern.test(error.message))
    ? error.message
    : fallback;
}
