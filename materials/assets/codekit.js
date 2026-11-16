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
'  function sink(t){var dec=new TextDecoder("utf-8");return {write:function(buf){if(!muted){var s=dec.decode(buf,{stream:true});if(s)postMessage({t:t,s:s});}return buf.length;}};}\n'+
'  py.setStdout(sink("out"));\n'+
'  py.setStderr(sink("err"));\n'+
' })();\n'+
' return ready;\n'+
'}\n'+
'function fl(){try{py.runPython("import sys\\nsys.stdout.flush()\\nsys.stderr.flush()");}catch(e){}}\n'+
'onmessage=async function(e){\n'+
' var d=e.data;\n'+
' try{\n'+
'  postMessage({t:"state",s:"loading"});\n'+
'  await init();\n'+
'  postMessage({t:"state",s:"running"});\n'+
'  if(d.pre&&d.pre.length){muted=true;try{for(var i=0;i<d.pre.length;i++)await py.runPythonAsync(d.pre[i]);fl();}catch(e2){fl();muted=false;postMessage({t:"fail",id:d.id,m:"[앞 코드를 불러오다 오류] "+String(e2&&e2.message?e2.message:e2)});return;}muted=false;}\n'+
'  await py.runPythonAsync(d.code);\n'+
'  fl();\n'+
'  postMessage({t:"done",id:d.id});\n'+
' }catch(err){fl();postMessage({t:"fail",id:d.id,m:String(err&&err.message?err.message:err)});}\n'+
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
    else if(d.t==="out"||d.t==="err"){text+=d.s;ui.partial(text);}
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
/* data-id 로 코드 원문을 찾는다. 여러 개는 빈칸으로 구분하고 빈 줄 하나로 이어 붙인다.
   원문은 <script type="text/plain" data-id> 또는 <pre><code data-id> 어디에 있어도 된다. */
function srcText(ids){
  var out=[];
  String(ids||"").split(/\s+/).forEach(function(id){
    if(!id)return;
    var el=document.querySelector('[data-id="'+id+'"]');
    if(el)out.push(el.textContent.replace(/^\n+/,"").replace(/\s+$/,""));
  });
  return out.length?out.join("\n\n")+"\n":"";
}
/* ---------- 들여쓰기 표시: 줄 앞 공백 4칸마다 세로 안내선, 탭 문자는 색으로 표시(글자 폭은 그대로) ---------- */
function indentMarks(html){
  return html.split("\n").map(function(L){
    return L.replace(/^(?: {4})+/,function(m){return m.replace(/ {4}/g,'<span class="ck-ig">    </span>');})
            .replace(/\t/g,'<span class="ck-tab">\t</span>');
  }).join("\n");
}

/* ---------- 자동 완성: 파이썬 키워드·내장 함수·형식 힌트·표준 모듈 이름·이 코드에 나온 이름 ---------- */
var AC_KW="False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" ");
var AC_BI=("abs all any bin bool bytes callable chr dict dir divmod enumerate filter float format frozenset getattr hasattr hash hex id input int isinstance issubclass iter len list map max min next object oct open ord pow print range repr reversed round set setattr slice sorted str sum super tuple type zip "+
  "Exception ValueError TypeError IndexError KeyError AssertionError NotImplementedError StopIteration RuntimeError ZeroDivisionError RecursionError AttributeError NameError").split(" ");
var AC_TYPE="int float str bool bytes None list dict set tuple frozenset object Any Optional Union Callable Iterable Iterator Generator Sequence Mapping Deque DefaultDict Literal TypeVar List Dict Set Tuple".split(" ");
var AC_MOD={heapq:"heappush heappop heapify heapreplace heappushpop nlargest nsmallest merge",
  bisect:"bisect_left bisect_right bisect insort insort_left insort_right",
  collections:"deque defaultdict Counter OrderedDict namedtuple",
  math:"inf pi e sqrt isqrt floor ceil log log2 log10 gcd lcm comb perm factorial fsum",
  itertools:"permutations combinations product accumulate chain count cycle islice pairwise groupby",
  functools:"lru_cache cache reduce partial cmp_to_key",
  typing:"Any Optional Union Callable Iterable Iterator Generator Sequence Mapping Deque DefaultDict Literal TypeVar List Dict Set Tuple",
  random:"randint random choice choices shuffle sample seed",
  sys:"setrecursionlimit getrecursionlimit maxsize stdin stdout",
  time:"time perf_counter sleep",
  inspect:"isgeneratorfunction isfunction signature getsource"};
var AC_METH=[];(function(){var s={};("append extend insert remove pop clear index count sort reverse copy get keys values items setdefault update popitem "+
  "add discard union intersection difference issubset split join strip lstrip rstrip lower upper replace startswith endswith find format isdigit isalpha "+
  "appendleft popleft extendleft rotate most_common").split(" ").forEach(function(w){if(!s[w]){s[w]=1;AC_METH.push(w);}});})();
var AC_KWSET={};AC_KW.forEach(function(w){AC_KWSET[w]=1;});
var AC_KIND={kw:"키워드",bi:"내장",ty:"형식",mod:"모듈",me:"메서드",my:"이 코드"};
var acMeasure=null;
function makeAutoComplete(ta,put){
  var box=null,list=[],sel=0,word="",open=false,lastPos=-1,moved=false,quiet=false;
  function raw(){return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").get.call(ta);}
  /* 캐럿이 주석·문자열 안이면 완성하지 않는다 */
  function inCodeText(text,pos){
    var before=text.slice(0,pos);
    if(((before.match(/"""/g)||[]).length%2)||((before.match(/'''/g)||[]).length%2))return false;
    var line=before.slice(before.lastIndexOf("\n")+1),q="",i,c;
    for(i=0;i<line.length;i++){c=line.charAt(i);
      if(q){if(c==="\\"){i++;continue;}if(c===q)q="";}
      else if(c==='"'||c==="'")q=c;
      else if(c==="#")return false;}
    return !q;
  }
  function namesInCode(text,skipAt){
    var seen={},out=[],re=/[A-Za-z_]\w*/g,m;
    while((m=re.exec(text))){var w=m[0];
      if(m.index<=skipAt&&skipAt<=m.index+w.length)continue; /* 지금 쓰고 있는 낱말 자신은 뺀다 */
      if(w.length<2||AC_KWSET[w]||seen[w])continue;
      if(m.index>0&&text.charAt(m.index-1)===".")continue;
      seen[w]=1;out.push(w);}
    return out;
  }
  function candidates(text,pos,force){
    if(!inCodeText(text,pos))return null;
    var line=text.slice(text.lastIndexOf("\n",pos-1)+1,pos);
    var wm=/[A-Za-z_]\w*$/.exec(line);word=wm?wm[0]:"";
    var pre=line.slice(0,line.length-word.length),items=[],seen={},hint=false;
    function add(ws,kind,lab){ws.forEach(function(w){if(!seen[w]&&w.toLowerCase().indexOf(word.toLowerCase())===0){seen[w]=1;items.push({w:w,k:kind,l:lab});}});}
    var dot=/([A-Za-z_]\w*)?\.$/.exec(pre);
    if(dot){
      var own=dot[1]||"";
      if(!own&&/\d\.$/.test(pre))return null; /* 3. 같은 수 */
      if(AC_MOD[own])add(AC_MOD[own].split(" "),"mod",own);
      else{
        var attrs=[],re=new RegExp((own?own.replace(/\W/g,""):"[A-Za-z_]\\w*")+"\\.([A-Za-z_]\\w*)","g"),m;
        while((m=re.exec(text))){if(!(m.index+m[0].length===pos))attrs.push(m[1]);}
        add(attrs,"my");if(own!=="self")add(AC_METH,"me");
      }
    }else{
      if(!force&&word.length<2)return null;
      hint=/->\s*[\w\[\], .|]*$/.test(pre)||
        (/^\s*def\b/.test(line)&&/[(,]\s*[A-Za-z_]\w*\s*:\s*[\w\[\], .|]*$/.test(pre))||
        (/^\s*([A-Za-z_][\w.]*)\s*:\s*[\w\[\], .|]*$/.test(pre)&&!AC_KWSET[/^\s*([A-Za-z_]\w*)/.exec(pre)[1]]);
      if(/^\s*(?:from|import)\s+[\w.]*$/.test(pre))add(Object.keys(AC_MOD),"mod");
      if(hint)add(AC_TYPE,"ty");
      add(namesInCode(text,pos),"my");
      Object.keys(AC_MOD).forEach(function(md){if(new RegExp("from\\s+"+md+"\\s+import\\b").test(text))add(AC_MOD[md].split(" "),"mod",md);});
      add(Object.keys(AC_MOD).filter(function(md){return new RegExp("^\\s*import\\s+.*\\b"+md+"\\b","m").test(text);}),"mod");
      add(AC_KW,"kw");add(AC_BI,"bi");
    }
    /* 다 쓴 낱말과 같은 것 → 대소문자까지 맞는 것 → 나머지(같은 묶음 안에서는 넣은 순서) */
    items.forEach(function(x,i){x.i=i;});
    items.sort(function(a,b){function r(x){return (x.w===word?0:4)+(hint&&x.k==="ty"?0:2)+(x.w.indexOf(word)===0?0:1);}return r(a)-r(b)||a.i-b.i;});
    if(!items.length)return null;
    if(items.length===1&&items[0].w===word)return null;
    return items.slice(0,40);
  }
  function ensureBox(){
    if(box)return;
    box=document.createElement("ul");box.className="ck-ac";box.setAttribute("role","listbox");box.hidden=true;
    box.addEventListener("mousedown",function(e){var li=e.target.closest("li");if(!li||!li.hasAttribute("data-i")){e.preventDefault();return;}e.preventDefault();sel=+li.getAttribute("data-i");accept();});
    document.body.appendChild(box);
  }
  function caretXY(text,pos){
    var cs=getComputedStyle(ta),r=ta.getBoundingClientRect();
    var ls=text.lastIndexOf("\n",pos-1)+1,row=text.slice(0,ls).split("\n").length-1;
    var prefix=text.slice(ls,pos-word.length).replace(/\t/g,"    ");
    if(!acMeasure)acMeasure=document.createElement("canvas").getContext("2d");
    acMeasure.font=cs.fontStyle+" "+cs.fontWeight+" "+cs.fontSize+" "+cs.fontFamily;
    var lh=parseFloat(cs.lineHeight)||20;
    return {x:r.left+parseFloat(cs.paddingLeft)+acMeasure.measureText(prefix).width-ta.scrollLeft,
            y:r.top+parseFloat(cs.paddingTop)+row*lh-ta.scrollTop,lh:lh};
  }
  function draw(){
    var h="";list.forEach(function(it,i){
      h+='<li role="option" data-i="'+i+'"'+(i===sel?' class="on" aria-selected="true"':'')+'><span><b>'+esc(it.w.slice(0,word.length))+'</b>'+esc(it.w.slice(word.length))+'</span><small>'+esc(it.l||AC_KIND[it.k])+'</small></li>';});
    box.innerHTML=h+'<li class="foot" aria-hidden="true">Tab 넣기 · ↑↓ 고른 뒤 Enter · Esc 닫기</li>';
    var on=box.querySelector("li.on");if(on){var t=on.offsetTop,b=t+on.offsetHeight;if(t<box.scrollTop)box.scrollTop=t;else if(b>box.scrollTop+box.clientHeight)box.scrollTop=b-box.clientHeight;}
  }
  function show(force){
    var text=raw(),pos=ta.selectionStart;
    if(pos!==ta.selectionEnd){close();return;}
    var c=candidates(text,pos,force);
    if(!c){close();return;}
    ensureBox();list=c;sel=0;moved=false;open=true;lastPos=pos;box.hidden=false;draw();place();
  }
  /* 목록 위치: 캐럿 바로 아래(아래가 모자라면 위). 화면을 굴려도 따라간다 */
  function place(){
    if(!open)return;
    var p=caretXY(raw(),ta.selectionStart),bh=box.offsetHeight,bw=box.offsetWidth,r=ta.getBoundingClientRect();
    if(p.y+p.lh<r.top||p.y>r.bottom){box.style.visibility="hidden";return;}
    box.style.visibility="";
    var top=p.y+p.lh+2;if(top+bh>window.innerHeight-4&&p.y-bh-2>0)top=p.y-bh-2;
    box.style.left=Math.max(4,Math.min(p.x-4,window.innerWidth-bw-4))+"px";box.style.top=top+"px";
  }
  function close(){if(box)box.hidden=true;open=false;list=[];}
  function accept(){
    var it=list[sel];if(!it){close();return;}
    var pos=ta.selectionStart;close();
    quiet=true;
    try{if(it.w!==word){ta.setSelectionRange(pos-word.length,pos);put(it.w);}}finally{quiet=false;}
    ta.dispatchEvent(new Event("input",{bubbles:true}));
  }
  ta.addEventListener("input",function(e){
    var t=e.inputType||"";
    if(quiet)return;
    if(!t){if(open)close();return;}             /* 프로그램이 바꾼 값(Tab·붙여넣기·완성)에는 열지 않는다 */
    if(e.isComposing||t==="insertCompositionText"){close();return;}
    if(t==="insertText"&&e.data&&/[A-Za-z_\d.]/.test(e.data))show(false);
    else if(open&&/^delete/.test(t))show(false);
    else close();
  });
  ta.addEventListener("blur",function(){setTimeout(close,0);});
  ta.addEventListener("mousedown",close);
  ta.addEventListener("scroll",place);
  window.addEventListener("resize",place);
  window.addEventListener("scroll",function(e){if(open&&e.target!==box)place();},true);
  return {onKey:function(e){
    if(e.isComposing)return false;
    if(e.key===" "&&e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();show(true);return true;}
    if(!open)return false;
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();moved=true;sel=(sel+(e.key==="ArrowDown"?1:list.length-1))%list.length;draw();return true;}
    if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close();return true;}
    if(e.key==="Tab"&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();e.stopPropagation();accept();return true;}
    if(e.key==="Enter"&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
      /* 화살표로 고르지 않았거나 다 쓴 낱말이면 Enter는 그대로 줄 바꿈(새 이름을 쓰다 엉뚱한 이름으로 바뀌지 않게) */
      if(!moved||(list[sel]&&list[sel].w===word)){close();return false;}
      e.preventDefault();accept();return true;}
    if(e.key==="ArrowLeft"||e.key==="ArrowRight"||e.key==="Home"||e.key==="End"||e.key==="PageUp"||e.key==="PageDown")close();
    return false;
  },close:close};
}

var CM_KEY="ck-hide-comments";
function cmPref(v){
  try{if(v===undefined)return localStorage.getItem(CM_KEY)==="1";localStorage.setItem(CM_KEY,v?"1":"0");}catch(_){}
  return false;
}

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
  /* 시작 코드: 편집기가 비어 있으면 이 코드로 채운다. 손대지 않은 동안에는 값이 빈 것으로 읽혀 저장·제출에 들어가지 않는다 */
  var starter=ta.hasAttribute("data-starter")?srcText(ta.getAttribute("data-starter")):"";
  /* data-starter-save: 실행만 해 보는 편집기. 손대지 않아도 시작 코드가 그대로 저장·제출된다 */
  var keepStarter=ta.hasAttribute("data-starter-save");
  var checkSrc=ta.hasAttribute("data-check")?srcText(ta.getAttribute("data-check")):"";
  var bChk=null,bInit=null;
  bar.appendChild(ttl);
  if(!ta.hasAttribute("data-noex")&&!starter)bar.appendChild(bEx);
  if(!ta.hasAttribute("data-noprev")&&!(starter&&!ta.hasAttribute("data-prev")))bar.appendChild(bPrev);
  bar.appendChild(bRun);
  if(checkSrc){bChk=mk("✔ 점검");bChk.classList.add("run","chk");bChk.title="내 코드를 실행한 뒤 점검 코드로 확인한다";bar.appendChild(bChk);}
  if(starter){bInit=mk("처음 코드로");bInit.title="편집기를 처음 주어진 코드로 되돌린다";bar.appendChild(bInit);}
  /* 주석 가리기: 화면에서만 주석 글자를 감춘다(편집기 내용·저장·실행은 그대로). 마지막 선택을 이 브라우저에 기억한다 */
  var bCm=mk("주석 가리기");bCm.classList.add("cm");bCm.setAttribute("aria-pressed","false");
  bCm.title="코드의 # 주석을 화면에서 가리거나 다시 보인다. 코드 내용은 바뀌지 않는다";
  function setCm(hide){box.classList.toggle("ck-nocm",hide);bCm.textContent=hide?"주석 보이기":"주석 가리기";bCm.setAttribute("aria-pressed",hide?"true":"false");if(hc)render();}
  setCm(cmPref());
  bCm.addEventListener("click",function(){var h=!box.classList.contains("ck-nocm");setCm(h);cmPref(h);});
  bar.appendChild(bCm);
  bar.appendChild(bRst);
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
    var v=D.get.call(ta),h=highlight(v);
    /* 주석을 가렸으면 그 자리에 옅은 #… 만 남긴다(주석은 줄 끝까지라 뒤 글자 위치는 그대로) */
    if(box.classList.contains("ck-nocm"))h=h.replace(/<span class="tk-cm">[^<]*<\/span>/g,'<span class="tk-cm tk-cmh">#…</span>');
    hc.innerHTML=indentMarks(h)+"\n";
    var n=v.split("\n").length;
    if(n!==gutN){var t=[];for(var i=1;i<=n;i++)t.push(i);gut.textContent=t.join("\n");gutN=n;}
  }
  function sync(){hl.scrollTop=ta.scrollTop;hl.scrollLeft=ta.scrollLeft;gut.scrollTop=ta.scrollTop;}
  function raw(){return D.get.call(ta);}
  Object.defineProperty(ta,"value",{
    get:function(){var v=raw();return (starter&&!keepStarter&&v===starter)?"":v;},
    set:function(v){D.set.call(ta,(starter&&(v==null||v===""))?starter:v);render();},configurable:true});
  if(starter&&raw()==="")D.set.call(ta,starter);
  ta.addEventListener("input",render);
  ta.addEventListener("scroll",sync);
  render();
  var ed={box:box,ta:ta,set:function(v){ta.value=v;ta.dispatchEvent(new Event("input",{bubbles:true}));}};

  /* Tab: 4칸 들여쓰기, Shift+Tab: 내어쓰기. 여러 줄을 고르면 고른 줄 전체에 적용한다(Esc 후 Tab으로 다음 칸 이동) */
  function put(text){
    var before=raw(),a=ta.selectionStart,b=ta.selectionEnd;
    try{document.execCommand("insertText",false,text);}catch(_){}
    if(raw()===before)ta.setRangeText(text,a,b,"end");
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

  /* 자동 완성(파이썬 키워드·내장 함수·형식 힌트·이 코드의 이름) */
  var ac=makeAutoComplete(ta,put);

  /* 한글 조합 중에 누른 Tab·Shift+Tab: 조합이 끝난 뒤 들여쓰기·내어쓰기를 한다(칸 이동으로 새지 않게) */
  var pendTab=null;
  ta.addEventListener("compositionend",function(){
    if(pendTab===null)return;var sh=pendTab;pendTab=null;
    setTimeout(function(){tabKey({shiftKey:sh,preventDefault:function(){}});},0);
  });
  /* 붙여 넣은 탭 문자는 공백 4칸으로 바꾼다(탭·공백이 섞이면 파이썬이 TabError를 낸다) */
  ta.addEventListener("paste",function(e){
    var t=e.clipboardData&&e.clipboardData.getData("text/plain");
    if(!t||t.indexOf("\t")<0)return;
    e.preventDefault();put(t.replace(/\t/g,"    "));ta.dispatchEvent(new Event("input",{bubbles:true}));
  });

  /* Enter: 앞줄 들여쓰기 유지(콜론으로 끝나면 4칸 추가) */
  ta.addEventListener("keydown",function(e){
    if(ac.onKey(e))return;
    if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();bRun.click();return;}
    if((e.key==="Tab"||e.code==="Tab")&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
      if(ta._esc)return; /* Esc를 누른 직후의 Tab은 다음 칸으로 이동(각 페이지의 codeKeys가 처리) */
      e.stopPropagation();
      if(e.isComposing||e.keyCode===229){e.preventDefault();pendTab=e.shiftKey;return;}
      tabKey(e);return;
    }
    /* Backspace: 줄 앞 공백 안에서는 들여쓰기 한 단계(4칸 경계)까지 지운다 */
    if(e.key==="Backspace"&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.isComposing){
      var bv=raw(),bs=ta.selectionStart;
      if(bs!==ta.selectionEnd||bs===0)return;
      var bl=bv.slice(bv.lastIndexOf("\n",bs-1)+1,bs);
      if(!bl.length||/[^ ]/.test(bl))return;
      var n=bl.length%4||4;if(n<2)return;
      e.preventDefault();ta.setSelectionRange(bs-n,bs);
      var bb=raw();try{document.execCommand("delete");}catch(_){}
      if(raw()===bb)ta.setRangeText("",bs-n,bs,"end");
      ta.dispatchEvent(new Event("input",{bubbles:true}));return;
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
  function go(tail){
    var code=raw();
    if(!code.trim()){out.hidden=false;ol.textContent="실행";op.className="err";op.textContent="코드가 비어 있다.";return;}
    out.hidden=false;op.className="";op.textContent="";
    var ui={
      state:function(s){ol.textContent=s==="loading"?"파이썬을 준비하는 중… (처음 한 번은 몇 초 걸린다)":"실행 중…";},
      partial:function(t){op.textContent=t;},
      finish:function(kind,text,extra){
        busyAll(false);
        if(kind==="ok"){ol.textContent=tail?"점검 완료":"실행 완료";op.className="ok";op.textContent=text||"(출력 없음. 결과를 보려면 print를 쓴다.)";}
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
    runCode(tail?code+"\n\n"+tail:code,ui,pre);
  }
  bRun.addEventListener("click",function(){go("");});
  if(bChk)bChk.addEventListener("click",function(){go(checkSrc);});
  if(bInit)bInit.addEventListener("click",function(){
    if(raw()!==starter&&!window.confirm("편집기에 쓴 내용을 지우고 처음 주어진 코드로 되돌릴까?"))return;
    ed.set("");
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
