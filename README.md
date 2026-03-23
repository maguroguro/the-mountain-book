# 🏔 The Mountain Book — Setup in 5 minuti

## Struttura cartelle

Crea una cartella (es. `trek-papa/`) e organizzala così:

```
trek-papa/
├── build.py        ← lo script di build (questo file)
├── index.html      ← la webapp
├── gpx/            ← metti qui tutti i file .gpx
│   ├── Dolomiti_2022-07-15.gpx
│   ├── Monte_Rosa_2023-08-20.gpx
│   └── ...
└── foto/           ← una sottocartella per ogni uscita
    ├── Dolomiti 2022-07-15/
    │   ├── IMG_001.jpg
    │   └── IMG_002.jpg
    └── Monte Rosa 2023-08-20/
        └── DSC_001.jpg
```

**Nota sui nomi cartelle foto:** non devono essere identici ai file GPX,
ma se contengono la data nel formato `YYYY-MM-DD` l'associazione è automatica.

---

## Installazione (una volta sola)

Apri il Terminale e installa le dipendenze Python:

```bash
pip install gpxpy Pillow piexif
```

---

## Build

```bash
cd /percorso/di/trek-papa
python3 build.py
```

Lo script:
1. Legge tutti i GPX e ne estrae statistiche + tracciato semplificato
2. Legge tutte le foto, estrae coordinate GPS e timestamp EXIF
3. Associa ogni foto al tracciato corretto (per data o GPS)
4. Genera le miniature in `foto/thumbs/`
5. Produce `data/trek-data.js`

La build può richiedere qualche minuto la prima volta (generazione miniature).
Le run successive sono veloci perché le miniature esistenti vengono saltate.

---

## Aprire la webapp

Doppio click su `index.html`. Si apre nel browser.

**Nota:** la webapp funziona da file locale senza bisogno di un server.

---

## Aggiornare con nuove uscite

1. Aggiungi i file `.gpx` nella cartella `gpx/`
2. Aggiungi la cartella con le foto in `foto/`
3. Riesegui `python3 build.py`
4. Ricarica la pagina nel browser (F5)

---

## Funzionalità

### Mappa
- Tutti i tracciati colorati per anno
- Foto posizionate esattamente dove sono state scattate (con clustering)
- Click su tracciato → pannello con statistiche + profilo altimetrico + galleria foto
- Click su foto sulla mappa → lightbox con navigazione
- Filtro per anno e ricerca per nome

### Statistiche
- Km totali, dislivello cumulativo, quota record
- Grafico uscite per anno e distribuzione mensile
- Top 5 per distanza e dislivello (cliccabili → apre sulla mappa)

### Cronologia
- Vista timeline per anno, con foto di copertina
- Click su una card → apre sulla mappa

### Lightbox
- Navigazione frecce sinistra/destra (anche da tastiera)
- Chiudi con ESC o click fuori

---

## Problemi comuni

**"Dati non trovati"** → esegui `python3 build.py` prima di aprire index.html

**Foto non associate al tracciato** → controlla che la cartella foto contenga la data
nel formato `YYYY-MM-DD`, oppure che le foto abbiano dati GPS nell'EXIF

**Errore `piexif`** → alcune foto hanno EXIF corrotti; vengono saltate automaticamente

**GPX senza nome** → la webapp usa il nome del file; puoi rinominare il .gpx

---

*Buone avventure! 🥾*
