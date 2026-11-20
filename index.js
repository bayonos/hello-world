require("dotenv").config();
const http = require("http");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "bayonos-dev-jwt-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

function getDbConfig() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "bayonos_user",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "order_db",
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 8000,
  };
}

let pool = null;
function getPool() {
  if (!pool) {
    const cfg = getDbConfig();
    pool = typeof cfg === "string" ? mysql.createPool(cfg) : mysql.createPool(cfg);
  }
  return pool;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, key] = stored.split(":");
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, "hex");
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role || "member",
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

let schemaReady = false;
async function ensureUsersTable(db) {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(80) UNIQUE,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(160) NULL UNIQUE,
      password_hash VARCHAR(255) NULL,
      role VARCHAR(32) DEFAULT 'member',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Safe migrations if table existed from earlier version
  const alters = [
    "ALTER TABLE users ADD COLUMN username VARCHAR(80) UNIQUE AFTER id",
    "ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER email",
    "ALTER TABLE users MODIFY COLUMN email VARCHAR(160) NULL",
  ];
  for (const sql of alters) {
    try {
      await db.query(sql);
    } catch (err) {
      if (err && err.code !== "ER_DUP_FIELDNAME") {
        // ignore benign already-migrated cases
      }
    }
  }
  schemaReady = true;
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(JSON.stringify(payload));
}

function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim();
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  const url = (req.url || "/").split("?")[0];

  try {
    if (url === "/health") {
      sendJson(res, 200, {
        status: "ok",
        uptimeSec: Math.round(process.uptime()),
        dbConfigured: Boolean(process.env.DATABASE_URL || process.env.DB_HOST),
      });
      return;
    }

    if (url === "/api/hello") {
      sendJson(res, 200, {
        ok: true,
        message: "Hello World from BayonOS!",
        path: url,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (url === "/api/db-test") {
      const db = getPool();
      const [rows] = await db.query(
        "SELECT VERSION() AS mysqlVersion, DATABASE() AS currentDatabase, NOW() AS serverTime",
      );
      sendJson(res, 200, {
        ok: true,
        host: process.env.DB_HOST || "(from DATABASE_URL)",
        database: rows[0]?.currentDatabase,
        mysqlVersion: rows[0]?.mysqlVersion,
        serverTime: rows[0]?.serverTime,
      });
      return;
    }

    // ==================== REGISTER WITH JWT ====================
    if (url === "/api/auth/register" && req.method === "POST") {
      const body = await readJsonBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const fullName = String(body.full_name || body.fullName || "").trim();
      const email = body.email ? String(body.email).trim().toLowerCase() : null;
      const role = String(body.role || "member").trim();

      if (!username || !password || !fullName) {
        sendJson(res, 400, {
          ok: false,
          error: "username, password, and full_name are required",
        });
        return;
      }
      if (password.length < 4) {
        sendJson(res, 400, {
          ok: false,
          error: "password must be at least 4 characters",
        });
        return;
      }

      const db = getPool();
      await ensureUsersTable(db);

      const [existing] = await db.query(
        "SELECT id FROM users WHERE username = ? LIMIT 1",
        [username],
      );
      if (existing.length > 0) {
        sendJson(res, 409, { ok: false, error: "Username already exists" });
        return;
      }

      const passwordHash = hashPassword(password);
      const [result] = await db.query(
        "INSERT INTO users (username, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
        [username, fullName, email, passwordHash, role],
      );

      const user = {
        id: result.insertId,
        username,
        full_name: fullName,
        email,
        role,
      };
      const token = signToken(user);

      sendJson(res, 201, {
        ok: true,
        token,
        user,
      });
      return;
    }

    // ==================== LOGIN WITH USERNAME & PASSWORD ====================
    if (url === "/api/auth/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!username || !password) {
        sendJson(res, 400, {
          ok: false,
          error: "username and password are required",
        });
        return;
      }

      const db = getPool();
      await ensureUsersTable(db);

      const [rows] = await db.query(
        "SELECT id, username, full_name, email, password_hash, role, created_at FROM users WHERE username = ? LIMIT 1",
        [username],
      );
      const row = rows[0];
      if (!row || !verifyPassword(password, row.password_hash)) {
        sendJson(res, 401, { ok: false, error: "Invalid username or password" });
        return;
      }

      const user = {
        id: row.id,
        username: row.username,
        full_name: row.full_name,
        email: row.email,
        role: row.role,
      };
      const token = signToken(user);

      sendJson(res, 200, {
        ok: true,
        token,
        full_name: user.full_name,
        user,
      });
      return;
    }

    // ==================== GET CURRENT USER (JWT PROTECTED) ====================
    if (url === "/api/auth/me" && req.method === "GET") {
      const token = extractBearerToken(req);
      if (!token) {
        sendJson(res, 401, { ok: false, error: "Missing Authorization: Bearer <token>" });
        return;
      }

      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch {
        sendJson(res, 401, { ok: false, error: "Invalid or expired JWT token" });
        return;
      }

      const db = getPool();
      await ensureUsersTable(db);
      const [rows] = await db.query(
        "SELECT id, username, full_name, email, role, created_at FROM users WHERE id = ? LIMIT 1",
        [decoded.sub],
      );
      if (!rows[0]) {
        sendJson(res, 404, { ok: false, error: "User not found" });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        full_name: rows[0].full_name,
        user: rows[0],
      });
      return;
    }

    // ==================== LIST USERS ====================
    if (url === "/api/users" || url === "/users") {
      const db = getPool();
      await ensureUsersTable(db);
      const [rows] = await db.query(
        "SELECT id, username, full_name, email, role, created_at FROM users ORDER BY id DESC LIMIT 100",
      );
      sendJson(res, 200, {
        ok: true,
        database: process.env.DB_NAME || "order_db",
        count: rows.length,
        users: rows,
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      service: "hello-world",
      message: "Hello World — BayonOS Node.js + MySQL + JWT Auth API",
      runtime: `Node.js ${process.version}`,
      port: PORT,
      endpoints: [
        "GET /",
        "GET /health",
        "GET /api/db-test",
        "POST /api/auth/register",
        "POST /api/auth/login",
        "GET /api/auth/me (Bearer JWT)",
        "GET /api/users",
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err?.sqlMessage || err?.message || "Internal server error",
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`BayonOS hello-world Node.js API listening on http://0.0.0.0:${PORT}`);
});
