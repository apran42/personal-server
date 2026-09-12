const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const router = express.Router();

const nasRoot = path.join(
  process.env.HOME,
  "storage",
  "shared",
  "NAS"
);

fs.mkdirSync(nasRoot, { recursive: true });

function resolveNasPath(relativePath = "") {
  const target = path.resolve(nasRoot, relativePath);
  const rootPrefix = `${nasRoot}${path.sep}`;

  if (target !== nasRoot && !target.startsWith(rootPrefix)) {
    throw new Error("Invalid NAS path");
  }

  return target;
}

function cleanFilename(filename) {
  const basename = path.basename(filename);

  const cleaned = basename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim();

  return cleaned || "uploaded-file";
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
    const filename = cleanFilename(file.originalname);
    const uniquePrefix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

    callback(null, `${uniquePrefix}-${filename}`);
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

router.get("/files", async (req, res, next) => {
  try {
    const relativePath =
      typeof req.query.path === "string" ? req.query.path : "";

    const directory = resolveNasPath(relativePath);
    const entries = await fs.promises.readdir(directory, {
      withFileTypes: true
    });

    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        const stat = await fs.promises.stat(fullPath);

        return {
          name: entry.name,
          path: path.posix.join(
            relativePath.replaceAll("\\", "/"),
            entry.name
          ),
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

    res.json({
      path: relativePath,
      files
    });
  } catch (error) {
    next(error);
  }
});

router.post("/folder", async (req, res, next) => {
  try {
    const relativePath =
      typeof req.body.path === "string" ? req.body.path : "";

    const requestedName =
      typeof req.body.name === "string" ? req.body.name.trim() : "";

    if (!requestedName || requestedName.length > 100) {
      return res.status(400).json({
        error: "folder name must be between 1 and 100 characters"
      });
    }

    const folderName = cleanFilename(requestedName);

    if (folderName === "." || folderName === "..") {
      return res.status(400).json({
        error: "invalid folder name"
      });
    }

    const folderPath = resolveNasPath(
      path.join(relativePath, folderName)
    );

    await fs.promises.mkdir(folderPath);

    return res.status(201).json({
      name: folderName,
      path: path.posix.join(
        relativePath.replaceAll("\\", "/"),
        folderName
      )
    });
  } catch (error) {
    if (error.code === "EEXIST") {
      return res.status(409).json({
        error: "folder already exists"
      });
    }

    if (error.code === "ENOENT") {
      return res.status(404).json({
        error: "parent folder not found"
      });
    }

    return next(error);
  }
});

router.delete("/entry", async (req, res, next) => {
  try {
    if (typeof req.query.path !== "string" || !req.query.path) {
      return res.status(400).json({
        error: "path is required"
      });
    }

    const targetPath = resolveNasPath(req.query.path);

    if (targetPath === nasRoot) {
      return res.status(400).json({
        error: "NAS root cannot be deleted"
      });
    }

    const stat = await fs.promises.lstat(targetPath);

    if (stat.isDirectory()) {
      await fs.promises.rmdir(targetPath);
    } else {
      await fs.promises.unlink(targetPath);
    }

    return res.status(204).end();
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({
        error: "file or folder not found"
      });
    }

    if (error.code === "ENOTEMPTY") {
      return res.status(409).json({
        error: "folder is not empty"
      });
    }

    return next(error);
  }
});

router.get("/download", async (req, res, next) => {
  try {
    if (typeof req.query.path !== "string") {
      return res.status(400).json({
        error: "path is required"
      });
    }

    const filePath = resolveNasPath(req.query.path);
    const stat = await fs.promises.stat(filePath);

    if (!stat.isFile()) {
      return res.status(400).json({
        error: "not a file"
      });
    }

    return res.download(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({
        error: "file not found"
      });
    }

    return next(error);
  }
});

router.post(
  "/upload",
  upload.array("files", 5),
  (req, res) => {
    res.status(201).json({
      uploaded: req.files.map((file) => ({
        name: file.filename,
        size: file.size
      }))
    });
  }
);

module.exports = router;