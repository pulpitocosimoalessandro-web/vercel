// api/modpacks.js — versione Vercel con upload diretto a Vercel Blob
//
// Libreria dei modpack pubblici. PUBBLICAZIONE AUTOMATICA: chi propone un
// pack lo rende visibile a tutti immediatamente, senza passare da nessuna
// approvazione manuale. Le azioni "pending" / "approve" / "reject" restano
// per compatibilità con eventuali vecchie versioni del client, ma non fanno
// più nulla di utile (tutto è già pubblico appena proposto).
//
// Storage: Vercel Blob. Il file del pack (che può pesare diversi MB, oltre
// il limite di ~4.5MB del body delle function serverless) NON passa più
// dentro questa function: il browser lo carica DIRETTAMENTE su Vercel Blob
// usando un token generato qui (azione "upload-token"), poi la function
// riceve solo i metadati (nome, descrizione, ecc.) nell'azione "propose".
//
//   - "index.json"       -> array di id pubblicati (JSON)
//   - "entry-<id>.json"   -> metadati del pack (JSON: name, creator, description, size, createdAt)
//   - "data-<id>.bin"     -> bytes del file .cvpack (binario, caricato direttamente dal browser)

const { put, list } = require("@vercel/blob");
const { handleUpload } = require("@vercel/blob/client");

// Limite "di buon senso" per l'upload diretto — non è più legato al body
// delle function (quello valeva solo per la vecchia strada via base64):
// Vercel Blob di per sé accetta file fino a 5TB. 200MB è ampiamente
// sufficiente per un pack video/audio di questo gioco; alzalo se ti serve.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 400 * 1024; // ~400KB, la thumbnail è solo un data URL jpeg piccolo, resta nel body JSON

// Legge un blob JSON dato il suo pathname esatto. Ritorna null se non esiste.
async function readJSON(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  const found = blobs.find((b) => b.pathname === pathname);
  if (!found) return null;
  const r = await fetch(found.url);
  if (!r.ok) return null;
  return await r.json();
}

// Cerca un blob dato il suo pathname esatto e ne ritorna i metadati (inclusa
// la dimensione reale) senza scaricarne il contenuto.
async function findBlob(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  return blobs.find((b) => b.pathname === pathname) || null;
}

// Legge un blob binario dato il suo pathname esatto. Ritorna null se non esiste.
async function readBuffer(pathname) {
  const found = await findBlob(pathname);
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

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Mod-Password");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

// Genera un token che autorizza il browser a caricare DIRETTAMENTE il file
// su Vercel Blob, senza farlo passare da questa function. Il pathname
// consentito è vincolato al pattern "data-<id>.bin" per evitare che il
// token venga usato per scrivere in giro nello store.
async function handleUploadToken(req, res) {
  // handleUpload si aspetta un oggetto "request" in stile Fetch API (con
  // request.headers.get(...)); qui siamo in una function Node.js classica
  // (req/res "vecchio stile"), quindi costruiamo un wrapper minimo attorno
  // a req.headers, che in Node è un semplice oggetto.
  const requestLike = {
    headers: { get: (name) => req.headers[String(name).toLowerCase()] },
  };

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: requestLike,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^data-[a-z0-9]+\.bin$/i.test(pathname)) {
          throw new Error("Pathname non consentito.");
        }
        return {
          allowedContentTypes: ["application/octet-stream"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("Upload pack completato:", blob.pathname, blob.size, "bytes");
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error("Errore generazione token upload:", err);
    return res.status(400).json({ error: err.message || "Errore nella generazione del token di upload." });
  }
}

// Riceve i soli metadati (il file è già su Vercel Blob a questo punto,
// caricato direttamente dal browser con il token ottenuto sopra).
async function handlePropose(req, res) {
  const body = req.body || {};
  const { id, name, creator, description, thumbnailDataUrl, durationSec, lineCount, nsfw } = body;

  if (!id || !/^[a-z0-9]+$/i.test(String(id))) {
    return res.status(400).json({ error: "Id del pack mancante o non valido." });
  }
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Manca il nome del pack." });

  // Verifica che il file sia stato davvero caricato prima di pubblicare i
  // metadati, così non restano entry "fantasma" senza dati dietro.
  const dataBlob = await findBlob(`data-${id}.bin`);
  if (!dataBlob) {
    return res.status(400).json({ error: "File del pack non trovato: caricalo prima di proporre." });
  }

  let thumbnail = null;
  if (
    typeof thumbnailDataUrl === "string" &&
    thumbnailDataUrl.startsWith("data:image/") &&
    thumbnailDataUrl.length <= MAX_THUMBNAIL_BYTES
  ) {
    thumbnail = thumbnailDataUrl;
  }

  const meta = {
    id,
    name: String(name).trim().slice(0, 120),
    creator: String(creator || "").trim().slice(0, 80),
    description: String(description || "").trim().slice(0, 400),
    size: dataBlob.size,
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
    if (action === "upload-token" && req.method === "POST") return await handleUploadToken(req, res);
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
