import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IHome, IGrid, ISearch, IStar, ISettings, Logo } from "../icons";
import { useContentPreferences } from "../contentPreferences";
import { contentKey, type TvContent } from "./model";
import { useTv } from "./TvProvider";
import { focusElement, rememberFocus, restoreFocus, useRemoteScope } from "./remote";
import { indexMetadata, setCatalogPaused } from "./search/catalog";
import { saveContent } from "./library";
import { setPlaybackPreferences, usePlaybackPreferences } from "./preferences";
import HomePage from "./HomePage";
import BrowsePage from "./BrowsePage";
import SearchPage from "./SearchPage";
import LibraryPage from "./LibraryPage";
import SettingsPage from "./SettingsPage";
import DetailPage from "./DetailPage";
import PlayerPage from "./PlayerPage";
import { TvStatus } from "./ui";
type Tab = "home"|"browse"|"search"|"library"|"settings";
type Route = {kind:"detail";content:TvContent}|{kind:"player";content:TvContent;part:string;seconds:number};
const nav = [{id:"home",label:"首页",Icon:IHome},{id:"browse",label:"浏览",Icon:IGrid},{id:"search",label:"搜索",Icon:ISearch},{id:"library",label:"片库",Icon:IStar},{id:"settings",label:"设置",Icon:ISettings}] as const;
export default function TvApp(){
  const tv=useTv(),prefs=useContentPreferences(),playback=usePlaybackPreferences();
  const navRef=useRef<HTMLElement>(null),[navScrolled,setNavScrolled]=useState(false);
  /* 点左侧菜单后焦点必须留在菜单上：否则会被 restoreFocus 扔进内容区，
     用户接着按上下就切不了菜单（实测「切一次之后菜单就切不动」）。 */
  const keepNav=useRef(false), navHoldTimer=useRef<number|undefined>(undefined), exitTimer=useRef<number|undefined>(undefined);
  const [tab,setTab]=useState<Tab>("home"),[visited,setVisited]=useState<Tab[]>(["home"]),[stack,setStack]=useState<Route[]>([]);
  const [exitArmed,setExitArmed]=useState(false);
  const current=stack[stack.length-1],playing=current?.kind==="player";
  const page=current?`${current.kind}:${contentKey(current.content)}`:tab;
  useEffect(()=>{setCatalogPaused(playing);return()=>setCatalogPaused(false);},[playing]);
  useEffect(()=>()=>{if(navHoldTimer.current!==undefined)window.clearTimeout(navHoldTimer.current);if(exitTimer.current!==undefined)window.clearTimeout(exitTimer.current);},[]);
  useEffect(()=>{
    if(keepNav.current){
      keepNav.current=false;
      const target=navRef.current?.querySelector<HTMLElement>(`[data-tv-focus="nav-${tab}"]`);
      if(target){
        focusElement(target);
        /* 3 秒内不让首页 Hero 的自动聚焦把焦点抢走 */
        document.documentElement.dataset.tvNavHold="1";
        if(navHoldTimer.current!==undefined)window.clearTimeout(navHoldTimer.current);
        navHoldTimer.current=window.setTimeout(()=>{delete document.documentElement.dataset.tvNavHold;navHoldTimer.current=undefined;},3000);
        return;
      }
    }
    restoreFocus(page);
  },[page,tv.ready,tab]);
  /* 顶部导航跟着内容滚动变淡：滚下去时让画面尽量留给内容，但绝不整体移出屏幕——
     tvNav 的 visible() 会过滤掉屏幕外元素，隐藏了遥控器就再也选不回导航。 */
  useEffect(()=>{
    const onScroll=(event:Event)=>{
      const target=event.target as HTMLElement|null;
      if(!target?.classList?.contains("tv-page-scroll"))return;
      setNavScrolled(target.scrollTop>48);
    };
    document.addEventListener("scroll",onScroll,true);
    return()=>document.removeEventListener("scroll",onScroll,true);
  },[]);
  const clearExit=()=>{setExitArmed(false);if(exitTimer.current!==undefined){window.clearTimeout(exitTimer.current);exitTimer.current=undefined;}};
  const back=()=>{
    rememberFocus(page);
    if(stack.length){clearExit();setStack(s=>s.slice(0,-1));return;}
    if(tab!=="home"){clearExit();setTab("home");return;}
    if(exitArmed){clearExit();void invoke("plugin:app|exit",{code:0});return;}
    setExitArmed(true);
    exitTimer.current=window.setTimeout(()=>{setExitArmed(false);exitTimer.current=undefined;},2500);
  };
  useRemoteScope({id:"app",priority:0,onKey:key=>{if(key==="back"){back();return true;}}});
  const open=(content:TvContent)=>{clearExit();rememberFocus(page);setStack(s=>[...s,{kind:"detail",content}]);};
  /* Hero 的「播放」要真的开播，不能只弹详情页——用户按播放看到简介页会以为是坏了 */
  const playDirect=(content:TvContent,part="1",seconds=0)=>{clearExit();rememberFocus(page);setStack(s=>[...s,{kind:"player",content,part,seconds}]);};
  const navigate=(next:Tab,keepFocusOnNav=true)=>{clearExit();rememberFocus(page);keepNav.current=keepFocusOnNav;
    /* 每个页面有自己的滚动位置：切页时上一次滚动的状态必须清掉，否则新页面
       一进来顶栏就是 is-scrolled（搜索结果页曾经整页没有顶栏就是这个残留）。 */
    setNavScrolled(false);setTab(next);setVisited(v=>v.includes(next)?v:[...v,next]);setStack([]);};
  const metadata=(content:TvContent)=>{void indexMetadata(tv.source,[content]).catch(()=>{});void saveContent(content).catch(()=>{});};
  const entry=current?tv.library.find(item=>item.key===contentKey(current.content)):undefined;
  if(!tv.ready)return <main className="tv-boot-status"><h1>正在准备本地片库</h1><TvStatus busy={!tv.error} error={tv.error} onRetry={tv.retry}/></main>;
  return <div className="tv-app">
    {!current&&<nav ref={navRef} className={`tv-topbar${navScrolled?" is-scrolled":""}`} aria-label="主导航" data-tv-region="navigation"><div className="tv-brand"><Logo size={24}/><span>HGhubTV</span></div><div className="tv-topbar-links">{nav.map(({id,label,Icon})=><button key={id} data-tv-focus={`nav-${id}`} aria-label={label} aria-current={tab===id?"page":undefined} onClick={()=>navigate(id)}><Icon size={18}/><span>{label}</span></button>)}</div></nav>}
    <main className="tv-main-area" hidden={!!current}>
      {visited.map(name=><div key={name} hidden={tab!==name} className="tv-page-scroll" data-tv-scroll-id={`page-${name}`}>
        {name==="home"&&<HomePage active={tab==="home"&&!current} onOpen={open} onPlay={playDirect}/>}{name==="browse"&&<BrowsePage active={tab==="browse"&&!current} onOpen={open}/>}{name==="search"&&<SearchPage key={tv.sourceKey} source={tv.source} paused={playing||tab!=="search"||!!current} onOpen={open}/>}{name==="library"&&<LibraryPage onOpen={open} onNavigate={navigate}/>}{name==="settings"&&<SettingsPage/>}
      </div>)}
    </main>
    {current?.kind==="detail"&&<div className="tv-detail-route" data-tv-scroll-id={page}><DetailPage key={contentKey(current.content)} content={current.content} sourceKey={tv.sourceKey} progress={entry?.progress} favorite={!!entry?.favorite} onFavorite={tv.toggleFavorite} onBack={back} onOpen={open} onMetadata={metadata} onPlay={(content,part,seconds=0)=>{rememberFocus(page);setStack(s=>[...s,{kind:"player",content,part,seconds}]);}}/></div>}
    {current?.kind==="player"&&<PlayerPage key={contentKey(current.content)} content={current.content} sourceKey={tv.sourceKey} part={current.part} resumeSeconds={current.seconds} favorite={!!entry?.favorite} rate={playback.rate} quality={playback.quality} autoNext={playback.autoplayNext} backLabel={stack.some(r=>r.kind==="detail")?"返回详情":"返回首页"} onPreferencesChange={setPlaybackPreferences} onFavorite={tv.toggleFavorite} onProgress={tv.progress} onMetadata={metadata} onBack={back}/>}
    {(tv.error||prefs.storageError||exitArmed)&&<div className="tv-notice" role="alert">{tv.error||prefs.storageError||"再按一次返回键退出应用"}</div>}
  </div>;
}
