import { Elysia } from "elysia";
import { initializeDatabase } from "./src/database/init";
import { initializeMikroTikClient, MikroTikError } from "./src/mikrotik/client";
import {
  getClientIp,
  extractToken,
  authenticateToken,
  isSuperAdmin,
} from "./src/middleware/auth";
import {
  consumeRateLimit,
  pruneRateLimits,
  SECURITY_HEADERS,
} from "./src/middleware/security";
import { successResponse, errorResponse } from "./src/middleware/response";
import { userRoutes } from "./src/api/userRoutes";
import { deviceRoutes } from "./src/api/deviceRoutes";
import { adminRoutes } from "./src/api/adminRoutes";
import { DeviceService } from "./src/services/deviceService";

// Get config from environment
const MIKROTIK_HOST = process.env.MIKROTIK_HOST || "192.168.88.1";
const MIKROTIK_USER = process.env.MIKROTIK_USER || "admin";
const MIKROTIK_PASSWORD = process.env.MIKROTIK_PASSWORD || "password";
const MIKROTIK_PORT = parseInt(process.env.MIKROTIK_PORT || "8728");
const MIKROTIK_TLS = process.env.MIKROTIK_TLS === "true";
const PORT = parseInt(process.env.PORT || "3000");

validateRuntimeConfig();

async function setAuthenticatedUser(
  store: unknown,
  authorization: string | undefined
): Promise<boolean> {
  const token = extractToken(authorization);
  if (!token) return false;

  const payload = await authenticateToken(token);
  if (!payload) return false;

  (store as any).user = payload;
  return true;
}

function reject(set: any, status: number, message: string) {
  set.status = status;
  return errorResponse(message);
}

function createJsonRequest(method: string, body: unknown): Request {
  const request = new Request("http://localhost", {
    method,
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "json", {
    value: async () => body,
  });
  return request;
}

// Initialize services
console.log("🚀 Initializing MikroTik APIs...");

// Initialize database
console.log("📦 Initializing database...");
await initializeDatabase();

// Initialize MikroTik client
console.log("📡 Initializing MikroTik client...");
try {
  const mikrotikClient = initializeMikroTikClient({
    host: MIKROTIK_HOST,
    user: MIKROTIK_USER,
    password: MIKROTIK_PASSWORD,
    port: MIKROTIK_PORT,
    tls: MIKROTIK_TLS,
  });
  mikrotikClient
    .connect()
    .then(async () => {
      console.log("✅ Connected to MikroTik router");
      await DeviceService.syncAllActiveSessions().catch(logSyncError);
      const syncTimer = setInterval(() => {
        DeviceService.syncAllActiveSessions().catch(logSyncError);
      }, Number(process.env.MIKROTIK_SYNC_INTERVAL_MS || 30_000));
      syncTimer.unref?.();
    })
    .catch((err) => logMikroTikStartupError(err));
} catch (error) {
  logMikroTikStartupError(error);
}

// Create Elysia app
const app = new Elysia({
  serve: {
    maxRequestBodySize: 16 * 1024,
  },
});

app.onRequest(({ set }) => {
  Object.assign(set.headers, SECURITY_HEADERS);
});

const cleanupTimer = setInterval(pruneRateLimits, 60_000);
cleanupTimer.unref?.();

function getRequestIp(request: Request): string {
  return getClientIp({ request, server: app.server as any });
}

// Health check
app.get("/health", () =>
  successResponse({ status: "ok" }, "Server is running")
);

// ============ PUBLIC ROUTES ============
app.post("/api/auth/register", async ({
  body,
  store,
  request,
  headers,
  set,
}) => {
  const authenticated = await setAuthenticatedUser(store, headers.authorization);
  if (!(authenticated && isSuperAdmin({ store }))) {
    return reject(set, 403, "Super-admin credentials required");
  }

  const ip = getRequestIp(request);
  const rateLimit = consumeRateLimit(`register:${ip}`, 20, 60 * 60 * 1000);
  if (!rateLimit.allowed) {
    set.headers["retry-after"] = String(rateLimit.retryAfterSeconds);
    return reject(set, 429, "Too many account creation requests");
  }

  return userRoutes.register({
    params: {},
    clientIp: ip,
    request: createJsonRequest("POST", body),
    set,
    store,
  } as any);
});

app.post("/api/auth/mikrotik-login", ({ body, store, request, set }) => {
  const ip = getRequestIp(request);
  const rateLimit = consumeRateLimit(
    `mikrotik-login:${ip}`,
    5,
    15 * 60 * 1000
  );
  if (!rateLimit.allowed) {
    set.headers["retry-after"] = String(rateLimit.retryAfterSeconds);
    return reject(set, 429, "Too many MikroTik login attempts");
  }

  return userRoutes.mikrotikLogin({
    params: {},
    clientIp: ip,
    request: createJsonRequest("POST", body),
    set,
    store,
  } as any);
});
app.post("/api/auth/login", ({ body, store, request, set }) => {
  const ip = getRequestIp(request);
  const username =
    typeof (body as any)?.username === "string"
      ? (body as any).username.trim().toLowerCase()
      : "unknown";
  const rateLimit = consumeRateLimit(
    `login:${ip}:${username}`,
    10,
    15 * 60 * 1000
  );
  const ipRateLimit = consumeRateLimit(`login-ip:${ip}`, 50, 15 * 60 * 1000);
  if (!rateLimit.allowed || !ipRateLimit.allowed) {
    set.headers["retry-after"] = String(
      Math.max(rateLimit.retryAfterSeconds, ipRateLimit.retryAfterSeconds)
    );
    return reject(set, 429, "Too many login attempts");
  }

  return userRoutes.login({
    params: {},
    clientIp: ip,
    request: createJsonRequest("POST", body),
    set,
    store,
  } as any);
});

// ============ PROTECTED ROUTES - USER ENDPOINTS ============

// User profile
app.get("/api/users/me", async ({ headers, store, set }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  return userRoutes.getProfile({
    params: {},
    request: new Request("http://localhost"),
    set,
    store,
  } as any);
});

// Get all users (admin)
app.get("/api/users", async ({ headers, store, set }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  if (!isSuperAdmin({ store })) {
    return reject(set, 403, "Super-admin credentials required");
  }
  return userRoutes.getAllUsers({
    params: {},
    request: new Request("http://localhost"),
    set,
    store,
  } as any);
});

// Get user by ID (admin)
app.get("/api/users/:userId", async ({ headers, params, store, set }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  if (!isSuperAdmin({ store })) {
    return reject(set, 403, "Super-admin credentials required");
  }
  return userRoutes.getUser({
    params,
    request: new Request("http://localhost"),
    set,
    store,
  } as any);
});

// Update user profile
app.put("/api/users/me", async ({ headers, store, body, set, request }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }

  const mockRequest = createJsonRequest("PUT", body);

  return userRoutes.updateProfile({
    params: {},
    clientIp: getRequestIp(request),
    request: mockRequest,
    set,
    store,
  } as any);
});

// Change password
app.post("/api/users/change-password", async ({ headers, store, body, set, request }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }

  const mockRequest = createJsonRequest("POST", body);

  return userRoutes.changePassword({
    params: {},
    clientIp: getRequestIp(request),
    request: mockRequest,
    set,
    store,
  } as any);
});

// Delete user (admin)
app.delete("/api/users/:userId", async ({ headers, params, store, set, request }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  if (!isSuperAdmin({ store })) {
    return reject(set, 403, "Super-admin credentials required");
  }
  return userRoutes.deleteUser({
    params,
    clientIp: getRequestIp(request),
    request,
    set,
    store,
  } as any);
});

// Toggle user status (admin)
app.put("/api/users/:userId/status", async ({ headers, params, store, body, set, request }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  if (!isSuperAdmin({ store })) {
    return reject(set, 403, "Super-admin credentials required");
  }

  const mockRequest = createJsonRequest("PUT", body);

  return userRoutes.toggleUserStatus({
    params,
    clientIp: getRequestIp(request),
    request: mockRequest,
    set,
    store,
  } as any);
});

// Change device limit (admin)
app.put("/api/users/:userId/device-limit", async ({
  headers,
  params,
  store,
  body,
  set,
  request,
}) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  if (!isSuperAdmin({ store })) {
    return reject(set, 403, "Super-admin credentials required");
  }

  return userRoutes.updateDeviceLimit({
    params,
    clientIp: getRequestIp(request),
    request: createJsonRequest("PUT", body),
    set,
    store,
  } as any);
});

app.put("/api/users/:userId/role", async ({
  headers,
  params,
  store,
  body,
  set,
  request,
}) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  if (!isSuperAdmin({ store })) {
    return reject(set, 403, "Super-admin credentials required");
  }

  return userRoutes.updateRole({
    params,
    clientIp: getRequestIp(request),
    request: createJsonRequest("PUT", body),
    set,
    store,
  } as any);
});

// ============ SUPER-ADMIN DEVICE AND SESSION ENDPOINTS ============

app.get("/api/admin/devices", async ({ headers, store, set, query }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  if (!isSuperAdmin({ store })) {
    return reject(set, 403, "Super-admin credentials required");
  }

  return adminRoutes.getDevices({
    params: {},
    query,
    request: new Request("http://localhost"),
    set,
    store,
  } as any);
});

app.get("/api/admin/sessions", async ({ headers, store, set }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  if (!isSuperAdmin({ store })) {
    return reject(set, 403, "Super-admin credentials required");
  }

  return adminRoutes.getSessions({
    params: {},
    request: new Request("http://localhost"),
    set,
    store,
  } as any);
});

app.post("/api/admin/sessions/:sessionId/disconnect", async ({
  headers,
  params,
  store,
  set,
  request,
}) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  if (!isSuperAdmin({ store })) {
    return reject(set, 403, "Super-admin credentials required");
  }

  return adminRoutes.disconnectSession({
    params,
    clientIp: getRequestIp(request),
    request,
    set,
    store,
  } as any);
});

app.post("/api/admin/devices/:deviceId/disconnect", async ({
  headers,
  params,
  store,
  set,
  request,
}) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  if (!isSuperAdmin({ store })) {
    return reject(set, 403, "Super-admin credentials required");
  }

  return adminRoutes.disconnectDevice({
    params,
    clientIp: getRequestIp(request),
    request,
    set,
    store,
  } as any);
});

app.delete("/api/admin/devices/:deviceId", async ({
  headers,
  params,
  store,
  set,
  request,
}) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  if (!isSuperAdmin({ store })) {
    return reject(set, 403, "Super-admin credentials required");
  }

  return adminRoutes.deleteDevice({
    params,
    clientIp: getRequestIp(request),
    request,
    set,
    store,
  } as any);
});

// ============ PROTECTED ROUTES - DEVICE ENDPOINTS ============

// Get user devices
app.get("/api/devices", async ({ headers, store, set }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  return deviceRoutes.getUserDevices({
    params: {},
    request: new Request("http://localhost"),
    set,
    store,
  } as any);
});

// Get connected devices
app.get("/api/devices/connected", async ({ headers, store, set }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  return deviceRoutes.getConnectedDevices({
    params: {},
    request: new Request("http://localhost"),
    set,
    store,
  } as any);
});

// Get live HotSpot session usage
app.get("/api/devices/sessions", async ({ headers, store, set }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  return deviceRoutes.getSessionStatus({
    params: {},
    request: new Request("http://localhost"),
    set,
    store,
  } as any);
});

// Get device by ID
app.get("/api/devices/:deviceId", async ({ headers, params, store, set }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  return deviceRoutes.getDevice({
    params,
    request: new Request("http://localhost"),
    set,
    store,
  } as any);
});

// Update device
app.put("/api/devices/:deviceId", async ({ headers, params, store, body, set, request }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }

  const mockRequest = createJsonRequest("PUT", body);

  return deviceRoutes.updateDevice({
    params,
    clientIp: getRequestIp(request),
    request: mockRequest,
    set,
    store,
  } as any);
});

// Delete device
app.delete("/api/devices/:deviceId", async ({ headers, params, store, set, request }) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  return deviceRoutes.deleteDevice({
    params,
    clientIp: getRequestIp(request),
    request,
    set,
    store,
  } as any);
});

// Disconnect device
app.post("/api/devices/:deviceId/disconnect", async ({
  headers,
  params,
  store,
  set,
  request,
}) => {
  if (!(await setAuthenticatedUser(store, headers.authorization))) {
    return reject(set, 401, "Unauthorized");
  }
  return deviceRoutes.disconnectDevice({
    params,
    clientIp: getRequestIp(request),
    request,
    set,
    store,
  } as any);
});

// 404 handler
app.all("*", ({ set }) => {
  return reject(set, 404, "Not found");
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log("📚 API Documentation:");
  console.log(`   POST /api/auth/register - Register new user`);
  console.log(`   POST /api/auth/login - Login user`);
  console.log(`   POST /api/auth/mikrotik-login - MikroTik super-admin login`);
  console.log(`   GET  /api/users/me - Get current user profile`);
  console.log(`   GET  /api/devices - Get user devices`);
  console.log(`   GET  /api/devices/sessions - Monitor live HotSpot sessions`);
  console.log(`   GET  /api/admin/devices - Super-admin device overview`);
  console.log(`   GET  /api/admin/sessions - Super-admin active sessions`);
  console.log(`   POST /api/devices/:deviceId/disconnect - Disconnect device`);
  console.log(`   DELETE /api/devices/:deviceId - Delete device`);
});

function logMikroTikStartupError(error: unknown) {
  if (error instanceof MikroTikError) {
    console.error(`❌ ${error.message} (${error.code})`);
    console.error(`   Diagnostic: ${error.diagnostic}`);
    return;
  }

  if (error instanceof Error) {
    console.error(`❌ Failed to initialize MikroTik client: ${error.message}`);
    return;
  }

  console.error(`❌ Failed to initialize MikroTik client: ${String(error)}`);
}

function validateRuntimeConfig() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
  if (!Number.isInteger(MIKROTIK_PORT) || MIKROTIK_PORT < 1 || MIKROTIK_PORT > 65535) {
    throw new Error("MIKROTIK_PORT must be a valid TCP port");
  }

  if (process.env.NODE_ENV === "production") {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL must be configured in production");
    }
    if (
      !process.env.MIKROTIK_HOST ||
      !process.env.MIKROTIK_USER ||
      !process.env.MIKROTIK_PASSWORD ||
      MIKROTIK_PASSWORD === "password"
    ) {
      throw new Error(
        "Secure MikroTik host and credentials must be configured in production"
      );
    }
  }
}

function logSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ MikroTik device synchronization failed: ${message}`);
}
