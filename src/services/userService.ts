import bcrypt from "bcryptjs";
import type { User, UserPayload, UpdateUserPayload } from "../types";
import { UserQueries, DeviceQueries, AuditLogQueries } from "../database/queries";
import { getMikroTikClient } from "../mikrotik/client";

export class UserService {
  /**
   * Create a new user
   */
  static async createUser(
    payload: UserPayload,
    requestIp: string
  ): Promise<User> {
    // Check if user already exists
    const existing = await UserQueries.getByUsername(payload.username);
    if (existing) {
      throw new Error("Username already exists");
    }

    const emailExists = await UserQueries.getByEmail(payload.email);
    if (emailExists) {
      throw new Error("Email already exists");
    }

    // Hash password
    const passwordHash = await bcrypt.hash(payload.password, 10);

    // Create user in database
    const now = new Date().toISOString();
    const user = await UserQueries.create({
      username: payload.username,
      email: payload.email,
      passwordHash,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      maxDevices: payload.maxDevices || 2,
    });

    // Provision hotspot credentials separately from JWT/app authentication.
    try {
      const mikrotik = getMikroTikClient();
      await mikrotik.createHotspotUser(
        payload.username,
        payload.hotspotPassword || payload.password,
        "default"
      );
    } catch (error) {
      console.error("Failed to create hotspot user:", error);
      // Don't throw - user is created in DB, MikroTik sync can be retried
    }

    // Log action
    await AuditLogQueries.log(
      user.id,
      "USER_CREATED",
      `Username: ${payload.username}`,
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
    return UserQueries.getByUsername(username);
  }

  /**
   * Authenticate user
   */
  static async authenticateUser(
    username: string,
    password: string
  ): Promise<User | null> {
    const user = await UserQueries.getByUsername(username);
    if (!user) return null;

    if (!user.isActive) return null;

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) return null;

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
      const emailExists = await UserQueries.getByEmail(updates.email);
      if (emailExists) {
        throw new Error("Email already exists");
      }
    }

    const updated = await UserQueries.update(userId, updates);

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

    // Remove from MikroTik
    try {
      const mikrotik = getMikroTikClient();
      await mikrotik.removeHotspotUser(user.username);
    } catch (error) {
      console.error("Failed to remove hotspot user:", error);
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
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

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
