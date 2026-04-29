# Architecture and Implementation Guide

## System Architecture

```
┌─────────────────┐
│  Client/Router  │
│  (Device)       │
└────────┬────────┘
         │
         │ HTTP/REST
         ▼
┌─────────────────────────────┐
│   API Server (Elysia)       │
├─────────────────────────────┤
│  Routes (User, Device)      │
│  Middleware (Auth, Response)│
└────────┬────────────────────┘
         │
    ┌────┴────┬──────────────┐
    │          │              │
    ▼          ▼              ▼
┌────────┐ ┌────────┐   ┌──────────┐
│Database│ │MikroTik│   │Services  │
│(Postgres)││Router  │   │(Business)│
└────────┘ └────────┘   └──────────┘
```

## Data Flow

### User Registration Flow
```
1. Client sends registration request
   └─> POST /api/auth/register
       {username, email, password, maxDevices}

2. UserService validates input
   └─> Check if username/email exists
   └─> Hash password with bcrypt

3. Create database record
   └─> UserQueries.create()
   └─> Insert into users table

4. Create MikroTik hotspot user
   └─> MikroTikClient.createHotspotUser()
   └─> RouterOS API call

5. Log audit event
   └─> AuditLogQueries.log()

6. Return user data with token
```

### Device Connection Flow
```
1. User requests device connection
   └─> POST /api/devices/connect
       {macAddress, ipAddress}

2. Verify user authentication
   └─> Validate JWT token
   └─> Get user ID from token

3. Check device limit
   └─> Count connected devices
   └─> If at limit, disconnect oldest
   └─> DeviceService.enforceDeviceLimit()

4. Connect device
   └─> Update device record
   └─> Set isConnected=true
   └─> Record connection timestamp

5. Update MikroTik profile
   └─> Apply bandwidth/rate limits
   └─> Enable hotspot user

6. Return session token
```

## Key Design Patterns

### Service Layer Pattern
- Business logic is separated into service classes
- `UserService`, `DeviceService` handle operations
- Services interact with database queries
- MikroTik client is abstracted away

### Repository Pattern
- Database queries are organized by entity
- `UserQueries`, `DeviceQueries`, etc.
- Queries return data objects (not raw rows)
- All database access goes through these

### Middleware Pattern
- Authentication middleware validates JWT tokens
- Response middleware formats all responses
- Follows REST API best practices

### Error Handling
- Try-catch blocks catch exceptions
- Proper HTTP status codes (401, 400, 404, 500)
- Consistent error response format

## Device Limit Implementation

### Algorithm: Max 2 Connected Devices

```javascript
// Check if device can connect
canDeviceConnect(userId):
  user = get_user(userId)
  connectedCount = count_connected_devices(userId)
  return connectedCount < user.maxDevices

// When device tries to connect and at limit
enforceDeviceLimit(userId):
  user = get_user(userId)
  connected = get_connected_devices(userId)
  if connected.length >= user.maxDevices:
    oldest = connected.sort_by_connection_time()[0]
    disconnect_device(oldest.id)
    update_mikrotik_disconnect(oldest)
```

### Example Scenarios

**Scenario 1: User has 0 devices connected**
```
Device 1 connects → ✅ Allowed (0 < 2)
```

**Scenario 2: User has 1 device connected**
```
Device 2 connects → ✅ Allowed (1 < 2)
```

**Scenario 3: User has 2 devices connected**
```
Device 3 connects → Disconnect Device 1 → ✅ Device 3 connected
```

**Scenario 4: User at max and tries same device twice**
```
Device 1 (connected) → Request again → ✅ Already connected
```

## Security Implementation

### Password Hashing
```typescript
// Registration
password_hash = bcrypt.hash(password, 10)  // 10 rounds

// Login
is_valid = bcrypt.compare(input_password, stored_hash)
```

### JWT Token
```typescript
token = jwt.sign(
  { userId, username },
  JWT_SECRET,
  { expiresIn: "24h" }
)

// Validation
payload = jwt.verify(token, JWT_SECRET)
```

### Database Security
- Foreign key constraints enabled
- ON DELETE CASCADE for cascade deletion
- Indexes on frequently queried fields
- Audit logging for all operations

## Scalability Considerations

### Database
- PostgreSQL supports single-instance and multi-instance deployments
- Connection pooling is handled by Bun SQL and configured with `DATABASE_POOL_SIZE`
- Add query caching for read-heavy operations

### API Server
- Stateless design allows horizontal scaling
- JWT tokens don't require session storage
- Use load balancer to distribute traffic
- Add rate limiting per IP/user

### MikroTik Integration
- Connection pooling for RouterOS API
- Implement retry logic for failures
- Cache RouterOS responses
- Add circuit breaker for failure handling

## Integration with MikroTik

### User Creation on RouterOS
```javascript
// 1. Create user
POST /ip/hotspot/user
{
  name: username,
  password: password,
  profile: "default",
  mac-address: device_mac_address
}

// 2. Set bandwidth (optional)
POST /queue/simple
{
  target: username,
  max-packet-queue: "100/100/50/50"
}
```

### Session Management
```javascript
// Get active sessions
GET /ip/hotspot/active

// Disconnect user
DELETE /ip/hotspot/active/:id

// Block user
PUT /ip/hotspot/user/:id
{
  disabled: true
}
```

## API Response Format

All responses follow this format:

```json
{
  "success": boolean,
  "message": string,
  "data": any | null,
  "error": string | undefined
}
```

### Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { /* result */ }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message"
}
```

## Testing Endpoints

### Using curl

```bash
# Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test_user",
    "email": "test@example.com",
    "password": "TestPass123",
    "maxDevices": 2
  }'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test_user",
    "password": "TestPass123"
  }'

# Get profile (replace TOKEN with actual token)
curl -X GET http://localhost:3000/api/users/me \
  -H "Authorization: Bearer TOKEN"

# Register device
curl -X POST http://localhost:3000/api/devices \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceName": "My Device",
    "macAddress": "AA:BB:CC:DD:EE:FF"
  }'

# Connect device
curl -X POST http://localhost:3000/api/devices/connect \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "ipAddress": "192.168.1.100"
  }'
```

### Using Postman
1. Import the API endpoints into Postman
2. Set `{{token}}` variable after login
3. Use `Authorization: Bearer {{token}}` header
4. Test each endpoint with sample data
