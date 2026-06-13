import { AuditLogQueries, DeviceQueries, UserQueries } from "../database/queries";
import { getMikroTikClient } from "../mikrotik/client";
import { DeviceService } from "./deviceService";

export class AdminService {
  static async getAllDevices(status: "all" | "connected" | "disconnected") {
    await DeviceService.syncAllActiveSessions();
    const [users, devices, sessions] = await Promise.all([
      UserQueries.getAll(),
      DeviceQueries.getAll(),
      getMikroTikClient().getActiveConnections(),
    ]);

    const usersById = new Map(users.map((user) => [user.id, user]));
    const usersByName = new Map(users.map((user) => [user.username, user]));
    const sessionsByMac = new Map(
      sessions.map((session) => [normalizeMac(session.macAddress), session])
    );
    const now = new Date().toISOString();

    const results = [];
    for (const device of devices) {
      const session = sessionsByMac.get(normalizeMac(device.macAddress));
      const connected = Boolean(session);
      let current = device;

      if (
        device.isConnected !== connected ||
        (session?.address && device.ipAddress !== session.address)
      ) {
        current =
          (await DeviceQueries.update(device.id, {
            isConnected: connected,
            ipAddress: session?.address || device.ipAddress,
            connectedAt: connected ? device.connectedAt || now : device.connectedAt,
            disconnectedAt: connected ? undefined : device.disconnectedAt || now,
          })) || device;
      }

      if (
        status !== "all" &&
        ((status === "connected") !== current.isConnected)
      ) {
        continue;
      }

      const owner = usersById.get(current.userId);
      results.push({
        ...current,
        registered: true,
        owner: owner
          ? {
              id: owner.id,
              username: owner.username,
              email: owner.email,
              isActive: owner.isActive,
              maxDevices: owner.maxDevices,
            }
          : null,
        session: session
          ? {
              id: session.id,
              uptime: session.uptime,
              bytesIn: session.bytesIn || 0,
              bytesOut: session.bytesOut || 0,
              totalBytesIn: current.bytesIn,
              totalBytesOut: current.bytesOut,
            }
          : null,
      });
    }

    const registeredMacs = new Set(
      devices.map((device) => normalizeMac(device.macAddress))
    );
    const unregisteredSessions = sessions
      .filter((session) => !registeredMacs.has(normalizeMac(session.macAddress)))
      .map((session) => ({
        sessionId: session.id,
        username: session.user,
        userId: usersByName.get(session.user)?.id,
        registered: false,
        macAddress: normalizeMac(session.macAddress),
        ipAddress: session.address,
        uptime: session.uptime,
        bytesIn: session.bytesIn || 0,
        bytesOut: session.bytesOut || 0,
      }));

    if (status !== "disconnected") {
      for (const session of unregisteredSessions) {
        const owner = session.userId
          ? usersById.get(session.userId)
          : usersByName.get(session.username);
        results.push({
          id: null,
          userId: owner?.id,
          deviceName: null,
          macAddress: session.macAddress,
          ipAddress: session.ipAddress,
          isConnected: true,
          connectedAt: null,
          disconnectedAt: null,
          createdAt: null,
          updatedAt: null,
          registered: false,
          owner: owner
            ? {
                id: owner.id,
                username: owner.username,
                email: owner.email,
                isActive: owner.isActive,
                maxDevices: owner.maxDevices,
              }
            : null,
          session: {
            id: session.sessionId,
            uptime: session.uptime,
            bytesIn: session.bytesIn,
            bytesOut: session.bytesOut,
          },
        });
      }
    }

    return {
      total: results.length,
      connected: results.filter((device) => device.isConnected).length,
      disconnected: results.filter((device) => !device.isConnected).length,
      devices: results,
      unregisteredSessions,
    };
  }

  static async getAllActiveSessions() {
    await DeviceService.syncAllActiveSessions();
    const [users, devices, sessions] = await Promise.all([
      UserQueries.getAll(),
      DeviceQueries.getAll(),
      getMikroTikClient().getActiveConnections(),
    ]);
    const usersByName = new Map(users.map((user) => [user.username, user]));
    const devicesByMac = new Map(
      devices.map((device) => [normalizeMac(device.macAddress), device])
    );

    return sessions.map((session) => {
      const user = usersByName.get(session.user);
      const device = devicesByMac.get(normalizeMac(session.macAddress));
      return {
        sessionId: session.id,
        username: session.user,
        userId: user?.id,
        userActive: user?.isActive,
        maxDevices: user?.maxDevices,
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
  }

  static async disconnectSession(
    sessionId: string,
    actorUserId: string,
    requestIp: string
  ) {
    const sessions = await getMikroTikClient().getActiveConnections();
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new Error("Active session not found");
    }

    await getMikroTikClient().disconnectSession(sessionId);
    const device = await DeviceQueries.getByMacAddress(
      normalizeMac(session.macAddress)
    );
    if (device) {
      await DeviceQueries.update(device.id, {
        isConnected: false,
        disconnectedAt: new Date().toISOString(),
      });
    }

    await AuditLogQueries.log(
      actorUserId,
      "SUPER_ADMIN_SESSION_DISCONNECTED",
      `User: ${session.user}, MAC: ${normalizeMac(session.macAddress)}`,
      requestIp
    );

    return session;
  }
}

function normalizeMac(macAddress: string): string {
  return macAddress.trim().toUpperCase();
}
