const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { DatabaseSync } = require("node:sqlite");

const execFileAsync = promisify(execFile);

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".sh",
  ".bash",
  ".py",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".yml",
  ".yaml",
  ".csv"
]);

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_INDEX_CHARACTERS = 2_000_000;

function createIndexError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeContent(value) {
  return value
    .replaceAll("\0", "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, MAX_INDEX_CHARACTERS);
}

function createResourceIndex(options = {}) {
  const searchDatabasePath = path.resolve(
    options.databasePath ||
      process.env.SEARCH_INDEX_PATH ||
      path.join(__dirname, "data", "search-index.db")
  );

  const nasRoot = path.resolve(
    options.nasRoot ||
      process.env.NAS_ROOT ||
      path.join(process.env.HOME, "storage", "shared", "NAS")
  );

  fs.mkdirSync(path.dirname(searchDatabasePath), {
    recursive: true
  });

  const db = new DatabaseSync(searchDatabasePath);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS resource_content
    USING fts5(
      resource_id UNINDEXED,
      content,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS resource_index_state (
      resource_id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      modified_at_ms INTEGER NOT NULL,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT ''
    );
  `);

  const deleteContentStatement = db.prepare(`
    DELETE FROM resource_content
    WHERE resource_id = ?
  `);

  const insertContentStatement = db.prepare(`
    INSERT INTO resource_content (
      resource_id,
      content
    )
    VALUES (?, ?)
  `);

  const upsertStateStatement = db.prepare(`
    INSERT INTO resource_index_state (
      resource_id,
      file_path,
      file_size,
      modified_at_ms,
      indexed_at,
      status,
      error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(resource_id) DO UPDATE SET
      file_path = excluded.file_path,
      file_size = excluded.file_size,
      modified_at_ms = excluded.modified_at_ms,
      indexed_at = excluded.indexed_at,
      status = excluded.status,
      error = excluded.error
  `);

  const getStateStatement = db.prepare(`
    SELECT
      resource_id AS resourceId,
      file_path AS filePath,
      file_size AS fileSize,
      modified_at_ms AS modifiedAtMs,
      indexed_at AS indexedAt,
      status,
      error
    FROM resource_index_state
    WHERE resource_id = ?
  `);
  const searchContentStatement = db.prepare(`
  SELECT
    CAST(resource_id AS INTEGER) AS resourceId,
    snippet(
      resource_content,
      1,
      '[',
      ']',
      ' … ',
      24
    ) AS snippet,
    bm25(resource_content) AS rank
  FROM resource_content
  WHERE resource_content MATCH ?
  ORDER BY rank
  LIMIT ?
`);

  const deleteStateStatement = db.prepare(`
  DELETE FROM resource_index_state
  WHERE resource_id = ?
`);
  function runTransaction(callback) {
    db.exec("BEGIN IMMEDIATE");

    try {
      const result = callback();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // 원래 발생한 오류를 유지합니다.
      }

      throw error;
    }
  }

  async function extractFile(filePath) {
    if (typeof filePath !== "string" || !filePath) {
      throw createIndexError(
        "INVALID_PATH",
        "A valid resource file path is required"
      );
    }

    const absolutePath = path.resolve(nasRoot, filePath);
    const rootPrefix = `${nasRoot}${path.sep}`;

    if (!absolutePath.startsWith(rootPrefix)) {
      throw createIndexError(
        "INVALID_PATH",
        "Resource path is outside the NAS"
      );
    }

    let stats;

    try {
      stats = await fs.promises.stat(absolutePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw createIndexError("FILE_NOT_FOUND", "Resource file was not found");
      }

      throw error;
    }

    if (!stats.isFile()) {
      throw createIndexError(
        "NOT_A_FILE",
        "Resource path must point to a file"
      );
    }

    if (stats.size > MAX_FILE_BYTES) {
      throw createIndexError(
        "FILE_TOO_LARGE",
        "Resource file exceeds the 25 MB indexing limit"
      );
    }

    const extension = path.extname(absolutePath).toLowerCase();
    let content;

    if (extension === ".pdf") {
      const result = await execFileAsync(
        "pdftotext",
        ["-enc", "UTF-8", absolutePath, "-"],
        {
          timeout: 60_000,
          maxBuffer: 8 * 1024 * 1024
        }
      );

      content = result.stdout;
    } else if (TEXT_EXTENSIONS.has(extension)) {
      content = await fs.promises.readFile(absolutePath, "utf8");
    } else {
      throw createIndexError(
        "UNSUPPORTED_TYPE",
        `Unsupported resource type: ${extension || "none"}`
      );
    }

    const normalizedContent = normalizeContent(content);

    if (!normalizedContent) {
      throw createIndexError("NO_TEXT", "No searchable text was extracted");
    }

    return {
      filePath,
      fileSize: stats.size,
      modifiedAtMs: Math.trunc(stats.mtimeMs),
      content: normalizedContent,
      truncated: content.length > MAX_INDEX_CHARACTERS
    };
  }

  async function indexResource(resource) {
    const resourceId = Number(resource?.id);
    const filePath = resource?.filePath ?? resource?.file_path;

    if (!Number.isInteger(resourceId) || resourceId < 1) {
      throw createIndexError(
        "INVALID_RESOURCE",
        "A valid resource ID is required"
      );
    }

    if (typeof filePath !== "string" || !filePath) {
      throw createIndexError(
        "INVALID_RESOURCE",
        "The resource does not have a file path"
      );
    }

    try {
      const extracted = await extractFile(filePath);
      const indexedAt = new Date().toISOString();

      runTransaction(() => {
        deleteContentStatement.run(resourceId);
        insertContentStatement.run(resourceId, extracted.content);

        upsertStateStatement.run(
          resourceId,
          extracted.filePath,
          extracted.fileSize,
          extracted.modifiedAtMs,
          indexedAt,
          "ready",
          ""
        );
      });

      return {
        resourceId,
        filePath: extracted.filePath,
        fileSize: extracted.fileSize,
        modifiedAtMs: extracted.modifiedAtMs,
        indexedAt,
        textLength: extracted.content.length,
        truncated: extracted.truncated,
        status: "ready"
      };
    } catch (error) {
      const indexedAt = new Date().toISOString();
      const errorMessage = String(error.message || error).slice(0, 1000);

      try {
        runTransaction(() => {
          deleteContentStatement.run(resourceId);

          upsertStateStatement.run(
            resourceId,
            filePath,
            0,
            0,
            indexedAt,
            "error",
            errorMessage
          );
        });
      } catch (stateError) {
        error.indexStateError = stateError;
      }

      throw error;
    }
  }

  function createSearchExpression(query) {
    if (typeof query !== "string") {
      return "";
    }

    const tokens = query.trim().split(/\s+/).filter(Boolean).slice(0, 10);

    return tokens
      .map((token) => `"${token.replaceAll('"', '""')}"*`)
      .join(" AND ");
  }

  function search(query, limit = 50) {
    const expression = createSearchExpression(query);

    if (!expression) {
      return [];
    }

    const normalizedLimit = Math.min(
      Math.max(Number.parseInt(limit, 10) || 50, 1),
      100
    );

    return searchContentStatement
      .all(expression, normalizedLimit)
      .map((row) => ({
        resourceId: Number(row.resourceId),
        snippet: row.snippet,
        rank: row.rank
      }));
  }

  function removeResource(resourceId) {
    const normalizedResourceId = Number(resourceId);

    if (!Number.isInteger(normalizedResourceId) || normalizedResourceId < 1) {
      throw createIndexError(
        "INVALID_RESOURCE",
        "A valid resource ID is required"
      );
    }

    runTransaction(() => {
      deleteContentStatement.run(normalizedResourceId);
      deleteStateStatement.run(normalizedResourceId);
    });
  }
  function getState(resourceId) {
    const normalizedResourceId = Number(resourceId);

    if (!Number.isInteger(normalizedResourceId) || normalizedResourceId < 1) {
      return null;
    }

    return getStateStatement.get(normalizedResourceId) || null;
  }

  function close() {
    db.close();
  }

  return {
    extractFile,
    indexResource,
    search,
    removeResource,
    getState,
    close
  };
}

module.exports = createResourceIndex;
