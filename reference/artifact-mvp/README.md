# SiteGuard

Contractor compliance, safety files, and site operations for mining and industrial sites.

## What's in this folder
- `index.html` — the entire app. No build step, no dependencies to install.
- `manifest.json` — makes it installable as a Progressive Web App (PWA): "Add to Home Screen" on
  mobile, or "Install" from the browser address bar on desktop.
- `icons/` — app icons at the standard sizes (16, 32, 180, 192, 512px).

## Running it
**Quickest:** open `index.html` directly in a browser (double-click it). Most of the app works this
way. A few browsers restrict some features (like the AI drafting fetch call) when opened as a bare
`file://` page — if anything seems off, use one of the hosted options below instead.

**On GitHub Pages** (recommended for real testing):
1. Push this whole folder to a GitHub repo.
2. Repo → Settings → Pages → deploy from the branch/folder this is in.
3. Open the published URL. On a phone, open it in the browser and choose "Add to Home Screen" —
   it'll install and open like a native app, using the icon in `icons/`.

Any static host works the same way (Netlify, Vercel, Cloudflare Pages, S3 + CloudFront, etc.) — it's
just static files, nothing server-side required for the app itself.

## AI drafting (the "Generate with AI" document feature)
This needs a Claude API key when running outside claude.ai. Add yours under **Admin → AI settings**
in the app — it's stored only in your browser's local storage and sent directly from your browser to
Anthropic's API.

**Read this before you put it in front of anyone else:** that key is visible to anyone with access to
the page or its network requests (browser dev tools, anyone sharing the device). Fine for your own
testing. **Do not commit a real key into the GitHub repo** — anyone who can see the repo can see it.
For a real multi-user rollout, this call needs to move behind a small backend/proxy that holds the key
server-side instead. That's a different, fairly small project from this app itself.

## Data
Runs entirely in the browser for now — nothing is saved to a server. Refreshing the page keeps your
data (via browser storage) as long as you're on the same device and browser; it does not sync between
devices or between people. That's the next real piece of infrastructure this needs before multiple
people can use it together for real — see "Where to go from here."

## Where to go from here
**Desktop or mobile app**, roughly easiest to hardest:
1. **PWA install (already set up)** — on Android and desktop Chrome/Edge, "Install" gives a real app
   icon, its own window, and offline-ish behavior, for free, from what's already in this folder. On
   iOS, "Add to Home Screen" does the same, with a couple of Apple-specific limitations.
2. **PWABuilder** (pwabuilder.com) — feed it your hosted URL, it packages this into a Windows/Mac/
   Android/(more limited) iOS installer around the same PWA, with no code changes.
3. **Capacitor** (capacitorjs.com) — wraps this HTML/CSS/JS in a real native shell for iOS and Android,
   giving access to native device APIs (camera, push notifications, offline storage) this browser
   version can't reach. This is the standard path once you need real mobile-native features.
4. **Electron** — same idea, for a true desktop app (Windows/Mac/Linux) instead of a browser tab.

**The bigger, more important piece:** none of the above changes the fact that this still needs a real
backend before more than one person can use it together — today, every browser/device has its own
separate copy of the data. A backend (auth, a real database, multi-user sync) is a genuinely separate
build from wrapping the front-end into an app shell, and it's the thing that actually unlocks selling
this to more than one company at a time. Worth tackling before, or alongside, the app-store packaging
— an installed app with no shared backend is still a single-user demo, just in a nicer wrapper.
