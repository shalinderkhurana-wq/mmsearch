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
    channel:clean(x.snippet?.channelTitle), published:x.snippet?.publishedAt||'', videoId:x.id?.videoId||'', url:`https://www.youtube.com/watch?v=${x.id?.videoId||''}`
  }));
}


async function youtubeComments(videoIds, maxVideos=4, maxPerVideo=10) {
  if (!YOUTUBE_API_KEY) return [];
  const ids=unique(videoIds).filter(Boolean).slice(0,maxVideos);
  const out=[];
  for (const id of ids) {
    try {
      const url=new URL('https://www.googleapis.com/youtube/v3/commentThreads');
      url.searchParams.set('part','snippet');
      url.searchParams.set('videoId',id);
      url.searchParams.set('maxResults',String(Math.min(maxPerVideo,100)));
      url.searchParams.set('order','relevance');
      url.searchParams.set('textFormat','plainText');
      url.searchParams.set('key',YOUTUBE_API_KEY);
      const data=await fetchJson(url);
      for(const x of (data.items||[])){
        const top=x.snippet?.topLevelComment?.snippet;
        if(!top?.textDisplay) continue;
        out.push({source:'YouTube Comments',type:'comment',title:clean(top.textDisplay),text:clean(top.textDisplay),published:top.publishedAt||'',url:`https://www.youtube.com/watch?v=${id}`});
      }
    } catch {}
  }
  return out;
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
// Radar is an independent keyword-discovery door. It never modifies the core Explore map.
const RADAR_LENSES = [
  {id:'behaviour',label:'REAL PEOPLE TRYING',queries:[
    'people trying new wellness habits India','people trying health routines India','wellness experiments people doing India','new body habits people trying India']},
  {id:'vocabulary',label:'NEW WELLNESS VOCABULARY',queries:[
    'new wellness terms trend India','new biohacking terms health India','viral health habit terms India','emerging wellness phrases social media India']},
  {id:'movement',label:'MOVEMENT & BODY PRACTICES',queries:[
    'new walking trend wellness India','new breathing practice wellness India','new mobility recovery trend India','movement hack people trying India']},
  {id:'gut',label:'GUT / FOOD / HYDRATION HABITS',queries:[
    'new gut health habit India','new digestion practice India','new hydration habit India','food ritual wellness trend India']},
  {id:'sleep',label:'SLEEP / RECOVERY / LONGEVITY',queries:[
    'new sleep hack trend India','recovery routine trend India','longevity habit trend India','healthy ageing practice people trying India']},
  {id:'comments',label:'QUESTIONS & PUBLIC DISCUSSION',queries:[
    'health habit questions discussion India','wellness practice comments discussion India','people asking about health hacks India','reddit wellness habit India']},
  {id:'biohack',label:'BIOHACK / COMPOUND / OPTIMISATION',queries:[
    'new biohack wellness India','peptide wellness trend India','recovery compound wellness trend India','body optimisation trend India']},
  {id:'edge',label:'UNDER-COVERED / UNUSUAL SIGNALS',queries:[
    'unusual wellness practice India emerging','undercovered health habit trend India','new traditional wellness practice India','strange wellness habit people trying India']}
];

async function radarSignals(lens){
  const out=[];
  const jobs=lens.queries.map(async q=>{
    const [yt,rd,nw]=await Promise.allSettled([youtubeSearch(q,10),redditSearch(q,10),newsRss(q,10)]);
    if(yt.status==='fulfilled') out.push(...yt.value.map(x=>({...x,radarQuery:q})));
    if(rd.status==='fulfilled') out.push(...rd.value.map(x=>({...x,radarQuery:q})));
    if(nw.status==='fulfilled') out.push(...nw.value.map(x=>({...x,radarQuery:q})));
  });
  await Promise.all(jobs);
  const vids=out.filter(x=>x.source==='YouTube').map(x=>x.videoId).filter(Boolean);
  const comments=await youtubeComments(vids,4,10);
  out.push(...comments.map(x=>({...x,radarQuery:lens.label})));
  const seen=new Set();
  return out.filter(x=>{const k=(x.source+'|'+x.title+'|'+x.url).toLowerCase();if(!x.title||seen.has(k))return false;seen.add(k);return true;}).slice(0,500);
}

app.post('/api/radar', async (req,res)=>{
  try{
    const lensIndex=Math.max(0,Math.min(RADAR_LENSES.length-1,Number(req.body?.lensIndex)||0));
    const lens=RADAR_LENSES[lensIndex];
    const seen=(Array.isArray(req.body?.seenKeywords)?req.body.seenKeywords:[]).slice(0,500);
    const material=await radarSignals(lens);
    if(!material.length) return res.json({ok:true,items:[],rawCount:0,lens:lens.label,warning:'No live source material returned.'});
    const prompt=`You are the MEDIMANCH SIGNAL KEYWORD RADAR. This is an OPTIONAL DISCOVERY GATE. NEVER alter, simplify, replace or influence the main MEDIMANCH Explore workflow.\n\nCURRENT DISCOVERY LENS: ${lens.label}\n\nExtract SPECIFIC RESEARCH SIGNAL KEYWORDS, not article headlines. The keyword must be something a researcher could save and later enter into MEDIMANCH Explore as a flagship.\n\nA valid signal is a named or nameable behaviour, practice, routine, ritual, technique, biohack, movement, food/hydration habit, recovery/sleep practice, compound trend, or emerging wellness vocabulary. It should be specific enough to research as its own subject.\n\nStrong examples of FORMAT only: fart walk, lymphatic walking, sleepmaxxing, peptide wellness, mouth taping, movement snacks, cold plunging. Do NOT simply repeat these examples unless the live material independently supports them.\n\nREJECT: article headlines, people/celebrities, politicians, companies, workplace programmes, generic health/fitness/wellness/nutrition terms, generic medical conditions unless the signal is a specific new behaviour around them, news events, study titles, vague advice, a person merely talking about health, and duplicate variants.\n\nSOURCE PRIORITY: specific public behaviour/discussion and repeated terminology > generic news headline. Use YouTube comments and Reddit as human-language clues; use YouTube/news as movement evidence. A single article is not enough to call something a strong trend.\n\nIMPORTANT: ${seen.length?'Do not repeat or lightly rename any previously surfaced keywords: '+JSON.stringify(seen):'This is the first scan.'}\n\nReturn JSON only: {"items":[{"keyword":"...","signalType":"behaviour|practice|routine|biohack|compound|food_habit|movement|recovery|wellness_term|other","whyNow":"...","sourceMix":["YouTube","YouTube Comments","Reddit","Google News"],"strength":0-100,"medimanchFit":"...","humanSignal":"what people are doing/asking","suggestedResearchStart":"..."}],"caveats":["..."]}.\n\nTarget 60-100 distinct candidates when the live material supports them. Never pad. Prefer 50 excellent signals over 100 generic ones. Sort by research-worthiness and strength. Keep the keyword itself short (normally 1-5 words).`;
    const result=await llm('Run ONLY the optional Signal Radar using the selected lens. Return a broad but high-quality research-keyword pool.',prompt+'\n\nLIVE MATERIAL:\n'+JSON.stringify(material.slice(0,420),null,2));
    const items=Array.isArray(result?.items)?result.items:[];
    res.json({ok:true,items,lens:lens.label,lensIndex,rawCount:material.length,caveats:result?.caveats||[],availableLenses:RADAR_LENSES.map(x=>x.label)});
  }catch(e){res.json({ok:false,items:[],rawCount:0,error:e.message,availableLenses:RADAR_LENSES.map(x=>x.label)});}
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
