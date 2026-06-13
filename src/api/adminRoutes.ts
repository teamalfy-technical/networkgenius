import type { Context } from "elysia";
import { getClientIp, getCurrentUser } from "../middleware/auth";
import {
  errorResponse,
  safeErrorMessage,
  successResponse,
} from "../middleware/response";
import { AdminService } from "../services/adminService";
import { DeviceService } from "../services/deviceService";

type RouteContext = Omit<Context, "params"> & {
  params: Record<string, string | undefined>;
};

export const adminRoutes = {
  getDevices: async (
    context: Context & { query?: Record<string, string | undefined> }
  ) => {
    try {
      const rawStatus = context.query?.status || "all";
      if (!["all", "connected", "disconnected"].includes(rawStatus)) {
        context.set.status = 400;
        return errorResponse("Invalid device status", "Validation Error");
      }

      return successResponse(
        await AdminService.getAllDevices(
          rawStatus as "all" | "connected" | "disconnected"
        )
      );
    } catch (error) {
      context.set.status = 500;
      return errorResponse(
        safeErrorMessage(error, "Failed to get all devices")
      );
    }
  },

  getSessions: async (context: Context) => {
    try {
      return successResponse(await AdminService.getAllActiveSessions());
    } catch (error) {
      context.set.status = 500;
      return errorResponse(
        safeErrorMessage(error, "Failed to get active sessions")
      );
    }
  },

  disconnectSession: async (context: RouteContext) => {
    try {
      const actor = getCurrentUser(context);
      const sessionId = context.params.sessionId;
      if (!actor || !sessionId) {
        context.set.status = 400;
        return errorResponse("Missing session ID", "Validation Error");
      }

      const session = await AdminService.disconnectSession(
        sessionId,
        actor.userId,
        getClientIp(context)
      );
      return successResponse(session, "Session disconnected");
    } catch (error) {
      context.set.status = 400;
      return errorResponse(
        safeErrorMessage(error, "Failed to disconnect session")
      );
    }
  },

  disconnectDevice: async (context: RouteContext) => {
    try {
      const deviceId = context.params.deviceId;
      if (!deviceId) {
        context.set.status = 400;
        return errorResponse("Missing device ID", "Validation Error");
      }

      const device = await DeviceService.disconnectDevice(
        deviceId,
        getClientIp(context)
      );
      if (!device) {
        context.set.status = 404;
        return errorResponse("Device not found");
      }

      return successResponse(device, "Device disconnected");
    } catch (error) {
      context.set.status = 400;
      return errorResponse(
        safeErrorMessage(error, "Failed to disconnect device")
      );
    }
  },

  deleteDevice: async (context: RouteContext) => {
    try {
      const deviceId = context.params.deviceId;
      if (!deviceId) {
        context.set.status = 400;
        return errorResponse("Missing device ID", "Validation Error");
      }

      await DeviceService.deleteDevice(deviceId, getClientIp(context));
      return successResponse(null, "Device deleted");
    } catch (error) {
      context.set.status = 400;
      return errorResponse(
        safeErrorMessage(error, "Failed to delete device")
      );
    }
  },
};
