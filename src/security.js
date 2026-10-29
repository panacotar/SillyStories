const { randomBytes, timingSafeEqual } = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

function installSecurity(app, { production, publicOrigin, trustProxy }) {
  app.disable("x-powered-by");
  // Exactly one proxy in production: Caddy. The app has no published port.
  app.set("trust proxy", trustProxy);
  app.use(helmet({
    // no-referrer makes Firefox send Origin: null for native form POSTs,
    // which our CSRF origin check correctly rejects. Keep same-origin form
    // origins while still withholding referrers from external sites.
    referrerPolicy: { policy: "same-origin" },
    contentSecurityPolicy: {
      directives: {
        "script-src": ["'self'"],
        "style-src": ["'self'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": production ? [] : null,
      },
    },
    strictTransportSecurity: production
      ? { maxAge: 31_536_000, includeSubDomains: false }
      : false,
  }));

  app.use(rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.path === "/healthz",
    message: "Too many requests. Please try again shortly.",
  }));
  app.use(express.static("public", { dotfiles: "deny" }));
  // Percent-encoded Unicode can use nine bytes per UTF-16 code unit. Leave room
  // for all validated fields and CSRF; keep this cap aligned with Caddy.
  app.use(express.urlencoded({
    extended: false, limit: 32 * 1024, parameterLimit: 10, inflate: false,
  }));

  const cookieName = production ? "__Host-silly-csrf" : "silly-csrf";
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.path === "/healthz") return next();

    const cookie = (req.headers.cookie || "").split(";")
      .map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
    const token = cookie?.slice(cookieName.length + 1);
    const validCookie = typeof token === "string" && /^[a-f0-9]{64}$/.test(token);

    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const submitted = req.body?._csrf;
      if (req.get("Sec-Fetch-Site") === "cross-site" ||
          (req.get("Origin") && publicOrigin && req.get("Origin") !== publicOrigin) ||
          !validCookie || typeof submitted !== "string" ||
          !/^[a-f0-9]{64}$/.test(submitted) ||
          !timingSafeEqual(Buffer.from(token), Buffer.from(submitted))) {
        return res.status(403).send("Please reload the page and submit the form again.");
      }
    }

    res.locals.csrfToken = validCookie ? token : randomBytes(32).toString("hex");
    if (!validCookie) {
      res.cookie(cookieName, res.locals.csrfToken, {
        httpOnly: true, secure: production, sameSite: "strict", path: "/",
      });
    }
    next();
  });
}

const submissionLimiter = () => rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Too many submissions. Please wait a minute and try again.",
});

function validateSubmission(body) {
  if (typeof body?.message !== "string" ||
      body.message.trim().length < 5 || body.message.trim().length > 2000) {
    return "Your sentence must contain between 5 and 2,000 characters.";
  }
  if (body.fName !== undefined &&
      (typeof body.fName !== "string" || body.fName.length > 100)) {
    return "Your name must contain at most 100 characters.";
  }
  if (body.email !== undefined &&
      (typeof body.email !== "string" || body.email.length > 254 ||
        (body.email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)))) {
    return "Please enter a valid email address.";
  }
  return null;
}

module.exports = { installSecurity, submissionLimiter, validateSubmission };
