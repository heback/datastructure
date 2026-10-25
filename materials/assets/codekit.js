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
'var py=null,ready=null;\n'+
'function init(){\n'+
' if(!ready)ready=(async function(){\n'+
'  importScripts("'+PYODIDE+'pyodide.js");\n'+
'  py=await loadPyodide({indexURL:"'+PYODIDE+'"});\n'+
'  py.setStdout({batched:function(s){postMessage({t:"out",s:s});}});\n'+
'  py.setStderr({batched:function(s){postMessage({t:"err",s:s});}});\n'+
' })();\n'+
' return ready;\n'+
'}\n'+
'onmessage=async function(e){\n'+
' var d=e.data;\n'+
' try{\n'+
'  postMessage({t:"state",s:"loading"});\n'+
'  await init();\n'+
'  postMessage({t:"state",s:"running"});\n'+
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
function runCode(code,ui){
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
  worker.postMessage({id:1,code:code});
}
function busyAll(b){q(".ck-btn.run").forEach(function(x){x.disabled=b;});}

/* ---------- 예시 코드 팝업 ---------- */
var modal=null,lastFocus=null;
var ROLE_LABEL={demo:"예시",skeleton:"뼈대",test:"테스트",bug:"오류 코드"};
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
  var blocks=q("pre > code[data-role]",sec);
  if(!blocks.length)blocks=q("pre > code[data-role]");
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
    var put=document.createElement("button");put.type="button";put.className="ck-btn";put.textContent="편집기에 넣기";
    head.appendChild(b);head.appendChild(cp);head.appendChild(put);
    var pre=document.createElement("pre");var code=document.createElement("code");
    code.innerHTML=highlight(c.textContent);pre.appendChild(code);
    item.appendChild(head);item.appendChild(pre);body.appendChild(item);
    cp.addEventListener("click",function(){copyText(c.textContent,function(ok){flash(cp,ok?"복사됨":"복사 실패");});});
    put.addEventListener("click",function(){
      if(ed.ta.value.trim()&&!put._arm){put._arm=true;put.textContent="덮어쓰기? 한 번 더";clearTimeout(put._t);put._t=setTimeout(function(){put._arm=false;put.textContent="편집기에 넣기";},2500);return;}
      ed.set(c.textContent);closeModal();ed.ta.focus();
    });
  });
  var hint=document.createElement("p");hint.className="ck-hint";
  hint.textContent="이 활동에 나온 코드를 모아 보여 준다. [편집기에 넣기]를 누르면 편집기의 내용이 이 코드로 바뀐다. 앞 코드(예: Node 클래스)가 필요하면 먼저 편집기에 넣어 실행한다. 실행 환경은 이 페이지 안에서 공유되어, 앞에서 실행한 함수와 변수가 남아 있다.";
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
  var bRst=mk("실행 환경 초기화");bRst.title="앞에서 실행한 정의(함수·변수)를 모두 지운다";
  bar.appendChild(ttl);bar.appendChild(bEx);bar.appendChild(bRun);bar.appendChild(bRst);
  var area=document.createElement("div");area.className="ck-area";
  var hl=document.createElement("pre");hl.className="ck-hl";hl.setAttribute("aria-hidden","true");
  var hc=document.createElement("code");hl.appendChild(hc);
  var out=document.createElement("div");out.className="ck-out";out.hidden=true;
  var ol=document.createElement("div");ol.className="ck-ol";
  var op=document.createElement("pre");op.setAttribute("aria-live","polite");
  out.appendChild(ol);out.appendChild(op);
  host.parentNode.insertBefore(box,host);
  if(!ta.getAttribute("aria-label"))ta.setAttribute("aria-label",ta.getAttribute("data-label")||title);
  ta.classList.add("ck-ta");
  area.appendChild(hl);area.appendChild(ta);
  box.appendChild(bar);box.appendChild(area);box.appendChild(out);
  if(label)label.remove();
  function mk(t){var b=document.createElement("button");b.type="button";b.className="ck-btn";b.textContent=t;return b;}
  function render(){hc.innerHTML=highlight(D.get.call(ta))+"\n";}
  function sync(){hl.scrollTop=ta.scrollTop;hl.scrollLeft=ta.scrollLeft;}
  Object.defineProperty(ta,"value",{get:function(){return D.get.call(ta);},set:function(v){D.set.call(ta,v);render();},configurable:true});
  ta.addEventListener("input",render);
  ta.addEventListener("scroll",sync);
  render();
  var ed={box:box,ta:ta,set:function(v){ta.value=v;ta.dispatchEvent(new Event("input",{bubbles:true}));}};

  /* Enter: 앞줄 들여쓰기 유지(콜론으로 끝나면 4칸 추가) */
  ta.addEventListener("keydown",function(e){
    if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();bRun.click();return;}
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
  bRst.addEventListener("click",function(){
    resetWorker();op.textContent="";out.hidden=false;ol.textContent="실행 환경을 초기화했다. 다음 실행부터 새 환경에서 시작한다.";op.className="";op.textContent="";
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
        else if(kind==="timeout"){ol.textContent="시간 초과";op.className="err";op.textContent=(text||"")+"\n"+(TIMEOUT_MS/1000)+"초 안에 끝나지 않아 멈췄다. 무한 반복이나 종료 조건(기저 조건) 누락이 없는지 확인한다. 실행 환경은 초기화되었다.";}
        else{ol.textContent="오류";op.className="err";op.textContent=(text?text+"\n":"")+extra;}
      }
    };
    busyAll(true);
    runCode(code,ui);
  });
  return ed;
}

function init(){
  highlightBlocks();
  bindCopyButtons();
  q("textarea.in.code, textarea.code").forEach(function(t){if(!t._ck){t._ck=true;buildEditor(t);}});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
window.CodeKit={highlight:highlight};
})();
