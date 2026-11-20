# hello-world

Node.js + MySQL + JWT Auth backend for **BayonOS Cloud** (`*.bayonos.site`).

## Endpoints
- `GET /` — API overview
- `GET /health` — Health check
- `GET /api/db-test` — Verify MySQL connection
- `POST /api/auth/register` — Register with `{ "username", "password", "full_name" }` → returns JWT `token` & `user`
- `POST /api/auth/login` — Login with `{ "username", "password" }` → returns JWT `token`, `full_name`, & `user`
- `GET /api/auth/me` — Send `Authorization: Bearer <token>` → returns `full_name` & `user`
- `GET /api/users` — List registered users (without password hashes)

## Environment Variables
Set `JWT_SECRET` + your database variables (`DATABASE_URL` or `DB_*`) in BayonOS Environment Variables (or local `.env`, which is gitignored).
