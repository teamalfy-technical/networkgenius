import jwt from "jsonwebtoken";
import type { Context } from "elysia";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";

export interface JWTPayload {
  userId: string;
  username: string;
  iat: number;
  exp: number;
}

/**
 * Create JWT token for user
 */
export function createToken(userId: string, username: string): string {
  return jwt.sign(
    { userId, username },
    JWT_SECRET,
    { expiresIn: "24h" }
  );
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }

  return parts[1] ?? null;
}

/**
 * Auth middleware to verify JWT token
 */
export function authMiddleware() {
  return async (context: Context) => {
    const token = extractToken(context.request.headers.get("Authorization") || "");

    if (!token) {
      return context.set.status = 401;
    }

    const payload = verifyToken(token);
    if (!payload) {
      return context.set.status = 401;
    }

    // Add payload to context for use in route handlers
    (context.store as any).user = payload;
  };
}

/**
 * Get current user from context
 */
export function getCurrentUser(context: { store: unknown }): JWTPayload | null {
  return (context.store as any).user || null;
}

/**
 * Get client IP address
 */
export function getClientIp(context: {
  request: Request;
  clientIp?: string;
  server?: { requestIP?: (request: Request) => { address: string } | null };
}): string {
  if (context.clientIp) {
    return context.clientIp;
  }

  const forwarded = context.request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "127.0.0.1";
  }

  const realIp = context.request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return context.server?.requestIP?.(context.request)?.address || "127.0.0.1";
}
