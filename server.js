const express = require("express");

const app = express();

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8000);

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/", (req, res) => {
  res.json({
    message: "Note10 server is running"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    time: new Date().toISOString()
  });
});

app.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});
