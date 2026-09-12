const express = require("express");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const app = express();

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8000);
const databasePath = path.join(__dirname, "data", "server.db");

const db = new DatabaseSync(databasePath);

db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/", (req, res) => {
  res.json({
    message: "Note10 personal server",
    endpoints: [
      "GET /health",
      "GET /notes",
      "POST /notes",
      "DELETE /notes/:id"
    ]
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    time: new Date().toISOString()
  });
});

app.get("/notes", (req, res) => {
  const notes = db
    .prepare(`
      SELECT id, title, content, created_at
      FROM notes
      ORDER BY id DESC
    `)
    .all();

  res.json(notes);
});

app.post("/notes", (req, res) => {
  const title =
    typeof req.body.title === "string" ? req.body.title.trim() : "";

  const content =
    typeof req.body.content === "string" ? req.body.content.trim() : "";

  if (!title) {
    return res.status(400).json({
      error: "title is required"
    });
  }

  if (title.length > 200 || content.length > 10000) {
    return res.status(400).json({
      error: "note is too long"
    });
  }

  const result = db
    .prepare(`
      INSERT INTO notes (title, content)
      VALUES (?, ?)
    `)
    .run(title, content);

  const note = db
    .prepare(`
      SELECT id, title, content, created_at
      FROM notes
      WHERE id = ?
    `)
    .get(result.lastInsertRowid);

  res.status(201).json(note);
});

app.delete("/notes/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      error: "invalid note id"
    });
  }

  const result = db
    .prepare("DELETE FROM notes WHERE id = ?")
    .run(id);

  if (result.changes === 0) {
    return res.status(404).json({
      error: "note not found"
    });
  }

  res.status(204).end();
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    error: "internal server error"
  });
});

app.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});
