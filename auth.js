const crypto = require("crypto");

const username = process.env.SERVER_USERNAME;
const password = process.env.SERVER_PASSWORD;

if (!username || !password) {
  throw new Error("SERVER_USERNAME and SERVER_PASSWORD are required");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function basicAuth(req, res, next) {
  const authorization = req.headers.authorization || "";

  if (authorization.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(
        authorization.slice(6),
        "base64"
      ).toString("utf8");

      const separator = decoded.indexOf(":");
      const inputUsername = decoded.slice(0, separator);
      const inputPassword = decoded.slice(separator + 1);

      if (
        separator >= 0 &&
        safeEqual(inputUsername, username) &&
        safeEqual(inputPassword, password)
      ) {
        return next();
      }
    } catch {
      // 아래의 인증 요청 응답으로 처리합니다.
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Note10 Server"');

  return res.status(401).json({
    error: "authentication required"
  });
}

module.exports = basicAuth;
