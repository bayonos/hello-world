# hello-world

Node.js + MySQL backend test service for **BayonOS Cloud** (`*.bayonos.site`).

## Endpoints
- `GET /` — Service info JSON
- `GET /health` — Health check (`200 OK`)
- `GET /api/hello` — Hello World JSON response
- `GET /api/db-test` — Verify MySQL connection (`VERSION()`, `DATABASE()`, `NOW()`)
- `GET /api/users` — Auto-creates `users` table if needed and returns `SELECT * FROM users`
- `POST /api/users` — Insert a user (`{ "full_name": "Raksmey", "email": "raksmey@bayonos.site" }`)

## Environment Variables
Copy `.env.example` to `.env` for local development (`.env` is gitignored).
On **BayonOS Cloud**, attach your Managed Database (`Attach Env`) and click **Rebuild**.
