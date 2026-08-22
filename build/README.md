# Choicer Voicer — pacchetto pronto per Vercel

Questo pacchetto sostituisce l'hosting su Netlify (attualmente in pausa per crediti
esauriti) con **Vercel**, tenendo però **Netlify Blobs** come storage dei modpack
pubblici, così i dati già pubblicati restano validi e non perdi nulla.

## Cosa contiene

```
index.html              → il gioco (frontend), identico a prima tranne 2 righe
                           che ora puntano a /api/... invece che a /.netlify/functions/...
api/modpacks.js          → libreria pack pubblici (prima era netlify/functions/modpacks.js)
api/turn-credentials.js  → credenziali TURN per il multiplayer (WebRTC)
vercel.json              → config: proxy verso ffmpeg + impostazioni delle function
package.json             → dipendenze (solo @netlify/blobs, usata come storage)
```

## 1. Metti questi file su GitHub

Puoi:
- sovrascrivere i file corrispondenti nel repo che hai già
  (`pulpitocosimoalessandro-web/choicervoicer`), **oppure**
- creare un repo nuovo e caricarli lì.

Se sovrascrivi il repo esistente, puoi anche eliminare `netlify.toml` e la
cartella `netlify/` (non servono più su Vercel), ma non è obbligatorio: se li
lasci, Vercel semplicemente li ignora.

## 2. Collega il repo a Vercel

1. Vai su **vercel.com** → **Add New → Project**.
2. Scegli "Continue with GitHub" e autorizza Vercel ad accedere al repo
   `choicervoicer`.
3. Seleziona il repo. Framework: lascia **"Other"** (è un sito statico + api,
   Vercel lo riconosce da solo grazie a `vercel.json`).
4. Non serve build command: è tutto statico, il file `index.html` sta nella
   root.

## 3. Variabili d'ambiente (obbligatorie per pack pubblici e password mod)

Su Vercel: **Project → Settings → Environment Variables**. Aggiungi:

| Nome | Valore | A cosa serve |
|---|---|---|
| `NETLIFY_SITE_ID` | il Project ID del sito su Netlify (Netlify → Project configuration → Project details) | fa parlare la function con Netlify Blobs anche da fuori Netlify |
| `NETLIFY_API_TOKEN` | un Personal Access Token creato su Netlify (User settings → Applications → Personal access tokens) | stessa cosa: autentica le chiamate a Netlify Blobs |
| `MODPACK_MOD_PASSWORD` | una password a tua scelta | riservata a funzioni di moderazione (oggi non fa nulla di attivo, ma tienila impostata per compatibilità) |

Queste sono le **stesse identiche variabili** che avevi già su Netlify: puoi
copiare gli stessi valori, non serve rigenerarli. Il sito Netlify può restare
in pausa/fermo, Netlify Blobs funziona comunque come storage indipendente
finché quelle credenziali restano valide.

### Multiplayer (opzionale ma consigliato)

| Nome | Valore | A cosa serve |
|---|---|---|
| `METERED_API_KEY` | dal tuo account gratuito su metered.ca/tools/openrelay | credenziali TURN personali, molto più affidabili di quelle pubbliche condivise quando i giocatori sono su reti diverse |
| `METERED_APP_NAME` | l'"app name" mostrato nella stessa dashboard | idem |

Se non le imposti, il multiplayer funziona comunque con un set TURN pubblico
di fallback (meno affidabile, ma non bloccante).

## 4. Deploy

Premi **Deploy**. Al termine avrai un URL tipo `choicervoicer.vercel.app`.
Ogni push su GitHub farà un nuovo deploy automatico (comportamento identico
a Netlify).

## Nota importante sull'errore 413 (upload pack grandi)

Le funzioni serverless di Vercel (come già succedeva su Netlify) accettano un
corpo della richiesta di **massimo ~4.5MB**. Il file del pack arriva dentro
la richiesta come base64 (~37% più pesante dell'originale), quindi in questo
pacchetto ho abbassato il limite dichiarato nel codice a **3MB reali** per
il file, così l'errore 413 non arriva più a sorpresa: se un pack supera 3MB,
il gioco te lo dice chiaramente invece di fallire in modo criptico.

Se ti serve poter proporre pack più grandi (video lunghi), la soluzione
corretta è cambiare il metodo di upload: invece di mandare tutto il file
dentro il body della function, il browser caricherebbe il file **direttamente**
su Netlify Blobs tramite una URL firmata generata al volo dalla function (che
in quel caso riceve solo pochi byte di metadati, non il file). Non l'ho
implementato in questo pacchetto per restare conservativo sulle modifiche,
ma se vuoi te lo preparo come prossimo step.

## Bug di punteggio, clip e scelta scena in multiplayer

Questi restano da sistemare: mi servono ancora 2-3 frasi da te su cosa vedi
esattamente vs cosa ti aspetti (punteggio: che numero esce e quando è
sbagliato; clip: cosa mostra lo schermo di sbagliato quando c'è un
personaggio assegnato; multiplayer: cosa dovrebbe succedere quando si sceglie
un personaggio). Appena me lo descrivi li sistemo e ti preparo un pacchetto
aggiornato.
