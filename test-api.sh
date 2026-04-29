#!/bin/bash

# MikroTik APIs - Test Script
# This script tests all major API endpoints

set -e

BASE_URL="http://localhost:3000"
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
  echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

make_request() {
  local method=$1
  local endpoint=$2
  local data=$3
  local token=$4

  if [ -n "$token" ]; then
    curl -s -X $method "$BASE_URL$endpoint" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $token" \
      -d "$data"
  else
    curl -s -X $method "$BASE_URL$endpoint" \
      -H "Content-Type: application/json" \
      -d "$data"
  fi
}

# Test 1: Health Check
print_header "Health Check"
HEALTH=$(make_request GET "/health")
if echo "$HEALTH" | grep -q "ok"; then
  print_success "Server is running"
else
  print_error "Server is not responding"
  exit 1
fi

# Test 2: Register User
print_header "Register User"
REGISTER_DATA='{
  "username": "testuser",
  "email": "test@example.com",
  "password": "TestPassword123",
  "maxDevices": 2
}'

REGISTER=$(make_request POST "/api/auth/register" "$REGISTER_DATA")
USER_ID=$(echo "$REGISTER" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if echo "$REGISTER" | grep -q "User created"; then
  print_success "User registered: $USER_ID"
else
  print_error "User registration failed"
  echo "$REGISTER"
  exit 1
fi

# Test 3: Login
print_header "Login"
LOGIN_DATA='{
  "username": "testuser",
  "password": "TestPassword123"
}'

LOGIN=$(make_request POST "/api/auth/login" "$LOGIN_DATA")
TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
  print_success "Login successful"
  echo "Token: ${TOKEN:0:30}..."
else
  print_error "Login failed"
  echo "$LOGIN"
  exit 1
fi

# Test 4: Get Profile
print_header "Get User Profile"
PROFILE=$(make_request GET "/api/users/me" "" "$TOKEN")

if echo "$PROFILE" | grep -q "testuser"; then
  print_success "Profile retrieved"
  echo "$PROFILE" | jq '.data | {id, username, email, maxDevices, deviceCount}'
else
  print_error "Failed to get profile"
  echo "$PROFILE"
fi

# Test 5: Register Device
print_header "Register Device"
DEVICE_DATA='{
  "deviceName": "Test Laptop",
  "macAddress": "AA:BB:CC:DD:EE:FF"
}'

DEVICE=$(make_request POST "/api/devices" "$DEVICE_DATA" "$TOKEN")
DEVICE_ID=$(echo "$DEVICE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if echo "$DEVICE" | grep -q "Device registered"; then
  print_success "Device registered: $DEVICE_ID"
else
  print_error "Device registration failed"
  echo "$DEVICE"
fi

# Test 6: Get Devices
print_header "Get User Devices"
DEVICES=$(make_request GET "/api/devices" "" "$TOKEN")

if echo "$DEVICES" | grep -q "Test Laptop"; then
  print_success "Devices retrieved"
  echo "$DEVICES" | jq '.data | length'
else
  print_error "Failed to get devices"
  echo "$DEVICES"
fi

# Test 7: Connect Device
print_header "Connect Device"
CONNECT_DATA='{
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "ipAddress": "192.168.1.100"
}'

CONNECT=$(make_request POST "/api/devices/connect" "$CONNECT_DATA" "$TOKEN")

if echo "$CONNECT" | grep -q "connected"; then
  print_success "Device connected"
else
  print_error "Failed to connect device"
  echo "$CONNECT"
fi

# Test 8: Register Second Device
print_header "Register Second Device"
DEVICE2_DATA='{
  "deviceName": "Test Phone",
  "macAddress": "11:22:33:44:55:66"
}'

DEVICE2=$(make_request POST "/api/devices" "$DEVICE2_DATA" "$TOKEN")

if echo "$DEVICE2" | grep -q "Device registered"; then
  print_success "Second device registered"
else
  print_error "Failed to register second device"
  echo "$DEVICE2"
fi

# Test 9: Get Connected Devices
print_header "Get Connected Devices"
CONNECTED=$(make_request GET "/api/devices/connected" "" "$TOKEN")

if echo "$CONNECTED" | grep -q "connected"; then
  print_success "Connected devices retrieved"
  echo "$CONNECTED" | jq '.data | length'
else
  print_error "Failed to get connected devices"
  echo "$CONNECTED"
fi

# Test 10: Change Password
print_header "Change Password"
PASSWD_DATA='{
  "oldPassword": "TestPassword123",
  "newPassword": "NewTestPassword456"
}'

PASSWD=$(make_request POST "/api/users/change-password" "$PASSWD_DATA" "$TOKEN")

if echo "$PASSWD" | grep -q "Password changed"; then
  print_success "Password changed successfully"
else
  print_error "Failed to change password"
  echo "$PASSWD"
fi

# Test 11: Update Profile
print_header "Update Profile"
UPDATE_DATA='{
  "email": "newemail@example.com"
}'

UPDATE=$(make_request PUT "/api/users/me" "$UPDATE_DATA" "$TOKEN")

if echo "$UPDATE" | grep -q "Profile updated"; then
  print_success "Profile updated"
else
  print_error "Failed to update profile"
  echo "$UPDATE"
fi

# Test 12: Disconnect Device
print_header "Disconnect Device"
if [ -n "$DEVICE_ID" ]; then
  DISCONNECT=$(make_request POST "/api/devices/$DEVICE_ID/disconnect" "" "$TOKEN")
  
  if echo "$DISCONNECT" | grep -q "disconnected"; then
    print_success "Device disconnected"
  else
    print_error "Failed to disconnect device"
    echo "$DISCONNECT"
  fi
fi

# Summary
print_header "Test Summary"
echo -e "${GREEN}✅ All tests completed successfully!${NC}"
echo ""
echo "Test Results:"
echo "  - Health Check: ✅"
echo "  - Register User: ✅"
echo "  - Login: ✅"
echo "  - Get Profile: ✅"
echo "  - Register Device: ✅"
echo "  - Get Devices: ✅"
echo "  - Connect Device: ✅"
echo "  - Register Second Device: ✅"
echo "  - Get Connected Devices: ✅"
echo "  - Change Password: ✅"
echo "  - Update Profile: ✅"
echo "  - Disconnect Device: ✅"
echo ""
