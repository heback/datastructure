/* book.js — 교재 쪽 넘김 레이아웃. sheettabs.js 뒤, </body> 앞에서 불러온다.
   - 활동(section)을 걸음(.step) 단위 쪽으로 나누어 한 화면에 한 쪽만 보인다.
   - 글은 왼쪽 단(편집기가 없는 쪽은 2단), 코드 편집기는 오른쪽 단에 고정한다.
   - 글이 한 화면보다 길면 같은 쪽 안에서 단을 한 칸씩 민다. ← → (PageUp/PageDown) 으로 넘긴다.
   - 입력란·편집기에 글을 쓰는 중에는 방향키가 글 쓰기에 쓰이고 쪽은 넘어가지 않는다.
   - 화면 폭 900px 미만이면 아무것도 하지 않아 기존 문항 탭 화면 그대로이다.
   DOM 은 한 번만 옮기며 data-key·편집기·저장 동작은 바뀌지 않는다. */
(function () {
  "use strict";
  var root = document.documentElement;
  var wrap = document.querySelector(".wrap");
  if (!wrap || !root.classList.contains("st-on")) return;
  if (!window.matchMedia("(min-width:900px)").matches) return;
  var secs = [].slice.call(wrap.querySelectorAll(":scope>section"));
  var nav = wrap.querySelector(":scope>nav");
  if (!secs.length) return;
  var GAP = 48;

  /* ---------- 쪽 만들기 ---------- */
  var S = secs.map(function (sec) {
    var kids = [].slice.call(sec.children);
    var h2 = sec.querySelector(":scope>h2");
    var plain = [];
    var pagesNodes = [];
    var cur = null, pre = [];
    var hasStep = kids.some(function (k) { return k.classList.contains("step"); });
    kids.forEach(function (k) {
      if (k === h2 || k.classList.contains("st-pager")) return;
      if (!hasStep) { plain.push(k); return; }
      if (k.classList.contains("step")) { cur = pre.concat([k]); pre = []; pagesNodes.push(cur); }
      else if (cur) cur.push(k);
      else pre.push(k);
    });
    if (!hasStep) pagesNodes.push(plain);
    var stage = document.createElement("div");
    stage.className = "bk-stage";
    sec.appendChild(stage);
    var n = 0;
    var pages = pagesNodes.map(function (nodes) {
      var el = document.createElement("div");
      el.className = "bk-page";
      var clip = document.createElement("div"); clip.className = "bk-clip";
      var cols = document.createElement("div"); cols.className = "bk-cols";
      var r = document.createElement("div"); r.className = "bk-r";
      clip.appendChild(cols); el.appendChild(clip); el.appendChild(r);
      nodes.forEach(function (nd) {
        if (nd.classList.contains("step")) {
          n++;
          var h3 = nd.querySelector(":scope>h3");
          if (h3) h3.setAttribute("data-n", String(n));
        }
        cols.appendChild(nd);
      });
      /* 코드 편집기(.mycode, 없으면 label·textarea 자체)를 오른쪽 단으로 옮긴다 */
      [].slice.call(cols.querySelectorAll('textarea[data-type="code"]')).forEach(function (ta) {
        var host = ta.closest(".mycode") || ta.closest("label") || ta;
        if (host && host.parentNode && cols.contains(host)) r.appendChild(host);
      });
      var hasEd = r.children.length > 0;
      el.classList.add(hasEd ? "hased" : "noed");
      stage.appendChild(el);
      return { el: el, clip: clip, cols: cols, r: r, n: 1, hasEd: hasEd };
    });
    return { sec: sec, stage: stage, pages: pages };
  });

  /* ---------- 아래 막대 ---------- */
  var bar = document.createElement("div");
  bar.id = "bk-bar";
  bar.innerHTML = '<button type="button" id="bk-prev" aria-label="이전 쪽">← 이전</button>' +
    '<span class="bk-st" id="bk-st" aria-live="polite"></span>' +
    '<span class="bk-key"><kbd>←</kbd> <kbd>→</kbd> 방향키로 넘김</span>' +
    '<button type="button" id="bk-next" aria-label="다음 쪽">다음 →</button>';
  wrap.appendChild(bar);
  var bPrev = bar.querySelector("#bk-prev"), bNext = bar.querySelector("#bk-next"), bSt = bar.querySelector("#bk-st");

  root.classList.add("bk-on");

  /* ---------- 상태·그리기 ---------- */
  var st = { s: 0, p: 0, sub: 0 };
  var pendingEnd = false;

  function activeIdx() {
    for (var i = 0; i < S.length; i++) if (S[i].sec.classList.contains("st-active")) return i;
    return 0;
  }
  function curPage() { return S[st.s].pages[st.p]; }

  function measure(pg) {
    var W = pg.clip.clientWidth;
    var sw = pg.cols.scrollWidth;
    pg.W = W;
    pg.n = W > 0 ? Math.max(1, Math.ceil((sw + GAP) / (W + GAP) - 0.02)) : 1;
  }

  function render() {
    S.forEach(function (x, i) {
      x.pages.forEach(function (pg, j) { pg.el.classList.toggle("bk-cur", i === st.s && j === st.p); });
    });
    var pg = curPage();
    measure(pg);
    if (pendingEnd) { st.sub = pg.n - 1; pendingEnd = false; }
    if (st.sub > pg.n - 1) st.sub = pg.n - 1;
    if (st.sub < 0) st.sub = 0;
    pg.cols.style.transform = "translateX(" + (-st.sub * (pg.W + GAP)) + "px)";
    var P = S[st.s].pages.length;
    var txt = "";
    if (P > 1) txt += "쪽 " + (st.p + 1) + " / " + P;
    else txt += "쪽 1 / 1";
    if (pg.n > 1) txt += " · 이어서 " + (st.sub + 1) + " / " + pg.n;
    var tab = nav && nav.querySelector('a[href="#' + S[st.s].sec.id + '"]');
    if (tab) txt = tab.textContent + " · " + txt;
    bSt.textContent = txt;
    bPrev.disabled = !(st.s > 0 || st.p > 0 || st.sub > 0);
    bNext.disabled = !(st.s < S.length - 1 || st.p < S[st.s].pages.length - 1 || st.sub < pg.n - 1);
  }

  function openSection(i, atEnd) {
    var tab = nav && nav.querySelector('a[href="#' + S[i].sec.id + '"]');
    pendingEnd = !!atEnd;
    if (tab) tab.click(); /* sheettabs 가 활동을 바꾼다. 아래 감시자가 첫 쪽으로 맞춘다. */
  }

  function step(d) {
    var pg = curPage();
    if (d > 0) {
      if (st.sub < pg.n - 1) { st.sub++; return render(); }
      if (st.p < S[st.s].pages.length - 1) { st.p++; st.sub = 0; return render(); }
      if (st.s < S.length - 1) openSection(st.s + 1, false);
    } else {
      if (st.sub > 0) { st.sub--; return render(); }
      if (st.p > 0) { st.p--; st.sub = 0; pendingEnd = true; return render(); }
      if (st.s > 0) openSection(st.s - 1, true);
    }
  }

  bPrev.addEventListener("click", function () { step(-1); });
  bNext.addEventListener("click", function () { step(1); });

  /* 방향키: 글을 쓰는 중(입력란·편집기)이거나 팝업이 열려 있으면 넘기지 않는다 */
  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
    var k = e.key;
    var d = (k === "ArrowRight" || k === "PageDown") ? 1 : (k === "ArrowLeft" || k === "PageUp") ? -1 : 0;
    if (!d) return;
    var t = e.target;
    if (t && t.closest && t.closest("input,textarea,select,[contenteditable=''],[contenteditable='true'],.ck-ac")) return;
    if (document.querySelector(".ck-modal:not([hidden])")) return;
    var chat = document.getElementById("ck-chat");
    if (chat && (chat.open || (chat.offsetParent && !chat.hidden && getComputedStyle(chat).display !== "none"))) return;
    e.preventDefault();
    step(d);
  });

  /* 활동이 바뀌면 그 활동의 첫 쪽(되돌아올 때는 마지막 쪽)을 연다 */
  var mo = new MutationObserver(function () {
    var i = activeIdx();
    if (i === st.s) return;
    st.s = i;
    if (pendingEnd) { st.p = S[i].pages.length - 1; st.sub = 0; }
    else { st.p = 0; st.sub = 0; }
    render();
  });
  secs.forEach(function (sec) { mo.observe(sec, { attributes: true, attributeFilter: ["class"] }); });

  /* 본문 안 #링크·주소 해시가 문항 안의 요소를 가리키면 그 쪽을 연다 */
  function syncHash(h) {
    var id = decodeURIComponent((h || "").replace(/^#/, ""));
    var el = id && document.getElementById(id);
    if (!el) return;
    var pgEl = el.closest ? el.closest(".bk-page") : null;
    if (!pgEl) return;
    var i = activeIdx();
    var j = S[i].pages.map(function (x) { return x.el; }).indexOf(pgEl);
    if (j < 0) return;
    st.s = i; st.p = j; st.sub = 0;
    render();
    /* 같은 쪽 안에서 요소가 뒤쪽 단에 있으면 그 단까지 민다 */
    var pg = curPage();
    var off = el.getBoundingClientRect().left - pg.clip.getBoundingClientRect().left;
    var sub = Math.max(0, Math.min(pg.n - 1, Math.floor(off / (pg.W + GAP))));
    if (sub) { st.sub = sub; render(); }
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("a[href^='#']") : null;
    if (a && a.getAttribute("href").length > 1) syncHash(a.getAttribute("href"));
  });
  window.addEventListener("hashchange", function () { syncHash(location.hash); });

  /* 내용이 바뀌면(질문 답, 펼침, 편집기 생성, 글꼴 로드, 창 크기) 쪽 수를 다시 센다 */
  var sched = 0;
  function relayout() {
    if (sched) return;
    sched = requestAnimationFrame(function () { sched = 0; render(); });
  }
  window.addEventListener("resize", relayout);
  window.addEventListener("load", relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  S.forEach(function (x) {
    x.stage.addEventListener("click", relayout);
    x.stage.addEventListener("input", relayout);
    x.stage.addEventListener("toggle", relayout, true);
    new MutationObserver(relayout).observe(x.stage, { childList: true, subtree: true, characterData: true });
  });

  /* 처음: 해시가 있으면 그 쪽, 없으면 현재 활동의 첫 쪽 */
  st.s = activeIdx();
  render();
  if (location.hash) syncHash(location.hash);
})();
