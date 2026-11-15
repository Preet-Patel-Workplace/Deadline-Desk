# Deadline Desk

Track every assignment, quiz and exam in one list. Sign in with Google to see your list on every device. The **Add to calendar** button downloads all your upcoming deadlines as one `.ics` file. Each event has two reminders: 1 day before and 2 hours before.

It's a plain HTML/CSS/JS site with no build step. Hosting costs nothing: Vercel's Hobby plan and Firebase's Spark plan are both free.

---

## 1. Put it on GitHub

1. Go to https://github.com/new and create a repo (for example `deadline-desk`). Leave "Add a README" unchecked.
2. On the new repo page, click **uploading an existing file**.
3. Drag in all the files from this folder: `index.html`, `style.css`, `app.js`, `firebase-config.js`, `firestore.rules`, `README.md`.
4. Click **Commit changes**.

## 2. Set up Firebase (free, takes about 10 minutes)

1. Go to https://console.firebase.google.com and click **Create a project**. You can turn off Google Analytics.
2. **Turn on Google sign-in:** go to Build → **Authentication** → Get started → Sign-in method → **Google** → Enable → pick a support email → Save.
3. **Create the database:** go to Build → **Firestore Database** → Create database. Choose a location (for example `northamerica-northeast1` for Montréal), then pick **Start in production mode**.
4. **Add the security rules:** in Firestore, open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**. These rules make sure each person can only see their own deadlines.
5. **Get your config:** click the gear icon → Project settings → scroll to "Your apps" → click the **</>** (Web) icon → give it any nickname → Register. Copy the values in `firebaseConfig`.
6. On GitHub, open `firebase-config.js`, click the pencil icon, paste your values over the `PASTE_...` placeholders, and commit.

> Firebase web keys are meant to be public, so it's fine to have them on GitHub. Your data is protected by the rules from step 4.

## 3. Deploy on Vercel

1. Go to https://vercel.com, sign in with GitHub, and click **Add New → Project**.
2. Import your `deadline-desk` repo. Leave Framework Preset as **Other** with no build command. Click **Deploy**.
3. Copy your site address (for example `deadline-desk-abc.vercel.app`).
4. **Important:** back in Firebase, go to Authentication → **Settings** → **Authorized domains** → **Add domain**, and paste your Vercel domain (without `https://`). If you skip this, Google sign-in won't work.

Share the Vercel link with your friends. Each person signs in with their own Google account and gets their own private list.

From now on, every commit to GitHub redeploys the site automatically.

---

## How "Add to calendar" works

- It exports every deadline that is **not done and not past due**.
- It downloads `deadlines.ics`. Open the file to add the events:
  - **iPhone / Mac (Apple Calendar):** tap or open the file, then choose Add All. Both reminders are kept.
  - **Outlook:** open the file. Reminders are kept.
  - **Google Calendar:** on a computer, go to Settings → Import & export → Import, then choose the file. Note: Google Calendar ignores reminders inside imported files and uses your default notifications instead.
- Each event uses the deadline's title, course, due time, location and notes.
- If you export again later, some calendar apps may add duplicate copies of events you already imported.

## No Firebase?

If `firebase-config.js` still has the `PASTE_...` placeholders, the app still works. It saves deadlines in the browser on that device only, with no sign-in.

## Test locally

Use any static server, for example `npx serve .`, then open the address it prints. Opening `index.html` by double-clicking won't work because the browser blocks JavaScript modules on `file://` pages.
