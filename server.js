const express = require('express');
const path = require('path');
const Parser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 8787;
const parser = new Parser({ timeout: 12000 });

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const clean = (s='') => String(s).replace(/\s+/g,' ').trim();
const uniq = a => [...new Set((a||[]).filter(Boolean))];
const slug = s => clean(s).toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').slice(0,90);
const label = s => clean(s).replace(/\b\w/g,c=>c.toUpperCase());

const STOP = new Set(`the and for with from that this what when where how why are was were has have had into about health healthy treatment symptoms symptom india indian people their your you they these those does can could should will after before best home medicine medical disease condition video videos official latest today news doctor doctors patient patients cure natural care using use used make made get got just like more most very really many also help helps know need want take taking good bad new old common ways way thing things someone something people diabetes health disease causes cause related connection treatment remedy`.split(/\s+/));

const BASE_PROBES = [
  '{k}',
  '"{k}" questions',
  '"{k}" why how',
  '"{k}" problems symptoms',
  '"{k}" food diet',
  '"{k}" habits routine',
  '"{k}" morning night',
  '"{k}" after eating',
  '"{k}" causes mechanism',
  '"{k}" test report',
  '"{k}" experience discussion',
  '"{k}" India Hindi',
  '"{k}" vs',
  '"{k}" mistakes myth',
  '"{k}" people ask'
];

function tokens(text){
  return clean(text).toLowerCase().replace(/[^a-z0-9\s'-]/g,' ').split(/\s+/).filter(w=>w.length>=4 && !STOP.has(w));
}

async function youtubeSearch(q,maxResults=25){
  const key=process.env.YOUTUBE_API_KEY;
  if(!key) return {items:[],enabled:false};
  const u=new URL('https://www.googleapis.com/youtube/v3/search');
  u.searchParams.set('part','snippet');u.searchParams.set('type','video');u.searchParams.set('maxResults',String(Math.min(maxResults,50)));
  u.searchParams.set('regionCode','IN');u.searchParams.set('relevanceLanguage','hi');u.searchParams.set('q',q);u.searchParams.set('key',key);
  const r=await fetch(u); if(!r.ok) throw new Error(`YouTube search failed: ${r.status}`); const d=await r.json();
  return {enabled:true,items:(d.items||[]).map(x=>({id:x.id?.videoId?`yt:${x.id.videoId}`:null,videoId:x.id?.videoId,title:clean(x.snippet?.title),text:clean(`${x.snippet?.title||''} ${x.snippet?.description||''}`),description:clean(x.snippet?.description),publishedAt:x.snippet?.publishedAt,channel:x.snippet?.channelTitle,url:x.id?.videoId?`https://www.youtube.com/watch?v=${x.id.videoId}`:null,source:'YouTube'})).filter(x=>x.id)};
}

async function youtubeComments(videoId,maxResults=15){
  const key=process.env.YOUTUBE_API_KEY;if(!key||!videoId)return [];
  const u=new URL('https://www.googleapis.com/youtube/v3/commentThreads');u.searchParams.set('part','snippet');u.searchParams.set('videoId',videoId);u.searchParams.set('maxResults',String(Math.min(maxResults,100)));u.searchParams.set('textFormat','plainText');u.searchParams.set('order','relevance');u.searchParams.set('key',key);
  const r=await fetch(u);if(!r.ok)return [];const d=await r.json();
  return (d.items||[]).map(x=>{const s=x.snippet?.topLevelComment?.snippet||{};return {id:`ytc:${x.id}`,title:'YouTube comment',text:clean(s.textDisplay),publishedAt:s.publishedAt,score:s.likeCount||0,url:`https://www.youtube.com/watch?v=${videoId}`,source:'YouTube comment'};}).filter(x=>x.text);
}

async function redditSearch(q,limit=45,sort='relevance'){
  const u=new URL('https://www.reddit.com/search.json');u.searchParams.set('q',q);u.searchParams.set('sort',sort);u.searchParams.set('t',sort==='new'?'month':'year');u.searchParams.set('limit',String(Math.min(limit,100)));u.searchParams.set('restrict_sr','false');
  const r=await fetch(u,{headers:{'User-Agent':'MEDIMANCH-Viral-Territory-Explorer/3.0'}});if(!r.ok)throw new Error(`Reddit search failed: ${r.status}`);const d=await r.json();
  return (d?.data?.children||[]).map(x=>({id:`rd:${x.data?.id}`,title:clean(x.data?.title),text:clean(x.data?.selftext),subreddit:x.data?.subreddit,createdUtc:x.data?.created_utc,score:x.data?.score||0,url:x.data?.permalink?`https://www.reddit.com${x.data.permalink}`:null,source:'Reddit'})).filter(x=>x.id&&(x.title||x.text));
}

async function newsRss(q){
  const u=`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const feed=await parser.parseURL(u);
  return (feed.items||[]).slice(0,25).map((x,i)=>({id:`news:${slug(x.link||x.title)}:${i}`,title:clean(x.title),text:clean(x.contentSnippet||x.content),publishedAt:x.isoDate||x.pubDate,url:x.link,source:'Google News RSS'}));
}

function normalize(items){
  const seen=new Set();const out=[];
  for(const x of (items||[])){
    const id=x.id||`${x.source}|${clean(x.title)}|${clean(x.text).slice(0,140)}`;
    if(!id||seen.has(id))continue;seen.add(id);
    out.push({id,source:x.source||'Unknown',title:clean(x.title||''),text:clean(x.text||x.description||''),publishedAt:x.publishedAt||null,url:x.url||null,score:Number(x.score||0),channel:x.channel||null});
  }
  return out;
}

function corpus(items){return items.map(x=>`${x.title} ${x.text}`).join(' ').toLowerCase();}

function phraseCounts(items,maxN=4){
  const counts=new Map();
  for(const item of items){
    const ws=tokens(`${item.title} ${item.text}`);const local=new Set();
    for(let i=0;i<ws.length;i++){
      for(let n=1;n<=maxN;n++){
        if(i+n>ws.length)break;
        const p=ws.slice(i,i+n).join(' ');if(p.length<4)continue;
        if(n===1 && STOP.has(p))continue;
        local.add(p);
      }
    }
    for(const p of local)counts.set(p,(counts.get(p)||0)+1);
  }
  return counts;
}

function overlapScore(a,b){const A=new Set(tokens(a)),B=new Set(tokens(b));let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(1,Math.min(A.size,B.size));}
function itemText(x){return `${x.title} ${x.text}`.toLowerCase();}
function itemsForPhrase(items,p){const q=p.toLowerCase();return items.filter(x=>itemText(x).includes(q));}
function questionsFor(items){return uniq(items.map(x=>clean(x.text||x.title)).filter(t=>/\?|\bwhy\b|\bhow\b|\bwhat\b|\bcan i\b|\bshould i\b|\bdoes\b|\bkya\b|\bkyun\b|\bkaise\b/i.test(t))).slice(0,30);}

// Dynamic hierarchy: no fixed health category list. It extracts recurring phrases,
// groups related phrases, and only creates titles at the final level.
function candidatePhrases(items,keyword,minCount=2){
  const counts=phraseCounts(items,3);const k=keyword.toLowerCase();
  const generic=/^(health|healthy|people|problem|problems|symptom|symptoms|disease|treatment|medicine|doctor|doctors|patient|patients|question|questions|video|videos|india|indian|natural|home|remedy|remedies|ways|things|cause|causes|related|connection|daily|life|body|food|foods|diet|care|help|best|good|bad|using|used|take|taking)$/;
  return [...counts.entries()].filter(([p,n])=>n>=minCount && !p.includes(k) && !generic.test(p) && !/^\d+$/.test(p))
    .map(([p,n])=>({phrase:p,count:n,items:itemsForPhrase(items,p)}))
    .filter(x=>x.items.length>=minCount)
    .sort((a,b)=>(b.count*2+b.items.length)-(a.count*2+a.items.length));
}

function chooseRoots(items,keyword){
  const candidates=candidatePhrases(items,keyword,2);const roots=[];
  for(const c of candidates){
    // Prefer broad 1-2 word concepts; avoid phrases that are clearly sub-angles.
    if(c.phrase.split(' ').length>2)continue;
    if(roots.some(r=>overlapScore(r.phrase,c.phrase)>=0.85))continue;
    roots.push(c);if(roots.length>=24)break;
  }
  return roots;
}

function chooseChildren(parentItems,parentPhrase,keyword){
  const candidates=candidatePhrases(parentItems,keyword,2);
  return candidates.filter(c=>c.phrase!==parentPhrase && c.phrase.split(' ').length<=3 && overlapScore(parentPhrase,c.phrase)<0.85).slice(0,12);
}

function chooseAngles(parentItems,parentPhrase,keyword){
  const candidates=candidatePhrases(parentItems,keyword,2);
  const angles=[];
  for(const c of candidates){
    if(c.phrase===parentPhrase)continue;
    if(c.phrase.split(' ').length<2 && parentPhrase.split(' ').length>=2)continue;
    if(angles.some(a=>overlapScore(a.phrase,c.phrase)>=0.88))continue;
    angles.push(c);if(angles.length>=14)break;
  }
  return angles;
}

function makeTitles(keyword,path,items){
  const qs=questionsFor(items);const out=[];
  for(const q of qs){let t=q.replace(/\s+/g,' ').trim();if(t.length>130)t=t.slice(0,127)+'...';if(t&&!out.includes(t))out.push(t);}
  // Only generate template titles when the source pool contains no question-shaped language.
  if(!out.length){
    const topic=path.slice(-2).join(' — ');
    out.push(`Why does ${topic} keep coming up in real-world discussions?`,`${topic}: what are people actually noticing?`);
  }
  return out.slice(0,12);
}

function nodeSignal(items){
  const sources=new Set(items.map(x=>x.source)).size;const q=questionsFor(items).length;const unique=new Set(items.map(x=>x.title).filter(Boolean)).size;
  const score=Math.min(100,Math.round(10+Math.min(items.length,45)+Math.min(q*2,20)+Math.min(sources*7,28)+Math.min(unique/6,10)));
  return {score,strength:score>=75?'VERY HIGH':score>=55?'HIGH':score>=35?'RISING':'EARLY'};
}

function makeAngleNode(keyword,path,c,items){
  const si=c.items;const sig=nodeSignal(si);
  return {name:label(c.phrase),type:'angle',items:si.length,signal:sig.strength,signalScore:sig.score,questions:questionsFor(si).slice(0,12),titles:makeTitles(keyword,[...path,label(c.phrase)],si),samples:si.slice(0,8),reason:`Repeated in ${si.length} live source signals.`};
}

function buildTree(keyword,items){
  const roots=chooseRoots(items,keyword);const tree=[];
  for(const r of roots){
    const rootItems=r.items;const rootSig=nodeSignal(rootItems);const childCandidates=chooseChildren(rootItems,r.phrase,keyword);const children=[];
    for(const ch of childCandidates){
      const chItems=ch.items;const chSig=nodeSignal(chItems);const angleCandidates=chooseAngles(chItems,ch.phrase,keyword);const angles=[];
      for(const a of angleCandidates){
        const ai=a.items;
        if(ai.length<2)continue;
        angles.push(makeAngleNode(keyword,[keyword,label(r.phrase),label(ch.phrase)],a,ai));
      }
      if(!angles.length) angles.push(makeAngleNode(keyword,[keyword,label(r.phrase)],ch,chItems));
      children.push({name:label(ch.phrase),type:'sub-territory',items:chItems.length,signal:chSig.strength,signalScore:chSig.score,children:angles,samples:chItems.slice(0,6),reason:`Clustered from ${chItems.length} supporting signals.`});
      if(children.length>=10)break;
    }
    if(!children.length){
      const angles=chooseAngles(rootItems,r.phrase,keyword).slice(0,10).map(a=>makeAngleNode(keyword,[keyword,label(r.phrase)],a,a.items));
      children.push(...angles.map(a=>({name:a.name,type:'angle-group',items:a.items,signal:a.signal,signalScore:a.signalScore,children:[a],samples:a.samples,reason:a.reason})));
    }
    tree.push({name:label(r.phrase),type:'territory',items:rootItems.length,signal:rootSig.strength,signalScore:rootSig.score,children,samples:rootItems.slice(0,8),reason:`Recurring concept cluster found across ${rootItems.length} live source signals.`});
    if(tree.length>=20)break;
  }
  return tree;
}

function deriveExpansionQueries(keyword,items,batch){
  const candidates=candidatePhrases(items,keyword,2).slice(0,18);
  const seen=new Set();const qs=[];
  // Every later batch is generated from what the current evidence is actually saying.
  for(const c of candidates){
    const p=c.phrase;
    for(const suffix of ['questions','why how','experience discussion','vs','food','causes']){
      const q=`"${keyword}" "${p}" ${suffix}`;
      if(!seen.has(q)){seen.add(q);qs.push(q);}if(qs.length>=12)break;
    }
    if(qs.length>=12)break;
  }
  return qs;
}

async function collectQueries(queries,batch){
  if(!queries.length)return {items:[],queries:[],errors:[]};
  const errors=[];let items=[];
  const groups=await Promise.allSettled([
    Promise.all(queries.map(q=>youtubeSearch(q,20))),
    Promise.all(queries.map(q=>redditSearch(q,35,batch%2?'new':'relevance'))),
    Promise.all(queries.map(q=>newsRss(q)))
  ]);
  if(groups[0].status==='fulfilled')items.push(...groups[0].value.flatMap(x=>x.items||[]));else errors.push(`YouTube: ${groups[0].reason?.message||'failed'}`);
  if(groups[1].status==='fulfilled')items.push(...groups[1].value.flat());else errors.push(`Reddit: ${groups[1].reason?.message||'failed'}`);
  if(groups[2].status==='fulfilled')items.push(...groups[2].value.flat());else errors.push(`News: ${groups[2].reason?.message||'failed'}`);
  const videos=groups[0].status==='fulfilled'?groups[0].value.flatMap(x=>x.items||[]).filter(x=>x.videoId).slice(0,5):[];
  const comments=await Promise.all(videos.map(v=>youtubeComments(v.videoId,12)));items.push(...comments.flat());
  return {items:normalize(items),queries,errors};
}

async function discoverBatch(keyword,batch,prior){
  let queries=[];
  if(batch===0) queries=BASE_PROBES.slice(0,6).map(x=>x.replaceAll('{k}',keyword));
  else {
    queries=deriveExpansionQueries(keyword,prior,batch);
    if(!queries.length) queries=BASE_PROBES.slice((batch%3)*3,((batch%3)*3)+6).map(x=>x.replaceAll('{k}',keyword));
  }
  const result=await collectQueries(uniq(queries),batch);
  const all=normalize([...(prior||[]),...result.items]);
  // Continue while each batch is still adding new evidence. Hard safety ceiling prevents infinite quota use.
  const newUnique=result.items.filter(x=>!(prior||[]).some(p=>p.id===x.id)).length;
  const exhausted=(batch>=24)||(result.items.length===0)||(newUnique<5 && batch>=2);
  return {all,newItems:result.items,queries:result.queries,errors:result.errors,nextBatch:exhausted?null:batch+1,exhausted};
}

app.post('/api/discover',async(req,res)=>{
  try{
    const keyword=clean(req.body?.keyword||'');const batch=Math.max(0,Number(req.body?.batch||0));if(!keyword)return res.status(400).send('keyword required');
    const prior=Array.isArray(req.body?.signals)?normalize(req.body.signals):[];
    const b=await discoverBatch(keyword,batch,prior);const tree=buildTree(keyword,b.all);const sig=nodeSignal(b.all);
    res.json({mode:'V3_DYNAMIC_TERRITORY_ENGINE',keyword,batch,nextBatch:b.nextBatch,exhausted:b.exhausted,queries:b.queries,errors:b.errors,timestamp:new Date().toISOString(),signalScore:sig.score,signalStrength:sig.strength,rawCounts:{total:b.all.length,newBatch:b.newItems.length,youtube:b.all.filter(x=>x.source==='YouTube').length,comments:b.all.filter(x=>x.source==='YouTube comment').length,reddit:b.all.filter(x=>x.source==='Reddit').length,news:b.all.filter(x=>x.source==='Google News RSS').length},sources:uniq(b.all.map(x=>x.source)),signals:b.all,tree,questions:questionsFor(b.all),architecture:'UNLIMITED SIGNAL POOL → DYNAMIC TERRITORY → SUB-TERRITORY → ANGLE → FINAL TITLE'});
  }catch(e){console.error(e);res.status(500).send(e.message||'Discovery error');}
});

app.post('/api/scan',async(req,res)=>{
  try{
    const node=clean(req.body?.node||'');const keyword=clean(req.body?.keyword||node);if(!node)return res.status(400).send('node required');
    const queries=[`"${keyword}" "${node}" questions`,`"${keyword}" "${node}" why how`,`"${keyword}" "${node}" experience`,`"${keyword}" "${node}" India`];
    const b=await collectQueries(queries,0);const sig=nodeSignal(b.items);
    res.json({mode:'LIVE NODE SCAN V3',node,path:req.body?.path||[keyword,node],signalStrength:sig.strength,signalScore:sig.score,queries,sources:uniq(b.items.map(x=>x.source)),peopleQuestions:questionsFor(b.items),discussions:b.items.slice(0,20).map(x=>x.title||x.text),signals:b.items,rawCounts:{total:b.items.length},timestamp:new Date().toISOString()});
  }catch(e){res.status(500).send(e.message||'Signal scan error');}
});

app.get('/api/health',(req,res)=>res.json({ok:true,version:'V3_DYNAMIC_TERRITORY_ENGINE',youtube:!!process.env.YOUTUBE_API_KEY,reddit:'public-discovery',newsRss:true,time:new Date().toISOString()}));
app.listen(PORT,()=>console.log(`MEDIMANCH V3 Dynamic Territory Engine running at http://localhost:${PORT}`));
