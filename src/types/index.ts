export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  maxDevices: number;
}

export interface Device {
  id: string;
  userId: string;
  deviceName: string;
  macAddress: string;
  ipAddress?: string;
  isConnected: boolean;
  connectedAt?: string;
  disconnectedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionToken {
  userId: string;
  macAddress: string;
  createdAt: string;
  expiresAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface UserPayload {
  username: string;
  email: string;
  password: string;
  hotspotPassword?: string;
  maxDevices?: number;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface DevicePayload {
  deviceName: string;
  macAddress?: string;
  ipAddress?: string;
}

export interface UpdateUserPayload {
  email?: string;
  isActive?: boolean;
  maxDevices?: number;
}

export interface MikroTikConfig {
  host: string;
  user: string;
  password: string;
  port?: number;
}
