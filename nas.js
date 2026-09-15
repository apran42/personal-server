const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const router = express.Router();

const nasRoot = process.env.NAS_ROOT
  ? path.resolve(process.env.NAS_ROOT)
  : path.join(process.env.HOME, "storage", "shared", "NAS");

const trashRoot = path.join(nasRoot, ".Trash");

fs.mkdirSync(nasRoot, { recursive: true });
fs.mkdirSync(trashRoot, { recursive: true });

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toPosixPath(value) {
  return value.replaceAll("\\", "/");
}

function isTrashPath(relativePath) {
  const normalized = toPosixPath(relativePath).replace(/^\/+|\/+$/g, "");

  return normalized === ".Trash" || normalized.startsWith(".Trash/");
}

function resolveNasPath(relativePath = "") {
  if (typeof relativePath !== "string" || isTrashPath(relativePath)) {
    throw createHttpError(400, "Invalid NAS path");
  }

  const target = path.resolve(nasRoot, relativePath);
  const rootPrefix = `${nasRoot}${path.sep}`;

  if (target !== nasRoot && !target.startsWith(rootPrefix)) {
    throw createHttpError(400, "Invalid NAS path");
  }

  return target;
}

function resolveTrashItem(itemId) {
  if (typeof itemId !== "string" || !/^\d+-[0-9a-f-]{36}$/i.test(itemId)) {
    throw createHttpError(400, "Invalid trash item");
  }

  const target = path.resolve(trashRoot, itemId);
  const trashPrefix = `${trashRoot}${path.sep}`;

  if (!target.startsWith(trashPrefix)) {
    throw createHttpError(400, "Invalid trash item");
  }

  return target;
}

function cleanFilename(filename) {
  const basename = path.basename(filename);

  const cleaned = basename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();

  return cleaned || "unnamed";
}

function createAvailableFilename(directory, originalFilename) {
  const cleanedName = cleanFilename(originalFilename);

  const extension = path.extname(cleanedName);

  const baseName = path.basename(cleanedName, extension);

  let candidate = cleanedName;
  let number = 1;

  while (fs.existsSync(path.join(directory, candidate))) {
    candidate = `${baseName} (${number})${extension}`;

    number += 1;
  }

  return candidate;
}

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function getSafeEntry(targetPath) {
  const stat = await fs.promises.lstat(targetPath);

  if (stat.isSymbolicLink()) {
    throw createHttpError(400, "Symbolic links are not supported");
  }

  return stat;
}

async function searchNasEntries(query) {
  const normalizedQuery = query.toLocaleLowerCase("ko-KR");

  const queue = [
    {
      absolutePath: nasRoot,
      relativePath: "",
      depth: 0
    }
  ];

  const results = [];
  let scannedEntries = 0;
  const maximumResults = 100;
  const maximumEntries = 10000;
  const maximumDepth = 12;

  while (
    queue.length > 0 &&
    results.length < maximumResults &&
    scannedEntries < maximumEntries
  ) {
    const current = queue.shift();

    const entries = await fs.promises.readdir(current.absolutePath, {
      withFileTypes: true
    });

    for (const entry of entries) {
      if (entry.name === ".Trash" || entry.isSymbolicLink()) {
        continue;
      }

      scannedEntries += 1;

      const absolutePath = path.join(current.absolutePath, entry.name);

      const relativePath = path.posix.join(current.relativePath, entry.name);

      if (entry.name.toLocaleLowerCase("ko-KR").includes(normalizedQuery)) {
        const stat = await fs.promises.lstat(absolutePath);

        results.push({
          name: entry.name,
          path: relativePath,

          type: entry.isDirectory() ? "directory" : "file",

          size: entry.isDirectory() ? null : stat.size,

          modifiedAt: stat.mtime.toISOString()
        });

        if (results.length >= maximumResults) {
          break;
        }
      }

      if (entry.isDirectory() && current.depth < maximumDepth) {
        queue.push({
          absolutePath,
          relativePath,
          depth: current.depth + 1
        });
      }

      if (scannedEntries >= maximumEntries) {
        break;
      }
    }
  }

  return {
    results,

    truncated:
      results.length >= maximumResults || scannedEntries >= maximumEntries
  };
}

function handleFileError(error, res, next) {
  if (error.status) {
    return res.status(error.status).json({
      error: error.message
    });
  }

  if (error.code === "ENOENT") {
    return res.status(404).json({
      error: "File or folder not found"
    });
  }

  if (error.code === "EEXIST") {
    return res.status(409).json({
      error: "A file or folder already exists"
    });
  }

  if (error.code === "EACCES" || error.code === "EPERM") {
    return res.status(403).json({
      error: "Permission denied"
    });
  }

  return next(error);
}

const storage = multer.diskStorage({
  destination(req, file, callback) {
    try {
      const destination = resolveNasPath(req.query.dir || "Uploads");

      fs.mkdirSync(destination, { recursive: true });
      callback(null, destination);
    } catch (error) {
      callback(error);
    }
  },

  filename(req, file, callback) {
    try {
      const directory = resolveNasPath(req.query.dir || "Uploads");

      const filename = createAvailableFilename(directory, file.originalname);

      callback(null, filename);
    } catch (error) {
      callback(error);
    }
  }
});

const upload = multer({
  storage,

  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 5,
    fields: 5,
    parts: 10,
    fieldArrayIndexLimit: 10
  },

  defParamCharset: "utf8"
});

router.get("/search", async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!query || query.length > 100) {
      throw createHttpError(
        400,
        "Search query must be between 1 and 100 characters"
      );
    }

    const searchResult = await searchNasEntries(query);

    return res.json({
      query,
      files: searchResult.results,
      truncated: searchResult.truncated
    });
  } catch (error) {
    return handleFileError(error, res, next);
  }
});

router.get("/files", async (req, res, next) => {
  try {
    const relativePath =
      typeof req.query.path === "string" ? req.query.path : "";

    const directory = resolveNasPath(relativePath);
    const directoryStat = await getSafeEntry(directory);

    if (!directoryStat.isDirectory()) {
      throw createHttpError(400, "Requested path is not a directory");
    }

    const entries = await fs.promises.readdir(directory, {
      withFileTypes: true
    });

    const visibleEntries = entries.filter(
      (entry) => entry.name !== ".Trash" && !entry.isSymbolicLink()
    );

    const files = await Promise.all(
      visibleEntries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);

        const stat = await fs.promises.lstat(fullPath);

        return {
          name: entry.name,

          path: path.posix.join(toPosixPath(relativePath), entry.name),

          type: entry.isDirectory() ? "directory" : "file",

          size: entry.isDirectory() ? null : stat.size,

          modifiedAt: stat.mtime.toISOString()
        };
      })
    );

    files.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "ko");
    });

    return res.json({
      path: toPosixPath(relativePath),
      files
    });
  } catch (error) {
    return handleFileError(error, res, next);
  }
});

router.post("/folder", async (req, res, next) => {
  try {
    const relativePath = typeof req.body.path === "string" ? req.body.path : "";

    const requestedName =
      typeof req.body.name === "string" ? req.body.name.trim() : "";

    if (!requestedName || requestedName.length > 100) {
      throw createHttpError(
        400,
        "Folder name must be between 1 and 100 characters"
      );
    }

    const folderName = cleanFilename(requestedName);

    if (folderName === "." || folderName === "..") {
      throw createHttpError(400, "Invalid folder name");
    }

    const folderPath = resolveNasPath(path.join(relativePath, folderName));

    await fs.promises.mkdir(folderPath);

    return res.status(201).json({
      name: folderName,

      path: path.posix.join(toPosixPath(relativePath), folderName)
    });
  } catch (error) {
    return handleFileError(error, res, next);
  }
});

router.patch("/entry", async (req, res, next) => {
  try {
    const relativePath = typeof req.body.path === "string" ? req.body.path : "";

    const requestedName =
      typeof req.body.name === "string" ? req.body.name.trim() : "";

    if (!relativePath) {
      throw createHttpError(400, "Path is required");
    }

    if (!requestedName || requestedName.length > 255) {
      throw createHttpError(400, "Name must be between 1 and 255 characters");
    }

    const sourcePath = resolveNasPath(relativePath);

    if (sourcePath === nasRoot) {
      throw createHttpError(400, "NAS root cannot be renamed");
    }

    await getSafeEntry(sourcePath);

    const newName = cleanFilename(requestedName);

    if (newName === "." || newName === "..") {
      throw createHttpError(400, "Invalid name");
    }

    const destinationPath = path.join(path.dirname(sourcePath), newName);

    if (await pathExists(destinationPath)) {
      throw createHttpError(
        409,
        "A file or folder with that name already exists"
      );
    }

    await fs.promises.rename(sourcePath, destinationPath);

    const parentRelative = path.dirname(toPosixPath(relativePath));

    return res.json({
      name: newName,

      path: path.posix.join(
        parentRelative === "." ? "" : parentRelative,
        newName
      )
    });
  } catch (error) {
    return handleFileError(error, res, next);
  }
});

router.post("/move", async (req, res, next) => {
  try {
    const sourceRelative =
      typeof req.body.path === "string" ? req.body.path : "";

    const destinationRelative =
      typeof req.body.destination === "string" ? req.body.destination : "";

    if (!sourceRelative) {
      throw createHttpError(400, "Path is required");
    }

    const sourcePath = resolveNasPath(sourceRelative);

    const destinationDirectory = resolveNasPath(destinationRelative);

    if (sourcePath === nasRoot) {
      throw createHttpError(400, "NAS root cannot be moved");
    }

    const sourceStat = await getSafeEntry(sourcePath);

    const destinationStat = await getSafeEntry(destinationDirectory);

    if (!destinationStat.isDirectory()) {
      throw createHttpError(400, "Destination is not a directory");
    }

    if (
      sourceStat.isDirectory() &&
      (destinationDirectory === sourcePath ||
        destinationDirectory.startsWith(`${sourcePath}${path.sep}`))
    ) {
      throw createHttpError(400, "A folder cannot be moved inside itself");
    }

    const destinationPath = path.join(
      destinationDirectory,
      path.basename(sourcePath)
    );

    if (await pathExists(destinationPath)) {
      throw createHttpError(409, "The destination already contains that name");
    }

    await fs.promises.rename(sourcePath, destinationPath);

    return res.json({
      path: path.posix.join(
        toPosixPath(destinationRelative),
        path.basename(sourcePath)
      )
    });
  } catch (error) {
    return handleFileError(error, res, next);
  }
});

router.delete("/entry", async (req, res, next) => {
  let trashItemPath = null;

  try {
    if (typeof req.query.path !== "string" || !req.query.path) {
      throw createHttpError(400, "Path is required");
    }

    const relativePath = req.query.path;
    const targetPath = resolveNasPath(relativePath);

    if (targetPath === nasRoot) {
      throw createHttpError(400, "NAS root cannot be deleted");
    }

    const stat = await getSafeEntry(targetPath);

    const itemId = `${Date.now()}-${crypto.randomUUID()}`;

    trashItemPath = resolveTrashItem(itemId);

    await fs.promises.mkdir(trashItemPath, { recursive: false });

    const contentPath = path.join(trashItemPath, "content");

    await fs.promises.rename(targetPath, contentPath);

    const metadata = {
      id: itemId,
      name: path.basename(targetPath),
      originalPath: toPosixPath(relativePath),
      type: stat.isDirectory() ? "directory" : "file",
      size: stat.isFile() ? stat.size : null,
      deletedAt: new Date().toISOString()
    };

    await fs.promises.writeFile(
      path.join(trashItemPath, "metadata.json"),
      JSON.stringify(metadata, null, 2),
      {
        encoding: "utf8",
        mode: 0o600
      }
    );

    return res.status(202).json(metadata);
  } catch (error) {
    if (trashItemPath) {
      const contentPath = path.join(trashItemPath, "content");

      if (await pathExists(contentPath)) {
        const metadataPath = path.join(trashItemPath, "metadata.json");

        if (!(await pathExists(metadataPath))) {
          console.error("Trash metadata creation failed:", trashItemPath);
        }
      }
    }

    return handleFileError(error, res, next);
  }
});

router.get("/trash", async (req, res, next) => {
  try {
    const entries = await fs.promises.readdir(trashRoot, {
      withFileTypes: true
    });

    const items = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      try {
        const itemPath = resolveTrashItem(entry.name);

        const metadata = JSON.parse(
          await fs.promises.readFile(
            path.join(itemPath, "metadata.json"),
            "utf8"
          )
        );

        items.push(metadata);
      } catch (error) {
        console.error("Invalid trash item:", entry.name, error.message);
      }
    }

    items.sort(
      (left, right) => new Date(right.deletedAt) - new Date(left.deletedAt)
    );

    return res.json({ items });
  } catch (error) {
    return handleFileError(error, res, next);
  }
});

router.post("/trash/restore", async (req, res, next) => {
  try {
    const itemPath = resolveTrashItem(req.body.id);

    const metadata = JSON.parse(
      await fs.promises.readFile(path.join(itemPath, "metadata.json"), "utf8")
    );

    const destinationPath = resolveNasPath(metadata.originalPath);

    if (await pathExists(destinationPath)) {
      throw createHttpError(409, "The original path is already in use");
    }

    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });

    await fs.promises.rename(path.join(itemPath, "content"), destinationPath);

    await fs.promises.rm(itemPath, { recursive: true });

    return res.json({
      restored: metadata.originalPath
    });
  } catch (error) {
    return handleFileError(error, res, next);
  }
});

router.delete("/trash/:id", async (req, res, next) => {
  try {
    const itemPath = resolveTrashItem(req.params.id);

    await fs.promises.rm(itemPath, {
      recursive: true,
      force: false
    });

    return res.status(204).end();
  } catch (error) {
    return handleFileError(error, res, next);
  }
});

router.get("/download", async (req, res, next) => {
  try {
    if (typeof req.query.path !== "string" || !req.query.path) {
      throw createHttpError(400, "Path is required");
    }

    const filePath = resolveNasPath(req.query.path);

    const stat = await getSafeEntry(filePath);

    if (!stat.isFile()) {
      throw createHttpError(400, "Requested path is not a file");
    }

    return res.download(filePath);
  } catch (error) {
    return handleFileError(error, res, next);
  }
});

router.post("/upload", upload.array("files", 5), (req, res) => {
  return res.status(201).json({
    uploaded: req.files.map((file) => ({
      name: file.filename,
      size: file.size
    }))
  });
});

module.exports = router;
