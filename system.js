const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

const router = express.Router();

const nasRoot = path.join(
  process.env.HOME,
  "storage",
  "shared",
  "NAS"
);

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

      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;