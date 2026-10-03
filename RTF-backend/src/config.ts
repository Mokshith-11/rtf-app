const required = ["DATABASE_URL", "JWT_SECRET"] as const;

for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

if ((process.env.JWT_SECRET?.length ?? 0) < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters.");
}

const isProduction = process.env.NODE_ENV === "production";
const configuredOrigins = process.env.FRONTEND_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
const renderExternalUrl = process.env.RENDER_EXTERNAL_URL?.trim();
if (renderExternalUrl) configuredOrigins.push(renderExternalUrl);
if (configuredOrigins.length === 0) configuredOrigins.push("http://localhost:4200");

const frontendOrigins = [...new Set(configuredOrigins.map((origin) => {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    url = new URL("http://localhost:4200");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    url = new URL(url.origin);
  }
  return url.origin;
}))];
const appBaseUrl = process.env.APP_BASE_URL ?? frontendOrigins[0];

export const config = {
  port: Number(process.env.PORT ?? 3000),
  frontendOrigins,
  jwtSecret: process.env.JWT_SECRET!,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  isProduction,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_PASSWORD,
  smtpFrom: process.env.SMTP_FROM,
  appBaseUrl
};
