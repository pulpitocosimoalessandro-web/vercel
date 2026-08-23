// api/modpacks.js — versione Vercel (Node.js Serverless Function)
//
// Libreria dei modpack pubblici. PUBBLICAZIONE AUTOMATICA: chi propone un
// pack lo rende visibile a tutti immediatamente, senza passare da nessuna
// approvazione manuale. Le azioni "pending" / "approve" / "reject" restano
// per compatibilità con eventuali vecchie versioni del client, ma non fanno
// più nulla di utile (tutto è già pubblico appena proposto).
//
// Storage: Netlify Blobs, store "modpacks" (si continua a usare Netlify Blobs
// come storage anche se il sito NON è più ospitato su Netlify: è un servizio
// HTTP indipendente, basta passargli siteID + token a mano, vedi store()
// sotto). Così i pack già pubblicati in precedenza restano validi.
//
//   - "index"        -> array di id pubblicati (JSON)
//   - "entry:<id>"    -> metadati del pack (JSON: name, creator, description, size, createdAt)
//   - "data:<id>"     -> bytes del file .cvpack (binario)

const { getStore } = require("@netlify/blobs");

// ATTENZIONE - limite reale della piattaforma, non solo "di sicurezza":
// le funzioni serverless di Vercel accettano un body massimo di ~4.5MB (lo
// stesso valeva su Netlify Functions "classiche", ~6MB). Il file arriva qui
// dentro un JSON in base64, che pesa ~1.37x il file originale, quindi il
// file vero e proprio deve restare ben sotto quella soglia. Un limite alto
// come "200MB" nel codice non serve a nulla se la piattaforma rifiuta prima
// la richiesta con 413: per questo è abbassato a un valore realmente
// raggiungibile. Se ti servono pack più grandi, l'unica soluzione robusta è
// caricare il file direttamente su Netlify Blobs con una URL firmata
// (upload diretto dal browser, bypassando del tutto la function) invece di
// passarlo dentro il body JSON.
const MAX_BYTES = 3 * 1024 * 1024; // ~3MB: tiene il JSON (base64 + overhead) sotto il limite di piattaforma
const MAX_THUMBNAIL_BYTES = 400 * 1024; // ~400KB, la thumbnail è solo un data URL jpeg piccolo

// Su Vercel (come già succedeva su Netlify quando l'iniezione automatica non
// scattava) siteID e token vanno passati a mano: il siteID non è un segreto
// (è visibile in Netlify → Project configuration → Project details →
// Project ID), il token va creato una volta come "Personal access token" su
// Netlify e salvato come variabile d'ambiente NETLIFY_API_TOKEN su Vercel.
function store() {
  const token = process.env.NETLIFY_API_TOKEN;
  const siteID = process.env.NETLIFY_SITE_ID;
  if (!token || !siteID) {
    throw new Error(
      "Storage non configurato: mancano le variabili d'ambiente NETLIFY_SITE_ID e/o NETLIFY_API_TOKEN."
    );
  }
  return getStore({ name: "modpacks", siteID, token });
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Mod-Password");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function handlePropose(req, res) {
  const body = req.body || {};
  const { name, creator, description, dataBase64, thumbnailDataUrl, durationSec, lineCount, nsfw } = body;

  if (!name || !String(name).trim()) return res.status(400).json({ error: "Manca il nome del pack." });
  if (!dataBase64) return res.status(400).json({ error: "Manca il file del pack." });

  let thumbnail = null;
  if (
    typeof thumbnailDataUrl === "string" &&
    thumbnailDataUrl.startsWith("data:image/") &&
    thumbnailDataUrl.length <= MAX_THUMBNAIL_BYTES
  ) {
    thumbnail = thumbnailDataUrl;
  }

  let buf;
  try {
    buf = Buffer.from(dataBase64, "base64");
  } catch (e) {
    return res.status(400).json({ error: "Dati del pack non validi (base64 malformato)." });
  }
  if (!buf.byteLength) return res.status(400).json({ error: "Il pack risulta vuoto." });
  if (buf.byteLength > MAX_BYTES) {
    return res.status(413).json({ error: `Pack troppo grande (limite ${MAX_BYTES / 1024 / 1024}MB).` });
  }

  const id = generateId();
  const s = store();

  await s.set(`data:${id}`, buf);

  const meta = {
    id,
    name: String(name).trim().slice(0, 120),
    creator: String(creator || "").trim().slice(0, 80),
    description: String(description || "").trim().slice(0, 400),
    size: buf.byteLength,
    thumbnail,
    durationSec: Number.isFinite(+durationSec) ? Math.max(0, Math.round(+durationSec)) : 0,
    lineCount: Number.isFinite(+lineCount) ? Math.max(0, Math.round(+lineCount)) : 0,
    nsfw: !!nsfw,
    createdAt: new Date().toISOString(),
  };
  await s.setJSON(`entry:${id}`, meta);

  const idx = (await s.get("index", { type: "json" })) || [];
  idx.push(id);
  await s.setJSON("index", idx);

  return res.status(200).json({ ok: true, id });
}

async function handleList(res) {
  const s = store();
  const idx = (await s.get("index", { type: "json" })) || [];
  const entries = [];
  for (const id of idx) {
    const meta = await s.get(`entry:${id}`, { type: "json" });
    if (meta) entries.push(meta);
  }
  entries.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return res.status(200).json(entries);
}

async function handleGet(req, res) {
  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ error: "Manca l'id del pack." });

  const s = store();
  const buf = await s.get(`data:${id}`, { type: "arrayBuffer" });
  if (!buf) return res.status(404).json({ error: "Pack non trovato." });

  res.setHeader("Content-Type", "application/octet-stream");
  return res.status(200).send(Buffer.from(buf));
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const action = (req.query && req.query.action) || "";

  try {
    if (action === "propose" && req.method === "POST") return await handlePropose(req, res);
    if (action === "list") return await handleList(res);
    if (action === "get") return await handleGet(req, res);

    // compatibilità con il vecchio pannello di moderazione: non serve più,
    // tutto è già pubblico non appena proposto.
    if (action === "pending") return res.status(200).json([]);
    if (action === "approve" || action === "reject") {
      return res.status(200).json({ ok: true, note: "Pubblicazione automatica attiva: non serve più approvare a mano." });
    }

    return res.status(400).json({ error: "Azione sconosciuta." });
  } catch (err) {
    console.error("Errore nella function modpacks:", err);
    // stampiamo anche tutte le proprietà "nascoste" dell'errore (status,
    // response body, headers, ecc.): il messaggio generico di @netlify/blobs
    // ("internal error, 400 status code") non basta a capire la causa vera,
    // ma l'oggetto errore spesso porta con sé molte più informazioni utili.
    try {
      console.error("Dettagli completi errore:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
    } catch (_) {}
    return res.status(500).json({ error: err.message || "Errore interno del server." });
  }
};
