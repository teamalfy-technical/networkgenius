import type { Device, DevicePayload } from "../types";
import { DeviceQueries, AuditLogQueries } from "../database/queries";
import { UserService } from "./userService";
import { getMikroTikClient, type HotspotSession } from "../mikrotik/client";

export class DeviceService {
  private static syncPromise: Promise<HotspotSession[]> | null = null;

  static async syncAllActiveSessions(): Promise<HotspotSession[]> {
    if (!this.syncPromise) {
      this.syncPromise = this.performActiveSessionSync().finally(() => {
        this.syncPromise = null;
      });
    }

    return this.syncPromise;
  }

  private static async performActiveSessionSync(): Promise<HotspotSession[]> {
    const [users, devices, sessions] = await Promise.all([
      UserService.getAllUsers(),
      DeviceQueries.getAll(),
      getMikroTikClient().getActiveConnections(),
    ]);
    const usersByName = new Map(
      users.map((user) => [user.username.toLowerCase(), user])
    );
    const devicesByOwnerAndMac = new Map(
      devices.map((device) => [
        `${device.userId}:${normalizeMac(device.macAddress)}`,
        device,
      ])
    );
    const activeDeviceIds = new Set<string>();
    const now = new Date().toISOString();

    for (const session of uniqueSessionsByUserAndMac(sessions)) {
      const user = usersByName.get(session.user.toLowerCase());
      if (!user || user.role !== "user") continue;

      const macAddress = normalizeMac(session.macAddress);
      const key = `${user.id}:${macAddress}`;
      const existing = devicesByOwnerAndMac.get(key);
      const currentBytesIn = session.bytesIn || 0;
      const currentBytesOut = session.bytesOut || 0;

      if (!existing) {
        const created = await DeviceQueries.create({
          userId: user.id,
          deviceName: automaticDeviceName(macAddress),
          macAddress,
          ipAddress: session.address,
          isConnected: true,
          connectedAt: now,
          disconnectedAt: undefined,
          lastSeenAt: now,
          bytesIn: currentBytesIn,
          bytesOut: currentBytesOut,
          lastSessionId: session.id,
          lastSessionBytesIn: currentBytesIn,
          lastSessionBytesOut: currentBytesOut,
          discoveredBy: "mikrotik",
          createdAt: now,
          updatedAt: now,
        });
        activeDeviceIds.add(created.id);
        devicesByOwnerAndMac.set(key, created);
        await AuditLogQueries.log(
          user.id,
          "DEVICE_AUTO_DISCOVERED",
          `MAC: ${macAddress}, IP: ${session.address || ""}`,
          "mikrotik-sync"
        );
        continue;
      }

      const sameSession = existing.lastSessionId === session.id;
      const bytesInDelta = sameSession
        ? Math.max(currentBytesIn - existing.lastSessionBytesIn, 0)
        : currentBytesIn;
      const bytesOutDelta = sameSession
        ? Math.max(currentBytesOut - existing.lastSessionBytesOut, 0)
        : currentBytesOut;
      const updated = await DeviceQueries.update(existing.id, {
        ipAddress: session.address || existing.ipAddress,
        isConnected: true,
        connectedAt: sameSession ? existing.connectedAt || now : now,
        disconnectedAt: undefined,
        lastSeenAt: now,
        bytesIn: existing.bytesIn + bytesInDelta,
        bytesOut: existing.bytesOut + bytesOutDelta,
        lastSessionId: session.id,
        lastSessionBytesIn: currentBytesIn,
        lastSessionBytesOut: currentBytesOut,
      });
      if (updated) {
        activeDeviceIds.add(updated.id);
        devicesByOwnerAndMac.set(key, updated);
      }
    }

    for (const device of devices) {
      if (device.isConnected && !activeDeviceIds.has(device.id)) {
        await DeviceQueries.update(device.id, {
          isConnected: false,
          disconnectedAt: now,
        });
      }
    }

    return sessions;
  }

  /**
   * Get live RouterOS sessions and limit utilization for a user.
   */
  static async getSessionStatus(userId: string) {
    const user = await UserService.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    await this.syncAllActiveSessions();
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
        totalBytesIn: device?.bytesIn || session.bytesIn || 0,
        totalBytesOut: device?.bytesOut || session.bytesOut || 0,
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

    const existing = await DeviceQueries.getByUserIdAndMac(userId, macAddress);
    if (existing) {
      throw new Error("MAC address already registered");
    }

    // Create device
    const now = new Date().toISOString();
    const device = await DeviceQueries.create({
      userId,
      deviceName: payload.deviceName.trim(),
      macAddress,
      isConnected: false,
      bytesIn: 0,
      bytesOut: 0,
      lastSessionBytesIn: 0,
      lastSessionBytesOut: 0,
      discoveredBy: "manual",
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
    await this.syncAllActiveSessions();
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

    if (updates.deviceName !== undefined) {
      updates.deviceName = updates.deviceName.trim();
    }
    if (updates.macAddress !== undefined) {
      updates.macAddress = normalizeMac(updates.macAddress);
    }

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
    const device = await DeviceQueries.getByUserIdAndMac(userId, normalizedMac);
    if (!device) {
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
    await this.syncAllActiveSessions();
    const devices = await DeviceQueries.getByUserId(userId);
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
    let sessions = await mikrotik.getActiveConnectionsForUser(user.username);

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

    await this.syncAllActiveSessions();
  }

  /**
   * Get device by MAC address
   */
  static async getDeviceByMac(macAddress: string): Promise<Device | null> {
    return DeviceQueries.getByMacAddress(normalizeMac(macAddress));
  }

  private static async syncUserSessions(userId: string): Promise<Device[]> {
    await this.syncAllActiveSessions();
    return DeviceQueries.getByUserId(userId);
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

function uniqueSessionsByUserAndMac(
  sessions: HotspotSession[]
): HotspotSession[] {
  const unique = new Map<string, HotspotSession>();
  for (const session of sessions) {
    const key = `${session.user.toLowerCase()}:${normalizeMac(
      session.macAddress
    )}`;
    const existing = unique.get(key);
    if (
      !existing ||
      uptimeToSeconds(session.uptime) > uptimeToSeconds(existing.uptime)
    ) {
      unique.set(key, session);
    }
  }
  return [...unique.values()];
}

function automaticDeviceName(macAddress: string): string {
  return `Device ${macAddress.replace(/:/g, "").slice(-6)}`;
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
