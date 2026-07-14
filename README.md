# Jack Wix Junior Gold 2026 Dashboard

A mobile-friendly GitHub Pages dashboard for Jack Wix's U18 Boys results.

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
- Updates game scores, totals, average and target pace.
- Preserves a bounded history of meaningful official result changes for progress comparisons.
- Keeps Jack's verified 2025 U18 Boys qualifying results as a fixed archive and compares them with 2026 after each matching four-game checkpoint.
- The page automatically counts down to Jack's next Squad 1 qualifying block.
- Includes an Alabama U18 Boys leaderboard with rank, hometown, games, total, average, and comparison to Jack.
- Stores visitor-specific section choices, last-visit comparisons, and favorite Alabama bowlers only in that visitor's browser.
- `data/dashboard.json` contains a valid starting snapshot and can be edited manually if a PDF layout changes.

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
- The Alabama leaderboard is labeled partial while additional Alabama bowlers compete later on July 13, and automatically changes to complete after today.
- Jack's Columbia 300 White Dot is identified as the white / Diamond version and uses a matching white-ball image.

## Responsive layout update

The dashboard is ordered for family viewing:

1. Jack's identity, photo, Facebook page, and official results link
2. Next and most recent qualifying blocks
3. Bowl.com freshness status
4. Current statistics and clearly labeled cut estimates
5. 2025 vs. 2026 same-stage comparison
6. 2026 progress and cut pace
7. Scores by block
8. Full qualifying schedule and tournament path
9. Alabama leaderboard
10. Registered equipment
11. Dashboard explanation

The header, statistics, schedule, Alabama leaderboard, and equipment cards now reflow for tablet and phone screens. On smaller phones, the Alabama table becomes readable stacked cards instead of requiring horizontal scrolling.

## Family dashboard features

- Expand All and Collapse All controls, plus remembered state for every section.
- A “Since your last visit” summary when official results change.
- A block-level average-versus-estimated-cut chart and position history.
- High game, low game, latest block, best block, and block-trend highlights.
- Open in Maps, Add to Calendar, and BowlTV actions for the next qualifying block when applicable.
- A qualifying-to-match-play tournament path tracker that does not imply advancement before it is official.
- One-tap family sharing with a copy fallback.
- Browser-saved favorite Alabama bowlers and a compact comparison view.


## Latest dashboard update

- Uses the supplied Jack Wix Junior Gold banner as the full-width header.
- Keeps a compact identity and action bar beneath the banner so important links remain readable on phones.
- Alabama bowler names are selectable.
- Selecting a name opens a responsive profile with rank, hometown, games, total, average, comparison to Jack, and any posted qualifying game scores.
- Other bowlers' equipment is intentionally excluded.
- The Alabama table becomes stacked cards on smaller screens.
- Section order prioritizes the next block, latest results, current stats, scores, schedule, Alabama standings, equipment, and explanatory notes.


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

The previous parser read the numbers in `Squad 01 Day 1` as game scores. That produced impossible dashboard data such as `1, 1, 132, 190` and a 324 total for Jack. It also affected Alabama bowlers.

The repaired collector:

- Recognizes both literal-space and URL-encoded links from the Bowl.com results page.
- Adds a cache-busting query value whenever it downloads a PDF.
- Rejects the valid-PDF `Results Coming Soon` placeholders for unpublished rounds.
- Parses standings rows relative to `Squad NN Day N`, then validates game, block, grand-total, and average arithmetic.
- Handles Bowl.com exceptions such as a missing state and a USBC ID joined to a bowler name.
- Uses the newest valid qualifying report for rank, total, average, participant count, Alabama standings, and source timestamp.
- Preserves existing dashboard results if no valid report can be fetched.
- Includes parser regression tests that run before every automated refresh.
- Validates the generated dashboard before committing it.
- Retries a push from the newest `main` branch if another commit wins the race.

Run locally with:

```bash
python -m unittest discover -s tests -v
python scripts/update_results.py
```
