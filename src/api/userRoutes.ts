import type { Context } from "elysia";
import type { UserPayload, LoginPayload, UpdateUserPayload } from "../types";
import { UserService } from "../services/userService";
import { createToken, getCurrentUser, getClientIp } from "../middleware/auth";
import {
  successResponse,
  errorResponse,
  safeErrorMessage,
} from "../middleware/response";

type RouteContext = Omit<Context, "params"> & {
  params: Record<string, string | undefined>;
};

export const userRoutes = {
  /**
   * Register new user
   * POST /api/users/register
   */
  register: async (context: Context) => {
    try {
      const body = (await context.request.json()) as UserPayload;
      const ip = getClientIp(context);

      // Validate input
      if (!body.username || !body.email || !body.password) {
        context.set.status = 400;
        return errorResponse("Missing required fields", "Validation Error");
      }

      if (body.password.length < 8) {
        context.set.status = 400;
        return errorResponse(
          "Password must be at least 8 characters",
          "Validation Error"
        );
      }
      if (body.password.length > 128) {
        context.set.status = 400;
        return errorResponse(
          "Password must not exceed 128 characters",
          "Validation Error"
        );
      }
      if (
        body.hotspotPassword &&
        (body.hotspotPassword.length < 8 || body.hotspotPassword.length > 128)
      ) {
        context.set.status = 400;
        return errorResponse(
          "Hotspot password must be 8-128 characters",
          "Validation Error"
        );
      }
      if (
        body.maxDevices !== undefined &&
        (!Number.isInteger(body.maxDevices) ||
          body.maxDevices < 1 ||
          body.maxDevices > 20)
      ) {
        context.set.status = 400;
        return errorResponse(
          "maxDevices must be an integer between 1 and 20",
          "Validation Error"
        );
      }
      if (
        body.role !== undefined &&
        body.role !== "user" &&
        body.role !== "super_admin"
      ) {
        context.set.status = 400;
        return errorResponse("Invalid user role", "Validation Error");
      }

      const user = await UserService.createUser(body, ip);

      context.set.status = 201;
      return successResponse(
        {
          id: user.id,
          username: user.username,
          email: user.email,
          isActive: user.isActive,
          maxDevices: user.maxDevices,
          role: user.role,
          createdAt: user.createdAt,
        },
        "User created successfully"
      );
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(safeErrorMessage(error, "Registration failed"));
    }
  },

  /**
   * Login user
   * POST /api/users/login
   */
  login: async (context: Context) => {
    try {
      const body = (await context.request.json()) as LoginPayload;

      if (
        !body.username ||
        !body.password ||
        body.username.length > 32 ||
        body.password.length > 128
      ) {
        context.set.status = 400;
        return errorResponse("Missing credentials", "Validation Error");
      }

      const user = await UserService.authenticateUser(
        body.username,
        body.password
      );

      if (!user) {
        context.set.status = 401;
        return errorResponse("Invalid credentials");
      }

      const token = createToken(user.id, user.username, user.role);

      return successResponse(
        {
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            isActive: user.isActive,
            maxDevices: user.maxDevices,
            role: user.role,
          },
        },
        "Login successful"
      );
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(safeErrorMessage(error, "Login failed"));
    }
  },

  /**
   * Get current user profile
   * GET /api/users/me
   */
  getProfile: async (context: Context) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const userData = await UserService.getUser(user.userId);
      if (!userData) {
        context.set.status = 404;
        return errorResponse("User not found");
      }

      const deviceCount = await UserService.getUserDeviceCount(user.userId);
      const connectedCount = await UserService.getUserConnectedDeviceCount(user.userId);

      return successResponse({
        id: userData.id,
        username: userData.username,
        email: userData.email,
        isActive: userData.isActive,
        maxDevices: userData.maxDevices,
        role: userData.role,
        deviceCount,
        connectedCount,
        createdAt: userData.createdAt,
      });
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(safeErrorMessage(error, "Failed to get profile"));
    }
  },

  /**
   * Get user by ID (admin only)
   * GET /api/users/:userId
   */
  getUser: async (context: RouteContext) => {
    try {
      const userId = context.params.userId;
      if (!userId) {
        context.set.status = 400;
        return errorResponse("Missing user ID", "Validation Error");
      }
      const user = await UserService.getUser(userId);

      if (!user) {
        context.set.status = 404;
        return errorResponse("User not found");
      }

      return successResponse({
        id: user.id,
        username: user.username,
        email: user.email,
        isActive: user.isActive,
        maxDevices: user.maxDevices,
        role: user.role,
        createdAt: user.createdAt,
      });
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(safeErrorMessage(error, "Failed to get user"));
    }
  },

  /**
   * Update user profile
   * PUT /api/users/me
   */
  updateProfile: async (context: Context) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const body = (await context.request.json()) as UpdateUserPayload;
      const ip = getClientIp(context);
      const updates: UpdateUserPayload = {};
      if (body.email !== undefined) {
        if (typeof body.email !== "string") {
          context.set.status = 400;
          return errorResponse("Invalid email", "Validation Error");
        }
        updates.email = body.email;
      }

      const updated = await UserService.updateUser(user.userId, updates, ip);

      if (!updated) {
        context.set.status = 404;
        return errorResponse("User not found");
      }

      return successResponse(
        {
          id: updated.id,
          username: updated.username,
          email: updated.email,
          isActive: updated.isActive,
          maxDevices: updated.maxDevices,
        },
        "Profile updated successfully"
      );
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(safeErrorMessage(error, "Update failed"));
    }
  },

  /**
   * Change password
   * POST /api/users/change-password
   */
  changePassword: async (context: Context) => {
    try {
      const user = getCurrentUser(context);
      if (!user) {
        context.set.status = 401;
        return errorResponse("Unauthorized");
      }

      const body = (await context.request.json()) as {
        oldPassword: string;
        newPassword: string;
      };
      const ip = getClientIp(context);

      if (!body.oldPassword || !body.newPassword) {
        context.set.status = 400;
        return errorResponse("Missing password fields", "Validation Error");
      }

      if (body.newPassword.length < 8) {
        context.set.status = 400;
        return errorResponse(
          "New password must be at least 8 characters",
          "Validation Error"
        );
      }
      if (body.oldPassword.length > 128 || body.newPassword.length > 128) {
        context.set.status = 400;
        return errorResponse(
          "Password must not exceed 128 characters",
          "Validation Error"
        );
      }

      await UserService.changePassword(
        user.userId,
        body.oldPassword,
        body.newPassword,
        ip
      );

      return successResponse(null, "Password changed successfully");
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(safeErrorMessage(error, "Password change failed"));
    }
  },

  /**
   * Get all users (admin only)
   * GET /api/users
   */
  getAllUsers: async (context: Context) => {
    try {
      const users = await UserService.getAllUsers();

      return successResponse(
        users.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          isActive: u.isActive,
          maxDevices: u.maxDevices,
          role: u.role,
          createdAt: u.createdAt,
        }))
      );
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(safeErrorMessage(error, "Failed to get users"));
    }
  },

  /**
   * Delete user (admin only)
   * DELETE /api/users/:userId
   */
  deleteUser: async (context: RouteContext) => {
    try {
      const userId = context.params.userId;
      if (!userId) {
        context.set.status = 400;
        return errorResponse("Missing user ID", "Validation Error");
      }
      const ip = getClientIp(context);

      await UserService.deleteUser(userId, ip);

      return successResponse(null, "User deleted successfully");
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(safeErrorMessage(error, "Delete failed"));
    }
  },

  /**
   * Toggle user status
   * PUT /api/users/:userId/status
   */
  toggleUserStatus: async (context: RouteContext) => {
    try {
      const userId = context.params.userId;
      if (!userId) {
        context.set.status = 400;
        return errorResponse("Missing user ID", "Validation Error");
      }
      const body = (await context.request.json()) as { isActive: boolean };
      if (typeof body.isActive !== "boolean") {
        context.set.status = 400;
        return errorResponse("isActive must be a boolean", "Validation Error");
      }
      const ip = getClientIp(context);

      const updated = await UserService.toggleUserStatus(
        userId,
        body.isActive,
        ip
      );

      if (!updated) {
        context.set.status = 404;
        return errorResponse("User not found");
      }

      return successResponse(
        {
          id: updated.id,
          username: updated.username,
          isActive: updated.isActive,
        },
        "User status updated"
      );
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(safeErrorMessage(error, "Status update failed"));
    }
  },

  mikrotikLogin: async (context: Context) => {
    try {
      const body = (await context.request.json()) as {
        username: string;
        password: string;
        email?: string;
      };
      if (
        !body.username ||
        !body.password ||
        body.username.length > 32 ||
        body.password.length > 128
      ) {
        context.set.status = 400;
        return errorResponse("Missing credentials", "Validation Error");
      }

      const user = await UserService.authenticateMikroTikSuperAdmin(
        body.username,
        body.password,
        body.email,
        getClientIp(context)
      );
      const token = createToken(user.id, user.username, user.role);
      return successResponse(
        {
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
          },
        },
        "MikroTik super-admin login successful"
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "Email is required for first MikroTik admin login" ||
          error.message === "Email already exists")
      ) {
        context.set.status = 400;
        return errorResponse(error.message, "Validation Error");
      }
      context.set.status = 401;
      return errorResponse("Invalid MikroTik credentials");
    }
  },

  /**
   * Change a user's maximum concurrent HotSpot devices (admin only)
   * PUT /api/users/:userId/device-limit
   */
  updateDeviceLimit: async (context: RouteContext) => {
    try {
      const userId = context.params.userId;
      if (!userId) {
        context.set.status = 400;
        return errorResponse("Missing user ID", "Validation Error");
      }

      const body = (await context.request.json()) as { maxDevices: number };
      if (
        !Number.isInteger(body.maxDevices) ||
        body.maxDevices < 1 ||
        body.maxDevices > 20
      ) {
        context.set.status = 400;
        return errorResponse(
          "maxDevices must be an integer between 1 and 20",
          "Validation Error"
        );
      }

      const updated = await UserService.updateUser(
        userId,
        { maxDevices: body.maxDevices },
        getClientIp(context)
      );
      if (!updated) {
        context.set.status = 404;
        return errorResponse("User not found");
      }

      return successResponse(
        {
          id: updated.id,
          username: updated.username,
          maxDevices: updated.maxDevices,
        },
        "Device limit updated"
      );
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(
        safeErrorMessage(error, "Device limit update failed")
      );
    }
  },

  updateRole: async (context: RouteContext) => {
    try {
      const userId = context.params.userId;
      const body = (await context.request.json()) as {
        role: "user" | "super_admin";
      };
      if (
        !userId ||
        (body.role !== "user" && body.role !== "super_admin")
      ) {
        context.set.status = 400;
        return errorResponse("Invalid user role", "Validation Error");
      }

      const updated = await UserService.updateUserRole(
        userId,
        body.role,
        getClientIp(context)
      );
      if (!updated) {
        context.set.status = 404;
        return errorResponse("User not found");
      }

      return successResponse(
        {
          id: updated.id,
          username: updated.username,
          role: updated.role,
        },
        "User role updated"
      );
    } catch (error) {
      context.set.status = 400;
      return errorResponse(safeErrorMessage(error, "Role update failed"));
    }
  },
};
