import { put, get, list } from "@vercel/blob";

const PREFIX = "modpacks/";

function json(res, status, data) {
  res.status(status).json(data);
}

export default async function handler(req, res) {
  try {
    const action = req.query.action || req.body?.action;

    if (!action) {
      return json(res, 400, { error: "Azione sconosciuta." });
    }

    if (action === "list") {
      const result = await list({ prefix: PREFIX });

      const modpacks = result.blobs.map((blob) => ({
        name: blob.pathname.replace(PREFIX, ""),
        url: blob.url,
      }));

      return json(res, 200, modpacks);
    }

    if (action === "get") {
      const name = req.query.name || req.body?.name;

      if (!name) {
        return json(res, 400, { error: "Nome modpack mancante." });
      }

      const blob = await get(`${PREFIX}${name}`, {
        access: "private",
      });

      if (!blob) {
        return json(res, 404, { error: "Modpack non trovato." });
      }

      return new Response(blob.stream, {
        headers: {
          "Content-Type": blob.contentType || "application/octet-stream",
        },
      });
    }

    if (action === "propose") {
      const name = req.body?.name || req.query.name;
      const content = req.body?.content;

      if (!name || content === undefined) {
        return json(res, 400, {
          error: "Nome o contenuto del modpack mancanti.",
        });
      }

      const safeName = String(name)
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 100);

      const data =
        typeof content === "string"
          ? content
          : JSON.stringify(content);

      const blob = await put(`${PREFIX}${safeName}`, data, {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
      });

      return json(res, 200, {
        success: true,
        name: safeName,
        url: blob.url,
      });
    }

    return json(res, 400, { error: "Azione sconosciuta." });
  } catch (error) {
    console.error("modpacks error:", error);

    return json(res, 500, {
      error: error?.message || "Errore interno del server.",
    });
  }
}
