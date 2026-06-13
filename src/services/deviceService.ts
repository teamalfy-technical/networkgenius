import type { Device, DevicePayload } from "../types";
import { DeviceQueries, AuditLogQueries } from "../database/queries";
import { UserService } from "./userService";
import { getMikroTikClient, type HotspotSession } from "../mikrotik/client";

export class DeviceService {
  /**
   * Get live RouterOS sessions and limit utilization for a user.
   */
  static async getSessionStatus(userId: string) {
    const user = await UserService.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const devices = await DeviceQueries.getByUserId(userId);
    const registeredByMac = new Map(
      devices.map((device) => [normalizeMac(device.macAddress), device])
    );
    const sessions = await getMikroTikClient().getActiveConnectionsForUser(
      user.username
    );
    const uniqueSessions = new Map<string, HotspotSession>();

    for (const session of sessions) {
      const mac = normalizeMac(session.macAddress);
      const existing = uniqueSessions.get(mac);
      if (
        !existing ||
        uptimeToSeconds(session.uptime) > uptimeToSeconds(existing.uptime)
      ) {
        uniqueSessions.set(mac, session);
      }
    }

    const activeSessions = [...uniqueSessions.values()].map((session) => {
      const device = registeredByMac.get(normalizeMac(session.macAddress));
      return {
        sessionId: session.id,
        deviceId: device?.id,
        deviceName: device?.deviceName,
        registered: Boolean(device),
        macAddress: normalizeMac(session.macAddress),
        ipAddress: session.address,
        uptime: session.uptime,
        bytesIn: session.bytesIn || 0,
        bytesOut: session.bytesOut || 0,
      };
    });

    return {
      maxDevices: user.maxDevices,
      activeDevices: activeSessions.length,
      remainingDevices: Math.max(user.maxDevices - activeSessions.length, 0),
      limitExceeded: activeSessions.length > user.maxDevices,
      sessions: activeSessions,
    };
  }

  /**
   * Register a device for a user
   */
  static async registerDevice(
    userId: string,
    payload: DevicePayload,
    requestIp: string
  ): Promise<Device> {
    const macAddress = normalizeMac(
      await this.resolveMacAddress(userId, payload, requestIp)
    );

    // Check if user can add more devices
    if (!(await UserService.canAddMoreDevices(userId))) {
      throw new Error("User has reached maximum device limit");
    }

    // Check if MAC address is already in use
    const existing = await DeviceQueries.getByMacAddress(macAddress);
    if (existing) {
      throw new Error("MAC address already registered");
    }

    // Create device
    const now = new Date().toISOString();
    const device = await DeviceQueries.create({
      userId,
      deviceName: payload.deviceName,
      macAddress,
      isConnected: false,
      createdAt: now,
      updatedAt: now,
    });

    await AuditLogQueries.log(
      userId,
      "DEVICE_REGISTERED",
      `Device: ${payload.deviceName}, MAC: ${macAddress}`,
      requestIp
    );

    return device;
  }

  private static async resolveMacAddress(
    userId: string,
    payload: DevicePayload,
    requestIp: string
  ): Promise<string> {
    if (payload.macAddress) {
      return payload.macAddress;
    }

    const user = await UserService.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const lookupIp = payload.ipAddress || requestIp;
    const mikrotik = getMikroTikClient();
    const session = await mikrotik.getActiveConnectionForUser(
      user.username,
      lookupIp
    );

    if (session?.macAddress) {
      return session.macAddress;
    }

    const macFromIp = await mikrotik.getMacAddressByIp(lookupIp);
    if (macFromIp) {
      return macFromIp;
    }

    throw new Error(
      "Could not detect this device MAC address. Make sure this request comes from the device on the MikroTik network, or enter the MAC address manually."
    );
  }

  /**
   * Get device by ID
   */
  static async getDevice(deviceId: string): Promise<Device | null> {
    return DeviceQueries.getById(deviceId);
  }

  /**
   * Get all devices for a user
   */
  static async getUserDevices(userId: string): Promise<Device[]> {
    await this.syncUserSessions(userId);
    return DeviceQueries.getByUserId(userId);
  }

  /**
   * Update device
   */
  static async updateDevice(
    deviceId: string,
    updates: Partial<Device>,
    requestIp: string
  ): Promise<Device | null> {
    const device = await DeviceQueries.getById(deviceId);
    if (!device) return null;

    // If updating MAC address, check for conflicts
    if (updates.macAddress && updates.macAddress !== device.macAddress) {
      const existing = await DeviceQueries.getByMacAddress(updates.macAddress);
      if (existing) {
        throw new Error("MAC address already in use");
      }
    }

    const updated = await DeviceQueries.update(deviceId, updates);

    await AuditLogQueries.log(
      device.userId,
      "DEVICE_UPDATED",
      `Device ID: ${deviceId}`,
      requestIp
    );

    return updated;
  }

  /**
   * Delete device
   */
  static async deleteDevice(deviceId: string, requestIp: string): Promise<void> {
    const device = await DeviceQueries.getById(deviceId);
    if (!device) throw new Error("Device not found");

    await DeviceQueries.delete(deviceId);

    await AuditLogQueries.log(
      device.userId,
      "DEVICE_DELETED",
      `Device: ${device.deviceName}, MAC: ${device.macAddress}`,
      requestIp
    );
  }

  /**
   * Connect device (user logs in)
   */
  static async connectDevice(
    userId: string,
    macAddress: string,
    ipAddress: string,
    requestIp: string
  ): Promise<Device | null> {
    const normalizedMac = normalizeMac(macAddress);
    const device = await DeviceQueries.getByMacAddress(normalizedMac);
    if (!device || device.userId !== userId) {
      return null; // Device not found or doesn't belong to user
    }

    if (!(await this.canDeviceConnect(userId, normalizedMac))) {
      await this.enforceDeviceLimit(userId, requestIp);
    }

    const now = new Date().toISOString();
    const updated = await DeviceQueries.update(device.id, {
      isConnected: true,
      connectedAt: now,
      ipAddress,
    });

    await AuditLogQueries.log(
      userId,
      "DEVICE_CONNECTED",
      `Device: ${device.deviceName}, IP: ${ipAddress}`,
      requestIp
    );

    return updated;
  }

  /**
   * Disconnect device
   */
  static async disconnectDevice(
    deviceId: string,
    requestIp: string
  ): Promise<Device | null> {
    const device = await DeviceQueries.getById(deviceId);
    if (!device) return null;

    const user = await UserService.getUser(device.userId);
    if (user) {
      try {
        await getMikroTikClient().disconnectMac(user.username, device.macAddress);
      } catch (error) {
        console.error("Failed to disconnect device on MikroTik:", error);
      }
    }

    const now = new Date().toISOString();
    const updated = await DeviceQueries.update(deviceId, {
      isConnected: false,
      disconnectedAt: now,
    });

    await AuditLogQueries.log(
      device.userId,
      "DEVICE_DISCONNECTED",
      `Device: ${device.deviceName}`,
      requestIp
    );

    return updated;
  }

  /**
   * Get connected devices for a user
   */
  static async getConnectedDevices(userId: string): Promise<Device[]> {
    const devices = await this.syncUserSessions(userId);
    return devices.filter((d) => d.isConnected);
  }

  /**
   * Check if device can connect (not at active connection limit for user)
   */
  static async canDeviceConnect(
    userId: string,
    macAddress?: string
  ): Promise<boolean> {
    const user = await UserService.getUser(userId);
    if (!user) return false;

    const sessions = await getMikroTikClient().getActiveConnectionsForUser(
      user.username
    );
    const activeMacs = uniqueMacs(sessions.map((session) => session.macAddress));

    if (macAddress && activeMacs.includes(normalizeMac(macAddress))) {
      return true;
    }

    return activeMacs.length < user.maxDevices;
  }

  /**
   * Disconnect excess devices when user tries to connect more than allowed
   */
  static async enforceDeviceLimit(
    userId: string,
    requestIp: string
  ): Promise<void> {
    const user = await UserService.getUser(userId);
    if (!user) return;

    const mikrotik = getMikroTikClient();
    const devices = await DeviceQueries.getByUserId(userId);
    const registeredMacs = new Set(
      devices.map((device) => normalizeMac(device.macAddress))
    );
    let sessions = await mikrotik.getActiveConnectionsForUser(user.username);

    const unauthorizedSessions = sessions.filter(
      (session) => !registeredMacs.has(normalizeMac(session.macAddress))
    );
    for (const session of unauthorizedSessions) {
      await mikrotik.disconnectSession(session.id);
      await AuditLogQueries.log(
        userId,
        "UNREGISTERED_SESSION_DISCONNECTED",
        `MAC: ${session.macAddress}, IP: ${session.address || ""}`,
        requestIp
      );
    }

    sessions = sessions.filter((session) =>
      registeredMacs.has(normalizeMac(session.macAddress))
    );

    const excessSessions = this.getExcessSessions(sessions, user.maxDevices);
    for (const session of excessSessions) {
      await mikrotik.disconnectSession(session.id);
      const device = devices.find(
        (item) => normalizeMac(item.macAddress) === normalizeMac(session.macAddress)
      );
      if (device) {
        await DeviceQueries.update(device.id, {
          isConnected: false,
          disconnectedAt: new Date().toISOString(),
        });
      }
      await AuditLogQueries.log(
        userId,
        "DEVICE_LIMIT_ENFORCED",
        `MAC: ${session.macAddress}, IP: ${session.address || ""}`,
        requestIp
      );
    }

    await this.syncUserSessions(userId);
  }

  /**
   * Get device by MAC address
   */
  static async getDeviceByMac(macAddress: string): Promise<Device | null> {
    return DeviceQueries.getByMacAddress(normalizeMac(macAddress));
  }

  private static async syncUserSessions(userId: string): Promise<Device[]> {
    const user = await UserService.getUser(userId);
    if (!user) return [];

    const devices = await DeviceQueries.getByUserId(userId);
    const sessions = await getMikroTikClient().getActiveConnectionsForUser(
      user.username
    );
    const activeByMac = new Map(
      sessions.map((session) => [normalizeMac(session.macAddress), session])
    );

    const synced: Device[] = [];
    for (const device of devices) {
      const session = activeByMac.get(normalizeMac(device.macAddress));
      const shouldBeConnected = Boolean(session);

      if (
        device.isConnected !== shouldBeConnected ||
        (session?.address && device.ipAddress !== session.address)
      ) {
        const updated = await DeviceQueries.update(device.id, {
          isConnected: shouldBeConnected,
          ipAddress: session?.address || device.ipAddress,
          connectedAt: shouldBeConnected
            ? device.connectedAt || new Date().toISOString()
            : device.connectedAt,
          disconnectedAt: shouldBeConnected
            ? undefined
            : device.disconnectedAt || new Date().toISOString(),
        });
        if (updated) {
          synced.push(updated);
          continue;
        }
      }

      synced.push(device);
    }

    return synced;
  }

  private static getExcessSessions(
    sessions: HotspotSession[],
    maxDevices: number
  ): HotspotSession[] {
    const byMac = new Map<string, HotspotSession>();
    for (const session of sessions) {
      const mac = normalizeMac(session.macAddress);
      const existing = byMac.get(mac);
      if (!existing || uptimeToSeconds(session.uptime) > uptimeToSeconds(existing.uptime)) {
        byMac.set(mac, session);
      }
    }

    return [...byMac.values()]
      .sort((a, b) => uptimeToSeconds(b.uptime) - uptimeToSeconds(a.uptime))
      .slice(maxDevices);
  }
}

function normalizeMac(macAddress: string): string {
  return macAddress.trim().toUpperCase();
}

function uniqueMacs(macAddresses: string[]): string[] {
  return [...new Set(macAddresses.map(normalizeMac).filter(Boolean))];
}

function uptimeToSeconds(uptime?: string): number {
  if (!uptime) return 0;

  const matches = uptime.matchAll(/(\d+)([wdhms])/g);
  let seconds = 0;
  for (const match of matches) {
    const value = Number(match[1]);
    const unit = match[2];
    if (unit === "w") seconds += value * 7 * 24 * 60 * 60;
    if (unit === "d") seconds += value * 24 * 60 * 60;
    if (unit === "h") seconds += value * 60 * 60;
    if (unit === "m") seconds += value * 60;
    if (unit === "s") seconds += value;
  }

  return seconds;
}
