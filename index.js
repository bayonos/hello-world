require("dotenv").config();
const http = require("http");
const mysql = require("mysql2/promise");

const PORT = Number(process.env.PORT || 3000);

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
    pool =
      typeof cfg === "string"
        ? mysql.createPool(cfg)
        : mysql.createPool(cfg);
  }
  return pool;
}

async function ensureUsersTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(160) NOT NULL UNIQUE,
      role VARCHAR(32) DEFAULT 'member',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
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

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = (req.url || "/").split("?")[0];

  try {
    if (url === "/health") {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: "ok",
          uptimeSec: Math.round(process.uptime()),
          dbConfigured: Boolean(process.env.DATABASE_URL || process.env.DB_HOST),
        }),
      );
      return;
    }

    if (url === "/api/hello") {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          ok: true,
          message: "Hello World from BayonOS!",
          path: url,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    // Test MySQL connection
    if (url === "/api/db-test") {
      const db = getPool();
      const [rows] = await db.query(
        "SELECT VERSION() AS mysqlVersion, DATABASE() AS currentDatabase, NOW() AS serverTime",
      );
      res.writeHead(200);
      res.end(
        JSON.stringify({
          ok: true,
          host: process.env.DB_HOST || "(from DATABASE_URL)",
          database: rows[0]?.currentDatabase,
          mysqlVersion: rows[0]?.mysqlVersion,
          serverTime: rows[0]?.serverTime,
        }),
      );
      return;
    }

    // Select users (or create user via POST)
    if (url === "/api/users" || url === "/users") {
      const db = getPool();
      await ensureUsersTable(db);

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const fullName = String(body.full_name || body.fullName || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const role = String(body.role || "member").trim();
        if (!fullName || !email) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "full_name and email are required" }));
          return;
        }
        const [result] = await db.query(
          "INSERT INTO users (full_name, email, role) VALUES (?, ?, ?)",
          [fullName, email, role],
        );
        res.writeHead(201);
        res.end(
          JSON.stringify({
            ok: true,
            id: result.insertId,
            full_name: fullName,
            email,
            role,
          }),
        );
        return;
      }

      const [rows] = await db.query(
        "SELECT id, full_name, email, role, created_at FROM users ORDER BY id DESC LIMIT 100",
      );
      res.writeHead(200);
      res.end(
        JSON.stringify({
          ok: true,
          database: process.env.DB_NAME || "order_db",
          count: rows.length,
          users: rows,
        }),
      );
      return;
    }

    res.writeHead(200);
    res.end(
      JSON.stringify({
        ok: true,
        service: "hello-world",
        message: "Hello World — Deployed on BayonOS Cloud!",
        runtime: `Node.js ${process.version}`,
        port: PORT,
        endpoints: ["/", "/health", "/api/hello", "/api/db-test", "/api/users"],
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    res.writeHead(500);
    res.end(
      JSON.stringify({
        ok: false,
        error: err?.sqlMessage || err?.message || "Internal server error",
      }),
    );
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`BayonOS hello-world Node.js API listening on http://0.0.0.0:${PORT}`);
});
