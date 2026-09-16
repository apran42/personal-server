const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const router = express.Router();

const homeDirectory = process.env.HOME;
const appDirectory = path.join(homeDirectory, "apps", "myserver");
const nasRoot = process.env.NAS_ROOT
  ? path.resolve(process.env.NAS_ROOT)
  : path.join(homeDirectory, "storage", "shared", "NAS");
const backupDirectory = path.join(appDirectory, "backups");
const backupLogPath = path.join(appDirectory, "logs", "backup.log");

function getLatestDatabaseBackup() {
  if (!fs.existsSync(backupDirectory)) {
    return null;
  }

  const backups = fs
    .readdirSync(backupDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^server-.*\.db$/.test(entry.name))
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
    .sort((first, second) => second.modifiedTime - first.modifiedTime);

  if (backups.length === 0) {
    return null;
  }

  const latest = backups[0];

  return {
    name: latest.name,
    size: latest.size,
    modifiedAt: latest.modifiedAt,
    ageHours: (Date.now() - latest.modifiedTime) / (1000 * 60 * 60)
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

    fs.readSync(descriptor, buffer, 0, readSize, startPosition);

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

  const successIndex = normalizedLog.lastIndexOf("cloud backup completed.");

  const failureIndexes = [
    normalizedLog.lastIndexOf("error"),
    normalizedLog.lastIndexOf("failed"),
    normalizedLog.lastIndexOf("no local database backup found."),
    normalizedLog.lastIndexOf("uploaded database backup was not found.")
  ];

  const latestFailureIndex = Math.max(...failureIndexes);

  let status = "unknown";

  if (successIndex >= 0 && successIndex > latestFailureIndex) {
    status = "success";
  } else if (latestFailureIndex >= 0) {
    status = "failed";
  }

  return {
    status,
    updatedAt: fs.statSync(backupLogPath).mtime.toISOString()
  };
}

function getBackupStatus() {
  const latestLocal = getLatestDatabaseBackup();
  const cloud = getCloudBackupStatus();

  return {
    latestLocal,
    cloud,
    stale: latestLocal === null || latestLocal.ageHours > 26
  };
}
function normalizeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

async function getBatteryStatus() {
  try {
    const result = await execFileAsync("termux-battery-status", [], {
      timeout: 5000,
      maxBuffer: 64 * 1024
    });

    const battery = JSON.parse(result.stdout);

    return {
      available: true,
      percentage: normalizeNumber(battery.percentage),
      status: battery.status || "UNKNOWN",
      health: battery.health || "UNKNOWN",
      plugged: battery.plugged || "UNKNOWN",
      temperatureC: normalizeNumber(battery.temperature),
      currentMicroamps: normalizeNumber(battery.current),
      currentAverageMicroamps: normalizeNumber(battery.current_average)
    };
  } catch (error) {
    let reason = "Termux:API request failed";

    if (error.code === "ENOENT") {
      reason = "termux-api command is not installed";
    } else if (error.killed || error.signal === "SIGTERM") {
      reason = "Termux:API request timed out";
    } else if (error instanceof SyntaxError) {
      reason = "Termux:API returned invalid JSON";
    }

    return {
      available: false,
      reason
    };
  }
}
async function getWifiStatus() {
  try {
    const result = await execFileAsync("termux-wifi-connectioninfo", [], {
      timeout: 5000,
      maxBuffer: 64 * 1024
    });

    const wifi = JSON.parse(result.stdout);
    const frequencyMhz = normalizeNumber(wifi.frequency_mhz);
    const rssi = normalizeNumber(wifi.rssi);
    const linkSpeedMbps = normalizeNumber(wifi.link_speed_mbps);
    const supplicantState = wifi.supplicant_state || "UNKNOWN";

    return {
      available: true,
      connected:
        supplicantState === "COMPLETED" &&
        frequencyMhz !== null &&
        frequencyMhz > 0,
      supplicantState,
      frequencyMhz,
      linkSpeedMbps,
      rssi,
      ssid: wifi.ssid || null,
      ip: wifi.ip || null
    };
  } catch (error) {
    let reason = "Termux:API Wi-Fi request failed";

    if (error.code === "ENOENT") {
      reason = "termux-api command is not installed";
    } else if (error.killed || error.signal === "SIGTERM") {
      reason = "Termux:API Wi-Fi request timed out";
    } else if (error instanceof SyntaxError) {
      reason = "Termux:API returned invalid Wi-Fi JSON";
    }

    return {
      available: false,
      reason
    };
  }
}
router.get("/status", async (req, res, next) => {
  try {
    const memory = process.memoryUsage();
    const disk = fs.statfsSync(nasRoot);

    const diskTotal = disk.blocks * disk.bsize;
    const diskFree = disk.bavail * disk.bsize;
    const [battery, wifi] = await Promise.all([
      getBatteryStatus(),
      getWifiStatus()
    ]);

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

      phone: {
        battery,
        wifi
      },

      backup: getBackupStatus(),

      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
