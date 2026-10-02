# MEDIMANCH Viral Territory Explorer — V1 Real Signal Engine

## What this version does

The browser UI is now connected to `/api/scan`.

A scan sends the selected navigation path, keyword and node to the backend. The backend collects current discovery signals from:

1. YouTube search (India + Hindi relevance) — requires `YOUTUBE_API_KEY`
2. YouTube comments on returned videos — same key
3. Reddit public search — discovery layer
4. Google News RSS — current news/discussion discovery

The backend then derives:
- people-question signals
- discussion signals
- behaviour buckets
- a transparent heuristic signal score
- BIC ecosystem connection
- MEDIMANCH content angles

## Important

This is **live-source discovery**, not a claim of official Google search-volume data or a universal measure of virality.

The signal score is a MEDIMANCH heuristic based on returned-source density, question-shaped signals and source diversity. It must not be presented as a platform's official trend score.

## Run locally

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:

```bash
npm install
```

4. Copy `.env.example` to `.env`.
5. Add your YouTube Data API key.
6. Run:

```bash
npm start
```

7. Open:

http://localhost:8787

8. Test:

Gut → Microbiome → Fermented Foods → Fermented Rice → Scan this node

## API

POST `/api/scan`

Example:

```json
{
  "path": ["Gut","Microbiome","Fermented Foods","Fermented Rice"],
  "node": "Fermented Rice",
  "keyword": "Gut"
}
```

GET `/api/health`

Shows whether the YouTube connector is configured.

## Next production layer

The next step is to add:
- Google Trends/official trend provider
- stronger Reddit OAuth integration
- source-specific freshness windows
- deduplication + historical signal storage
- scheduled background scans
- signal history / momentum curves
- Hindi/Hinglish question normalization
- MEDIMANCH BIC scoring rules
- evidence/research verification layer

Do not put API keys into the HTML. They belong only in the backend environment.
