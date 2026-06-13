import { getDatabase } from "./init";
import type { User, Device, SessionToken } from "../types";

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function mapUser(row: any): User | null {
  return row
    ? {
        ...row,
        isActive: Boolean(row.isActive),
      }
    : null;
}

function mapDevice(row: any): Device | null {
  return row
    ? {
        ...row,
        isConnected: Boolean(row.isConnected),
      }
    : null;
}

// ============ User Queries ============
export const UserQueries = {
  create: async (user: Omit<User, "id">): Promise<User> => {
    const db = getDatabase();
    const id = createId("user");
    const [row] = await db<User[]>`
      INSERT INTO users (id, username, email, "passwordHash", "isActive", "maxDevices", "createdAt", "updatedAt")
      VALUES (${id}, ${user.username}, ${user.email}, ${user.passwordHash}, ${user.isActive}, ${user.maxDevices}, ${user.createdAt}, ${user.updatedAt})
      RETURNING *
    `;

    return mapUser(row)!;
  },

  getById: async (id: string): Promise<User | null> => {
    const db = getDatabase();
    const [row] = await db<User[]>`SELECT * FROM users WHERE id = ${id}`;
    return mapUser(row);
  },

  getByUsername: async (username: string): Promise<User | null> => {
    const db = getDatabase();
    const [row] = await db<User[]>`
      SELECT * FROM users WHERE LOWER(username) = LOWER(${username})
    `;
    return mapUser(row);
  },

  getByEmail: async (email: string): Promise<User | null> => {
    const db = getDatabase();
    const [row] = await db<User[]>`SELECT * FROM users WHERE email = ${email}`;
    return mapUser(row);
  },

  update: async (
    id: string,
    updates: Partial<Omit<User, "id" | "createdAt">>
  ): Promise<User | null> => {
    const user = await UserQueries.getById(id);
    if (!user) return null;

    const updatedUser = {
      ...user,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const db = getDatabase();
    const [row] = await db<User[]>`
      UPDATE users
      SET
        username = ${updatedUser.username},
        email = ${updatedUser.email},
        "passwordHash" = ${updatedUser.passwordHash},
        "isActive" = ${updatedUser.isActive},
        "maxDevices" = ${updatedUser.maxDevices},
        "updatedAt" = ${updatedUser.updatedAt}
      WHERE id = ${id}
      RETURNING *
    `;

    return mapUser(row);
  },

  delete: async (id: string): Promise<void> => {
    const db = getDatabase();
    await db`DELETE FROM users WHERE id = ${id}`;
  },

  getAll: async (): Promise<User[]> => {
    const db = getDatabase();
    const rows = await db<User[]>`SELECT * FROM users ORDER BY "createdAt" DESC`;
    return rows.map((row) => mapUser(row)!);
  },
};

// ============ Device Queries ============
export const DeviceQueries = {
  create: async (device: Omit<Device, "id">): Promise<Device> => {
    const db = getDatabase();
    const id = createId("device");
    const [row] = await db<Device[]>`
      INSERT INTO devices (
        id, "userId", "deviceName", "macAddress", "ipAddress", "isConnected",
        "connectedAt", "disconnectedAt", "createdAt", "updatedAt"
      )
      VALUES (
        ${id}, ${device.userId}, ${device.deviceName}, ${device.macAddress},
        ${device.ipAddress || null}, ${device.isConnected},
        ${device.connectedAt || null}, ${device.disconnectedAt || null},
        ${device.createdAt}, ${device.updatedAt}
      )
      RETURNING *
    `;

    return mapDevice(row)!;
  },

  getById: async (id: string): Promise<Device | null> => {
    const db = getDatabase();
    const [row] = await db<Device[]>`SELECT * FROM devices WHERE id = ${id}`;
    return mapDevice(row);
  },

  getByMacAddress: async (macAddress: string): Promise<Device | null> => {
    const db = getDatabase();
    const [row] = await db<Device[]>`
      SELECT * FROM devices WHERE "macAddress" = ${macAddress}
    `;
    return mapDevice(row);
  },

  getByUserId: async (userId: string): Promise<Device[]> => {
    const db = getDatabase();
    const rows = await db<Device[]>`
      SELECT * FROM devices WHERE "userId" = ${userId} ORDER BY "createdAt" DESC
    `;
    return rows.map((row) => mapDevice(row)!);
  },

  update: async (
    id: string,
    updates: Partial<Omit<Device, "id" | "createdAt">>
  ): Promise<Device | null> => {
    const device = await DeviceQueries.getById(id);
    if (!device) return null;

    const updatedDevice = {
      ...device,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const db = getDatabase();
    const [row] = await db<Device[]>`
      UPDATE devices
      SET
        "userId" = ${updatedDevice.userId},
        "deviceName" = ${updatedDevice.deviceName},
        "macAddress" = ${updatedDevice.macAddress},
        "ipAddress" = ${updatedDevice.ipAddress || null},
        "isConnected" = ${updatedDevice.isConnected},
        "connectedAt" = ${updatedDevice.connectedAt || null},
        "disconnectedAt" = ${updatedDevice.disconnectedAt || null},
        "updatedAt" = ${updatedDevice.updatedAt}
      WHERE id = ${id}
      RETURNING *
    `;

    return mapDevice(row);
  },

  delete: async (id: string): Promise<void> => {
    const db = getDatabase();
    await db`DELETE FROM devices WHERE id = ${id}`;
  },

  countConnectedByUserId: async (userId: string): Promise<number> => {
    const db = getDatabase();
    const [result] = await db<{ count: string }[]>`
      SELECT COUNT(*)::text as count FROM devices
      WHERE "userId" = ${userId} AND "isConnected" = TRUE
    `;
    return Number(result?.count || 0);
  },

  countAllByUserId: async (userId: string): Promise<number> => {
    const db = getDatabase();
    const [result] = await db<{ count: string }[]>`
      SELECT COUNT(*)::text as count FROM devices WHERE "userId" = ${userId}
    `;
    return Number(result?.count || 0);
  },
};

// ============ Session Token Queries ============
export const SessionTokenQueries = {
  create: async (token: Omit<SessionToken, "id">) => {
    const db = getDatabase();
    const id = createId("token");
    const [row] = await db<SessionToken[]>`
      INSERT INTO session_tokens (id, "userId", "macAddress", "createdAt", "expiresAt")
      VALUES (${id}, ${token.userId}, ${token.macAddress}, ${token.createdAt}, ${token.expiresAt})
      RETURNING *
    `;
    return row;
  },

  getById: async (id: string): Promise<SessionToken | null> => {
    const db = getDatabase();
    const [row] = await db<SessionToken[]>`
      SELECT * FROM session_tokens WHERE id = ${id}
    `;
    return row || null;
  },

  getByUserIdAndMac: async (
    userId: string,
    macAddress: string
  ): Promise<SessionToken | null> => {
    const db = getDatabase();
    const [row] = await db<SessionToken[]>`
      SELECT * FROM session_tokens
      WHERE "userId" = ${userId}
        AND "macAddress" = ${macAddress}
        AND "expiresAt" > ${new Date().toISOString()}
      LIMIT 1
    `;
    return row || null;
  },

  delete: async (id: string): Promise<void> => {
    const db = getDatabase();
    await db`DELETE FROM session_tokens WHERE id = ${id}`;
  },

  deleteExpired: async (): Promise<void> => {
    const db = getDatabase();
    await db`
      DELETE FROM session_tokens WHERE "expiresAt" <= ${new Date().toISOString()}
    `;
  },
};

// ============ Audit Log Queries ============
export const AuditLogQueries = {
  log: async (
    userId: string | null,
    action: string,
    details: string,
    ipAddress: string
  ): Promise<void> => {
    const db = getDatabase();
    const id = createId("log");
    await db`
      INSERT INTO audit_logs (id, "userId", action, details, "ipAddress", "createdAt")
      VALUES (${id}, ${userId || null}, ${action}, ${details}, ${ipAddress}, ${new Date().toISOString()})
    `;
  },

  getByUserId: async (userId: string, limit: number = 50): Promise<any[]> => {
    const db = getDatabase();
    return db`
      SELECT * FROM audit_logs
      WHERE "userId" = ${userId}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `;
  },
};
