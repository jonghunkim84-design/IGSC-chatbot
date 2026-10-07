/*!
 * IGSC 인증 문의 챗봇 위젯
 * 삽입: <script src="https://{챗봇 도메인}/widget.js" async></script>
 *       (유입 채널은 기본 homepage 로 기록된다. 바꾸려면 data-src="채널코드" 를 붙인다)
 * - Shadow DOM 안에 버튼/패널을 만들어 고객사 CSS와 서로 영향을 주지 않는다.
 * - 패널은 {챗봇 도메인}/chat 을 iframe 으로 연다 (첫 클릭 시 로드).
 * - 화면 폭 480px 이하에서는 전체 화면으로 열린다.
 */
(function () {
  "use strict";
  if (window.__igscChatWidget) return;
  window.__igscChatWidget = true;

  var script = document.currentScript;
  if (!script || !script.src) {
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (/\/widget\.js(\?|#|$)/.test(all[i].src)) { script = all[i]; break; }
    }
  }
  if (!script || !script.src) return;

  var a = document.createElement("a");
  a.href = script.src;
  // 유입 채널 표시: 기본은 홈페이지. 다른 사이트에 넣을 때는 <script … data-src="채널코드"> 로 바꾼다.
  var SRC = script.getAttribute("data-src") || "homepage";
  var CHAT_URL = a.protocol + "//" + a.host + "/chat?src=" + encodeURIComponent(SRC);
  var TITLE = "IGSC 인증 문의 챗봇";
  var Z = 2147483000;

  var CSS =
    ":host{all:initial}" +
    "*,*::before,*::after{box-sizing:border-box}" +
    ".fab{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));width:56px;height:56px;border-radius:50%;" +
    "border:0;padding:0;margin:0;background:#0f766e;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;" +
    "box-shadow:0 4px 14px rgba(0,0,0,.28);z-index:" + Z + ";-webkit-tap-highlight-color:transparent}" +
    ".fab:hover{background:#115e59}.fab:focus-visible,.x:focus-visible{outline:3px solid #99f6e4;outline-offset:2px}" +
    ".fab svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}" +
    ".panel{position:fixed;right:20px;bottom:calc(88px + env(safe-area-inset-bottom,0px));width:380px;height:min(640px,calc(100vh - 110px));" +
    "background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.28);z-index:" + Z + ";display:none}" +
    ".panel.open{display:block}" +
    ".frame{display:block;width:100%;height:100%;border:0;background:#fff}" +
    ".x{position:absolute;top:2px;right:2px;width:44px;height:44px;border:0;padding:0;margin:0;background:transparent;color:#fff;cursor:pointer;" +
    "display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}" +
    ".x svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;pointer-events:none}" +
    "@media (max-width:480px){" +
    ".panel{top:0;left:0;right:0;bottom:0;width:100%;height:100vh;height:100dvh;border-radius:0;box-shadow:none}" +
    ".fab.hidden{display:none}}" +
    "@media print{.fab,.panel{display:none}}";

  var ICON_CHAT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function init() {
    var host = document.createElement("div");
    host.id = "igsc-cw-root";
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

    var style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    var panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", TITLE);

    var frame = null;
    var close = document.createElement("button");
    close.type = "button";
    close.className = "x";
    close.setAttribute("aria-label", "챗봇 닫기");
    close.innerHTML = ICON_CLOSE;
    panel.appendChild(close);

    var fab = document.createElement("button");
    fab.type = "button";
    fab.className = "fab";
    fab.setAttribute("aria-label", TITLE + " 열기");
    fab.setAttribute("aria-expanded", "false");
    fab.innerHTML = ICON_CHAT;

    root.appendChild(panel);
    root.appendChild(fab);

    var isOpen = false;
    var prevOverflow = "";
    var mobile = window.matchMedia ? window.matchMedia("(max-width:480px)") : { matches: false };

    function setOpen(open) {
      isOpen = open;
      if (open && !frame) {
        frame = document.createElement("iframe");
        frame.className = "frame";
        frame.title = TITLE;
        frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
        frame.src = CHAT_URL;
        panel.insertBefore(frame, close);
      }
      panel.className = "panel" + (open ? " open" : "");
      fab.className = "fab" + (open && mobile.matches ? " hidden" : "");
      fab.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
      fab.setAttribute("aria-expanded", open ? "true" : "false");
      fab.setAttribute("aria-label", TITLE + (open ? " 닫기" : " 열기"));
      var de = document.documentElement;
      if (open && mobile.matches) {
        prevOverflow = de.style.overflow;
        de.style.overflow = "hidden"; // 전체 화면 패널 뒤 페이지 스크롤 방지
      } else if (!open && prevOverflow !== null) {
        de.style.overflow = prevOverflow;
        prevOverflow = "";
      }
      if (open && frame) { try { frame.focus(); } catch { /* noop */ } }
      if (!open) { try { fab.focus(); } catch { /* noop */ } }
    }

    fab.addEventListener("click", function () { setOpen(!isOpen); });
    close.addEventListener("click", function () { setOpen(false); });
    document.addEventListener("keydown", function (e) {
      if (isOpen && (e.key === "Escape" || e.key === "Esc")) setOpen(false);
    });

    document.body.appendChild(host);
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);
})();
