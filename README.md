# Spese di casa

App per tenere sotto controllo le spese di casa: condominio (gestioni, rate, preventivo e consuntivo), bollette di luce, gas e internet, TARI e IMU, lavori con detrazioni, cose da chiedere, scadenze, veicoli e patenti.

**Apri l'app:** https://comevuoitu.github.io/spese-casa-app/

Si installa su iPhone, iPad, Android, Mac e PC, e funziona anche senza rete.

## Dove stanno i dati

Questo repository contiene **solo il codice dell'app**, uguale per tutti. Non contiene dati personali.

Ognuno tiene i propri dati sul **proprio Google Drive**, tramite un piccolo script Google (`Code.gs`) protetto da una chiave segreta scelta da lui. Chi pubblica l'app non vede i dati di nessuno.

## Come iniziare

La guida completa, passo per passo, è nel file [`guida.txt`](guida.txt) e dentro l'app (Impostazioni, "Guida"). In breve:

1. Crea lo script nel tuo account Google con il file `Code.gs` del kit e scegli una chiave.
2. Pubblicalo come applicazione web ("Esegui come: Me", "Chi ha accesso: Chiunque") e copia l'indirizzo che finisce con `/exec`.
3. Apri l'app, inserisci indirizzo dello script e chiave, e scegli "Inizia da zero".

`Code.gs` non è in questo repository: fa parte del kit che ricevi insieme alla guida.

## Contenuto del repository

| File | A cosa serve |
|---|---|
| `index.html`, `app.js`, `art.js`, `styles.css` | l'app |
| `sw.js`, `manifest.webmanifest`, `icons/` | installazione e funzionamento senza rete |
| `lib/exceljs.min.js` | creazione dei file Excel |
| `guida.txt` | la guida (letta anche dall'app) |
| `Versioni.txt` | lo storico delle versioni |

## Versioni

Lo storico è in [`Versioni.txt`](Versioni.txt). Ogni versione dice anche se lo script Google va aggiornato.

## Da non caricare mai qui

`dati.json`, `dati-vuoti.json`, `Code.gs` con la chiave, o qualsiasi file con dati personali: il repository è pubblico.
