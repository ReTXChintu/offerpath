# Plan: Offerpath runs the portfolio

Goal: retire the portfolio's admin panel (`D:\Personal\Portfolio\apps\admin`,
Next.js + MongoDB Atlas on Netlify). Offerpath stores and edits all portfolio
content and serves the API the public portfolio site
(`D:\Personal\Portfolio\apps\web`, Vite on Netlify) reads. A project, skill or
experience added in Offerpath appears on the portfolio at once.

## What the portfolio site needs (surveyed 2026-10-22)

The public site makes exactly two calls, and imports nothing from the admin app:

- `GET /api/site` → `{ ok: true, data: { settings, projects, developerTools, skills, experience } }`, read once on page load
- `POST /api/contact` with `{ name, email, message }` → `{ ok: true }`

Every response uses the `{ ok, ... }` / `{ ok: false, error }` envelope. `_id`
is a string (used as a React key). Colours must be `#rrggbb`, because the site
appends a hex alpha to them. Empty URLs must be `""`, which hides their buttons,
never `null`. Projects and developer tools have a `published` flag. Everything
is sorted by `order` (tools by `sortOrder`), then newest first. The settings
are a single record with fallback defaults. The exact shapes are in
`D:\Personal\Portfolio\packages\shared\src\index.ts`.

## Decisions

1. **Where the data lives: Offerpath's Postgres.** The alternative is
   Offerpath connecting to the existing Atlas MongoDB. The data is tiny (tens
   of rows), Offerpath already has one database and one migration system, and
   a second database driver and connection would only add things to go wrong.
   Atlas is retired at the end (after an export).
2. **The site reaches the API through a Netlify proxy.** The portfolio is
   served over HTTPS and Offerpath's API is plain `http://<ip>:50005`.
   Browsers block an HTTPS page from calling an HTTP API (mixed content). So
   the portfolio's `netlify.toml` proxies `/api/*` to Offerpath on the server
   side. The site then calls its own origin, so no CORS is needed and the
   site's code barely changes (`VITE_API_URL` becomes empty).
3. **Offerpath is multi-user, so a portfolio belongs to a user.** It's
   published under a handle, e.g. `biswajit`. The public routes are
   `/api/v1/public/portfolio/:handle/site` and `/contact`, and the Netlify
   proxy maps the site's `/api/site` onto them.
4. **Sign-in is Offerpath's own.** This retires NextAuth, along with the
   admin's two security holes: the hard-coded temporary admin login in
   `lib/auth.ts`, and server actions that never check who's calling.

## Phases

**1. API and data (Offerpath)**
- Prisma models, all user-scoped:
  - `Portfolio`: the handle, the settings that used to be a singleton record, and publish state
  - `PortfolioProject`, `PortfolioSkillGroup`, `PortfolioExperience`, `PortfolioDeveloperTool`
  - `PortfolioMessage`, for contact submissions
  - Fields and rules mirror the admin's models and zod schemas, with colours checked as `#rrggbb`.
- Authenticated CRUD under `/api/v1/portfolio/...`, including reordering and publish toggles.
- Image upload (see Questions).
- Public read and contact routes that answer exactly the shapes above, with the same defaults, filters and sorting.
  - The public site response is cached in memory and dropped on every edit. Visitors never wait on the database, which matters on Neon's free tier, where the database can be asleep.
- The contact form:
  - saves first, then notifies;
  - is rate-limited per visitor IP (the proxy's forwarded address);
  - has a honeypot field. The old one had no limits at all.
- e2e tests pin the public contract against the old API's shapes.

**2. Editing it in Offerpath**
- A **Portfolio** section on the laptop app and the website, with tabs:
  - Site settings
  - Projects: image upload, colour pickers, drag to reorder, publish switch
  - Skills, Experience and Developer tools
  - Messages: an inbox with read/unread, and delete
- The phone gets the messages inbox and push notifications for new messages, plus quick edits.
- **From your profile:** Offerpath already has your projects, experiences and skills (the desktop profile, synced).
  - Each portfolio item can be linked to a profile item. When the profile item changes, the linked item's text updates; its portfolio-only fields stay: image, colours, domain, order.
  - New profile items are handled as chosen in question 3 below.
- A live preview link to the portfolio.

**3. Moving the data across**
- A one-off script reads Atlas, read-only, using the portfolio's `MONGODB_URI` from its `.env`. It only reads it; nothing is copied into Offerpath's `.env`.
- It writes the data into your Offerpath account:
  - settings, projects, skills, experience and developer tools;
  - past contact messages.
- A dry run first, comparing counts and the `/api/site` output side by side with the old admin's.

**4. Switching the portfolio over**
- In `D:\Personal\Portfolio`:
  - `apps/web/netlify.toml` proxies `/api/*` to Offerpath, and `VITE_API_URL` is set to empty.
  - Fix the contact form bug: a failed send currently shows nothing, because the submit handler has no `catch`.
  - Optional safety net: the build saves a snapshot of the site data, and the page falls back to it if the API can't be reached. The portfolio then never shows "Content unavailable" just because the Offerpath server is down.
- Test it on a Netlify deploy preview, then deploy.

**5. Retiring the admin panel**
- Delete `apps/admin`.
- Delete the root scripts `dev:admin`, `build:admin`, `start:admin` and `seed`, and refresh the lockfile.
- Update the README and DEPLOYMENT docs.
- Keep `packages/shared`: the site's types live there.
- Delete the admin Netlify site.
- Export Atlas, then delete the database after a grace period.
- Revoke the GitHub token that's in the portfolio repo's git remote URL, and switch the remote to a plain URL.

## Risks

- **The portfolio then depends on the Offerpath server** (one machine, plain HTTP behind the Netlify proxy). The build-time snapshot in phase 4 covers outages.
- **Neon's free-tier database sleeps.** The in-memory cache of the public response covers that.
- **Visitor IPs:** the contact rate limit has to read Netlify's forwarded client IP, or every visitor counts as one.

## Questions for the user

1. **Images:** keep Cloudinary (existing images are already there; it's a CDN and can resize), with your Cloudinary credentials saved encrypted in Offerpath? Or store new uploads on the Offerpath server and serve them through the same Netlify proxy?
2. **Contact messages:** an Offerpath inbox plus a phone push. Do you also want an email, reusing the portfolio's current SMTP settings?
3. **New profile items:** published to the portfolio automatically, added as drafts for you to publish, or only when you choose to add them?
4. **Handle:** `biswajit`, or something else?
