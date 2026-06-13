import bcrypt from "bcryptjs";
import type { User, UserPayload, UpdateUserPayload } from "../types";
import { UserQueries, DeviceQueries, AuditLogQueries } from "../database/queries";
import {
  getMikroTikClient,
  verifyMikroTikCredentials,
} from "../mikrotik/client";

const DUMMY_PASSWORD_HASH =
  "$2a$12$zQ4C8fVbI4Wq5j8jG7B6BuzvLJ1PpQF8iG2CwQjYQTKv8QxLwYgJi";

export class UserService {
  /**
   * Create a new user
   */
  static async createUser(
    payload: UserPayload,
    requestIp: string
  ): Promise<User> {
    const maxDevices = validateDeviceLimit(payload.maxDevices ?? 2);
    const username = normalizeUsername(payload.username);
    const email = normalizeEmail(payload.email);

    // Check if user already exists
    const existing = await UserQueries.getByUsername(username);
    if (existing) {
      throw new Error("Username already exists");
    }

    const emailExists = await UserQueries.getByEmail(email);
    if (emailExists) {
      throw new Error("Email already exists");
    }

    // Hash password
    const passwordHash = await bcrypt.hash(payload.password, 12);

    // Create user in database
    const now = new Date().toISOString();
    const user = await UserQueries.create({
      username,
      email,
      passwordHash,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      maxDevices,
      role: payload.role || "user",
    });

    if (user.role === "user") {
      // A user account without matching HotSpot credentials cannot provide
      // internet access, so roll it back when router provisioning fails.
      try {
        const mikrotik = getMikroTikClient();
        const profile = await mikrotik.ensureDeviceLimitProfile(maxDevices);
        await mikrotik.createHotspotUser(
          username,
          payload.hotspotPassword || payload.password,
          profile
        );
      } catch (error) {
        await UserQueries.delete(user.id);
        throw error;
      }
    }

    // Log action
    await AuditLogQueries.log(
      user.id,
      "USER_CREATED",
      `Username: ${username}`,
      requestIp
    );

    return user;
  }

  /**
   * Get user by ID
   */
  static async getUser(userId: string): Promise<User | null> {
    return UserQueries.getById(userId);
  }

  /**
   * Get user by username
   */
  static async getUserByUsername(username: string): Promise<User | null> {
    return UserQueries.getByUsername(normalizeUsername(username));
  }

  /**
   * Authenticate user
   */
  static async authenticateUser(
    username: string,
    password: string
  ): Promise<User | null> {
    const user = await UserQueries.getByUsername(normalizeUsername(username));
    const isPasswordValid = await bcrypt.compare(
      password,
      user?.passwordHash || DUMMY_PASSWORD_HASH
    );
    if (!user || !user.isActive || !isPasswordValid) return null;

    return user;
  }

  static async authenticateMikroTikSuperAdmin(
    usernameInput: string,
    password: string,
    emailInput: string | undefined,
    requestIp: string
  ): Promise<User> {
    const primaryRouterUser = process.env.MIKROTIK_USER || "admin";
    if (usernameInput !== primaryRouterUser) {
      throw new Error("Invalid MikroTik credentials");
    }

    const username = normalizeUsername(usernameInput);
    await verifyMikroTikCredentials({
      host: process.env.MIKROTIK_HOST || "192.168.88.1",
      port: Number(process.env.MIKROTIK_PORT || 8728),
      tls: process.env.MIKROTIK_TLS === "true",
      user: usernameInput,
      password,
    });

    const existing = await UserQueries.getByUsername(username);
    const passwordHash = await bcrypt.hash(password, 12);
    let user: User;

    if (existing) {
      user =
        (await UserQueries.update(existing.id, {
          passwordHash,
          isActive: true,
          role: "super_admin",
          ...(emailInput ? { email: normalizeEmail(emailInput) } : {}),
        })) || existing;
    } else {
      if (!emailInput) {
        throw new Error("Email is required for first MikroTik admin login");
      }
      const email = normalizeEmail(emailInput);
      const emailExists = await UserQueries.getByEmail(email);
      if (emailExists) {
        throw new Error("Email already exists");
      }

      const now = new Date().toISOString();
      user = await UserQueries.create({
        username,
        email,
        passwordHash,
        isActive: true,
        maxDevices: 1,
        role: "super_admin",
        createdAt: now,
        updatedAt: now,
      });
    }

    await AuditLogQueries.log(
      user.id,
      "MIKROTIK_SUPER_ADMIN_LOGIN",
      `RouterOS user: ${username}`,
      requestIp
    );
    return user;
  }

  /**
   * Update user
   */
  static async updateUser(
    userId: string,
    updates: UpdateUserPayload,
    requestIp: string
  ): Promise<User | null> {
    const user = await UserQueries.getById(userId);
    if (!user) return null;

    // Check for email conflicts
    if (updates.email && updates.email !== user.email) {
      updates.email = normalizeEmail(updates.email);
      const emailExists = await UserQueries.getByEmail(updates.email);
      if (emailExists) {
        throw new Error("Email already exists");
      }
    }

    if (updates.maxDevices !== undefined) {
      updates.maxDevices = validateDeviceLimit(updates.maxDevices);
      await getMikroTikClient().setHotspotUserDeviceLimit(
        user.username,
        updates.maxDevices
      );
    }

    const updated = await UserQueries.update(userId, updates);

    if (updates.maxDevices !== undefined) {
      await getMikroTikClient().enforceUserSessionLimit(
        user.username,
        updates.maxDevices
      );
    }

    await AuditLogQueries.log(
      userId,
      "USER_UPDATED",
      JSON.stringify(updates),
      requestIp
    );

    return updated;
  }

  /**
   * Delete user and cleanup
   */
  static async deleteUser(userId: string, requestIp: string): Promise<void> {
    const user = await UserQueries.getById(userId);
    if (!user) throw new Error("User not found");
    if (
      user.role === "super_admin" &&
      (await UserQueries.countActiveSuperAdmins()) <= 1
    ) {
      throw new Error("Cannot delete the last active super admin");
    }

    // Remove from MikroTik
    if (user.role === "user") {
      try {
        const mikrotik = getMikroTikClient();
        await mikrotik.removeHotspotUser(user.username);
      } catch (error) {
        console.error("Failed to remove hotspot user:", error);
      }
    }

    // Delete user and devices
    await UserQueries.delete(userId);

    await AuditLogQueries.log(
      userId,
      "USER_DELETED",
      `Username: ${user.username}`,
      requestIp
    );
  }

  /**
   * Change password
   */
  static async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
    requestIp: string
  ): Promise<boolean> {
    const user = await UserQueries.getById(userId);
    if (!user) throw new Error("User not found");

    // Verify old password
    const isPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new Error("Old password is incorrect");
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // Update database
    await UserQueries.update(userId, { passwordHash: newPasswordHash });

    // Update MikroTik
    try {
      const mikrotik = getMikroTikClient();
      await mikrotik.updateHotspotUserPassword(user.username, newPassword);
    } catch (error) {
      console.error("Failed to update MikroTik password:", error);
    }

    await AuditLogQueries.log(
      userId,
      "PASSWORD_CHANGED",
      "User password updated",
      requestIp
    );

    return true;
  }

  /**
   * Get all users
   */
  static async getAllUsers(): Promise<User[]> {
    return UserQueries.getAll();
  }

  /**
   * Enable/Disable user
   */
  static async toggleUserStatus(
    userId: string,
    isActive: boolean,
    requestIp: string
  ): Promise<User | null> {
    const user = await UserQueries.getById(userId);
    if (!user) return null;
    if (
      user.role === "super_admin" &&
      !isActive &&
      (await UserQueries.countActiveSuperAdmins()) <= 1
    ) {
      throw new Error("Cannot disable the last active super admin");
    }

    const updated = await UserQueries.update(userId, { isActive });

    // Update MikroTik
    try {
      const mikrotik = getMikroTikClient();
      await mikrotik.setUserEnabled(user.username, isActive);
    } catch (error) {
      console.error("Failed to update MikroTik user status:", error);
    }

    await AuditLogQueries.log(
      userId,
      isActive ? "USER_ENABLED" : "USER_DISABLED",
      "",
      requestIp
    );

    return updated;
  }

  static async updateUserRole(
    userId: string,
    role: "user" | "super_admin",
    requestIp: string
  ): Promise<User | null> {
    const user = await UserQueries.getById(userId);
    if (!user) return null;
    if (
      user.role === "super_admin" &&
      role === "user" &&
      user.isActive &&
      (await UserQueries.countActiveSuperAdmins()) <= 1
    ) {
      throw new Error("Cannot demote the last active super admin");
    }

    const updated = await UserQueries.update(userId, { role });
    await AuditLogQueries.log(
      userId,
      "USER_ROLE_UPDATED",
      `Role: ${role}`,
      requestIp
    );
    return updated;
  }

  /**
   * Get user device count
   */
  static async getUserDeviceCount(userId: string): Promise<number> {
    return DeviceQueries.countAllByUserId(userId);
  }

  /**
   * Get user connected device count
   */
  static async getUserConnectedDeviceCount(userId: string): Promise<number> {
    const user = await UserQueries.getById(userId);
    if (!user) return 0;

    try {
      const sessions = await getMikroTikClient().getActiveConnectionsForUser(
        user.username
      );
      return new Set(
        sessions.map((session) => session.macAddress.trim().toUpperCase())
      ).size;
    } catch (error) {
      console.error("Failed to count MikroTik active sessions:", error);
      return DeviceQueries.countConnectedByUserId(userId);
    }
  }

  /**
   * Check if user can add more devices
   */
  static async canAddMoreDevices(userId: string): Promise<boolean> {
    const user = await UserQueries.getById(userId);
    if (!user) return false;

    const deviceCount = await DeviceQueries.countAllByUserId(userId);
    return deviceCount < user.maxDevices;
  }
}

function validateDeviceLimit(maxDevices: number): number {
  if (!Number.isInteger(maxDevices) || maxDevices < 1) {
    throw new Error("maxDevices must be a positive integer");
  }

  return maxDevices;
}

function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized)) {
    throw new Error(
      "Username must be 3-32 lowercase letters, numbers, dots, underscores, or hyphens"
    );
  }

  return normalized;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new Error("Invalid email address");
  }

  return normalized;
}
