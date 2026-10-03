import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-6-luna';

app.use(express.json({ limit: '3mb' }));
app.use(express.static('public'));

const clean = (s = '') => String(s).replace(/\s+/g, ' ').trim();
const unique = (arr = []) => [...new Map(arr.filter(Boolean).map(x => [String(x).toLowerCase(), x])).values()];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (ms) => AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;

async function fetchJson(url, options = {}) {
  const r = await fetch(url, { ...options, signal: options.signal || withTimeout(12000) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function youtubeSearch(q, maxResults = 12) {
  if (!YOUTUBE_API_KEY) return [];
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', String(Math.min(maxResults, 50)));
  url.searchParams.set('relevanceLanguage', 'hi');
  url.searchParams.set('regionCode', 'IN');
  url.searchParams.set('key', YOUTUBE_API_KEY);
  const data = await fetchJson(url);
  return (data.items || []).map(x => ({
    source: 'YouTube', type: 'creator', title: clean(x.snippet?.title), text: clean(x.snippet?.description),
    channel: clean(x.snippet?.channelTitle), published: x.snippet?.publishedAt || '',
    url: x.id?.videoId ? `https://www.youtube.com/watch?v=${x.id.videoId}` : ''
  }));
}

async function redditSearch(q, limit = 15) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&t=month&limit=${limit}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'MEDIMANCH-Research-Navigator/5.3' }, signal: withTimeout(8000) });
  if (!r.ok) return [];
  const data = await r.json();
  return (data?.data?.children || []).map(x => ({
    source: 'Reddit', type: 'discussion', title: clean(x.data?.title), text: clean(x.data?.selftext),
    subreddit: x.data?.subreddit_name_prefixed || '', published: x.data?.created_utc ? new Date(x.data.created_utc * 1000).toISOString() : '',
    url: x.data?.permalink ? `https://www.reddit.com${x.data.permalink}` : ''
  }));
}

async function newsRss(q, limit = 15) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const r = await fetch(url, { headers: { 'User-Agent': 'MEDIMANCH-Research-Navigator/5.3' }, signal: withTimeout(8000) });
  if (!r.ok) return [];
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map(m => m[1]);
  const tag = (block, name) => {
    const mm = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
    return mm ? clean(mm[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : '';
  };
  return items.map(b => ({ source: 'Google News', type: 'news', title: tag(b, 'title'), text: tag(b, 'description'), published: tag(b, 'pubDate'), url: tag(b, 'link') })).filter(x => x.title);
}

async function collectSignals(queries, perSource = 5) {
  // Fast Radar collector: bounded parallel batches instead of sequentially waiting
  // for every query. This keeps a large discovery board responsive.
  const qs = unique(queries).slice(0, 12);
  const out = [];
  const batchSize = 6;
  for (let i = 0; i < qs.length; i += batchSize) {
    const batch = qs.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.flatMap(q => [
      youtubeSearch(q, perSource), redditSearch(q, perSource), newsRss(q, perSource)
    ]));
    for (const r of results) if (r.status === 'fulfilled') out.push(...r.value);
  }
  const seen = new Set();
  return out.filter(x => {
    const k = `${x.source}|${x.title}|${x.url}`.toLowerCase();
    if (!x.title || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 420);
}

async function liveSignals(node, extraQueries = []) {
  const base = clean(node.path?.join(' > ') || node.label || node.keyword || '');
  return collectSignals([
    `"${base}"`, `${base} questions`, `${base} India`, `${base} experience`, `${base} food`, `${base} practice`,
    `${base} myth`, `${base} why`, `${base} vs`, `${base} discussion`, `${base} comments`, `${base} research`, ...extraQueries
  ], 9);
}

const MASTER = `You are the MEDIMANCH SUPER RESEARCH NAVIGATOR V5. You are a structured research navigator, not a generic viral-topic generator.

CORE DISCOVERY MAP:
FLAGSHIP -> CONTENT TERRITORY -> SUB-CATEGORY -> CORE CONCEPT / KNOWLEDGE HUB / MECHANISM -> CONTENT CLUSTER -> CURRENT SIGNALS -> HUMAN TENSION -> BIC -> VIRAL ANGLES -> VISUAL VIDEO OPTIONS -> TITLES.

IMPORTANT ARCHITECTURE RULES:
1. Signal Radar is OPTIONAL. The user may start with a keyword they already have. Never force trending discovery as the entry point.
2. Do not treat every trending keyword as a flagship. Signal Radar is a discovery pool, not the research hierarchy.
3. Never force a premium/course/business connection onto discovery. Premium analysis is an OPTIONAL downstream branch only when the user deliberately requests it. It must never reject, hide, down-rank, merge, or distort a new viral discovery.
4. A viral-only idea is valid. A content-series idea is valid. A Content IP idea is valid. These are independent outcomes.
5. Never generate titles before cluster + human tension + visual opportunity.
6. The Content Territory must be a high-density middle universe: many genuinely different questions, behaviours, visual demonstrations, evidence paths and independent clusters.
7. Keep CURRENT VIRALITY and CLUSTER DENSITY separate.
8. The Core Concept / Knowledge Hub / Mechanism layer identifies the underlying reusable knowledge, process, practice or mechanism connecting related clusters. If a named mechanism is known or inferable, expose the name and explain it simply. Do not invent a scientific mechanism name.
9. Deep live scanning happens only after the user selects a node. Signal Radar is the one exception because it is explicitly a discovery scan.
10. Discovery sources identify movement; verification sources establish facts. Popularity is not proof. Traditional use, creator repetition and public discussion are not automatically efficacy.
11. Use India relevance when supported. Current trend claims should identify source/time/geo limitations when available.
12. BIC mapping may be PRIMARY + SECONDARY and should state FULL/PARTIAL plus the reason. Core ecosystems include Gut, Hydration, Energy, Recovery, Sleep, Breathing, Lifestyle and other defined Medimanch segments.
13. Final video opportunities must be showable: anatomy, objects, demonstrations, experiments, comparisons, tests, transformations, animations, observable behaviour or a strong visual process.
14. Use simple Indian Hindi/Hinglish for audience-facing titles; scientific terms may remain in English when natural.
15. REDO keeps the same selected node but deliberately finds different evidence, tensions, mechanisms, comparisons or visual treatments.
16. GO DEEPER finds second-order questions, Indian context, mechanisms, disagreements, edge cases, behaviour and less-obvious visual opportunities.
17. Never copy a creator's exact concept. Derive the underlying human tension and create a MEDIMANCH-specific treatment.`;

function parseJsonText(text) {
  let s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  const aa = s.indexOf('['), bb = s.lastIndexOf(']');
  if (aa >= 0 && bb > aa) { try { return JSON.parse(s.slice(aa, bb + 1)); } catch {} }
  throw new Error('LLM returned non-JSON output');
}

async function llm(instructions, input, maxTokens = 14000) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const body = {
    model: OPENAI_MODEL,
    instructions: `${MASTER}\n\n${instructions}`,
    input: [{ role: 'user', content: input }],
    max_output_tokens: maxTokens
  };
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` }, body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`OpenAI ${r.status}: ${t.slice(0, 700)}`); }
  const data = await r.json();
  const text = data.output_text || (data.output || []).flatMap(x => x.content || []).map(x => x.text || '').join('\n');
  return parseJsonText(text);
}

function fallbackMap(keyword) {
  return { keyword, territories: [
    { id: 't1', label: 'Body & Mechanism', description: 'What is happening inside the body?', children: [
      { id: 's1', label: 'Core processes', children: [
        { id: 'h1', label: `${keyword} mechanisms`, mechanism: '', children: [{ id: 'c1', label: `How ${keyword} works` }, { id: 'c2', label: `What changes inside the body` }] }
      ] }
    ] },
    { id: 't2', label: 'Human Problems & Patterns', description: 'How people experience the subject.', children: [
      { id: 's2', label: 'Patterns & questions', children: [
        { id: 'h2', label: `Everyday ${keyword} patterns`, children: [{ id: 'c3', label: `Common patterns around ${keyword}` }, { id: 'c4', label: `Why it happens / when it changes` }] }
      ] }
    ] },
    { id: 't3', label: 'Food, Behaviour & Practices', description: 'Things people eat, do or try.', children: [
      { id: 's3', label: 'Behaviours & practices', children: [
        { id: 'h3', label: `${keyword} behaviours`, children: [{ id: 'c5', label: `Food and ${keyword}` }, { id: 'c6', label: `Daily behaviour and ${keyword}` }] }
      ] }
    ] },
    { id: 't4', label: 'Tests, Evidence & Claims', description: 'What people test, claim or debate.', children: [
      { id: 's4', label: 'Evidence & claims', children: [
        { id: 'h4', label: `${keyword} evidence`, children: [{ id: 'c7', label: `Tests related to ${keyword}` }, { id: 'c8', label: `Popular claims vs evidence` }] }
      ] }
    ] }
  ] };
}

const radarSeeds = [
  'health wellness trend India', 'new health trend India', 'new wellness term India', 'health questions India',
  'viral wellness practice India', 'nutrition trend India', 'supplement trend India', 'gut health trend India',
  'hydration trend India', 'weight loss trend India', 'longevity trend India', 'movement wellness trend India',
  'Ayurveda wellness trend India', 'protein nutrition trend India', 'sleep wellness trend India', 'breathing wellness trend India'
];

// Radar V5.1 is intentionally multi-round. Each round changes the discovery lens instead of
// repeatedly asking the same broad queries. The browser sends the seen history so the server
// can suppress previously surfaced keywords/signals and keep mutating into new territory.
const radarModes = [
  { name: 'CURRENT MOVEMENT', desc: 'newly discussed wellness practices, terms, creator movement and public movement', queries: [
    'emerging wellness practice India 2026', 'new health term India 2026', 'wellness creators India discussing', 'health discussion India this month', 'new nutrition behaviour India', 'health trend Hindi India', 'wellness comments India 2026', 'new health practice creators India'
  ]},
  { name: 'HUMAN QUESTIONS', desc: 'real questions, confusion, why/how/does-it-work language and unresolved public curiosity', queries: [
    'why does my body India question', 'health questions people ask India', 'wellness does this work India', 'health why how question Reddit India', 'nutrition confusion India questions', 'people asking health why India', 'health questions Hindi India', 'wellness confusion comments India'
  ]},
  { name: 'BEHAVIOUR RADAR', desc: 'things people are actually doing, trying, eating, timing or changing', queries: [
    'people doing wellness practice India', 'morning health routine India discussion', 'after meal health habit India', 'home wellness practice India', 'people trying health hack India', 'daily health habit India discussion', 'new wellness routine India', 'health habit comments India'
  ]},
  { name: 'VISUAL BEHAVIOUR', desc: 'practices and phenomena that can be physically demonstrated, tested, compared or observed', queries: [
    'health experiment people try India', 'visible body health test India', 'before after health experiment India', 'wellness demonstration India creator', 'physical health hack test India', 'body experiment Hindi India', 'health comparison experiment India', 'visible wellness practice India'
  ]},
  { name: 'INDIA CONTEXT', desc: 'Indian household behaviour, food, traditional practice, family discussion and local creator vocabulary', queries: [
    'Indian household health practice discussion', 'Indian food health belief discussion', 'Ayurveda home practice India discussion', 'desi health habit discussion India', 'Indian parents health advice discussion', 'Indian kitchen health practice', 'Indian traditional wellness discussion'
  ]},
  { name: 'CROSS-TOPIC MUTATION', desc: 'movement between wellness ecosystems such as gut, hydration, sleep, energy, recovery, breathing and lifestyle', queries: [
    'gut hydration connection wellness India', 'sleep digestion connection India', 'breathing energy recovery wellness India', 'movement gut health India', 'hydration sleep energy discussion India', 'gut sleep breathing connection India', 'recovery hydration movement India'
  ]},
  { name: 'EDGE / UNDER-COVERED', desc: 'less obvious, niche, disputed, newly named or under-covered wellness signals', queries: [
    'unusual wellness practice India discussion', 'controversial health practice India evidence', 'less known health habit India', 'newly named wellness concept India', 'health practice people disagree about India', 'niche wellness India creator', 'under covered health practice India'
  ]}
];

function radarModeFor(round = 1) {
  if (round <= radarModes.length) return radarModes[round - 1];
  const cycle = radarModes[(round - 1) % radarModes.length];
  return { ...cycle, name: `${cycle.name} + MUTATION ${round}` };
}

function radarQueryPlan(round, seenKeywords = [], recentItems = []) {
  const mode = radarModeFor(round);
  const seen = seenKeywords.slice(-80).join(', ');
  const recent = recentItems.slice(-18).map(x => x.keyword || x).join(', ');
  const mutationTerms = unique([
    ...recentItems.slice(-10).flatMap(x => String(x.keyword || '').split(/\s+/)),
    ...seenKeywords.slice(-12).flatMap(x => String(x).split(/\s+/))
  ]).filter(x => x.length > 3).slice(-20);
  const mutation = mutationTerms.length ? mutationTerms.slice(0, 8).map(x => `${x} new question India`).concat(mutationTerms.slice(0, 5).map(x => `${x} behaviour experiment India`)) : [];
  return { mode, queries: unique([...mode.queries, ...mutation]), seen, recent };
}

app.get('/api/health', (req, res) => res.json({ ok: true, youtube: Boolean(YOUTUBE_API_KEY), llm: Boolean(OPENAI_API_KEY), model: OPENAI_MODEL, reddit: 'public-discovery', newsRss: true, radar: true, time: new Date().toISOString() }));

app.post('/api/map', async (req, res) => {
  const keyword = clean(req.body?.keyword);
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  try {
    const result = await llm(
      `Build the complete navigable research map for this user-supplied starting keyword. Return JSON only: {"keyword":"...","territories":[{"id":"...","label":"...","description":"...","children":[{"id":"...","label":"...","children":[{"id":"...","label":"...","mechanism":"optional named mechanism/process","children":[{"id":"...","label":"..."}]}]}]}]}. Use meaningful conceptual branches, not feed-frequency categories. Include a Core Concept / Knowledge Hub / Mechanism node when the subject has a reusable mechanism, practice, process, behaviour system or body system. The mechanism field may be blank when there is no responsible named mechanism. Do not create titles or current-virality claims. Do not use a fixed count rule. Preserve distinct branches and make clusters deep enough to support multiple independent questions.`,
      `STARTING KEYWORD: ${keyword}`
    );
    res.json({ ok: true, map: result, mode: 'llm' });
  } catch (e) {
    res.json({ ok: true, map: fallbackMap(keyword), mode: 'fallback', warning: e.message });
  }
});

app.post('/api/radar', async (req, res) => {
  try {
    const round = Math.max(1, Number(req.body?.round || 1));
    const seenKeywords = Array.isArray(req.body?.seenKeywords) ? req.body.seenKeywords.map(clean).filter(Boolean) : [];
    const seenTitles = Array.isArray(req.body?.seenTitles) ? req.body.seenTitles.map(clean).filter(Boolean) : [];
    const recentItems = Array.isArray(req.body?.recentItems) ? req.body.recentItems : [];
    const extra = Array.isArray(req.body?.extraQueries) ? req.body.extraQueries.map(clean).filter(Boolean) : [];
    const plan = radarQueryPlan(round, seenKeywords, recentItems);
    const queries = unique([...plan.queries, ...extra]).slice(0, 24);
    const raw = await collectSignals(queries, 5);
    const seenKeywordSet = new Set(seenKeywords.map(x => x.toLowerCase()));
    const seenTitleSet = new Set(seenTitles.map(x => x.toLowerCase()));
    const freshRaw = raw.filter(x => {
      const title = clean(x.title).toLowerCase();
      return title && !seenTitleSet.has(title) && !seenKeywordSet.has(title);
    });

    // FAST CLOUD: one compact LLM pass. We deliberately avoid the previous
    // second expansion pass, which doubled latency and often produced little new signal.
    const result = await llm(
      `You are running ROUND ${round} of the MEDIMANCH FAST SIGNAL DISCOVERY CLOUD.
Return a LARGE discovery board, not a narrative report. Target 75 unique candidates; acceptable 60-100.
Use only the supplied live material. Do not invent current events, search volume or evidence.
Prioritize concrete, specific signals over umbrella topics. Reject generic terms unless they point to a specific behaviour, question, practice, test, mechanism, controversy, food, creator movement, Indian context or visual opportunity.
Distribute candidates across many signal families. Each keyword should be short (2-7 words) and independently clickable.
Signal strength 0-100 must reflect the supplied evidence: source diversity, repetition, freshness, specificity and researchability.
Return compact JSON only: {"asOf":"...","round":${round},"mode":"${plan.mode.name}","items":[{"keyword":"...","signalType":"...","signalStrength":0,"evidenceCount":0,"sourceCount":0,"freshness":"HIGH|MEDIUM|LOW","specificity":"HIGH|MEDIUM|LOW","whyNow":"short","evidence":"short","sourceMix":["YouTube","Reddit","Google News"],"indiaRelevance":"short","novelty":"MEDIUM|HIGH|VERY HIGH","researchPotential":"short","visualPotential":"short","humanQuestion":"short","suggestedStartQuery":"short"}],"caveats":[]}.
Do not repeat previous keywords. Prefer novelty and breadth. Keep every item evidence-linked.`,
      `DISCOVERY LENS: ${plan.mode.name}
QUERY PLAN: ${JSON.stringify(queries)}
PREVIOUSLY SEEN KEYWORDS: ${JSON.stringify(seenKeywords.slice(-220))}
RECENT RADAR ITEMS: ${JSON.stringify(recentItems.slice(-50))}
FRESH LIVE MATERIAL (${freshRaw.length} items):
${JSON.stringify(freshRaw.slice(0, 360))}`,
      12000
    );

    if (Array.isArray(result.items)) {
      const dedup = new Map();
      for (const item of result.items) {
        const k = clean(item.keyword).toLowerCase();
        if (k && !dedup.has(k)) dedup.set(k, item);
      }
      result.items = [...dedup.values()]
        .filter(x => !seenKeywordSet.has(clean(x.keyword).toLowerCase()))
        .sort((a,b) => Number(b.signalStrength||0) - Number(a.signalStrength||0))
        .slice(0,100);
    }
    if (!result.mode) result.mode = plan.mode.name;
    if (!result.round) result.round = round;
    res.json({ ok: true, result, rawSignals: freshRaw.slice(0, 120), generatedAt: new Date().toISOString(), round, mode: plan.mode, queries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/research', async (req, res) => {
  const node = req.body?.node || {};
  const mode = req.body?.mode || 'research';
  const previous = req.body?.previous || null;
  if (!node.label) return res.status(400).json({ error: 'node required' });
  try {
    const signals = await liveSignals(node, previous?.suggestedQueries || []);
    const prompt = `Research ONLY this selected node. Do not rebuild the entire flagship map.\nSELECTED PATH: ${(node.path || []).join(' > ')}\nNODE TYPE: ${node.type || 'cluster'}\nNODE: ${node.label}\nKNOWN MECHANISM (if any): ${node.mechanism || 'not supplied'}\nMODE: ${mode}\n\n${mode === 'redo' ? 'REDO: find materially different evidence, questions, behaviours, mechanisms, comparisons and visual opportunities. Avoid previous ideas.' : ''}\n${mode === 'deeper' ? 'DEEPER: find second-order questions, named mechanisms, Indian context, disagreement, edge cases, behaviour and less-obvious visual opportunities.' : ''}\n\nPREVIOUS RESULT TO AVOID REPEATING:\n${JSON.stringify(previous || {}, null, 2)}\n\nLIVE DISCOVERY MATERIAL (${signals.length} items):\n${JSON.stringify(signals.slice(0, 300), null, 2)}\n\nReturn JSON only with exactly these top-level keys: mechanism, currentSignals, humanTensions, bicConnection, viralAngles, visualVideoOptions, evidenceFlags, suggestedQueries.\nmechanism: {name, simpleExplanation, confidence, whatToVerify}\ncurrentSignals: array of objects {signal,sourceType,whyItMatters,trendStage,evidenceNote}\nhumanTensions: array of distinct questions/confusions/behaviours\nbicConnection: {primary,secondary,connection,fit}\nviralAngles: array {angle,reason,mechanismLink}\nvisualVideoOptions: array {concept,title,visualTreatment,whyDifferent}\nevidenceFlags: array of what must be verified or is uncertain\nsuggestedQueries: array of queries for another research round.\nDo not claim current virality without supporting evidence. Keep popularity separate from efficacy.`;
    const result = await llm('Produce the selected-node research report. The mechanism field is explicit and must not be invented.', prompt);
    res.json({ ok: true, result, signalCount: signals.length, rawSignals: signals.slice(0, 140), mode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ip-explore', async (req, res) => {
  const node = req.body?.node || {};
  const research = req.body?.research || {};
  if (!node.label) return res.status(400).json({ error: 'node required' });
  try {
    const result = await llm(
      `This is an OPTIONAL downstream Content IP analysis. It must NOT judge or modify the discovery/research quality of the node. Do not assume a course should be made. Identify whether the underlying knowledge can coherently support a reusable Content IP Hub, and if so what types of deeper assets could fit. Return JSON only: {"hubName":"...","coreKnowledge":"...","assetPaths":[{"type":"SERIES|WORKSHOP|COURSE|MASTERCLASS|PODCAST|DOCUMENTARY|PROGRAM|COMMUNITY|OTHER","idea":"...","whyFit":"...","readiness":"EARLY|POSSIBLE|STRONG"}],"premiumPathway":"...","validationBeforeLaunch":["..."],"whyNotPremium":"...","audienceTestIdeas":["..."]}. A viral-only result is valid; if depth is insufficient, say so. Do not recommend medical treatment or make efficacy claims.`,
      `NODE PATH: ${(node.path || []).join(' > ')}\nNODE: ${node.label}\nMECHANISM: ${research.mechanism?.name || node.mechanism || 'unknown'}\nCLUSTERS/ANGLES: ${JSON.stringify(research.viralAngles || [])}\nHUMAN TENSIONS: ${JSON.stringify(research.humanTensions || [])}\nBIC: ${JSON.stringify(research.bicConnection || {})}`,
      9000
    );
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/quick-signals', async (req, res) => {
  const node = req.body?.node || {};
  if (!node.label) return res.status(400).json({ error: 'node required' });
  try { const signals = await liveSignals(node); res.json({ ok: true, signals: signals.slice(0, 200) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`MEDIMANCH Research Navigator V5 on ${PORT}`));
