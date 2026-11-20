import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { TagGroup, TopicCard } from "../types";
import { useContentPreferences } from "../contentPreferences";
import { type TvContent, contentKey } from "./model";
import { videoCard, rankCard, postCard } from "./catalogCards";
import { qualifyVisiblePosts } from "./postEligibility";
import { indexMetadata } from "./search/catalog";
import { useTv } from "./TvProvider";
import { TvAmbient, TvCard, TvStatus } from "./ui";
import { focusElement, useRemoteScope } from "./remote";
const channels = [{id:"ai-duanju",label:"短剧"},{id:"ai-manju",label:"漫剧"},{id:"original",label:"原创"},{id:"rank",label:"排行"},{id:"topics",label:"专题"},{id:"tags",label:"标签"},{id:"posts",label:"吃瓜视频"}];
const categorySorts = [{id:"latest",label:"最近更新"},{id:"hot_window",label:"当前热播"},{id:"random",label:"精选推荐"}] as const;
const originalCates = [{id:"all",label:"全部原创"},{id:"ai-manju",label:"原创漫剧"},{id:"ai-duanju",label:"原创短剧"}] as const;
const rankKinds = [{id:"hot",label:"热播榜"},{id:"recommend",label:"推荐榜"},{id:"potential",label:"潜力榜"}] as const;
export default function BrowsePage({ onOpen, active=true }: { onOpen: (content: TvContent) => void; active?: boolean }) {
  const { source, sourceKey } = useTv(), preferences = useContentPreferences();
  const [channel,setChannel]=useState("ai-duanju"), [selection,setSelection]=useState(""), [items,setItems]=useState<TvContent[]>([]), [topics,setTopics]=useState<TopicCard[]>([]), [tags,setTags]=useState<TagGroup[]>([]);
  const [sort,setSort]=useState<(typeof categorySorts)[number]["id"]>("latest");
  const [originalCate,setOriginalCate]=useState<(typeof originalCates)[number]["id"]>("all");
  const [rankKind,setRankKind]=useState<(typeof rankKinds)[number]["id"]>("hot");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[retryable,setRetryable]=useState(0),[done,setDone]=useState(false);
  const [ambientCover,setAmbientCover]=useState<string|undefined>(undefined);
  const subKey=channel==="rank"?rankKind:channel==="original"?originalCate:(channel==="ai-duanju"||channel==="ai-manju")?sort:"";
  const route=`${sourceKey}:${channel}:${selection}:${subKey}:${preferences.revision}`;
  const [request,setRequest]=useState({route:"",page:1,retry:0});
  const routeRef=useRef(route); routeRef.current=route;
  const activeRef=useRef(active); activeRef.current=active;
  const fulfilled=useRef<typeof request | null>(null);
  const seq=useRef(0), prefsRef=useRef(preferences); prefsRef.current=preferences;
  const seenPages=useRef(new Map<number,string>()), candidates=useRef<TvContent[]>([]), nextPage=useRef(2);
  const lastParentFocus=useRef("");
  const exitSelection=()=>{
    const focusKey=lastParentFocus.current;
    setSelection("");
    if(focusKey)window.requestAnimationFrame(()=>focusElement(document.querySelector<HTMLElement>(`[data-tv-focus=${JSON.stringify(focusKey)}]`)));
  };
  useEffect(()=>{
    setAmbientCover(undefined);
    setItems([]);if(!selection){if(channel!=="topics")setTopics([]);if(channel!=="tags")setTags([]);}
    setError("");setDone(false);setRetryable(0);
    seenPages.current.clear();candidates.current=[];nextPage.current=2;
    setRequest({route,page:1,retry:0});
  },[route]);
  useEffect(()=>{
    // A route change renders once with the previous request. Only its reset
    // request may start I/O, so changing channel on page 4 never fetches page 4.
    if(request.route!==route || !source || !active)return;
    if(fulfilled.current===request){setBusy(false);return;}
    const token=++seq.current; let disposed=false;
    const current=()=>!disposed && token===seq.current && routeRef.current===route && activeRef.current;
    setBusy(true);setError("");setRetryable(0);
    void (async()=>{
      try {
        if(channel==="topics"&&!selection){const result=await api.topics();if(current()){setTopics(result.items);setDone(true);fulfilled.current=request;}return;}
        if(channel==="tags"&&!selection){const result=await api.tags();if(current()){setTags(result.categories);setDone(true);fulfilled.current=request;}return;}
        if(channel==="rank"){const result=await api.rank(rankKind);if(current()){const next=result.items.map(rankCard);setItems(next);setDone(true);fulfilled.current=request;void indexMetadata(source,next).catch(()=>{});}return;}
        let page=request.page, added:TvContent[]=[], pending:TvContent[]=[], retryCount=0, finished=false;
        const pages=new Map(seenPages.current);
        for(let extra=0;extra<3;extra++){
          const response=channel==="posts"?await api.posts(page,20,"latest"):channel==="original"?await api.originalVideos(originalCate,page,20,originalCate==="all"?"new":"latest"):channel==="topics"?(await api.topic(selection,page,20)).videos:channel==="tags"?await api.tagVideos(selection,page,20):await api.category(channel,page,20,sort);
          if(!current())return;
          const paging=response.pagination;
          if(!paging || !Number.isSafeInteger(paging.page) || paging.page!==page || !Number.isSafeInteger(paging.pages) || paging.pages<0)throw new Error("目录分页未推进，请重试");
          const meta=channel==="posts"?(response.items as Parameters<typeof postCard>[0][]).map(postCard):(response.items as Parameters<typeof videoCard>[0][]).map(videoCard);
          const signature=meta.map(contentKey).sort().join(",");
          if(meta.length && [...pages].some(([previous,value])=>previous!==page&&value===signature))throw new Error("目录返回重复页，请重试");
          if(!meta.length && page<paging.pages)throw new Error("目录返回空页，请重试");
          if(paging.pages<page && !(page===1&&!meta.length&&paging.pages===0))throw new Error("目录分页发生变化，请重试");
          pages.set(page,signature); void indexMetadata(source,meta).catch(()=>{});
          let allowed=meta.filter(content=>!prefsRef.current.blockReason(content.tags));
          if(channel==="posts"){
            pending.push(...allowed);
            const result=await qualifyVisiblePosts(allowed,{source,isCurrent:current,allowed:content=>!prefsRef.current.blockReason(content.tags)},request.retry>0);
            if(!current())return; allowed=result.items;retryCount+=result.retryable;
          }
          added.push(...allowed); finished=page>=paging.pages;
          if(channel!=="posts"||added.length||finished||extra===2)break;
          page++;
        }
        if(current()){
          setItems(previous=>{const map=new Map((request.page===1?[]:previous).map(item=>[contentKey(item),item]));for(const item of added)map.set(contentKey(item),item);return [...map.values()];});
          setDone(finished);setRetryable(retryCount);candidates.current=pending;seenPages.current=pages;nextPage.current=page+1;fulfilled.current=request;
        }
      }catch(e){if(current())setError(String(e));}finally{if(current())setBusy(false);}
    })(); return()=>{disposed=true;seq.current++;};
  },[request,route,source,channel,selection,sort,originalCate,rankKind,active]);
  useRemoteScope({ id: "browse-subpage", priority: 10, onKey: key => { if (active && selection && key === "back") { exitSelection(); return true; } } });
  const retry=async()=>{
    if(busy)return;
    if(channel==="posts"&&retryable&&candidates.current.length){
      const token=++seq.current, key=route;setBusy(true);setError("");
      const current=()=>token===seq.current&&routeRef.current===key&&activeRef.current;
      try{const result=await qualifyVisiblePosts(candidates.current,{source,isCurrent:current,allowed:c=>!prefsRef.current.blockReason(c.tags)},true);
        if(current()){setItems(prev=>[...new Map([...prev,...result.items].map(c=>[contentKey(c),c])).values()]);setRetryable(result.retryable);}}
      catch(e){if(current())setError(String(e));}
      finally{if(current())setBusy(false);}return;
    }
    setRequest(r=>({...r,retry:r.retry+1}));
  };
  /* 一级分类改为顶部横向胶囊条：全宽释放给海报墙，遥控器 ←/→ 切分类、↓ 进内容 */
  return <div className="tv-browse"><TvAmbient src={ambientCover || items[0]?.cover} />
    <div className="tv-tabs tv-browse-tabs" data-tv-region="browse-channels">
      {channels.map(c=><button key={c.id} data-tv-focus={`channel-${c.id}`} aria-pressed={channel===c.id} onClick={()=>{lastParentFocus.current="";setChannel(c.id);setSelection("");}}>{c.label}</button>)}
    </div>
    {(channel==="ai-duanju"||channel==="ai-manju")&&<div className="tv-tabs tv-browse-subtabs" data-tv-region="browse-subfilters">
      {categorySorts.map(s=><button key={s.id} data-tv-focus={`sort-${s.id}`} aria-pressed={sort===s.id} onClick={()=>setSort(s.id)}>{s.label}</button>)}
    </div>}
    {channel==="original"&&<div className="tv-tabs tv-browse-subtabs" data-tv-region="browse-subfilters">
      {originalCates.map(o=><button key={o.id} data-tv-focus={`original-${o.id}`} aria-pressed={originalCate===o.id} onClick={()=>setOriginalCate(o.id)}>{o.label}</button>)}
    </div>}
    {channel==="rank"&&<div className="tv-tabs tv-browse-subtabs" data-tv-region="browse-subfilters">
      {rankKinds.map(r=><button key={r.id} data-tv-focus={`rank-${r.id}`} aria-pressed={rankKind===r.id} onClick={()=>setRankKind(r.id)}>{r.label}</button>)}
    </div>}
    <div className="tv-browse-main">
    {selection&&<div data-tv-region="browse-up"><button data-tv-focus="browse-up" onClick={exitSelection}>返回{channel==="tags"?"标签":"专题"}</button></div>}
    <TvStatus busy={busy} error={error} onRetry={()=>void retry()}/>
    {!selection&&topics.length>0&&<div className="tv-grid" data-tv-region="topics" data-tv-columns="5">{topics.map(topic=><button className="tv-collection" data-tv-focus={`topic-${topic.slug}`} key={topic.slug} onClick={()=>{lastParentFocus.current=`topic-${topic.slug}`;setSelection(topic.slug);}}><strong>{topic.title}</strong><small>{topic.video_count||0} 部</small></button>)}</div>}
    {!selection&&tags.map(group=><section key={group.name}><h2>{group.name}</h2><div className="tv-tags" data-tv-region={`tags-${group.name}`} data-tv-columns="5">{group.tags.filter(tag=>!preferences.isTagBlocked(tag.name)).map(tag=><button data-tv-focus={`tag-${tag.id}`} key={tag.id} onClick={()=>{lastParentFocus.current=`tag-${tag.id}`;setSelection(tag.slug||tag.name);}}>{tag.name}</button>)}</div></section>)}
    <div className={`tv-grid ${channel==="posts"?"tv-grid-wide":""}`} data-tv-region="browse-grid" data-tv-columns={channel==="posts"?3:5}>{items.filter(c=>!preferences.blockReason(c.tags)).map((content,index)=><TvCard key={contentKey(content)} content={content} onOpen={onOpen} onFocus={c=>setAmbientCover(c.cover)} eager={index<10}/>)}</div>
    {!busy&&retryable>0&&<p role="status" data-tv-region="post-retry">{retryable} 个候选暂未确认可播放。<button data-tv-focus="post-retry" onClick={()=>void retry()}>重试确认</button></p>}
    {!busy&&!done&&!error&&source&&<div data-tv-region="browse-more"><button data-tv-focus="browse-more" onClick={()=>setRequest(r=>({route,page:nextPage.current,retry:r.retry}))}>继续加载</button></div>}
    {!busy&&!error&&!items.length&&!topics.length&&!tags.length&&<p className="tv-status">当前页暂无可展示内容{done?"":"，可继续加载"}</p>}
    </div>
  </div>;
}
