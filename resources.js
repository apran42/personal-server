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

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
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

function validateNasFile(nasRoot, filePath) {
  const absoluteFilePath = path.resolve(nasRoot, filePath);

  if (!absoluteFilePath.startsWith(`${nasRoot}${path.sep}`)) {
    return {
      status: 400,
      error: "invalid resource file path"
    };
  }

  try {
    const fileStats = fs.statSync(absoluteFilePath);

    if (!fileStats.isFile()) {
      return {
        status: 400,
        error: "resource path must point to a file"
      };
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        status: 404,
        error: "resource file not found"
      };
    }

    throw error;
  }

  return null;
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
      const query = cleanText(req.query.q, 100);
      const category = cleanText(req.query.category, 100);
      const semester = cleanText(req.query.semester, 50);

      if (query === null || category === null || semester === null) {
        return res.status(400).json({
          error: "invalid resource filters"
        });
      }

      const conditions = [];
      const parameters = [];

      if (query) {
        const pattern = `%${escapeLike(query)}%`;

        conditions.push(`
        (
          display_name LIKE ? ESCAPE '\\'
          OR file_path LIKE ? ESCAPE '\\'
          OR description LIKE ? ESCAPE '\\'
          OR tags LIKE ? ESCAPE '\\'
        )
      `);

        parameters.push(pattern, pattern, pattern, pattern);
      }

      if (category) {
        conditions.push("category = ? COLLATE NOCASE");
        parameters.push(category);
      }

      if (semester) {
        conditions.push("semester = ? COLLATE NOCASE");
        parameters.push(semester);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const resources = db
        .prepare(
          `
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
        ${whereClause}
        ORDER BY updated_at DESC, id DESC
      `
        )
        .all(...parameters)
        .map((resource) => ({
          ...resource,
          tags: parseTags(resource.tags)
        }));

      return res.json({
        query: query || "",
        category: category || "",
        semester: semester || "",
        resources
      });
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

      const fileError = validateNasFile(nasRoot, filePath);

      if (fileError) {
        return res.status(fileError.status).json({
          error: fileError.error
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
        .prepare(
          `
        INSERT INTO resources (
          file_path,
          display_name,
          category,
          semester,
          tags,
          description
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          filePath,
          displayName,
          category,
          semester,
          JSON.stringify(tags),
          description
        );

      const resource = db
        .prepare(
          `
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
      `
        )
        .get(result.lastInsertRowid);

      return res.status(201).json({
        ...resource,
        tags: parseTags(resource.tags)
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", (req, res, next) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
          error: "invalid resource id"
        });
      }

      const existing = db
        .prepare(
          `
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
        `
        )
        .get(id);

      if (!existing) {
        return res.status(404).json({
          error: "resource not found"
        });
      }

      const editableFields = [
        "filePath",
        "displayName",
        "category",
        "semester",
        "tags",
        "description"
      ];

      if (!editableFields.some((field) => Object.hasOwn(req.body, field))) {
        return res.status(400).json({
          error: "no resource fields supplied"
        });
      }

      const filePath = Object.hasOwn(req.body, "filePath")
        ? cleanFilePath(req.body.filePath)
        : existing.file_path;

      const displayName = Object.hasOwn(req.body, "displayName")
        ? cleanText(req.body.displayName, 200)
        : existing.display_name;

      const category = Object.hasOwn(req.body, "category")
        ? cleanText(req.body.category, 100)
        : existing.category;

      const semester = Object.hasOwn(req.body, "semester")
        ? cleanText(req.body.semester, 50)
        : existing.semester;

      const tags = Object.hasOwn(req.body, "tags")
        ? cleanTags(req.body.tags)
        : parseTags(existing.tags);

      const description = Object.hasOwn(req.body, "description")
        ? cleanText(req.body.description, 2000)
        : existing.description;

      if (
        !filePath ||
        !displayName ||
        category === null ||
        semester === null ||
        tags === null ||
        description === null
      ) {
        return res.status(400).json({
          error: "invalid resource data"
        });
      }

      if (Object.hasOwn(req.body, "filePath")) {
        const fileError = validateNasFile(nasRoot, filePath);

        if (fileError) {
          return res.status(fileError.status).json({
            error: fileError.error
          });
        }
      }

      const pathOwner = db
        .prepare(
          `
          SELECT id
          FROM resources
          WHERE file_path = ? AND id != ?
        `
        )
        .get(filePath, id);

      if (pathOwner) {
        return res.status(409).json({
          error: "resource already exists for this file"
        });
      }

      db.prepare(
        `
        UPDATE resources
        SET
          file_path = ?,
          display_name = ?,
          category = ?,
          semester = ?,
          tags = ?,
          description = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      ).run(
        filePath,
        displayName,
        category,
        semester,
        JSON.stringify(tags),
        description,
        id
      );

      const resource = db
        .prepare(
          `
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
        `
        )
        .get(id);

      return res.json({
        ...resource,
        tags: parseTags(resource.tags)
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", (req, res, next) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
          error: "invalid resource id"
        });
      }

      const resource = db
        .prepare(
          `
        SELECT id, file_path, display_name
        FROM resources
        WHERE id = ?
      `
        )
        .get(id);

      if (!resource) {
        return res.status(404).json({
          error: "resource not found"
        });
      }

      db.prepare("DELETE FROM resources WHERE id = ?").run(id);

      return res.json({
        deleted: true,
        resource: {
          id: resource.id,
          file_path: resource.file_path,
          display_name: resource.display_name
        },
        file_deleted: false
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createResourcesRouter;
