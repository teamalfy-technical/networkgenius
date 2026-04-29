import type { Context } from "elysia";
import type { UserPayload, LoginPayload, UpdateUserPayload } from "../types";
import { UserService } from "../services/userService";
import { createToken, getCurrentUser, getClientIp } from "../middleware/auth";
import { successResponse, errorResponse } from "../middleware/response";

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

      const user = await UserService.createUser(body, ip);

      context.set.status = 201;
      return successResponse(
        {
          id: user.id,
          username: user.username,
          email: user.email,
          isActive: user.isActive,
          maxDevices: user.maxDevices,
          createdAt: user.createdAt,
        },
        "User created successfully"
      );
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(error.message || "Registration failed");
    }
  },

  /**
   * Login user
   * POST /api/users/login
   */
  login: async (context: Context) => {
    try {
      const body = (await context.request.json()) as LoginPayload;

      if (!body.username || !body.password) {
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

      const token = createToken(user.id, user.username);

      return successResponse(
        {
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            isActive: user.isActive,
            maxDevices: user.maxDevices,
          },
        },
        "Login successful"
      );
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(error.message || "Login failed");
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
        deviceCount,
        connectedCount,
        createdAt: userData.createdAt,
      });
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(error.message || "Failed to get profile");
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
        createdAt: user.createdAt,
      });
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(error.message || "Failed to get user");
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

      const updated = await UserService.updateUser(user.userId, body, ip);

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
      return errorResponse(error.message || "Update failed");
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

      await UserService.changePassword(
        user.userId,
        body.oldPassword,
        body.newPassword,
        ip
      );

      return successResponse(null, "Password changed successfully");
    } catch (error: any) {
      context.set.status = 400;
      return errorResponse(error.message || "Password change failed");
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
          createdAt: u.createdAt,
        }))
      );
    } catch (error: any) {
      context.set.status = 500;
      return errorResponse(error.message || "Failed to get users");
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
      return errorResponse(error.message || "Delete failed");
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
      return errorResponse(error.message || "Status update failed");
    }
  },
};
