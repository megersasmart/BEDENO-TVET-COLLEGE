# Build APK
1. Install Android Studio on a computer.
2. Open this `android` folder.
3. In `MainActivity.java`, replace `SERVER_URL` with your server address.
4. If the server is on the same Wi-Fi as the phone, use the PC LAN address, e.g. `http://192.168.1.10:3000`.
5. Sync Gradle.
6. Build > Build APK(s).
7. Install the generated APK on Android.

For a public internet server, set SERVER_URL to the HTTPS URL of the deployed server.
