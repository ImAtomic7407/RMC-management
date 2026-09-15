# Authentication and Session Foundation

This document covers the auth/session layer for the separate Examination backend.

## Scope

- JWT access-token authentication
- role-based access control
- active-status checks
- `/api/auth/login`
- `/api/auth/me`
- `/api/auth/logout`
- development-only seed helper
- auth audit logging

## Security rules

- Only active users may log in
- Token verification is server-side
- Role checks are enforced in middleware
- Logout uses a token revocation pattern for the current process
- The app refuses to authenticate if the Examination schema is not ready

## Current limitations

- No refresh token flow yet
- No persistent token revocation store yet
- No identity/roster sync runtime yet
- No exam feature APIs yet

