### Slice 37 — Access answers, ending a grant, and the setup page's leftovers

*In progress (wave 2026-11-18), draft PR.* Built before Slice 36 (night 2026-11-18-1602 wave 2); 36 now goes after it.

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 4, after Slice 36 (both edit
`web/src/SetupPage.tsx` and `web/src/strings.ts`).

**Touches:** `src/api/access.ts`, `src/api/router.ts`, `src/api/auth.ts`, `src/api/chatText.ts`, `src/api/grants.ts`
(new), `src/api/oauth/**`, `src/index.ts`, `web/src/SetupPage.tsx`, `web/src/ConnectedApps.tsx` (new), `web/src/setup.css`, `web/src/api.ts`,
`web/src/strings.ts`, `README.md`, `test/access.test.ts` (new), `test/oauth.test.ts`, `test/chatTextRoute.test.ts`, `test/config.test.ts`,
`e2e/setup.spec.ts`, `docs/plan/slices/37-access-and-grants.md`

**Migrations:** none

#### Why

The owner has no way to end an OAuth grant (Slice 5). `README.md:113-115` only names the library calls
(`listUserGrants`, `revokeGrant`), and nothing in `src/` calls them. The other items are small leftovers of Slices 1,
2, 7, 16 and 19:
- a missing Access secret answers 403 and logs nothing;
- some token errors answer 503;
- a 503 response can be cached;
- the grant stores scope `mcp:read` while the token can write;
- the setup page does its own fetch.

#### Decisions

- There is one auth path (root `CLAUDE.md`, Slices 5 and 16). The grants list and the revoke action sit behind the
  same Access check (`src/api/access.ts`) as the page, with no other gate and no E2E bypass outside the env flag
  (Slice 2 rule).
- Where the owner ends a grant: a "Connected apps" list on the Setup page (`#/setup`), with one "End access" button
  per grant. Decided by the planning session, because the Setup page is where the owner connects a chat. If the
  design in `docs/design/` gets a mock for it, the mock wins. It has one now (`Setup.dc.html`, `SetupPhone.dc.html`),
  and the Design subsection below is what is built.

#### Design (Setup and SetupPhone mocks, h1 line 22, h2 lines 26 and 40 of each, added 2026-11-18)

Two frames of the Setup page: `Setup.dc.html` (light, 1440x1050, with an End access confirmation open on the first
app) and `SetupPhone.dc.html` (dark, 390x1250, drawn after Copy was pressed). They agree with the plan that Connected
apps sits on the Setup page with one End access button per app, and that there is one Copy. They differ in the
details below, which this slice now follows. Colour names are the `CONFIG.theme` keys of `ActiveV3.dc.html` and
`ActiveV3Dark.dc.html`, whose values these two files use (light and dark). The sample app names ("claude.ai", "Claude
Design") and dates are made-up data. The small labels "No apps", "Loading (after 500 ms)" and "Failed" over the three
dashed boxes are labelling for the canvas, not page text. The block's text is cut with "…" in the frames: that is a
cut-down illustration; the real block shows the whole text and scrolls.

- **Page** (both, lines 18 to 21): width up to 820px, centred, padding 32px 32px 64px (phone 16px 14px 40px), gap 20px.
  A link "Back to the board" first (min-height 44px, 600, a 16px left arrow in `link`), then the header: h1 "Set up a
  chat" (26px, 700) and the intro "Paste this text into claude.ai, Settings, Your Claude, Instructions, so your chats
  report to the board." (the existing `setupIntro`; `sub`).
- **One block and one Copy** (h2 "Everything for the Instructions box", line 26): a card (radius 14px, padding 18px, gap
  12px, h2 16px, 700). Inside, in order: the note, the block, the Copy button.
- **The note**: padding 10px 12px, radius 10px, `needBg`, 1px `needBd`, 13px: "**This is all of it.** It replaces
  what is in the box now: the connector line first, then the rules." The bold words are `needFg`.
- **The block**: a read-only `pre`, max-height 260px and scrolling, padding 14px, radius 10px, background `ground`,
  1px `border`, JetBrains Mono 12px, line-height 1.6, wrapping, colour `text`. It holds the connector line, a blank
  line, then the instruction text (the frame's first line is `CHAT_PREFACE`: "You have the "board" connector (the
  agent progress board).").
- **Copy button**: min-height 44px, padding 0 22px, radius 10px, no border, background `btnBg`, text `btnFg`, 600, a
  16px copy icon (a 11px square and its corner path), gap 8px, label "Copy".
- **Copied state** (SetupPhone line 37): the button turns to min-height 44px, padding 0 18px, a 1px `doneFg` border,
  transparent fill, text and icon `doneFg`, a 16px check icon (stroke 2.2), label "Copied". Next to it a status line
  (`role="status"`, 13px, `muted`): "Now paste it into the Instructions box and save."
- **Connected apps** (h2 line 40): a card like the first. Under h2 "Connected apps" a line, 13px, `muted`: "Apps you
  signed in to the board from. Ending access stops an app from reporting; connect it again from that app." Then a
  list; each app is a row with a 1px `border` top line and padding 12px 0 (14px while confirming).
- **App row**: the app's name (600) and under it "Connected Tue 17 Nov, 09:12" (13px, `muted`: weekday, day, month,
  24-hour time), then an **End access** button at the right (it wraps below on a narrow row): min-height 44px, padding
  0 16px, radius 10px, transparent, 1px `bugBd`, text `bugFg`, 600. The row shows nothing else: no scope label.
- **Inline confirmation** (Setup lines 43 to 47): tapping End access opens, inside the row, a box with `role="alert"`
  (radius 10px, padding 12px 14px, background `bugBg`, 1px `bugBd`, gap 10px): "End access for **claude.ai**? Its
  chats stop reporting until you connect it again." (14px, the name bold), then two buttons, min-height 44px, padding 0
  16px, radius 10px: **End access** (fill #B42318, text #FFFFFF, 600) and **Keep it** (1px `border`, fill `card`, 600).
  There is no browser dialog. While confirming, the name and date sit on one line. The dark frame does not draw the box;
  it uses the dark `bugBg`, `bugBd` and `bugFg` of the same theme (accepted by the owner, 2026-11-18).
- **States** (Setup lines 51 to 55; dashed boxes, 1px dashed `border`, radius 12px, padding 14px, gap 4px): empty,
  "No app is connected yet. Paste the text above into claude.ai to connect one."; loading after 500 ms, `muted`,
  "Loading connected apps…"; failed, "Couldn’t load connected apps. The API answered 503 (service unavailable)."
  with a **Retry** button (min-height 44px, padding 0 16px, radius 10px, fill `btnBg`, text `btnFg`, 600). The failed
  line uses the same code and reason words as the existing page (`setupFailedApi`, `reason503`); a network failure
  uses `setupFailedNetwork`. Nothing under 500 ms shows a loading state.

New strings, English and German (`web/src/strings.ts`): the note ("This is all of it." and the rest), "Everything for
the Instructions box", "Now paste it into the Instructions box and save.", "Connected apps" and its line, "Connected
{when}", "End access", "End access for {name}? Its chats stop reporting until you connect it again.", "Keep it", "No
app is connected yet. Paste the text above into claude.ai to connect one.", "Loading connected apps…", "Couldn’t load
connected apps.", "Retry". Removed: `setupPrefaceIntro`, `setupCopyPreface`, `setupTextLabel` (no textarea any more).

**Plan changed to match the mock (2026-11-18):**
- One block and one Copy: confirmed, with the exact note, a `pre` instead of the textarea, the Copied state and its
  follow-up line (SetupPhone line 37). The plan said "Say once, above it"; the note is in its own box above the block.
- Connected apps rows show only the name and "Connected {when}" (the plan said "client name, when it was granted":
  same). No scope label (the plan decides none).
- End access has an inline confirmation with "Keep it"; no browser dialog. The plan had no confirmation.
- Empty, loading and failed states of the list are as drawn, with Retry on failure. The plan had only the loading state.

#### Work

- [ ] Slice 5: add `GET /api/grants` and `POST /api/grants/<id>/revoke` in `src/api/grants.ts` (new), behind the
  Access check, calling `env.OAUTH_PROVIDER.listUserGrants` and `revokeGrant`. On the Setup page, a "Connected apps"
  list as in the Design subsection (`web/src/ConnectedApps.tsx`, new): client name, "Connected {when}", and an "End
  access" button with the inline confirmation; the empty, loading (after 500 ms) and failed (with Retry) states. Update
  `README.md:113-115`.
- [ ] Slice 5: the static bearer token with `public_origin` set and a request from another host is untested
  (`src/api/auth.ts`, `src/api/oauth/provider.ts`).
- [ ] Slice 16: the grant stores scope `mcp:read` while the token writes (`src/api/oauth/authorize.ts:20`,
  `provider.ts:82`). Store the scope `scopeOfCaller` gives.
- [ ] Slice 2 #1: `TOKEN_ERRORS` is an allowlist, so other `jose` errors answer 503, not 403
  (`src/api/access.ts:44-56`). Add `test/access.test.ts` (new).
- [ ] Slice 2 #2: a missing `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` answers 403 and logs nothing (`access.ts:67`). Answer
  503 and log the missing name.
- [ ] Slice 2 #6: the 503 has no `Cache-Control: no-store` and no `Retry-After`, and asset requests re-run the key
  fetch and log each time (`src/api/router.ts:64-66`).
- [ ] Slice 1: the method check runs before auth (`src/index.ts:47`). Confirm whether the skipped Bearer
  case-sensitivity finding still applies now that auth goes through the OAuth provider. Close it with a test either
  way.
- [ ] Slice 7 check 5: the cron handler parses only `staleAfterMinutes` (`src/index.ts:16-19`). Parse the config the
  same way `fetch` does.
- [ ] Slice 19 chk #1 + med #2: `CHAT_TEXT_URL` (`web/src/SetupPage.tsx:10`) and `CHAT_TEXT_PATH`
  (`src/api/chatText.ts:3`) are two copies. Med #1: the page does its own fetch and throws a bare number
  (`SetupPage.tsx:29-38`); use `LoadError` from `web/src/api.ts`.
- [ ] Slice 19 chk #3: the strings say "select the text", but the preface is a plain paragraph (`strings.ts:362` en,
  `:732` de). Chk #4: a space is missing at `SetupPage.tsx:114`. Chk #5: the two `CopyButton`s keep separate state.
  Chk #6: `chatText.ts:15` is a thin wrapper, and `READ_METHODS` (`router.ts:14`) includes HEAD.
- [ ] **One Copy for the whole paste** (owner, 2026-11-18, while pasting into claude.ai: "ty gave me a line and a text,
  which one to put in claude instructions?" and "why did you separate the 2 parts then?"). The Setup page shows the
  connector line and the instruction text as two pieces with two Copy buttons (`web/src/SetupPage.tsx:67,109,114`),
  and both go in the same claude.ai Instructions box, line first. Replace them with one block and one **Copy** that
  copies the line, a blank line, then the text. Say once, above it, that this is everything that goes in the box and
  that it replaces what is there (the mock's note: "This is all of it. It replaces what is in the box now: the
  connector line first, then the rules."). After Copy the button reads "Copied" and "Now paste it into the Instructions
  box and save." shows next to it, as in the Design subsection. The pieces stay separate on the server (`CHAT_PREFACE` is only for claude.ai;
  `SERVER_INSTRUCTIONS` goes to every client). Verify in `e2e/setup.spec.ts`: the copied text equals preface, blank
  line, `SERVER_INSTRUCTIONS`.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test` (new `test/access.test.ts`; grants routes in `test/oauth.test.ts`,
  including that they refuse without the Access header), and `npm run test:e2e` (the Setup page lists a faked grant,
  "End access" asks "End access for ...?" in the page, "Keep it" leaves it, and the second "End access" removes it;
  the empty, loading and failed states show; the Copied line shows after Copy). Compare the page with `Setup` and
  `SetupPhone`.
- After the release, on the owner's phone: the Setup page lists the claude.ai grant. Ending it and reconnecting works.
  This is the owner's check, recorded in `docs/plan/unverified.md` when the slice is built.
