# AP Spanish Trainer

A lightweight, zero-build static web application designed to prepare students for the **AP Spanish Language and Culture** exam from 9th through 12th grade.

**Live Site:** [https://ap-spanish-trainer.netlify.app](https://ap-spanish-trainer.netlify.app) *(automatically updated from the `main` branch)*

Instead of memorizing isolated 50-word translation lists, this app trains high-utility **contextual chunks, argumentative connectors, and thematic vocabulary** across all official College Board AP themes using an **SM-2 Spaced Repetition System (SRS)** backed by IndexedDB.

## Key Features

- **Three Study Modes Under Tab 1 (`Study`):**
  1. **Chunk / Phrase Tests (SM-2 SRS):** Learn phrases inside full AP-level sentences with customizable daily pacing (default: 20 new chunks/day, 7,300/year), grade-level filtering, optional **Word Lookup** (default Off; hover or highlight any Spanish word for an instant local English definition + audio), and optional **Speaking Detection Mode** (`🎙️ Voice Mode`).
  2. **Vocab Test (Type or Speak):** Forward (`ES → EN`), backward (`EN → ES`), or mixed typed/spoken recall quizzes built from `packs/vocabulary.json` (`2,492` unique words & `536` AP phrases), prioritizing words and phrases from the Phrase Tests alongside additional matching vocabulary.
  3. **Conjugation Test (Full 6-Person Matrix w/ `vosotros`):** 2-stage verb drill across all `397` verbs extracted from the phrase packs (`packs/verbs.json`): English infinitive → type or speak Spanish infinitive → complete the full 6-person conjugation matrix across 8 AP tenses (with automatic pronoun prefix trimming in Voice Mode).
- **Speaking Detection Mode (`🎙️ Voice Mode`):** Speak Spanish or English answers directly into input boxes with automatic Spanish accent restoration (`autoAccents: true` by default), default **fill-box & wait-for-Enter** behavior, or configurable **Auto-Submit After Silence** (default `3s`, `1`–`10`s), saved to Google Drive.
- **Modular JSON Curriculum Packs (`/packs/`):** 7,300 unique phrases per grade level (**29,200 total**), balanced across all 7 AP themes (`grade9-foundations.json` through `grade12-foundations.json`), plus `vocabulary.json` and `verbs.json`.
- **Preply Tutor "Gap Phrase" Capture:** Add single sentences or bulk-paste pipe-separated lines (`Spanish sentence | target chunk | English hint | AP Theme`) directly from tutoring chat logs.
- **AP Cultural Comparison Simulator (`2:00`, `4:00`, or Custom Duration) + Translation & Grading:** Simulates AP Speaking Task 4 with live continuous microphone transcription, audio playback, **Spanish → English translation first** (Chrome on-device `Translator` API when available + local AP phrase/conjugated-verb dictionary), followed by automated **AP 1–5 rubric grading**, optional Chrome Gemini Nano feedback, and a 1-click prompt copy bridge to `gemini.google.com` — **zero Gemini API keys required**.
- **Hybrid Google Neural Audio & Multi-Theme Accessibility:** Chrome built-in `Google español` neural voices + optional Google Cloud TTS (`Neural2`), plus Light, Dark, Midnight, Sepia, High Contrast, and Colorblind-Friendly modes.
- **Multi-User Google Sign-In & Google Drive Sync:** Uses Google Identity Services and the privacy-first `drive.appdata` scope to store compact, delta-merged progress, shared grade-level preference, daily pace, Word Lookup toggle, Voice Mode settings, and Vocab/Verb test stats with automatic atomic backups.

## Repository Structure

```text
ap-spanish-trainer/
├── index.html                        # Clean HTML shell, header, and partial mount slots
├── partials/
│   ├── study-chunks.html             # Study Sub-Tab 1: Contextual SM-2 Chunk/Phrase trainer
│   ├── vocab-quiz.html               # Study Sub-Tab 2: Typed/Spoken Vocab Test
│   ├── conjugation.html              # Study Sub-Tab 3: 6-Person Verb Conjugation Test
│   ├── preply-add.html               # Tab 2: Preply Quick-Add (single & bulk import)
│   ├── speaking.html                 # Tab 3: AP Cultural Comparison Simulator & Grader
│   ├── manage-deck.html              # Tab 4: Deck Browser & JSON Export/Import
│   └── modals.html                   # Google Drive Sync, How to Use, & Settings modals
├── styles/
│   └── themes.css                    # Cloze, Word Lookup, Graded Matrix, & Multi-Color/Accessibility themes
├── js/
│   ├── app.js                        # ES module bootstrapper
│   ├── partials.js                   # Concurrent HTML partial loader
│   ├── constants.js                  # Keys, catalogs, speaking prompts, normalization helpers
│   ├── storage.js                    # IndexedDB wrapper, shared state, user preferences, telemetry
│   ├── ui.js                         # Navigation tabs, Study sub-tabs, Settings/Help/Confirm modals
│   ├── audio.js                      # Hybrid Web Speech + Google Cloud TTS engine
│   ├── packs.js                      # 4-grade deck loader + IndexedDB-cached vocabulary & verb indices
│   ├── sync.js                       # Google Sign-In OAuth + Google Drive AppData delta sync
│   ├── speechInput.js                # Speaking Detection Mode (Web Speech API, auto-accents, auto-submit)
│   ├── speakingAnalyzer.js           # Zero-API-key ES->EN translator & AP Task 4 speech grader
│   ├── wordLookup.js                 # Study Chunk-only instant hover & drag-highlight definitions
│   ├── studyChunks.js                # SM-2 scheduler & cloze flashcards
│   ├── vocabQuiz.js                  # Typed/spoken forward/backward Vocab Test
│   ├── conjugation.js                # 2-stage AP verb conjugation trainer (with vosotros)
│   ├── preplyAdd.js                  # Single & bulk Preply gap-phrase capture
│   ├── speaking.js                   # AP Task 4 Cultural Comparison simulator & live speech pipeline
│   └── manageDeck.js                 # Deck table browser, search, delete, & JSON import/export
├── config.js                         # Optional local OAuth Client ID config (injected via Netlify env var)
├── netlify.toml                      # Netlify build/deploy configuration
├── packs/
│   ├── grade9-foundations.json       # Level 1: 9th Grade Foundations (7,300 phrases)
│   ├── grade10-foundations.json      # Level 2: 10th Grade Intermediate (7,300 phrases)
│   ├── grade11-foundations.json      # Level 3: 11th Grade Pre-AP (7,300 phrases)
│   ├── grade12-foundations.json      # Level 4: 12th Grade AP Mastery (7,300 phrases)
│   ├── vocabulary.json               # Local browser dictionary (2,492 words + 536 phrases)
│   └── verbs.json                    # Full 6-person verb conjugation bank (397 verbs w/ vosotros)
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
