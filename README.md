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
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and get JWT token

### User Endpoints
- `GET /api/users/me` - Get current user profile
- `PUT /api/users/me` - Update profile
- `POST /api/users/change-password` - Change password

### Device Endpoints
- `GET /api/devices` - Get user's devices
- `POST /api/devices` - Register new device
- `POST /api/devices/connect` - Connect device (login)
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
Each user is limited to **2 simultaneously connected devices**. Active sessions are read from MikroTik Hotspot, grouped by MAC address, and excess sessions are disconnected on the router before the backend state is synced.

### Device Registration
Device registration accepts a `deviceName` plus optional `macAddress` or `ipAddress`. If `macAddress` is omitted, the API detects it from the user's current MikroTik Hotspot active session or router network tables, preferring the request IP when available.

### Authentication Separation
JWT login authenticates access to this API only. MikroTik Hotspot authentication is provisioned separately through the router; registration accepts an optional `hotspotPassword` for that credential.

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

## API Authentication

All protected endpoints require JWT token in Authorization header:

```
Authorization: Bearer <token>
```

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

- ✓ JWT tokens expire after 24 hours
- ✓ Passwords hashed with bcrypt
- ✓ SQL injection prevention via prepared statements
- ✓ Rate limiting (recommended via reverse proxy)
- ✓ HTTPS (recommended via reverse proxy)

## Testing

```bash
# Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@test.com","password":"Test123456"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"Test123456"}'

# Get profile (replace TOKEN with actual token)
curl -X GET http://localhost:3000/api/users/me \
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
