import jwt from "jsonwebtoken";
import type { Context } from "elysia";
import { UserQueries } from "../database/queries";
import type { UserRole } from "../types";

const JWT_SECRET = requireSecret("JWT_SECRET", 32);
const JWT_ISSUER = "mikrotik-api";
const JWT_AUDIENCE = "mikrotik-api-users";

export interface JWTPayload {
  userId: string;
  username: string;
  role: UserRole;
  iat: number;
  exp: number;
}

/**
 * Create JWT token for user
 */
export function createToken(
  userId: string,
  username: string,
  role: UserRole
): string {
  return jwt.sign(
    { userId, username, role },
    JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "24h",
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  );
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as JWTPayload;
  } catch (error) {
    return null;
  }
}

export async function authenticateToken(token: string): Promise<JWTPayload | null> {
  const payload = verifyToken(token);
  if (!payload) return null;

  const user = await UserQueries.getById(payload.userId);
  if (!user || !user.isActive || user.username !== payload.username) {
    return null;
  }

  return {
    ...payload,
    role: user.role,
  };
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") {
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

    const payload = await authenticateToken(token);
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

export function isSuperAdmin(context: { store: unknown }): boolean {
  return getCurrentUser(context)?.role === "super_admin";
}

/**
 * Get client IP address
 */
export function getClientIp(context: {
  request: Request;
  clientIp?: string;
  server?: {
    requestIP?: (request: Request) => { address: string } | null;
  } | null;
}): string {
  if (context.clientIp) {
    return context.clientIp;
  }

  if (process.env.TRUST_PROXY === "true") {
    const forwarded = context.request.headers.get("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0]?.trim() || "127.0.0.1";
    }

    const realIp = context.request.headers.get("x-real-ip");
    if (realIp) {
      return realIp;
    }
  }

  return context.server?.requestIP?.(context.request)?.address || "127.0.0.1";
}

function requireSecret(name: string, minimumLength: number): string {
  const value = process.env[name];
  if (!value || value.length < minimumLength) {
    throw new Error(
      `${name} must be configured with at least ${minimumLength} characters`
    );
  }

  return value;
}
