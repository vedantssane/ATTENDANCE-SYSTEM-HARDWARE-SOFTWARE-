# Attendly — RFID Attendance Management

A working software-first RFID attendance application. The browser simulation calls the same canonical endpoint intended for the future ESP32/RC522 reader:

```http
POST /api/attendance/scan
Content-Type: application/json

{ "rfidUid": "A1B2C3D4" }
```

The server resolves the student itself. Each scan alternates the student between `SIGNED_IN` and `SIGNED_OUT`; after an OUT scan, a later scan creates a new daily session. A configurable cooldown prevents accidental immediate toggles.

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`. For the local development default, use `admin123`; set `ADMIN_PASSWORD` before any shared use. A seeded local datastore is created in `data/store.json` on first run (it is ignored by Git). The screen includes seeded students and can be tested immediately through **Simulate RFID scan**.

## Authentication and security

Admin pages and student/attendance management routes now require an HttpOnly administrator session. For local evaluation, sign in with password `admin123`; **set a strong `ADMIN_PASSWORD` environment variable before deployment**. The scan endpoint intentionally has no browser-admin session requirement because it is the future device endpoint; protect it at deployment with a scoped device credential or gateway while keeping RFID lookup server-side.

## Production database

`db/schema.sql` is the PostgreSQL/Supabase schema: it models multiple IN/OUT sessions per student/day, validates session state and timestamps, includes attendance indexes, and has a partial unique index preventing a UID from being assigned to more than one active student. Configure credentials through environment variables shown in `.env.example`; never put service-role credentials in browser code.

This starter deliberately uses the local persisted store only when no production database adapter is configured so the full software flow can be evaluated without external services. Before deployment, connect the API adapter to PostgreSQL/Supabase, protect administrator routes with your Supabase Auth session middleware, and issue the ESP32 a scoped scan credential. The backend, not the ESP32/browser, remains the authority for student lookup and attendance state.

## Main API routes

- `GET /api/dashboard`
- `GET, POST /api/students`
- `PATCH /api/students/:id`
- `GET /api/attendance?date=YYYY-MM-DD&studentId=...`
- `POST /api/attendance/scan`

The live display polls the dashboard every two seconds and the simulator uses no alternate attendance code path.
