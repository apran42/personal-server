const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

const router = express.Router();

const homeDirectory = process.env.HOME;
const appDirectory = path.join(homeDirectory, "apps", "myserver");
const nasRoot = process.env.NAS_ROOT
  ? path.resolve(process.env.NAS_ROOT)
  : path.join(
      homeDirectory,
      "storage",
      "shared",
      "NAS"
    );
const backupDirectory = path.join(appDirectory, "backups");
const backupLogPath = path.join(appDirectory, "logs", "backup.log");

function getLatestDatabaseBackup() {
  if (!fs.existsSync(backupDirectory)) {
    return null;
  }

  const backups = fs
    .readdirSync(backupDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /^server-.*\.db$/.test(entry.name)
    )
    .map((entry) => {
      const filePath = path.join(backupDirectory, entry.name);
      const stats = fs.statSync(filePath);

      return {
        name: entry.name,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        modifiedTime: stats.mtimeMs
      };
    })
    .sort(
      (first, second) =>
        second.modifiedTime - first.modifiedTime
    );

  if (backups.length === 0) {
    return null;
  }

  const latest = backups[0];

  return {
    name: latest.name,
    size: latest.size,
    modifiedAt: latest.modifiedAt,
    ageHours:
      (Date.now() - latest.modifiedTime) /
      (1000 * 60 * 60)
  };
}

function readLogTail(filePath, maximumBytes = 65536) {
  if (!fs.existsSync(filePath)) {
    return "";
  }

  const stats = fs.statSync(filePath);
  const readSize = Math.min(stats.size, maximumBytes);
  const startPosition = Math.max(0, stats.size - readSize);
  const descriptor = fs.openSync(filePath, "r");

  try {
    const buffer = Buffer.alloc(readSize);

    fs.readSync(
      descriptor,
      buffer,
      0,
      readSize,
      startPosition
    );

    return buffer.toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

function getCloudBackupStatus() {
  if (!fs.existsSync(backupLogPath)) {
    return {
      status: "unknown",
      updatedAt: null
    };
  }

  const log = readLogTail(backupLogPath);
  const normalizedLog = log.toLowerCase();

  const successIndex = normalizedLog.lastIndexOf(
    "cloud backup completed."
  );

  const failureIndexes = [
    normalizedLog.lastIndexOf("error"),
    normalizedLog.lastIndexOf("failed"),
    normalizedLog.lastIndexOf(
      "no local database backup found."
    ),
    normalizedLog.lastIndexOf(
      "uploaded database backup was not found."
    )
  ];

  const latestFailureIndex = Math.max(...failureIndexes);

  let status = "unknown";

  if (
    successIndex >= 0 &&
    successIndex > latestFailureIndex
  ) {
    status = "success";
  } else if (latestFailureIndex >= 0) {
    status = "failed";
  }

  return {
    status,
    updatedAt: fs
      .statSync(backupLogPath)
      .mtime
      .toISOString()
  };
}

function getBackupStatus() {
  const latestLocal = getLatestDatabaseBackup();
  const cloud = getCloudBackupStatus();

  return {
    latestLocal,
    cloud,
    stale:
      latestLocal === null ||
      latestLocal.ageHours > 26
  };
}

router.get("/status", (req, res, next) => {
  try {
    const memory = process.memoryUsage();
    const disk = fs.statfsSync(nasRoot);

    const diskTotal = disk.blocks * disk.bsize;
    const diskFree = disk.bavail * disk.bsize;

    res.json({
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        architecture: os.arch(),
        nodeVersion: process.version
      },

      uptime: {
        deviceSeconds: Math.floor(os.uptime()),
        serverSeconds: Math.floor(process.uptime())
      },

      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        serverRss: memory.rss
      },

      loadAverage: os.loadavg(),

      nasStorage: {
        total: diskTotal,
        free: diskFree,
        used: diskTotal - diskFree
      },

      backup: getBackupStatus(),

      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;