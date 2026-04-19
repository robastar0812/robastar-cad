// ═══════════════════════════════════════════════════════
// ROBA★STAR DIFF - Core Viewer Module
// Migrated from spa.html monolith (Vite + React wrapper)
// ═══════════════════════════════════════════════════════

import * as THREE from 'three'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'

// Expose CDN-style globals for legacy code that references THREE / pdfjsLib directly
window.THREE = THREE
window.pdfjsLib = pdfjsLib
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// ═══════════════════════════════════════════════════════
// LEGACY VIEWER CODE (copied from spa.html)
// ═══════════════════════════════════════════════════════

const S={
  mode:'single',      // 'single' | 'diff'
  selectedChain: new Set(), // ハイライト対象のチェーン線集合
  f1:null,f2:null,
  diff:null,
  pixelDiff:null,
  tab:'visual',
  sideTab:'list',
  layers:{},          // layerName → {visible, color, count}
  explode:0,          // 0..1 explode factor
  visLayers:{same:true,add:true,del:true},
  efState:{add:true,del:true,same:true},
  colorMode:'semantic',
  pan:{x:0,y:0},scale:1,bounds:null,
  page:0,
  dragging:false,lastMouse:null,
  allItems:[],selectedEnt:null,
  hoveredEnt:null,
};

// ── 引き込み線チェーン構築 ──
// クリックされた LINE から端点で繋がる全 LINE を辿り Set で返す
function buildChain(e) {
  const result = new Set();
  if(!e || e.type !== 'LINE') return result;
  // 部品外形線・ハッチング・寸法線はチェーン追跡しない
  const sem = e._sem || 'other';
  if(sem === 'outline' || sem === 'hatch' || sem === 'dimension') return result;
  const allEnts = S.f1 && S.f1.parsed ? S.f1.parsed.entities : [];
  const layerLines = allEnts.filter(l => l.type === 'LINE' && l.layer === e.layer);
  const bW = S.bounds ? S.bounds.maxX - S.bounds.minX : 10000;
  const TOL = Math.max(bW * 0.0005, 0.5);
  const baseLen = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
  result.add(e);
  let frontier = [e];
  for(let hop = 0; hop < 3; hop++) {
    const next = [];
    for(const cur of frontier) {
      for(const l of layerLines) {
        if(result.has(l)) continue;
        const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
        if(len > baseLen * 5) continue;
        if(
          Math.hypot(cur.x1 - l.x1, cur.y1 - l.y1) <= TOL ||
          Math.hypot(cur.x1 - l.x2, cur.y1 - l.y2) <= TOL ||
          Math.hypot(cur.x2 - l.x1, cur.y2 - l.y1) <= TOL ||
          Math.hypot(cur.x2 - l.x2, cur.y2 - l.y2) <= TOL
        ) { result.add(l); next.push(l); }
      }
    }
    if(!next.length || result.size > 8) break;
    frontier = next;
  }
  return result;
}

// Layer palette
const LAYER_COLORS=['#00b4ff','#00ffd0','#ffc040','#ff6080','#a0e0ff','#80ffb0','#ffb080','#e080ff','#40d0a0','#d0a040'];
let layerColorIdx=0;
function getLayerColor(name, aciColor){
  if(!S.layers[name]){
    // ACI色があればそれを使う、なければパレット色
    const col = aciColor || LAYER_COLORS[layerColorIdx%LAYER_COLORS.length];
    S.layers[name]={visible:true,color:col,count:0};
    if(!aciColor) layerColorIdx++;
  }
  return S.layers[name].color;
}

// ═══ DXF PARSER ═══

// ── ACI Color Index → CSS hex ──
const ACI_COLOR_MAP = {
  0:'#000000',  // ByBlock
  1:'#FF0000',  // Red
  2:'#FFFF00',  // Yellow
  3:'#00FF00',  // Green
  4:'#00FFFF',  // Cyan
  5:'#0000FF',  // Blue
  6:'#FF00FF',  // Magenta
  7:'#FFFFFF',  // White/Black
  8:'#414141',  // DarkGray
  9:'#808080',  // Gray
  10:'#FF0000', 11:'#FF7F7F', 12:'#A50000', 13:'#A55252', 14:'#7F0000',
  20:'#FF7F00', 21:'#FFBF7F', 22:'#A55200', 30:'#FF7F00', 31:'#FFBF7F',
  40:'#FFBF00', 41:'#FFDF7F', 50:'#FFBF00',
  51:'#FFDF7F', 60:'#FF9900', 70:'#BFFF00', 80:'#7FFF00',
  90:'#00FF7F', 100:'#00FFBF', 110:'#00BFFF', 120:'#007FFF',
  130:'#4040FF', 140:'#8080FF', 150:'#8000FF', 160:'#BF00FF',
  170:'#FF00BF', 180:'#FF007F',
  190:'#FF0040', 200:'#808080', 210:'#A0A0A0', 220:'#C0C0C0',
  221:'#C8C8C8', 222:'#D4D4D4', 230:'#D0D0D0',
  250:'#404040', 251:'#606060', 252:'#909090', 253:'#C0C0C0',
  254:'#E0E0E0', 255:'#F0F0F0',
};
function aciToHex(aci) {
  return ACI_COLOR_MAP[aci] || '#00b4ff';
}


// ── 大きい✕マーク除外 ──
// 図面全体の幅/高さに対して一定割合以上の対角線ペアを除外
function filterXMarks(entities) {
  // ✕マークは図面の意図的な表示のため除外しない
  return entities;
}
function parseDXF(text){
  const rawLines = text.split(/\r?\n/);
  const pairs = [];
  for(let i=0; i+1<rawLines.length; i+=2){
    const code=parseInt(rawLines[i].trim());
    if(!isNaN(code)) pairs.push([code, rawLines[i+1].trim()]);
  }

  // ── セクション範囲をインデックスで取得 ──
  const secRanges={};
  let curSec=null, secStart=0;
  for(let i=0;i<pairs.length;i++){
    const[c,v]=pairs[i];
    if(c===0&&v==='SECTION'){
      if(i+1<pairs.length&&pairs[i+1][0]===2){curSec=pairs[i+1][1];secStart=i;}
    }
    if(c===0&&v==='ENDSEC'&&curSec){secRanges[curSec]=[secStart,i];curSec=null;}
  }

  const entities=[], blocks={}, layerAci={}, layerMap={};

  // ── TABLES: レイヤー色 ＋ テキストスタイル ──
  const styleMap={};  // styleName → {wf, font}
  const[ts,te]=secRanges['TABLES']||[0,0];
  for(let i=ts;i<te;i++){
    const[c,v]=pairs[i];
    if(c===0&&v==='LAYER'){
      let name=null,color=null;
      for(let j=i+1;j<te&&j<i+25;j++){
        if(pairs[j][0]===0&&j>i+1)break;
        if(pairs[j][0]===2)name=pairs[j][1];
        if(pairs[j][0]===62){try{color=Math.abs(parseInt(pairs[j][1]));}catch(e){}}
      }
      if(name&&color!=null)layerAci[name]=color;
    }
    if(c===0&&v==='STYLE'){
      let sname=null,wf=1,font='';
      for(let j=i+1;j<te&&j<i+20;j++){
        if(pairs[j][0]===0&&j>i+1)break;
        if(pairs[j][0]===2)sname=pairs[j][1];
        if(pairs[j][0]===41)wf=parseFloat(pairs[j][1])||1;
        if(pairs[j][0]===3)font=pairs[j][1];
      }
      if(sname)styleMap[sname]={wf,font};
    }
  }

  // ── BLOCKS セクション ──
  const[bs,be]=secRanges['BLOCKS']||[0,0];
  let curBlockName=null, curBlockEnts=[], curPolyline=null;
  let i=bs;
  while(i<be){
    const[c,v]=pairs[i];
    if(c===0&&v==='BLOCK'){
      curBlockEnts=[];curPolyline=null;
      for(let j=i+1;j<be&&j<i+20;j++){
        if(pairs[j][0]===0&&j>i+1)break;
        if(pairs[j][0]===2){curBlockName=pairs[j][1];break;}
      }
    }else if(c===0&&v==='ENDBLK'){
      if(curBlockName)blocks[curBlockName]=curBlockEnts.slice();
      curBlockName=null;curBlockEnts=[];curPolyline=null;
    }else if(curBlockName){
      if(c===0&&v==='POLYLINE'){
        const d=readEntPairs(pairs,i,be,40);
        const flag=parseInt(d[70])||0;
        curPolyline={type:'LWPOLYLINE',layer:d[8]||'0',aci:Math.abs(parseInt(d[62]||256)),pts:[],closed:!!(flag&1)};
        curBlockEnts.push(curPolyline);
      }else if(c===0&&v==='VERTEX'&&curPolyline){
        const d=readEntPairs(pairs,i,be,15);
        const flag=parseInt(d[70])||0;
        if(!(flag&64)){// skip polyface vertices
          try{curPolyline.pts.push({x:parseFloat(d[10])||0,y:parseFloat(d[20])||0});}catch(e){}
        }
      }else if(c===0&&v==='SEQEND'){
        curPolyline=null;
      }else if(c===0&&['LINE','CIRCLE','ARC','LWPOLYLINE','TEXT','MTEXT','POINT','INSERT'].includes(v)){
        const ent=parseOneEntity(pairs,i,v,be);
        if(ent)curBlockEnts.push(ent);
      }
    }
    i++;
  }

  // ── ENTITIES セクション ──
  const[es,ee]=secRanges['ENTITIES']||[0,0];
  let curPolylineE=null;
  for(let i=es;i<ee;i++){
    const[c,v]=pairs[i];
    if(c===0&&v==='POLYLINE'){
      const d=readEntPairs(pairs,i,ee,40);
      const flag=parseInt(d[70])||0;
      curPolylineE={type:'LWPOLYLINE',layer:d[8]||'0',aci:Math.abs(parseInt(d[62]||256)),pts:[],closed:!!(flag&1)};
      applyAci(curPolylineE,layerAci);
      entities.push(curPolylineE);
    }else if(c===0&&v==='VERTEX'&&curPolylineE){
      const d=readEntPairs(pairs,i,ee,15);
      const flag=parseInt(d[70])||0;
      if(!(flag&64)){try{curPolylineE.pts.push({x:parseFloat(d[10])||0,y:parseFloat(d[20])||0});}catch(e){}}
    }else if(c===0&&v==='SEQEND'){
      curPolylineE=null;
    }else if(c===0&&['LINE','CIRCLE','ARC','LWPOLYLINE','TEXT','MTEXT','POINT','INSERT'].includes(v)){
      const ent=parseOneEntity(pairs,i,v,ee);
      if(ent){
        if(ent.type==='INSERT')expandInsert(ent,blocks,entities,layerAci,0);
        else{applyAci(ent,layerAci);entities.push(ent);}
      }
    }
  }

  // styleMap の wf を各 TEXT エンティティに適用
  entities.forEach(e=>{
    layerMap[e.layer]=(layerMap[e.layer]||0)+1;
    if((e.type==='TEXT'||e.type==='MTEXT') && e.style && styleMap[e.style]){
      const s=styleMap[e.style];
      // group41 が 1.0 のままならスタイルの wf を使う
      if(Math.abs((e.wf||1)-1)<0.01) e.wf=s.wf;
      if(!e.style_font && s.font) e.style_font=s.font;
    }
  });
  // filterXMarks は無効（✕マークは図面の意図的な表示）
  return{entities,layers:Object.keys(layerMap),layerCounts:layerMap,aciMap:layerAci,styleMap};
}

function readEntPairs(pairs,startIdx,maxIdx,maxPairs){
  const d={};
  for(let j=startIdx+1;j<maxIdx&&j<startIdx+maxPairs;j++){
    const[c,v]=pairs[j];
    if(c===0&&j>startIdx+1)break;
    if(d[c]===undefined)d[c]=v; // first occurrence wins (except multi-value handled separately)
  }
  return d;
}
function parseOneEntity(pairs,startIdx,type,maxIdx){
  maxIdx=maxIdx||pairs.length;
  const d=readEntPairs(pairs,startIdx,maxIdx,60);
  const layer=d[8]||'0';
  const aci=d[62]!=null?Math.abs(parseInt(d[62])):256;
  const fv=k=>parseFloat(d[k])||0;
  let ent=null;
  switch(type){
    case'LINE':    ent={type:'LINE',layer,aci,x1:fv(10),y1:fv(20),x2:fv(11),y2:fv(21)};break;
    case'CIRCLE':  ent={type:'CIRCLE',layer,aci,cx:fv(10),cy:fv(20),r:fv(40)};break;
    case'ARC':     ent={type:'ARC',layer,aci,cx:fv(10),cy:fv(20),r:fv(40),sa:fv(50),ea:fv(51)};break;
    case'LWPOLYLINE':{
      const xs=[],ys=[];
      for(let j=startIdx+1;j<maxIdx&&j<startIdx+2000;j++){
        const[c,v]=pairs[j];if(c===0&&j>startIdx+1)break;
        if(c===10)xs.push(parseFloat(v));if(c===20)ys.push(parseFloat(v));
      }
      ent={type:'LWPOLYLINE',layer,aci,pts:xs.map((x,i)=>({x,y:ys[i]||0})),closed:!!(parseInt(d[70]||0)&1)};break;
    }
    case'TEXT':case'MTEXT':{
      const ha=parseInt(d[72]||'0')||0;
      const va=parseInt(d[73]||'0')||0;
      // ha=4(MIDDLE): x11,y21 が中心点
      // ha=3(ALIGNED)/ha=5(FIT): x10,y20 が左端の挿入点
      // ha=0/1/2: x10,y20 を使う
      const useAlignCenter = ha===4 && d[11]!=null;
      const ix=fv(10),iy=fv(20);  // 挿入点
      const ax=d[11]!=null?parseFloat(d[11]):ix; // 位置合わせ点x
      const ay=d[21]!=null?parseFloat(d[21]):iy; // 位置合わせ点y
      const drawX = useAlignCenter ? ax : ix;
      const drawY = useAlignCenter ? ay : iy;
      ent={type:'TEXT',layer,aci,
        x:drawX, y:drawY,
        x1:ix, y1:iy,   // 挿入点（ha=5 fit の左端）
        x2:ax, y2:ay,   // 位置合わせ点（ha=5 fit の右端）
        h:fv(40)||2, text:d[1]||'',
        rot:parseFloat(d[50])||0, ha, va,
        wf:parseFloat(d[41])||1,
        style:d[7]||''};
      break;}
    case'POINT':   ent={type:'POINT',layer,aci,x:fv(10),y:fv(20)};break;
    case'INSERT':
      ent={type:'INSERT',layer,aci,blockName:d[2]||'',x:fv(10),y:fv(20),
        sx:parseFloat(d[41])||1,sy:parseFloat(d[42])||1,rot:(parseFloat(d[50])||0)*Math.PI/180};break;
  }
  return ent;
}


function expandInsert(ins, blocks, outEnts, layerAci, depth){
  if(depth>6) return;
  const blk = blocks[ins.blockName];
  if(!blk) return;
  const{x:tx, y:ty, sx, sy, rot} = ins;
  const cosR=Math.cos(rot), sinR=Math.sin(rot);
  function tx2d(lx,ly){
    const rx=lx*cosR-ly*sinR;
    const ry=lx*sinR+ly*cosR;
    return [rx*sx+tx, ry*sy+ty];
  }
  for(const e of blk){
    if(e.type==='INSERT'){
      const newIns={...e,
        x:e.x*sx+tx, y:e.y*sy+ty,
        sx:e.sx*sx, sy:e.sy*sy,
        rot:(e.rot||0)+rot
      };
      expandInsert(newIns, blocks, outEnts, layerAci, depth+1);
      continue;
    }
    let newE = null;
    switch(e.type){
      case 'LINE':{
        const[x1,y1]=tx2d(e.x1,e.y1);
        const[x2,y2]=tx2d(e.x2,e.y2);
        newE={...e,x1,y1,x2,y2};break;
      }
      case 'CIRCLE':case 'ARC':{
        const[cx,cy]=tx2d(e.cx,e.cy);
        newE={...e,cx,cy,r:e.r*Math.abs(sx)};break;
      }
      case 'LWPOLYLINE':{
        const pts=e.pts.map(p=>{const[px,py]=tx2d(p.x,p.y);return{x:px,y:py};});
        newE={...e,pts};break;
      }
      case 'TEXT':case 'MTEXT':{
        const[nx,ny]=tx2d(e.x,e.y);
        newE={...e,x:nx,y:ny};break;
      }
      case 'POINT':{
        const[nx,ny]=tx2d(e.x,e.y);
        newE={...e,x:nx,y:ny};break;
      }
    }
    if(newE){
      applyAci(newE, layerAci);
      outEnts.push(newE);
    }
  }
}

function applyAci(e, layerAci){
  // ACI: 256=ByLayer, 0=ByBlock
  if(!e.aci||e.aci===256||e.aci===0){
    e.aci = layerAci[e.layer] || 7;
  }
  e._aciColor = aciToHex(e.aci);
}



function buildEnt(type,p){
  const layer=p[8]||'0';
  switch(type){
    case'LINE':return{type,layer,x1:fv(p[10]),y1:fv(p[20]),x2:fv(p[11]),y2:fv(p[21])};
    case'CIRCLE':return{type,layer,cx:fv(p[10]),cy:fv(p[20]),r:fv(p[40])};
    case'ARC':return{type,layer,cx:fv(p[10]),cy:fv(p[20]),r:fv(p[40]),sa:fv(p[50]),ea:fv(p[51])};
    case'LWPOLYLINE':{const xs=arr(p[10]).map(fv),ys=arr(p[20]).map(fv);return{type,layer,pts:xs.map((x,i)=>({x,y:ys[i]||0})),closed:(parseInt(p[70])&1)===1};}
    case'TEXT':case'MTEXT':return{type,layer,x:fv(p[10]),y:fv(p[20]),text:p[1]||'',h:fv(p[40])};
    case'ELLIPSE':return{type,layer,cx:fv(p[10]),cy:fv(p[20]),mx:fv(p[11]),my:fv(p[21]),ratio:fv(p[40])};
    case'POINT':return{type,layer,x:fv(p[10]),y:fv(p[20])};
    default:return null;
  }
}

// ═══ DXF DIFF ═══
function eKey(e,tol){
  const r=v=>(Math.round(v/tol)*tol).toFixed(6);
  switch(e.type){
    case'LINE':{const pts=[[r(e.x1),r(e.y1)],[r(e.x2),r(e.y2)]].sort((a,b)=>a[0]<b[0]?-1:1);return`L|${pts.map(p=>p.join(',')).join('|')}|${e.layer}`;}
    case'CIRCLE':return`C|${r(e.cx)},${r(e.cy)},${r(e.r)}|${e.layer}`;
    case'ARC':return`A|${r(e.cx)},${r(e.cy)},${r(e.r)},${r(e.sa)},${r(e.ea)}|${e.layer}`;
    case'LWPOLYLINE':return`P|${e.pts.map(p=>`${r(p.x)},${r(p.y)}`).join('|')}|${e.closed}|${e.layer}`;
    case'TEXT':case'MTEXT':return`T|${r(e.x)},${r(e.y)},${e.text}|${e.layer}`;
    default:return`${e.type}|${JSON.stringify(e)}`;
  }
}
function diffDXF(e1,e2,tol){
  const m1=new Map(),m2=new Map();
  e1.forEach(e=>m1.set(eKey(e,tol),e));
  e2.forEach(e=>m2.set(eKey(e,tol),e));
  const same=[],added=[],removed=[];
  m1.forEach((e,k)=>(m2.has(k)?same:removed).push(e));
  m2.forEach((e,k)=>{if(!m1.has(k))added.push(e);});
  return{same,added,removed};
}

// ═══ BOUNDS ═══
function entBounds(e){
  switch(e.type){
    case'LINE':return{minX:Math.min(e.x1,e.x2),maxX:Math.max(e.x1,e.x2),minY:Math.min(e.y1,e.y2),maxY:Math.max(e.y1,e.y2)};
    case'CIRCLE':case'ARC':return{minX:e.cx-e.r,maxX:e.cx+e.r,minY:e.cy-e.r,maxY:e.cy+e.r};
    case'LWPOLYLINE':{const xs=e.pts.map(p=>p.x),ys=e.pts.map(p=>p.y);return{minX:xs.reduce((a,b)=>a<b?a:b),maxX:xs.reduce((a,b)=>a>b?a:b),minY:ys.reduce((a,b)=>a<b?a:b),maxY:ys.reduce((a,b)=>a>b?a:b)};}
    case'TEXT':case'MTEXT':if(!e.text)return null;{const tw=e.h*e.text.length*(e.wf||1)*0.6;return{minX:e.x-tw*0.1,maxX:e.x+tw,minY:e.y-e.h,maxY:e.y+e.h*0.3};}
    default:return null;
  }
}
function computeBounds(lists){
  // 全座標を収集して外れ値を除去
  const allX=[], allY=[];
  for(const list of lists) for(const e of list){
    const b=entBounds(e); if(!b) continue;
    if(isFinite(b.minX)){allX.push(b.minX,b.maxX); allY.push(b.minY,b.maxY);}
  }
  if(!allX.length) return {minX:0,maxX:100,minY:0,maxY:100};
  if(allX.length<=4) {
    return {minX:allX.reduce((a,b)=>a<b?a:b,allX[0]),maxX:allX.reduce((a,b)=>a>b?a:b,allX[0]),minY:allY.reduce((a,b)=>a<b?a:b,allY[0]),maxY:allY.reduce((a,b)=>a>b?a:b,allY[0])};
  }
  // IQR外れ値除去
  function iqrFilter(arr){
    const s=[...arr].sort((a,b)=>a-b);
    const q1=s[Math.floor(s.length*0.25)];
    const q3=s[Math.floor(s.length*0.75)];
    const iqr=(q3-q1)*1.5; // 標準的な外れ値フィルター係数
    return arr.filter(v=>v>=q1-iqr&&v<=q3+iqr);
  }
  const fx=iqrFilter(allX), fy=iqrFilter(allY);
  if(!fx.length||!fy.length) return {minX:allX.reduce((a,b)=>a<b?a:b),maxX:allX.reduce((a,b)=>a>b?a:b),minY:allY.reduce((a,b)=>a<b?a:b),maxY:allY.reduce((a,b)=>a>b?a:b)};
  const minX=fx.reduce((a,b)=>a<b?a:b,fx[0]);
  const maxX=fx.reduce((a,b)=>a>b?a:b,fx[0]);
  const minY=fy.reduce((a,b)=>a<b?a:b,fy[0]);
  const maxY=fy.reduce((a,b)=>a>b?a:b,fy[0]);
  // 0幅チェック
  return {
    minX, maxX: maxX===minX?minX+1:maxX,
    minY, maxY: maxY===minY?minY+1:maxY
  };
}

// Layer center for explode
function layerCenter(ents){
  if(!ents.length)return{x:0,y:0};
  let sx=0,sy=0,n=0;
  ents.forEach(e=>{const b=entBounds(e);if(!b)return;sx+=(b.minX+b.maxX)/2;sy+=(b.minY+b.maxY)/2;n++;});
  return{x:sx/n,y:sy/n};
}

// ═══ RENDER ═══
function W(wx,wy,b,sc,pan,ch){return[(wx-b.minX)*sc+pan.x,ch-((wy-b.minY)*sc+pan.y)];}

const DIFF_CLR={same:'rgba(58,100,140,0.65)',add:'#00e87a',del:'#ff3d5a'};

// ═══ SEMANTIC COLOR ENGINE ═══
const SEM = {
  outline:   { color:'#8899bb', label:'外形線',     tag:'OUTLINE', priority:0, vis:true },
  hidden:    { color:'#4488ff', label:'隠れ線',     tag:'HIDDEN',  priority:1, vis:true },
  center:    { color:'#ff4444', label:'中心線',     tag:'CENTER',  priority:2, vis:true },
  dimension: { color:'#44dd66', label:'寸法線',     tag:'DIM',     priority:3, vis:true },
  tap_hole:  { color:'#ff44cc', label:'タップ穴',   tag:'TAP',     priority:4, vis:true },
  screw_hole:{ color:'#ffcc00', label:'ビス穴(通し)',tag:'BOLT',   priority:5, vis:true },
  cbore:     { color:'#ff8833', label:'ザグリ穴',   tag:'CBORE',   priority:6, vis:true },
  hatch:     { color:'#556677', label:'ハッチング', tag:'HATCH',   priority:7, vis:true },
  text_ent:  { color:'#88aaee', label:'テキスト',   tag:'TEXT',    priority:8, vis:true },
  other:     { color:'#667788', label:'その他',     tag:'OTHER',   priority:9, vis:true },
};

// Tap drill diameters (mm), radius
const TAP_R = [0.625,0.8,1.025,1.25,1.65,2.1,2.5,3.4,4.25,5.1,6.0,7.0,8.5];
// Clearance hole radii (screw through-hole)
const CLR_R = [1.1,1.35,1.6,2.15,2.65,3.2,4.2,5.25,6.5,7.5,8.5,9.5,11.0];
// Counterbore radii
const CBR_R = [2.75,3.5,4.25,5.0,6.5,8.0,9.0,10.5,12.5];
const HOLE_TOL = 0.18; // 18% tolerance for radius matching

function matchRadius(r, arr){ return arr.some(ref=>Math.abs(r-ref)/ref<HOLE_TOL); }

const LAYER_PATTERNS = {
  center:    /CENTER|CHUSIN|中心|CHAIN|DASH.?DOT|一点|C\.L|一点鎖|ICDS|C[0-9]LAYER|CLAYER|^C[0-9]/i,
  hidden:    /HIDDEN|HIDE|KAKURE|隠れ|隠|DASHED|DASH|破線|虚線|HID[^E]/i,
  dimension: /DIM|SUNPO|寸法|DIMENSION|SUNSHI|LEADER|ARRW|ARROW|引出線|LEADERS/i,
  hatch:     /HATCH|ハッチ|SECTION|断面|切断|SEKIMEN|XHATCH/i,
  text_ent:  /TEXT|NOTE|MOJI|文字|注記|ANNOT|LABEL|MEMO|COMMENT|TYUUKI|BUHIN|PARTS|部品番号/i,
  outline:   /OUTLINE|GAIKO|外形|SOLID|OBJECT|BODY|CONTOUR|輪郭|形状|FRAME|WAKU|外郭|PROFILE/i,
  tap_hole:  /TAP|タップ|ネジ穴|NEJI|ビスANA|BOLT.?HOLE|SCREW.?HOLE|M[0-9]+.*HOLE|雌ねじ/i,
  screw_hole:/HOLE|穴|BORE|THROUGH|通し穴|KIANA|KEY.?WAY|キー溝|CLEARANCE/i,
};

function classifyEntity(e, allCircles){
  // Text types
  if(e.type==='TEXT'||e.type==='MTEXT') return 'text_ent';

  const L = e.layer.toUpperCase();

  // Layer-name-first classification
  for(const[type,pat] of Object.entries(LAYER_PATTERNS)){
    if(pat.test(e.layer)) return type;
  }
  // 番号付きレイヤー (例: C5LAYER20, D1, E3) → レイヤー番号で分類
  const lnum = e.layer.match(/^([A-Za-z]+)([0-9]+)/);
  if(lnum){
    const prefix = lnum[1].toUpperCase();
    if(/^C/.test(prefix)) return 'center';
    if(/^H/.test(prefix)) return 'hidden';
    if(/^D/.test(prefix)) return 'dimension';
    if(/^T/.test(prefix)) return 'text_ent';
  }

  // Geometry-based for circles
  if(e.type==='CIRCLE'||e.type==='ARC'){
    const r = e.r;
    if(r < 0.1) return 'other';

    // Check for concentric circles (counterbore detection)
    if(e.type==='CIRCLE' && allCircles){
      const hasConcentric = allCircles.some(c=>
        c!==e &&
        Math.abs(c.cx-e.cx)<0.5 &&
        Math.abs(c.cy-e.cy)<0.5 &&
        Math.abs(c.r-e.r)>0.3
      );
      if(hasConcentric){
        // Larger of concentric pair = counterbore
        const inner = allCircles.find(c=>c!==e&&Math.abs(c.cx-e.cx)<0.5&&Math.abs(c.cy-e.cy)<0.5&&c.r<e.r);
        if(inner) return 'cbore';
      }
    }
    if(matchRadius(r, TAP_R)) return 'tap_hole';
    if(matchRadius(r, CLR_R)) return 'screw_hole';
    if(matchRadius(r, CBR_R)) return 'cbore';
    // Small circles not matching known sizes still likely holes
    if(r < 12) return 'screw_hole';
  }

  // Hatch detection: many short parallel lines in same layer
  if(e.type==='LINE'){
    const len = Math.hypot(e.x2-e.x1, e.y2-e.y1);
    if(len < 0.001) return 'other';
    // Very short lines clustered together often = hatch
    // (will be refined after full analysis)
  }

  // Default: outline for lines/polylines, other for rest
  if(e.type==='LINE'||e.type==='LWPOLYLINE'||e.type==='ELLIPSE') return 'outline';
  return 'other';
}

function analyzeSemantics(entities){
  const circles = entities.filter(e=>e.type==='CIRCLE');

  // First pass: classify each entity
  entities.forEach(e=>{ e._sem = classifyEntity(e, circles); });

  // Hatch refinement: layers where >70% are short lines → hatch
  const layerLines = {};
  entities.forEach(e=>{
    if(e.type!=='LINE') return;
    if(!layerLines[e.layer]) layerLines[e.layer]={total:0,short:0};
    layerLines[e.layer].total++;
    const len=Math.hypot(e.x2-e.x1,e.y2-e.y1);
    if(len<20) layerLines[e.layer].short++;
  });
  const hatchLayers=new Set();
  Object.entries(layerLines).forEach(([l,{total,short}])=>{
    if(total>5&&short/total>0.65) hatchLayers.add(l);
  });
  // レイヤー内の平均線長を計算
  const layerAvgLen={};
  Object.keys(layerLines).forEach(l=>{
    const lens=entities.filter(e=>e.type==='LINE'&&e.layer===l)
      .map(e=>Math.hypot(e.x2-e.x1,e.y2-e.y1));
    layerAvgLen[l]=lens.reduce((a,b)=>a+b,0)/(lens.length||1);
  });
  entities.forEach(e=>{
    if(e.type==='LINE'&&hatchLayers.has(e.layer)){
      const len=Math.hypot(e.x2-e.x1,e.y2-e.y1);
      // 平均の3倍超の長さは引き込み線とみなしてハッチング再分類しない
      if(len<=layerAvgLen[e.layer]*3) e._sem='hatch';
    }
  });

  // Count per semantic type
  const counts={};
  entities.forEach(e=>{ counts[e._sem]=(counts[e._sem]||0)+1; });
  return counts;
}

function semColor(e){
  const type = e._sem||'other';
  return SEM[type]?SEM[type].color:'#667788';
}

S.colorMode = 'semantic'; // 'semantic' | 'layer'

function setColorMode(mode){
  S.colorMode=mode;
  document.getElementById('cmBtn1').classList.toggle('active',mode==='semantic');
  document.getElementById('cmBtn2').classList.toggle('active',mode==='layer');
  redrawDXF();
}

function buildSemLegend(counts){
  let h='<div class="sem-legend">';
  h+=`<div class="sem-legend-title">意味別カラー凡例 <span class="sem-count-badge">${Object.values(counts).reduce((a,b)=>a+b,0)} ent</span></div>`;
  Object.entries(SEM).sort((a,b)=>a[1].priority-b[1].priority).forEach(([type,info])=>{
    const n=counts[type]||0;
    if(!n) return;
    const muted=!info.vis?'muted':'';
    h+=`<div class="sl-item ${muted}" onclick="toggleSemType('${type}')">
      <div class="sl-swatch" style="background:${info.color}"></div>
      <div class="sl-label">${info.label}</div>
      <div class="sl-count">${n}</div>
      <span class="sl-tag" style="color:${info.color};border-color:${info.color}">${info.tag}</span>
    </div>`;
  });
  h+='</div>';
  document.getElementById('semLegendBody').innerHTML=h;
}

function toggleSemType(type){
  if(!SEM[type]) return;
  SEM[type].vis=!SEM[type].vis;
  if(S.f1&&S.f1.parsed) buildSemLegend(S.f1._semCounts||{});
  redrawDXF();
}



function drawEnt(ctx,e,color,b,sc,pan,ch,highlight=false){
  const sem=e._sem||'other';
  // ACI色優先（意味色モードでなくレイヤー色モードでもACI色を反映）
  const effectiveColor = (!highlight && e._aciColor && S.colorMode==='layer') ? e._aciColor : color;
  ctx.strokeStyle=highlight?'#ffffff':effectiveColor;
  ctx.fillStyle=highlight?'#ffffff':effectiveColor;
  // Line style by semantic type
  const lw=highlight?2.5:(sem==='outline'?1.5:sem==='dimension'?0.8:1);
  ctx.lineWidth=lw;
  // Dash pattern
  if(sem==='hidden')ctx.setLineDash([6*lw,3*lw]);
  else if(sem==='center')ctx.setLineDash([10*lw,3*lw,2*lw,3*lw]);
  else if(sem==='dimension')ctx.setLineDash([]);
  else ctx.setLineDash([]);
  // Glow only for highlighted entity (selected). Applying shadowBlur to every
  // hole across 100K+ entities costs ~10× total render time, so we drop the
  // per-hole glow and rely on the fill tint below to communicate hole state.
  if(highlight){
    ctx.shadowColor=color;ctx.shadowBlur=10;
  }else{
    ctx.shadowBlur=0;
  }

  switch(e.type){
    case'LINE':{const[x1,y1]=W(e.x1,e.y1,b,sc,pan,ch),[x2,y2]=W(e.x2,e.y2,b,sc,pan,ch);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();break;}
    case'CIRCLE':{const[cx,cy]=W(e.cx,e.cy,b,sc,pan,ch);const r=Math.max(e.r*sc,.5);ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
      // Fill for holes
      if(sem==='tap_hole'||sem==='screw_hole'||sem==='cbore'){ctx.fillStyle=color+'22';ctx.fill();}
      break;}
    case'ARC':{const[cx,cy]=W(e.cx,e.cy,b,sc,pan,ch);ctx.beginPath();ctx.arc(cx,cy,Math.max(e.r*sc,.5),-(e.sa*Math.PI/180),-(e.ea*Math.PI/180),true);ctx.stroke();break;}
    case'LWPOLYLINE':{if(e.pts.length<2)break;ctx.beginPath();const[sx,sy]=W(e.pts[0].x,e.pts[0].y,b,sc,pan,ch);ctx.moveTo(sx,sy);e.pts.slice(1).forEach(p=>{const[px,py]=W(p.x,p.y,b,sc,pan,ch);ctx.lineTo(px,py);});if(e.closed)ctx.closePath();ctx.stroke();break;}
    case'TEXT':case'MTEXT':{
      if(!e.text) break;
      const txt = e.text.slice(0,200);
      const fs  = Math.max(e.h*sc, 4);
      ctx.shadowBlur=0;
      const fontFace = '\"MS Gothic\",\"Meiryo\",\"Yu Gothic\",monospace,sans-serif';
      ctx.font=`${fs}px ${fontFace}`;
      ctx.textBaseline='alphabetic';
      ctx.textAlign='left';
      const rot = (e.rot||0);
      const ha  = (e.ha||0);

      if(ha===5){
        // ── ha=5 FIT モード ──
        // x1,y1=挿入点(left), x2,y2=位置合わせ点(right/top for rot=90)
        // fitW = 挿入点〜位置合わせ点の実距離
        const fitW = Math.hypot((e.x2-e.x1),(e.y2-e.y1))*sc;

        const [tx1,ty1]=W(e.x1,e.y1,b,sc,pan,ch);
        const [tx2,ty2]=W(e.x2,e.y2,b,sc,pan,ch);

        // fitW=0 (rot=90でy方向のみ差分がある場合)
        const fitPx = fitW>1 ? fitW : Math.max(Math.hypot(tx2-tx1,ty2-ty1),1);

        // テキスト名目幅
        const nomW = ctx.measureText(txt).width||1;
        const scaleX = fitPx/nomW;

        ctx.save();
        ctx.translate(tx1,ty1);
        // DXFのrot=degreeを反時計回りで変換（Canvasは時計回りが正）
        if(Math.abs(rot)>0.1) ctx.rotate(-rot*Math.PI/180);
        ctx.scale(scaleX,1);
        ctx.fillStyle=color;
        ctx.fillText(txt,0,0);
        ctx.restore();
      } else {
        // ── 通常モード ──
        const[tx,ty]=W(e.x,e.y,b,sc,pan,ch);
        const haMap=['left','center','right','center','center','center'];
        ctx.textAlign = haMap[Math.min(ha,5)]||'left';
        ctx.save();
        ctx.translate(tx,ty);
        if(Math.abs(rot)>0.1) ctx.rotate(-rot*Math.PI/180);
        const wf=e.wf||1;
        if(Math.abs(wf-1)>0.02) ctx.scale(wf,1);
        ctx.fillStyle=color;
        ctx.fillText(txt,0,0);
        ctx.restore();
        ctx.textAlign='left';
      }
      ctx.textBaseline='alphabetic';
      break;}
    case'POINT':{const[px,py]=W(e.x,e.y,b,sc,pan,ch);ctx.beginPath();ctx.arc(px,py,2,0,Math.PI*2);ctx.fill();break;}
  }
  ctx.setLineDash([]);ctx.shadowBlur=0;
}

function getLayerOffset(layerName,b,explodeFactor){
  if(explodeFactor===0)return{dx:0,dy:0};
  const layers=Object.keys(S.layers);
  const idx=layers.indexOf(layerName);
  if(idx<0)return{dx:0,dy:0};
  const n=layers.length;
  const angle=(idx/n)*Math.PI*2;
  const w=b.maxX-b.minX||1,h=b.maxY-b.minY||1;
  const radius=Math.max(w,h)*0.6*explodeFactor;
  return{dx:Math.cos(angle)*radius,dy:Math.sin(angle)*radius};
}

let _rafPending = false;
function redrawDXFRaf(){
  if(_rafPending) return;
  _rafPending = true;
  requestAnimationFrame(()=>{ _rafPending=false; redrawDXF(); });
}
function redrawDXF(){
  const cv=document.getElementById('mainCanvas');
  const wrap=document.getElementById('canvasWrap');
  // HiDPI 対応: 物理ピクセルでバッキングして CSS ピクセルに縮退表示。
  // これを怠ると Retina / 高解像度ディスプレイでラインがにじんで「角ついた」
  // ジャギー風に見える。
  const dpr = Math.max(1, Math.min(window.devicePixelRatio||1, 2));
  const ww=wrap.clientWidth, wh=wrap.clientHeight;
  const targetW = Math.floor(ww*dpr), targetH = Math.floor(wh*dpr);
  if(cv.width!==targetW||cv.height!==targetH){
    cv.width=targetW; cv.height=targetH;
    cv.style.width=ww+'px'; cv.style.height=wh+'px';
  }
  const ctx=cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,ww,wh);

  // DWG圧縮形式のwarnを最優先でカンバスに表示
  const dwgWarnMsg = S.f1&&S.f1.dwgWarn ? S.f1.dwgWarn
                   : S.f2&&S.f2.dwgWarn ? S.f2.dwgWarn : null;
  if(dwgWarnMsg){
    const cw=ww, ch=wh;
    ctx.save();
    ctx.fillStyle='rgba(255,200,0,0.95)';
    ctx.font=`bold ${Math.max(14,cw/40)}px monospace`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('⚠ ' + dwgWarnMsg, cw/2, ch/2 - 20);
    ctx.font=`${Math.max(11,cw/60)}px monospace`;
    ctx.fillStyle='rgba(0,180,255,0.85)';
    ctx.fillText('AutoCAD: [名前を付けて保存] → [DXF形式] → Robastarへドロップ', cw/2, ch/2 + 20);
    ctx.restore();
    return;
  }

  if(!S.bounds)return;
  const{bounds:b,scale:sc,pan}=S;
  const ch=wh; // 描画空間はCSSピクセル（setTransformでDPR適用済み）

  // ── ビューポート カリング ──
  // 現在画面が見ているワールド座標範囲を計算し、境界外のエンティティをスキップ。
  // explode=0 の時のみ有効（explode時はレイヤーごとにオフセットが変わるため）。
  const cullEnabled = S.explode < 0.01;
  // 画面→ワールド変換: wx=(sx-pan.x)/sc+b.minX, wy=(ch-sy-pan.y)/sc+b.minY
  // 可視領域に少し余白（lineWidth分）を持たせる
  const padW = 2/sc;
  const wxMin = (-pan.x)/sc + b.minX - padW;
  const wxMax = (ww - pan.x)/sc + b.minX + padW;
  const wyMin = (-pan.y)/sc + b.minY - padW;
  const wyMax = (wh - pan.y)/sc + b.minY + padW;
  const isVisible = (e) => {
    if(!cullEnabled) return true;
    const bb = e._b; // parse 時にキャッシュ済み
    if(!bb) return true;
    return !(bb.maxX < wxMin || bb.minX > wxMax || bb.maxY < wyMin || bb.minY > wyMax);
  };

  if(S.mode==='diff'&&S.diff){
    const{diff,visLayers}=S;
    if(visLayers.same)diff.same.forEach(e=>{if(!isVisible(e))return;if(S.layers[e.layer]&&!S.layers[e.layer].visible)return;drawEnt(ctx,e,DIFF_CLR.same,b,sc,pan,ch,e===S.selectedEnt);});
    if(visLayers.del)diff.removed.forEach(e=>{if(!isVisible(e))return;if(S.layers[e.layer]&&!S.layers[e.layer].visible)return;drawEnt(ctx,e,DIFF_CLR.del,b,sc,pan,ch,e===S.selectedEnt);});
    if(visLayers.add)diff.added.forEach(e=>{if(!isVisible(e))return;if(S.layers[e.layer]&&!S.layers[e.layer].visible)return;drawEnt(ctx,e,DIFF_CLR.add,b,sc,pan,ch,e===S.selectedEnt);});
  } else if(S.f1&&S.f1.type==='dxf'){
    const parsed=S.f1.parsed;
    const ents=parsed.entities;
    const useSem = S.colorMode==='semantic';
    // byLayer / semantic-sort は entities 不変のあいだ再利用できるのでキャッシュ
    if(!parsed._byLayer){
      const byLayer={};
      for(const e of ents){(byLayer[e.layer]||(byLayer[e.layer]=[])).push(e);}
      parsed._byLayer=byLayer;
    }
    const byLayer=parsed._byLayer;

    if(useSem && !parsed._drawListSem){
      parsed._drawListSem=[...ents].sort((a,b)=>(SEM[a._sem||'other']?.priority||9)-(SEM[b._sem||'other']?.priority||9));
    }
    const drawList = useSem ? parsed._drawListSem : ents;

    if(useSem){
      drawList.forEach(e=>{
        if(!isVisible(e))return;
        const layerInfo=S.layers[e.layer];
        if(layerInfo&&!layerInfo.visible)return;
        const sem=e._sem||'other';
        if(!SEM[sem]||!SEM[sem].vis)return;
        const off=getLayerOffset(e.layer,b,S.explode);
        const adjPan={x:pan.x+off.dx*sc,y:pan.y-off.dy*sc};
        drawEnt(ctx,e,semColor(e),b,sc,adjPan,ch,e===S.selectedEnt||S.selectedChain.has(e));
      });
    } else {
      Object.entries(byLayer).forEach(([layerName,layerEnts])=>{
        const layerInfo=S.layers[layerName];
        if(layerInfo&&!layerInfo.visible)return;
        const color=layerInfo?layerInfo.color:'#00b4ff';
        const off=getLayerOffset(layerName,b,S.explode);
        const adjPan={x:pan.x+off.dx*sc,y:pan.y-off.dy*sc};
        layerEnts.forEach(e=>{if(!isVisible(e))return;drawEnt(ctx,e,color,b,sc,adjPan,ch,e===S.selectedEnt||S.selectedChain.has(e));});
      });
    }
    // Layer / semantic labels when exploding
    if(S.explode>0.1){
      ctx.font='11px monospace';ctx.shadowBlur=0;ctx.setLineDash([]);
      Object.entries(byLayer).forEach(([layerName,layerEnts])=>{
        const layerInfo=S.layers[layerName];
        if(layerInfo&&!layerInfo.visible)return;
        const off=getLayerOffset(layerName,b,S.explode);
        const lc=layerCenter(layerEnts);
        const[lx,ly]=W(lc.x,lc.y,b,sc,{x:pan.x+off.dx*sc,y:pan.y-off.dy*sc},ch);
        ctx.fillStyle=layerInfo?layerInfo.color:'#00b4ff';
        ctx.globalAlpha=S.explode;
        ctx.fillText(layerName,lx+4,ly-4);
        ctx.globalAlpha=1;
      });
    }
  }
}

// ═══ PDF RENDER ═══
async function renderPDFPage(pdfDoc,pageNum,scale){
  const page=await pdfDoc.getPage(pageNum);
  const vp=page.getViewport({scale});
  const oc=document.createElement('canvas');
  oc.width=vp.width;oc.height=vp.height;
  await page.render({canvasContext:oc.getContext('2d'),viewport:vp}).promise;
  return oc;
}

async function buildPixelDiff(c1,c2){
  const w=Math.max(c1.width,c2.width),h=Math.max(c1.height,c2.height);
  const out=document.createElement('canvas');out.width=w;out.height=h;
  const ctx=out.getContext('2d');
  const t1=document.createElement('canvas');t1.width=w;t1.height=h;
  const t2=document.createElement('canvas');t2.width=w;t2.height=h;
  t1.getContext('2d').drawImage(c1,0,0);
  t2.getContext('2d').drawImage(c2,0,0);
  const d1=t1.getContext('2d').getImageData(0,0,w,h);
  const d2=t2.getContext('2d').getImageData(0,0,w,h);
  const od=ctx.createImageData(w,h);
  let ap=0,dp=0,sp=0;
  for(let i=0;i<d1.data.length;i+=4){
    const diff=((Math.abs(d1.data[i]-d2.data[i])+Math.abs(d1.data[i+1]-d2.data[i+1])+Math.abs(d1.data[i+2]-d2.data[i+2]))/3);
    if(diff>12){
      if(d2.data[i+3]<10){od.data[i]=255;od.data[i+1]=61;od.data[i+2]=90;od.data[i+3]=210;dp++;}
      else{od.data[i]=0;od.data[i+1]=232;od.data[i+2]=122;od.data[i+3]=210;ap++;}
    }else{
      const v=Math.round((d1.data[i]+d1.data[i+1]+d1.data[i+2])/3*0.22+18);
      od.data[i]=v;od.data[i+1]=v+8;od.data[i+2]=v+16;od.data[i+3]=d1.data[i+3]>10?170:0;
      if(d1.data[i+3]>10)sp++;
    }
  }
  ctx.putImageData(od,0,0);
  return{canvas:out,addPx:ap,delPx:dp,samePx:sp};
}

function redrawPDF(){
  const cv=document.getElementById('mainCanvas');
  const wrap=document.getElementById('canvasWrap');
  if(!S.pixelDiff&&!S.singleCanvas)return;
  const src=S.pixelDiff?S.pixelDiff.canvas:S.singleCanvas;
  cv.width=wrap.clientWidth;cv.height=wrap.clientHeight;
  const ctx=cv.getContext('2d');
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.save();
  ctx.translate(S.pan.x,S.pan.y);
  ctx.scale(S.scale,S.scale);
  ctx.drawImage(src,0,0);
  ctx.restore();
  // Draw selected highlight box
  if(S.selectedPdfItem){
    const item=S.selectedPdfItem;
    ctx.save();
    ctx.translate(S.pan.x,S.pan.y);
    ctx.scale(S.scale,S.scale);
    ctx.strokeStyle='#00b4ff';ctx.lineWidth=2/S.scale;
    ctx.strokeRect(item.x,item.y,item.w,item.h);
    ctx.restore();
  }
}

// ═══ FIT / ZOOM ═══
function fitView(){
  const wrap=document.getElementById('canvasWrap');
  const cw=wrap.clientWidth,ch=wrap.clientHeight;
  if(S.f1&&S.f1.type==='dxf'&&S.bounds||(S.mode==='diff'&&S.diff&&S.bounds)){
    const dw=S.bounds.maxX-S.bounds.minX||1,dh=S.bounds.maxY-S.bounds.minY||1;
    const pad=0.88; // 少し余白を持たせる
    S.scale=Math.min(cw*pad/dw,ch*pad/dh);
    S.pan.x=(cw-dw*S.scale)/2;S.pan.y=(ch-dh*S.scale)/2;
    redrawDXFRaf();
  }else if(S.pixelDiff||S.singleCanvas){
    const src=(S.pixelDiff?S.pixelDiff.canvas:S.singleCanvas);
    const sw=src.width,sh=src.height;
    S.scale=Math.min(cw*.9/sw,ch*.9/sh);
    S.pan.x=(cw-sw*S.scale)/2;S.pan.y=(ch-sh*S.scale)/2;
    redrawPDF();
  }
}
function zoom(f){S.scale*=f;if(S.f1&&S.f1.type==='dxf')redrawDXFRaf();else redrawPDF();}

// ═══ HIT TEST (DXF) ═══

// ── 引出し線グループ化 ──
// クリックされたLINEから端点で繋がる全LINEを辿り、
// 同一引出し線グループを返す (TOL=図面単位2mm相当)

function hitTest(mx,my){
  if(!S.bounds)return null;
  const{bounds:b,scale:sc,pan}=S;
  const wrap=document.getElementById('canvasWrap');
  const ch=wrap.clientHeight;
  const entities=S.mode==='diff'&&S.diff
    ?[...S.diff.same,...S.diff.added,...S.diff.removed]
    :(S.f1&&S.f1.type==='dxf'?S.f1.parsed.entities:[]);
  let best=null,bestDist=Infinity;
  for(const e of entities){
    if(S.layers[e.layer]&&!S.layers[e.layer].visible)continue;
    const off=S.mode==='single'?getLayerOffset(e.layer,b,S.explode):{dx:0,dy:0};
    const adjPan={x:pan.x+off.dx*sc,y:pan.y-off.dy*sc};
    const dist=distToEnt(e,mx,my,b,sc,adjPan,ch);
    if(dist<Math.max(8,10/sc)&&dist<bestDist){bestDist=dist;best=e;}
  }
  return best;
}

function distToEnt(e,mx,my,b,sc,pan,ch){
  switch(e.type){
    case'LINE':{const[x1,y1]=W(e.x1,e.y1,b,sc,pan,ch),[x2,y2]=W(e.x2,e.y2,b,sc,pan,ch);return distToSegment(mx,my,x1,y1,x2,y2);}
    case'CIRCLE':case'ARC':{const[cx,cy]=W(e.cx,e.cy,b,sc,pan,ch);return Math.abs(Math.hypot(mx-cx,my-cy)-e.r*sc);}
    case'LWPOLYLINE':{let d=Infinity;for(let i=0;i<e.pts.length-1;i++){const[x1,y1]=W(e.pts[i].x,e.pts[i].y,b,sc,pan,ch),[x2,y2]=W(e.pts[i+1].x,e.pts[i+1].y,b,sc,pan,ch);d=Math.min(d,distToSegment(mx,my,x1,y1,x2,y2));}return d;}
    case'TEXT':case'MTEXT':{const[tx,ty]=W(e.x,e.y,b,sc,pan,ch);return Math.hypot(mx-tx,my-ty);}
    case'POINT':{const[px,py]=W(e.x,e.y,b,sc,pan,ch);return Math.hypot(mx-px,my-py);}
    default:return Infinity;
  }
}

function distToSegment(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1;
  if(dx===0&&dy===0)return Math.hypot(px-x1,py-y1);
  const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}

// ═══ TEXT EXTRACTION ═══
async function extractPDFText(pdfDoc){
  const lines=[];
  for(let p=1;p<=pdfDoc.numPages;p++){
    const page=await pdfDoc.getPage(p);
    const tc=await page.getTextContent();
    lines.push(`=== PAGE ${p} ===`);
    tc.items.forEach(item=>{if(item.str.trim())lines.push(item.str);});
  }
  return lines.join('\n');
}

function textDiff(t1,t2){
  const l1=t1.split('\n'),l2=t2.split('\n');
  const result=[];let a=0,d=0,s=0;
  const max=Math.max(l1.length,l2.length);
  for(let i=0;i<max;i++){
    const a_=l1[i],b_=l2[i];
    if(a_===b_){result.push({type:'same',l:a_,r:b_});s++;}
    else if(a_===undefined){result.push({type:'add',l:'',r:b_});a++;}
    else if(b_===undefined){result.push({type:'del',l:a_,r:''});d++;}
    else{result.push({type:'change',l:a_,r:b_});a++;d++;}
  }
  return{lines:result,a,d,s};
}

function renderTextDiff(){
  const f1=S.f1,f2=S.f2;
  const txt1=f1?f1.text||'':'';
  const txt2=f2?f2.text||'':'';
  const diff=textDiff(txt1,txt2);
  let lH=`<div class="td-hdr">FILE 1 — ${esc(f1?f1.name:'')}</div>`;
  let rH=`<div class="td-hdr">FILE 2 — ${esc(f2?f2.name:'')}</div>`;
  diff.lines.forEach((d,i)=>{
    const lc=d.type==='del'||d.type==='change'?'del':d.type==='same'?'same':'';
    const rc=d.type==='add'||d.type==='change'?'add':d.type==='same'?'same':'';
    lH+=`<div class="td-line ${lc}"><span class="td-ln">${i+1}</span><span class="td-txt">${esc(d.l??'')}</span></div>`;
    rH+=`<div class="td-line ${rc}"><span class="td-ln">${i+1}</span><span class="td-txt">${esc(d.r??'')}</span></div>`;
  });
  const el=document.getElementById('textDiffContent');
  el.innerHTML=`<div class="td-col">${lH}</div><div class="td-divider"></div><div class="td-col">${rH}</div>`;
}

// ═══ STRUCT ═══
async function buildStructHTML(f){
  if(!f)return'<div class="no-data">ファイルなし</div>';
  let h='<div class="struct-panel">';
  h+=`<div class="struct-section"><div class="struct-title">基本情報</div>
    <div class="kv"><span class="kv-k">ファイル名</span><span class="kv-v hi">${esc(f.name)}</span></div>
    <div class="kv"><span class="kv-k">形式</span><span class="kv-v">${f.type.toUpperCase()}</span></div>
    <div class="kv"><span class="kv-k">サイズ</span><span class="kv-v">${formatBytes(f.size)}</span></div>
  </div>`;
  if(f.type==='pdf'&&f.pdfDoc){
    try{const meta=await f.pdfDoc.getMetadata();const info=meta.info||{};
      h+='<div class="struct-section"><div class="struct-title">メタデータ</div>';
      ['Title','Author','Subject','Creator','Producer','CreationDate'].forEach(k=>{if(info[k])h+=`<div class="kv"><span class="kv-k">${k}</span><span class="kv-v">${esc(String(info[k]))}</span></div>`;});
      h+='</div>';}catch(e){}
    h+=`<div class="struct-section"><div class="struct-title">ページ構成</div><div class="kv"><span class="kv-k">総ページ数</span><span class="kv-v hi">${f.pdfDoc.numPages}</span></div>`;
    for(let p=1;p<=Math.min(f.pdfDoc.numPages,6);p++){try{const pg=await f.pdfDoc.getPage(p);const vp=pg.getViewport({scale:1});h+=`<div class="kv"><span class="kv-k">Page ${p}</span><span class="kv-v">${Math.round(vp.width)}×${Math.round(vp.height)}pt rot:${pg.rotate}°</span></div>`;}catch(e){}}
    h+='</div>';
    if(f.text){const w=f.text.split(/\s+/).filter(Boolean).length;h+=`<div class="struct-section"><div class="struct-title">テキスト統計</div><div class="kv"><span class="kv-k">文字数</span><span class="kv-v hi">${f.text.length.toLocaleString()}</span></div><div class="kv"><span class="kv-k">単語数</span><span class="kv-v">${w.toLocaleString()}</span></div><div class="kv"><span class="kv-k">行数</span><span class="kv-v">${f.text.split('\n').length.toLocaleString()}</span></div></div>`;}
    try{const perms=await f.pdfDoc.getPermissions();if(perms!==null)h+=`<div class="struct-section"><div class="struct-title">パーミッション</div><div class="kv"><span class="kv-k">印刷</span><span class="kv-v">${perms&4?'許可':'不可'}</span></div><div class="kv"><span class="kv-k">コピー</span><span class="kv-v">${perms&16?'許可':'不可'}</span></div></div>`;}catch(e){}
  }else if(f.type==='dxf'&&f.parsed){
    const{entities,layers,layerCounts}=f.parsed;
    const counts={};entities.forEach(e=>{counts[e.type]=(counts[e.type]||0)+1;});
    h+=`<div class="struct-section"><div class="struct-title">エンティティ統計</div><div class="kv"><span class="kv-k">総数</span><span class="kv-v hi">${entities.length}</span></div>`;
    Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([t,n])=>h+=`<div class="kv"><span class="kv-k">${t}</span><span class="kv-v">${n}</span></div>`);
    h+=`</div><div class="struct-section"><div class="struct-title">レイヤー (${layers.length})</div>`;
    layers.forEach(l=>h+=`<div class="kv"><span class="kv-k" style="color:${S.layers[l]?S.layers[l].color:'#fff'}">${esc(l)}</span><span class="kv-v">${layerCounts[l]||0} エンティティ</span></div>`);
    h+='</div>';
    if(S.bounds)h+=`<div class="struct-section"><div class="struct-title">図面範囲</div><div class="kv"><span class="kv-k">幅</span><span class="kv-v hi">${(S.bounds.maxX-S.bounds.minX).toFixed(2)}</span></div><div class="kv"><span class="kv-k">高さ</span><span class="kv-v hi">${(S.bounds.maxY-S.bounds.minY).toFixed(2)}</span></div><div class="kv"><span class="kv-k">X範囲</span><span class="kv-v">${S.bounds.minX.toFixed(2)} ~ ${S.bounds.maxX.toFixed(2)}</span></div><div class="kv"><span class="kv-k">Y範囲</span><span class="kv-v">${S.bounds.minY.toFixed(2)} ~ ${S.bounds.maxY.toFixed(2)}</span></div></div>`;
  }else if(f.type==='image'&&f.img){
    h+=`<div class="struct-section"><div class="struct-title">画像情報</div><div class="kv"><span class="kv-k">幅</span><span class="kv-v hi">${f.img.width}px</span></div><div class="kv"><span class="kv-k">高さ</span><span class="kv-v hi">${f.img.height}px</span></div><div class="kv"><span class="kv-k">縦横比</span><span class="kv-v">${(f.img.width/f.img.height).toFixed(3)}</span></div></div>`;
  }
  h+='</div>';return h;
}

// ═══ LAYER PANEL BUILD ═══
function buildLayerPanel(){
  if(!S.f1||S.f1.type!=='dxf')return;
  const{layers,layerCounts}=S.f1.parsed;
  // Ensure all layers in S.layers
  layers.forEach(l=>getLayerColor(l));
  // Explode control
  let h=`<div class="explode-ctrl">
    <div class="explode-label">レイヤー分離 <span id="explodeVal">0%</span></div>
    <input type="range" class="explode-range" id="explodeRange" min="0" max="100" value="0" oninput="setExplode(this.value)">
  </div>
  <div class="sec-hdr"><div class="sec-dot"></div>レイヤー一覧 (${layers.length})</div>
  <div class="layer-list" id="layerListBody">`;
  layers.forEach(l=>{
    const info=S.layers[l]||{visible:true,color:'#00b4ff'};
    // Detect dominant semantic type for this layer
    const layerEnts2=(S.f1&&S.f1.parsed?S.f1.parsed.entities:[]).filter(e=>e.layer===l);
    const semFreq2={};layerEnts2.forEach(e=>{const s=e._sem||'other';semFreq2[s]=(semFreq2[s]||0)+1;});
    const domSem2=Object.entries(semFreq2).sort((a,b)=>b[1]-a[1])[0];
    const semLabel2=domSem2&&SEM[domSem2[0]]?`<span style="font-size:8px;padding:1px 4px;border:1px solid ${SEM[domSem2[0]].color};color:${SEM[domSem2[0]].color};margin-left:2px;font-family:var(--mono)">${SEM[domSem2[0]].label}</span>`:'';
    h+=`<div class="layer-row ${info.visible?'':'hidden'}" id="lr-${CSS.escape(l)}" onclick="toggleLayer('${l.replace(/'/g,"\\'")}')">
      <div class="layer-vis">${info.visible?'<svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1,5 4,8 9,2" fill="none" stroke="#00b4ff" stroke-width="2"/></svg>':''}</div>
      <div class="layer-color" style="background:${info.color}"></div>
      <div class="layer-name">${esc(l)}${semLabel2}</div>
      <div class="layer-count">${layerCounts[l]||0}</div>
    </div>`;
  });
  h+='</div>';
  document.getElementById('layerPanelContent').innerHTML=h;
}

function toggleLayer(name){
  if(!S.layers[name])S.layers[name]={visible:true,color:'#00b4ff',count:0};
  S.layers[name].visible=!S.layers[name].visible;
  buildLayerPanel();
  redrawDXF();
}

function setExplode(val){
  S.explode=val/100;
  document.getElementById('explodeVal').textContent=val+'%';
  redrawDXF();
}

// ═══ FILE LOADING ═══
function setupZone(n){
  const zone=document.getElementById(`zone${n}`);
  const inp=document.getElementById(`file${n}`);
  if(!zone||!inp){console.error(`[viewer] setupZone(${n}): zone or input not found`);return;}
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
  zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
  zone.addEventListener('drop',e=>{
    e.preventDefault(); e.stopPropagation();
    zone.classList.remove('drag-over');
    let f = e.dataTransfer.files[0];
    if(!f && e.dataTransfer.items && e.dataTransfer.items.length){
      const item = e.dataTransfer.items[0];
      if(item.kind==='file') f = item.getAsFile();
    }
    if(f) handleFile(n,f);
    else console.warn('DnD: ファイルを取得できませんでした');
  });
  inp.addEventListener('change',e=>{if(e.target.files[0])handleFile(n,e.target.files[0]);});
  // CLRボタンのclickをJSで登録（HTML onclickの代替）
  const clrBtn=document.getElementById(`clr${n}`);
  if(clrBtn) clrBtn.addEventListener('click',e=>{e.stopPropagation();clearFile(n,e);});
}

// ── body 全体でDnDを受け付ける（ゾーン外ドロップ対応）──
function setupBodyDrop(){
  document.body.addEventListener('dragover',e=>{
    e.preventDefault();
    // どのゾーンに向かわせるか判断
    const target = S.mode==='single'||!S.f1
      ? document.getElementById('zone1')
      : document.getElementById('zone2');
    if(target&&!target.classList.contains('disabled'))
      target.classList.add('drag-over');
  });
  document.body.addEventListener('dragleave',e=>{
    // body外に出た場合だけ消す
    if(!e.relatedTarget||!document.body.contains(e.relatedTarget)){
      document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));
    }
  });
  document.body.addEventListener('drop',e=>{
    e.preventDefault(); e.stopPropagation();
    document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));
    let f = e.dataTransfer.files[0];
    if(!f&&e.dataTransfer.items&&e.dataTransfer.items.length){
      const item=e.dataTransfer.items[0];
      if(item.kind==='file') f=item.getAsFile();
    }
    if(!f) return;
    // 読み込み先を決定
    const n = (!S.f1 || S.mode==='single') ? 1
      : (!S.f2 && S.mode==='diff') ? 2 : 1;
    handleFile(n, f);
  });
}

async function handleFile(n,file){
  showLoading(true,'ファイル読み込み中...');
  const name=file.name;
  let ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  // 拡張子不明の場合はMIMEタイプから推定
  if(!ext && file.type){
    const mimeMap={'image/png':'png','image/jpeg':'jpg','application/pdf':'pdf',
      'model/stl':'stl','model/obj':'obj'};
    ext = mimeMap[file.type] || '';
  }
  let obj={name,size:file.size};

  // 3D formats
  if(['stl','obj','ply','off','stp','step'].includes(ext)){
    S._loading3D=n;
    await load3DFile(file);
    return;
  }

  try{
    if(ext==='dwg'){
      showLoading(false);
      showToast('DWG: AutoCADで「名前を付けて保存→DXF形式」に変換してください','warn');
      return;
    }
    if(ext==='sldprt'||ext==='sldasm'||ext==='slddrw'){
      showLoading(false);
      showToast('SLDPRT: SolidWorksで「名前を付けて保存→STEP形式」に変換してください','warn');
      return;
    } else if(ext==='dxf'){
      const text=await readDXFText(file);
      const parsed=parseDXF(text);
      obj={...obj,type:'dxf',parsed,text};
      // Init layer colors (ACI色を使用)
      parsed.layers.forEach(l=>{
        const aci = parsed.aciMap?.[l];
        const aciHex = aci ? aciToHex(aci) : null;
        getLayerColor(l, aciHex);
      });
      updateZoneUI(n,name,`${parsed.entities.length} ${t('entCount')} / ${parsed.layers.length} ${t('layerCount')}`,'dxf');
    }else if(ext==='pdf'){
      const ab=await readArrayBuffer(file);
      showLoading(true,'PDF解析中...');
      const pdfDoc=await pdfjsLib.getDocument({data:ab}).promise;
      obj={...obj,type:'pdf',pdfDoc,numPages:pdfDoc.numPages};
      showLoading(true,'テキスト抽出中...');
      obj.text=await extractPDFText(pdfDoc);
      updateZoneUI(n,name,`${pdfDoc.numPages}ページ / ${obj.text.length.toLocaleString()}文字`,'pdf');
    }else if(['igs','iges'].includes(ext)){
      showLoading(true,'IGES解析中...');
      const text=await readDXFText(file);
      const parsed=parseIGES(text);
      obj={...obj,type:'dxf',parsed,text};
      parsed.layers.forEach(l=>getLayerColor(l));
      updateZoneUI(n,name,`IGES: ${parsed.entities.length} エンティティ / ${parsed.layers.length} レイヤー`,'dxf');
    }else{
      const dataURL=await readDataURL(file);
      const img=await loadImg(dataURL);
      obj={...obj,type:'image',img,dataURL,text:''};
      updateZoneUI(n,name,`${img.width}×${img.height}px`,'img');
    }
    S[`f${n}`]=obj;
    if(n===1&&S.mode==='diff'){
      document.getElementById('zone2').classList.remove('disabled');
      document.getElementById('file2').disabled=false;
      document.getElementById('hint2').innerHTML='ここにドロップ<small>DXF / PDF / IGES / STL / OBJ / PLY / OFF / STEP / 画像</small>';
    }
    if(S.mode==='single'||((n===2)&&S.f1)||(n===1&&S.f2))await runMain();
    else{await updateStructPanel(n,obj);showLoading(false);}
  }catch(e){console.error('Load error:',e);showLoading(false);}
}

function updateZoneUI(n,name,meta,typeKey){
  const zone=document.getElementById(`zone${n}`);
  zone.classList.add('loaded');
  document.getElementById(`hint${n}`).style.display='none';
  const nm=document.getElementById(`name${n}`);nm.style.display='block';nm.textContent=name;
  document.getElementById(`meta${n}`).textContent=meta;
  const bg=document.getElementById(`badge${n}`);bg.style.display='inline';bg.className=`dz-badge type-${typeKey}`;bg.textContent=typeKey.toUpperCase();
  document.getElementById(`clr${n}`).classList.add('vis');
  // ファイルロード時はドロップエリアを必ず表示
  const dr=document.getElementById('dropRow');
  if(dr) dr.classList.remove('dz-collapsed');
  const hdr=document.querySelector('header');
  if(hdr) hdr.classList.remove('collapsed');
  const ob=document.getElementById('hdrOpenBtn');
  if(ob) ob.style.display='none';
  const cb=document.getElementById('hdrCloseBtn');
  if(cb) cb.style.display='';
}

function clearFile(n,event){
  event.stopPropagation();
  S[`f${n}`]=null;
  if(n===1){S.f2=null;clearZoneUI(2);}
  clearZoneUI(n);
  if(n===1&&S.mode==='diff'){
    document.getElementById('zone2').classList.add('disabled');
    document.getElementById('file2').disabled=true;
    document.getElementById('hint2').innerHTML='FILE 1 を先に読み込んでください<small>DXF / PDF / IGES / STL / OBJ / PLY / OFF / STEP / 画像</small>';
  }
  S.diff=null;S.pixelDiff=null;S.singleCanvas=null;S.bounds=null;S.selectedEnt=null;S.selectedChain=new Set();
  S.layers={};S.allItems=[];
  // キャンバスをクリアしてビジュアルタブに戻す
  resetCanvas();resetStats();
  renderEntList([]);
  // 3Dシーンのメッシュを削除
  if(typeof T3!=='undefined'&&T3.scene){
    ['mesh','edges','wireframe','semMesh'].forEach(k=>{if(T3[k]){T3.scene.remove(T3[k]);T3[k]=null;}});
    T3.loaded=false;
    if(T3.renderer) T3.renderer.clear();
  }
  switchTab('visual');
  document.getElementById('emptyMsg').style.display='';
  document.getElementById('info1Body').innerHTML='<div class="no-data">'+t('noFile')+'</div>';
  document.getElementById('info2Body').innerHTML='<div class="no-data">'+t('useDiff')+'</div>';
  document.getElementById('layerPanelContent').innerHTML='<div class="no-data">'+t('loadDxf')+'</div>';
  // 右パネル（詳細・統計・凡例）をリセット
  const ib=document.getElementById('inspBody');
  if(ib){ib.style.display='none';ib.innerHTML='';}
  const ie=document.getElementById('inspEmpty');
  if(ie)ie.style.display='';
  document.getElementById('semLegendBody').innerHTML='<div class="no-data">'+t('loadDxf')+'</div>';
  // サイドタブを「一覧」に戻す
  setSideTab('list');
  // 差分凡例を非表示
  document.getElementById('diffLegend').style.display='none';
  // ページナビを非表示
  const pn=document.getElementById('pageNavInline');
  if(pn)pn.style.display='none';
  // emptyMsgを表示
  document.getElementById('emptyMsg').style.display='';
}

function clearZoneUI(n){
  document.getElementById(`file${n}`).value='';
  document.getElementById(`zone${n}`).classList.remove('loaded');
  document.getElementById(`hint${n}`).style.display='';
  document.getElementById(`name${n}`).style.display='none';
  document.getElementById(`meta${n}`).textContent='';
  document.getElementById(`badge${n}`).style.display='none';
  document.getElementById(`clr${n}`).classList.remove('vis');
}

// ═══ MAIN RUNNER ═══
async function runMain(){
  document.getElementById('emptyMsg').style.display='none';
  const tol=parseFloat(document.getElementById('tolerance').value)||0.01;

  if(S.mode==='single'&&S.f1){
    await runSingle();
  }else if(S.mode==='diff'&&S.f1&&S.f2){
    await runDiff(tol);
  }

  await updateStructPanel(1,S.f1);
  if(S.f2)await updateStructPanel(2,S.f2);
  showLoading(false);
}

async function runSingle(){
  const f=S.f1;
  if(f.type==='dxf'){
    S.bounds=computeBounds([f.parsed.entities]);
    S.diff=null;S.pixelDiff=null;S.singleCanvas=null;
    // エンティティ境界ボックスをキャッシュ（ビューポートカリング用）
    // 一度計算すれば redrawDXF の度に再計算する必要がない
    if(!f._boundsCached){
      for(const e of f.parsed.entities){ if(!e._b) e._b = entBounds(e); }
      f._boundsCached=true;
    }
    // Semantic analysis
    // analyzeSemantics はエンティティ変化時のみ実行（重い処理）
    if(!f._semCounts){
      // パフォーマンス: 最大20,000件でサンプリング分析
      const MAX_SEM=20000;
      const semEnts=f.parsed.entities.length>MAX_SEM
        ? f.parsed.entities.filter((_,i)=>i%Math.ceil(f.parsed.entities.length/MAX_SEM)===0)
        : f.parsed.entities;
      f._semCounts=analyzeSemantics(semEnts);
      // 残りにも分類を適用（semEnts分析結果を全エンティティに適用）
      if(f.parsed.entities.length>MAX_SEM){
        f.parsed.entities.forEach(e=>{if(!e._sem) e._sem='other';});
      }
    }
    buildSemLegend(f._semCounts);
    const items=f.parsed.entities.map(e=>({e,t:'single'}));
    S.allItems=items;
    updateStats(f.parsed.entities.length,t('entCount'),f.parsed.layers.length,t('layerCount'),null,null);
    renderEntList(items);
    buildLayerPanel();
    // キャンバスサイズ確定後にフィット（2 回の rAF でレイアウト確定を待つ ≒ 32ms）
    requestAnimationFrame(()=>requestAnimationFrame(()=>{ fitView(); redrawDXF(); }));
  }else if(f.type==='pdf'){
    showLoading(true,'ページ描画中...');
    S.singleCanvas=await renderPDFPage(f.pdfDoc,S.page+1,1.5);
    S.pixelDiff=null;
    updatePageNav(f.numPages);
    updateStats(f.numPages,t('pageCount'),f.text.length,t('charCount'),null,null);
    renderEntList([]);
    fitView();
  }else if(f.type==='image'){
    const c=document.createElement('canvas');c.width=f.img.width;c.height=f.img.height;
    c.getContext('2d').drawImage(f.img,0,0);
    S.singleCanvas=c;S.pixelDiff=null;
    updateStats(f.img.width,t('px_w'),f.img.height,t('px_h'),null,null);
    renderEntList([]);
    fitView();
  }
}

async function runDiff(tol){
  const f1=S.f1,f2=S.f2;
  if(f1.type==='dxf'&&f2.type==='dxf'){
    showLoading(true,'差分計算中...');
    const diff=diffDXF(f1.parsed.entities,f2.parsed.entities,tol);
    S.diff=diff;S.pixelDiff=null;S.singleCanvas=null;
    S.bounds=computeBounds([diff.same,diff.added,diff.removed]);
    updateStats(diff.added.length,t('added'),diff.removed.length,t('removed'),diff.same.length,t('same'));
    const items=[...diff.added.map(e=>({e,t:'add'})),...diff.removed.map(e=>({e,t:'del'})),...diff.same.map(e=>({e,t:'same'}))];
    S.allItems=items;
    renderEntList(items);
    fitView();
  }else{
    showLoading(true,'画像描画中...');
    const scale=1.5;
    let c1,c2;
    if(f1.type==='pdf')c1=await renderPDFPage(f1.pdfDoc,S.page+1,scale);
    else{c1=document.createElement('canvas');c1.width=f1.img.width;c1.height=f1.img.height;c1.getContext('2d').drawImage(f1.img,0,0);}
    if(f2.type==='pdf')c2=await renderPDFPage(f2.pdfDoc,S.page+1,scale);
    else{c2=document.createElement('canvas');c2.width=f2.img.width;c2.height=f2.img.height;c2.getContext('2d').drawImage(f2.img,0,0);}
    showLoading(true,'ピクセル差分計算中...');
    S.pixelDiff=await buildPixelDiff(c1,c2);S.singleCanvas=null;S.diff=null;
    updateStats(S.pixelDiff.addPx,'追加px',S.pixelDiff.delPx,'削除px',S.pixelDiff.samePx,'同一px');
    const maxP=Math.max(f1.numPages||1,f2.numPages||1);
    updatePageNav(maxP>1?maxP:0);
    renderEntList([]);
    renderTextDiff();
    fitView();
  }
}

async function updateStructPanel(n,f){
  const html=await buildStructHTML(f);
  document.getElementById(`info${n}Body`).innerHTML=html;
}

function rerun(){if(S.f1)runMain();}
async function changePage(d){
  const max=Math.max(S.f1?.numPages||1,S.f2?.numPages||1);
  S.page=Math.max(0,Math.min(max-1,S.page+d));
  await runMain();
}

// ═══ UI HELPERS ═══
function updateStats(v1,l1,v2,l2,v3,l3){
  document.getElementById('sAdd').textContent=typeof v1==='number'?v1.toLocaleString():(v1||'—');
  document.getElementById('sDel').textContent=typeof v2==='number'?v2.toLocaleString():(v2||'—');
  document.getElementById('sSame').textContent=v3!==null&&v3!==undefined?v3.toLocaleString():'—';
  document.getElementById('sAddL').textContent=l1||'';
  document.getElementById('sDelL').textContent=l2||'';
  document.getElementById('sSameL').textContent=l3||t('common');
}

function resetStats(){['sAdd','sDel','sSame'].forEach(id=>document.getElementById(id).textContent='—');}

function updatePageNav(numPages){
  const nav=document.getElementById('pageNavInline');
  if(numPages>1){
    nav.style.display='flex';
    document.getElementById('pageLabel').textContent=`${S.page+1}/${numPages}`;
    document.getElementById('prevPage').disabled=S.page===0;
    document.getElementById('nextPage').disabled=S.page>=numPages-1;
  }else nav.style.display='none';
}

function resetCanvas(){
  const cv=document.getElementById('mainCanvas');
  const ctx=cv.getContext('2d');
  ctx.clearRect(0,0,cv.width,cv.height);
}


function showToast(msg,type='info'){
  let tc=document.getElementById('toastContainer');
  if(!tc){tc=document.createElement('div');tc.id='toastContainer';
    tc.style.cssText='position:fixed;bottom:32px;left:50%;transform:translateX(-50%);z-index:9000;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;';
    document.body.appendChild(tc);}
  const toast=document.createElement('div');
  const colors={info:'rgba(0,180,255,0.95)',warn:'rgba(255,192,64,0.95)',error:'rgba(255,61,90,0.95)',ok:'rgba(0,232,122,0.95)'};
  toast.style.cssText=`background:${colors[type]||colors.info};color:#000;font-family:monospace;font-size:12px;padding:10px 20px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.5);opacity:0;transition:opacity .3s;max-width:90vw;text-align:center;pointer-events:none;`;
  toast.textContent=msg;tc.appendChild(toast);
  requestAnimationFrame(()=>{toast.style.opacity='1';});
  setTimeout(()=>{toast.style.opacity='0';setTimeout(()=>toast.remove(),300);},4000);
}
function showLoading(show,txt=''){
  const overlay=document.getElementById('loadingOverlay');
  overlay.classList.toggle('show',show);
  if(txt) document.getElementById('loadingTxt').textContent=txt;
  // ヘッダーボタンも無効化してダブルクリック防止
  document.querySelectorAll('.h-btn,.tab-btn,.v3d-btn').forEach(btn=>{
    btn.style.pointerEvents = show ? 'none' : '';
    btn.style.opacity = show ? '0.4' : '';
  });
}

function toggleLeg(l){
  S.visLayers[l]=!S.visLayers[l];
  document.getElementById(`leg-${l}`).classList.toggle('muted',!S.visLayers[l]);
  redrawDXF();
}

// Entity filter
function setEF(k){
  S.efState=S.efState||{add:true,del:true,same:true};
  S.efState[k]=!S.efState[k];
  document.querySelector(`[data-ef="${k}"]`).classList.toggle('active',S.efState[k]);
  filterEntList();
}

// ═══ ENTITY LIST ═══
function renderEntList(items){
  const container=document.getElementById('entListBody');
  if(!container)return;
  // 最大500件表示（パフォーマンス改善）
  const MAX=500;
  const visible=items.slice(0,MAX);
  let h=visible.map((item,i)=>{
    const e=item.e||item,t=item.t||'single';
    const sem=e._sem||'other';
    const semI=SEM[sem]||SEM.other;
    const col=t==='add'?'var(--add)':t==='del'?'var(--del)':t==='same'?'var(--dim)':semI.color;
    const label=e.type==='TEXT'?esc(e.text.slice(0,24)):e.type==='LINE'?`L:${Math.hypot(e.x2-e.x1,e.y2-e.y1).toFixed(1)}`:e.type==='CIRCLE'?`⌀${(e.r*2).toFixed(2)}`:e.type;
    return `<div class="ent-row" data-idx="${i}" style="border-left:2px solid ${col}">${label}<span style="color:var(--dim);font-size:9px;margin-left:4px">${e.layer}</span></div>`;
  }).join('');
  if(items.length>MAX) h+=`<div style="padding:6px;color:var(--dim);font-size:10px;text-align:center">他 ${(items.length-MAX).toLocaleString()} 件</div>`;
  container.innerHTML=h;
  container.querySelectorAll('.ent-row').forEach(row=>{
    row.addEventListener('click',()=>selectEnt(parseInt(row.dataset.idx),items));
  });
}

function filterEntList(){
  const ef=S.efState||{add:true,del:true,same:true};
  const body=document.getElementById('entListBody');
  let filtered;
  if(S.mode==='single'){
    filtered=S.allItems;
  }else{
    filtered=S.allItems.filter(i=>{
      if(i.t==='add')return ef.add;
      if(i.t==='del')return ef.del;
      return ef.same;
    });
  }
  if(!filtered.length){body.innerHTML=`<div class="no-data">${S.allItems.length?'一致なし':'ファイルを読み込んでください'}</div>`;return;}
  const show=filtered.slice(0,300);
  body.innerHTML=show.map(({e,t},idx)=>{
    const label=t==='add'?'追加':t==='del'?'削除':t==='single'?e.type:'共通';
    const bc=t==='add'?'ba':t==='del'?'bd':'bs';
    const detail=entDetail(e);
    const selected=e===S.selectedEnt?'selected':'';
    const typeDisplay=t==='single'?'':e.type;
    const sem=e._sem||'other';
    const semI=SEM[sem]||SEM.other;
    const semDot=`<span style="display:inline-block;width:7px;height:7px;background:${semI.color};border-radius:50%;flex-shrink:0;box-shadow:0 0 4px ${semI.color}66"></span>`;
    return`<div class="ent-item ${selected}" onclick="selectEnt(${idx})" data-idx="${idx}">
      <span class="ent-badge ${bc}">${label}</span>
      ${semDot}
      <span style="font-size:11px">${t==='single'?e.type:typeDisplay}</span>
      <span class="ent-detail">${detail}</span>
      <span class="ent-lyr">${esc(e.layer)}</span>
    </div>`;
  }).join('')+(filtered.length>300?`<div class="no-data">他 ${filtered.length-300} 件</div>`:'');
}

function selectEnt(listIdx){
  const filtered=S.mode==='single'?S.allItems:S.allItems.filter(i=>{const ef=S.efState||{add:true,del:true,same:true};if(i.t==='add')return ef.add;if(i.t==='del')return ef.del;return ef.same;});
  const item=filtered[listIdx];
  if(!item)return;
  S.selectedEnt=item.e;
  S.selectedChain=buildChain(item.e);
  showInspector(item.e,item.t);
  filterEntList();
  if(S.f1&&S.f1.type==='dxf')redrawDXF();
}


// ── 近傍テキスト検索 ──
function findNearbyTexts(e, maxDist) {
  const allEnts = S.f1 && S.f1.parsed ? S.f1.parsed.entities : [];
  const textEnts = allEnts.filter(t => (t.type==='TEXT'||t.type==='MTEXT') && t.text && t.text.trim());
  if(!textEnts.length) return [];

  let ex=0,ey=0,entSize=1,isLine=false,lx1=0,ly1=0,lx2=0,ly2=0;

  switch(e.type){
    case 'LINE':
      lx1=e.x1;ly1=e.y1;lx2=e.x2;ly2=e.y2;
      ex=(lx1+lx2)/2;ey=(ly1+ly2)/2;
      entSize=Math.hypot(lx2-lx1,ly2-ly1)||1;
      isLine=true; break;
    case 'CIRCLE':case 'ARC': ex=e.cx;ey=e.cy;entSize=e.r*2;break;
    case 'TEXT':case 'MTEXT': ex=e.x;ey=e.y;break;
    case 'POINT': ex=e.x;ey=e.y;break;
    default: return [];
  }

  if(isLine){
    const avgH=textEnts.length
      ? textEnts.reduce((s,t)=>s+(t.h||5),0)/textEnts.length : 5;
    const circleEnts=allEnts.filter(c=>c.type==='CIRCLE'&&c.r>=5&&c.r<=200);
    const bW = S.bounds ? S.bounds.maxX-S.bounds.minX : 10000;
    const TOL = Math.max(bW*0.0005, 0.5);

    let endPtsToSearch=[];

    if(e._sem==='hatch'){
      // ハッチング線: チェーン追跡なし。2端点のみ、広めの半径
      endPtsToSearch=[[lx1,ly1],[lx2,ly2]];
      const searchR2=maxDist||Math.max(avgH*6,100);
      const results2=[]; const seen2=new Set();
      for(const [px,py] of endPtsToSearch){
        for(const circ of circleEnts){
          const dc=Math.hypot(px-circ.cx,py-circ.cy);
          if(Math.abs(dc-circ.r)<circ.r*0.85){
            for(const t of textEnts){
              if(Math.hypot(t.x-circ.cx,t.y-circ.cy)<circ.r*1.5&&!seen2.has(t.text)){
                seen2.add(t.text); results2.push({text:t.text.trim(),dist:Math.hypot(t.x-px,t.y-py),layer:t.layer});
              }
            }
          }
        }
        for(const t of textEnts){
          const d=Math.hypot(t.x-px,t.y-py);
          if(d<=searchR2&&!seen2.has(t.text)){
            seen2.add(t.text); results2.push({text:t.text.trim(),dist:d,layer:t.layer});
          }
        }
      }
      return results2.sort((a,b)=>a.dist-b.dist).slice(0,8);
    }

    // 通常の引出し線: チェーン追跡(max3ホップ, 6本以内)
    const layerLines=allEnts.filter(l=>l.type==='LINE'&&l.layer===e.layer);
    const chainSet=new Set([e]);
    let frontier=[e];
    for(let hop=0;hop<3;hop++){
      const next=[];
      for(const cur of frontier){
        for(const l of layerLines){
          if(chainSet.has(l)) continue;
          if(Math.hypot(cur.x1-l.x1,cur.y1-l.y1)<=TOL||
             Math.hypot(cur.x1-l.x2,cur.y1-l.y2)<=TOL||
             Math.hypot(cur.x2-l.x1,cur.y2-l.y1)<=TOL||
             Math.hypot(cur.x2-l.x2,cur.y2-l.y2)<=TOL){
            chainSet.add(l); next.push(l);
          }
        }
      }
      if(chainSet.size>6) break;
      frontier=next;
      if(!next.length) break;
    }

    // 全端点収集 + avgH*4 で検索
    const searchR=maxDist||Math.max(avgH*4,60);
    const allPts=new Map();
    for(const l of chainSet){
      for(const [px,py] of [[l.x1,l.y1],[l.x2,l.y2]]){
        allPts.set(`${Math.round(px)},${Math.round(py)}`,[px,py]);
      }
    }
    // 選択線自体の中点も検索ポイントに追加
    const mx=(e.x1+e.x2)/2, my=(e.y1+e.y2)/2;
    allPts.set('_mid_', [mx, my]);

    const results=[]; const seen=new Set();
    for(const [px,py] of allPts.values()){
      for(const circ of circleEnts){
        const dc=Math.hypot(px-circ.cx,py-circ.cy);
        // 検索点から searchR 以内にある円、またはその円周上に検索点がある場合
        if(dc<=searchR||Math.abs(dc-circ.r)<circ.r*0.85){
          for(const t of textEnts){
            // 円の中心から半径1.5倍以内のテキストをバルーン番号として取得
            if(Math.hypot(t.x-circ.cx,t.y-circ.cy)<circ.r*1.5&&!seen.has(t.text)){
              seen.add(t.text);
              results.push({text:t.text.trim(),dist:Math.hypot(t.x-px,t.y-py),layer:t.layer});
            }
          }
        }
      }
      for(const t of textEnts){
        const d=Math.hypot(t.x-px,t.y-py);
        if(d<=searchR&&!seen.has(t.text)){
          seen.add(t.text); results.push({text:t.text.trim(),dist:d,layer:t.layer});
        }
      }
    }
    return results.sort((a,b)=>a.dist-b.dist).slice(0,10);
  }

  const searchDist=maxDist||Math.max(entSize*3,80);
  return textEnts
    .map(t=>({t,dist:Math.hypot(t.x-ex,t.y-ey)}))
    .filter(x=>x.dist<=searchDist)
    .sort((a,b)=>a.dist-b.dist)
    .slice(0,10)
    .map(x=>({text:x.t.text.trim(),dist:x.dist,layer:x.t.layer}));
}


// ── 同レイヤーのテキストを優先して取得 ──
function findAssociatedTexts(e) {
  const allEnts = S.f1 && S.f1.parsed ? S.f1.parsed.entities : [];

  // 1. 同じレイヤーのテキストから近いもの
  const sameLayerTexts = allEnts.filter(t =>
    (t.type==='TEXT'||t.type==='MTEXT') && t.text && t.text.trim() && t.layer===e.layer
  );

  // 2. 全テキストから近いもの（距離ベース）
  const nearby = findNearbyTexts(e, null);

  // 重複排除してマージ
  const seen = new Set();
  const result = [];
  for(const item of nearby){
    const key = item.text;
    if(!seen.has(key)){ seen.add(key); result.push(item); }
    if(result.length >= 12) break;
  }
  return result;
}

function showInspector(e,t){
  setSideTab('inspect');
  document.getElementById('inspEmpty').style.display='none';
  const ib=document.getElementById('inspBody');ib.style.display='block';
  const f=n=>(Math.round(n*10000)/10000).toString();
  const semType=e._sem||'other';
  const semInfo=SEM[semType]||SEM.other;
  let h=`<div class="insp-type" style="border-bottom:2px solid ${semInfo.color}">${e.type} <span style="font-size:10px;color:${semInfo.color};margin-left:6px">${semInfo.label}</span></div>`;
  h+=`<div class="insp-kv"><span class="insp-k">レイヤー</span><span class="insp-v hi">${esc(e.layer)}</span></div>`;
  h+=`<div class="insp-kv"><span class="insp-k">意味分類</span><span class="insp-v" style="color:${semInfo.color}">${semInfo.label} [${semInfo.tag}]</span></div>`;
  if(t&&t!=='single')h+=`<div class="insp-kv"><span class="insp-k">差分</span><span class="insp-v" style="color:${t==='add'?'var(--add)':t==='del'?'var(--del)':'var(--dim)'}">${t==='add'?'追加':t==='del'?'削除':'共通'}</span></div>`;
  switch(e.type){
    case'LINE':
      h+=`<div class="insp-kv"><span class="insp-k">長さ</span><span class="insp-v" style="color:var(--accent2)">${f(Math.hypot(e.x2-e.x1,e.y2-e.y1))}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">角度</span><span class="insp-v">${f(Math.atan2(e.y2-e.y1,e.x2-e.x1)*180/Math.PI)}°</span></div>`;
      break;
    case'CIRCLE':
      h+=`<div class="insp-kv"><span class="insp-k">中心 X</span><span class="insp-v hi">${f(e.cx)}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">中心 Y</span><span class="insp-v hi">${f(e.cy)}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">半径</span><span class="insp-v hi">${f(e.r)}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">直径</span><span class="insp-v" style="color:var(--accent2)">${f(e.r*2)}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">周長</span><span class="insp-v">${f(e.r*2*Math.PI)}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">面積</span><span class="insp-v">${f(Math.PI*e.r*e.r)}</span></div>`;
      break;
    case'ARC':
      h+=`<div class="insp-kv"><span class="insp-k">中心 X</span><span class="insp-v hi">${f(e.cx)}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">中心 Y</span><span class="insp-v hi">${f(e.cy)}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">半径</span><span class="insp-v hi">${f(e.r)}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">開始角度</span><span class="insp-v">${f(e.sa)}°</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">終了角度</span><span class="insp-v">${f(e.ea)}°</span></div>`;
      break;
    case'LWPOLYLINE':
      h+=`<div class="insp-kv"><span class="insp-k">頂点数</span><span class="insp-v hi">${e.pts.length}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">閉合</span><span class="insp-v">${e.closed?'はい':'いいえ'}</span></div>`;
      e.pts.slice(0,8).forEach((p,i)=>h+=`<div class="insp-kv"><span class="insp-k">頂点${i+1}</span><span class="insp-v">(${f(p.x)}, ${f(p.y)})</span></div>`);
      if(e.pts.length>8)h+=`<div class="insp-kv"><span class="insp-k">...</span><span class="insp-v">他${e.pts.length-8}頂点</span></div>`;
      break;
    case'TEXT':case'MTEXT':
      h+=`<div class="insp-kv"><span class="insp-k">位置 X</span><span class="insp-v hi">${f(e.x)}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">位置 Y</span><span class="insp-v hi">${f(e.y)}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">文字高さ</span><span class="insp-v">${f(e.h)}</span></div>`;
      h+=`<div class="insp-kv"><span class="insp-k">内容</span><span class="insp-v" style="color:var(--accent2)">${esc(e.text)}</span></div>`;
      break;
  }
  // ── 近傍テキスト（関連情報）──
  const assocTexts = findAssociatedTexts(e);
  if(assocTexts.length > 0){
    h += `<div class="insp-kv" style="margin-top:8px;border-top:1px solid var(--border2);padding-top:6px">
      <span class="insp-k" style="color:var(--accent2)">関連テキスト</span>
    </div>`;
    assocTexts.forEach((item,i) => {
      const distStr = item.dist < 0.1 ? '同位置' : `${Math.round(item.dist)} 単位`;
      h += `<div class="assoc-item" data-copy="${esc(item.text)}" style="padding:4px 0 4px 4px;border-bottom:1px solid rgba(0,180,255,.06);cursor:pointer;overflow:hidden;">
        <div style="font-size:11px;color:var(--text);font-family:var(--sans);line-height:1.4;word-break:break-word;">${esc(item.text)}</div>
        <div style="font-size:9px;color:var(--dim);font-family:var(--mono);margin-top:2px;">
          ↔ ${distStr} &nbsp;|&nbsp; ${esc(item.layer)}
        </div>
      </div>`;
    });
    h += `<div style="font-size:9px;color:var(--dim);font-family:var(--mono);padding:4px 0;text-align:right">クリックでコピー</div>`;
  }

  ib.innerHTML=h;
}

// ═══ TAB SWITCHING ═══
function switchTab(tab){
  S.tab=tab;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  const textView=document.getElementById('textDiffView');
  const view3d=document.getElementById('view3d');
  const cv=document.getElementById('mainCanvas');
  const empty=document.getElementById('emptyMsg');
  textView.style.display=tab==='text'?'flex':'none';
  view3d.style.display=tab==='3d'?'flex':'none';
  if(tab==='3d'){
    setTimeout(()=>{if(T3&&T3.renderer){resize3D();render3D();}},60);
  }
  // Show/hide diff legend
  const isDXFDiff=S.mode==='diff'&&S.f1&&S.f1.type==='dxf';
  document.getElementById('diffLegend').style.display=isDXFDiff?'flex':'none';
  document.getElementById('tolWrap').style.display=S.mode==='diff'?'flex':'none';

  if(tab==='text'){if(S.f1)renderTextDiff();}
  else if(tab==='layers'){
    buildLayerPanel();
    if(S.f1&&S.f1.type==='dxf'){redrawDXF();}
  }else if(tab==='visual'){
    if(S.diff)redrawDXF();else if(S.pixelDiff||S.singleCanvas)redrawPDF();
  }else if(tab==='struct'){
    // struct is in side panel
  }
}

function setSideTab(t){
  S.sideTab=t;
  document.querySelectorAll('.side-tab').forEach(b=>b.classList.toggle('active',b.dataset.st===t));
  ['list','semleg','inspect','info1','info2'].forEach(id=>{
    document.getElementById(`st-${id}`).style.display=id===t?'':'none';
  });
}

// ═══ MODE SWITCH ═══
function setMode(mode){
  S.mode=mode;
  document.getElementById('modeBtn1').classList.toggle('active',mode==='single');
  document.getElementById('modeBtn2').classList.toggle('active',mode==='diff');
  const dropRow=document.getElementById('dropRow');
  const zone2=document.getElementById('zone2');
  const dzDiv=document.getElementById('dzDiv');
  if(mode==='single'){
    dropRow.className='drop-row mode-single';
    zone2.style.display='none';dzDiv.style.display='none';
    document.getElementById('dzLabel1').textContent=t('drawingFile');
    document.getElementById('diffLegend').style.display='none';
    document.getElementById('tolWrap').style.display='none';
    document.getElementById('stInfo2').style.display='none';
    document.getElementById('tabLayers').style.display='';
    // Show ent filter in list
    document.getElementById('entFilter').style.display='none';
  }else{
    dropRow.className='drop-row mode-diff';
    zone2.style.display='';dzDiv.style.display='';
    document.getElementById('dzLabel1').textContent=t('baseFile');
    document.getElementById('stInfo2').style.display='';
    document.getElementById('tabLayers').style.display='';
    document.getElementById('entFilter').style.display='flex';
    if(S.f1){
      document.getElementById('zone2').classList.remove('disabled');
      document.getElementById('file2').disabled=false;
    }
    document.getElementById('diffLegend').style.display=S.f1&&S.f1.type==='dxf'?'flex':'none';
    document.getElementById('tolWrap').style.display='flex';
  }
  // Re-run if files loaded
  S.page=0;
  if(S.f1)runMain();
  else{resetCanvas();resetStats();document.getElementById('emptyMsg').style.display='';}
}

// ═══ CANVAS INTERACTION ═══
const cw=document.getElementById('canvasWrap');
cw.addEventListener('mousedown',e=>{S.dragging=true;S.lastMouse={x:e.clientX,y:e.clientY};});
window.addEventListener('mousemove',e=>{
  if(S.tab==='3d')return;
  // ゴーストドラッグ防止: 左ボタンが実際に離れていたらリセット
  if(S.dragging&&!(e.buttons&1)){S.dragging=false;return;}
  if(S.dragging){
    S.pan.x+=e.clientX-S.lastMouse.x;S.pan.y-=(e.clientY-S.lastMouse.y);
    S.lastMouse={x:e.clientX,y:e.clientY};
    if(S.f1&&S.f1.type==='dxf')redrawDXFRaf();else redrawPDF();
  }
  // ホバーツールチップは廃止（クリック時のみ表示）
});
window.addEventListener('mouseup',e=>{
  if(S.tab==='3d'){if(typeof T3!=='undefined'&&T3.mouse)T3.mouse.down=false;return;}
  if(!S.dragging||Math.abs(e.clientX-(S.lastMouse?.x||0))<3){
    // Click
    if(S.f1&&S.f1.type==='dxf'){
      const rect=cw.getBoundingClientRect();
      const mx=e.clientX-rect.left,my=e.clientY-rect.top;
      const hit=hitTest(mx,my);
      if(hit){
        S.selectedEnt=hit;
        S.selectedChain=buildChain(hit);
        // Find in list
        const all=S.mode==='single'?S.allItems:S.allItems.filter(i=>{const ef=S.efState||{add:true,del:true,same:true};return i.t==='add'?ef.add:i.t==='del'?ef.del:ef.same;});
        const idx=all.findIndex(i=>i.e===hit);
        showInspector(hit,idx>=0?all[idx].t:null);
        filterEntList();
        redrawDXF();
        setSideTab('inspect');
        // LINE以外のみツールチップを1秒表示
        if(hit.type!=='LINE'){
          const tt=document.getElementById('tooltip');
          tt.style.display='block';
          tt.style.left=(e.clientX+12)+'px';
          tt.style.top=(e.clientY-20)+'px';
          document.getElementById('ttType').textContent=hit.type;
          const ttDetail=entDetail(hit)+' | '+hit.layer;
          document.getElementById('ttBody').textContent=ttDetail;
          setTimeout(()=>{tt.style.display='none';},1000);
        }
      }
    }
  }
  S.dragging=false;
});
cw.addEventListener('wheel',e=>{
  e.preventDefault();
  const f=e.deltaY<0?1.12:0.89;
  const rect=cw.getBoundingClientRect();
  const mx=e.clientX-rect.left,my=e.clientY-rect.top;
  S.pan.x=mx+(S.pan.x-mx)*f;S.pan.y=my+(S.pan.y-my)*f;
  S.scale*=f;
  if(S.f1&&S.f1.type==='dxf')redrawDXFRaf();else redrawPDF();
},{passive:false});
cw.addEventListener('mouseleave',()=>document.getElementById('tooltip').style.display='none');

// ═══ UTILS ═══
function entDetail(e){
  const f=n=>(Math.round(n*100)/100).toString();
  switch(e.type){
    case'LINE':return`(${f(e.x1)},${f(e.y1)})→(${f(e.x2)},${f(e.y2)}) L=${f(Math.hypot(e.x2-e.x1,e.y2-e.y1))}`;
    case'CIRCLE':return`c=(${f(e.cx)},${f(e.cy)}) r=${f(e.r)}`;
    case'ARC':return`c=(${f(e.cx)},${f(e.cy)}) r=${f(e.r)} ${f(e.sa)}°→${f(e.ea)}°`;
    case'LWPOLYLINE':return`${e.pts.length}点${e.closed?' 閉':''}`;
    case'TEXT':case'MTEXT':return`"${esc(e.text.slice(0,20))}"`;
    default:return'';
  }
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function formatBytes(n){if(n<1024)return n+'B';if(n<1048576)return(n/1024).toFixed(1)+'KB';return(n/1048576).toFixed(2)+'MB';}

// ── 自動エンコード判定 DXF テキスト読み込み ──
function readDXFText(file){
  return new Promise((resolve, reject)=>{
    const rd=new FileReader();
    rd.onerror=reject;
    rd.onload=e=>{
      const buf=e.target.result;
      const bytes=new Uint8Array(buf);
      // User-forced encoding
      const forced=(document.getElementById('encSelect')?.value||'auto');
      if(forced!=='auto'){
        try{resolve(new TextDecoder(forced).decode(buf));}catch(ex){resolve(new TextDecoder('utf-8').decode(buf));}
        return;
      }
      // BOM check: UTF-8 BOM = EF BB BF
      if(bytes[0]===0xEF&&bytes[1]===0xBB&&bytes[2]===0xBF){
        resolve(new TextDecoder('utf-8').decode(buf));return;
      }
      // UTF-16 LE BOM
      if(bytes[0]===0xFF&&bytes[1]===0xFE){
        resolve(new TextDecoder('utf-16le').decode(buf));return;
      }
      // Heuristic: scan for Shift-JIS high bytes
      // Shift-JIS first byte ranges: 0x81-0x9F, 0xE0-0xFC
      let sjisScore=0, utf8Score=0;
      for(let i=0;i<Math.min(bytes.length,4000);i++){
        const b=bytes[i];
        if((b>=0x81&&b<=0x9F)||(b>=0xE0&&b<=0xFC)){
          // Likely Shift-JIS lead byte
          const b2=bytes[i+1];
          if(b2&&((b2>=0x40&&b2<=0x7E)||(b2>=0x80&&b2<=0xFC))) sjisScore+=2;
        }
        // UTF-8 multi-byte
        if((b&0xE0)===0xC0||(b&0xF0)===0xE0||(b&0xF8)===0xF0) utf8Score++;
      }
      let enc='utf-8';
      if(sjisScore>utf8Score&&sjisScore>2) enc='shift-jis';
      try{
        const decoded=new TextDecoder(enc).decode(buf);
        // If result has many replacement chars (U+FFFD), retry with other encoding
        const replacements=(decoded.match(/\uFFFD/g)||[]).length;
        if(replacements>10&&enc==='utf-8'){
          resolve(new TextDecoder('shift-jis').decode(buf));
        } else if(replacements>10&&enc==='shift-jis'){
          resolve(new TextDecoder('utf-8').decode(buf));
        } else {
          resolve(decoded);
        }
      }catch(e2){
        resolve(new TextDecoder('utf-8').decode(buf));
      }
    };
    rd.readAsArrayBuffer(file);
  });
}
const readText=f=>new Promise((r,j)=>{const rd=new FileReader();rd.onload=e=>r(e.target.result);rd.onerror=j;rd.readAsText(f,'UTF-8');});

const readArrayBuffer=f=>new Promise((r,j)=>{const rd=new FileReader();rd.onload=e=>r(e.target.result);rd.onerror=j;rd.readAsArrayBuffer(f);});
const readDataURL=f=>new Promise((r,j)=>{const rd=new FileReader();rd.onload=e=>r(e.target.result);rd.onerror=j;rd.readAsDataURL(f);});
const loadImg=src=>new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=src;});

window.addEventListener('resize',()=>{
  if(S.tab==='3d'){if(typeof resize3D==='function')resize3D();return;}if(S.f1&&S.f1.type==='dxf')redrawDXF();else if(S.pixelDiff||S.singleCanvas)redrawPDF();});


// ═══════════════════════════════════════════════════════
//  DWG PARSER  (R2000 / R2004 / R2007 / R2010 / R2013 / R2018)
//  Supports: LINE CIRCLE ARC LWPOLYLINE TEXT MTEXT POINT ELLIPSE
//  Layer table extraction, Shift-JIS / UTF-8 / UTF-16 decoding
// ═══════════════════════════════════════════════════════


// ════════════════════════════════════════════════
// DWG パーサー (R14 - R2018)
// ════════════════════════════════════════════════


// ════════════════════════════════════════════════
// 多言語対応 (日本語/English/ภาษาไทย/中文/Tiếng Việt)
// ════════════════════════════════════════════════
var LANGS = {
  ja:{
    singleView:'単体展開',diffView:'差分比較',semanticColor:'■ 意味色',
    layer:'レイヤー',charCode:'文字コード',autoDetect:'自動判定',
    visual:'ビジュアル',layerExp:'レイヤー展開',structure:'内部構造',
    textTab:'テキスト',view3d:'3Dビュー',
    entities:'エンティティ',layers:'レイヤー',common:'共通',
    list:'一覧',legend:'凡例',detail:'詳細',struct:'構造',
    loading:'処理中...', dropHint:'ここにドロップ',
    formats:'DXF / PDF / IGES / STL / OBJ / PLY / OFF / STEP / 画像  ※SLDPRT→STEP変換',
    noFile:'ファイルを読み込んでください',fit:'FIT',
    added:'追加',removed:'削除',same:'共通',cross3d:'断面',showHeader:'ヘッダーを表示',hideHeader:'ヘッダーを隠す',
    solid:'ソリッド',wire:'ワイヤー',semantic:'意味色',edge:'エッジ',
    reset:'リセット',resetSection:'断面をリセット',
    inspEmpty:'エンティティをクリックで詳細表示',
    drawingFile:'図面ファイル',baseFile:'基準ファイル (FILE 1)',compareFile:'比較ファイル (FILE 2)',
    loadFile1First:'FILE 1 を先に読み込んでください',
    useDiff:'差分比較モードで使用',
    loadDxf:'DXFファイルを読み込んでください',
    fileNone:t('fileNone'),
    tolerance:'誤差',struct1:'構造1',struct2:'構造2',
    mouseHelp:'マウス: 回転 | Shift+ドラッグ: パン | ホイール: ズーム',
    entCount:'エンティティ',layerCount:'レイヤー',pageCount:'ページ',charCount:'文字',
    px_w:'px幅',px_h:'px高さ',
  },
  en:{
    singleView:'Single',diffView:'Diff Compare',semanticColor:'■ Semantic',
    layer:'Layer',charCode:'Encoding',autoDetect:'Auto',
    visual:'Visual',layerExp:'Layer Explode',structure:'Structure',
    textTab:'Text',view3d:'3D View',
    entities:'Entities',layers:'Layers',common:'Common',
    list:'List',legend:'Legend',detail:'Detail',struct:'Struct',
    loading:'Processing...', dropHint:'Drop here',
    formats:'DXF / PDF / IGES / STL / OBJ / PLY / OFF / STEP / Image  (SLDPRT→export as STEP)',
    noFile:'Please load a file',fit:'FIT',
    added:'Added',removed:'Removed',same:'Same',cross3d:'Section',showHeader:'Show header',hideHeader:'Hide header',
    solid:'Solid',wire:'Wire',semantic:'Semantic',edge:'Edge',
    reset:'Reset',resetSection:'Reset Section',
    inspEmpty:'Click entity for details',
    drawingFile:'Drawing File',baseFile:'Base File (FILE 1)',compareFile:'Compare File (FILE 2)',
    loadFile1First:'Load FILE 1 first',
    useDiff:'Use in Diff mode',
    loadDxf:'Load a DXF file',
    fileNone:'Drop file to start',
    tolerance:'Tolerance',struct1:'Structure 1',struct2:'Structure 2',
    mouseHelp:'Mouse: Rotate | Shift+Drag: Pan | Wheel: Zoom',
    entCount:'Entities',layerCount:'Layers',pageCount:'Pages',charCount:'Chars',
    px_w:'px W',px_h:'px H',
  },
  th:{
    singleView:'มุมมองเดียว',diffView:'เปรียบเทียบ',semanticColor:'สีความหมาย',
    layer:'เลเยอร์',charCode:'การเข้ารหัส',autoDetect:'อัตโนมัติ',
    visual:'ภาพ',layerExp:'ขยายเลเยอร์',structure:'โครงสร้าง',
    textTab:'ข้อความ',view3d:'3D',
    entities:'เอนทิตี',layers:'เลเยอร์',common:'ร่วม',
    list:'รายการ',legend:'คำอธิบาย',detail:'รายละเอียด',struct:'โครงสร้าง',
    loading:'กำลังประมวลผล...', dropHint:'วางไฟล์ที่นี่',
    formats:'DXF / PDF / IGES / STL / OBJ / PLY / OFF / STEP / รูปภาพ  (SLDPRT→บันทึกเป็น STEP)',
    noFile:'กรุณาโหลดไฟล์',fit:'พอดี',
    added:'เพิ่ม',removed:'ลบ',same:'เหมือนกัน',cross3d:'หน้าตัด',showHeader:'แสดงส่วนหัว',hideHeader:'ซ่อนส่วนหัว',
    solid:'โซลิด',wire:'ลวด',semantic:'สีความหมาย',edge:'ขอบ',
    reset:'รีเซ็ต',resetSection:'รีเซ็ตหน้าตัด',
    inspEmpty:'คลิกเอนทิตีเพื่อดูรายละเอียด',
    drawingFile:'ไฟล์แบบ',baseFile:'ไฟล์ฐาน (FILE 1)',compareFile:'ไฟล์เปรียบเทียบ (FILE 2)',
    loadFile1First:'โหลด FILE 1 ก่อน',
    useDiff:'ใช้ในโหมดเปรียบเทียบ',
    loadDxf:'โหลดไฟล์ DXF',
    fileNone:'วางไฟล์เพื่อเริ่ม',
    tolerance:'ค่าคลาดเคลื่อน',struct1:'โครงสร้าง 1',struct2:'โครงสร้าง 2',
    mouseHelp:'เมาส์: หมุน | Shift+ลาก: เลื่อน | ล้อ: ซูม',
    entCount:'เอนทิตี',layerCount:'เลเยอร์',pageCount:'หน้า',charCount:'ตัวอักษร',
    px_w:'px ก',px_h:'px ส',
  },
  zh:{
    singleView:'单视图',diffView:'差异对比',semanticColor:'语义色',
    layer:'图层',charCode:'编码',autoDetect:'自动',
    visual:'可视化',layerExp:'图层展开',structure:'结构',
    textTab:'文本',view3d:'3D视图',
    entities:'实体',layers:'图层',common:'共同',
    list:'列表',legend:'图例',detail:'详细',struct:'结构',
    loading:'处理中...', dropHint:'拖放到此处',
    formats:'DXF / PDF / IGES / STL / OBJ / PLY / OFF / STEP / 图像  (SLDPRT→另存为STEP)',
    noFile:'请加载文件',fit:'适合',
    added:'新增',removed:'删除',same:'相同',cross3d:'截面',showHeader:'显示标题栏',hideHeader:'隐藏标题栏',
    solid:'实体',wire:'线框',semantic:'语义色',edge:'边缘',
    reset:'重置',resetSection:'重置截面',
    inspEmpty:'点击实体查看详情',
    drawingFile:'图纸文件',baseFile:'基准文件 (FILE 1)',compareFile:'对比文件 (FILE 2)',
    loadFile1First:'请先加载 FILE 1',
    useDiff:'在差异模式中使用',
    loadDxf:'请加载DXF文件',
    fileNone:'拖放文件开始',
    tolerance:'公差',struct1:'结构1',struct2:'结构2',
    mouseHelp:'鼠标: 旋转 | Shift+拖动: 平移 | 滚轮: 缩放',
    entCount:'实体',layerCount:'图层',pageCount:'页面',charCount:'字符',
    px_w:'px 宽',px_h:'px 高',
  },
  vi:{
    singleView:'Xem đơn',diffView:'So sánh',semanticColor:'Màu ngữ nghĩa',
    layer:'Lớp',charCode:'Mã hóa',autoDetect:'Tự động',
    visual:'Trực quan',layerExp:'Mở rộng lớp',structure:'Cấu trúc',
    textTab:'Văn bản',view3d:'3D',
    entities:'Thực thể',layers:'Lớp',common:'Chung',
    list:'Danh sách',legend:'Chú giải',detail:'Chi tiết',struct:'Cấu trúc',
    loading:'Đang xử lý...', dropHint:'Thả file vào đây',
    formats:'DXF / PDF / IGES / STL / OBJ / PLY / OFF / STEP / Hình ảnh  (SLDPRT→lưu dạng STEP)',
    noFile:'Vui lòng tải file',fit:'Vừa',
    added:'Thêm',removed:'Xóa',same:'Giống',cross3d:'Mặt cắt',showHeader:'Hiện tiêu đề',hideHeader:'Ẩn tiêu đề',
    solid:'Khối',wire:'Khung dây',semantic:'Màu ngữ nghĩa',edge:'Cạnh',
    reset:'Đặt lại',resetSection:'Đặt lại mặt cắt',
    inspEmpty:'Nhấp vào thực thể để xem chi tiết',
    drawingFile:'File bản vẽ',baseFile:'File gốc (FILE 1)',compareFile:'File so sánh (FILE 2)',
    loadFile1First:'Tải FILE 1 trước',
    useDiff:'Dùng ở chế độ so sánh',
    loadDxf:'Tải file DXF',
    fileNone:'Thả file để bắt đầu',
    tolerance:'Dung sai',struct1:'Cấu trúc 1',struct2:'Cấu trúc 2',
    mouseHelp:'Chuột: Xoay | Shift+Kéo: Di chuyển | Cuộn: Thu phóng',
    entCount:'Thực thể',layerCount:'Lớp',pageCount:'Trang',charCount:'Ký tự',
    px_w:'px R',px_h:'px C',
  },
};
var LANG='ja';
function t(k){if(!LANGS||!LANG)return k;return (LANGS[LANG]&&LANGS[LANG][k])||(LANGS.ja&&LANGS.ja[k])||k;}

function applyLang(){
  const q=(sel,k)=>{const el=document.querySelector(sel);if(el)el.textContent=t(k);};
  // モード・カラーボタン
  q('#modeBtn1','singleView'); q('#modeBtn2','diffView');
  q('#cmBtn1','semanticColor'); q('#cmBtn2','layer');
  // タブボタン
  const tabMap={visual:'visual',layers:'layerExp',struct:'structure',text:'textTab','3d':'view3d'};
  document.querySelectorAll('.tab-btn').forEach(btn=>{const k=tabMap[btn.dataset.tab];if(k)btn.textContent=t(k);});
  // サイドパネルタブ（data-st属性）
  const stMap={list:'list',semleg:'legend',inspect:'detail',info1:'struct1',info2:'struct2'};
  document.querySelectorAll('[data-st]').forEach(btn=>{const k=stMap[btn.dataset.st];if(k)btn.textContent=t(k);});
  // 3Dモードボタン
  q('#v3dSolid','solid'); q('#v3dWire','wire'); q('#v3dSem','semantic'); q('#v3dEdge','edge');
  q('#v3dClip','cross3d');
  // v3d操作ガイド
  const vi=document.getElementById('v3dInfo'); if(vi)vi.innerHTML=`<span>${t('mouseHelp')}</span>`;
  // 断面リセットボタン
  document.querySelectorAll('.v3d-clip-reset').forEach(el=>el.textContent=t('reset'));
  const rall=document.querySelector('.v3d-clip-resetall'); if(rall)rall.textContent=t('resetSection');
  // ドロップゾーン
  const h1=document.getElementById('hint1');const h2=document.getElementById('hint2');
  if(h1)h1.innerHTML=`<b>${t('dropHint')}</b><small>${t('formats')}</small>`;
  if(h2&&!h2.innerHTML.includes('FILE'))h2.innerHTML=`<b>${t('dropHint')}</b><small>${t('formats')}</small>`;
  // dzLabel
  const dz1=document.getElementById('dzLabel1');
  try{if(dz1&&typeof S!=='undefined'&&S&&S.mode==='single')dz1.textContent=t('drawingFile');}catch(e){}
  // ローディング・空メッセージ
  const lt=document.getElementById('loadingTxt'); if(lt)lt.textContent=t('loading');
  const em=document.getElementById('emptyMsg'); if(em)em.textContent=t('noFile');
  // インスペクター空状態
  const ie=document.getElementById('inspEmpty'); if(ie)ie.textContent=t('inspEmpty');
  // エンティティ一覧空状態
  const elb=document.getElementById('entListBody');
  if(elb){const nd=elb.querySelector('.no-data');if(nd)nd.textContent=t('noFile');}
  // 誤差ラベル
  const tw=document.querySelector('#tolWrap .tab-bar'); if(tw)tw.textContent=t('tolerance');
  // 差分比較用情報
  const i2=document.getElementById('info2Body');
  if(i2&&i2.innerHTML.includes('差分比較モード'))i2.innerHTML=`<div class="no-data">${t('useDiff')}</div>`;
  // 差分凡例ラベル
  document.querySelectorAll('.leg-label').forEach(el=>{
    const p=el.closest('[data-lang]');
    if(!p)return;
    const k={add:'added',del:'removed',same:'same'}[p.dataset.lang?.replace('leg-','')];
    if(k)el.textContent=t(k);
  });
  // 統計ラベル（エンティティ数・レイヤー数・共通）
  document.querySelectorAll('[data-stat]').forEach(el=>{
    const k={added:'added',removed:'removed',same:'same'}[el.dataset.stat];
    if(k) el.textContent=t(k);
  });
  // ヘッダートグルボタン
  // 言語ボタンのアクティブ表示
  document.querySelectorAll('.lang-btn').forEach(btn=>{
    btn.classList.toggle('active-lang', btn.dataset.lang===LANG);
  });
}


// ── ヘッダー開閉 ──

// ── ドロップゾーン開閉 ──
function toggleDropZone(){
  const row=document.getElementById('dropRow');
  const btn=document.getElementById('dzToggle');
  const txt=document.getElementById('dzToggleTxt');
  if(!row) return;
  const collapsed=row.classList.toggle('dz-collapsed');
  if(btn) btn.classList.toggle('dz-collapsed-bar',collapsed);
  if(txt) txt.textContent=collapsed?'ファイルエリアを開く':'ファイルエリアを閉じる';
  // リサイズ通知
  setTimeout(()=>{
    if(S.f1&&S.f1.type==='dxf') redrawDXF();
    if(typeof resize3D==='function'&&typeof T3!=='undefined'&&T3&&T3.renderer) resize3D();
  },280);
}
function toggleHeader(){
  const hdr=document.querySelector('header');
  const closeBtn=document.getElementById('hdrCloseBtn');
  const openBtn=document.getElementById('hdrOpenBtn');
  const dzToggleBtn=document.getElementById('dzToggle');
  const dropRow=document.getElementById('dropRow');
  if(!hdr) return;
  const isCollapsed=hdr.classList.toggle('collapsed');
  // ドロップゾーンも同時に開閉
  if(dropRow) dropRow.classList.toggle('dz-collapsed', isCollapsed);
  if(dzToggleBtn) dzToggleBtn.classList.toggle('dz-collapsed-bar', isCollapsed);
  if(openBtn) openBtn.style.display=isCollapsed?'block':'none';
  if(closeBtn) closeBtn.style.display=isCollapsed?'none':'';
  setTimeout(()=>{
    if(S.f1&&S.f1.type==='dxf') redrawDXF();
    if(typeof resize3D==='function'&&typeof T3!=='undefined'&&T3&&T3.renderer) resize3D();
  },280);
}
function switchLang(lang){
  LANG=lang;
  document.documentElement.lang = lang;
  document.body.dataset.lang = lang;
  applyLang();
}
const DWG_VERSIONS = {
  'AC1014':'R14','AC1015':'R2000','AC1018':'R2004',
  'AC1021':'R2007','AC1024':'R2010','AC1027':'R2013','AC1032':'R2018'
};

class DWGBitReader {
  constructor(buf) {
    this.buf = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    this.pos = 0; // bit position
  }
  B() {
    const byteIdx = this.pos >> 3, bit = this.pos & 7;
    this.pos++;
    return (this.buf[byteIdx] >> bit) & 1;
  }
  Bn(n) { let v=0; for(let i=0;i<n;i++) v|=(this.B()<<i); return v; }
  RC() { const v=this.buf[this.pos>>3]??0; this.pos+=8; return v; }
  RS() { const v=(this.buf[this.pos>>3]??0)|((this.buf[(this.pos>>3)+1]??0)<<8); this.pos+=16; return v; }
  RL() { const b=this.pos>>3; const v=(this.buf[b]??0)|((this.buf[b+1]??0)<<8)|((this.buf[b+2]??0)<<16)|((this.buf[b+3]??0)<<24); this.pos+=32; return v>>>0; }
  RD() { // IEEE 754 double
    const b=this.pos>>3; if(b+8>this.buf.length) return 0;
    const tmp=new Uint8Array(8);
    for(let i=0;i<8;i++) tmp[i]=this.buf[b+i]??0;
    this.pos+=64;
    return new DataView(tmp.buffer).getFloat64(0,true);
  }
  BS() { // Bit Short
    const c=this.Bn(2);
    if(c===0) return this.RS();
    if(c===1) return this.RC()&0xFF;
    if(c===2) return 0;
    return 256;
  }
  BL() { // Bit Long
    const c=this.Bn(2);
    if(c===0) return this.RL();
    if(c===1) return this.RC()&0xFF;
    return 0;
  }
  BD() { // Bit Double
    const c=this.Bn(2);
    if(c===0) return this.RD();
    if(c===1) return 1.0;
    return 0.0;
  }
  MC() { // Modular Char
    let v=0,s=0;
    for(let i=0;i<4;i++){
      const b=this.RC(); v|=((b&0x7F)<<s); s+=7;
      if(!(b&0x80)) break;
    }
    return v;
  }
  MS() { // Modular Short
    let v=0,s=0;
    for(let i=0;i<4;i++){
      const w=this.RS(); v|=((w&0x7FFF)<<s); s+=15;
      if(!(w&0x8000)) break;
    }
    return v;
  }
  H() { // Handle
    const c=this.RC(); const n=c&0x0F;
    let h=0; for(let i=0;i<n;i++) h=(h<<8)|this.RC();
    return h;
  }
  TV(enc) { // Text Value
    const len=this.BS(); if(len<=0||len>4096) return '';
    const bytes=[];
    for(let i=0;i<len;i++) bytes.push(this.RC());
    try {
      const arr=new Uint8Array(bytes);
      const dec=enc==='shift-jis'?new TextDecoder('shift-jis',{fatal:false}):new TextDecoder('utf-8',{fatal:false});
      return dec.decode(arr);
    } catch(e){ return String.fromCharCode(...bytes); }
  }
  skip(bits) { this.pos+=bits; }
  get bytePos() { return this.pos>>3; }
  alignByte() { if(this.pos&7) this.pos=(this.pos|7)+1; }
}

// ── エンティティ型 ──
const DWG_ENTITY_TYPES = {
  1:'TEXT',17:'ARC',18:'CIRCLE',19:'LINE',
  21:'POINT',23:'SOLID',27:'DIMENSION',
  48:'LWPOLYLINE',77:'INSERT',15:'ELLIPSE',
};

// ── 座標バリデーション ──
function validCoord(v) { return isFinite(v) && Math.abs(v) < 1e8; }
function validPt(x,y) { return validCoord(x) && validCoord(y); }

// ── LINE エンティティ ──
function parseDWGLine(r, ver) {
  let zFlag=false;
  if(ver>='AC1015') zFlag=r.B();
  const x1=r.BD(),y1=r.BD(); const z1=zFlag?0:r.BD();
  const x2=r.BD(),y2=r.BD(); const z2=zFlag?0:r.BD();
  if(!validPt(x1,y1)||!validPt(x2,y2)) return null;
  return {type:'LINE',x1,y1,x2,y2,layer:'0',aci:7};
}

// ── CIRCLE エンティティ ──
function parseDWGCircle(r, ver) {
  const cx=r.BD(),cy=r.BD(),cz=r.BD();
  const radius=r.BD();
  if(!validPt(cx,cy)||radius<=0||radius>1e7) return null;
  return {type:'CIRCLE',cx,cy,r:radius,layer:'0',aci:7};
}

// ── ARC エンティティ ──
function parseDWGArc(r, ver) {
  const cx=r.BD(),cy=r.BD(),cz=r.BD();
  const radius=r.BD();
  const startAngle=r.BD(),endAngle=r.BD();
  if(!validPt(cx,cy)||radius<=0||radius>1e7) return null;
  return {type:'ARC',cx,cy,r:radius,
    startAngle:startAngle*180/Math.PI,
    endAngle:endAngle*180/Math.PI,
    layer:'0',aci:7};
}

// ── LWPOLYLINE エンティティ ──
function parseDWGLWPolyline(r, ver) {
  const flags=r.BS();
  if(flags&4) r.BD(); // const width
  if(flags&8) r.BD(); // elevation
  if(flags&2) r.BD(); // thickness
  if(flags&64) {r.BD();r.BD();r.BD();} // normal
  const numPts=r.BL();
  if(numPts<2||numPts>100000) return null;
  const pts=[];
  for(let i=0;i<numPts;i++){
    const x=r.RD(),y=r.RD();
    if(!validPt(x,y)) return null;
    pts.push({x,y});
  }
  return {type:'LWPOLYLINE',pts,layer:'0',aci:7,closed:!!(flags&512)};
}

// ── TEXT エンティティ ──
function parseDWGText(r, ver, enc) {
  const dataFlags=ver>='AC1015'?r.RC():0;
  if(!(dataFlags&1)) r.RD(); // elevation
  const x=r.RD(),y=r.RD();
  if(!validPt(x,y)) return null;
  if(!(dataFlags&2)) {r.RD();r.RD();} // alignment pt
  r.BD(); // extrusion if needed
  const h=r.BD();
  const text=r.TV(enc||'utf-8');
  if(!text||text.length===0) return null;
  return {type:'TEXT',x,y,h:h||2,text,ha:0,va:0,wf:1,rot:0,layer:'0',aci:7};
}

// ══════════════════════════════════════════════════
// R2000 (AC1015) 正確なパーサー
// ══════════════════════════════════════════════════
function parseR2000(buffer, enc) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const entities = [];
  const layerNames = new Map();

  try {
    // Section locator: starts at offset 0x15 (21)
    // Format: 4 bytes unknown, then 5 sections each 9 bytes
    let off = 0x15;
    const sections = {};
    for(let i=0;i<6&&off+9<=buffer.byteLength;i++){
      const num  = view.getUint8(off);
      const addr = view.getUint32(off+1, true);
      const size = view.getUint32(off+5, true);
      if(addr > 0 && addr < buffer.byteLength && size > 0) sections[num]={addr,size};
      off += 9;
    }

    // Layer table (section 0 = header, section 2 = objects)
    // Scan for entity objects in section 2
    const objSection = sections[1] || sections[2] || sections[0];
    if(!objSection) return {entities,layerNames};

    const sAddr = objSection.addr;
    const sSize = Math.min(objSection.size, buffer.byteLength - sAddr);
    if(sAddr <= 0 || sAddr >= buffer.byteLength) return {entities,layerNames};

    // Parse entity records
    off = sAddr;
    let attempts = 0;
    while(off < sAddr + sSize - 4 && entities.length < 100000 && attempts < 500000) {
      attempts++;
      // Each object: 2-byte length + bitstream
      const len = view.getUint16(off, true);
      if(len < 4 || len > 4096 || off + 2 + len > buffer.byteLength) { off++; continue; }

      try {
        const r = new DWGBitReader(buffer.slice(off+2, off+2+len));
        const typeCode = r.BS();
        if(typeCode < 1 || typeCode > 60 || !DWG_ENTITY_TYPES[typeCode]) { off++; continue; }

        // Skip common entity header
        r.Bn(2); // mode
        const numReact = r.BL();
        if(numReact > 100) { off++; continue; }
        r.B(); // nolinks
        r.BS(); // color
        r.BD(); // ltype scale
        r.BS(); // ltype
        r.BS(); // lineweight
        r.BS(); // visibility

        // Skip handles
        r.H(); r.H();
        r.B(); // nolinks again check

        let ent = null;
        try {
          if(typeCode===19) ent=parseDWGLine(r,'AC1015');
          else if(typeCode===18) ent=parseDWGCircle(r,'AC1015');
          else if(typeCode===17) ent=parseDWGArc(r,'AC1015');
          else if(typeCode===48) ent=parseDWGLWPolyline(r,'AC1015');
          else if(typeCode===1)  ent=parseDWGText(r,'AC1015',enc);
        } catch(e){}

        if(ent) { ent.aci=7; entities.push(ent); off+=2+len; continue; }
      } catch(e){}
      off++;
    }
  } catch(ex){ console.warn('R2000 parse error:', ex); }

  return {entities, layerNames};
}

// ══════════════════════════════════════════════════
// R2004-R2018 改善スキャン（圧縮形式のためスキャン）
// ══════════════════════════════════════════════════
function scanDWGEntities(buffer, enc) {
  const view = new DataView(buffer);
  const blen = buffer.byteLength;
  const entities = [];

  function rd(off) {
    if(off+8>blen) return NaN;
    return view.getFloat64(off, true);
  }
  function ok(v) { return isFinite(v) && !isNaN(v) && Math.abs(v)<1e6; }

  // 8バイト境界でスキャン: x1,y1,x2,y2 の4連続doubleを探す
  for(let off=0x100; off<blen-40 && entities.length<80000; off+=8){
    const x1=rd(off), y1=rd(off+8), x2=rd(off+16), y2=rd(off+24);
    if(!ok(x1)||!ok(y1)||!ok(x2)||!ok(y2)) continue;
    const d=Math.hypot(x2-x1,y2-y1);
    if(d<0.01||d>1e5) continue;
    // ゼロ線を除外
    if(x1===0&&y1===0&&x2===0&&y2===0) continue;
    entities.push({type:'LINE',x1,y1,x2,y2,layer:'0',aci:7,_aciColor:'#00b4ff'});

    // cx,cy,cz,r の4連続 → CIRCLE候補
    const r=rd(off+24);
    if(ok(r)&&r>0.01&&r<50000&&r!==d){
      entities.push({type:'CIRCLE',cx:x1,cy:y1,r:rd(off+16),layer:'0',aci:7,_aciColor:'#00ffd0'});
    }
  }

  // 重複除去
  const seen=new Set();
  const unique=entities.filter(e=>{
    const k=e.type==='LINE'?`L${e.x1.toFixed(1)},${e.y1.toFixed(1)},${e.x2.toFixed(1)},${e.y2.toFixed(1)}`
                           :`C${e.cx.toFixed(1)},${e.cy.toFixed(1)},${e.r.toFixed(2)}`;
    if(seen.has(k))return false; seen.add(k); return true;
  });

  // IQR品質チェック: 圧縮バイナリから偽の座標が出る場合を検出
  // IQR(四分位範囲)が1.0未満 → 全て原点付近のゴミデータ → 捨てる
  if(unique.length > 0) {
    const xs=unique.filter(e=>e.type==='LINE')
      .map(e=>[e.x1,e.x2]).flat().sort((a,b)=>a-b);
    if(xs.length >= 4) {
      const q1=xs[Math.floor(xs.length/4)], q3=xs[Math.floor(xs.length*3/4)];
      const iqr=q3-q1;
      if(iqr < 1.0) return []; // ゴミデータと判断して捨てる
    }
  }
  return unique;
}

// ══════════════════════════════════════════════════
// メイン DWG パーサー
// ══════════════════════════════════════════════════
async function parseDWG(buffer) {
  const bytes = new Uint8Array(buffer);
  const verStr = String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5]);
  const version = DWG_VERSIONS[verStr] || verStr;

  // エンコーディング判定
  const view = new DataView(buffer);
  let enc = 'utf-8';
  try {
    const cp = view.getUint16(0x13, true);
    if(cp===30||cp===932||cp===0x3A) enc='shift-jis';
  } catch(e){}

  let entities = [], layerNames = new Map();

  try {
    if(verStr==='AC1015') {
      // R2000: 正確なBitStreamパース
      const result = parseR2000(buffer, enc);
      entities = result.entities;
      layerNames = result.layerNames;
    }

    // R2004以降 or R2000でエンティティが少ない場合はスキャン補完
    if(verStr!=='AC1015' || entities.length < 10) {
      const scanned = scanDWGEntities(buffer, enc);
      // 重複排除: 既存エンティティと座標が近いものを除く
      const existing = new Set(entities.map(e =>
        e.type==='LINE' ? `${e.x1.toFixed(1)},${e.y1.toFixed(1)},${e.x2.toFixed(1)},${e.y2.toFixed(1)}` :
        e.type==='CIRCLE' ? `${e.cx.toFixed(1)},${e.cy.toFixed(1)},${e.r.toFixed(2)}` : ''
      ));
      for(const e of scanned) {
        const key = e.type==='LINE' ?
          `${e.x1.toFixed(1)},${e.y1.toFixed(1)},${e.x2.toFixed(1)},${e.y2.toFixed(1)}` :
          `${e.cx.toFixed(1)},${e.cy.toFixed(1)},${e.r.toFixed(2)}`;
        if(!existing.has(key)) { existing.add(key); entities.push(e); }
      }
    }

    // 座標ゼロの異常データを除去
    entities = entities.filter(e => {
      if(e.type==='LINE') return !(e.x1===0&&e.y1===0&&e.x2===0&&e.y2===0);
      if(e.type==='CIRCLE') return !(e.cx===0&&e.cy===0&&e.r===0);
      return true;
    });

  } catch(ex) {
    console.warn('DWG parse error:', ex);
  }

  // R2004+は圧縮形式のためスキャンが失敗しても静かにwarn設定
  const isCompressed = !['AC1014','AC1015'].includes(verStr);
  const warn = (entities.length===0 && isCompressed)
    ? `${version}は圧縮形式です。DXFエクスポートで完全表示できます。` : null;
  return {entities, layers:['0'], version, layerNames, warn};
}


// ═══ INIT DOM ═══
(function init(){
  // Inject layer panel into tab content area (layers tab)
  const wrap=document.getElementById('canvasWrap');
  if(!wrap){console.error('[viewer] #canvasWrap not found - DOM not mounted before viewer.js imported?');return;}
  const lp=document.createElement('div');
  lp.id='layersPanelView';
  lp.style.cssText='position:absolute;inset:0;display:none;background:var(--bg);overflow:hidden;flex-direction:column;';
  lp.innerHTML=`<div class="sec-hdr" style="flex-shrink:0"><div class="sec-dot"></div>レイヤー展開ビュー</div><div style="flex:1;display:grid;grid-template-columns:220px 1fr;min-height:0;overflow:hidden;"><div style="border-right:1px solid var(--border2);overflow-y:auto;"><div id="layerPanelContent"><div class="no-data">DXFファイルを読み込んでください</div></div></div><div style="position:relative;overflow:hidden;flex:1;" id="layerCanvas"><canvas id="layerPreviewCanvas" style="position:absolute;top:0;left:0;"></canvas><div style="position:absolute;bottom:10px;right:10px;font-family:var(--mono);font-size:9px;color:var(--dim);letter-spacing:.08em;">クリックでレイヤー選択 / スライダーで分離</div></div></div>`;
  wrap.appendChild(lp);

  // Override switchTab to handle layers view
  const origSwitch=switchTab;
  window.switchTab=function(tab){
    origSwitch(tab);
    lp.style.display=tab==='layers'?'flex':'none';
    document.getElementById('mainCanvas').style.display=(tab==='layers'||tab==='3d')?'none':'block';
    document.getElementById('emptyMsg').style.display=tab==='layers'&&!S.f1?'':'none';
    if(tab==='layers'){
      buildLayerPanel();
      // Mirror main canvas to layer preview
      setTimeout(()=>{
        const lc=document.getElementById('layerPreviewCanvas');
        const la=document.getElementById('layerCanvas');
        lc.width=la.clientWidth;lc.height=la.clientHeight;
        // Redirect redrawDXF to also draw on layerPreview
        if(S.f1&&S.f1.type==='dxf'){
          // Use same state but draw on lc
          const origCV=document.getElementById('mainCanvas');
          const tmpWrap={clientWidth:la.clientWidth,clientHeight:la.clientHeight};
          const ctx=lc.getContext('2d');ctx.clearRect(0,0,lc.width,lc.height);
          if(S.bounds){
            const{bounds:b,scale:sc,pan}=S;
            const ch=lc.height;
            const ents=S.f1.parsed.entities;
            const byLayer={};
            ents.forEach(e=>{if(!byLayer[e.layer])byLayer[e.layer]=[];byLayer[e.layer].push(e);});
            Object.entries(byLayer).forEach(([layerName,layerEnts])=>{
              const li=S.layers[layerName];if(li&&!li.visible)return;
              const color=li?li.color:'#00b4ff';
              const off=getLayerOffset(layerName,b,S.explode);
              const adjPan={x:pan.x+off.dx*sc,y:pan.y-off.dy*sc};
              layerEnts.forEach(e=>drawEnt(ctx,e,color,b,sc,adjPan,ch,e===S.selectedEnt));
            });
          }
        }
      },50);
    }
  };

  // Init mode UI
  document.getElementById('zone2').style.display='none';
  document.getElementById('dzDiv').style.display='none';
  document.getElementById('entFilter').style.display='none';
  document.getElementById('stInfo2').style.display='none';
  document.getElementById('tabLayers').style.display='';

  setupZone(1);setupZone(2);
  setupBodyDrop();
  // スマホ(600px以下)のみ警告表示
  if(window.innerWidth < 600){
    document.getElementById('mobileWarn').style.display='flex';
  }
  // 関連テキストのクリックコピー（イベント委譲）
  document.addEventListener('click', e=>{
    const item=e.target.closest('.assoc-item');
    if(!item) return;
    const txt=item.dataset.copy||item.querySelector('div')?.textContent||'';
    if(navigator.clipboard&&txt){
      navigator.clipboard.writeText(txt).then(()=>{
        item.style.background='rgba(0,255,208,.15)';
        // ✓ コピー済みバッジを表示
        const badge=document.createElement('span');
        badge.textContent='✓ コピー済み';
        badge.style.cssText='position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:9px;color:#00ffd0;font-family:var(--mono);pointer-events:none;';
        item.style.position='relative';
        item.appendChild(badge);
        setTimeout(()=>{
          item.style.background='';
          badge.remove();
        },1200);
      });
    }
  });
})();

// ═══════════════════════════════════════════════════════
//  3D ENGINE
// ═══════════════════════════════════════════════════════
const T3 = {
  scene: null, camera: null, renderer: null,
  mesh: null, edges: null, wireframe: null,
  mode: 'solid',
  mouse: {down:false, shift:false, last:{x:0,y:0}},
  spherical: {theta: 0.6, phi: 1.0, radius: 5},
  target: new THREE.Vector3(0,0,0),
  loaded: false,
};

// Semantic face colors (by normal direction)
const FACE_COLORS_SEM = {
  top:    new THREE.Color('#00b4ff'),
  bottom: new THREE.Color('#336688'),
  front:  new THREE.Color('#e8e8e8'),
  back:   new THREE.Color('#999999'),
  right:  new THREE.Color('#ffc040'),
  left:   new THREE.Color('#cc8820'),
};

function init3D() {
  if(typeof THREE==='undefined'){
    const info=document.getElementById('v3dInfo');
    if(info)info.innerHTML='<span style="color:var(--del)">❌ Three.js の読み込みに失敗。ネット接続を確認してください。</span>';
    showLoading(false);return;
  }
  const cv = document.getElementById('canvas3d');
  const wrap = document.getElementById('view3d');
  if (T3.renderer) return; // already init

  T3.renderer = new THREE.WebGLRenderer({canvas: cv, antialias: true, alpha: false});
  T3.renderer.setPixelRatio(window.devicePixelRatio);
  T3.renderer.setClearColor(0x03060e, 1);
  T3.renderer.shadowMap.enabled = true;
  T3.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  T3.scene = new THREE.Scene();

  T3.camera = new THREE.PerspectiveCamera(45, 1, 0.001, 10000);

  // ── 照明設定（Phase2: PBR対応強化版）──
  // 環境光: MeshStandardMaterial には十分な ambient が必要
  const ambient = new THREE.AmbientLight(0x8899aa, 1.8);
  T3.scene.add(ambient);
  // メインライト（上前方）
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(5, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  T3.scene.add(sun);
  // フィルライト（下後方: 影を和らげる）
  const fill = new THREE.DirectionalLight(0x6699bb, 0.8);
  fill.position.set(-4, -2, -6);
  T3.scene.add(fill);
  // リムライト（右側面: エッジをくっきり）
  const rim = new THREE.DirectionalLight(0x99ccff, 0.5);
  rim.position.set(8, 0, -3);
  T3.scene.add(rim);

  // Grid
  const grid = new THREE.GridHelper(20, 20, 0x112233, 0x0a1420);
  grid.name = 'grid';
  T3.scene.add(grid);

  // Axes helper
  const axes = new THREE.AxesHelper(1);
  T3.scene.add(axes);

  resize3D();
  render3D();

  // Mouse events
  cv.addEventListener('mousedown', e => {
    T3.mouse.down = true;
    T3.mouse.shift = e.shiftKey;
    T3.mouse.last = {x: e.clientX, y: e.clientY};
  });
  window.addEventListener('mousemove', e => {
    if (!T3.mouse.down) return;
    const dx = e.clientX - T3.mouse.last.x;
    const dy = e.clientY - T3.mouse.last.y;
    T3.mouse.last = {x: e.clientX, y: e.clientY};
    if (e.shiftKey || T3.mouse.shift) {
      // Pan
      const panSpeed = T3.spherical.radius * 0.001;
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      T3.camera.getWorldDirection(new THREE.Vector3());
      right.crossVectors(T3.camera.getWorldDirection(new THREE.Vector3()), T3.camera.up).normalize();
      up.copy(T3.camera.up).normalize();
      T3.target.addScaledVector(right, -dx * panSpeed);
      T3.target.addScaledVector(up, dy * panSpeed);
    } else {
      // Orbit
      T3.spherical.theta -= dx * 0.008;
      T3.spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, T3.spherical.phi - dy * 0.008));
    }
    updateCamera3D();
  });
  window.addEventListener('mouseup', () => { T3.mouse.down = false; });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.89;

    // マウスカーソル位置をNDC座標に変換
    const rect = cv.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    const ny = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

    // カーソル方向のレイを求める
    const ray = new THREE.Vector3(nx, ny, 0.5).unproject(T3.camera)
      .sub(T3.camera.position).normalize();

    // ズームする距離
    const zoomDist = T3.spherical.radius * (1 - factor);

    // カメラとターゲットを同方向にシフト
    T3.camera.position.addScaledVector(ray, zoomDist);
    T3.target.addScaledVector(ray, zoomDist);

    // radius も更新（回転時の基準を保つ）
    T3.spherical.radius = Math.max(0.01, T3.spherical.radius * factor);
    updateCamera3D();
  }, {passive: false});

  // Touch
  let lastTouchDist = 0, lastTouch = null;
  cv.addEventListener('touchstart', e => {
    if (e.touches.length === 1) lastTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
    else if (e.touches.length === 2) lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  });
  cv.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && lastTouch) {
      const dx = e.touches[0].clientX - lastTouch.x, dy = e.touches[0].clientY - lastTouch.y;
      T3.spherical.theta -= dx * 0.008;
      T3.spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, T3.spherical.phi - dy * 0.008));
      lastTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
      updateCamera3D();
    } else if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      T3.spherical.radius *= lastTouchDist / d;
      lastTouchDist = d;
      updateCamera3D();
    }
  }, {passive: false});
  cv.addEventListener('touchend', () => lastTouch = null);
}

function updateCamera3D() {
  const {theta, phi, radius} = T3.spherical;
  T3.camera.position.set(
    T3.target.x + radius * Math.sin(phi) * Math.sin(theta),
    T3.target.y + radius * Math.cos(phi),
    T3.target.z + radius * Math.sin(phi) * Math.cos(theta)
  );
  T3.camera.lookAt(T3.target);
  updateCompass();
  render3D();
}

function resize3D() {
  const wrap = document.getElementById('view3d');
  const w = wrap.clientWidth, h = wrap.clientHeight;
  // display:none のとき clientWidth/Height = 0 → スキップ（switchTab の setTimeout が正しく呼び直す）
  if (!w || !h) return;
  T3.renderer.setSize(w, h);
  T3.camera.aspect = w / h;
  T3.camera.updateProjectionMatrix();
  render3D();
}

function render3D() {
  if (!T3.renderer) return;
  T3.renderer.render(T3.scene, T3.camera);
}

function reset3DCamera() {
  if (!T3.mesh) { T3.spherical = {theta:0.6, phi:1.0, radius:5}; T3.target.set(0,0,0); updateCamera3D(); return; }
  const box = new THREE.Box3().setFromObject(T3.mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  T3.target.copy(center);
  T3.spherical.radius = maxDim * 2.0;
  T3.spherical.theta = 0.6; T3.spherical.phi = 1.0;
  updateCamera3D();
}

// ── STL PARSER ──
function parseSTL(buffer) {
  const view = new DataView(buffer);
  // ASCII STL starts with "solid"
  const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 80));
  const isASCII = header.trim().startsWith('solid') && !isBinarySTL(buffer);

  if (isASCII) return parseSTLASCII(new TextDecoder('utf-8').decode(buffer));
  return parseSTLBinary(buffer);
}

function isBinarySTL(buffer) {
  const view = new DataView(buffer);
  const numTriangles = view.getUint32(80, true);
  return buffer.byteLength === 84 + numTriangles * 50;
}

function parseSTLBinary(buffer) {
  const view = new DataView(buffer);
  const numTri = view.getUint32(80, true);
  const positions = new Float32Array(numTri * 9);
  const normals = new Float32Array(numTri * 9);
  let offset = 84, pi = 0, ni = 0;
  for (let i = 0; i < numTri; i++) {
    const nx = view.getFloat32(offset, true); offset += 4;
    const ny = view.getFloat32(offset, true); offset += 4;
    const nz = view.getFloat32(offset, true); offset += 4;
    for (let v = 0; v < 3; v++) {
      positions[pi++] = view.getFloat32(offset, true); offset += 4;
      positions[pi++] = view.getFloat32(offset, true); offset += 4;
      positions[pi++] = view.getFloat32(offset, true); offset += 4;
      normals[ni++] = nx; normals[ni++] = ny; normals[ni++] = nz;
    }
    offset += 2; // attribute
  }
  return {positions, normals, numTri};
}

function parseSTLASCII(text) {
  const lines = text.split('\n');
  const verts = [], norms = [];
  let curNorm = [0,1,0];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('facet normal')) {
      const p = t.split(/\s+/);
      curNorm = [parseFloat(p[2]), parseFloat(p[3]), parseFloat(p[4])];
    } else if (t.startsWith('vertex')) {
      const p = t.split(/\s+/);
      verts.push(parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]));
      norms.push(...curNorm);
    }
  }
  return {positions: new Float32Array(verts), normals: new Float32Array(norms), numTri: verts.length / 9};
}

// ── OBJ PARSER ──
function parseOBJ(text) {
  const v = [], vn = [], vt = [];
  const pos = [], norm = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('v ')) {
      const p = t.split(/\s+/); v.push(parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]));
    } else if (t.startsWith('vn ')) {
      const p = t.split(/\s+/); vn.push(parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]));
    } else if (t.startsWith('f ')) {
      const parts = t.split(/\s+/).slice(1);
      const tris = [];
      for (const p of parts) { const idxs = p.split('/'); tris.push(parseInt(idxs[0])-1, idxs[2]?parseInt(idxs[2])-1:-1); }
      // Fan triangulation
      for (let i = 1; i < tris.length/2 - 1; i++) {
        const i0 = 0, i1 = i, i2 = i + 1;
        for (const vi of [i0, i1, i2]) {
          const vi3 = tris[vi*2]*3;
          pos.push(v[vi3], v[vi3+1], v[vi3+2]);
          const ni = tris[vi*2+1];
          if (ni >= 0) norm.push(vn[ni*3], vn[ni*3+1], vn[ni*3+2]);
          else norm.push(0,1,0);
        }
      }
    }
  }
  // Compute normals if none
  if (norm.length === 0 || norm.every(v=>v===0)) {
    for (let i = 0; i < pos.length; i += 9) {
      const ax=pos[i+3]-pos[i], ay=pos[i+4]-pos[i+1], az=pos[i+5]-pos[i+2];
      const bx=pos[i+6]-pos[i], by=pos[i+7]-pos[i+1], bz=pos[i+8]-pos[i+2];
      const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
      const l=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      for (let v=0;v<3;v++) norm.push(nx/l,ny/l,nz/l);
    }
  }
  return {positions: new Float32Array(pos), normals: new Float32Array(norm), numTri: pos.length/9};
}

// ── BUILD THREE MESH ──
function buildMesh(parsed) {
  // 旧オブジェクト削除
  ['mesh','edges','wireframe','semMesh'].forEach(k => {
    if(T3[k]){ T3.scene.remove(T3[k]); T3[k]=null; }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
  // STEPなどフラット法線 → computeVertexNormals でスムーズ化
  if(parsed.normals && parsed.normals.length > 0){
    geo.setAttribute('normal', new THREE.BufferAttribute(parsed.normals, 3));
  }

  // 中心に移動
  geo.computeBoundingBox();
  const center = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-center.x, -center.y, -center.z);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  // スムーズ法線（円柱面などのエッジをなめらかに）
  geo.computeVertexNormals();

  const numFaces = parsed.positions.length / 9;

  // ── セマンティックカラー（面の向き別） ──
  const colors = new Float32Array(numFaces * 9);
  const semLabels = new Array(numFaces);
  for(let i=0; i<numFaces; i++){
    const ni=i*3;
    const nx=parsed.normals?parsed.normals[ni]:0;
    const ny=parsed.normals?parsed.normals[ni+1]:1;
    const nz=parsed.normals?parsed.normals[ni+2]:0;
    const anx=Math.abs(nx), any=Math.abs(ny), anz=Math.abs(nz);
    let col, label;
    if(any>anx&&any>anz){ col=ny>0?FACE_COLORS_SEM.top:FACE_COLORS_SEM.bottom; label=ny>0?'Top':'Bottom'; }
    else if(anz>anx){ col=nz>0?FACE_COLORS_SEM.front:FACE_COLORS_SEM.back; label=nz>0?'Front':'Back'; }
    else { col=nx>0?FACE_COLORS_SEM.right:FACE_COLORS_SEM.left; label=nx>0?'Right':'Left'; }
    semLabels[i]=label;
    for(let v=0;v<3;v++){ const vi=(i*3+v)*3; colors[vi]=col.r; colors[vi+1]=col.g; colors[vi+2]=col.b; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors,3));

  // ── PBR材質（MeshStandardMaterial） ──
  // 金属部品らしい質感
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd0dde8,      // 薄いスチール系グレー
    metalness: 0.35,      // 少し金属感
    roughness: 0.45,      // 半艶
    side: THREE.DoubleSide,
    vertexColors: false,
  });
  T3.mesh = new THREE.Mesh(geo, mat);
  T3.mesh.castShadow = true;
  T3.mesh.receiveShadow = true;
  T3.scene.add(T3.mesh);

  // セマンティックメッシュ
  const semMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    metalness: 0.2,
    roughness: 0.6,
  });
  T3.semMesh = new THREE.Mesh(geo, semMat);
  T3.semMesh.visible = false;
  T3.scene.add(T3.semMesh);

  // ワイヤーフレーム
  const wireMat = new THREE.MeshBasicMaterial({color:0x00b4ff, wireframe:true, opacity:0.6, transparent:true});
  T3.wireframe = new THREE.Mesh(geo, wireMat);
  T3.wireframe.visible = false;
  T3.scene.add(T3.wireframe);

  // エッジ（15度以上の角を強調）
  const edgeGeo = new THREE.EdgesGeometry(geo, 15);
  const edgeMat = new THREE.LineBasicMaterial({color:0x88ccff, linewidth:1});
  T3.edges = new THREE.LineSegments(edgeGeo, edgeMat);
  T3.edges.visible = false;
  T3.scene.add(T3.edges);

  // グリッドをモデル底面に合わせる
  const box = geo.boundingBox;
  const grid = T3.scene.getObjectByName('grid');
  if(grid) grid.position.y = box.min.y;

  T3.loaded = true;

  // 情報表示（多言語対応）
  const sz = box.getSize(new THREE.Vector3());
  const vi = document.getElementById('v3dInfo');
  if(vi) vi.innerHTML =
    `<span style="color:var(--accent2)">${numFaces.toLocaleString()}</span> faces &nbsp;` +
    `<span style="color:var(--accent2)">${(parsed.positions.length/3).toLocaleString()}</span> verts<br>` +
    `<span style="color:var(--dim)">${sz.x.toFixed(1)}×${sz.y.toFixed(1)}×${sz.z.toFixed(1)} mm</span>`;

  reset3DCamera();
  set3DMode(T3.mode);
  if(typeof resetAllClip==='function') resetAllClip();
  return semLabels;
}

function set3DMode(mode) {
  T3.mode = mode;
  ['v3dSolid','v3dWire','v3dSem','v3dEdge'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  document.getElementById({solid:'v3dSolid',wire:'v3dWire',semantic:'v3dSem',edge:'v3dEdge'}[mode])?.classList.add('active');

  if (!T3.mesh) return;
  T3.mesh.visible     = mode === 'solid';
  T3.semMesh.visible  = mode === 'semantic';
  T3.wireframe.visible= mode === 'wire';
  T3.edges.visible    = mode === 'edge';
  render3D();
}

function updateCompass() {
  const svg = document.getElementById('v3dCompass');
  if (!svg) return;
  const t = T3.spherical.theta, p = T3.spherical.phi;
  const cx = 30, cy = 30, r = 22;
  const labels = [
    {label:'X', dx:Math.sin(t), dz:Math.cos(t), col:'#ff6060'},
    {label:'Y', dx:0, dz:-1, col:'#60ff60'},
    {label:'Z', dx:Math.cos(t), dz:-Math.sin(t), col:'#6060ff'},
  ];
  let html = '';
  labels.forEach(ax => {
    const x2 = cx + ax.dx * r * Math.sin(p);
    const y2 = cy - Math.cos(p) * r * 0.6 - ax.dz * r * 0.4;
    html += `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${ax.col}" stroke-width="2"/>`;
    html += `<text x="${x2.toFixed(1)}" y="${(y2+4).toFixed(1)}" text-anchor="middle" fill="${ax.col}" font-size="8" font-family="monospace">${ax.label}</text>`;
  });
  svg.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(6,10,20,0.7)" stroke="rgba(0,180,255,0.2)"/>` + html;
}

// ── LOAD 3D FILE ──
async function load3DFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  showLoading(true, '3Dデータ解析中...');
  document.getElementById('emptyMsg').style.display = 'none';

  try {
    init3D();

    if (ext === 'stl') {
      const buf = await readArrayBuffer(file);
      const parsed = parseSTL(buf);
      const labels = buildMesh(parsed);
      S[`f${S._loading3D}`] = {
        name: file.name, size: file.size, type: '3d',
        format: 'STL', numFaces: parsed.numTri, text: ''
      };
      updateZoneUI(S._loading3D, file.name, `${parsed.numTri.toLocaleString()} 面`, '3d');
    } else if (ext === 'ply') {
      const buf = await readArrayBuffer(file);
      const parsed = parsePLY(buf);
      buildMesh(parsed);
      S[`f${S._loading3D}`]={name:file.name,size:file.size,type:'3d',format:'PLY',numFaces:parsed.numTri,text:''};
      updateZoneUI(S._loading3D, file.name, `PLY: ${parsed.numTri.toLocaleString()} 面`, '3d');
    } else if (ext === 'off') {
      const text = await readDXFText(file);
      const parsed = parseOFF(text);
      buildMesh(parsed);
      S[`f${S._loading3D}`]={name:file.name,size:file.size,type:'3d',format:'OFF',numFaces:parsed.numTri,text:''};
      updateZoneUI(S._loading3D, file.name, `OFF: ${parsed.numTri.toLocaleString()} 面`, '3d');
    } else if (ext === 'obj') {
      const text = await readDXFText(file);
      const parsed = parseOBJ(text);
      const labels = buildMesh(parsed);
      S[`f${S._loading3D}`] = {
        name: file.name, size: file.size, type: '3d',
        format: 'OBJ', numFaces: parsed.numTri, text
      };
      updateZoneUI(S._loading3D, file.name, `${parsed.numTri.toLocaleString()} 面`, '3d');
    } else if(['stp','step'].includes(ext)) {
      const text = await readDXFText(file);
      showLoading(true, 'STEP 解析中...');
      // まず情報表示
      const info = parseSTEPInfo(text);
      try {
        showLoading(true, 'STEP メッシュ生成中...');
        const parsed = parseSTEPMesh(text);
        if (parsed.numTri > 0) {
          init3D();
          buildMesh(parsed);
          S[`f${S._loading3D}`] = {
            name: file.name, size: file.size, type: '3d',
            format: 'STEP', numFaces: parsed.numTri, text, stepInfo: info
          };
          updateZoneUI(S._loading3D, file.name,
            `STEP: ${parsed.numTri.toLocaleString()} 面 (平面近似)`, '3d');
        } else {
          throw new Error('メッシュを生成できませんでした');
        }
      } catch(stepErr) {
        // フォールバック: 情報表示のみ
        console.warn('STEP mesh error:', stepErr);
        S[`f${S._loading3D}`] = {
          name: file.name, size: file.size, type: '3d',
          format: 'STEP', text, stepInfo: info
        };
        render3DPlaceholder(info, file.name);
        updateZoneUI(S._loading3D, file.name, `STEP: ${info.entities} エンティティ (情報のみ)`, '3d');
      }
    }

    // Unlock zone2 in diff mode after file1 loaded
    if(S._loading3D===1&&S.mode==='diff'){
      document.getElementById('zone2').classList.remove('disabled');
      document.getElementById('file2').disabled=false;
      document.getElementById('hint2').innerHTML='ここにドロップ<small>DXF / PDF / IGES / STL / OBJ / PLY / OFF / STEP / 画像</small>';
    }
    // Switch to 3D tab
    switchTab('3d');
    resize3D();
    render3D();
    showLoading(false);
  } catch(e) {
    console.error(e);
    showLoading(false);
    console.error('3D load error:', e.message);
  }
}

// ═══════════════════════════════════════════════════════
//  STEP B-Rep パーサー
//  ADVANCED_FACE → 三角形メッシュ変換（平面 + 円柱面近似）
// ═══════════════════════════════════════════════════════

function parseSTEPMesh(text) {
  const SEGS = 48; // 円分割数（Phase2: 品質向上）

  // ── エンティティ辞書 ──
  const entities = {};
  const pat = /#(\d+)\s*=\s*([A-Z_]+)\s*\(/g;
  let m;
  while((m=pat.exec(text))!==null){
    const eid=parseInt(m[1]),etype=m[2],start=m.index+m[0].length;
    let depth=1,i=start;
    while(i<text.length&&depth>0){ if(text[i]==='(')depth++;else if(text[i]===')')depth--;i++; }
    entities[eid]={type:etype,raw:text.slice(start,i-1)};
  }

  // ── ヘルパー ──
  function refs(raw){const rs=[];const re2=/#(\d+)/g;let m2;while((m2=re2.exec(raw))!==null)rs.push(parseInt(m2[1]));return rs;}
  function floats(raw){const fs=[];const re2=/[-+]?\d+\.?\d*(?:[Ee][-+]?\d+)?/g;let m2;while((m2=re2.exec(raw))!==null)fs.push(parseFloat(m2[0]));return fs;}
  function cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function norm(v){const l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])||1;return[v[0]/l,v[1]/l,v[2]/l];}
  function add3(a,b){return[a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
  function scale3(v,s){return[v[0]*s,v[1]*s,v[2]*s];}

  // ── 座標取得キャッシュ ──
  const ptCache={};
  function getPoint(eid){
    if(ptCache[eid]!==undefined)return ptCache[eid];
    const e=entities[eid];if(!e)return(ptCache[eid]=null);
    if(e.type==='CARTESIAN_POINT'){
      const v=floats(e.raw);return(ptCache[eid]=v.length>=3?v.slice(0,3):v.length>=2?[...v.slice(0,2),0]:null);
    }
    if(e.type==='VERTEX_POINT'){for(const r of refs(e.raw)){const p=getPoint(r);if(p)return(ptCache[eid]=p);}}
    return(ptCache[eid]=null);
  }

  // ── AXIS2_PLACEMENT_3D → center, zdir, xdir ──
  function getAxis2(eid){
    const e=entities[eid];if(!e||e.type!=='AXIS2_PLACEMENT_3D')return null;
    const rs=refs(e.raw);
    const center=getPoint(rs[0])||[0,0,0];
    let zdir=[0,0,1];if(rs[1]){const zd=entities[rs[1]];if(zd&&zd.type==='DIRECTION'){const v=floats(zd.raw);if(v.length>=3)zdir=v.slice(0,3);}}
    let xdir=[1,0,0];if(rs[2]){const xd=entities[rs[2]];if(xd&&xd.type==='DIRECTION'){const v=floats(xd.raw);if(v.length>=3)xdir=v.slice(0,3);}}
    return{center,zdir:norm(zdir),xdir:norm(xdir)};
  }

  // ── CIRCLE → 円周点列（テッセレーション）──
  function circlePoints(eid,segs){
    const e=entities[eid];if(!e||e.type!=='CIRCLE')return[];
    const rs=refs(e.raw);const fs=floats(e.raw);
    const radius=fs[fs.length-1];if(!radius||radius<=0)return[];
    const ax=getAxis2(rs[0]);if(!ax)return[];
    const ydir=norm(cross(ax.zdir,ax.xdir));
    const pts=[];
    for(let i=0;i<segs;i++){
      const a=2*Math.PI*i/segs;
      const ca=Math.cos(a),sa=Math.sin(a);
      pts.push([
        ax.center[0]+radius*(ca*ax.xdir[0]+sa*ydir[0]),
        ax.center[1]+radius*(ca*ax.xdir[1]+sa*ydir[1]),
        ax.center[2]+radius*(ca*ax.xdir[2]+sa*ydir[2]),
      ]);
    }
    return pts;
  }

  // ── EDGE_CURVE のジオメトリ種別 ──
  function edgeGeomType(eid){
    const e=entities[eid];if(!e||e.type!=='EDGE_CURVE')return null;
    for(const r of refs(e.raw)){const ge=entities[r];if(ge&&ge.type==='CIRCLE')return{type:'CIRCLE',id:r};}
    return{type:'LINE'};
  }

  // ── ORIENTED_EDGE → 頂点列 ──
  function orientedEdgePts(eid){
    const e=entities[eid];if(!e||e.type!=='ORIENTED_EDGE')return[];
    const sense=e.raw.includes('.T.');
    for(const r of refs(e.raw)){
      const ve=entities[r];if(!ve||ve.type!=='EDGE_CURVE')continue;
      const gt=edgeGeomType(r);
      if(gt&&gt.type==='CIRCLE'){
        const pts=circlePoints(gt.id,SEGS);
        return sense?pts:[...pts].reverse();
      }
      const rs2=refs(ve.raw);const pts=rs2.slice(0,2).map(getPoint).filter(Boolean);
      return sense?pts:[...pts].reverse();
    }
    return[];
  }

  // ── EDGE_LOOP → 頂点リング ──
  function loopPts(eid){
    const e=entities[eid];if(!e)return[];
    if(e.type==='EDGE_LOOP'){
      const pts=[];const seen=new Set();
      for(const r of refs(e.raw))for(const p of orientedEdgePts(r)){
        if(!p)continue;const key=p.map(x=>Math.round(x*100)).join(',');
        if(!seen.has(key)){seen.add(key);pts.push(p);}
      }
      return pts;
    }
    if(e.type==='FACE_OUTER_BOUND'||e.type==='FACE_BOUND'){
      for(const r of refs(e.raw)){const p=loopPts(r);if(p.length)return p;}
    }
    return[];
  }

  // ── ADVANCED_FACE のbounds/surfを分離 ──
  function parseAdvFace(raw){
    const m=raw.match(/\(([^)]*)\)\s*,\s*#(\d+)/);
    if(!m)return{bounds:[],surfRef:null};
    return{bounds:[...m[1].matchAll(/#(\d+)/g)].map(x=>parseInt(x[1])),surfRef:parseInt(m[2])};
  }

  // ── CYLINDRICAL_SURFACE テッセレーション ──
  function cylTris(surfEid,outerBoundEid){
    const e=entities[surfEid];if(!e||e.type!=='CYLINDRICAL_SURFACE')return[];
    const rs=refs(e.raw);const fs=floats(e.raw);
    const radius=fs[fs.length-1];if(!radius||radius<=0)return[];
    const ax=getAxis2(rs[0]);if(!ax)return[];
    const ydir=norm(cross(ax.zdir,ax.xdir));

    // outer bound の loop から z投影でz_min/z_max を求める
    const ob=entities[outerBoundEid];if(!ob)return[];
    const obrs=refs(ob.raw);const loop=obrs[0]?loopPts(obrs[0]):[];
    if(!loop.length)return[];
    const projs=loop.map(p=>p[0]*ax.zdir[0]+p[1]*ax.zdir[1]+p[2]*ax.zdir[2]);
    const zmin=Math.min(...projs),zmax=Math.max(...projs);
    if(Math.abs(zmax-zmin)<0.0001)return[];

    const tris=[];
    for(let i=0;i<SEGS;i++){
      const a0=2*Math.PI*i/SEGS,a1=2*Math.PI*(i+1)/SEGS;
      const c0=Math.cos(a0),s0=Math.sin(a0),c1=Math.cos(a1),s1=Math.sin(a1);
      function pt(c,s,pz){
        return[
          ax.center[0]+radius*(c*ax.xdir[0]+s*ydir[0])+pz*ax.zdir[0],
          ax.center[1]+radius*(c*ax.xdir[1]+s*ydir[1])+pz*ax.zdir[1],
          ax.center[2]+radius*(c*ax.xdir[2]+s*ydir[2])+pz*ax.zdir[2],
        ];
      }
      const p00=pt(c0,s0,zmin),p10=pt(c1,s1,zmin),p01=pt(c0,s0,zmax),p11=pt(c1,s1,zmax);
      const n=norm(cross([p10[0]-p00[0],p10[1]-p00[1],p10[2]-p00[2]],[p01[0]-p00[0],p01[1]-p00[1],p01[2]-p00[2]]));
      if(!n.some(isNaN)){tris.push([p00,p10,p11,n]);tris.push([p00,p11,p01,n]);}
    }
    return tris;
  }

  // ── CONICAL_SURFACE テッセレーション（円錐面）──
  function coneTris(surfEid,outerBoundEid){
    const e=entities[surfEid];if(!e||e.type!=='CONICAL_SURFACE')return[];
    // 簡略: 円柱面として近似
    return cylTris(surfEid,outerBoundEid);
  }

  // ── 法線計算 ──
  function triNorm(p0,p1,p2){
    const a=[p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]];
    const b=[p2[0]-p0[0],p2[1]-p0[1],p2[2]-p0[2]];
    return norm(cross(a,b));
  }

  // ── Fan三角分割（中心点ベース・退化三角形除去）──
  function fanTris(pts){
    const tris=[];
    if(pts.length<3)return tris;
    // 重心を中心に全頂点からfan（より均一な三角形）
    const cx=pts.reduce((s,p)=>s+p[0],0)/pts.length;
    const cy=pts.reduce((s,p)=>s+p[1],0)/pts.length;
    const cz=pts.reduce((s,p)=>s+p[2],0)/pts.length;
    const cen=[cx,cy,cz];
    const n0=pts.length;
    // 重心fan：中心→連続する2頂点の三角形
    for(let i=0;i<n0;i++){
      const p0=pts[i], p1=pts[(i+1)%n0];
      const d0=Math.hypot(p0[0]-cen[0],p0[1]-cen[1],p0[2]-cen[2]);
      const d1=Math.hypot(p1[0]-cen[0],p1[1]-cen[1],p1[2]-cen[2]);
      if(d0<0.0001||d1<0.0001)continue; // 縮退除去
      const n=triNorm(cen,p0,p1);
      if(!n.some(isNaN)&&!n.some(v=>!isFinite(v))){
        tris.push([cen,p0,p1,n]);
      }
    }
    // 縮退チェック：三角形が極端に小さければスキップ
    return tris.filter(tri=>{
      const a=tri[0],b=tri[1],c=tri[2];
      const area=Math.hypot(
        (b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),
        (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),
        (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
      );
      return area>1e-10;
    });
  }

  // ── メインパース ──
  const allTris=[];
  for(const[eid,e]of Object.entries(entities)){
    if(e.type!=='ADVANCED_FACE')continue;
    const{bounds,surfRef}=parseAdvFace(e.raw);
    if(!bounds.length||!surfRef)continue;
    const surfE=entities[surfRef];if(!surfE)continue;

    const outerBoundEid=bounds[0];

    if(surfE.type==='CYLINDRICAL_SURFACE'||surfE.type==='CONICAL_SURFACE'){
      const tris=cylTris(surfRef,outerBoundEid);
      allTris.push(...tris);
    } else if(surfE.type==='TOROIDAL_SURFACE'){
      // トーラス面（ワッシャーの環状面）→ 簡略: 円柱として近似
      const tris=cylTris(surfRef,outerBoundEid);
      allTris.push(...tris);
    } else if(surfE.type==='SPHERICAL_SURFACE'){
      // 球面 → outerBound のfan分割で近似
      const ob=entities[outerBoundEid];if(!ob) continue;
      const obrs=refs(ob.raw);if(!obrs.length) continue;
      const outer=loopPts(obrs[0]);if(outer.length<3) continue;
      allTris.push(...fanTris(outer));
    } else {
      // 平面系 → outerBound を fan 分割
      const ob=entities[outerBoundEid];if(!ob)continue;
      const obrs=refs(ob.raw);if(!obrs.length)continue;
      const outer=loopPts(obrs[0]);if(outer.length<3)continue;
      const tris=fanTris(outer);
      // innerBound（穴）がある場合は穴の輪郭線を追加（将来的にEarClip）
      // 現在は outer のみ fan 分割（穴は表示しない = 正しく除外）
      allTris.push(...tris);
    }
  }

  // ── Float32Array 生成 ──
  const numTri=allTris.length;
  const positions=new Float32Array(numTri*9);
  const normals=new Float32Array(numTri*9);
  for(let i=0;i<numTri;i++){
    const[p0,p1,p2,n]=allTris[i];
    for(let k=0;k<3;k++){
      const v=[p0,p1,p2][k],base=(i*3+k)*3;
      positions[base]=v[0];positions[base+1]=v[1];positions[base+2]=v[2];
      normals[base]=n[0];normals[base+1]=n[1];normals[base+2]=n[2];
    }
  }
  return{positions,normals,numTri};
}

// ════════════════════════════════════════════════
// IGES パーサー (ASCII固定長形式)
// エンティティ: 110=Line, 100=CircularArc, 116=Point,
//               212=Text, 402=Group, 308=SubfigDef
// ════════════════════════════════════════════════

function parseIGES(text) {
  const rawLines = text.split(/\r?\n/);
  const entities = [];
  const layers = new Set(['0']);

  // ── セクション分離: 行末8文字 = sect(1) + seq(7) ──
  const dirLines = [], paramLines = [], globalLines = [];
  for(const rawLine of rawLines) {
    const line = rawLine.replace(/\r$/,'');
    if(line.length < 8) continue;
    const sect = line[line.length - 8];  // 末尾8文字目 = セクション識別子
    const data = line.slice(0, line.length - 8);
    if(sect==='D') dirLines.push(data);
    else if(sect==='P') paramLines.push({data, seq: parseInt(line.slice(-7).trim())||0});
    else if(sect==='G') globalLines.push(data);
  }

  // Global section → 単位取得
  // IGES G14(unit flag): 1H,区切りのHollerith文字列をスキップして数値のみをカウント
  let scale = 1.0;
  if(globalLines.length) {
    const raw = globalLines.join('').replace(/\s+/g,' ').trim();
    // Hollerith文字列 (nHxxx) をスペースに変換してから数値パラメータを抽出
    const cleaned = raw.replace(/\d+H[^,;]*/g,'H').replace(/;.*$/,'');
    const parts = cleaned.split(',').map(s=>s.trim());
    // 数値のみのパラメータを前から13番目(0-based12番目)がunit flag
    const numParts = parts.filter(p=>/^-?[\d.]+([Ee][+-]?\d+)?$/.test(p));
    if(numParts.length >= 7) {
      // unit flag は数値パラメータの中で G14相当 (概ね7番目以降)
      // 保守的に: "1"=inch のみ変換、それ以外はmm(scale=1)
      const unitFlag = parseInt(numParts[6])||2;
      if(unitFlag===1) scale=25.4;
      else if(unitFlag===3) scale=304.8;
      else if(unitFlag===6) scale=10;
      else if(unitFlag===9) scale=1000;
      // 2=mm, 4=miles, 5=micron, 7=km, 8=mil, 10=microinch → scale=1デフォルト
    }
  }

  // パラメータ行を seq 番号でインデックス
  const paramBySeq = {};
  for(const {data, seq} of paramLines) if(seq>0) {
    paramBySeq[seq] = (paramBySeq[seq]||'') + data;
  }

  // Directory section: 2行で1エンティティ定義
  const dirEntries = [];
  for(let i=0; i+1<dirLines.length; i+=2) {
    const l1=dirLines[i], l2=dirLines[i+1];
    const entityType = parseInt(l1.slice(0,8).trim())||0;
    const paramStart = parseInt(l1.slice(8,16).trim())||0;
    const lineCount  = parseInt(l2.slice(24,32).trim())||1;
    const layerNum   = parseInt(l1.slice(16,24).trim())||0;
    const colorNum   = parseInt(l2.slice(48,56).trim())||0;
    if(entityType>0) dirEntries.push({entityType,paramStart,lineCount,layerNum,colorNum});
    if(layerNum>0) layers.add(String(layerNum));
  }

  // IGES カラーマップ
  const IGES_CLR = {1:'#000000',2:'#FF0000',3:'#00FF00',4:'#0000FF',
                    5:'#FFFF00',6:'#FF00FF',7:'#00FFFF',8:'#FFFFFF'};

  // パラメータ取得
  function getParams(dir) {
    let raw = '';
    for(let i=0; i<=dir.lineCount; i++) {
      const s = dir.paramStart + i;
      if(paramBySeq[s]) raw += paramBySeq[s];
    }
    return raw.replace(/\s+/g,' ').trim().replace(/;\s*$/,'').split(',').map(s=>s.trim());
  }

  function fp(s) { return parseFloat(s)*scale||0; }
  function ok(v) { return isFinite(v)&&Math.abs(v)<1e9; }

  for(const dir of dirEntries) {
    const {entityType, layerNum, colorNum} = dir;
    const color = IGES_CLR[colorNum]||'#00b4ff';
    const layer = String(layerNum||0);
    const params = getParams(dir);
    if(params.length < 2) continue;

    try {
      const type = parseInt(params[0])||entityType;

      if(type===110) {
        // Line: 110, x1,y1,z1, x2,y2,z2
        const x1=fp(params[1]),y1=fp(params[2]);
        const x2=fp(params[4]),y2=fp(params[5]);
        if(ok(x1)&&ok(y1)&&ok(x2)&&ok(y2))
          entities.push({type:'LINE',x1,y1,x2,y2,layer,aci:7,_aciColor:color});

      } else if(type===100) {
        // Circular Arc: 100, zt, cx,cy, sx,sy, ex,ey
        const cx=fp(params[2]),cy=fp(params[3]);
        const sx=fp(params[4]),sy=fp(params[5]);
        const ex=fp(params[6]),ey=fp(params[7]);
        const r=Math.hypot(sx-cx,sy-cy);
        if(!ok(cx)||!ok(cy)||r<=0) continue;
        const sa=(Math.atan2(sy-cy,sx-cx)*180/Math.PI+360)%360;
        const ea=(Math.atan2(ey-cy,ex-cx)*180/Math.PI+360)%360;
        if(Math.hypot(ex-sx,ey-sy)<0.0001*r) {
          entities.push({type:'CIRCLE',cx,cy,r,layer,aci:7,_aciColor:color});
        } else {
          entities.push({type:'ARC',cx,cy,r,startAngle:sa,endAngle:ea,layer,aci:7,_aciColor:color});
        }

      } else if(type===116) {
        // Point: 116, x,y,z
        const x=fp(params[1]),y=fp(params[2]);
        if(ok(x)&&ok(y)) entities.push({type:'POINT',x,y,layer,aci:7,_aciColor:color});

      } else if(type===212) {
        // General Note (Text)
        // 212, nStr, ..., x,y,z, ..., text
        const n=parseInt(params[1])||1;
        // Text appears after many params - try last Hollerith-encoded param
        for(let pi=params.length-1;pi>=2;pi--){
          const m=params[pi].match(/^(\d+)H(.+)$/);
          if(m){
            const x=fp(params[9]||'0'), y=fp(params[10]||'0');
            const h=fp(params[3]||'2');
            if(ok(x)&&ok(y))
              entities.push({type:'TEXT',x,y,h:h||2,text:m[2],
                ha:0,va:0,wf:1,rot:0,layer,aci:7,_aciColor:color});
            break;
          }
        }

      } else if(type===106) {
        // Copious Data (polyline): 106, form, n, x1,y1,z1,...
        const form=parseInt(params[1])||1;
        const n=parseInt(params[2])||0;
        if(n>=2&&params.length>=3+n*3) {
          const pts=[];
          for(let i=0;i<n;i++){
            const x=fp(params[3+i*3]),y=fp(params[4+i*3]);
            if(ok(x)&&ok(y)) pts.push({x,y});
          }
          if(pts.length>=2) entities.push({type:'LWPOLYLINE',pts,layer,aci:7,_aciColor:color,closed:false});
        }
      }
    } catch(e) {}
  }

  return { entities, layers:[...layers], aciMap:{} };
}

function parseSTEPInfo(text) {
  const lines = text.split('\n');
  let entities = 0, product = '', unit = '', description = '';
  for (const line of lines) {
    if (line.startsWith('#')) entities++;
    if (line.includes('PRODUCT(') && !product) {
      const m = line.match(/PRODUCT\('([^']+)'/);
      if (m) product = m[1];
    }
    if (line.includes('CONVERSION_BASED_UNIT') || line.includes('SI_UNIT')) {
      if (line.includes('METRE')) unit = 'm';
      else if (line.includes('MILLI')) unit = 'mm';
      else if (line.includes('INCH')) unit = 'inch';
    }
    if (line.includes('FILE_DESCRIPTION') && !description) {
      const m = line.match(/\('([^']+)'/);
      if (m) description = m[1];
    }
  }
  return {entities, product, unit, description};
}

function render3DPlaceholder(info, filename) {
  ['mesh','edges','wireframe','semMesh'].forEach(k => {
    if (T3[k]) { T3.scene.remove(T3[k]); T3[k] = null; }
  });
  // Draw a placeholder box with STEP info label
  const geo = new THREE.BoxGeometry(2, 1.5, 2);
  const edges = new THREE.EdgesGeometry(geo);
  const mat = new THREE.LineBasicMaterial({color: 0x00ffd0});
  T3.edges = new THREE.LineSegments(edges, mat);
  T3.edges.visible = true;
  T3.scene.add(T3.edges);
  document.getElementById('v3dInfo').innerHTML =
    `<b style="color:var(--accent2)">STEP ファイル</b><br>` +
    `製品名: ${info.product||'—'}<br>単位: ${info.unit||'—'}<br>エンティティ数: ${info.entities}<br>` +
    `<span style="color:var(--warn)">※ STEPのフル3Dレンダリングにはサーバーサイド変換が必要です</span>`;
  reset3DCamera();
}

// ── dz-badge type for 3d ──
// (type-3d style)




// ═══════════════════════════════════════════
// 断面（クリッピングプレーン）機能
// ═══════════════════════════════════════════

function toggleClipPanel(){
  const panel = document.getElementById('v3dClipPanel');
  const btn   = document.getElementById('v3dClip');
  const open  = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = open ? 'flex' : 'none';
  btn.classList.toggle('active', open);
  if(!open) resetAllClip();
}

function updateClipPlanes(){
  if(!T3.renderer || !T3.mesh) return;
  const box = T3.mesh.geometry.boundingBox;
  if(!box) return;

  const vX = parseFloat(document.getElementById('clipX').value)/100;
  const vY = parseFloat(document.getElementById('clipY').value)/100;
  const vZ = parseFloat(document.getElementById('clipZ').value)/100;

  // スライダー値 -1~1 → モデルのbounding boxに合わせた実座標
  const planes = [];
  if(vX < 1){
    const cut = box.min.x + (box.max.x - box.min.x) * (vX * 0.5 + 0.5);
    planes.push(new THREE.Plane(new THREE.Vector3(-1,0,0), cut));
  }
  if(vY < 1){
    const cut = box.min.y + (box.max.y - box.min.y) * (vY * 0.5 + 0.5);
    planes.push(new THREE.Plane(new THREE.Vector3(0,-1,0), cut));
  }
  if(vZ < 1){
    const cut = box.min.z + (box.max.z - box.min.z) * (vZ * 0.5 + 0.5);
    planes.push(new THREE.Plane(new THREE.Vector3(0,0,-1), cut));
  }

  T3.renderer.localClippingEnabled = planes.length > 0;

  // 全メッシュにクリッピングプレーンを設定
  ['mesh','wireframe','semMesh','edges'].forEach(key => {
    if(!T3[key]) return;
    const obj = T3[key];
    if(obj.material){
      obj.material.clippingPlanes = planes;
      obj.material.needsUpdate = true;
    }
  });

  // キャップ面の更新
  updateClipCaps(planes, box, vX, vY, vZ);

  render3D();
}

function updateClipCaps(planes, box, vX, vY, vZ){
  // 既存のキャップを削除
  const toRemove = [];
  T3.scene.traverse(obj => { if(obj.userData.isCap) toRemove.push(obj); });
  toRemove.forEach(obj => T3.scene.remove(obj));

  if(planes.length === 0) return;

  const sz = box.getSize(new THREE.Vector3());
  const capSize = Math.max(sz.x, sz.y, sz.z) * 1.5;

  // X軸キャップ
  if(vX < 1){
    const cut = box.min.x + (box.max.x - box.min.x) * (vX * 0.5 + 0.5);
    addCap([0,0,cut,0,1,0], capSize, 0x00ffd0, planes, 'x', cut);
  }
  // Y軸キャップ
  if(vY < 1){
    const cut = box.min.y + (box.max.y - box.min.y) * (vY * 0.5 + 0.5);
    addCap([cut,0,0, 0,0,1], capSize, 0x00b4ff, planes, 'y', cut);
  }
  // Z軸キャップ
  if(vZ < 1){
    const cut = box.min.z + (box.max.z - box.min.z) * (vZ * 0.5 + 0.5);
    addCap([0,cut,0, 1,0,0], capSize, 0xff9900, planes, 'z', cut);
  }
}

function addCap(posRot, size, color, allPlanes, axis, cutPos){
  // キャップ面: 他の断面平面でもクリップされるべき
  const capPlanes = allPlanes.filter(p => {
    // このキャップ自身の軸のプレーンは除く
    if(axis==='x' && p.normal.x !== 0) return false;
    if(axis==='y' && p.normal.y !== 0) return false;
    if(axis==='z' && p.normal.z !== 0) return false;
    return true;
  });

  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide,
    transparent: true, opacity: 0.55,
    clippingPlanes: capPlanes,
    depthWrite: false,
  });
  const cap = new THREE.Mesh(geo, mat);
  cap.userData.isCap = true;

  if(axis === 'x'){
    cap.rotation.y = Math.PI/2;
    cap.position.set(cutPos, 0, 0);
  } else if(axis === 'y'){
    cap.rotation.x = Math.PI/2;
    cap.position.set(0, cutPos, 0);
  } else {
    cap.position.set(0, 0, cutPos);
  }
  T3.scene.add(cap);
}

function resetClipAxis(axis){
  document.getElementById('clip'+axis).value = 100;
  updateClipPlanes();
}

function resetAllClip(){
  ['clipX','clipY','clipZ'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = 100;
  });
  // クリッピング解除
  T3.renderer && (T3.renderer.localClippingEnabled = false);
  ['mesh','wireframe','semMesh','edges'].forEach(key => {
    if(!T3[key]) return;
    if(T3[key].material){
      T3[key].material.clippingPlanes = [];
      T3[key].material.needsUpdate = true;
    }
  });
  const toRemove = [];
  T3.scene && T3.scene.traverse(obj => { if(obj.userData.isCap) toRemove.push(obj); });
  toRemove.forEach(obj => T3.scene.remove(obj));
  render3D();
}

// ═══════════════════════════════════════════
// PLY パーサー (ASCII + Binary)
// ═══════════════════════════════════════════
function parsePLY(buffer){
  const bytes = new Uint8Array(buffer);
  // ヘッダー読み込み
  let headerEnd = 0;
  for(let i=0; i<bytes.length-3; i++){
    if(bytes[i]===101&&bytes[i+1]===110&&bytes[i+2]===100&&bytes[i+3]===95){
      // "end_" → "end_header"
      let j=i;
      while(j<bytes.length&&bytes[j]!==10) j++;
      headerEnd = j+1;
      break;
    }
  }
  const headerText = new TextDecoder().decode(bytes.slice(0,headerEnd));
  const lines = headerText.split('\n');

  let format='ascii', numVerts=0, numFaces=0;
  let hasNormal=false, hasColor=false;
  const props=[];

  for(const line of lines){
    const parts=line.trim().split(/\s+/);
    if(parts[0]==='format') format=parts[1];
    if(parts[0]==='element'&&parts[1]==='vertex') numVerts=parseInt(parts[2]);
    if(parts[0]==='element'&&parts[1]==='face') numFaces=parseInt(parts[2]);
    if(parts[0]==='property'&&parts[1]!=='list') props.push(parts[2]);
  }
  hasNormal = props.includes('nx');
  hasColor  = props.includes('red')||props.includes('r');

  const positions = new Float32Array(numFaces*9);
  const normals   = new Float32Array(numFaces*9);

  if(format==='ascii'){
    const body = new TextDecoder().decode(bytes.slice(headerEnd)).split('\n');
    const verts=[];
    let li=0;
    // 頂点
    for(let i=0;i<numVerts;i++){
      const p=body[li++].trim().split(/\s+/).map(Number);
      verts.push({x:p[0],y:p[1],z:p[2],
        nx:hasNormal?p[3]:0, ny:hasNormal?p[4]:0, nz:hasNormal?p[5]:0});
    }
    // 面
    let fi=0;
    for(let i=0;i<numFaces;i++){
      const p=body[li++].trim().split(/\s+/).map(Number);
      const n=p[0]; // vertex count
      for(let t=0;t<n-2;t++){
        const i0=p[1], i1=p[2+t], i2=p[3+t];
        const v=[verts[i0],verts[i1],verts[i2]];
        for(let k=0;k<3;k++){
          positions[fi*9+k*3]  =v[k].x;
          positions[fi*9+k*3+1]=v[k].y;
          positions[fi*9+k*3+2]=v[k].z;
          // 法線がなければ計算
          if(!hasNormal){
            const ax=v[1].x-v[0].x,ay=v[1].y-v[0].y,az=v[1].z-v[0].z;
            const bx=v[2].x-v[0].x,by=v[2].y-v[0].y,bz=v[2].z-v[0].z;
            normals[fi*9+k*3]  =ay*bz-az*by;
            normals[fi*9+k*3+1]=az*bx-ax*bz;
            normals[fi*9+k*3+2]=ax*by-ay*bx;
          } else {
            normals[fi*9+k*3]  =v[k].nx;
            normals[fi*9+k*3+1]=v[k].ny;
            normals[fi*9+k*3+2]=v[k].nz;
          }
        }
        fi++;
      }
    }
    return {positions:positions.slice(0,fi*9),normals:normals.slice(0,fi*9),numTri:fi};
  } else {
    // Binary (little-endian)
    const dv = new DataView(buffer, headerEnd);
    const verts=[];
    const propSizes={'char':1,'uchar':1,'short':2,'ushort':2,'int':4,'uint':4,'float':4,'double':8};
    let off=0;
    for(let i=0;i<numVerts;i++){
      const x=dv.getFloat32(off,true);off+=4;
      const y=dv.getFloat32(off,true);off+=4;
      const z=dv.getFloat32(off,true);off+=4;
      let nx=0,ny=0,nz=0;
      if(hasNormal){nx=dv.getFloat32(off,true);off+=4;ny=dv.getFloat32(off,true);off+=4;nz=dv.getFloat32(off,true);off+=4;}
      // skip remaining props
      const extraProps=props.filter(p=>!['x','y','z','nx','ny','nz'].includes(p));
      extraProps.forEach(()=>{off+=4;});
      verts.push({x,y,z,nx,ny,nz});
    }
    let fi=0;
    for(let i=0;i<numFaces;i++){
      const n=dv.getUint8(off);off++;
      const ids=[];
      for(let k=0;k<n;k++){ids.push(dv.getUint32(off,true));off+=4;}
      for(let t=0;t<n-2;t++){
        const v=[verts[ids[0]],verts[ids[1+t]],verts[ids[2+t]]];
        for(let k=0;k<3;k++){
          positions[fi*9+k*3]=v[k].x;positions[fi*9+k*3+1]=v[k].y;positions[fi*9+k*3+2]=v[k].z;
          normals[fi*9+k*3]=v[k].nx;normals[fi*9+k*3+1]=v[k].ny;normals[fi*9+k*3+2]=v[k].nz;
        }
        fi++;
      }
    }
    return {positions:positions.slice(0,fi*9),normals:normals.slice(0,fi*9),numTri:fi};
  }
}

// ═══════════════════════════════════════════
// OFF パーサー (Object File Format)
// ═══════════════════════════════════════════
function parseOFF(text){
  const lines=text.split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));
  let li=0;
  if(lines[li].startsWith('OFF')) li++;
  const [nv,nf]=lines[li++].split(/\s+/).map(Number);
  const verts=[];
  for(let i=0;i<nv;i++){
    const p=lines[li++].split(/\s+/).map(Number);
    verts.push([p[0],p[1],p[2]]);
  }
  let fi=0;
  const positions=new Float32Array(nf*9), normals=new Float32Array(nf*9);
  for(let i=0;i<nf;i++){
    const p=lines[li++].split(/\s+/).map(Number);
    const n=p[0];
    for(let t=0;t<n-2;t++){
      const v=[verts[p[1]],verts[p[2+t]],verts[p[3+t]]];
      const ax=v[1][0]-v[0][0],ay=v[1][1]-v[0][1],az=v[1][2]-v[0][2];
      const bx=v[2][0]-v[0][0],by=v[2][1]-v[0][1],bz=v[2][2]-v[0][2];
      const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
      for(let k=0;k<3;k++){
        positions[fi*9+k*3]=v[k][0];positions[fi*9+k*3+1]=v[k][1];positions[fi*9+k*3+2]=v[k][2];
        normals[fi*9+k*3]=nx;normals[fi*9+k*3+1]=ny;normals[fi*9+k*3+2]=nz;
      }
      fi++;
    }
  }
  return{positions:positions.slice(0,fi*9),normals:normals.slice(0,fi*9),numTri:fi};
}

function parseIGESInfo(text){
  const lines=text.split('\n');
  const de=lines.filter(l=>l.length>=73&&l[72]==='D');
  const entities=Math.floor(de.length/2);
  let product='',unit='mm';
  const g=lines.filter(l=>l.length>=73&&l[72]==='G');
  if(g.length){
    const gt=g.map(l=>l.slice(0,72)).join('');
    const p=gt.split(',');
    if(p[12])product=p[12].replace(/;.*$/,'').replace(/['"]/g,'').trim();
    const um={1:'inch',2:'mm',3:'ft',5:'m',6:'km',9:'cm'};
    if(um[parseInt(p[14])])unit=um[parseInt(p[14])];
  }
  return{entities,product,unit,description:`IGESファイル - ${entities}エンティティ`};
}




// ── 取説モーダル ──
function showHelp(){
  document.getElementById('helpModal').classList.add('show');
}
function hideHelp(){
  document.getElementById('helpModal').classList.remove('show');
}
function switchHelpTab(idx){
  document.querySelectorAll('.help-tab').forEach((t,i)=>t.classList.toggle('active',i===idx));
  document.querySelectorAll('.help-section').forEach((s,i)=>s.classList.toggle('active',i===idx));
}
// ESCキーで閉じる
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideHelp();});
// モーダル背景クリックで閉じる
document.getElementById('helpModal')?.addEventListener('click',e=>{
  if(e.target.id==='helpModal') hideHelp();
});

// ── タブレット: コンテキストメニュー・テキスト選択防止 ──
document.addEventListener('contextmenu', e=>{
  if(e.target.closest('#canvasWrap')) e.preventDefault();
});

// ═══════════════════════════════════════════════════════
// WINDOW REGISTRATION
// Expose state + functions to global scope so inline
// onclick="foo()" handlers in JSX continue to work.
// ═══════════════════════════════════════════════════════

window.S = S
window.LAYER_COLORS = LAYER_COLORS
window.LANG = typeof LANG !== 'undefined' ? LANG : null

const __viewerExports = {
  getLayerColor, aciToHex, filterXMarks, parseDXF, readEntPairs, parseOneEntity,
  expandInsert, applyAci, buildEnt, eKey, diffDXF, entBounds, computeBounds,
  layerCenter, W, matchRadius, classifyEntity, analyzeSemantics, semColor,
  setColorMode, buildSemLegend, toggleSemType, drawEnt, getLayerOffset,
  redrawDXFRaf, redrawDXF, renderPDFPage, buildPixelDiff, redrawPDF, fitView,
  zoom, hitTest, distToEnt, distToSegment, extractPDFText, textDiff,
  renderTextDiff, buildStructHTML, buildLayerPanel, toggleLayer, setExplode,
  setupZone, setupBodyDrop, handleFile, updateZoneUI, clearFile, clearZoneUI,
  runMain, runSingle, runDiff, updateStructPanel, rerun, changePage,
  updateStats, resetStats, updatePageNav, resetCanvas, showToast, showLoading,
  toggleLeg, setEF, renderEntList, filterEntList, selectEnt, findNearbyTexts,
  findAssociatedTexts, showInspector, setSideTab, setMode, entDetail,
  esc, formatBytes, readDXFText, t, applyLang, toggleDropZone, toggleHeader,
  switchLang, validCoord, validPt, parseDWGLine, parseDWGCircle, parseDWGArc,
  parseDWGLWPolyline, parseDWGText, parseR2000, scanDWGEntities, parseDWG,
  init3D, updateCamera3D, resize3D, render3D, reset3DCamera, parseSTL,
  isBinarySTL, parseSTLBinary, parseSTLASCII, parseOBJ, buildMesh, set3DMode,
  updateCompass, load3DFile, parseSTEPMesh, parseIGES, parseSTEPInfo,
  render3DPlaceholder, toggleClipPanel, updateClipPlanes, updateClipCaps,
  addCap, resetClipAxis, resetAllClip, parsePLY, parseOFF, parseIGESInfo,
  showHelp, hideHelp, switchHelpTab
}
for (const [name, fn] of Object.entries(__viewerExports)) {
  if (typeof fn === 'function') window[name] = fn
}
// switchTab: the init() IIFE wraps the original to also toggle the layers-tab
// preview. Only install our fallback if that override hasn't been set.
if (typeof window.switchTab !== 'function') window.switchTab = switchTab

// Flag indicating the legacy viewer is fully loaded & registered
window.__viewerReady = true
export const viewerReady = true
