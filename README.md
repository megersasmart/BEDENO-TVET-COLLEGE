# BEDENO TVET COLLEGE — Full Stack Training System

## Architecture
- Server: Node.js + Express + SQLite
- Client: responsive web UI (Android + PC browser)
- Android: WebView wrapper project (can be opened in Android Studio)
- Certificate: PENDING → College Responsible CHECK & APPROVE/REJECT → approved certificate can be verified/printed

## Local free deployment
1. Install Node.js 20+.
2. Open `server` in terminal.
3. Run `npm install`.
4. Run `npm start`.
5. On computer open `http://localhost:3000`.
6. For Android on the same Wi‑Fi, use the computer's LAN IP, e.g. `http://192.168.1.10:3000`.
7. Default admin: `admin` / `admin123` (change it before real use).

## Android
Open the `android` folder in Android Studio, set the server URL in `MainActivity.java`, then build APK.
The provided Android wrapper is intentionally simple: it loads the same responsive client, so one system serves both mobile and computer.
