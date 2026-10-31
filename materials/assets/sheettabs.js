/* 탐구 활동지: 상단 문항 링크를 누르면 그 문항(section.sheet)만 보여 준다.
   - 숨긴 문항의 입력란은 DOM에 그대로 있어 자동 보관·저장(JSON)은 영향이 없다.
   - 인쇄할 때는 모든 문항이 나온다(sheettabs.css 참고).
   - 주소의 #해시가 문항 안의 요소를 가리키면 그 문항을 열고 요소로 이동한다. */
(function () {
  "use strict";
  var wrap = document.querySelector(".wrap");
  if (!wrap) return;
  var nav = wrap.querySelector(":scope>nav");
  var secs = [].slice.call(wrap.querySelectorAll(":scope>section.sheet"));
  if (!nav || secs.length < 2) return;

  var EXTRA = { "theory-after": "마무리 정리", "wrapup": "마무리 정리" };
  var byId = {};
  secs.forEach(function (s) { byId[s.id] = s; });

  /* 탭 만들기: nav의 #링크 중 문항 id와 같은 것을 탭으로 쓰고, nav에 없는 문항은 추가한다. */
  var tabs = {};
  var links = [].slice.call(nav.querySelectorAll("a"));
  links.forEach(function (a) {
    var h = a.getAttribute("href") || "";
    if (h.charAt(0) === "#" && byId[h.slice(1)]) tabs[h.slice(1)] = a;
  });
  var firstOther = links.filter(function (a) { return (a.getAttribute("href") || "").charAt(0) !== "#"; })[0] || null;
  /* 뒤에서부터 넣어 문항 순서대로 놓는다(바로 뒤 문항의 탭 앞에 끼운다) */
  for (var k = secs.length - 1; k >= 0; k--) {
    var s0 = secs[k];
    if (tabs[s0.id]) continue;
    var a0 = document.createElement("a");
    a0.href = "#" + s0.id;
    a0.textContent = EXTRA[s0.id] || s0.id;
    var before = firstOther;
    for (var m = k + 1; m < secs.length; m++) {
      if (tabs[secs[m].id]) { before = tabs[secs[m].id]; break; }
    }
    nav.insertBefore(a0, before);
    tabs[s0.id] = a0;
  }
  secs.forEach(function (s) {
    var h2 = s.querySelector("h2");
    if (h2 && tabs[s.id]) {
      var t = h2.cloneNode(true);
      var sm = t.querySelector("small"); if (sm) sm.remove();
      tabs[s.id].title = t.textContent.trim();
    }
    tabs[s.id].setAttribute("role", "tab");
  });
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", "문항 선택");

  /* 하단 이전·다음 */
  secs.forEach(function (s, i) {
    var p = document.createElement("div");
    p.className = "st-pager";
    function mk(j, cls, txt) {
      var a = document.createElement("a");
      a.href = "#" + secs[j].id;
      a.className = cls;
      a.textContent = txt;
      return a;
    }
    var label = function (j) { return tabs[secs[j].id].textContent; };
    if (i > 0) p.appendChild(mk(i - 1, "st-prev", "← " + label(i - 1)));
    if (i < secs.length - 1) p.appendChild(mk(i + 1, "st-next", label(i + 1) + " →"));
    if (p.firstChild) s.appendChild(p);
  });

  document.documentElement.classList.add("st-on");
  var cur = null;

  function show(id) {
    if (cur === id) return;
    cur = id;
    secs.forEach(function (s) {
      var on = s.id === id;
      s.classList.toggle("st-active", on);
      var a = tabs[s.id];
      a.classList.toggle("on", on);
      a.setAttribute("aria-selected", on ? "true" : "false");
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    /* 눌린 탭이 가로 스크롤 막대 안에서 보이게 한다 */
    var a = tabs[id];
    if (nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = Math.max(0, a.offsetLeft - nav.clientWidth / 2 + a.offsetWidth / 2);
    }
  }

  function scrollToSection(sec, target) {
    var navH = nav.offsetHeight;
    var el = target && target !== sec ? target : sec;
    var top = el.getBoundingClientRect().top + window.pageYOffset - navH - 8;
    window.scrollTo(0, Math.max(0, top));
  }

  /* 해시가 가리키는 요소를 찾아 그 문항을 연다. 문항 밖이면 false. */
  function go(hash, doScroll) {
    var id = decodeURIComponent((hash || "").replace(/^#/, ""));
    if (!id) return false;
    var el = document.getElementById(id);
    if (!el) return false;
    var sec = el.closest ? el.closest(".wrap>section.sheet") : null;
    if (!sec || !byId[sec.id]) return false;
    show(sec.id);
    if (doScroll) scrollToSection(sec, el);
    return true;
  }

  /* 문항 링크·이전/다음·본문 안의 #링크를 가로챈다 */
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("a[href^='#']") : null;
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
    var h = a.getAttribute("href");
    if (h.length < 2) return;
    var el = document.getElementById(decodeURIComponent(h.slice(1)));
    if (!el) return;
    if (go(h, true)) {
      e.preventDefault();
      try { history.replaceState(null, "", h); } catch (x) {}
    }
  });
  window.addEventListener("hashchange", function () { go(location.hash, true); });

  /* 처음 열 때: 해시가 있으면 그 문항, 없으면 첫 문항 */
  if (!go(location.hash, true)) show(secs[0].id);
})();
