// api/modpacks.js — versione Vercel (Node.js Serverless Function)
//
// Libreria dei modpack pubblici. PUBBLICAZIONE AUTOMATICA: chi propone un
// pack lo rende visibile a tutti immediatamente, senza passare da nessuna
// approvazione manuale. Le azioni "pending" / "approve" / "reject" restano
// per compatibilità con eventuali vecchie versioni del client, ma non fanno
// più nulla di utile (tutto è già pubblico appena proposto).
//
// Storage: Vercel Blob (store nativo del progetto, token BLOB_READ_WRITE_TOKEN
// iniettato automaticamente da Vercel — nessuna variabile da configurare a
// mano). A differenza di Netlify Blobs, Vercel Blob non offre un "get per
// chiave": si scrive con put() e si legge cercando il blob con list() +
// scaricando il suo url pubblico. Per questo sotto ci sono due piccoli
// helper (readJSON/readBuffer) che replicano il comportamento di s.get(...)
// usato in precedenza, così il resto della logica resta identico.
//
//   - "index.json"       -> array di id pubblicati (JSON)
//   - "entry-<id>.json"   -> metadati del pack (JSON: name, creator, description, size, createdAt)
//   - "data-<id>.bin"     -> bytes del file .cvpack (binario)

const { put, list } = require("@vercel/blob");

// ATTENZIONE - limite reale della piattaforma, non solo "di sicurezza":
// le funzioni serverless di Vercel accettano un body massimo di ~4.5MB. Il
// file arriva qui dentro un JSON in base64, che pesa ~1.37x il file
// originale, quindi il file vero e proprio deve restare ben sotto quella
// soglia. Se ti servono pack più grandi, l'unica soluzione robusta è
// caricare il file direttamente su Vercel Blob con un client upload
// (upload diretto dal browser tramite URL firmata, bypassando del tutto
// la function) invece di passarlo dentro il body JSON.
const MAX_BYTES = 3 * 1024 * 1024; // ~3MB: tiene il JSON (base64 + overhead) sotto il limite di piattaforma
const MAX_THUMBNAIL_BYTES = 400 * 1024; // ~400KB, la thumbnail è solo un data URL jpeg piccolo

// Legge un blob JSON dato il suo pathname esatto. Ritorna null se non esiste.
async function readJSON(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  const found = blobs.find((b) => b.pathname === pathname);
  if (!found) return null;
  const r = await fetch(found.url);
  if (!r.ok) return null;
  return await r.json();
}

// Legge un blob binario dato il suo pathname esatto. Ritorna null se non esiste.
async function readBuffer(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  const found = blobs.find((b) => b.pathname === pathname);
  if (!found) return null;
  const r = await fetch(found.url);
  if (!r.ok) return null;
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

// Scrive (o sovrascrive) un blob JSON a un pathname fisso.
async function writeJSON(pathname, obj) {
  await put(pathname, JSON.stringify(obj), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

// Scrive (o sovrascrive) un blob binario a un pathname fisso.
async function writeBuffer(pathname, buf) {
  await put(pathname, buf, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/octet-stream",
  });
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

  await writeBuffer(`data-${id}.bin`, buf);

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
  await writeJSON(`entry-${id}.json`, meta);

  const idx = (await readJSON("index.json")) || [];
  idx.push(id);
  await writeJSON("index.json", idx);

  return res.status(200).json({ ok: true, id });
}

async function handleList(res) {
  const idx = (await readJSON("index.json")) || [];
  const entries = [];
  for (const id of idx) {
    const meta = await readJSON(`entry-${id}.json`);
    if (meta) entries.push(meta);
  }
  entries.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return res.status(200).json(entries);
}

async function handleGet(req, res) {
  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ error: "Manca l'id del pack." });

  const buf = await readBuffer(`data-${id}.bin`);
  if (!buf) return res.status(404).json({ error: "Pack non trovato." });

  res.setHeader("Content-Type", "application/octet-stream");
  return res.status(200).send(buf);
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
    try {
      console.error("Dettagli completi errore:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
    } catch (_) {}
    return res.status(500).json({ error: err.message || "Errore interno del server." });
  }
};
