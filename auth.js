const crypto = require("crypto");

const username = process.env.SERVER_USERNAME;
const password = process.env.SERVER_PASSWORD;

if (!username || !password) {
  throw new Error("SERVER_USERNAME and SERVER_PASSWORD are required");
}

const authenticationAttempts = new Map();

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_DURATION_MS = 15 * 60 * 1000;
const MAXIMUM_FAILURES = 10;

function getClientKey(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function getAttemptState(clientKey, now) {
  const existing = authenticationAttempts.get(clientKey);

  if (!existing) {
    return {
      failures: 0,
      windowStartedAt: now,
      blockedUntil: 0
    };
  }

  if (
    existing.blockedUntil <= now &&
    now - existing.windowStartedAt > ATTEMPT_WINDOW_MS
  ) {
    authenticationAttempts.delete(clientKey);

    return {
      failures: 0,
      windowStartedAt: now,
      blockedUntil: 0
    };
  }

  return existing;
}

function recordAuthenticationFailure(clientKey, now) {
  const state = getAttemptState(clientKey, now);

  if (now - state.windowStartedAt > ATTEMPT_WINDOW_MS) {
    state.failures = 0;
    state.windowStartedAt = now;
  }

  state.failures += 1;

  if (state.failures >= MAXIMUM_FAILURES) {
    state.blockedUntil = now + BLOCK_DURATION_MS;
  }

  authenticationAttempts.set(clientKey, state);

  return state;
}

function clearAuthenticationFailures(clientKey) {
  authenticationAttempts.delete(clientKey);
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
  const clientKey = getClientKey(req);
  const now = Date.now();

  const currentState = getAttemptState(clientKey, now);

  if (currentState.blockedUntil > now) {
    const retryAfterSeconds = Math.ceil(
      (currentState.blockedUntil - now) / 1000
    );

    res.set("Retry-After", String(retryAfterSeconds));

    return res.status(429).json({
      error: "too many authentication failures",
      retryAfterSeconds
    });
  }

  const authorization = req.headers.authorization || "";

  if (authorization.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString(
        "utf8"
      );

      const separator = decoded.indexOf(":");

      if (separator >= 0) {
        const inputUsername = decoded.slice(0, separator);

        const inputPassword = decoded.slice(separator + 1);

        if (
          safeEqual(inputUsername, username) &&
          safeEqual(inputPassword, password)
        ) {
          clearAuthenticationFailures(clientKey);
          return next();
        }
      }
    } catch {
      // 일반 인증 실패로 처리합니다.
    }
  }

  const updatedState = recordAuthenticationFailure(clientKey, now);

  if (updatedState.blockedUntil > now) {
    res.set("Retry-After", String(Math.ceil(BLOCK_DURATION_MS / 1000)));

    return res.status(429).json({
      error: "too many authentication failures",
      retryAfterSeconds: Math.ceil(BLOCK_DURATION_MS / 1000)
    });
  }

  res.set("WWW-Authenticate", 'Basic realm="Note10 Server"');

  return res.status(401).json({
    error: "authentication required",
    remainingAttempts: MAXIMUM_FAILURES - updatedState.failures
  });
}

module.exports = basicAuth;
