// ============================================================
// TYSHIII ZONE BACKEND
// Receives video uploads from the website, stores them in a
// private Telegram channel, and streams them back on request.
// ============================================================

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram");

const PORT = process.env.PORT || 3000;
const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionString = process.env.TELEGRAM_SESSION;
const channelId = process.env.TELEGRAM_CHANNEL_ID;
const uploadSecret = process.env.UPLOAD_SECRET || "";

if (!apiId || !apiHash || !sessionString || !channelId) {
  console.error(
    "Missing one of TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION / TELEGRAM_CHANNEL_ID.\n" +
    "Set these as environment variables (locally in .env, on Render in the dashboard)."
  );
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 * 1024 } });

const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
  connectionRetries: 5,
});

let ready = false;
(async () => {
  await client.connect();
  ready = true;
  console.log("Connected to Telegram.");
})();

function requireReady(req, res, next) {
  if (!ready) return res.status(503).json({ error: "Backend is still starting up, try again in a few seconds." });
  next();
}

function tagFor(id) {
  return `#tyshiii_${id}`;
}

app.post("/upload", requireReady, upload.single("video"), async (req, res) => {
  try {
    if (uploadSecret && req.headers["x-upload-secret"] !== uploadSecret) {
      return res.status(401).json({ error: "Invalid upload secret." });
    }
    if (!req.file) return res.status(400).json({ error: "No video file received." });

    const title = (req.body.title || req.file.originalname || "Untitled").slice(0, 200);
    const id = "tg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

    await client.sendFile(channelId, {
      file: req.file.buffer,
      attributes: [new Api.DocumentAttributeFilename({ fileName: req.file.originalname })],
      caption: `${title}\n${tagFor(id)}`,
      forceDocument: false,
    });

    res.json({ success: true, id, title });
  } catch (err) {
    console.error("Upload failed:", err);
    res.status(500).json({ error: "Upload failed: " + err.message });
  }
});

app.get("/stream/:id", requireReady, async (req, res) => {
  try {
    const id = req.params.id;
    const messages = await client.getMessages(channelId, { search: tagFor(id), limit: 1 });
    const message = messages[0];
    if (!message || !message.media) {
      return res.status(404).json({ error: "Video not found." });
    }

    const size = Number(message.document?.size || 0);
    const range = req.headers.range;

    let start = 0;
    let end = size - 1;
    if (range && size) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        if (match[1]) start = parseInt(match[1], 10);
        if (match[2]) end = parseInt(match[2], 10);
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    }

    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", end - start + 1);
    res.setHeader("Content-Type", message.document?.mimeType || "video/mp4");

    const iter = client.iterDownload({
      file: message.media,
      offset: BigInt(start),
      limit: end - start + 1,
      requestSize: 512 * 1024,
    });

    for await (const chunk of iter) {
      if (!res.write(chunk)) {
        await new Promise((resolve) => res.once("drain", resolve));
      }
    }
    res.end();
  } catch (err) {
    console.error("Stream failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "Stream failed: " + err.message });
  }
});

app.get("/list", requireReady, async (req, res) => {
  try {
    const messages = await client.getMessages(channelId, { limit: 200 });
    const videos = messages
      .filter((m) => m.media && m.message && /#tyshiii_/.test(m.message))
      .map((m) => {
        const idMatch = /#tyshiii_(\S+)/.exec(m.message);
        const title = m.message.split("\n")[0];
        return {
          id: idMatch ? idMatch[1] : null,
          title,
          sizeMB: m.document ? +(Number(m.document.size) / (1024 * 1024)).toFixed(1) : 0,
          addedAt: m.date ? m.date * 1000 : Date.now(),
        };
      })
      .filter((v) => v.id);
    res.json({ videos });
  } catch (err) {
    console.error("List failed:", err);
    res.status(500).json({ error: "List failed: " + err.message });
  }
});

app.get("/", (req, res) => res.send("Tyshiii backend is running."));

app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));
