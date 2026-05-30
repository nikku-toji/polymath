import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
const PORT = process.env.PORT || 8787;

// Single proxy route. The frontend never sees the API key.
app.post("/api/claude", async (req, res) => {
  if (!KEY) {
    return res.status(500).json({
      error: "Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.",
    });
  }
  const { system, messages } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "Request body must include messages[]." });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, system, messages }),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "Upstream request failed", detail: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`Polymath proxy running on http://localhost:${PORT}`);
  if (!KEY) console.warn("WARNING: ANTHROPIC_API_KEY is not set — calls will fail until you add it to .env");
});
