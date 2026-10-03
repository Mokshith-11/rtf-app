# RTF — Radar Test Fields

RTF is a technical assessment platform MVP. It uses an Angular client, an Express REST API, PostgreSQL, and Prisma.

Use the sun/moon button in the header to switch between dark and light themes. The selected theme is saved in this browser and restored on return.

## MVP included

- Candidate registration and sign-in with non-unique batch numbers, Indian phone normalization, bcrypt password hashing, and secure, HTTP-only JWT cookies.
- Role-protected administrator APIs and administrator test creation.
- Candidate test list, server-enforced availability, IST scheduling, a server-timed attempt, automatic answer saving, submission, scoring, and result review.
- Candidate assessment/history views, read-only profile details, and a server-authorized printable admit card for scheduled assessments.
- Admin overview with tests, attendance/attempt status, and scores.
- PostgreSQL schema, development seed data, Docker Compose, and API notes.

Browser monitoring is a deterrent, not a guarantee against cheating. This MVP records tab visibility changes and does not claim to prevent other devices or browser workarounds.

## Requirements

- Node.js 20 or later and npm
- Docker Desktop (or a PostgreSQL 15+ server)

## Run locally

1. Copy `RTF-backend\.env.example` to `RTF-backend\.env` and set a long random `JWT_SECRET` and a development `DATABASE_URL`.
2. Start PostgreSQL with `docker compose up -d --wait db` from this directory, or point `DATABASE_URL` at an existing database.
3. In `RTF-backend`, run `npm install`, `npm run db:push`, `npm run db:seed`, and `npm run dev`.
4. In `RTF-frontend`, run `npm install` and `npm start`. The Angular development server proxies `/api` to the local Express service; the browser uses the same-origin API path.
5. Open `http://localhost:4200`. The API runs at `http://localhost:3000`.

The backend is a long-running web server, so `npm.cmd start` intentionally keeps that terminal session open. It now builds the latest TypeScript source automatically, then starts the API. When it prints `RTF API ready at http://localhost:3000`, it is running; confirm with `http://localhost:3000/api/health`. Keep the terminal open while using the app and press Ctrl+C when finished. Use `npm.cmd run dev` for development with automatic source reloads.

To share the development app with devices on the same trusted Wi-Fi/LAN, find this computer's private IPv4 address and start Angular with `npm start -- --host 0.0.0.0 --allowed-hosts YOUR_LAN_IP`. Give other devices `http://YOUR_LAN_IP:4200`. Keep both devices on the same trusted network. This development server is not a public Internet deployment; use a production HTTPS host and reverse proxy for that.

The seed command creates an administrator using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the backend environment, and adds a small sample assessment. Change seed credentials before sharing a development environment. Production must use HTTPS, a managed PostgreSQL service, strong secrets, and appropriately restricted CORS origins.

### Gmail password-reset email (local development)

The Forgot password form returns “Password reset email is not configured” until all SMTP settings are provided in `RTF-backend\.env`. For Gmail, enable 2-Step Verification on the sending Google account and create a Google App Password; use that app password (not your normal Gmail password). Set:

```dotenv
APP_BASE_URL=http://localhost:4200
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-sending-account@gmail.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM="RTF Password Reset <your-sending-account@gmail.com>"
```

Keep `.env` private and never paste SMTP credentials into chat or commit them. Restart the backend after changing `.env`. Then use Forgot password again and check the recipient inbox and spam folder. If using port 465 instead, set `SMTP_PORT=465` and `SMTP_SECURE=true`.

If SMTP cannot be used locally, stop the backend and run `npm run admin:reset-password` from `RTF-backend` in an interactive terminal. It asks for the account email, requires explicit confirmation, reads the new password without echoing it, and invalidates existing sessions. This operator recovery path requires local terminal and database access.

Candidate batch numbers are labels shared by everyone in the same cohort, not unique IDs; candidate email remains unique. Candidate phone numbers must be valid Indian mobile numbers and are stored as `+91` followed by the 10-digit number. Registration passwords require at least 8 letters, 4 digits, and 1 special character, with a maximum length of 128.

### Existing RTF database

If you already created the earlier MVP schema with a unique `candidateId` column, first back up the database, then run `RTF-backend\prisma\legacy-candidate-id-to-batch-number.sql` against it using `psql` or a PostgreSQL client. The script renames the old column (preserving values), removes the unique index, and creates a regular batch-number index. Then run `npm run db:push` from `RTF-backend`. Skip this data-migration step on a fresh database.

Candidate registration is intentionally open in this development MVP and assigns the candidate role only. Before public deployment, add invitations or host-approved enrollment and prevent unrestricted sign-up if assessments are private. Test creation accepts optional start/end instants; the admin form interprets entered date-times as Asia/Kolkata (IST), while the API stores instants and performs availability/deadline checks on the server. Unscheduled assessments are available immediately. Admin edits to assessments that have attempts create a new active revision and archive the old version, preserving its question content, attempts, and results. Deleting a used assessment archives it; only assessments with no attempts are permanently deleted.

## Production security checklist

- Require HTTPS, keep the database private, rotate strong secrets, and configure trusted origins.
- Add CSRF protection for cookie-authenticated deployments, verified contact details, and an audited candidate enrollment process. Configure a real SMTP provider before enabling email password reset.
- Add authorization and audit logging around every new admin or candidate management operation.
- Test concurrent submissions, timer expiry, scoring, result visibility, and account isolation against a non-production database.
- Provide privacy notices and retention rules for candidate data and security-event records.
- Treat browser visibility monitoring as evidence only; it cannot provide proctoring guarantees.

## Configuration

See `RTF-backend\.env.example`. Set `FRONTEND_ORIGIN` to the exact Angular origin. Configure `APP_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` to enable password reset emails; reset requests are disabled with a safe 503 until all SMTP settings are configured. Reset links expire after 30 minutes and are one-time use. Never commit `.env`. After updating the Prisma schema, run `npm run db:generate` and `npm run db:push` in the backend, then restart the API.

## API overview

All JSON endpoints are under `/api`. Sign-in and registration set an HTTP-only cookie; the browser sends it using credentials.

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | Register a candidate |
| POST | `/auth/login` | Public | Sign in |
| POST | `/auth/forgot-password` | Public, rate limited | Send a one-time password reset link without disclosing account existence |
| POST | `/auth/reset-password` | Public, rate limited | Redeem an expiring one-time reset token |
| POST | `/auth/logout` | Signed in | Clear session cookie |
| GET | `/auth/me` | Signed in | Current profile |
| GET | `/candidate/assessments` | Candidate | Assessment availability and own attempt/history summary |
| GET | `/admit-cards/:testId` | Candidate | Candidate's own eligible scheduled assessment admit card |
| GET | `/tests` | Candidate | List currently available tests |
| GET | `/tests/:id` | Candidate | View test instructions |
| POST | `/attempts` | Candidate | Start an available test |
| GET | `/attempts/:id` | Owner | Fetch attempt questions and saved answers |
| PUT | `/attempts/:id/answers/:questionId` | Owner | Save an answer |
| POST | `/attempts/:id/violations` | Owner | Record a tab-visibility event |
| POST | `/attempts/:id/submit` | Owner | Submit and calculate results |
| GET | `/results/:attemptId` | Owner or admin | Read a submitted result |
| GET | `/admin/overview` | Admin | View tests, attempt status, and scores |
| POST | `/admin/tests` | Admin | Create a test and its questions |
| PUT | `/admin/tests/:id` | Admin | Edit assessment and ordered questions; used tests are versioned |
| DELETE | `/admin/tests/:id` | Admin | Archive tests with attempts; permanently delete only unused tests |

Input is validated on the server. Questions returned during an attempt omit correct answers and explanations. Attempt ownership, test deadlines, scoring, and role checks are enforced by the API. Expand the admin API and UI before using RTF as a full production examination service.

The admin test-creation form accepts optional `startTime` and `endTime` as ISO-8601 timestamps with an explicit offset. The UI converts IST (`Asia/Kolkata`, UTC+05:30) entries to ISO timestamps. The server rejects invalid ranges, enforces availability, and caps each attempt deadline at the earlier of `startedAt + durationMinutes` or `endTime`. Admin overview reports `SCHEDULED`, `ACTIVE`, or `CLOSED` based on the stored times; a separate draft/publish state is not present in the current schema.

The candidate assessment endpoint returns only the signed-in candidate's attempt summary. Scores are omitted from that summary when `showResults` is disabled. Admit cards are limited to a candidate's own assessment eligibility and do not include question or answer-key data; the current schema has no configurable instruction field, so the card displays the assessment description and standard instructions.
