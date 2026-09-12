const express = require("express");

const app = express();
const port = 8000;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Note10 server is running",
    device: "Galaxy Note10"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString()
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});
