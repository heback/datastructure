/* chatkit.js — 탐구 활동지·실습 코드의 AI 도우미(챗봇).
   - 오른쪽 아래 [AI 도우미] 단추를 누르면 대화창이 열린다. 학교 계정(@ts.hs.kr)으로 로그인해야 쓸 수 있다.
   - 질문은 Firebase Cloud Function `chat`(Gemini Flash-Lite)으로 가고, 현재 보고 있는 문항의 본문(닫힌 상자 제외)과
     학생이 그 문항에 쓴 답·코드(선택)를 함께 보낸다. 서버가 힌트만 주도록 지시하고, 질문과 답변은 교사가 볼 수 있게 기록한다.
   - Firebase는 대화창을 처음 열 때만 불러온다. 인쇄할 때는 숨긴다. */
(function () {
  "use strict";
  var CFG = { "apiKey": "AIzaSyC9ar4WbYKUEWDYsVkdAyFEPGusWPKLWA0", "authDomain": "dshs-ds-grader.firebaseapp.com", "projectId": "dshs-ds-grader", "appId": "1:102718931158:web:b439c1de801ed95a468977" };
  var BASE = "https://www.gstatic.com/firebasejs/10.12.2/", REGION = "asia-northeast3", DOMAIN = "@ts.hs.kr";
  var ACK_KEY = "ck-chat-ack-v2", MAX_HIST = 8;
  var MAX_IMGS = 3, MAX_IMG_B64 = 300000, MAX_IMG_TOTAL = 880000;   /* 서버(chat.js) 한도보다 조금 작게 줄여 보낸다 */

  var path = decodeURIComponent(location.pathname), pm = /week(\d+)\/([^\/]+\.html)$/.exec(path);
  var WEEK = pm ? parseInt(pm[1], 10) : 0, FILE = pm ? pm[2] : "";

  var fab, panel, body, where, input, mineBox, meter, foot, strip;
  var pending = [];   /* 붙여넣은 이미지 {mime, data(base64), url} */
  var fb = null, user = null, callChat = null, loading = null;
  var msgs = [], convId = newId(), busy = false, enabled = true;

  function newId() { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 저장 못 해도 동작한다 */ } }

  /* ── 현재 문항 찾기와 본문·입력 모으기 ── */
  function sections() {
    var wrap = document.querySelector(".wrap");
    return wrap ? [].slice.call(wrap.querySelectorAll(":scope>section")) : [];
  }
  function currentSection() {
    var vis = sections().filter(function (s) { return s.offsetParent !== null; });
    if (!vis.length) return null;
    for (var i = 0; i < vis.length; i++) { if (vis[i].getBoundingClientRect().bottom > 140) return vis[i]; }
    return vis[vis.length - 1];
  }
  var BLOCK = /^(P|DIV|LI|UL|OL|TR|TABLE|H[1-6]|PRE|SECTION|BLOCKQUOTE|DL|DT|DD|FIGCAPTION)$/;
  var SKIP = /^(SCRIPT|STYLE|SVG|BUTTON|NOSCRIPT|TEXTAREA|INPUT|SELECT|NAV)$/;
  function textOf(root) {
    var out = [];
    (function walk(n) {
      if (n.nodeType === 3) { out.push(n.nodeValue.replace(/\s+/g, " ")); return; }
      if (n.nodeType !== 1) return;
      var t = n.tagName;
      if (SKIP.test(t) || n.hidden || n.hasAttribute("data-noex")) return;
      if (t === "DETAILS" && !n.open) return;                      /* 아직 열지 않은 접힘 상자(정답·일반화 등)는 보내지 않는다 */
      if (n.classList.contains("ck-ed") || n.classList.contains("ck-modal")) return; /* 편집기는 '내 코드'로 따로 보낸다 */
      if (t === "PRE") { out.push("\n" + n.textContent.replace(/\s+$/, "") + "\n"); return; }
      var b = BLOCK.test(t);
      if (b) out.push("\n");
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (t === "TD" || t === "TH") out.push(" | ");
      if (b) out.push("\n");
    })(root);
    return out.join("").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function mineOf(sec) {
    var parts = [];
    [].forEach.call(sec.querySelectorAll("textarea[data-key], input[data-key]"), function (f) {
      var type = (f.type || "").toLowerCase();
      if (type === "radio" || type === "checkbox" || type === "button" || type === "hidden") return;
      var v = (f.value || "").trim();
      if (!v) return;
      var s = "[" + f.getAttribute("data-key") + "]\n" + v.slice(0, 1400);
      var box = f.closest(".ck-ed"), o = box && box.querySelector(".ck-out:not([hidden]) pre");
      if (o && o.textContent.trim()) s += "\n[실행 결과]\n" + o.textContent.trim().slice(0, 600);
      parts.push(s);
    });
    return parts.join("\n\n");
  }
  function context() {
    var sec = currentSection(), h = sec && sec.querySelector("h2");
    var title = h ? (h.firstChild ? h.firstChild.textContent : h.textContent).trim() : "";
    return {
      week: WEEK, file: FILE, sectionId: sec ? sec.id : "", title: title,
      text: sec ? textOf(sec) : "", mine: sec && mineBox && mineBox.checked ? mineOf(sec) : ""
    };
  }
  function refreshWhere() {
    var c = currentSection(), h = c && c.querySelector("h2");
    var t = h ? (h.firstChild ? h.firstChild.textContent : h.textContent).trim() : "";
    where.textContent = "지금 보는 문항: " + (t || (c && c.id) || "이 페이지");
  }

  /* ── 글 꾸미기(안전하게: 먼저 이스케이프한 뒤 코드·굵게·문단만 처리) ── */
  function esc(s) { return s.replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  /* 마크다운 렌더링: 모델 답변을 안전하게 HTML로 바꾼다(모든 글자는 먼저 이스케이프한다).
     지원: 제목(#), 굵게, 기울임, 취소선, `코드`, 코드 블록, 목록(-, *, 1.; 들여쓰기 중첩), 인용(>), 구분선, 표, 링크(http/https만) */
  function inline(s) {
    var codes = [];
    s = esc(s).replace(/`([^`\n]+)`/g, function (_, c) { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s()]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*(?=\S)([^\n]+?)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^\w])__(?=\S)([^\n]+?)__(?![\w])/g, "$1<b>$2</b>")
      .replace(/~~(?=\S)([^\n]+?)~~/g, "<del>$1</del>")
      .replace(/(^|[^\w*])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?![\w*])/g, "$1<i>$2</i>")
      .replace(/(^|[^\w])_([^\s_](?:[^_\n]*[^\s_])?)_(?![\w])/g, "$1<i>$2</i>");
    return s.replace(/\u0000(\d+)\u0000/g, function (_, n) { return "<code>" + codes[+n] + "</code>"; });
  }
  function cells(line) { return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); }); }
  function prose(text) {
    var lines = text.replace(/\r/g, "").split("\n"), html = "", i = 0, para = [];
    function flush() { if (para.length) { html += "<p>" + para.map(inline).join("<br>") + "</p>"; para = []; } }
    var LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    while (i < lines.length) {
      var ln = lines[i], m;
      if (!ln.trim()) { flush(); i++; continue; }
      if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(ln))) { flush(); var lv = m[1].length; html += '<div class="cc-h cc-h' + (lv <= 2 ? 1 : 2) + '">' + inline(m[2]) + "</div>"; i++; continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); html += "<hr>"; i++; continue; }
      if (/^\s{0,3}>/.test(ln)) {
        flush(); var q = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) { q.push(lines[i].replace(/^\s{0,3}>\s?/, "")); i++; }
        html += "<blockquote>" + prose(q.join("\n")) + "</blockquote>"; continue;
      }
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flush(); var head = cells(ln); i += 2; var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        html += '<div class="cc-tw"><table><thead><tr>' + head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          rows.map(function (r) { return "<tr>" + head.map(function (_, k) { return "<td>" + inline(r[k] || "") + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
        continue;
      }
      if (LI.test(ln)) {
        flush();
        var stack = [], out = "";   /* stack: {indent, tag} */
        while (i < lines.length && (m = LI.exec(lines[i]))) {
          var ind = m[1].replace(/\t/g, "    ").length, tag = /\d/.test(m[2]) ? "ol" : "ul";
          while (stack.length && ind < stack[stack.length - 1].indent) { out += "</li></" + stack.pop().tag + ">"; }
          if (stack.length && ind === stack[stack.length - 1].indent) {
            if (stack[stack.length - 1].tag !== tag) { out += "</li></" + stack.pop().tag + "><" + tag + "><li>"; stack.push({ indent: ind, tag: tag }); }
            else out += "</li><li>";
          } else if (!stack.length || ind > stack[stack.length - 1].indent) { out += "<" + tag + "><li>"; stack.push({ indent: ind, tag: tag }); }
          out += inline(m[3]); i++;
          /* 같은 항목의 이어지는 줄(들여쓴 일반 문장) */
          while (i < lines.length && lines[i].trim() && !LI.test(lines[i]) && /^\s+\S/.test(lines[i])) { out += "<br>" + inline(lines[i].trim()); i++; }
        }
        while (stack.length) out += "</li></" + stack.pop().tag + ">";
        html += out; continue;
      }
      para.push(ln.trim()); i++;
    }
    flush();
    return html;
  }
  function render(text) {
    var html = "", re = /```[^\n]*\n([\s\S]*?)(?:```|$)/g, last = 0, m;
    while ((m = re.exec(text))) {
      html += prose(text.slice(last, m.index));
      html += "<pre><code>" + esc(m[1].replace(/\s+$/, "")) + "</code></pre>";
      last = re.lastIndex;
      if (m[0].length === 0) re.lastIndex++;
    }
    html += prose(text.slice(last));
    return html;
  }

  /* ── 화면 ── */
  function build() {
    fab = el("button", "", ""); fab.id = "ck-chat-fab"; fab.type = "button";
    fab.appendChild(el("span", "ck-dot")); fab.appendChild(document.createTextNode("AI 도우미"));
    fab.setAttribute("aria-haspopup", "dialog");
    panel = el("section"); panel.id = "ck-chat"; panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "AI 도우미");

    var head = el("div", "cc-head"); head.appendChild(el("b", "", "AI 도우미"));
    var bNew = el("button", "", "새 대화"), bClose = el("button", "", "닫기");
    bNew.type = bClose.type = "button"; head.appendChild(bNew); head.appendChild(bClose);
    where = el("div", "cc-where");
    body = el("div", "cc-body"); body.setAttribute("aria-live", "polite");

    foot = el("div", "cc-foot");
    var opt = el("div", "cc-opt"), lab = el("label");
    mineBox = el("input"); mineBox.type = "checkbox"; mineBox.checked = true;
    lab.appendChild(mineBox); lab.appendChild(document.createTextNode("이 문항에 쓴 내 답·코드도 함께 보내기"));
    meter = el("span"); opt.appendChild(lab); opt.appendChild(meter);
    var row = el("div", "cc-row");
    strip = el("div", "cc-imgs"); strip.hidden = true;
    input = el("textarea"); input.placeholder = "막힌 점을 쓴다."; input.maxLength = 1200;
    input.setAttribute("aria-label", "질문 입력");
    row.appendChild(input);
    var hint = el("div", "cc-hint", "Enter: 보내기 · Shift+Enter: 줄바꿈 · 화면 캡처는 Ctrl/⌘+V로 붙여넣기");
    foot.appendChild(opt); foot.appendChild(strip); foot.appendChild(row); foot.appendChild(hint);

    panel.appendChild(head); panel.appendChild(where); panel.appendChild(body); panel.appendChild(foot);
    document.body.appendChild(fab); document.body.appendChild(panel);

    fab.addEventListener("click", open);
    bClose.addEventListener("click", close);
    bNew.addEventListener("click", function () { if (!busy) { msgs = []; pending = []; renderPending(); convId = newId(); showChat(); } });
    input.addEventListener("paste", onPaste);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
      if (e.key === "Escape") close();
    });
    /* 이 입력란의 키 입력이 페이지의 다른 단축키·자동 보관에 닿지 않게 한다 */
    ["keydown", "keyup", "keypress", "input", "paste"].forEach(function (t) { panel.addEventListener(t, function (e) { e.stopPropagation(); }); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden && !panel.contains(e.target)) close(); });
  }
  function open() { fab.hidden = true; panel.hidden = false; refreshWhere(); start(); }
  function close() { panel.hidden = true; fab.hidden = false; fab.focus(); }
  function scrollDown() { body.scrollTop = body.scrollHeight; }
  function setFoot(on) { input.disabled = !on || !enabled; }

  function add(cls, html, isText) {
    var d = el("div", "cc-m " + cls);
    if (isText) d.textContent = html; else d.innerHTML = html;
    body.appendChild(d); scrollDown(); return d;
  }

  function addMe(text, imgs) {
    var d = add("me", text, true);
    (imgs || []).forEach(function (u) { var i = el("img"); i.src = u; i.alt = "붙여넣은 이미지"; d.appendChild(i); });
    scrollDown(); return d;
  }

  /* ── 이미지 붙여넣기: 큰 캡처는 줄여서(JPEG) 보낸다 ── */
  function shrink(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var steps = [[1600, 0.7], [1400, 0.6], [1200, 0.55], [1024, 0.5], [800, 0.5]];
        for (var i = 0; i < steps.length; i++) {
          var sc = Math.min(1, steps[i][0] / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
          var c = document.createElement("canvas"); c.width = w; c.height = h;
          var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
          var u = c.toDataURL("image/jpeg", steps[i][1]), b = u.slice(u.indexOf(",") + 1);
          if (b.length <= MAX_IMG_B64) { res({ mime: "image/jpeg", data: b, url: u }); return; }
        }
        rej(new Error("이미지가 너무 커서 줄이지 못했다. 일부 영역만 캡처해 다시 붙여넣는다."));
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("이미지를 읽지 못했다.")); };
      img.src = url;
    });
  }
  function renderPending() {
    strip.textContent = ""; strip.hidden = !pending.length;
    pending.forEach(function (p, i) {
      var t = el("span", "cc-th"), im = el("img"), x = el("button", "", "\u00d7");
      im.src = p.url; im.alt = "붙여넣은 이미지 " + (i + 1); x.type = "button"; x.title = "이 이미지 빼기"; x.setAttribute("aria-label", "이미지 " + (i + 1) + " 빼기");
      x.addEventListener("click", function () { pending.splice(i, 1); renderPending(); });
      t.appendChild(im); t.appendChild(x); strip.appendChild(t);
    });
  }
  /* 연속으로 붙여넣어도 한 장씩 차례로 처리해야 장수·용량 한도가 정확하다 */
  var addQ = Promise.resolve();
  function addImages(files) { addQ = addQ.then(function () { return addImagesNow(files); }); return addQ; }
  async function addImagesNow(files) {
    for (var i = 0; i < files.length; i++) {
      if (pending.length >= MAX_IMGS) { add("sys", "이미지는 한 번에 " + MAX_IMGS + "장까지 붙여넣을 수 있다.", true); break; }
      try {
        var p = await shrink(files[i]);
        var total = pending.reduce(function (s, q) { return s + q.data.length; }, 0);
        if (total + p.data.length > MAX_IMG_TOTAL) { add("sys", "이미지 용량이 너무 크다. 장수를 줄이거나 일부 영역만 캡처한다.", true); break; }
        pending.push(p); renderPending();
      } catch (e) { add("err", e.message || "이미지를 붙여넣지 못했다.", true); }
    }
  }
  function onPaste(e) {
    var items = (e.clipboardData && e.clipboardData.items) || [], files = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && /^image\//.test(items[i].type)) { var f = items[i].getAsFile(); if (f) files.push(f); }
    }
    if (!files.length || busy) return;
    if (!e.clipboardData.getData("text/plain")) e.preventDefault();   /* 글자도 함께 복사했으면 글자는 그대로 붙인다 */
    addImages(files);
  }

  /* 처음 열 때: 안내 확인 → 로그인 → 대화 */
  function start() {
    body.textContent = ""; setFoot(false); meter.textContent = "";
    if (location.protocol === "file:") { add("err", "이 파일을 컴퓨터에서 직접 열어서는 쓸 수 없다. 배포된 사이트(웹 주소)에서 연다.", true); return; }
    if (lsGet(ACK_KEY) !== "1") { notice(); return; }
    login();
  }
  function notice() {
    var c = el("div", "cc-card"); c.appendChild(el("h4", "", "AI 도우미를 쓰기 전에"));
    var ul = el("ul");
    ["개념·문법 설명과 막힌 곳에 대한 힌트를 준다. 과제 코드와 활동지 답은 알려 주지 않는다.",
      "내가 한 질문과 AI의 답, 붙여넣은 이미지는 교사가 볼 수 있게 기록된다. 이름·연락처 같은 개인정보가 보이는 화면은 올리지 않는다.",
      "수업 중 AI 도움 없이 하는 활동에서는 쓰지 않는다. 그 시간에는 교사가 꺼 둘 수 있다.",
      "AI의 답은 틀릴 수 있다. 코드는 직접 실행해 확인한다."].forEach(function (t) { ul.appendChild(el("li", "", t)); });
    c.appendChild(ul);
    var b = el("button", "cc-btn", "확인하고 시작"); b.type = "button";
    b.addEventListener("click", function () { lsSet(ACK_KEY, "1"); start(); });
    c.appendChild(b); body.appendChild(c);
  }
  function loadFirebase() {
    if (loading) return loading;
    loading = (async function () {
      var app = await import(BASE + "firebase-app.js"), au = await import(BASE + "firebase-auth.js"), fn = await import(BASE + "firebase-functions.js");
      var a = app.initializeApp(CFG), auth = au.getAuth(a);
      fb = { au: au, auth: auth };
      callChat = fn.httpsCallable(fn.getFunctions(a, REGION), "chat", { timeout: 60000 });
      await new Promise(function (res) { var off = au.onAuthStateChanged(auth, function (u) { user = u; off(); res(); }); });
      au.onAuthStateChanged(auth, function (u) { user = u; });
    })().catch(function (e) { loading = null; throw e; });
    return loading;
  }
  async function login() {
    body.textContent = ""; setFoot(false);
    var wait = add("sys", "불러오는 중…", true);
    try { await loadFirebase(); } catch (e) { wait.remove(); add("err", "AI 도우미를 불러오지 못했다. 인터넷 연결을 확인하고 다시 연다.", true); return; }
    wait.remove();
    if (user && (!user.emailVerified || !String(user.email || "").endsWith(DOMAIN))) { try { await fb.au.signOut(fb.auth); } catch (_) { /* 무시 */ } user = null; }
    if (!user) {
      var c = el("div", "cc-card"); c.appendChild(el("h4", "", "학교 계정으로 로그인"));
      c.appendChild(el("p", "", "AI 도우미는 학교 계정(" + DOMAIN + ")으로 로그인해야 쓸 수 있다."));
      var b = el("button", "cc-btn", "Google 계정으로 로그인"); b.type = "button";
      var m = el("div", "cc-m err"); m.hidden = true;
      b.addEventListener("click", async function () {
        b.disabled = true; m.hidden = true;
        try {
          var p = new fb.au.GoogleAuthProvider(); p.setCustomParameters({ hd: "ts.hs.kr", prompt: "select_account" });
          var r = await fb.au.signInWithPopup(fb.auth, p);
          if (!r.user.emailVerified || !String(r.user.email || "").endsWith(DOMAIN)) {
            await fb.au.signOut(fb.auth); user = null;
            m.textContent = (r.user.email || "이 계정") + " 계정은 쓸 수 없다. 학교 계정으로 로그인한다."; m.hidden = false; b.disabled = false; return;
          }
          user = r.user; showChat();
        } catch (e) {
          m.textContent = "로그인하지 못했다: " + (e && (e.code || e.message) || e); m.hidden = false; b.disabled = false;
        }
      });
      c.appendChild(b); c.appendChild(m); body.appendChild(c); return;
    }
    showChat();
  }
  async function showChat() {
    body.textContent = ""; enabled = true;
    add("sys", user.email + " 계정으로 연결했다. 막힌 점을 쓰면 힌트를 준다.", true);
    msgs.forEach(function (m) { if (m.role === "user") addMe(m.text, m.imgs); else add("bot", render(m.text)); });
    setFoot(true); refreshWhere();
    try {
      var r = await callChat({ action: "status", context: { week: WEEK, file: FILE } });
      enabled = r.data.enabled !== false;
      showMeter(r.data);
      if (!enabled) add("err", r.data.message || "지금은 AI 도우미를 쓸 수 없다.", true);
      else if (r.data.message) add("sys", r.data.message, true);
    } catch (e) { /* 상태를 못 받아도 질문은 시도해 볼 수 있다 */ }
    setFoot(true); if (enabled) input.focus();
  }
  function showMeter(d) {
    var t = d && d.limit != null ? "오늘 " + (d.used || 0) + "/" + d.limit + "회" : "";
    if (d && d.weekLimit != null) t += (t ? " · " : "") + (d.week || WEEK) + "주차 " + (d.weekUsed || 0) + "/" + d.weekLimit + "회";
    meter.textContent = t;
  }

  async function send() {
    var q = input.value.trim();
    if (busy || (!q && !pending.length) || !callChat) return;
    busy = true; setFoot(false);
    var hist = msgs.slice(-MAX_HIST).map(function (m) { return { role: m.role, text: m.text }; });
    while (hist.length && hist[0].role !== "user") hist.shift();
    var imgs = pending.slice(), shown = q || "(이미지를 붙여넣었다)";
    addMe(shown, imgs.map(function (p) { return p.url; })); input.value = "";
    var wait = add("bot", "<span class=\"cc-typing\">생각하는 중…</span>");
    try {
      var r = await callChat({ message: q, history: hist, convId: convId, context: context(),
        images: imgs.map(function (p) { return { mime: p.mime, data: p.data }; }) });
      pending = []; renderPending();
      wait.innerHTML = render(r.data.answer); scrollDown();
      msgs.push({ role: "user", text: q || "(이미지 첨부)", imgs: imgs.map(function (p) { return p.url; }) }, { role: "model", text: r.data.answer });
      showMeter(r.data);
    } catch (e) {
      wait.className = "cc-m err"; wait.textContent = (e && e.code === "functions/unauthenticated") ? "로그인이 끝났다. 닫았다가 다시 연다." : (e && e.message) || "답을 받지 못했다. 다시 보낸다.";
      if (e && e.code === "functions/failed-precondition") enabled = false;
      input.value = q;
    }
    busy = false; setFoot(true); if (enabled) input.focus();
  }

  function init() { if (document.getElementById("ck-chat-fab")) return; build(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
