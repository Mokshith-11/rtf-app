RTF PROJECT — COMMAND REFERENCE

1. PROJECT PATHS

Frontend
C:\Users\tirup\OneDrive\Desktop\New folder\RTF-frontend

Backend
C:\Users\tirup\OneDrive\Desktop\New folder\RTF-backend

2. BACKEND — START LOCAL SERVER

Open PowerShell:

cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-backend"

Install dependencies:

npm install

Start backend:

npm start

Backend URL:

http://localhost:3000

Health check:

http://localhost:3000/api/health

Development mode:

npm.cmd run dev


3. FRONTEND — START LOCAL SERVER

Open a second terminal:

cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-frontend"

Install dependencies:

npm install

Start Angular:

npm start

Frontend URL:

http://localhost:4200

4. LOCAL APPLICATION FLOW
Browser
    |
    v
http://localhost:4200
    |
    v
Angular Frontend
    |
    | /api
    v
http://localhost:3000
    |
    v
Node / Express Backend
    |
    v
Prisma
    |
    v
PostgreSQL
localhost:5432
    |
    v
Database: rtf

5. POSTGRESQL — CHECK SERVER

Check PostgreSQL service:

Get-Service *postgres*

Check PostgreSQL port:

netstat -ano | findstr :5432

6. POSTGRESQL — CONNECT USING PSQL

Command:

psql -h localhost -p 5432 -U rtf -d rtf

When it asks:

Password for user rtf:

Enter:

rtf_dev_only
Database details
Host     : localhost
Port     : 5432
Database : rtf
User     : rtf
Password : rtf_dev_only

After successful login:

rtf=>
7. DATABASE CONNECTION STRING

The current local connection string is:

DATABASE_URL=postgresql://rtf:rtf_dev_only@localhost:5432/rtf?schema=public
8. PSQL — VIEW ALL TABLES

Inside PostgreSQL:

\dt

Current tables:

Answer
Attempt
Attendance
PasswordResetToken
Question
Test
User

If you see:

-- More --

press:

q
9. PSQL — VIEW TABLE STRUCTURE
User
\d "User"
Test
\d "Test"
Question
\d "Question"
Attempt
\d "Attempt"
Answer
\d "Answer"
Attendance
\d "Attendance"
Password Reset
\d "PasswordResetToken"
10. PSQL — VIEW STORED DATA
Users
SELECT * FROM "User";
Tests
SELECT * FROM "Test";
Questions
SELECT * FROM "Question";
Attempts
SELECT * FROM "Attempt";
Answers
SELECT * FROM "Answer";
Attendance
SELECT * FROM "Attendance";
Password Reset Tokens
SELECT * FROM "PasswordResetToken";

These are read-only inspection commands.

11. DATABASE HEALTH / RECORD COUNT

Run:

SELECT 'Users' AS table_name, COUNT(*) AS records FROM "User"
UNION ALL
SELECT 'Tests', COUNT(*) FROM "Test"
UNION ALL
SELECT 'Questions', COUNT(*) FROM "Question"
UNION ALL
SELECT 'Attempts', COUNT(*) FROM "Attempt"
UNION ALL
SELECT 'Answers', COUNT(*) FROM "Answer"
UNION ALL
SELECT 'Attendance', COUNT(*) FROM "Attendance"
UNION ALL
SELECT 'PasswordResetToken', COUNT(*) FROM "PasswordResetToken";

This gives a quick overview of how many records exist in each table.

12. EXIT PSQL

Inside psql:

\q
13. PRISMA STUDIO — VISUAL DATABASE

Prisma Studio is the visual browser interface for your PostgreSQL database.

Open backend:

cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-backend"

Start Prisma Studio:

npx prisma studio

Open:

http://localhost:5555

You can visually inspect:

User
Test
Question
Attempt
Answer
Attendance
PasswordResetToken
14. PRISMA DATABASE SYNCHRONIZATION

From the backend:

cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-backend"

Synchronize schema:

npm run db:push

Generate Prisma Client:

npx prisma generate

Restart backend:

npm start
15. VIEW AVAILABLE NPM COMMANDS

From backend:

npm run

This shows all scripts available in the project's package.json.

16. COMPLETE LOCAL STARTUP
Terminal 1 — Backend
cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-backend"
npm start

Backend:

http://localhost:3000

Health:

http://localhost:3000/api/health
Terminal 2 — Frontend
cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-frontend"
npm start

Frontend:

http://localhost:4200
Terminal 3 — Prisma Studio
cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-backend"
npx prisma studio

Prisma Studio:

http://localhost:5555
Terminal 4 — PostgreSQL
psql -h localhost -p 5432 -U rtf -d rtf

Password:

rtf_dev_only
17. IMPORTANT LOCAL URLS
Component	URL
Frontend	http://localhost:4200
Backend	http://localhost:3000
Backend Health	http://localhost:3000/api/health
Prisma Studio	http://localhost:5555
PostgreSQL	localhost:5432
18. LAN TESTING

Find your computer's local IP:

ipconfig

Start Angular for LAN access:

npm start -- --host 0.0.0.0 --allowed-hosts YOUR_LAN_IP

Other device on the same trusted network:

http://YOUR_LAN_IP:4200

This is for development/LAN testing, not public Internet hosting.

19. ADMIN PASSWORD RECOVERY

From backend:

cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-backend"

Run:

npm run admin:reset-password

The script can ask for the account email and new password interactively.

20. PASSWORD RESET / SMTP

The project supports password-reset email configuration.

Local base URL:

APP_BASE_URL=http://localhost:4200

Example Gmail configuration:

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-sending-account@gmail.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM="RTF Password Reset <your-sending-account@gmail.com>"

After changing .env:

npm start

Keep .env private.

21. PRODUCTION FRONTEND BUILD
cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-frontend"

Install:

npm install

Build:

npm run build

The generated Angular production files can then be deployed to your selected hosting service.

22. PRODUCTION BACKEND BUILD
cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-backend"

Install:

npm install

Build:

npm run build

Start:

npm start
23. PRODUCTION DATABASE

For hosting, use a separate production PostgreSQL database.

Example:

DATABASE_URL=postgresql://PRODUCTION_USER:PRODUCTION_PASSWORD@PRODUCTION_HOST:5432/PRODUCTION_DATABASE?schema=public

Do not use the local development password:

rtf_dev_only

for production.

24. PRODUCTION ARCHITECTURE
                 USER
                  |
                  v
        Production Frontend
                  |
                  v
        Production Backend
                  |
                  v
                Prisma
                  |
                  v
       Managed PostgreSQL

The PostgreSQL database should remain private and should not be directly exposed to normal users.

25. SAFE DATABASE INSPECTION

These commands are safe for viewing database information:

\dt
\d "User"
\d "Test"
\d "Attempt"
SELECT * FROM "User";
SELECT * FROM "Test";
SELECT * FROM "Attempt";
SELECT * FROM "Answer";
26. DO NOT RUN THESE DURING NORMAL INSPECTION

Be careful with:

DROP
DELETE
TRUNCATE
ALTER
UPDATE

These commands can modify or remove database information.

27. SECURITY REMINDER

Never commit the following to a public GitHub repository:

DATABASE_URL
DATABASE PASSWORD
ADMIN_PASSWORD
JWT_SECRET
SMTP_PASSWORD
API KEYS

For production:

Use HTTPS.
Use a managed PostgreSQL database.
Use strong production passwords.
Use a strong random JWT_SECRET.
Keep PostgreSQL private.
Configure trusted CORS origins.
Use separate production credentials.
28. QUICK REFERENCE
Start Backend
cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-backend"
npm start
Start Frontend
cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-frontend"
npm start
Open Application
http://localhost:4200
Check Backend
http://localhost:3000/api/health
Open Prisma Studio
cd "C:\Users\tirup\OneDrive\Desktop\New folder\RTF-backend"
npx prisma studio
http://localhost:5555
Connect PostgreSQL
psql -h localhost -p 5432 -U rtf -d rtf
PostgreSQL Password
rtf_dev_only
PostgreSQL Database
rtf
PostgreSQL User
rtf
PostgreSQL Host
localhost
PostgreSQL Port
5432
Exit PostgreSQL
\q
Sync Prisma
npm run db:push
Generate Prisma Client
npx prisma generate
Admin Password Recovery
npm run admin:reset-password
FINAL LOCAL SETUP
PostgreSQL
    ↓
localhost:5432
    ↓
rtf database
    ↓
Prisma
    ↓
Node/Express Backend
    ↓
localhost:3000
    ↓
Angular Frontend
    ↓
localhost:4200
    ↓
Browser

For database visualization:

PostgreSQL
    ↓
Prisma
    ↓
Prisma Studio
    ↓
http://localhost:5555

This is the complete command reference for your current RTF project.