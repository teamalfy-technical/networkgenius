# MikroTik Router Internet Access Management API

A comprehensive API for managing internet access through a MikroTik Hex S router with per-user authentication and device limitation (max 2 devices per user).

## Features

- ✅ **User Management** - Create, update, and delete users
- ✅ **Device Management** - Register and track devices per user
- ✅ **Device Limiting** - Maximum 2 active connections per user
- ✅ **Authentication** - JWT-based user authentication
- ✅ **Session Management** - Track active sessions and connections
- ✅ **MikroTik Integration** - Direct RouterOS API integration
- ✅ **Audit Logging** - Track all user and device actions
- ✅ **Bandwidth Control** - Set per-user bandwidth limits
- ✅ **Auto-Disconnection** - Enforce device limits automatically

## Quick Start

1. **Install dependencies**
```bash
bun install
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your MikroTik router details
```

3. **Start development server**
```bash
bun run dev
```

4. **Server runs at** `http://localhost:3000`

## Documentation

- [README.md](./README.md) - Main documentation
- [.env.example](./.env.example) - Environment configuration guide
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture and design

## API Quick Reference

### Authentication
- `POST /api/auth/mikrotik-login` - Primary super-admin login using RouterOS credentials
- `POST /api/auth/register` - Create account (super-admin JWT required)
- `POST /api/auth/login` - Login and get JWT token

### User Endpoints
- `GET /api/users/me` - Get current user profile
- `PUT /api/users/me` - Update profile
- `POST /api/users/change-password` - Change password
- `PUT /api/users/:userId/device-limit` - Change limit (super-admin JWT)

### Super-Admin Endpoints
- `GET /api/admin/devices?status=all` - All registered devices
- `GET /api/admin/devices?status=connected` - Connected devices
- `GET /api/admin/devices?status=disconnected` - Disconnected devices
- `GET /api/admin/sessions` - Every live MikroTik HotSpot session
- `POST /api/admin/sessions/:sessionId/disconnect` - Terminate any live session
- `POST /api/admin/devices/:deviceId/disconnect` - Disconnect any registered device
- `DELETE /api/admin/devices/:deviceId` - Delete any registered device
- `PUT /api/users/:userId/device-limit` - Change any user's device limit
- `PUT /api/users/:userId/status` - Enable or disable a user
- `PUT /api/users/:userId/role` - Promote or demote a user

### Device Endpoints
- `GET /api/devices` - Get user's devices
- `GET /api/devices/sessions` - Monitor live HotSpot sessions and limit usage
- `PUT /api/devices/:deviceId` - Rename an automatically discovered device
- `POST /api/devices/:deviceId/disconnect` - Disconnect device
- `DELETE /api/devices/:deviceId` - Delete device

## Project Structure

```
src/
├── api/                 # API route handlers
├── database/            # Database layer (PostgreSQL)
├── middleware/          # Authentication & response formatting
├── mikrotik/            # MikroTik RouterOS client
├── services/            # Business logic
└── types/               # TypeScript definitions
```

## Database

- **PostgreSQL** database configured with `DATABASE_URL`
- **Automatic schema** creation on first run
- **Audit logging** of all operations
- **Foreign key** constraints for data integrity

## Key Features

### Device Limitation
Each user defaults to **2 simultaneously connected devices**. Registration creates an API-managed MikroTik HotSpot user profile such as `api-devices-2`, with RouterOS `shared-users` set to the account's `maxDevices`. This makes the router enforce the limit even when a client logs in directly through the captive portal without calling the backend first.

Changing `maxDevices` moves the HotSpot user to the matching profile and disconnects excess live sessions.

### Live Session Monitoring
`GET /api/devices/sessions` reads `/ip hotspot active` and returns the current limit, unique active device count, remaining slots, MAC/IP addresses, uptime, traffic counters, and whether each MAC is registered:

```json
{
  "success": true,
  "data": {
    "maxDevices": 2,
    "activeDevices": 1,
    "remainingDevices": 1,
    "limitExceeded": false,
    "sessions": [
      {
        "deviceName": "Phone",
        "registered": true,
        "macAddress": "AA:BB:CC:DD:EE:FF",
        "ipAddress": "10.5.50.10",
        "uptime": "12m30s",
        "bytesIn": 12000,
        "bytesOut": 45000
      }
    ]
  }
}
```

### Automatic Device Discovery
Users do not register devices manually. The API polls MikroTik HotSpot active
sessions, matches the HotSpot username to the local account, and creates one
device history record per account and MAC address.

Each record stores connection state, current IP, first/last connection times,
last-seen time, and cumulative upload/download byte counters. RouterOS remains
responsible for enforcing the account's simultaneous `shared-users` limit.

The default synchronization interval is 30 seconds and can be changed with
`MIKROTIK_SYNC_INTERVAL_MS`.

### Authentication Separation
JWT login authenticates access to this API only. MikroTik Hotspot authentication is provisioned separately through the router; registration accepts an optional `hotspotPassword` for that credential.

Usernames are trimmed and stored in lowercase because MikroTik HotSpot usernames are case-sensitive. API login accepts any username casing and normalizes it before lookup.

### User Passwords
Each user receives a **unique password** which is:
- Hashed with bcrypt (10 rounds)
- Synced with MikroTik hotspot
- Changeable anytime

### Audit Trail
All operations are logged including:
- User creation/deletion
- Device connections/disconnections
- Password changes
- Status updates

## Requirements

- Node.js 18+ or Bun 1.0+
- MikroTik RouterOS with API enabled
- PostgreSQL 14+ or compatible hosted PostgreSQL database

## Environment Setup

See [.env.example](./.env.example) for complete configuration guide.

Key variables:
```env
MIKROTIK_HOST=192.168.1.1
MIKROTIK_USER=admin
MIKROTIK_PASSWORD=password
JWT_SECRET=your-secret-key
DATABASE_URL=postgres://mikrotik:mikrotik@localhost:5432/mikrotik
```

## MikroTik Configuration

1. Enable API service (System → API)
2. Create hotspot profile (IP → Hotspot → Profiles)
3. Set API user permissions if needed
4. Configure IP pool for hotspot clients

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed setup.

## TP-Link Access Point Topology

The TP-Link must operate as a transparent access point, not as a router:

1. Connect a MikroTik HotSpot LAN/bridge port to a TP-Link LAN port.
2. Set the TP-Link to **Access Point mode**.
3. Disable DHCP server, NAT, guest-network isolation, and router/WISP mode on the TP-Link.
4. Give the TP-Link a management IP inside the MikroTik LAN, outside the DHCP pool.
5. Run DHCP, gateway, DNS, captive portal, and internet access control on MikroTik.

If the TP-Link performs NAT, MikroTik may see the TP-Link instead of individual client MAC addresses, which prevents accurate per-device monitoring and limits.

## API Authentication

All protected endpoints require JWT token in Authorization header:

```
Authorization: Bearer <token>
```

Use a MikroTik RouterOS API account as the primary super-admin login. Include
an email address on the first login so a local identity can be created:

```bash
curl -X POST http://localhost:3000/api/auth/mikrotik-login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "MIKROTIK_PASSWORD",
    "email": "admin@example.com",
  }'
```

The credentials are verified directly against RouterOS and the response returns
a `super_admin` JWT. Later MikroTik logins only require username and password.

Create an additional local super admin:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SUPER_ADMIN_TOKEN" \
  -d '{
    "username": "operationsadmin",
    "email": "operations@example.com",
    "password": "ReplaceWithAStrongPassword",
    "role": "super_admin"
  }'
```

Additional local super admins log in through `/api/auth/login` and do not need
MikroTik credentials. All cross-user management endpoints require a current
`super_admin` JWT.
Demotion, disabling, or deletion of the last active super admin is blocked.

Get token from login endpoint:
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user","password":"pass"}'
```

## Response Format

All responses follow standard format:

```json
{
  "success": true/false,
  "message": "Description",
  "data": null,
  "error": "Error message if applicable"
}
```

## Deployment

### Build for Production
```bash
bun build ./index.ts --outdir ./dist
```

### Run Production Build
```bash
bun run dist/index.js
```

### Docker
```bash
docker build -t mikrotik-api .
docker run -p 3000:3000 -e MIKROTIK_HOST=... mikrotik-api
```

## Development

### Watch Mode
```bash
bun run dev
```

### Type Checking
```bash
bun run --types check
```

### Logging
Logs are output to console. Configure `LOG_LEVEL` in `.env`

## Troubleshooting

| Issue | Solution |
|-------|----------|
| MikroTik connection failed | Verify IP, credentials, and API is enabled |
| PostgreSQL connection failed | Verify `DATABASE_URL` and that PostgreSQL is running |
| Token expired | Login again to get new token (24h expiry) |
| Port in use | Change PORT in .env or kill process on that port |

## Performance

- Single instance: supports 1000+ users
- PostgreSQL connection pooling is configured through `DATABASE_POOL_SIZE`
- Add caching for frequently accessed data

## Security

- JWT tokens expire after 24 hours and are checked against current account status.
- Passwords are hashed with bcrypt cost 12.
- Login and registration endpoints are rate limited.
- Primary super-admin authentication is verified directly against RouterOS.
- Request bodies are limited to 16 KiB and security headers are enabled.
- SQL queries use parameter binding and IDs use cryptographic UUIDs.
- Docker excludes environment files, runs as a non-root user, and does not publish PostgreSQL.
- Use HTTPS at the reverse proxy. Set `TRUST_PROXY=true` only for a trusted proxy.
- Prefer MikroTik API-SSL with `MIKROTIK_TLS=true` and port `8729`.

## Testing

```bash
# Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SUPER_ADMIN_TOKEN" \
  -d '{"username":"test","email":"test@test.com","password":"Test123456","hotspotPassword":"WiFiPass123","maxDevices":2}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"Test123456"}'

# Get profile (replace TOKEN with actual token)
curl -X GET http://localhost:3000/api/users/me \
  -H "Authorization: Bearer TOKEN"

# Monitor live HotSpot sessions
curl -X GET http://localhost:3000/api/devices/sessions \
  -H "Authorization: Bearer TOKEN"
```

## License

MIT

## Support

For detailed API documentation, see [ARCHITECTURE.md](./ARCHITECTURE.md)

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.11. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
