# Full Professor page: local DOM-overlay prototype

The later local action connection is implemented and tested in
[Professor-Operator-Connection.md](Professor-Operator-Connection.md). Its optional
same-origin PC mount resolves the local iframe CSP path without opening headset
network access. The original prototype/evidence below remains historical.

This isolated local candidate preserves the complete existing School Professor
web interface. It does not build a second mentor/chat/quiz UI, a professor avatar,
voice path, scene loader or Blender adapter. No builder request is executed by
opening or using the panel. The standalone Professor remains authoritative.

## Trying the local candidate

Keep the existing Professor server at `http://127.0.0.1:3108/` running. From this
worktree's `WebRuntime`, run `npm run dev -- --port 5182 --strictPort`. Open
`http://127.0.0.1:5182/web/` on the PC and choose **Professor** in the workspace.
The entire page is embedded: teacher library/custom teachers, goal/preferences,
lesson/chat, quiz/review, saved quests and learning-record export. The frame has
its own browser scrolling and text inputs. Its learner cookie and backend archive
are the same as standalone Professor at that hostname. Use 127.0.0.1 consistently;
localhost has a different browser cookie identity.

**Close / Back to Matrix** hides the page without unloading it. Unsent text and
navigation survive close/reopen. Saved records survive Matrix reload through
Professor's existing persistence; unsent browser drafts do not claim durable
storage. Opening the standalone link creates another browser page. It does not
transfer the current frame's unsaved draft. Its presence is not a headset route.

In a compatible XR session, choose **PROFESSOR** in the existing controller-ray
Operator panel, or Professor in the DOM toolbar. Existing thumbstick-click recall
opens that Operator panel. No wrist widget existed to reuse, so this candidate
adds no new wrist tracking/rendering system. The browser positions the overlay;
it is not a movable world-space browser. Close returns to the same scene.

Matrix already requests optional `dom-overlay` for both immersive modes. Actual
`session.domOverlayState`, not CSS visibility, controls the new immersive path.
Unsupported sessions report the limitation in the existing Operator feedback and
keep the full page closed. Entering/leaving XR closes an already-open panel while
retaining the mounted frame. Existing XR entry/origin/world ownership is unchanged.

While open, world pointer/controller selection, thumbstick panel recall, movement
keys and squeeze-to-Operator recording are suppressed. `beforexrselect` is
cancelled on the overlay root; DOM controls do not dispatch scene actions. A held
grab or active recording must finish before opening. No new microphone/camera
permission is requested; the frame explicitly disallows those device features.

## Security boundary and pending headset routing

Embedding is enabled only when Matrix itself uses an HTTP loopback URL on the
PC. The fixed Professor URL uses that same hostname and port 3108. No URL query,
remote destination, token forwarding, CORS exception or network binding is added.
The frame cannot navigate the top page or open popups; existing JSON downloads
are allowed. A load/error event is not treated as proof of application readiness.

On HTTPS/LAN/headset URLs, a truthful explanatory surface replaces the frame.
The headset's localhost is not the PC. Existing School host/origin/fetch-site
guards remain untouched. Consequently this prototype does not yet make the full
page reachable from a Quest. DOM-overlay availability alone does not fix routing.

Proposed next security-sensitive change, requiring approval before implementation:
serve the existing Professor UI through a fixed path on Matrix's already-approved
headset origin, with an authenticated, bounded PC-side bridge to the existing
loopback School API. Review owner-cookie/session isolation, scoped cookies,
request limits, allowed routes/methods, redirects and learner-record access first.
Do not publish port 3108, loosen CORS/host checks, forward owner credentials to the
teacher, or silently select a global learner archive. No such bridge was added.

## Prompt review and staging

The embedded page retains **View presentation prompt**, **Edit prompt**, and
**Export learning record**. The export contains saved request identity, version,
objective, intent, interaction requirements and full prompt. This is a local
record for review/staging, not a Matrix concept id or selected image version.
No cross-window import or automatic authoring channel is added in this candidate.
The existing Matrix concept/version -> explicit selection -> Blender -> validated
GLB -> loader/receipt pipeline remains the future execution path. A staged request
is not a generated image, loaded object or functioning instructional interaction.

## Evidence and limits

Six focused Node regressions cover full-page lifetime, actual overlay-state gating,
unsupported/remote routes, beforexrselect, active-interaction guards and the
existing Operator entry/control preservation. Full runtime suite: 817 tests passed;
production build passed. Browser evidence is recorded separately after execution.
Synthetic session-state tests are not emulated immersive rendering. Physical
headset input, native keyboard, scroll, readability and AR/VR lifecycle remain
pending in the single consolidated `Validation/V1.2-Headset-Acceptance.md` record.
No published release evidence is promoted or replaced by this local candidate.

Desktop Chromium 155.0.8059.85 checks passed against production Matrix `main.js`
and the actual complete Professor React page. Ten checks used intercepted School
API requests backed by an in-memory teaching engine and mock provider: all eleven
teachers/preferences, quest, learner turn, real frame scroll/text input, unsent
draft close/reopen, full prompt edit, quiz/grade, JSON download, Matrix reload and
saved-session reopen, and unchanged Matrix localStorage. This is mock teaching,
not a live model or immersive XR result. A first run exposed inherited
`pointer-events:none` on the Close header; corrected CSS and the repeated loop pass.

A separate fresh-cookie browser check used the real loopback School API with GET
only: six reads, zero POSTs, configured native Codex status, eleven teachers and
draft retention. No existing saved lesson was opened. No live inference was run.
Reports/screenshots stay local under `.utmp/professor-overlay/` and are not
committed. `desktop-report.json` and `actual-readonly-report.json` distinguish the
two paths. The isolated Vite demo has no ControlService API proxy; its Operator
connection warning is expected and does not mean the embedded School API failed.
No privileged Matrix service was started or reconfigured for this check.

Final production artifacts (SHA-256):

- `dist/index.html`: `e9a063a847b441167498354ffc7a2b195d45f62823f8576a7ac40feb7e1656e2`
- `main-kQqAFlgP.js`: `574b2a698009cbf25649ed0708ae88dc6b0f56d0d404fda8bb62c7f073739c6a`
- `view-DEsOYQQ2.js`: `4924d524f6f057531b74be5476184acdfb19d3fb0fb237d837267cb35c508757`

Local worktree `matrix-professor-overlay` / `feat/professor-dom-overlay` starts at
`2279c3d`, with prior local UI/acceptance edits copied into preservation commit
`0b322a8` before this feature. Eleven original source-file hashes still match
their pre-task values. Professor's original source and both running archives were
not replaced. No merge, remote push or deployment was attempted.
