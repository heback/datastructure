/* topnav.js — 모든 학습 자료 상단 이동 막대 (전체 목차 › 주차 목록 › 현재 자료) */
(function(){
"use strict";
var KIND={student_workbook:"탐구 활동지",student_code_lab:"실습 코드",formative_check:"형성평가",rubric:"실습 과제 루브릭",
  teacher_guide:"교사용 가이드",teacher_submission_viewer:"제출 뷰어",teacher_index:"교사용 안내",index:"학습활동"};
function a(href,text){var x=document.createElement("a");x.href=href;x.textContent=text;return x;}
function sep(){var s=document.createElement("span");s.className="ck-sep";s.textContent="›";s.setAttribute("aria-hidden","true");return s;}
function build(){
  if(document.getElementById("ck-topnav"))return;
  var path=decodeURIComponent(location.pathname),m=/week(\d+)\/([^\/]+)\.html$/.exec(path),nav=document.createElement("nav");
  nav.id="ck-topnav";nav.setAttribute("aria-label","페이지 이동");
  var cur=document.createElement("span");cur.className="ck-cur";cur.setAttribute("aria-current","page");
  if(m){
    var week=m[1],name=m[2],pm=/_part(\d+)$/.exec(name),part=pm?pm[1]:"1",base=name.replace(/_part\d+$/,"");
    var teacher=/^teacher_/.test(name),list=teacher?"teacher_index.html":"index.html",isList=(name==="index"||name==="teacher_index");
    var back=a(isList?"../index.html":list,"← 이전 페이지");back.className="ck-back";
    /* 같은 사이트에서 왔으면 브라우저 기록으로 돌아가고, 아니면 목록으로 간다 */
    back.addEventListener("click",function(e){
      var ref=document.referrer;
      if(ref&&ref.indexOf(location.origin)===0&&history.length>1){e.preventDefault();history.back();}
    });
    nav.appendChild(back);nav.appendChild(a("../index.html","전체 목차"));nav.appendChild(sep());
    if(isList){cur.textContent=week+"주차 "+(teacher?"교사용 안내":"학습활동");nav.appendChild(cur);}
    else{
      nav.appendChild(a(list,week+"주차 "+(teacher?"교사용 안내":"학습활동")));nav.appendChild(sep());
      var k=KIND[base]||document.title,hasPart=/^(student_workbook|student_code_lab)$/.test(base);
      cur.textContent=k+(hasPart?" "+part+"부":"");nav.appendChild(cur);
    }
  }else{
    cur.textContent="전체 목차";nav.appendChild(cur);
  }
  /* 주차 목록 페이지에 있던 예전 '← 주차 목록' 줄은 이 막대로 대신한다 */
  var old=document.querySelector("body > .wrap > .nav, body > .nav");if(old&&old.id!=="ck-topnav")old.remove();
  document.body.insertBefore(nav,document.body.firstChild);
}
/* 저장 바(제출 스크립트)가 body 맨 앞에 들어간 뒤, 그 앞에 막대를 둔다 */
if(document.readyState==="complete")build();else document.addEventListener("DOMContentLoaded",build);
})();
