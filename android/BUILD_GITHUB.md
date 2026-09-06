# BEDENO TVET COLLEGE — Cloud APK Build

This project includes GitHub Actions so the APK can be built in the cloud without Android Studio on your PC.

## 1. Upload project to GitHub
- Create a GitHub account if needed.
- Create a new repository, e.g. `bedeno-tvet-system`.
- Upload the contents of this project (including `.github/workflows/android-apk.yml`).

## 2. Set your server address
Open:
`android/app/src/main/java/com/bedenotvet/training/MainActivity.java`

Change:
`SERVER_URL="http://192.168.1.10:3000"`

to the real server URL. For a public HTTPS server, use e.g. `https://your-domain.example`.

## 3. Build APK in GitHub
- Open the repository.
- Go to **Actions**.
- Select **Build BEDENO TVET Android APK**.
- Click **Run workflow**.
- Wait for the green check.
- Open the completed workflow and download the artifact named **BEDENO-TVET-College-APK**.

## Important
- The Android app is a WebView client; the server must be reachable from the phone.
- A LAN address such as `192.168.x.x` works only while the phone and server computer are on the same network.
- For use from anywhere, deploy the Node.js server to a public HTTPS host and put that URL in `SERVER_URL`.
