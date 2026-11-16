# AP Spanish Trainer

A lightweight, zero-build static web application designed to prepare students for the **AP Spanish Language and Culture** exam from 9th through 12th grade.

**Live Site:** [https://ap-spanish-trainer.netlify.app](https://ap-spanish-trainer.netlify.app) *(automatically updated from the `main` branch)*

Instead of memorizing isolated 50-word translation lists, this app trains high-utility **contextual chunks, argumentative connectors, and thematic vocabulary** across all official College Board AP themes using an **SM-2 Spaced Repetition System (SRS)** backed by IndexedDB.

## Key Features

- **Contextual Cloze-Deletion Flashcards (SM-2 Algorithm):** Learn phrases inside full, realistic Spanish sentences with customizable daily new-card pacing (default: 20 new chunks/day, 7,300/year) and grade-level filtering (`Level 1: 9th Grade Foundations` through `Level 4: 12th Grade AP Mastery`).
- **Modular JSON Curriculum Packs (`/packs/`):** 7,300 unique phrases per grade level (**29,200 total**), equally balanced across all 7 AP themes and stored in separate `.json` files (`grade9-foundations.json`, `grade10-foundations.json`, `grade11-foundations.json`, `grade12-foundations.json`) so the core app stays fast and expandable.
- **Preply Tutor "Gap Phrase" Capture:** Add single sentences or bulk-paste pipe-separated lines (`Spanish sentence | target chunk | English hint | AP Theme`) directly from tutoring chat logs.
- **2-Minute AP Cultural Comparison Simulator:** Simulates AP Speaking Task 4 with timed prep/speaking modes and 3 randomly drawn learned chunks to weave into your response.
- **Hybrid Google Neural Audio:** Automatically uses Chrome's built-in `Google español` neural voices over HTTPS, with an optional client-side fallback to Google Cloud Text-to-Speech (`Neural2`).
- **Multi-User Google Sign-In & Google Drive Sync:** Uses Google Identity Services and the privacy-first `drive.appdata` scope to store compact, delta-merged progress files (`~2–15 KB`) with automatic atomic backups directly in each user's personal Google Drive.

## Repository Structure

```text
ap-spanish-trainer/
├── index.html                        # Single-file web application (HTML + Tailwind CDN + Vanilla JS)
├── config.js                         # Optional local OAuth Client ID config (injected via Netlify env var)
├── netlify.toml                      # Netlify build/deploy configuration
├── packs/
│   ├── grade9-foundations.json       # Level 1: 9th Grade Foundations (7,300 phrases across 7 AP themes)
│   ├── grade10-foundations.json      # Level 2: 10th Grade Intermediate (7,300 phrases across 7 AP themes)
│   ├── grade11-foundations.json      # Level 3: 11th Grade Pre-AP (7,300 phrases across 7 AP themes)
│   └── grade12-foundations.json      # Level 4: 12th Grade AP Mastery (7,300 phrases across 7 AP themes)
├── README.md
└── .gitignore
```

## Quick Deployment (GitHub + Netlify)

1. Push this repository to GitHub.
2. In **Netlify**, select **Add new site → Import an existing project → Deploy with GitHub** and select this repo.
3. Netlify automatically picks up `netlify.toml` (publishes `.`).
4. *(Optional)* To enable **Google Drive Sync** across devices, enable the **Google Drive API** in Google Cloud Console, create a Web OAuth 2.0 Client ID with your Netlify URL under **Authorized JavaScript origins**, and either add `GOOGLE_CLIENT_ID` in **Netlify → Site configuration → Environment variables** (recommended so your Client ID stays out of GitHub) or paste it into `config.js`.

## License

MIT License — see `LICENSE` for details.
