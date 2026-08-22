// api/turn-credentials.js — versione Vercel (Node.js Serverless Function)
//
// Restituisce la configurazione ICE (STUN+TURN) da usare per il multiplayer
// (WebRTC via PeerJS). Nessuna modifica di logica rispetto alla versione
// Netlify: cambia solo la "forma" della function (req, res) invece di
// (event) -> { statusCode, headers, body }.
//
// Se sono impostate le variabili d'ambiente METERED_API_KEY e METERED_APP_NAME
// (account gratuito su https://www.metered.ca/tools/openrelay -> Dashboard TURN),
// vengono chieste credenziali TURN personali e a tempo: molto più affidabili
// del set pubblico condiviso, che è sovraccarico e spesso non risponde,
// soprattutto quando i due giocatori sono su reti diverse.
//
// Se quelle variabili NON sono impostate, si torna al set pubblico condiviso
// (openrelayproject) come fallback: il multiplayer funziona comunque, ma è
// meno affidabile tra reti diverse finché non si configura un account TURN
// personale (gratuito).

const FALLBACK_ICE_SERVERS = [
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "turn:global.relay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:global.relay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:global.relay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const apiKey = process.env.METERED_API_KEY;
  const appName = process.env.METERED_APP_NAME;

  if (apiKey && appName) {
    try {
      const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url);
      if (r.ok) {
        const iceServers = await r.json();
        if (Array.isArray(iceServers) && iceServers.length) {
          return res.status(200).json({ iceServers, source: "metered" });
        }
      } else {
        console.error("Metered TURN API ha risposto con errore:", r.status, await r.text().catch(() => ""));
      }
    } catch (err) {
      console.error("Errore nel recupero delle credenziali TURN da Metered:", err);
    }
  }

  return res.status(200).json({ iceServers: FALLBACK_ICE_SERVERS, source: "fallback" });
};
