# Tide — Daily Progress

Tide is a responsive, installable Progressive Web App for tracking study time, daily habits, and progress over time. It is designed to be calm and uncluttered, with a white background and muted sea-green / turquoise accents.

## What is included

- **Overview:** today's study minutes, habit completion, consistency streak, and an hourly study graph.
- **Study tracker:** a dedicated 24-hour grid. Each hour column has seven checkbox choices: 0, 10, 20, 30, 40, 50, or 60 minutes. Choose exactly one duration for each hour (for example, select 40 in the 04–05 column). The grid is horizontally scrollable on phones.
- **Context tags:** use the multi-select dropdown for Food (circle), Prayer (square), Important works (triangle), and Wasting time (cross). Tags have bold, dark outlines, can be selected together, and never count as study time. Existing free-text tags from older backups are retained.
- **Daily habits:** a weekly matrix with habit names on the left and seven vertical day columns on the right. Today is highlighted; previous days are softened but remain editable for backfilling. Habits are editable and grouped into Salah, Faith, Learning, Work, Personal, or any group you create. The initial list includes five salah, Quran, Study, IELTS, GRE, Research, Tuition, and Porn-free day.
- **Progress reports:** a checkpoint pop-up appears when you next open Tide after each 3-day milestone. The reports page also includes 7-day and 30-day cycles. Reports compare average study minutes per day and average habit completion with Day 1, the first completed period, and the immediately preceding period when available.
- **Hourly check-in:** while the app is open, a small check-in can appear at the top of each hour. It lets you choose the previous hour's total study duration in one tap and add multiple context tags from the same shape-coded dropdown.
- **Appearance:** a soft glassmorphism interface with subtle peach, lilac, and sea-green gradients, translucent cards, gentle shadows, and clear typography. The persisted dark theme uses coordinated deep plum, slate, and sea-green colors with readable text, controls, charts, and tracker cells.
- **Offline-first storage:** records are saved locally in the browser and remain available offline after the app has been loaded once.
- **Optional cloud sync:** Supabase email sign-in syncs data across devices. The same project URL, public anon/publishable key, and email must be used on each device.
- **Backup:** export and import a JSON backup at any time.

## Habit matrix and context tags

The Daily Habits page shows the most recent seven days. Each row is one habit and each vertical checkbox column is one day. Today is highlighted; previous days are muted for visual focus but remain clickable so you can backfill missed entries. Future dates are not shown in this weekly view.

The Study Tracker context-tag dropdown supports multiple selections per hour: Food is a filled circle, Prayer is a filled square, Important works is a filled triangle, and Wasting time is a cross. The shapes use vibrant fills and a dark outline so they remain distinguishable in both themes. Tags explain how an hour was used and do not change the study-minute total.

## Important interpretation of the study grid

The study grid has **24 hour columns × 7 duration rows**. The rows are 0, 10, 20, 30, 40, 50, and 60 minutes. Select one checkbox in each hour column; the app treats the choices as mutually exclusive, so selecting 40 minutes for 04–05 records exactly 40 minutes for that hour. This gives 168 checkbox cells per day and keeps each hour capped at 60 minutes.

## 1. Preview locally

For a quick local preview, open `index.html` in a modern browser. Local progress tracking works, but PWA installation, offline service-worker caching, and cloud sign-in require the app to be served over HTTPS (or localhost).

For a local development server, from this folder run:

```bash
py -m http.server 8000  # Windows
# or: python -m http.server 8000
```

Then open `http://localhost:8000`.

## 2. Host it so PC and mobile can use the same app

The app is a static website. A simple option is Netlify:

1. Create a free Netlify account.
2. Choose **Add new site → Deploy manually**.
3. Drag the contents of this folder into the deploy area (or upload the ZIP contents).
4. Netlify will provide an HTTPS URL. Keep that URL; use it on your PC and phone.

You can also host it on GitHub Pages or another static HTTPS host. Do not change the relative paths to `app.js`, `styles.css`, `manifest.webmanifest`, or `sw.js`.

## 3. Set up cross-device sync (one-time cloud setup)

Tide uses Supabase. The app does not send data to a cloud service until you configure it and sign in.

1. Create a Supabase project at https://supabase.com.
2. In the Supabase dashboard, open **SQL Editor**.
3. Open `supabase-schema.sql` from this folder, copy its contents into a new SQL query, and run it.
4. In Supabase **Project Settings → API**, copy the Project URL and the public anon/publishable key. Do not use a service-role/secret key in the browser.
5. In **Authentication → URL Configuration**, add your hosted Tide HTTPS URL to the allowed Redirect URLs (and set it as the Site URL if this is your only app).
6. Open your hosted Tide URL, go to **Settings & sync**, paste the Project URL and public key, enter your email, and choose **Save & send sign-in link**.
7. Open the magic link from that device to finish signing in.
8. Open the same Tide URL on your other device, enter the same Project URL, public key, and email, and sign in with the emailed link.

After both devices are signed in, changes sync automatically when online. Local records continue to work if the network is unavailable; they sync when the device reconnects. If two devices edit the same data while offline, the most recently updated copy wins when they reconnect. Export backups periodically.

## 4. Choose a theme

Use the **Dark theme** switch at the top-right of the fixed top bar. The choice is saved locally on the device and remains active after reloads and offline use. Tide uses explicit dark color tokens rather than inversion so text, controls, cards, charts, and study-tracker cells remain readable.

## 5. Install on devices

- **Windows / Edge or Chrome:** open the hosted URL and use the install icon in the address bar (or browser menu → Install this site as an app).
- **Android:** open the hosted URL in Chrome → menu → Add to Home screen / Install app.
- **iPhone:** open the hosted URL in Safari → Share → Add to Home Screen.

## 6. Launch automatically when Windows starts

After the app is hosted, open PowerShell in this folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-startup-windows.ps1
```

Paste your hosted HTTPS URL when prompted. This creates a shortcut in your Windows Startup folder, so Tide opens when you sign in. To undo it, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-startup-windows.ps1
```

This is a one-time Windows setup. Windows may still display its normal startup/app notices depending on your system settings.

## Reminder limitations

A normal browser/PWA cannot reliably execute a JavaScript timer while it is fully closed. Tide's hourly in-app reminders work while the app is open (including many minimized/background cases, subject to browser throttling). If browser notifications are enabled, the app can show a system notification while running in the background. A one-time browser/OS notification permission is required. The Windows Startup shortcut helps keep the app available after sign-in.

## Data and privacy

- Without cloud sync configured, tracking data stays in the browser's local storage on that device.
- With Supabase configured, the app stores one JSON payload per signed-in user in `public.progress_data`, protected by row-level security.
- The public anon/publishable key is designed for browser use when row-level security is enabled. Never put a Supabase service-role key in this app.
- Use **Settings & sync → Export** to download a backup.
