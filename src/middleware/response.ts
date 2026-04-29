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
