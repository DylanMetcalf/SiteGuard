# COMVERA on Windows and macOS

## Today: install the web app (no extra work)

COMVERA is a Progressive Web App. On a Windows PC or a Mac, open COMVERA in **Chrome** or **Edge**
and choose **Install COMVERA** (the install icon at the right of the address bar, or **⋮ → Cast, save
and share → Install page as app**). It then has its own window, Start-menu/Dock icon and taskbar
entry, and updates itself whenever COMVERA is updated. Safari on macOS: **File → Add to Dock**.

On phones and tablets: **Share → Add to Home Screen** (iPhone/iPad) or **⋮ → Install app** (Android).

## Later: a packaged desktop app, without rewriting COMVERA

The architecture already suits a thin native wrapper:

| What a wrapper needs | Where COMVERA stands |
|---|---|
| One web origin serving the app and its API | Yes: the server serves `/` and `/api/*` from the same address |
| Sign-in that works inside a webview | Yes: an HTTP-only session cookie on that origin, CSRF token in the page |
| No browser-only features required | The app uses standard fetch, file inputs, downloads and print; the service worker is optional |
| Icons in every size | `public/icons/icon-1024.png` (macOS .icns is generated from it), `public/favicon.ico` (Windows, 16–48 px), `icon-256.png` |
| Responsive layouts | Phone, tablet and desktop widths are designed and tested |
| Predictable navigation | One page app; links such as `/pricing`, `/review/…`, `/invite?token=…` open the right screen |

**Recommended route when it is needed: Tauri** (small download, uses the system webview) pointed at
the hosted COMVERA address, so the desktop app is always the same version as the website and no
customer data is stored in the app. Electron also works if a feature needs it. Either is a separate
small project that does not change the COMVERA code; things to check then are file downloads,
printing and opening email links in the app.

We are not building a wrapper now: the installed web app already gives a desktop experience, and
a wrapper adds code signing (Apple and Microsoft certificates, roughly $99/year for Apple and a
Windows signing certificate) and a release process.
