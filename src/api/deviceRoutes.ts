import type { Context } from "elysia";
import type { DevicePayload } from "../types";
import { DeviceService } from "../services/deviceService";
import { getCurrentUser, getClientIp } from "../middleware/auth";
import { successResponse, errorResponse } from "../middleware/response";

type RouteContext = Omit<Context, "params"> & {
  params: Record<string, string | undefined>;
};

export const deviceRoutes = {
  /**
   * Get live HotSpot session usage for the current user
   * GET /api/devices/sessions
   */
  getSessionStatus: async (context: Context) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const status = await DeviceService.getSessionStatus(user.userId);
      return successResponse(status);
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(error.message || "Failed to get active sessions");
    }
  },

  /**
   * Register new device for user
   * POST /api/devices
   */
  registerDevice: async (context: Context) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const body = (await context.request.json()) as DevicePayload;
      const ip = getClientIp(context);

      // Validate input
      if (!body.deviceName) {
        context.set.status = 400;
        return errorResponse("Missing required fields", "Validation Error");
      }

      const device = await DeviceService.registerDevice(user.userId, body, ip);

      context.set.status = 201;
      return successResponse(
        {
          id: device.id,
          deviceName: device.deviceName,
          macAddress: device.macAddress,
          isConnected: device.isConnected,
          createdAt: device.createdAt,
        },
        "Device registered successfully"
      );
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(error.message || "Registration failed");
    }
  },

  /**
   * Get user's devices
   * GET /api/devices
   */
  getUserDevices: async (context: Context) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const devices = await DeviceService.getUserDevices(user.userId);

      return successResponse(
        devices.map((d) => ({
          id: d.id,
          deviceName: d.deviceName,
          macAddress: d.macAddress,
          ipAddress: d.ipAddress,
          isConnected: d.isConnected,
          connectedAt: d.connectedAt,
          disconnectedAt: d.disconnectedAt,
          createdAt: d.createdAt,
        }))
      );
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(error.message || "Failed to get devices");
    }
  },

  /**
   * Get device by ID
   * GET /api/devices/:deviceId
   */
  getDevice: async (context: RouteContext) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const deviceId = context.params.deviceId;
      if (!deviceId) {
        context.set.status = 400;
        return errorResponse("Missing device ID", "Validation Error");
      }
      const device = await DeviceService.getDevice(deviceId);

      if (!device || device.userId !== user.userId) {
        context.set.status = 404;
        return errorResponse("Device not found");
      }

      return successResponse({
        id: device.id,
        deviceName: device.deviceName,
        macAddress: device.macAddress,
        ipAddress: device.ipAddress,
        isConnected: device.isConnected,
        connectedAt: device.connectedAt,
        disconnectedAt: device.disconnectedAt,
        createdAt: device.createdAt,
      });
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(error.message || "Failed to get device");
    }
  },

  /**
   * Update device
   * PUT /api/devices/:deviceId
   */
  updateDevice: async (context: RouteContext) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const deviceId = context.params.deviceId;
      if (!deviceId) {
        context.set.status = 400;
        return errorResponse("Missing device ID", "Validation Error");
      }
      const device = await DeviceService.getDevice(deviceId);

      if (!device || device.userId !== user.userId) {
        context.set.status = 404;
        return errorResponse("Device not found");
      }

      const body = (await context.request.json()) as Partial<DevicePayload>;
      const ip = getClientIp(context);

      const updated = await DeviceService.updateDevice(deviceId, body, ip);

      if (!updated) {
        context.set.status = 404;
        return errorResponse("Device not found");
      }

      return successResponse(
        {
          id: updated.id,
          deviceName: updated.deviceName,
          macAddress: updated.macAddress,
          ipAddress: updated.ipAddress,
        },
        "Device updated successfully"
      );
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(error.message || "Update failed");
    }
  },

  /**
   * Delete device
   * DELETE /api/devices/:deviceId
   */
  deleteDevice: async (context: RouteContext) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const deviceId = context.params.deviceId;
      if (!deviceId) {
        context.set.status = 400;
        return errorResponse("Missing device ID", "Validation Error");
      }
      const device = await DeviceService.getDevice(deviceId);

      if (!device || device.userId !== user.userId) {
        context.set.status = 404;
        return errorResponse("Device not found");
      }

      const ip = getClientIp(context);
      await DeviceService.deleteDevice(deviceId, ip);

      return successResponse(null, "Device deleted successfully");
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(error.message || "Delete failed");
    }
  },

  /**
   * Device connect (user logs in)
   * POST /api/devices/connect
   */
  connectDevice: async (context: Context) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const body = (await context.request.json()) as {
        macAddress: string;
        ipAddress: string;
      };
      const ip = getClientIp(context);

      // Check if can connect
      if (!(await DeviceService.canDeviceConnect(user.userId))) {
        // Enforce device limit
        await DeviceService.enforceDeviceLimit(user.userId, ip);
      }

      const device = await DeviceService.connectDevice(
        user.userId,
        body.macAddress,
        body.ipAddress,
        ip
      );

      if (!device) {
        context.set.status = 404;
        return errorResponse("Device not found");
      }

      return successResponse(
        {
          id: device.id,
          deviceName: device.deviceName,
          isConnected: device.isConnected,
          connectedAt: device.connectedAt,
        },
        "Device connected successfully"
      );
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(error.message || "Connect failed");
    }
  },

  /**
   * Device disconnect
   * POST /api/devices/:deviceId/disconnect
   */
  disconnectDevice: async (context: RouteContext) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const deviceId = context.params.deviceId;
      if (!deviceId) {
        context.set.status = 400;
        return errorResponse("Missing device ID", "Validation Error");
      }
      const device = await DeviceService.getDevice(deviceId);

      if (!device || device.userId !== user.userId) {
        context.set.status = 404;
        return errorResponse("Device not found");
      }

      const ip = getClientIp(context);
      const updated = await DeviceService.disconnectDevice(deviceId, ip);

      return successResponse(
        {
          id: updated!.id,
          deviceName: updated!.deviceName,
          isConnected: updated!.isConnected,
          disconnectedAt: updated!.disconnectedAt,
        },
        "Device disconnected successfully"
      );
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(error.message || "Disconnect failed");
    }
  },

  /**
   * Get connected devices for user
   * GET /api/devices/connected
   */
  getConnectedDevices: async (context: Context) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const devices = await DeviceService.getConnectedDevices(user.userId);

      return successResponse(
        devices.map((d) => ({
          id: d.id,
          deviceName: d.deviceName,
          macAddress: d.macAddress,
          ipAddress: d.ipAddress,
          connectedAt: d.connectedAt,
        }))
      );
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(error.message || "Failed to get connected devices");
    }
  },
};
