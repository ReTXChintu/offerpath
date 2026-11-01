# Portfolio

Offerpath runs its users' portfolio content: the site settings, projects,
skills, experience and developer tools, plus messages from the contact form.
A portfolio site of any design reads it from a public API. Nothing is tied to
one person: a new user creates a portfolio, picks a handle, connects their own
Cloudinary account, and points their site at the public API.

- **Editing:** the **Portfolio** section on the website and the laptop app. The phone has the messages inbox, publishing drafts, and push for new messages.
- **The profile feeds it.** Projects, experiences and skills from the user's Offerpath profile (the desktop's candidate profile, synced) arrive as **drafts**. The user chooses what to publish.
- **Mockups:** the laptop app generates mockup images for projects from their local folders (see "Mockups").
- **Images** go to the user's own Cloudinary.

## Public API (for portfolio sites)

No auth. CORS is open to any origin (`Access-Control-Allow-Origin: *`, no
cookies). Every response is JSON in an envelope: `{ ok: true, ... }`, or
`{ ok: false, error: string }` with a matching status.

| Route | Body | Returns |
| --- | --- | --- |
| `GET /api/v1/public/portfolio/:handle/site` | | `{ ok: true, data: SiteData }` (404 `{ ok: false, error: 'Portfolio not found' }`) |
| `POST /api/v1/public/portfolio/:handle/contact` | `{ name, email, message, website? }` | `{ ok: true }`. 400 `{ ok: false, error }` when invalid (name ≥ 2, a valid email, message ≥ 10 and ≤ 5000). 429 when rate-limited (5 an hour per visitor IP). `website` is a honeypot: a bot that fills it gets `{ ok: true }` and nothing is saved. |

```ts
interface SiteData {
  settings: {
    heroName: string; heroEyebrow: string; roles: string[]; heroBio: string;
    resumeUrl: string; aboutHeadline: string; aboutParagraphs: string[];
    socials: { github: string; linkedin: string; twitter: string; email: string };
  };
  projects: {
    _id: string; title: string; desc: string; tags: string[];
    accent: string; gradientFrom: string; gradientTo: string;   // '#rrggbb'
    imageUrl: string; liveUrl: string; githubUrl: string; domain: string;
  }[];
  developerTools: {
    _id: string; title: string; slug: string; shortDescription: string; fullDescription: string;
    domain: string; techStacks: string[]; accent: string; gradientFrom: string; gradientTo: string;
    githubUrl: string; npmUrl: string; docsUrl: string; demoUrl: string;
    installCommand: string; packageName: string; version: string;
    featured: boolean; published: boolean; sortOrder: number;
  }[];
  skills: { _id: string; cat: string; items: string[] }[];
  experience: { _id: string; title: string; company: string; period: string; bullets: string[] }[];
}
```

**Rules**
- Only **published** items appear.
- Ordering: by `order` ascending (developer tools by `sortOrder`), then newest first.
- Empty URLs are `""`, never `null`.
- Colours are always 6-digit hex.
- The settings fall back to sensible defaults when empty: roles fall back to `[heroEyebrow]` or "Developer", and socials to `"#"`.

The response is cached in memory and dropped whenever the portfolio changes,
so a visit never waits on the database.

A site served over HTTPS can't call a plain-HTTP API, so it should proxy
through its host. For example, Netlify `netlify.toml`:

```toml
[[redirects]]
  from = "/api/site"
  to = "http://<offerpath-host>:50005/api/v1/public/portfolio/<handle>/site"
  status = 200
  force = true
[[redirects]]
  from = "/api/contact"
  to = "http://<offerpath-host>:50005/api/v1/public/portfolio/<handle>/contact"
  status = 200
  force = true
```

Behind a proxy, the contact rate limit reads the visitor's IP from
`x-nf-client-connection-ip` (Netlify), then `x-forwarded-for`, then the
socket.

## Private API (Offerpath's own screens)

All routes are under `/api/v1/portfolio`, need the bearer token, are scoped to
the user, and answer problem details on error.

```ts
type Source = { collection: 'projects' | 'experiences' | 'skills'; id: string } | null;

interface PortfolioView {
  handle: string;
  settings: SiteData['settings'];
  cloudinary: { configured: boolean; cloudName: string | null; apiKeyLast4: string | null };
  publicUrl: string;                 // '/api/v1/public/portfolio/<handle>/site'
  counts: { projects: number; drafts: number; skills: number; experience: number; developerTools: number; unreadMessages: number };
  createdAt: string; updatedAt: string;
}

interface ProjectItem {
  id: string; title: string; desc: string; tags: string[];
  accent: string; gradientFrom: string; gradientTo: string;
  imageUrl: string | null;           // a project needs an image to be published
  liveUrl: string; githubUrl: string; domain: string;
  order: number; published: boolean;
  source: Source;                    // the profile project it came from
  followsSource: boolean;            // its text still follows the profile item
  localPath: string | null;          // the project's folder on the laptop, for mockups
  createdAt: string; updatedAt: string;
}
interface SkillGroupItem { id: string; cat: string; items: string[]; order: number; published: boolean; source: Source; followsSource: boolean; createdAt: string; updatedAt: string }
interface ExperienceItem { id: string; title: string; company: string; period: string; bullets: string[]; order: number; published: boolean; source: Source; followsSource: boolean; createdAt: string; updatedAt: string }
interface DeveloperToolItem { id: string; title: string; slug: string; shortDescription: string; fullDescription: string; domain: string; techStacks: string[]; accent: string; gradientFrom: string; gradientTo: string; githubUrl: string; npmUrl: string; docsUrl: string; demoUrl: string; installCommand: string; packageName: string; version: string; featured: boolean; published: boolean; sortOrder: number; createdAt: string; updatedAt: string }
interface MessageItem { id: string; name: string; email: string; message: string; read: boolean; createdAt: string }
```

| Route | Body | Returns |
| --- | --- | --- |
| `GET /portfolio` | | `PortfolioView`, 404 before one is created |
| `POST /portfolio` | `{ handle }` (3-40 chars: lowercase letters, digits, `-`; unique) | `PortfolioView` (201). Also imports the profile as drafts. 409 when the handle is taken. |
| `PATCH /portfolio` | `{ handle?, settings? }` (settings: partial; colours not involved) | `PortfolioView` |
| `PUT /portfolio/cloudinary` | `{ cloudName, apiKey, apiSecret }` | `PortfolioView`. Checked with Cloudinary first (400 when refused); the secret is stored encrypted. |
| `DELETE /portfolio/cloudinary` | | `PortfolioView` |
| `POST /portfolio/uploads` | `{ fileName, contentBase64 }` (png/jpg/webp/gif, ≤ 8 MB) | `{ url }`: uploaded to the user's Cloudinary, folder `portfolio`. 400 without Cloudinary. |
| `POST /portfolio/import-profile` | | `{ created: number, updated: number }`: brings in new profile items as drafts now (it also happens by itself whenever the profile syncs). |
| `GET /portfolio/projects` | | `{ items: ProjectItem[] }`, drafts included, in order |
| `POST /portfolio/projects` | the fields above, minus id/source/timestamps (title ≥ 2, desc ≥ 10; colours `#rrggbb`) | `ProjectItem` (201) |
| `PATCH /portfolio/projects/:id` | any subset | `ProjectItem`. Editing title, desc or tags of a linked item sets `followsSource: false`; `{ followsSource: true }` re-links it and refreshes it from the profile. Publishing a project with no image is a 400. |
| `DELETE /portfolio/projects/:id` | | 204 |
| `POST /portfolio/projects/reorder` | `{ ids: string[] }` | `{ items }` |
| `.../skills`, `.../experience`, `.../developer-tools` | the same five routes each | `SkillGroupItem` / `ExperienceItem` / `DeveloperToolItem`; a tool's slug comes from its title and is unique per portfolio |
| `GET /portfolio/messages` | | `{ items: MessageItem[] }`, newest first |
| `PATCH /portfolio/messages/:id` | `{ read }` | `MessageItem` |
| `DELETE /portfolio/messages/:id` | | 204 |

A new contact message sends the user's phones a push:
`kind: 'PORTFOLIO_MESSAGE'`, `linkPage: 'portfolio-messages'`, `linkId: <message id>`.

## From the profile

Whenever the desktop syncs `projects`, `experiences` or `candidate_profiles`
(debounced by a few seconds), and on `import-profile`:

- **A new profile project** becomes a draft project:
  - `title` = name; `desc` = description, else the first achievement; `tags` = technologies.
  - `githubUrl` = its url when that's on github.com; otherwise the url goes in `liveUrl`.
  - The colours are picked from a fixed palette, varied by project.
  - It has no image yet.
- **A new experience** becomes a draft experience:
  - `title` = role; `company` = company.
  - `period` = "Mon YYYY – Mon YYYY", or "– Present".
  - `bullets` = achievements, else the description split into sentences.
- **Each non-empty skill group** in the profile (frontend, backend, database, devops, cloud, testing, other) becomes a draft skill group with a capitalised `cat`, linked as `skills:<group>`.
- **A linked item that still follows its source** gets its text refreshed. Its presentation fields (image, colours, domain, order, published) are never touched.
- **A profile item that's deleted** leaves its portfolio item in place, unlinked.
- **An item the user deleted from the portfolio** is not brought back. Its source is remembered in a small "dismissed" list.

## Mockups

**On the laptop app only:** "Generate mockup" on a project.

1. The user picks the project's folder once; it's saved as `localPath`.
2. The desktop runs the user's Claude CLI in that folder with read-only tools. It studies the app (its README, routes, screens, components and brand colours) and writes one self-contained HTML page: a polished marketing-style mockup of the real product in a device frame, 1600×1000.
3. The desktop renders that page to a PNG with a headless Chromium (Chrome, else Edge).
4. It uploads the PNG through `POST /portfolio/uploads` and sets the project's `imageUrl`. It can also suggest `accent`, `gradientFrom` and `gradientTo` from the brand colours.
5. The user sees the image before it's kept, and can regenerate it.
