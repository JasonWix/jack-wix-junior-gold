# Jack Wix Junior Gold 2026 Dashboard

A mobile-friendly GitHub Pages dashboard for Jack Wix's U18 Boys results.

## Publish

1. Create a **public** GitHub repository, preferably named `jack-wix-junior-gold`.
2. Upload all files in this project to the repository's `main` branch.
3. In **Settings → Pages**, set Source to **GitHub Actions**.
4. Open **Actions** and run `Update Junior Gold dashboard` once.
5. Share the Pages URL shown in the `Deploy GitHub Pages` workflow.

The updater runs every 30 minutes. GitHub may delay scheduled workflows during high load.

## Data behavior

- Pulls the official 2026 Junior Gold U18 Boys PDFs from Bowl.com.
- Searches for `Jack Wix`.
- Updates game scores, totals, average and target pace.
- The page automatically counts down to Jack's next Squad 1 qualifying block.
- Includes an Alabama U18 Boys leaderboard with rank, hometown, games, total, average, and comparison to Jack.
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

Each card includes the registered serial number, a short role description, an official manufacturer image, and a product-source link. The White Dot color was not specified on the equipment card, so its image is clearly labeled as representative.

## Latest dashboard clarification

- The cut-gap and needed-average tiles are explicitly labeled as placeholders, not official projections.
- A cut explanation panel states that the first official cut is not set until all U18 Boys complete 16 qualifying games.
- The top of the page links to Jack Wix Bowling on Facebook.
- The Alabama leaderboard is labeled partial while additional Alabama bowlers compete later on July 13, and automatically changes to complete after today.
- Jack's Columbia 300 White Dot is identified as the white / Diamond version and uses a matching white-ball image.
