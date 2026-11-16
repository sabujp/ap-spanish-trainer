# AP Spanish Trainer

A lightweight, zero-build static web application designed to prepare students for the **AP Spanish Language and Culture** exam from 9th through 12th grade.

Instead of memorizing isolated 50-word translation lists, this app trains high-utility **contextual chunks, argumentative connectors, and thematic vocabulary** across all official College Board AP themes using an **SM-2 Spaced Repetition System (SRS)**.

## Key Features

- **Contextual Cloze-Deletion Flashcards (SM-2 Algorithm):** Learn phrases inside full, realistic Spanish sentences with customizable daily new-card pacing (default: 15 new chunks/day) and grade-level filtering (`Level 1: 9th Grade Foundations` through `Level 3: AP Exam Mastery`).
- **Modular JSON Curriculum Packs (`/packs/`):** Phrase packs live in separate `.json` files (`grade9-foundations.json`, `grade10-intermediate.json`, `grade11-pre-ap.json`, `grade12-ap-mastery.json`) so the core app stays fast and expandable.
- **Preply Tutor "Gap Phrase" Capture:** Add single sentences or bulk-paste pipe-separated lines (`Spanish sentence | target chunk | English hint | AP Theme`) directly from tutoring chat logs.
- **2-Minute AP Cultural Comparison Simulator:** Simulates AP Speaking Task 4 with timed prep/speaking modes and 3 randomly drawn learned chunks to weave into your response.
- **Hybrid Google Neural Audio:** Automatically uses Chrome's built-in `Google español` neural voices over HTTPS, with an optional client-side fallback to Google Cloud Text-to-Speech (`Neural2`).
- **Multi-User Google Sign-In & Google Drive Sync:** Uses Google Identity Services and the privacy-first `drive.appdata` scope to store compact, delta-merged progress files (`~2–15 KB`) with automatic atomic backups directly in each user's personal Google Drive.

## Repository Structure

```text
ap-spanish-trainer/
├── index.html                        # Single-file web application (HTML + Tailwind CDN + Vanilla JS)
├── packs/
│   ├── grade9-foundations.json       # Level 1: 9th Grade Foundations across all 7 AP themes
│   ├── grade10-intermediate.json     # Level 2: 10th Grade Intermediate (optional expansion)
│   ├── grade11-pre-ap.json           # Level 2–3: 11th Grade Pre-AP (optional expansion)
│   └── grade12-ap-mastery.json       # Level 3: 12th Grade AP Exam Mastery (optional expansion)
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
