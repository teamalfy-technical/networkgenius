/**
 * API Examples and Usage Patterns
 * 
 * This file demonstrates how to use the MikroTik APIs
 */

// ============ EXAMPLE 1: Register a User ============

const registerExample = async () => {
  const response = await fetch("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "john_doe",
      email: "john@example.com",
      password: "SecurePassword123",
      maxDevices: 2,
    }),
  });

  const data = (await response.json()) as any;
  console.log("Registration Response:", data);

  // Response:
  // {
  //   "success": true,
  //   "message": "User created successfully",
  //   "data": {
  //     "id": "user_xxx",
  //     "username": "john_doe",
  //     "email": "john@example.com",
  //     "isActive": true,
  //     "maxDevices": 2,
  //     "createdAt": "2024-01-15T10:30:00Z"
  //   }
  // }
};

// ============ EXAMPLE 2: Login ============

const loginExample = async () => {
  const response = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "john_doe",
      password: "SecurePassword123",
    }),
  });

  const data = (await response.json()) as any;
  const token = data.data.token;

  console.log("Login successful! Token:", token);

  // Store token for subsequent requests
  return token;
};

// ============ EXAMPLE 3: Get User Profile ============

const getProfileExample = async (token: string) => {
  const response = await fetch("http://localhost:3000/api/users/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();
  console.log("User Profile:", data);

  // Response:
  // {
  //   "success": true,
  //   "message": "Success",
  //   "data": {
  //     "id": "user_xxx",
  //     "username": "john_doe",
  //     "email": "john@example.com",
  //     "isActive": true,
  //     "maxDevices": 2,
  //     "deviceCount": 2,
  //     "connectedCount": 1,
  //     "createdAt": "2024-01-15T10:30:00Z"
  //   }
  // }
};

// ============ EXAMPLE 4: Register Device ============

const registerDeviceExample = async (token: string) => {
  const response = await fetch("http://localhost:3000/api/devices", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      deviceName: "My Laptop",
      // macAddress is optional. If omitted, the API detects it from
      // the current MikroTik Hotspot active session for this user.
    }),
  });

  const data = await response.json();
  console.log("Device Registered:", data);

  // Response:
  // {
  //   "success": true,
  //   "message": "Device registered successfully",
  //   "data": {
  //     "id": "device_xxx",
  //     "deviceName": "My Laptop",
  //     "macAddress": "AA:BB:CC:DD:EE:FF",
  //     "isConnected": false,
  //     "createdAt": "2024-01-15T10:35:00Z"
  //   }
  // }
};

// ============ EXAMPLE 5: Get User Devices ============

const getDevicesExample = async (token: string) => {
  const response = await fetch("http://localhost:3000/api/devices", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();
  console.log("User Devices:", data);

  // Response:
  // {
  //   "success": true,
  //   "message": "Success",
  //   "data": [
  //     {
  //       "id": "device_xxx",
  //       "deviceName": "My Laptop",
  //       "macAddress": "AA:BB:CC:DD:EE:FF",
  //       "ipAddress": null,
  //       "isConnected": false,
  //       "connectedAt": null,
  //       "createdAt": "2024-01-15T10:35:00Z"
  //     },
  //     {
  //       "id": "device_yyy",
  //       "deviceName": "My Phone",
  //       "macAddress": "11:22:33:44:55:66",
  //       "ipAddress": "192.168.1.100",
  //       "isConnected": true,
  //       "connectedAt": "2024-01-15T10:40:00Z",
  //       "createdAt": "2024-01-15T10:36:00Z"
  //     }
  //   ]
  // }
};

// ============ EXAMPLE 6: Connect Device ============

const connectDeviceExample = async (token: string) => {
  const response = await fetch("http://localhost:3000/api/devices/connect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      macAddress: "AA:BB:CC:DD:EE:FF",
      ipAddress: "192.168.1.100",
    }),
  });

  const data = await response.json();
  console.log("Device Connected:", data);

  // Response:
  // {
  //   "success": true,
  //   "message": "Device connected successfully",
  //   "data": {
  //     "id": "device_xxx",
  //     "deviceName": "My Laptop",
  //     "isConnected": true,
  //     "connectedAt": "2024-01-15T10:40:00Z"
  //   }
  // }
};

// ============ EXAMPLE 7: Disconnect Device ============

const disconnectDeviceExample = async (token: string, deviceId: string) => {
  const response = await fetch(
    `http://localhost:3000/api/devices/${deviceId}/disconnect`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await response.json();
  console.log("Device Disconnected:", data);

  // Response:
  // {
  //   "success": true,
  //   "message": "Device disconnected successfully",
  //   "data": {
  //     "id": "device_xxx",
  //     "deviceName": "My Laptop",
  //     "isConnected": false,
  //     "disconnectedAt": "2024-01-15T10:45:00Z"
  //   }
  // }
};

// ============ EXAMPLE 8: Change Password ============

const changePasswordExample = async (token: string) => {
  const response = await fetch(
    "http://localhost:3000/api/users/change-password",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        oldPassword: "SecurePassword123",
        newPassword: "NewSecurePassword456",
      }),
    }
  );

  const data = await response.json();
  console.log("Password Changed:", data);

  // Response:
  // {
  //   "success": true,
  //   "message": "Password changed successfully"
  // }
};

// ============ EXAMPLE 9: Update Profile ============

const updateProfileExample = async (token: string) => {
  const response = await fetch("http://localhost:3000/api/users/me", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: "newemail@example.com",
      isActive: true,
    }),
  });

  const data = await response.json();
  console.log("Profile Updated:", data);

  // Response:
  // {
  //   "success": true,
  //   "message": "Profile updated successfully",
  //   "data": {
  //     "id": "user_xxx",
  //     "username": "john_doe",
  //     "email": "newemail@example.com",
  //     "isActive": true,
  //     "maxDevices": 2
  //   }
  // }
};

// ============ EXAMPLE 10: Delete Device ============

const deleteDeviceExample = async (token: string, deviceId: string) => {
  const response = await fetch(
    `http://localhost:3000/api/devices/${deviceId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await response.json();
  console.log("Device Deleted:", data);

  // Response:
  // {
  //   "success": true,
  //   "message": "Device deleted successfully"
  // }
};

// ============ COMPLETE WORKFLOW EXAMPLE ============

const completeWorkflow = async () => {
  try {
    console.log("🚀 Starting API workflow example...\n");

    // 1. Register a new user
    console.log("1️⃣ Registering new user...");
    await registerExample();

    // 2. Login to get token
    console.log("\n2️⃣ Logging in...");
    const token = await loginExample();

    // 3. Get user profile
    console.log("\n3️⃣ Getting user profile...");
    await getProfileExample(token);

    // 4. Register a device
    console.log("\n4️⃣ Registering device...");
    await registerDeviceExample(token);

    // 5. Get user devices
    console.log("\n5️⃣ Getting user devices...");
    await getDevicesExample(token);

    // 6. Connect device
    console.log("\n6️⃣ Connecting device...");
    await connectDeviceExample(token);

    // 7. Update profile
    console.log("\n7️⃣ Updating profile...");
    await updateProfileExample(token);

    // 8. Change password
    console.log("\n8️⃣ Changing password...");
    await changePasswordExample(token);

    console.log("\n✅ Workflow complete!");
  } catch (error) {
    console.error("❌ Error:", error);
  }
};

// Run the workflow if this file is executed directly
// Uncomment to test:
// completeWorkflow();

// ============ KEY CONCEPTS ============

/*
JWT TOKEN:
- Obtained from /api/auth/login endpoint
- Valid for 24 hours
- Must be included in Authorization header: Bearer <token>
- Used to authenticate all protected endpoints

DEVICE LIMIT:
- Each user can have maximum 2 simultaneously connected devices
- When 3rd device tries to connect, oldest is automatically disconnected
- Multiple devices can be registered, but only 2 can be active at once

ERROR RESPONSES:
401: Unauthorized (missing or invalid token)
400: Bad Request (validation error)
404: Not Found (resource doesn't exist)
500: Server Error (unexpected error)

AUDIT LOGGING:
- All operations are logged with timestamp and user info
- Useful for troubleshooting and compliance
- Available via admin endpoints
*/
