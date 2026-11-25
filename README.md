# Spese di casa

A small app for keeping track of household expenses: condominium fees (yearly budgets, instalments, final statements), electricity, gas and internet bills, Italian local taxes (TARI and IMU), home works with tax deductions, questions for the building manager, deadlines, vehicles and driving licences.

**Open the app:** https://comevuoitu.github.io/spese-casa-app/

It installs on iPhone, iPad, Android, Mac and PC, and works offline. The app's interface is in Italian; the setup guide is available in Italian and English.

## Where the data lives

This repository contains **only the app's code**, the same for everyone. It holds no personal data.

Each user keeps their data on **their own Google Drive**, through a small Google Apps Script (`Code.gs`) protected by a secret key they choose. Whoever publishes the app cannot see anyone's data.

## Getting started

The full step-by-step guide is in [`guide.txt`](guide.txt) (English) and [`guida.txt`](guida.txt) (Italian), and inside the app (Impostazioni, "Guida"). The guide is written so that a person, or an AI assistant helping them, can follow it. In short:

1. Create the script in your Google account using the kit's `Code.gs`, and choose a secret key.
2. Deploy it as a web app ("Execute as: Me", "Who has access: Anyone") and copy the address ending in `/exec`.
3. Open the app, enter the script address and the key, and choose "Inizia da zero" (start from scratch).

`Code.gs` is not in this repository: it is part of the kit you receive together with the guide.

## Repository contents

| File | Purpose |
|---|---|
| `index.html`, `app.js`, `art.js`, `styles.css` | the app |
| `sw.js`, `manifest.webmanifest`, `icons/` | installation and offline use |
| `lib/exceljs.min.js` | Excel file generation |
| `guide.txt`, `guida.txt` | the guide in English and Italian (also read by the app) |
| `Versioni.txt` | version history (in Italian) |

## Versions

The history is in [`Versioni.txt`](Versioni.txt). Each entry also says whether the Google script needs updating.

## Never upload here

`dati.json`, `dati-vuoti.json`, `Code.gs` with a real key, or any file containing personal data: this repository is public.
