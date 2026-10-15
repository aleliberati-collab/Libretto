# Libretto

Registro finanziario personale come web app installabile (PWA): conti, sottoconti, depositi, investimenti per bucket, piano mensile e glide-path verso un obiettivo di capitale.

- **Offline:** dopo la prima apertura funziona senza rete.
- **Dati solo sul dispositivo:** tutto resta nel browser del telefono; il backup è un file JSON da esportare. Nessun dato personale vive in questo repository.
- **Parametri personali nelle Impostazioni:** obiettivo, fasi del glide-path, percentuali del piano e nomi dei conti si impostano in *Piano mensile → Impostazioni del piano* e viaggiano nel backup.

## Struttura

| File | Ruolo |
|---|---|
| `src/app.jsx` | sorgente dell'app (React) |
| `app.js` | build generata da `src/app.jsx` |
| `index.html`, `style.css` | pagina e stile |
| `sw.js.template` → `sw.js` | service worker per l'uso offline |
| `vendor/` | React 18.3.1, servito localmente |

## Modificare

```
npm install
npm run build
```

Ogni build aggiorna `app.js` e la versione in `sw.js`: all'apertura successiva l'app mostra "Nuova versione pronta".
