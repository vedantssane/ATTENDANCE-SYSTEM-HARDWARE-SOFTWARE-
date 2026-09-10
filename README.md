# Attendly — RFID Attendance Management

A working software-first RFID attendance application. The browser simulation calls the same canonical endpoint intended for the future ESP32/RC522 reader:

```http
POST /api/attendance/scan
Content-Type: application/json

{ "rfidUid": "A1B2C3D4" }
```

The server resolves the student itself, creates one daily session on the first scan, signs it out on the second scan, and rejects any subsequent scan for that student/day.

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`. A seeded local datastore is created in `data/store.json` on first run (it is ignored by Git). The screen includes seeded students and can be tested immediately through **Simulate RFID scan**.

## Production database

`db/schema.sql` is the PostgreSQL/Supabase schema: it provides the one-session-per-student-per-day constraint, attendance indexes, and a partial unique index preventing a UID from being assigned to more than one active student. Configure credentials through environment variables shown in `.env.example`; never put service-role credentials in browser code.

This starter deliberately uses the local persisted store only when no production database adapter is configured so the full software flow can be evaluated without external services. Before deployment, connect the API adapter to PostgreSQL/Supabase, protect administrator routes with your Supabase Auth session middleware, and issue the ESP32 a scoped scan credential. The backend, not the ESP32/browser, remains the authority for student lookup and attendance state.

## Main API routes

- `GET /api/dashboard`
- `GET, POST /api/students`
- `PATCH /api/students/:id`
- `GET /api/attendance?date=YYYY-MM-DD&studentId=...`
- `POST /api/attendance/scan`

The live display refreshes automatically and the simulator uses no alternate attendance code path.
