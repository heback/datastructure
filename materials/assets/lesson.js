/* lesson.js — 확인 질문(.quiz). 누르면 바로 맞는지 알려 준다. 답은 저장·제출에 들어가지 않는다.
   고르기:  <div class="quiz" data-answer="2"><p class="q">…</p>
              <div class="opts"><button type="button" data-hint="…">보기1</button><button type="button">보기2</button></div>
              <p class="why">맞힌 뒤 보이는 한 줄 설명</p></div>
   쓰기:    <div class="quiz" data-accept="A B C D E|ABCDE" data-hint="…"><p class="q">…</p>
              <div class="ans"><input type="text" aria-label="…"><button type="button">확인</button></div>
              <p class="why">…</p></div>
   예측:    <div class="quiz predict"><p class="q">실행하면 …?</p><div class="opts"><button type="button">…</button>…</div></div>
            (맞는지 알려 주지 않는다. 고른 뒤 실행해서 확인하게 한다. data-after 로 고른 뒤 문구를 바꿀 수 있다)
   쓰기 답은 공백·쉼표·따옴표·괄호를 빼고 소문자로 바꿔 비교한다. 여러 정답은 | 로 나눈다. */
(function(){
"use strict";
function norm(s){return String(s).toLowerCase().replace(/[\s,'"`\[\]\(\)→>\-·]/g,"");}
function fb(quiz,ok,text){
  var p=quiz.querySelector(".fb");
  if(!p){p=document.createElement("p");p.className="fb";p.setAttribute("aria-live","polite");
    var why=quiz.querySelector(".why");quiz.insertBefore(p,why);}
  p.className="fb "+(ok?"ok":"no");p.textContent=text;
  quiz.classList.toggle("solved",ok);
}
function initChoice(quiz){
  var ans=parseInt(quiz.getAttribute("data-answer"),10);
  var btns=Array.prototype.slice.call(quiz.querySelectorAll(".opts button"));
  btns.forEach(function(b,i){
    b.addEventListener("click",function(){
      if(i+1===ans){
        btns.forEach(function(x){x.classList.remove("no");});
        b.classList.add("ok");fb(quiz,true,"맞다.");
      }else{
        b.classList.add("no");
        fb(quiz,false,b.getAttribute("data-hint")||"다시 생각해 보자.");
      }
    });
  });
}
/* 예측 질문(.quiz.predict): 맞는지 알려 주지 않고 고른 것만 표시한다. 답은 실행해서 확인한다. */
function initPredict(quiz){
  var btns=Array.prototype.slice.call(quiz.querySelectorAll(".opts button"));
  btns.forEach(function(b){
    b.addEventListener("click",function(){
      btns.forEach(function(x){x.classList.remove("pick");});
      b.classList.add("pick");
      var p=quiz.querySelector(".fb");
      if(!p){p=document.createElement("p");p.className="fb";p.setAttribute("aria-live","polite");quiz.appendChild(p);}
      p.textContent=quiz.getAttribute("data-after")||"골랐다. 이제 실행해서 확인해 보자.";
    });
  });
}
function initText(quiz){
  var acc=quiz.getAttribute("data-accept").split("|").map(norm);
  var inp=quiz.querySelector(".ans input"),btn=quiz.querySelector(".ans button");
  function check(){
    var v=norm(inp.value);
    if(!v){fb(quiz,false,"답을 쓰고 [확인]을 누른다.");return;}
    if(acc.indexOf(v)>=0)fb(quiz,true,"맞다.");
    else fb(quiz,false,quiz.getAttribute("data-hint")||"다시 생각해 보자.");
  }
  if(btn)btn.addEventListener("click",check);
  if(inp)inp.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.isComposing){e.preventDefault();check();}});
}
function init(){
  Array.prototype.forEach.call(document.querySelectorAll(".quiz"),function(quiz){
    if(quiz._lq)return;quiz._lq=true;
    if(quiz.classList.contains("predict"))initPredict(quiz);
    else if(quiz.hasAttribute("data-answer"))initChoice(quiz);
    else if(quiz.hasAttribute("data-accept"))initText(quiz);
  });
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
