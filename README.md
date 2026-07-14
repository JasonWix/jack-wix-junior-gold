# Jack Wix Junior Gold 2026 Dashboard

A mobile-friendly GitHub Pages dashboard for Jack Wix's U18 Boys results, with a searchable U18 Boys results explorer for every published bowler in 2025 and 2026.

## Publish

1. Create a **public** GitHub repository, preferably named `jack-wix-junior-gold`.
2. Upload all files in this project to the repository's `main` branch.
3. In **Settings → Pages**, set Source to **GitHub Actions**.
4. Open **Actions** and run `Update Junior Gold dashboard` once.
5. Share the Pages URL shown in the `Deploy GitHub Pages` workflow.

The updater uses the tournament-specific schedule documented below. GitHub may delay scheduled workflows during high load.

## Data behavior

- Pulls the official 2026 Junior Gold U18 Boys PDFs from Bowl.com.
- Searches for `Jack Wix`.
- Builds `data/bowlers.json` so any published U18 Boys bowler can be searched by name or hometown, or browsed with every bowler from a selected state.
- Promotes the selected explorer profile into the active dashboard context so headings, statistics, scorecards, charts, cut estimates, source links, comparison copy, and sharing use that bowler's name and results.
- Keeps all 1,341 final 2025 U18 Boys profiles in a fixed archive while refreshing the published 2026 field automatically.
- Updates game scores, totals, average and target pace.
- Preserves a bounded history of meaningful official result changes for progress comparisons.
- Keeps Jack's verified 2025 U18 Boys qualifying results as a fixed archive and compares them with 2026 after each matching four-game checkpoint.
- The page automatically counts down to Jack's next Squad 1 qualifying block.
- Builds a state-specific U18 Boys leaderboard from the explorer's selected year and state, with rank, hometown, games, total, average, and comparison to the active bowler.
- Stores visitor-specific section visibility, section order, last-visit comparisons, and favorite state bowlers only in that visitor's browser.
- `data/dashboard.json` contains a valid starting snapshot and can be edited manually if a PDF layout changes.
- A selected bowler has a shareable `?year=YYYY&bowler=USBC-ID` profile URL. Profile sections are shown only when their underlying data exists.

## Selected bowler and display controls

Selecting a 2025 or 2026 profile updates the full dashboard, not only the explorer card. Data-compatible sections use the selected bowler's name, year, squad, hometown, standings, scores, progress, provisional cut comparison, archived comparison, and state-leaderboard baseline. Jack-only sections—personal schedule, equipment, and last-visit summary—are disabled automatically when another bowler is active.

Every dashboard section is collapsed on each page load. The guide starts first, Jack's equipment starts hidden, and **Arrange and choose sections** lets each visitor show, hide, and drag sections into a preferred order. Arrow buttons provide the same ordering control on phones and keyboards. Order and visibility choices are saved in that browser; sections without data for the active selection remain disabled and explain why.

## Bowler Explorer

The Bowler Explorer is designed for every U18 Boys family, not only Jack's. Choose 2025 or 2026, select a state to list every published bowler from that state, optionally narrow the list by name or hometown, and select a result to see the available official data:

- Current or final position, field size, total, average, games completed, and squad.
- Posted qualifying blocks and individual games when they are machine-readable.
- A same-stage 2025-versus-2026 comparison when the same bowler can be matched in both years.
- Direct links to the relevant official Bowl.com results page and reports.

Empty sections are hidden. The interface never invents missing game scores. The archived 2025 Day 3 block total may be derived from adjacent official cumulative totals when the individual games are not machine-readable; those cards are labeled **Verified total** and explain the calculation.

To rebuild the complete 2025 archive locally:

```bash
python scripts/build_2025_archive.py
```

The live updater preserves that archive and replaces only the 2026 portion of `data/bowlers.json`.

## Important

The PDF parser uses a defensive best-effort pattern. Bowl.com can change report layouts without notice. Verify the first automated run against the official PDF.


## Branding updates

- Uses the supplied official 2026 Junior Gold Championships logo.
- Theme colors are matched to the official logo palette.
- Includes "Built by Jason Wix" branding.
- Shows the date, time, and location of Jack's last completed qualifier.


## Official results status

The dashboard displays two separate timestamps:

- **Bowl.com last updated results**: parsed directly from the official report's `Unofficial Results - as of:` timestamp.
- **Dashboard last checked**: the most recent time the GitHub Actions collector checked Bowl.com.

The status dot is green when the latest report is no more than three hours old during active competition, yellow when older, and pink when Bowl.com cannot be reached.


## Player photo

- Uses the supplied Jack Wix portrait directly on the dashboard hero section.
- The photo is bundled locally in `assets/jack-wix-photo.jpg` so the GitHub Pages site displays it without any external dependency.


## Tournament equipment section

The dashboard includes Jack's five registered bowling balls from his Junior Gold equipment card:

- 900 Global Reality
- Storm Phaze II Pearl
- Storm Concept
- Hammer Black Pearl Urethane, registered on the card as "Black Urethane Pearl"
- Columbia 300 White Dot

Each card includes the registered serial number, a short role description, a product image, and a product-source link. Jack's White Dot is identified as the white / Diamond version.

## 2025 vs. 2026 comparison

The dashboard includes Jack's official 2025 U18 Boys qualifying results from the four archived Bowl.com reports:

- Day 1: `191 · 133 · 158 · 115` — 597
- Day 2: `172 · 191 · 142 · 168` — 673, 1,270 cumulative
- Day 3: `183 · 115 · 155 · 178` — 631, 1,901 cumulative
- Day 4: `200 · 183 · 147 · 200` — 730, 2,631 cumulative

Jack finished 2025 qualifying with a 164.44 average, tied for 1009th in the 1,341-bowler U18 Boys field. The comparison uses same-stage scoring: Day 1 is compared after four games, Day 2 after eight, and so on. Unpublished 2026 days remain marked pending. The live updater preserves the archived 2025 data while adding each completed 2026 block and its standings snapshot.

## Latest dashboard clarification

- The cut-gap and needed-average tiles are explicitly labeled as placeholders, not official projections.
- A cut explanation panel states that the first official cut is not set until all U18 Boys complete 16 qualifying games.
- The top of the page links to Jack Wix Bowling on Facebook.
- The state leaderboard follows the Bowler Explorer's selected year and state, and labels live 2026 fields separately from final 2025 fields.
- Jack's Columbia 300 White Dot is identified as the white / Diamond version and uses a matching white-ball image.

## Responsive layout update

The default dashboard order begins with:

1. Dashboard guide
2. Bowler Explorer
3. Qualifying overview and official-results status
4. Current statistics, comparison, progress, and cut estimate
5. Scores, schedule, tournament path, and selected-state leaderboard

Visitors can change this order at any time. Registered equipment remains available for Jack but is hidden by default.

The header, statistics, schedule, state leaderboard, equipment cards, and ordering controls reflow for tablet and phone screens. On smaller phones, the leaderboard becomes readable stacked cards instead of requiring horizontal scrolling.

## Family dashboard features

- All sections collapsed by default, with Expand All and Collapse All controls for the current view.
- A persistent top-of-page manager for hiding, showing, and drag-reordering individual sections.
- Up/down ordering buttons for touch and keyboard users.
- A “Since your last visit” summary when official results change.
- A block-level average-versus-estimated-cut chart and position history.
- High game, low game, latest block, best block, and block-trend highlights.
- Open in Maps, Add to Calendar, and BowlTV actions for the next qualifying block when applicable.
- A qualifying-to-match-play tournament path tracker that does not imply advancement before it is official.
- One-tap family sharing with a copy fallback.
- Browser-saved favorite state bowlers and a compact comparison view.


## Latest dashboard update

- Uses the supplied Jack Wix Junior Gold banner as the full-width header.
- Keeps a compact identity and action bar beneath the banner so important links remain readable on phones.
- State-leaderboard bowler names are selectable.
- Selecting a name opens a responsive profile with rank, hometown, games, total, average, comparison to Jack, and any posted qualifying game scores.
- Other bowlers' equipment is intentionally excluded.
- The selected-state table becomes stacked cards on smaller screens.
- Section order and visibility are personal to each browser and can be changed without altering the official data.


## U18 Boys field size

Jack's position is displayed as `rank of field`, for example `#260 of 464`.

The collector counts unique competitors in the latest official U18 Boys report. While Day 1 results are still being posted, the dashboard labels the number as the currently published field. Once all eight U18 Boys squads appear in the Round 1 report, the label automatically changes to `Total U18B participants`.


## Smart Bowl.com check schedule

The GitHub Actions updater uses a date-specific tournament schedule in Central Time:

- Every 5 minutes during Jack's bowling and likely result-posting windows.
- Every 15 minutes during active tournament hours between squads.
- Hourly overnight during qualifying.
- The workflow can still be run manually from the Actions tab at any time.

GitHub cron expressions use UTC, so the workflow file already includes the correct five-hour conversion for Minnesota daylight time.

## Updater repair: validated parser v3

The previous parser read the numbers in `Squad 01 Day 1` as game scores. That produced impossible dashboard data such as `1, 1, 132, 190` and a 324 total for Jack. It also affected state-leaderboard profiles.

The repaired collector:

- Recognizes both literal-space and URL-encoded links from the Bowl.com results page.
- Adds a cache-busting query value whenever it downloads a PDF.
- Rejects the valid-PDF `Results Coming Soon` placeholders for unpublished rounds.
- Parses standings rows relative to `Squad NN Day N`, then validates game, block, grand-total, and average arithmetic.
- Handles Bowl.com exceptions such as a missing state and a USBC ID joined to a bowler name.
- Uses the newest valid qualifying report for rank, total, average, participant count, complete state browsing, and source timestamp.
- Preserves existing dashboard results if no valid report can be fetched.
- Includes parser regression tests that run before every automated refresh.
- Validates the generated dashboard before committing it.
- Retries a push from the newest `main` branch if another commit wins the race.

Run locally with:

```bash
python -m unittest discover -s tests -v
python scripts/update_results.py
```
