# CertStudy - ISTQB CTFL study web app

A dependency-free web app for studying the ISTQB **Certified Tester Foundation Level (CTFL) v4.0**
exam with the official sample exam questions, answers and explanations.

Open `index.html` over http(s) (GitHub Pages, the FreeMilk preview, or any static host).
There is no build step, no framework and no backend.

## What is in it

- **186 questions** from the four CTFL v4.0 sample exams published on istqb.org:
  set A (40 exam questions + 26 additional), set B, C and D (40 each).
- Practice mode: choose a set, shuffle, filter to questions you have not answered correctly.
  A session shows Previous, Show answer and Next. Choosing an option never reveals the answer;
  Show answer opens the official answer, the explanation and a small reference linking the ISTQB
  sample exam answers document and the syllabus learning objective.
- Mock exam: a 40-question paper (one ISTQB set, or 40 random questions), 60-minute timer,
  answers hidden until submission, pass mark 26/40, per-chapter result breakdown, resume after a reload.
- Review: bookmarks and every question you answered incorrectly.
- Stats: answered count, accuracy, per-chapter and per-set progress, mock exam history.
- Light and dark themes. Everything is stored in `localStorage` on the device: no account,
  no analytics, no network calls except loading the app's own JSON files.

## Certification selector

Every ISTQB certification in the scheme is listed (Foundation, Advanced, Specialist, Expert)
with a short summary, its audience, its prerequisites and how exam fees work.
Only CTFL v4.0 has a question bank in this phase; the other certifications are selectable and
show their reference details with "no questions yet" until their banks are added.

## Data

```
data/certifications.json   Certification catalogue, fees guidance, copyright notice
data/ctfl/set-a.json       CTFL v4.0 sample exam A (v1.7)
data/ctfl/set-b.json       CTFL v4.0 sample exam B (v1.7)
data/ctfl/set-c.json       CTFL v4.0 sample exam C (v1.6)
data/ctfl/set-d.json       CTFL v4.0 sample exam D (v1.5)
```

Question schema (compact keys to keep the files small):

```json
{
  "n": 12,              // question number as printed, e.g. 12 or "A7"
  "s": "exam",          // "exam" for the 40 exam-shaped questions, "extra" for the additional ones
  "p": 1,               // points
  "lo": "FL-4.2.3",     // ISTQB learning objective
  "k": "K3",            // K-level
  "a": ["d"],           // correct option keys (two entries for a multi-select question)
  "q": "Question stem, tables flattened into readable lines",
  "o": [["a", "Option text"], ["b", "..."], ["c", "..."], ["d", "..."]],
  "e": "Explanation of why the answer is right and the others are wrong, summarised from the ISTQB justification"
}
```

Each set file also carries `answersUrl` and `questionsUrl` (the official istqb.org download for
that sample exam) for provenance. The PDFs themselves are mirrored into `docs/ctfl/` so they can be
read inside the app.

## Source documents (in-app PDF reader)

The nine official ISTQB PDFs are stored in `docs/ctfl/` and rendered page by page with a vendored
build of Mozilla's pdf.js (`assets/vendor/pdfjs/`, version 3.11.174, legacy build). They open at
`#/doc/<docId>`, scroll like a document, zoom with `+` / `-`, and load/release page canvases as you
scroll so memory stays low on phones.

Doc ids: `a-questions`, `a-answers` … `d-questions`, `d-answers`, plus `syllabus`.

Every revealed answer links to `#/doc/a-questions/12` (the question is scrolled to and outlined in
gold, table-of-contents pages are skipped), to the set's answers PDF, and to the syllabus section
for its learning objective.

`docs/` (about 3.7 MB) is static content served as-is; nothing is sent to any other service.

Sources: the CTFL v4.0 downloads on
[istqb.org/certifications/certified-tester-foundation-level-ctfl-v4-0](https://istqb.org/certifications/certified-tester-foundation-level-ctfl-v4-0/).
Question numbering, options and correct answers follow the published documents; explanations are
condensed from the ISTQB "Explanation / Rationale" column.

## Structure

```
index.html            app shell, header, bottom navigation
assets/css/app.css    single stylesheet, theme variables, light + dark
assets/js/app.js      routing, views, session logic, local storage
assets/favicon.svg
data/                 catalogue and question banks
```

## Roadmap

- Phase 2: question banks for the other certifications, per-certification mock exam structures.
- Phase 3: accounts and cross-device sync, shared question bank API, spaced repetition schedule.
- Long term: iOS and Android apps against a paid subscription.

## Copyright

Sample exam questions, answers and justifications are (c) International Software Testing
Qualifications Board (ISTQB) and are reproduced for non-commercial study with the source
acknowledged, as the ISTQB sample exam copyright notice allows. This project is not affiliated
with, endorsed by or accredited by ISTQB or any Member Board.

The ISTQB sample exam terms permit non-commercial copying with attribution. Any **paid**
subscription product built from this content needs written approval from ISTQB, so clear that
before the mobile subscription phase.
