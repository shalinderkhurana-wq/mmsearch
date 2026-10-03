import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-6-luna';

app.use(express.json({limit:'2mb'}));
app.use(express.static('public'));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clean = (s='') => String(s).replace(/\s+/g,' ').trim();
const unique = (arr=[]) => [...new Map(arr.filter(Boolean).map(x => [String(x).toLowerCase(), x])).values()];

async function fetchJson(url, options={}) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function youtubeSearch(q, maxResults=20) {
  if (!YOUTUBE_API_KEY) return [];
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part','snippet');
  url.searchParams.set('q',q);
  url.searchParams.set('type','video');
  url.searchParams.set('maxResults',String(Math.min(maxResults,50)));
  url.searchParams.set('relevanceLanguage','hi');
  url.searchParams.set('regionCode','IN');
  url.searchParams.set('key',YOUTUBE_API_KEY);
  const data = await fetchJson(url);
  return (data.items||[]).map(x=>({
    source:'YouTube', type:'creator', title:clean(x.snippet?.title), text:clean(x.snippet?.description),
    channel:clean(x.snippet?.channelTitle), published:x.snippet?.publishedAt||'', url:`https://www.youtube.com/watch?v=${x.id?.videoId||''}`
  }));
}

async function redditSearch(q, limit=20) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&t=month&limit=${limit}`;
  const r = await fetch(url, {headers:{'User-Agent':'MEDIMANCH-Research-Navigator/4.0'}});
  if (!r.ok) return [];
  const data = await r.json();
  return (data?.data?.children||[]).map(x=>({
    source:'Reddit', type:'discussion', title:clean(x.data?.title), text:clean(x.data?.selftext),
    subreddit:x.data?.subreddit_name_prefixed||'', published:x.data?.created_utc?new Date(x.data.created_utc*1000).toISOString():'',
    url:x.data?.permalink?`https://www.reddit.com${x.data.permalink}`:''
  }));
}

async function newsRss(q, limit=20) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const r = await fetch(url, {headers:{'User-Agent':'MEDIMANCH-Research-Navigator/4.0'}});
  if (!r.ok) return [];
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,limit).map(m=>m[1]);
  const tag = (block,name) => { const mm=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i')); return mm ? clean(mm[1].replace(/<!\[CDATA\[|\]\]>/g,'')) : ''; };
  return items.map(b=>({source:'Google News',type:'news',title:tag(b,'title'),text:tag(b,'description'),published:tag(b,'pubDate'),url:tag(b,'link')})).filter(x=>x.title);
}

async function liveSignals(node, extraQueries=[]) {
  const q = node.path?.join(' > ') || node.label || node.keyword || '';
  const base = clean(q);
  const queries = unique([
    `"${base}"`, `${base} questions`, `${base} India`, `${base} experience`, `${base} food`, `${base} treatment`,
    `${base} myth`, `${base} why`, `${base} vs`, `${base} after eating`, `${base} morning`, `${base} discussion`,
    ...extraQueries
  ]).slice(0,18);
  const results=[];
  for (const query of queries) {
    const [yt,rd,nw] = await Promise.allSettled([youtubeSearch(query,10), redditSearch(query,10), newsRss(query,10)]);
    if (yt.status==='fulfilled') results.push(...yt.value);
    if (rd.status==='fulfilled') results.push(...rd.value);
    if (nw.status==='fulfilled') results.push(...nw.value);
    await sleep(40);
  }
  const seen=new Set();
  return results.filter(x=>{
    const k=(x.source+'|'+x.title+'|'+x.url).toLowerCase();
    if(!x.title || seen.has(k)) return false; seen.add(k); return true;
  }).slice(0,350);
}

const MASTER = `You are the MEDIMANCH SUPER RESEARCH NAVIGATOR. You are not a generic viral-topic generator. Preserve the hierarchy and research discipline exactly.
CORE MAP: FLAGSHIP KEYWORD -> CONTENT TERRITORY -> SUB-CATEGORY -> CONTENT CLUSTER.
Only after a user selects a node do you deeply scan current signals. Then: CURRENT SIGNALS -> HUMAN TENSION -> BIC CONNECTION -> VIRAL ANGLES -> VISUAL VIDEO OPTIONS -> TITLES.
Content Territory must be a useful middle universe: broad enough to contain many independent clusters, narrow enough to research quickly. Cluster is the smallest research unit before viral-angle generation and must support multiple genuinely distinct questions/angles.
Never turn feed frequency into a hierarchy automatically. Do not force generic categories such as symptoms/food/treatment/lifestyle. Build meaningful research structure.
Never generate titles before identifying the underlying human tension. Current popularity is a discovery signal, not medical proof. Separate discovery evidence from verification needs. Include India relevance when supported. Do not copy creators; derive the human tension and make a Medimanch-specific visual treatment.
BIC ecosystems: Gut, Hydration, Energy, Recovery, Sleep, Breathing, Lifestyle and other defined Medimanch segments. State Full/Partial and explain the connection; allow cross-functional mapping.
Final video opportunities must be SHOWABLE: anatomy, objects, demonstrations, experiments, comparisons, tests, transformations, animations, observable behaviour or a strong visual process. Avoid generic “benefits of X”.
Use simple Indian Hindi/Hinglish in audience-facing titles, with English scientific terms when natural.
When asked to REDO, keep the selected node but deliberately find different evidence, human tensions, mechanisms, comparisons or visual treatments and avoid repeating previous results.`;

function parseJsonText(text) {
  let s = String(text||'').trim();
  s=s.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  try{return JSON.parse(s);}catch{}
  const a=s.indexOf('{'), b=s.lastIndexOf('}');
  if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1));}catch{}}
  throw new Error('LLM returned non-JSON output');
}

async function llm(instructions, input) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const body={model:OPENAI_MODEL,instructions:`${MASTER}\n\n${instructions}`,input:[{role:'user',content:input}],max_output_tokens:12000};
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${OPENAI_API_KEY}`},body:JSON.stringify(body)});
  if(!r.ok){const t=await r.text(); throw new Error(`OpenAI ${r.status}: ${t.slice(0,500)}`);}
  const data=await r.json();
  return parseJsonText(data.output_text || (data.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join('\n'));
}

function fallbackMap(keyword){
  return {keyword, territories:[
    {id:'t1',label:'Body & Mechanism',description:'What is happening inside the body?',children:[
      {id:'s1',label:'Core process',children:[{id:'c1',label:`How ${keyword} works`},{id:'c2',label:`What changes inside the body`}]}]},
    {id:'t2',label:'Human Problems & Patterns',description:'How people experience the subject.',children:[
      {id:'s2',label:'Common patterns',children:[{id:'c3',label:`Everyday patterns around ${keyword}`},{id:'c4',label:`Why it happens / when it changes`}]}]},
    {id:'t3',label:'Food, Behaviour & Practices',description:'Things people eat, do or try.',children:[
      {id:'s3',label:'Behaviours',children:[{id:'c5',label:`Food and ${keyword}`},{id:'c6',label:`Daily behaviour and ${keyword}`}]}]},
    {id:'t4',label:'Tests, Evidence & Claims',description:'What people test, claim or debate.',children:[
      {id:'s4',label:'Evidence',children:[{id:'c7',label:`Tests related to ${keyword}`},{id:'c8',label:`Popular claims vs evidence`}]}]}
  ]};
}



// ---------------- OPTIONAL SIGNAL RADAR ----------------
// IMPORTANT: Radar is deliberately isolated from /api/map and /api/research.
// The main MEDIMANCH research engine remains the original V4 engine.
const RADAR_FAMILIES = [
  'emerging wellness behaviour India people trying',
  'new health habit trend India people doing',
  'viral wellness practice India walking breathing sleep gut',
  'biohacking wellness trend India new term',
  'new gut health practice trend India',
  'new hydration health habit trend India',
  'new sleep recovery practice trend India',
  'Ayurveda naturopathy wellness practice people trying India',
  'fitness recovery longevity health hack trend India',
  'wellness vocabulary new health trend social media India'
];

async function radarSignals() {
  const out=[];
  const jobs=RADAR_FAMILIES.map(async q=>{
    const [yt,rd,nw]=await Promise.allSettled([
      youtubeSearch(q,8), redditSearch(q,8), newsRss(q,8)
    ]);
    if(yt.status==='fulfilled') out.push(...yt.value.map(x=>({...x,radarQuery:q})));
    if(rd.status==='fulfilled') out.push(...rd.value.map(x=>({...x,radarQuery:q})));
    if(nw.status==='fulfilled') out.push(...nw.value.map(x=>({...x,radarQuery:q})));
  });
  await Promise.all(jobs);
  const seen=new Set();
  return out.filter(x=>{
    const k=(x.source+'|'+x.title+'|'+x.url).toLowerCase();
    if(!x.title||seen.has(k)) return false; seen.add(k); return true;
  }).slice(0,300);
}

app.post('/api/radar', async (req,res)=>{
  try{
    const material=await radarSignals();
    if(!material.length) return res.json({ok:true,items:[],rawCount:0,warning:'No live source material returned.'});
    const prompt=`You are the MEDIMANCH SIGNAL RADAR. This is an OPTIONAL DISCOVERY GATE only. It must NEVER modify, simplify, replace, or influence the main FLAGSHIP -> TERRITORY -> SUB-CATEGORY -> CLUSTER research map.

Your task is to extract a large pool of SPECIFIC RESEARCH SIGNAL KEYWORDS from the supplied live material.

A valid signal is a specific named or nameable health/wellness behaviour, practice, routine, ritual, technique, protocol, biohack, body-optimisation trend, food/hydration practice, supplement/compound trend, recovery practice, breathing/movement practice, or emerging wellness phrase that a MEDIMANCH researcher could save as a future starting keyword.

GOOD examples of the type of signal: fart walk, lymphatic walking, sleepmaxxing, peptide wellness, mouth taping, movement snacks, cold plunging, electrolyte timing, meal timing, etc. These are examples of FORMAT/TYPE, not a request to return these exact terms.

BAD outputs: article headlines, celebrity names, politicians, company names, generic topics such as health/wellness/fitness/nutrition, generic advice, workplace wellbeing, news events, study headlines, questions without a specific underlying practice, or a person merely talking about health.

CRITICAL: Do not convert every article title into a keyword. A source is evidence for a signal, not the signal itself. Normalize variants into one concise keyword.

Prefer signals with multiple independent clues, specific terminology, observable behaviour, novelty/emergence, or clear public discussion. Do not claim Google Trends search volume. Popularity is not proof.

Return JSON only: {"items":[{"keyword":"...","signalType":"behaviour|practice|routine|biohack|compound|food_habit|movement|recovery|wellness_term|other","whyNow":"...","sourceMix":["YouTube","Reddit","Google News"],"strength":0-100,"medimanchFit":"...","suggestedResearchStart":"..."}],"caveats":["..."]}

Aim for 50-100 genuinely distinct candidates when the material supports them. Never fill the quota with generic or weak items. If only 20 are defensible, return 20. Sort strongest/research-worthiest first.`;
    const result=await llm('Run ONLY the optional Signal Radar. Do not alter the main research map or main research logic.', prompt+'\n\nLIVE MATERIAL:\n'+JSON.stringify(material.slice(0,260),null,2));
    res.json({ok:true,items:Array.isArray(result?.items)?result.items:[],rawCount:material.length,caveats:result?.caveats||[]});
  } catch(e) {
    // Radar failure must never affect the core engine.
    res.json({ok:false,items:[],rawCount:0,error:e.message});
  }
});

app.get('/api/health',(req,res)=>res.json({ok:true,youtube:Boolean(YOUTUBE_API_KEY),llm:Boolean(OPENAI_API_KEY),model:OPENAI_MODEL,reddit:'public-discovery',newsRss:true,time:new Date().toISOString()}));

app.post('/api/map', async (req,res)=>{
  const keyword=clean(req.body?.keyword);
  if(!keyword) return res.status(400).json({error:'keyword required'});
  try{
    const result=await llm(
      'Build a research map for the supplied flagship. Return JSON only: {"keyword":"...","territories":[{"id":"...","label":"...","description":"...","children":[{"id":"...","label":"...","children":[{"id":"...","label":"..."}]}]}]}. Give enough meaningful territories to expose the real research universe, but do not use a fixed number rule. Do not create titles. Do not invent current virality. Each cluster must be a real research unit capable of multiple independent questions. Keep branches conceptually distinct.',
      `FLAGSHIP KEYWORD: ${keyword}`
    );
    res.json({ok:true,map:result,mode:'llm'});
  }catch(e){
    res.json({ok:true,map:fallbackMap(keyword),mode:'fallback',warning:e.message});
  }
});

app.post('/api/research', async (req,res)=>{
  const node=req.body?.node||{};
  const mode=req.body?.mode||'research';
  const previous=req.body?.previous||null;
  if(!node.label) return res.status(400).json({error:'node required'});
  try{
    const signals=await liveSignals(node, previous?.suggestedQueries||[]);
    const prompt=`Research ONLY this selected node. Do not rebuild the entire flagship map.\nSELECTED PATH: ${(node.path||[]).join(' > ')}\nNODE TYPE: ${node.type||'cluster'}\nNODE: ${node.label}\nMODE: ${mode}\n\n${mode==='redo'?'REDO RULE: The previous result below was not satisfactory. Deliberately find different human tensions, questions, behaviours, mechanisms, comparisons or visual opportunities. Do not repeat previous wording or ideas.':''}\n${mode==='deeper'?'DEEPER RULE: Go beyond obvious signals. Look for second-order questions, Indian context, mechanism, disagreement, behaviour and less-obvious visual opportunities.':''}\n\nPREVIOUS RESULT TO AVOID REPEATING:\n${JSON.stringify(previous||{},null,2)}\n\nLIVE DISCOVERY MATERIAL (${signals.length} items):\n${JSON.stringify(signals.slice(0,260),null,2)}\n\nReturn JSON only with exactly these top-level keys: currentSignals, humanTensions, bicConnection, viralAngles, visualVideoOptions, evidenceFlags, suggestedQueries.\ncurrentSignals: array of concise objects {signal,sourceType,whyItMatters,trendStage}\nhumanTensions: array of distinct human questions/confusions/behaviours\nbicConnection: {primary,secondary,connection,fit}\nviralAngles: array of distinct angle objects {angle,reason}\nvisualVideoOptions: array of objects {concept,title,visualTreatment,whyDifferent}\nevidenceFlags: array of what must be verified or what is uncertain\nsuggestedQueries: array of new research queries for another round.\nDo not claim that a signal is currently viral unless the material supports that conclusion.`;
    const result=await llm('Produce a selected-node research report. Keep current signals separate from interpretation and final concepts.',prompt);
    res.json({ok:true,result,signalCount:signals.length,rawSignals:signals.slice(0,120),mode});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.post('/api/quick-signals', async (req,res)=>{
  const node=req.body?.node||{};
  if(!node.label) return res.status(400).json({error:'node required'});
  try{const signals=await liveSignals(node);res.json({ok:true,signals:signals.slice(0,200)});}catch(e){res.status(500).json({error:e.message});}
});

app.listen(PORT,()=>console.log(`MEDIMANCH Research Navigator V4 on ${PORT}`));
