/* codekit.js — 학생용 학습지 공용: 파이썬 신택스 하이라이팅, 복사 단추, Pyodide 코드 편집기, 예시 코드 팝업 */
(function(){
"use strict";
var PYODIDE="https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
var TIMEOUT_MS=15000;

/* ---------- 신택스 하이라이팅 ---------- */
var KW={},CN={True:1,False:1,None:1},BI={};
"and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" ").forEach(function(w){KW[w]=1;});
("print len range int str float list dict set tuple bool sum min max abs sorted reversed enumerate zip map filter any all isinstance type input open iter next round divmod pow repr hash id ord chr bin hex oct format super object property staticmethod classmethod "+
 "Exception ValueError TypeError IndexError KeyError AssertionError NotImplementedError StopIteration RuntimeError ZeroDivisionError RecursionError AttributeError").split(" ").forEach(function(w){BI[w]=1;});
var TOKEN=/(#[^\n]*)|((?:[rRbBuUfF]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(@[A-Za-z_][\w.]*)|(\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_]\w*)|([\s\S])/g;
function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function highlight(src){
  var out="",m,prev="";
  TOKEN.lastIndex=0;
  while((m=TOKEN.exec(src))!==null){
    var t=m[0];
    if(m[1])out+='<span class="tk-cm">'+esc(t)+"</span>";
    else if(m[2])out+='<span class="tk-str">'+esc(t)+"</span>";
    else if(m[3])out+='<span class="tk-dec">'+esc(t)+"</span>";
    else if(m[4])out+='<span class="tk-num">'+esc(t)+"</span>";
    else if(m[5]){
      if(prev==="def"||prev==="class")out+='<span class="tk-fn">'+t+"</span>";
      else if(KW[t])out+='<span class="tk-kw">'+t+"</span>";
      else if(CN[t])out+='<span class="tk-cn">'+t+"</span>";
      else if(BI[t])out+='<span class="tk-bi">'+t+"</span>";
      else out+=t;
      prev=t;
    }else{
      out+=esc(t);
      if(!/\s/.test(t))prev="";
    }
  }
  return out;
}
function q(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel));}

function highlightBlocks(){
  q("pre > code.language-python").forEach(function(c){
    if(c.getAttribute("data-hl"))return;
    c.innerHTML=highlight(c.textContent);
    c.setAttribute("data-hl","1");
  });
}

/* ---------- 복사 ---------- */
function copyText(text,done){
  function fallback(){
    var ta=document.createElement("textarea");
    ta.value=text;ta.setAttribute("readonly","");ta.style.cssText="position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);ta.select();
    var ok=false;try{ok=document.execCommand("copy");}catch(e){}
    document.body.removeChild(ta);done(ok);
  }
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(text).then(function(){done(true);},fallback);
  }else fallback();
}
function flash(btn,label){
  var old=btn.getAttribute("data-label0")||btn.textContent;
  btn.setAttribute("data-label0",old);
  btn.textContent=label;
  clearTimeout(btn._t);
  btn._t=setTimeout(function(){btn.textContent=old;},1300);
}
function bindCopyButtons(){
  q(".codewrap > .copy").forEach(function(b){
    if(b._ck)return;b._ck=true;
    b.addEventListener("click",function(){
      var c=b.parentElement.querySelector("pre");
      copyText(c.textContent,function(ok){flash(b,ok?"복사됨":"복사 실패");});
    });
  });
}

/* ---------- Pyodide (Web Worker, 페이지 하나가 파이썬 환경 하나를 공유) ---------- */
var WORKER_SRC=
'var py=null,ready=null,muted=false;\n'+
'function init(){\n'+
' if(!ready)ready=(async function(){\n'+
'  importScripts("'+PYODIDE+'pyodide.js");\n'+
'  py=await loadPyodide({indexURL:"'+PYODIDE+'"});\n'+
'  py.setStdout({batched:function(s){if(!muted)postMessage({t:"out",s:s});}});\n'+
'  py.setStderr({batched:function(s){if(!muted)postMessage({t:"err",s:s});}});\n'+
' })();\n'+
' return ready;\n'+
'}\n'+
'onmessage=async function(e){\n'+
' var d=e.data;\n'+
' try{\n'+
'  postMessage({t:"state",s:"loading"});\n'+
'  await init();\n'+
'  postMessage({t:"state",s:"running"});\n'+
'  if(d.pre&&d.pre.length){muted=true;try{for(var i=0;i<d.pre.length;i++)await py.runPythonAsync(d.pre[i]);}catch(e2){muted=false;postMessage({t:"fail",id:d.id,m:"[앞 코드를 불러오다 오류] "+String(e2&&e2.message?e2.message:e2)});return;}muted=false;}\n'+
'  await py.runPythonAsync(d.code);\n'+
'  postMessage({t:"done",id:d.id});\n'+
' }catch(err){postMessage({t:"fail",id:d.id,m:String(err&&err.message?err.message:err)});}\n'+
'};';
var worker=null,current=null;
function newWorker(){
  var url=URL.createObjectURL(new Blob([WORKER_SRC],{type:"text/javascript"}));
  worker=new Worker(url);
  worker.onmessage=function(e){if(current)current.onmsg(e.data);};
  worker.onerror=function(e){if(current){current.onmsg({t:"fail",m:"파이썬 환경을 시작하지 못했다. 인터넷 연결을 확인한 뒤 다시 실행한다."});}};
}
function resetWorker(){
  if(worker){worker.terminate();worker=null;}
}
function cleanTrace(m){
  var i=m.indexOf('File "<exec>"');
  if(i>0)return "Traceback (most recent call last):\n  "+m.slice(i);
  return m;
}
/* ---------- 실행 기록(쪽 사이 코드 불러오기, 시간 초과 뒤 복원) ---------- */
var WEEK=(/week(\d+)\//.exec(location.pathname)||[0,"x"])[1];
var PAGE=location.pathname.split("/").pop();
var SS="ck:env:"+WEEK;
var pageRuns={},autoRestore=false,prevLoaded=false;
/* 새 탭으로 열어도 앞 쪽 기록이 보이도록 localStorage 를 쓰고, 8시간이 지난 기록은 버린다 */
var TTL_MS=8*3600*1000;
function ssLoad(){
  var o={};
  try{o=JSON.parse(localStorage.getItem(SS)||"{}")||{};}catch(e){try{o=JSON.parse(sessionStorage.getItem(SS)||"{}")||{};}catch(e2){o={};}}
  var now=Date.now();Object.keys(o).forEach(function(k){if(!o[k]||now-o[k].t>TTL_MS)delete o[k];});
  return o;
}
function ssSave(o){
  var j=JSON.stringify(o);
  try{localStorage.setItem(SS,j);}catch(e){try{sessionStorage.setItem(SS,j);}catch(e2){}}
}
function record(id,code){
  pageRuns[id]={t:Date.now(),code:code};
  var all=ssLoad();all[PAGE+"|"+id]={page:PAGE,t:Date.now(),code:code};ssSave(all);
}
function sortedCodes(map){return Object.keys(map).map(function(k){return map[k];}).sort(function(a,b){return a.t-b.t;}).map(function(r){return r.code;});}
function otherPageEntries(){
  var all=ssLoad(),m={};
  Object.keys(all).forEach(function(k){if(all[k]&&all[k].page!==PAGE)m[k]=all[k];});
  return m;
}
function restoreList(excludeId){
  var own={};Object.keys(pageRuns).forEach(function(k){if(k!==excludeId)own[k]=pageRuns[k];});
  return (prevLoaded?sortedCodes(otherPageEntries()):[]).concat(sortedCodes(own));
}
function clearPageRuns(){
  pageRuns={};autoRestore=false;prevLoaded=false;
  var all=ssLoad();Object.keys(all).forEach(function(k){if(all[k]&&all[k].page===PAGE)delete all[k];});ssSave(all);
}
function runCode(code,ui,pre){
  if(current)return;
  if(!worker)newWorker();
  var text="",timer=null,finished=false;
  function finish(kind,extra){
    if(finished)return;finished=true;
    clearTimeout(timer);current=null;
    ui.finish(kind,text,extra);
  }
  current={onmsg:function(d){
    if(d.t==="state")ui.state(d.s);
    else if(d.t==="out"||d.t==="err"){text+=d.s+"\n";ui.partial(text);}
    else if(d.t==="done")finish("ok");
    else if(d.t==="fail")finish("error",cleanTrace(d.m));
  }};
  ui.state("loading");
  /* 시간 제한은 파이썬 환경이 준비된 뒤부터 센다 */
  var armed=false;
  var origState=ui.state;
  ui.state=function(s){origState(s);if(s==="running"&&!armed){armed=true;timer=setTimeout(function(){resetWorker();finish("timeout");},TIMEOUT_MS);}};
  worker.postMessage({id:1,code:code,pre:pre||[]});
}
function busyAll(b){q(".ck-btn.run").forEach(function(x){x.disabled=b;});}

/* ---------- 예시 코드 팝업 ---------- */
var modal=null,lastFocus=null;
var ROLE_LABEL={demo:"예시",skeleton:"뼈대",test:"테스트",bug:"오류 코드",given:"제공 코드"};
function ensureModal(){
  if(modal)return modal;
  modal=document.createElement("div");modal.className="ck-modal";modal.hidden=true;
  modal.innerHTML='<div class="ck-dlg" role="dialog" aria-modal="true" aria-labelledby="ck-mt"><header><h3 id="ck-mt">예시 코드</h3><button type="button" class="ck-btn" data-x>닫기</button></header><div class="ck-body"></div></div>';
  document.body.appendChild(modal);
  modal.addEventListener("click",function(e){if(e.target===modal||e.target.hasAttribute("data-x"))closeModal();});
  document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!modal.hidden)closeModal();});
  return modal;
}
function closeModal(){
  modal.hidden=true;
  if(lastFocus&&lastFocus.focus)lastFocus.focus();
}
function blockTitle(code){
  var wrap=code.closest(".codewrap")||code.parentElement,el=wrap.previousElementSibling;
  while(el){
    if(/^H[2-4]$/.test(el.tagName))return el.textContent.replace(/\s+/g," ").trim();
    el=el.previousElementSibling;
  }
  return code.getAttribute("data-id")||"";
}
function openExamples(ed){
  ensureModal();
  var sec=ed.box.closest("section")||document;
  /* 아직 열지 않은 접힘 블록(details)과 data-noex 블록은 보여 주지 않는다 */
  var blocks=q("pre > code[data-role]",sec).filter(function(c){
    if(c.hasAttribute("data-noex")||c.closest("details:not([open])"))return false;
    /* data-for="편집기 data-key"가 있으면 그 편집기의 팝업에만 나온다 */
    var f=c.closest("[data-for]");
    return !f||f.getAttribute("data-for")===ed.ta.getAttribute("data-key");
  });
  var body=modal.querySelector(".ck-body");
  body.innerHTML="";
  if(!blocks.length){
    body.innerHTML='<p>이 활동에는 따로 제시된 예시 코드가 없다.</p>';
  }
  blocks.forEach(function(c){
    var item=document.createElement("div");item.className="ck-item";
    var head=document.createElement("div");head.className="ck-ih";
    var b=document.createElement("b");
    b.textContent="["+(ROLE_LABEL[c.getAttribute("data-role")]||"코드")+"] "+blockTitle(c);
    var cp=document.createElement("button");cp.type="button";cp.className="ck-btn";cp.textContent="복사";
    var put=document.createElement("button");put.type="button";put.className="ck-btn";put.textContent="편집기에 추가";
    head.appendChild(b);head.appendChild(cp);head.appendChild(put);
    var pre=document.createElement("pre");var code=document.createElement("code");
    code.innerHTML=highlight(c.textContent);pre.appendChild(code);
    item.appendChild(head);item.appendChild(pre);body.appendChild(item);
    cp.addEventListener("click",function(){copyText(c.textContent,function(ok){flash(cp,ok?"복사됨":"복사 실패");});});
    put.addEventListener("click",function(){
      var cur=ed.ta.value.replace(/\s+$/,""),add=c.textContent.replace(/\s+$/,"");
      ed.set((cur?cur+"\n\n":"")+add+"\n");
      flash(put,"추가됨");
      ed.ta.scrollTop=ed.ta.scrollHeight;
    });
  });
  var hint=document.createElement("p");hint.className="ck-hint";
  hint.textContent="이 활동에 나온 코드를 모아 보여 준다. [편집기에 추가]를 누르면 편집기의 맨 아래에 이 코드가 이어서 붙는다. 앞 활동의 코드가 필요하면 먼저 추가해서 실행한다. 실행 환경은 이 페이지 안에서 공유되어, 앞에서 실행한 함수와 변수가 남아 있다.";
  body.appendChild(hint);
  lastFocus=document.activeElement;
  modal.hidden=false;
  modal.querySelector("[data-x]").focus();
}

/* ---------- 코드 편집기 ---------- */
var D=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value");
function buildEditor(ta){
  var label=ta.closest("label"),title="";
  var host=label||ta;
  if(label){
    title=Array.prototype.filter.call(label.childNodes,function(n){return n.nodeType===3;}).map(function(n){return n.textContent;}).join("").trim();
  }
  if(!title)title=ta.getAttribute("data-label")||"코드";
  var box=document.createElement("div");box.className="ck-ed";
  var bar=document.createElement("div");bar.className="ck-bar";
  var ttl=document.createElement("span");ttl.className="ck-title";ttl.textContent=title;
  var bEx=mk("예시 코드"),bRun=mk("▶ 실행");bRun.classList.add("run");
  var bPrev=mk("앞 쪽 코드 불러오기");bPrev.title="같은 주차의 다른 쪽에서 성공적으로 실행한 코드를 이 쪽의 파이썬 환경에 먼저 실행해 둔다";
  var bRst=mk("실행 환경 초기화");bRst.title="앞에서 실행한 정의(함수·변수)를 모두 지운다";
  var edId=ta.getAttribute("data-key")||("ed"+q("textarea.code").indexOf(ta));
  bar.appendChild(ttl);
  if(!ta.hasAttribute("data-noex"))bar.appendChild(bEx);
  if(!ta.hasAttribute("data-noprev"))bar.appendChild(bPrev);
  bar.appendChild(bRun);bar.appendChild(bRst);
  var area=document.createElement("div");area.className="ck-area";
  var hl=document.createElement("pre");hl.className="ck-hl";hl.setAttribute("aria-hidden","true");
  var hc=document.createElement("code");hl.appendChild(hc);
  var gut=document.createElement("div");gut.className="ck-gut";gut.setAttribute("aria-hidden","true");
  var out=document.createElement("div");out.className="ck-out";out.hidden=true;
  var ol=document.createElement("div");ol.className="ck-ol";
  var op=document.createElement("pre");op.setAttribute("aria-live","polite");
  out.appendChild(ol);out.appendChild(op);
  host.parentNode.insertBefore(box,host);
  if(!ta.getAttribute("aria-label"))ta.setAttribute("aria-label",ta.getAttribute("data-label")||title);
  ta.classList.add("ck-ta");
  area.appendChild(gut);area.appendChild(hl);area.appendChild(ta);
  box.appendChild(bar);box.appendChild(area);box.appendChild(out);
  if(label)label.remove();
  function mk(t){var b=document.createElement("button");b.type="button";b.className="ck-btn";b.textContent=t;return b;}
  var gutN=0;
  function render(){
    var v=D.get.call(ta);hc.innerHTML=highlight(v)+"\n";
    var n=v.split("\n").length;
    if(n!==gutN){var t=[];for(var i=1;i<=n;i++)t.push(i);gut.textContent=t.join("\n");gutN=n;}
  }
  function sync(){hl.scrollTop=ta.scrollTop;hl.scrollLeft=ta.scrollLeft;gut.scrollTop=ta.scrollTop;}
  Object.defineProperty(ta,"value",{get:function(){return D.get.call(ta);},set:function(v){D.set.call(ta,v);render();},configurable:true});
  ta.addEventListener("input",render);
  ta.addEventListener("scroll",sync);
  render();
  var ed={box:box,ta:ta,set:function(v){ta.value=v;ta.dispatchEvent(new Event("input",{bubbles:true}));}};

  /* Tab: 4칸 들여쓰기, Shift+Tab: 내어쓰기. 여러 줄을 고르면 고른 줄 전체에 적용한다(Esc 후 Tab으로 다음 칸 이동) */
  function put(text){
    var before=ta.value,a=ta.selectionStart,b=ta.selectionEnd;
    try{document.execCommand("insertText",false,text);}catch(_){}
    if(ta.value===before)ta.setRangeText(text,a,b,"end");
  }
  function tabKey(e){
    var v=ta.value,s=ta.selectionStart,en=ta.selectionEnd;
    var multi=v.slice(s,en).indexOf("\n")>=0;
    e.preventDefault();
    if(!e.shiftKey&&!multi){put("    ");ta.dispatchEvent(new Event("input",{bubbles:true}));return;}
    var ls=v.lastIndexOf("\n",s-1)+1,end=(en>s&&v.charAt(en-1)==="\n")?en-1:en;
    var le=v.indexOf("\n",end);if(le<0)le=v.length;
    var lines=v.slice(ls,le).split("\n"),first=0,i;
    for(i=0;i<lines.length;i++){
      var ln=lines[i],d;
      if(e.shiftKey){var m=/^( {1,4}|\t)/.exec(ln);d=m?m[0].length:0;lines[i]=ln.slice(d);if(i===0)first=-d;}
      else{d=ln.length?4:0;lines[i]=ln.length?"    "+ln:ln;if(i===0)first=d;}
    }
    var blk=lines.join("\n"),old=v.slice(ls,le);
    if(blk===old)return;
    ta.setSelectionRange(ls,le);put(blk);
    var ns=Math.max(ls,s+first),ne=en+(blk.length-old.length);
    if(ne<ns)ne=ns;
    ta.setSelectionRange(ns,ne);
    ta.dispatchEvent(new Event("input",{bubbles:true}));
  }

  /* Enter: 앞줄 들여쓰기 유지(콜론으로 끝나면 4칸 추가) */
  ta.addEventListener("keydown",function(e){
    if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();bRun.click();return;}
    if(e.key==="Tab"&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.isComposing){
      if(ta._esc)return; /* Esc를 누른 직후의 Tab은 다음 칸으로 이동(각 페이지의 codeKeys가 처리) */
      e.stopPropagation();tabKey(e);return;
    }
    if(e.key!=="Enter"||e.shiftKey||e.altKey||e.isComposing)return;
    var v=ta.value,s=ta.selectionStart;
    var ls=v.lastIndexOf("\n",s-1)+1,line=v.slice(ls,s);
    var ind=/^[ ]*/.exec(line)[0];
    if(/:\s*$/.test(line.replace(/#.*$/,"")))ind+="    ";
    e.preventDefault();
    if(!document.execCommand("insertText",false,"\n"+ind)){ta.setRangeText("\n"+ind,s,ta.selectionEnd,"end");}
    ta.dispatchEvent(new Event("input",{bubbles:true}));
  });

  bEx.addEventListener("click",function(){openExamples(ed);});
  bPrev.addEventListener("click",function(){
    var ents=otherPageEntries(),pre=sortedCodes(ents);
    if(!pre.length){out.hidden=false;ol.textContent="앞 쪽 코드";op.className="";op.textContent="불러올 코드가 없다. 이 브라우저에서 앞 쪽의 편집기로 코드를 실행해 성공한 뒤(8시간 안)에 불러올 수 있다. 다른 컴퓨터나 브라우저에서 실행한 코드는 불러올 수 없으므로, 그때는 앞 쪽의 [예시 코드]에서 필요한 코드를 [편집기에 추가]해 실행한다.";return;}
    if(autoRestore)pre=pre.concat(sortedCodes(pageRuns));
    out.hidden=false;op.className="";op.textContent="";
    var n=Object.keys(ents).length;
    busyAll(true);
    runCode("pass",{
      state:function(s){ol.textContent=s==="loading"?"파이썬을 준비하는 중…":"앞 쪽 코드를 불러오는 중…";},
      partial:function(){},
      finish:function(kind,text,extra){
        busyAll(false);
        if(kind==="ok"){autoRestore=false;prevLoaded=true;ol.textContent="불러왔다";op.className="ok";op.textContent="같은 주차의 앞 쪽에서 실행에 성공한 코드 "+n+"개를 불러왔다. 그 안의 함수와 변수를 이 쪽 편집기에서 쓸 수 있다.";}
        else{ol.textContent="불러오지 못했다";op.className="err";op.textContent=(extra||"시간 초과")+"\n앞 쪽에서 실행한 코드가 지금도 정상 실행되는지 확인한다.";}
      }
    },pre);
  });
  bRst.addEventListener("click",function(){
    resetWorker();clearPageRuns();op.textContent="";out.hidden=false;ol.textContent="실행 환경을 초기화했다. 다음 실행부터 새 환경에서 시작한다.";op.className="";op.textContent="";
  });
  bRun.addEventListener("click",function(){
    var code=ta.value;
    if(!code.trim()){out.hidden=false;ol.textContent="실행";op.className="err";op.textContent="코드가 비어 있다.";return;}
    out.hidden=false;op.className="";op.textContent="";
    var ui={
      state:function(s){ol.textContent=s==="loading"?"파이썬을 준비하는 중… (처음 한 번은 몇 초 걸린다)":"실행 중…";},
      partial:function(t){op.textContent=t;},
      finish:function(kind,text,extra){
        busyAll(false);
        if(kind==="ok"){ol.textContent="실행 완료";op.className="ok";op.textContent=text||"(출력 없음. 테스트가 모두 통과했다면 print 결과가 없을 수 있다.)";}
        else if(kind==="timeout"){ol.textContent="시간 초과";op.className="err";op.textContent=(text||"")+"\n"+(TIMEOUT_MS/1000)+"초 안에 끝나지 않아 멈췄다. 무한 반복이나 종료 조건(기저 조건) 누락이 없는지 확인한다. 실행 환경은 초기화되었다. 다음 실행 때 이 쪽에서 성공했던 코드를 다시 실행해 복원한다.";autoRestore=true;}
        else{ol.textContent="오류";op.className="err";op.textContent=(text?text+"\n":"")+extra;}
      }
    };
    var pre=[];
    if(autoRestore){pre=restoreList(edId);}
    var wasRestore=autoRestore&&pre.length>0;
    busyAll(true);
    var fin=ui.finish;
    ui.finish=function(kind,text,extra){
      if(kind==="ok"){record(edId,code);if(wasRestore)autoRestore=false;}
      fin(kind,text,extra);
      if(kind==="ok"&&wasRestore){op.textContent=(op.textContent?op.textContent+"\n":"")+"(시간 초과로 지워진 환경을 이 쪽에서 성공했던 코드로 복원한 뒤 실행했다.)";}
    };
    runCode(code,ui,pre);
  });
  return ed;
}

function init(){
  highlightBlocks();
  bindCopyButtons();
  q("textarea.in.code, textarea.code").forEach(function(t){if(!t._ck){t._ck=true;buildEditor(t);}});
}
/* ---------- 답 가림 모드: 예시 정답을 불러온 화면을 수업에서 보여 줄 때 쓴다 ----------
   t 키로 켜고 끈다. 켜면 모든 입력 내용이 가려지고, 마우스로 누른 입력란만 보인다.
   입력란에 글을 쓰는 중에는 t가 글자로 입력되므로, Esc로 입력란을 벗어난 뒤 누른다. */
function initHide(){
  var btn=null;
  function on(){return document.body.classList.contains("ans-hide");}
  function target(el){
    if(!el||!el.closest)return null;
    if(el.closest("#savebar")||el.closest("#ans-badge"))return null;
    var c=el.closest(".ck-ed");if(c)return c;
    var d=el.closest("[data-key]");if(d)return d;
    var l=el.closest("label");
    if(l){var i=l.querySelector("[data-key]");if(i)return i;}
    return null;
  }
  function reveal(e){if(!on())return;var t=target(e.target);if(t)t.classList.add("ans-on");}
  function toggle(){
    var b=document.body,next=!on();
    q(".ans-on").forEach(function(x){x.classList.remove("ans-on");});
    b.classList.toggle("ans-hide",next);
    if(next&&document.activeElement&&document.activeElement!==b)document.activeElement.blur();
    btn.textContent=next?"답 가림 중 · 칸을 누르면 보임 · 해제(t)":"답 가림(t)";
    btn.setAttribute("aria-pressed",next?"true":"false");
  }
  btn=document.createElement("button");btn.type="button";btn.id="ans-badge";
  btn.title="수업용: 모든 입력 내용을 가리고, 누른 칸만 보이게 한다. t 키로도 켜고 끈다.";
  btn.textContent="답 가림(t)";btn.setAttribute("aria-pressed","false");
  btn.addEventListener("click",toggle);
  document.body.appendChild(btn);
  document.addEventListener("pointerdown",reveal,true);
  document.addEventListener("focusin",reveal,true);
  document.addEventListener("keydown",function(e){
    if(e.code!=="KeyT"||e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;
    var a=document.activeElement,tag=a&&a.tagName;
    /* 가림 모드가 꺼져 있고 글을 쓰는 중이면 t는 글자로 입력한다. 켜져 있으면 어디서든 해제한다. */
    if(!on()&&a&&(tag==="TEXTAREA"||tag==="SELECT"||a.isContentEditable||(tag==="INPUT"&&!/^(checkbox|radio|button|file|submit|reset|image|range|color)$/.test(a.type))))return;
    var m=document.querySelector(".ck-modal");if(m&&!m.hidden)return;
    e.preventDefault();toggle();
  });
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"){var a=document.activeElement;if(a&&a!==document.body&&/^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName))a.blur();}
  });
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initHide);else initHide();
/* ---------- 제출 단추: 저장 바의 [제출]은 제출 사이트를 새 창으로 연다 ---------- */
document.addEventListener("click",function(e){
  var b=e.target&&e.target.closest?e.target.closest("#sb-submit"):null;
  if(b)window.open("https://dshs-ds-grader.web.app/student.html","_blank","noopener");
});
window.CodeKit={highlight:highlight};
})();
