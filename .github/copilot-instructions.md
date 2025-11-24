## Quick orientation for AI coding agents

This repo implements a small end-to-end fleet tracking demo with three primary components:

- backend/ — Node.js (Express) server that also runs an embedded MQTT broker (Aedes), a Socket.IO bridge to the frontend, and a SQLite database (better-sqlite3). Key file: `backend/server.js`.
- frontend/ — React + Vite single-page app that connects to the backend via REST and Socket.IO. Key file: `frontend/src/App.jsx`.
- simulator/ — Node.js MQTT simulator that publishes `/device/{id}/status` messages and subscribes to `/device/+/command`. Key file: `simulator/index.js`.

There is also a sample `firmware/firmware.ino` showing how devices might connect (TinyGSM / PubSubClient style) and a root `Dockerfile` used to build a production image that compiles the frontend and serves it from `backend/public`.

## High-level data & communication flows (how things talk)

- Telemetry: devices (firmware or `simulator`) publish JSON payloads to `/device/{DEVICE_ID}/status`. The Aedes broker in `backend/server.js` receives these, parses them, and:
  - updates `vehicles` (last_seen, battery_level, fuel_level)
  - inserts rows into `vehicle_history`
  - emits `device-data` events over Socket.IO to connected web clients

- Commands: frontend emits a Socket.IO `send-command` event; backend updates DB and publishes MQTT to `/device/{DEVICE_ID}/command` (payload: {command: 'LOCK'|'UNLOCK'}).

- Alerts: backend detects speeding, low fuel, and geofence breaches and emits `geofence-alert` via Socket.IO and persists to `notifications`.

## Files to inspect first (quickmap)

- `backend/server.js` — single most important file (MQTT broker, business rules, REST API, Socket.IO handlers, analytic helpers). Search for: `aedes.on('publish'...)`, `io.on('connection'...)`, and `calculateVehicleScore`.
- `backend/db.js` — schema creation and DB access (better-sqlite3 prepared statements). This shows table names and columns used throughout the codebase.
- `frontend/src/App.jsx` — shows API usage, Socket.IO events (`device-data`, `geofence-alert`), UI flows and expected payload shapes.
- `simulator/index.js` — how test devices are generated, MQTT topic names, and simulator env var `MQTT_BROKER`.
- `firmware/firmware.ino` — embedded device expectations (topic suffixes, cloud-lock vs physical lock fields).
- `Dockerfile` — production build flow: install backend deps, build frontend, copy `frontend/dist` into `backend/public`, then run `node server.js`.

## Project-specific conventions and gotchas for edits

- Device IDs: ALWAYS use the MOTO_XXX format (see `backend/server.js` validation regex `^MOTO_\d{3}$`).
- DB access is synchronous via `better-sqlite3` prepared statements — prefer reusing `.prepare()` and avoid async DB wrappers here.
- Cooldowns: alert dedup logic uses a global `alertCooldowns` Map in `server.js`. When changing alert timing, update both the cooldown key construction and tests that assume these intervals.
- MQTT topics:
  - telemetry: `/device/{id}/status`
  - commands: `/device/{id}/command` (backend publishes JSON {command: 'LOCK'|'UNLOCK'})
  - alerts: `/device/{id}/alert` (simulator may publish custom alerts)

- Frontend runtime configuration: frontend reads `import.meta.env.VITE_API_URL` (see `frontend/src/App.jsx`) which must point to the backend base URL for both REST and Socket.IO.

## How to run & debug locally (discovered from files)

- Backend (dev): open a terminal in `backend/` and run `node server.js`. It starts Express on `PORT` (default 3000) and an Aedes MQTT broker (default 1883).
- Frontend (dev): open `frontend/` and run `npm run dev` (Vite). Set `VITE_API_URL` to the backend URL to enable socket + API calls in dev.
- Simulator: run `node simulator/index.js` (it uses `MQTT_BROKER` env var, default `mqtt://localhost:1883`). It also exposes a simple health check on port 8080.
- Production image: root `Dockerfile` builds frontend and backend and serves at backend's port (3000). The Dockerfile also installs backend deps with `npm ci --only=production`.

Note: backend `package.json` has no `start` script; production starts by running `node server.js` directly.

## Patterns for automated edits or enhancements

- Adding new telemetry fields: update parsing logic in `aedes.on('publish', ..)` inside `backend/server.js`, update `vehicle_history` insert, then update `frontend` components that consume the field (e.g., `App.jsx` uses `payload.battery`, `payload.fuel`, `payload.speed`).
- Adding an API endpoint: use the style in `server.js` (synchronous DB prepared statements, try/catch and res.status on failure). Follow existing naming (`/api/vehicles`, `/api/geofences`, `/api/analytics/*`).
- Tests: the repository has no test harness. If you add tests, prefer small Node scripts that spin up the server in a child process and use the simulator to inject MQTT messages.

## Security & data notes (explicitly discovered)

- Passwords are stored in plaintext in the SQLite `users` table and the login endpoint compares plaintext values — take care when modifying auth flows. Any security-related change should include a migration path and updated front-end login behavior.

## Examples to copy/paste for quick edits

- Publish a command to a device (in `backend/server.js` style):
  aedes.publish({ topic: `/device/${deviceId}/command`, payload: JSON.stringify({ command: 'LOCK' }) });

- Emit a Socket.IO device update to clients:
  io.emit('device-data', { topic: packet.topic, payload });

## What I couldn't discover automatically (ask the user)

- Any CI/CD or deploy conventions beyond the provided `Dockerfile` (are there GH Actions or specific registry targets?).
- Intended persistence or retention policies for `vehicle_history` (rollups/cleanup) — server currently inserts without pruning.

If anything here is incorrect or you want me to bias the guidance toward a particular workflow (e.g., test-first changes, TypeScript migration, or secure password storage), tell me which and I will update the file.

---
Files referenced: `backend/server.js`, `backend/db.js`, `frontend/src/App.jsx`, `simulator/index.js`, `firmware/firmware.ino`, `Dockerfile`.
