const express = require("express");
const fs = require("fs");
const path = require("path");

function parseTags(value) {
  try {
    const tags = JSON.parse(value);

    return Array.isArray(tags) ? tags : [];
  } catch {
    return [];
  }
}

function cleanText(value, maxLength) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();

  if (cleaned.length > maxLength) {
    return null;
  }

  return cleaned;
}

function cleanFilePath(value) {
  const cleaned = cleanText(value, 500);

  if (!cleaned || cleaned.includes("\0")) {
    return null;
  }

  const normalized = cleaned
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\/+/, "");

  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    return null;
  }

  return normalized;
}

function cleanTags(value) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const tags = value
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (
    tags.length !== value.length ||
    tags.length > 10 ||
    tags.some((tag) => tag.length > 30)
  ) {
    return null;
  }

  return [...new Set(tags)];
}

function createResourcesRouter(db) {
  if (!db) {
    throw new Error("Database connection is required");
  }

  const nasRoot = path.resolve(
  process.env.NAS_ROOT ||
    path.join(process.env.HOME, "storage", "shared", "NAS")
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      semester TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_resources_category
      ON resources(category);

    CREATE INDEX IF NOT EXISTS idx_resources_semester
      ON resources(semester);
  `);

  const router = express.Router();

  router.get("/", (req, res, next) => {
    try {
      const resources = db
        .prepare(`
          SELECT
            id,
            file_path,
            display_name,
            category,
            semester,
            tags,
            description,
            created_at,
            updated_at
          FROM resources
          ORDER BY updated_at DESC, id DESC
        `)
        .all()
        .map((resource) => ({
          ...resource,
          tags: parseTags(resource.tags)
        }));

      res.json({ resources });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", (req, res, next) => {
  try {
    const filePath = cleanFilePath(req.body.filePath);
    const displayName = cleanText(req.body.displayName, 200);
    const category = cleanText(req.body.category, 100);
    const semester = cleanText(req.body.semester, 50);
    const description = cleanText(req.body.description, 2000);
    const tags = cleanTags(req.body.tags);

    if (
      !filePath ||
      !displayName ||
      category === null ||
      semester === null ||
      description === null ||
      tags === null
    ) {
      return res.status(400).json({
        error: "invalid resource data"
      });
    }

    const absoluteFilePath = path.resolve(nasRoot, filePath);

    if (!absoluteFilePath.startsWith(`${nasRoot}${path.sep}`)) {
      return res.status(400).json({
        error: "invalid resource file path"
      });
    }

    let fileStats;

    try {
      fileStats = fs.statSync(absoluteFilePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return res.status(404).json({
          error: "resource file not found"
        });
      }

      throw error;
    }

    if (!fileStats.isFile()) {
      return res.status(400).json({
        error: "resource path must point to a file"
      });
    }

    const existing = db
      .prepare("SELECT id FROM resources WHERE file_path = ?")
      .get(filePath);

    if (existing) {
      return res.status(409).json({
        error: "resource already exists for this file"
      });
    }

    const result = db
      .prepare(`
        INSERT INTO resources (
          file_path,
          display_name,
          category,
          semester,
          tags,
          description
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        filePath,
        displayName,
        category,
        semester,
        JSON.stringify(tags),
        description
      );

    const resource = db
      .prepare(`
        SELECT
          id,
          file_path,
          display_name,
          category,
          semester,
          tags,
          description,
          created_at,
          updated_at
        FROM resources
        WHERE id = ?
      `)
      .get(result.lastInsertRowid);

    return res.status(201).json({
      ...resource,
      tags: parseTags(resource.tags)
    });
  } catch (error) {
    next(error);
  }
  });

  return router;
}

module.exports = createResourcesRouter;