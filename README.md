# va02-dashboard

VA-02 Race Dashboard — Kiggans vs. Luria. React + Vite, deployed on Vercel.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

API keys go in a local `.env` file (git-ignored) and are never committed.

## Early Vote Tracker (private data)

The tracker runs on Virginia's Daily Absentee List (DAL), which the Department of
Elections sells to qualified requesters (candidates, parties, PACs). It lists
individual voters, so the file itself never goes in this repo.

1. Save each day's DAL CSV in a private folder. Because this repo is in OneDrive,
   use a folder outside OneDrive (for example `C:\DAL`) so voter files aren't
   synced to the cloud. `data/dal/` also works and is git-ignored.
2. Run it (PowerShell), or just `npm run early-vote` if the files are in `data/dal/`:
   ```powershell
   $env:DAL_DIR = "C:\DAL"; npm run early-vote
   ```
   For the day-by-day 2022 comparison, put the 2022 November General DAL in the same folder.
3. Commit `data/early_vote.json`, which holds only daily counts by locality.

`npm run sample-dal -- <folder>` writes fake DAL files for testing. Output built from
them is marked as sample data, and the site shows a "Sample data" banner.
