const required = ["DATABASE_URL", "JWT_SECRET", "FRONTEND_ORIGIN"] as const;

for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

if ((process.env.JWT_SECRET?.length ?? 0) < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters.");
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  frontendOrigin: process.env.FRONTEND_ORIGIN!,
  jwtSecret: process.env.JWT_SECRET!,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  isProduction: process.env.NODE_ENV === "production",
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_PASSWORD,
  smtpFrom: process.env.SMTP_FROM,
  appBaseUrl: process.env.APP_BASE_URL ?? process.env.FRONTEND_ORIGIN!
};
