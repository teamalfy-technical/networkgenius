import { RouterOSClient, type RosApiMenu } from "routeros-api";
import type { MikroTikConfig } from "../types";

type RouterOSItem = Record<string, any>;

export interface HotspotSession {
  id: string;
  user: string;
  macAddress: string;
  address?: string;
  uptime?: string;
}

export class MikroTikError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly diagnostic: string
  ) {
    super(message);
    this.name = "MikroTikError";
  }
}

/**
 * MikroTik API Client
 * Manages connections and interactions with MikroTik RouterOS API
 */
export class MikroTikClient {
  private config: MikroTikConfig;
  private client: RouterOSClient | null = null;
  private api: RosApiMenu | null = null;

  constructor(config: MikroTikConfig) {
    this.config = {
      port: 8728,
      ...config,
    };
  }

  /**
   * Connect to MikroTik RouterOS and verify that authenticated commands work.
   */
  async connect(): Promise<void> {
    try {
      console.log(
        `Connecting to MikroTik at ${this.config.host}:${this.config.port}`
      );

      const client = new RouterOSClient({
        host: this.config.host,
        user: this.config.user,
        password: this.config.password,
        port: this.config.port,
        timeout: 10,
        keepalive: true,
      });

      this.client = client;
      this.api = await client.connect();

      await this.api.menu("/system resource").getOnly();
    } catch (error) {
      this.api = null;
      this.client = null;
      throw toMikroTikError("connect", error);
    }
  }

  /**
   * Disconnect from MikroTik RouterOS
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }

    this.api = null;
    this.client = null;
  }

  /**
   * Create a new IP hotspot user
   */
  async createHotspotUser(
    username: string,
    password: string,
    profile: string = "default",
    macAddress?: string
  ): Promise<boolean> {
    try {
      const payload: RouterOSItem = {
        name: username,
        password,
        profile,
      };

      if (macAddress) {
        payload.macAddress = macAddress;
      }

      await this.getApi().menu("/ip hotspot user").add(payload);
      return true;
    } catch (error) {
      throw toMikroTikError("create hotspot user", error);
    }
  }

  /**
   * Remove a hotspot user
   */
  async removeHotspotUser(username: string): Promise<boolean> {
    try {
      const user = await this.findHotspotUser(username);
      if (!user?.id) {
        return false;
      }

      await this.getApi().menu("/ip hotspot user").remove(user.id);
      return true;
    } catch (error) {
      throw toMikroTikError("remove hotspot user", error);
    }
  }

  /**
   * Update a hotspot user's password
   */
  async updateHotspotUserPassword(
    username: string,
    newPassword: string
  ): Promise<boolean> {
    try {
      const user = await this.findHotspotUser(username);
      if (!user?.id) {
        throw new Error(`Hotspot user not found: ${username}`);
      }

      await this.getApi()
        .menu("/ip hotspot user")
        .update({ password: newPassword }, user.id);
      return true;
    } catch (error) {
      throw toMikroTikError("update hotspot user password", error);
    }
  }

  /**
   * Get hotspot user details
   */
  async getHotspotUser(username: string): Promise<any> {
    try {
      return await this.findHotspotUser(username);
    } catch (error) {
      throw toMikroTikError("get hotspot user", error);
    }
  }

  /**
   * Add MAC address binding to a hotspot user.
   */
  async addMacBinding(
    username: string,
    macAddress: string
  ): Promise<boolean> {
    try {
      const user = await this.findHotspotUser(username);
      if (!user?.id) {
        throw new Error(`Hotspot user not found: ${username}`);
      }

      await this.getApi()
        .menu("/ip hotspot user")
        .update({ macAddress }, user.id);
      return true;
    } catch (error) {
      throw toMikroTikError("add MAC binding", error);
    }
  }

  /**
   * Remove MAC address binding
   */
  async removeMacBinding(
    username: string,
    macAddress: string
  ): Promise<boolean> {
    try {
      const user = await this.findHotspotUser(username);
      if (!user?.id) {
        throw new Error(`Hotspot user not found: ${username}`);
      }

      await this.getApi()
        .menu("/ip hotspot user")
        .update({ macAddress: "" }, user.id);
      return true;
    } catch (error) {
      throw toMikroTikError("remove MAC binding", error);
    }
  }

  /**
   * Get active connections
   */
  async getActiveConnections(): Promise<any[]> {
    try {
      return await this.getApi()
        .menu("/ip hotspot active")
        .select(["id", "user", "macAddress", "address", "uptime"])
        .get();
    } catch (error) {
      throw toMikroTikError("get active connections", error);
    }
  }

  async getActiveConnectionsForUser(username: string): Promise<HotspotSession[]> {
    try {
      const sessions = (await this.getApi()
        .menu("/ip hotspot active")
        .select(["id", "user", "macAddress", "address", "uptime"])
        .where("user", username)
        .get()) as RouterOSItem[];

      return sessions
        .filter((session) => session.id && session.macAddress)
        .map((session) => ({
          id: session.id,
          user: session.user,
          macAddress: session.macAddress,
          address: session.address,
          uptime: session.uptime,
        }));
    } catch (error) {
      throw toMikroTikError("get active connections for user", error);
    }
  }

  /**
   * Find the active Hotspot session for a user, preferring the request IP.
   */
  async getActiveConnectionForUser(
    username: string,
    ipAddress?: string
  ): Promise<RouterOSItem | null> {
    try {
      const sessions = await this.getActiveConnectionsForUser(username);

      if (!sessions.length) {
        return null;
      }

      const matchingIp = sessions.find(
        (session) => ipAddress && session.address === ipAddress
      );
      if (matchingIp) {
        return matchingIp;
      }

      return sessions.length === 1 ? sessions[0] ?? null : null;
    } catch (error) {
      throw toMikroTikError("get active connection for user", error);
    }
  }

  /**
   * Find a device MAC address by IP from common RouterOS network tables.
   */
  async getMacAddressByIp(ipAddress: string): Promise<string | null> {
    if (!ipAddress || ipAddress === "127.0.0.1" || ipAddress === "::1") {
      return null;
    }

    try {
      const hotspotHost = await this.findByIp("/ip hotspot host", ipAddress, [
        "id",
        "address",
        "macAddress",
      ]);
      if (hotspotHost?.macAddress) {
        return hotspotHost.macAddress;
      }

      const dhcpLease = await this.findByIp("/ip dhcp-server lease", ipAddress, [
        "id",
        "address",
        "macAddress",
        "activeMacAddress",
        "activeAddress",
      ]);
      if (dhcpLease?.activeMacAddress) {
        return dhcpLease.activeMacAddress;
      }
      if (dhcpLease?.macAddress) {
        return dhcpLease.macAddress;
      }

      const arp = await this.findByIp("/ip arp", ipAddress, [
        "id",
        "address",
        "macAddress",
      ]);
      if (arp?.macAddress) {
        return arp.macAddress;
      }

      return null;
    } catch (error) {
      throw toMikroTikError("get MAC address by IP", error);
    }
  }

  /**
   * Disconnect a user session
   */
  async disconnectUser(username: string): Promise<boolean> {
    try {
      const sessions = await this.getActiveConnectionsForUser(username);

      for (const session of sessions) {
        if (session.id) {
          await this.disconnectSession(session.id);
        }
      }

      return sessions.length > 0;
    } catch (error) {
      throw toMikroTikError("disconnect hotspot user", error);
    }
  }

  async disconnectSession(sessionId: string): Promise<boolean> {
    try {
      await this.getApi().menu("/ip hotspot active").remove(sessionId);
      return true;
    } catch (error) {
      throw toMikroTikError("disconnect hotspot session", error);
    }
  }

  async disconnectMac(username: string, macAddress: string): Promise<boolean> {
    try {
      const sessions = await this.getActiveConnectionsForUser(username);
      const matchingSessions = sessions.filter(
        (session) =>
          normalizeMac(session.macAddress) === normalizeMac(macAddress)
      );

      for (const session of matchingSessions) {
        await this.disconnectSession(session.id);
      }

      return matchingSessions.length > 0;
    } catch (error) {
      throw toMikroTikError("disconnect hotspot MAC", error);
    }
  }

  /**
   * Set user bandwidth limit
   */
  async setBandwidthLimit(
    username: string,
    upLimit: number,
    downLimit: number
  ): Promise<boolean> {
    try {
      const user = await this.findHotspotUser(username);
      if (!user?.id) {
        throw new Error(`Hotspot user not found: ${username}`);
      }

      await this.getApi()
        .menu("/ip hotspot user")
        .update(
          {
            limitUptime: upLimit,
            limitBytesTotal: downLimit,
          },
          user.id
        );
      return true;
    } catch (error) {
      throw toMikroTikError("set bandwidth limit", error);
    }
  }

  /**
   * Enable/Disable user
   */
  async setUserEnabled(username: string, enabled: boolean): Promise<boolean> {
    try {
      const user = await this.findHotspotUser(username);
      if (!user?.id) {
        throw new Error(`Hotspot user not found: ${username}`);
      }

      await this.getApi()
        .menu("/ip hotspot user")
        .update({ disabled: !enabled }, user.id);
      return true;
    } catch (error) {
      throw toMikroTikError("set hotspot user status", error);
    }
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return Boolean(this.client?.isConnected() && this.api);
  }

  private async findHotspotUser(username: string): Promise<RouterOSItem | null> {
    const user = await this.getApi()
      .menu("/ip hotspot user")
      .select(["id", "name", "profile", "disabled", "macAddress"])
      .where("name", username)
      .getOnly();

    return (user as RouterOSItem | null) || null;
  }

  private async findByIp(
    menu: string,
    ipAddress: string,
    fields: string[]
  ): Promise<RouterOSItem | null> {
    const result = await this.getApi()
      .menu(menu)
      .select(fields)
      .where("address", ipAddress)
      .getOnly();

    return (result as RouterOSItem | null) || null;
  }

  private getApi(): RosApiMenu {
    if (!this.api) {
      throw new Error("Not connected to MikroTik");
    }

    return this.api;
  }
}

function toMikroTikError(action: string, error: unknown): MikroTikError {
  if (error instanceof MikroTikError) {
    return error;
  }

  const diagnostic = formatDiagnostic(error);
  const normalized = diagnostic.toLowerCase();

  if (normalized.includes("timed out") || normalized.includes("timeout")) {
    return new MikroTikError(
      "MIKROTIK_TIMEOUT",
      "Router connection timed out. Check the router IP, API port, and firewall.",
      `${action}: ${diagnostic}`
    );
  }

  if (
    normalized.includes("econnrefused") ||
    normalized.includes("ehostunreach") ||
    normalized.includes("enetunreach") ||
    normalized.includes("enotfound")
  ) {
    return new MikroTikError(
      "MIKROTIK_UNREACHABLE",
      "Router API is unreachable. Check the router address and API service.",
      `${action}: ${diagnostic}`
    );
  }

  if (
    normalized.includes("invalid user") ||
    normalized.includes("invalid password") ||
    normalized.includes("login") ||
    normalized.includes("authentication")
  ) {
    return new MikroTikError(
      "MIKROTIK_AUTH_FAILED",
      "Router authentication failed. Check the MikroTik username and password.",
      `${action}: ${diagnostic}`
    );
  }

  return new MikroTikError(
    "MIKROTIK_API_ERROR",
    "Router API request failed. Check the router API settings and permissions.",
    `${action}: ${diagnostic}`
  );
}

function formatDiagnostic(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function normalizeMac(macAddress: string): string {
  return macAddress.trim().toUpperCase();
}

// Export singleton instance manager
let clientInstance: MikroTikClient | null = null;

export function initializeMikroTikClient(config: MikroTikConfig): MikroTikClient {
  clientInstance = new MikroTikClient(config);
  return clientInstance;
}

export function getMikroTikClient(): MikroTikClient {
  if (!clientInstance) {
    throw new Error(
      "MikroTik client not initialized. Call initializeMikroTikClient first."
    );
  }
  return clientInstance;
}
