# Phase 13 Android Notes

The separate Examination app now has its initial native Android scaffold.

## Included

- Kotlin + Jetpack Compose project structure
- Navigation shell with role-based routing
- Login screen
- Teacher/Admin dashboard placeholder
- Student dashboard placeholder
- API status/debug screen
- DataStore session storage
- Retrofit/OkHttp API client foundation

## Not included

- Exam attempt UI
- Question editor UI
- Media upload UI
- Practice unlock UI
- Full results or leaderboard UI

## Backend integration

- Uses `POST /api/auth/login`
- Uses `GET /api/auth/me`
- Uses `POST /api/auth/logout`
- Uses `GET /health`

## Notes

- The app remains fully separate from the old RMC production application.
- No option image support was added.
- Student live payload rules remain enforced by the backend.
