import { Elysia } from "elysia";
import { initializeDatabase } from "./src/database/init";
import { initializeMikroTikClient, MikroTikError } from "./src/mikrotik/client";
import {
  authMiddleware,
  getCurrentUser,
  getClientIp,
  extractToken,
  verifyToken,
} from "./src/middleware/auth";
import { successResponse, errorResponse } from "./src/middleware/response";
import { userRoutes } from "./src/api/userRoutes";
import { deviceRoutes } from "./src/api/deviceRoutes";

// Get config from environment
const MIKROTIK_HOST = process.env.MIKROTIK_HOST || "192.168.88.1";
const MIKROTIK_USER = process.env.MIKROTIK_USER || "admin";
const MIKROTIK_PASSWORD = process.env.MIKROTIK_PASSWORD || "password";
const MIKROTIK_PORT = parseInt(process.env.MIKROTIK_PORT || "8728");
const PORT = parseInt(process.env.PORT || "3000");
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";

function setAuthenticatedUser(store: unknown, token: string) {
  const payload = verifyToken(token);
  if (payload) {
    (store as any).user = payload;
  }
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
  });
  mikrotikClient
    .connect()
    .then(() => console.log("✅ Connected to MikroTik router"))
    .catch((err) => logMikroTikStartupError(err));
} catch (error) {
  logMikroTikStartupError(error);
}

// Create Elysia app
const app = new Elysia();

function getRequestIp(request: Request): string {
  return getClientIp({ request, server: app.server as any });
}

// Health check
app.get("/health", () =>
  successResponse({ status: "ok" }, "Server is running")
);

// ============ PUBLIC ROUTES ============
app.post("/api/auth/register", ({ body, store, request }) =>
  userRoutes.register({
    params: {},
    clientIp: getRequestIp(request),
    request: createJsonRequest("POST", body),
    set: { status: 201 },
    store,
  } as any)
);
app.post("/api/auth/login", ({ body, store, request }) =>
  userRoutes.login({
    params: {},
    clientIp: getRequestIp(request),
    request: createJsonRequest("POST", body),
    set: { status: 200 },
    store,
  } as any)
);

// ============ PROTECTED ROUTES - USER ENDPOINTS ============

// User profile
app.get("/api/users/me", ({ headers, store }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);
  return userRoutes.getProfile({ params: {}, request: new Request("http://localhost"), set: { status: 200 }, store } as any);
});

// Get all users (admin)
app.get("/api/users", ({ headers, store }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);
  return userRoutes.getAllUsers({ params: {}, request: new Request("http://localhost"), set: { status: 200 }, store } as any);
});

// Get user by ID (admin)
app.get("/api/users/:userId", ({ headers, params, store }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);
  return userRoutes.getUser({ params, request: new Request("http://localhost"), set: { status: 200 }, store } as any);
});

// Update user profile
app.put("/api/users/me", async ({ headers, store, body }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);

  const mockRequest = createJsonRequest("PUT", body);

  return userRoutes.updateProfile({
    params: {},
    request: mockRequest,
    set: { status: 200 },
    store,
  } as any);
});

// Change password
app.post("/api/users/change-password", async ({ headers, store, body }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);

  const mockRequest = createJsonRequest("POST", body);

  return userRoutes.changePassword({
    params: {},
    request: mockRequest,
    set: { status: 200 },
    store,
  } as any);
});

// Delete user (admin)
app.delete("/api/users/:userId", ({ headers, params, store }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);
  return userRoutes.deleteUser({
    params,
    request: new Request("http://localhost"),
    set: { status: 200 },
    store,
  } as any);
});

// Toggle user status (admin)
app.put("/api/users/:userId/status", async ({ headers, params, store, body }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);

  const mockRequest = createJsonRequest("PUT", body);

  return userRoutes.toggleUserStatus({
    params,
    request: mockRequest,
    set: { status: 200 },
    store,
  } as any);
});

// ============ PROTECTED ROUTES - DEVICE ENDPOINTS ============

// Register device
app.post("/api/devices", async ({ headers, store, body, request }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);

  const mockRequest = createJsonRequest("POST", body);

  return deviceRoutes.registerDevice({
    params: {},
    clientIp: getRequestIp(request),
    request: mockRequest,
    set: { status: 201 },
    store,
  } as any);
});

// Get user devices
app.get("/api/devices", ({ headers, store }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);
  return deviceRoutes.getUserDevices({
    params: {},
    request: new Request("http://localhost"),
    set: { status: 200 },
    store,
  } as any);
});

// Get connected devices
app.get("/api/devices/connected", ({ headers, store }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);
  return deviceRoutes.getConnectedDevices({
    params: {},
    request: new Request("http://localhost"),
    set: { status: 200 },
    store,
  } as any);
});

// Get device by ID
app.get("/api/devices/:deviceId", ({ headers, params, store }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);
  return deviceRoutes.getDevice({
    params,
    request: new Request("http://localhost"),
    set: { status: 200 },
    store,
  } as any);
});

// Update device
app.put("/api/devices/:deviceId", async ({ headers, params, store, body }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);

  const mockRequest = createJsonRequest("PUT", body);

  return deviceRoutes.updateDevice({
    params,
    request: mockRequest,
    set: { status: 200 },
    store,
  } as any);
});

// Delete device
app.delete("/api/devices/:deviceId", ({ headers, params, store }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);
  return deviceRoutes.deleteDevice({
    params,
    request: new Request("http://localhost"),
    set: { status: 200 },
    store,
  } as any);
});

// Connect device
app.post("/api/devices/connect", async ({ headers, store, body }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);

  const mockRequest = createJsonRequest("POST", body);

  return deviceRoutes.connectDevice({
    params: {},
    request: mockRequest,
    set: { status: 200 },
    store,
  } as any);
});

// Disconnect device
app.post("/api/devices/:deviceId/disconnect", ({ headers, params, store }) => {
  const token = extractToken(headers.authorization);
  if (!token || !verifyToken(token)) {
    return errorResponse("Unauthorized");
  }
  setAuthenticatedUser(store, token);
  return deviceRoutes.disconnectDevice({
    params,
    request: new Request("http://localhost"),
    set: { status: 200 },
    store,
  } as any);
});

// 404 handler
app.all("*", ({ path }) => {
  return errorResponse("Not found");
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log("📚 API Documentation:");
  console.log(`   POST /api/auth/register - Register new user`);
  console.log(`   POST /api/auth/login - Login user`);
  console.log(`   GET  /api/users/me - Get current user profile`);
  console.log(`   GET  /api/devices - Get user devices`);
  console.log(`   POST /api/devices - Register new device`);
  console.log(`   POST /api/devices/connect - Connect device`);
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
