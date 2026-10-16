# Pronađi svoj ples — lead form for PROAM dance Serbia

A mobile-first questionnaire that PROAM dance Serbia links from its Instagram bio and Stories.
A visitor answers eight one-tap questions about the dance they want, their level, goals, area of
Belgrade and schedule, leaves a name and Instagram handle, and the answers land in a Google Sheet
where the studio matches them with a school or coach by hand.

It is a single static `index.html` with no build step and no dependencies, backed by a
Google Apps Script web app — so there is no server to run or pay for.

## Architecture

```
index.html (GitHub Pages / Netlify)
   │  fetch POST  ──or──  hidden-iframe form POST (fallback for in-app browsers)
   ▼
Apps Script web app  (apps-script/Code.gs)
   ├─ spam filters ──────────────▶  "Blocked" sheet, with the reason
   ├─ appendRow ─────────────────▶  "Leads" sheet (status dropdown, colour-coded rows)
   ├─ e-mail + Telegram alerts      (independent; one failing never loses the lead)
   └─ analytics events ──────────▶  "Statistika" sheet → hourly-rebuilt "Pregled" dashboard
```

## Technical highlights

- **Works inside Instagram's in-app browser** — submission tries `fetch` first and falls back to a
  classic form POST into a hidden iframe, which avoids the CORS and redirect quirks of in-app
  WebViews. A draft of the answers is kept in `localStorage` for an hour, so an accidental exit
  does not lose them.
- **Spam defence without a CAPTCHA** — the endpoint URL is public, so the script rejects a
  submission if a hidden honeypot field is filled, if a shared token does not match, if the form was
  completed faster than a human could (`MIN_SECONDS`), or if it duplicates a lead from the last
  ten minutes. Rejected leads are logged with the reason instead of silently dropped.
- **Privacy-light funnel analytics** — the page sends four events (`view`, `start`, `exit` with the
  last question reached, `submit`) tagged only with a random per-tab session id: no names, IPs or
  cookies, so no consent banner is needed. A time-driven trigger rebuilds a dashboard with
  conversion rate, visitors per day and hour, drop-off per question and traffic source (`?src=`).
- **Three languages** — Serbian, Russian and English, chosen by `?lang=`, a remembered choice or
  the phone's language. Answers are always stored in Serbian so the sheet stays consistent.
- **Data-driven questions** — every question is an entry in a `QUESTIONS` array (single or
  multi-select, "other" free-text options, exclusive options that clear the rest).
- **Instant notifications** — a branded HTML e-mail and/or a Telegram card with inline buttons to
  the visitor's Instagram profile and to the sheet.

## Files

| Path | Contents |
|---|---|
| `index.html` | The whole form: markup, styles, questions, i18n, submission and analytics |
| `apps-script/Code.gs` | Web-app endpoint, sheet setup, spam filters, notifications, dashboard |
| `assets/` | Logos |
| `netlify.toml` | Static hosting config and cache headers |
| [`docs/SETUP.ru.md`](docs/SETUP.ru.md) | Full step-by-step setup guide for the studio (in Russian) |

## Running it locally

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

Without an `ENDPOINT` configured the form runs end to end and prints the payload to the browser
console instead of sending it. Deploying the Apps Script and connecting it is covered in
[`docs/SETUP.ru.md`](docs/SETUP.ru.md).

## Author

Vladislav Salii
