const http = require("http");

const PORT = Number(process.env.PORT || 3000);

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", uptimeSec: Math.round(process.uptime()) }));
    return;
  }

  if (req.url === "/api/hello") {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        ok: true,
        message: "Hello World from BayonOS!",
        path: req.url,
        timestamp: new Date().toISOString(),
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
      timestamp: new Date().toISOString(),
    }),
  );
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`BayonOS hello-world Node.js API listening on http://0.0.0.0:${PORT}`);
});
