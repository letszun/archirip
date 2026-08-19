(() => {
  "use strict";

  const CURRENT_VERSION = "v24";
  const CURRENT_BUILD = "2026.08.19";

  if (document.querySelector("#settingsToggle")) return;

  const style = document.createElement("style");
  style.textContent = `
    .round-nav,.round-plus,.theme-toggle,.note-add,.add-submit,.settings-toggle,.settings-close{box-sizing:border-box}
    .round-nav::before,.round-nav::after{content:"";position:absolute;left:50%;width:8px;height:1px;background:var(--control-icon);transform-origin:50% 50%}
    .round-nav.right::before{top:calc(50% - 2.25px);transform:translate(-50%,-50%) rotate(45deg)}
    .round-nav.right::after{top:calc(50% + 2.25px);transform:translate(-50%,-50%) rotate(-45deg)}
    .round-nav.left::before{top:calc(50% - 2.25px);transform:translate(-50%,-50%) rotate(-45deg)}
    .round-nav.left::after{top:calc(50% + 2.25px);transform:translate(-50%,-50%) rotate(45deg)}
    .round-plus::before,.round-plus::after,.note-add::before,.note-add::after{left:50%;top:50%;transform:translate(-50%,-50%);transform-origin:50% 50%}
    .round-plus::after,.note-add::after{transform:translate(-50%,-50%) rotate(90deg)}
    .theme-toggle::before{left:50%;top:50%;transform:translate(-50%,-50%)}
    .theme-toggle::after{left:50%;top:50%;transform:translate(0,-50%)}
    html[data-theme="dark"] .theme-toggle::after{transform:translate(-100%,-50%)}
    .add-submit::before{left:50%;top:50%;transform:translate(-50%,-50%) rotate(-45deg);transform-origin:50% 50%}

    .settings-toggle{position:fixed;top:clamp(64px,calc(3vw + 46px),80px);right:clamp(16px,3vw,42px);width:38px;height:38px;display:grid;place-items:center;padding:0;border:1px solid var(--control-border);border-radius:50%;background:var(--control-bg);color:var(--control-icon);z-index:45;transition:border-color .16s ease,background-color .22s ease,transform .16s ease}
    .settings-toggle:hover{border-color:var(--muted)}
    .settings-toggle:active{transform:scale(.94)}
    .settings-dots{display:flex;align-items:center;justify-content:center;gap:3px;width:max-content;height:3px;margin:0;padding:0}
    .settings-dot{display:block;width:2.5px;height:2.5px;flex:0 0 2.5px;border-radius:50%;background:currentColor}
    .settings-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.08);opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:78}
    html[data-theme="dark"] .settings-backdrop{background:rgba(0,0,0,.2)}
    .settings-backdrop.open{opacity:1;pointer-events:auto}
    .settings-panel{position:fixed;top:clamp(18px,3vw,32px);right:clamp(16px,3vw,42px);width:min(310px,calc(100vw - 32px));padding:22px 20px 18px;border:1px solid var(--control-border);border-radius:18px;background:var(--bg);color:var(--ink);z-index:80;opacity:0;pointer-events:none;transform:translateY(-8px) scale(.985);transform-origin:top right;transition:opacity .18s ease,transform .18s ease,background-color .22s ease;box-shadow:0 14px 42px rgba(0,0,0,.08)}
    html[data-theme="dark"] .settings-panel{box-shadow:0 14px 42px rgba(0,0,0,.22)}
    .settings-panel.open{opacity:1;pointer-events:auto;transform:translateY(0) scale(1)}
    .settings-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
    .settings-title{font-size:13px;font-weight:500;letter-spacing:.01em}
    .settings-close{position:relative;width:28px;height:28px;padding:0;border:1px solid var(--control-border);border-radius:50%}
    .settings-close::before,.settings-close::after{content:"";position:absolute;left:50%;top:50%;width:9px;height:1px;background:var(--control-icon)}
    .settings-close::before{transform:translate(-50%,-50%) rotate(45deg)}
    .settings-close::after{transform:translate(-50%,-50%) rotate(-45deg)}
    .settings-row{display:grid;grid-template-columns:92px 1fr;gap:14px;padding:13px 0;border-top:1px solid var(--line);font-size:11px;line-height:1.5}
    .settings-label{color:var(--muted)}
    .settings-value{text-align:right;font-variant-numeric:tabular-nums}
    .settings-status{color:var(--muted)}
    .settings-status.latest{color:var(--ink)}
    .settings-refresh{display:none;width:100%;margin-top:14px;padding:11px 12px;border-radius:999px;background:var(--action-bg);color:var(--action-ink);font-size:10px;text-align:center}
    .settings-refresh.visible{display:block}
    .settings-check{width:100%;margin-top:10px;padding:8px 0 2px;color:var(--muted);font-size:9px;text-align:center}
    .settings-check:hover,.settings-check:focus-visible{color:var(--ink);outline:none}
  `;
  document.head.appendChild(style);

  const toggle = document.createElement("button");
  toggle.id = "settingsToggle";
  toggle.className = "settings-toggle";
  toggle.type = "button";
  toggle.innerHTML = '<span class="settings-dots" aria-hidden="true"><i class="settings-dot"></i><i class="settings-dot"></i><i class="settings-dot"></i></span>';
  toggle.setAttribute("aria-label", "설정 열기");
  toggle.setAttribute("aria-expanded", "false");

  const backdrop = document.createElement("div");
  backdrop.className = "settings-backdrop";

  const panel = document.createElement("section");
  panel.className = "settings-panel";
  panel.setAttribute("aria-label", "설정");
  panel.innerHTML = `
    <div class="settings-head"><div class="settings-title">설정</div><button class="settings-close" type="button" aria-label="설정 닫기"></button></div>
    <div class="settings-row"><div class="settings-label">현재 버전</div><div class="settings-value">${CURRENT_VERSION}</div></div>
    <div class="settings-row"><div class="settings-label">최신 버전</div><div id="settingsLatestVersion" class="settings-value">확인 전</div></div>
    <div class="settings-row"><div class="settings-label">상태</div><div id="settingsVersionStatus" class="settings-value settings-status">업데이트 확인 필요</div></div>
    <div class="settings-row"><div class="settings-label">빌드</div><div class="settings-value">${CURRENT_BUILD}</div></div>
    <div class="settings-row"><div class="settings-label">책 추가</div><div class="settings-value">ISBN 13자리 + 직접 등록</div></div>
    <button id="settingsRefresh" class="settings-refresh" type="button">최신 버전 불러오기</button>
    <button id="settingsCheck" class="settings-check" type="button">업데이트 다시 확인</button>
  `;

  document.body.append(toggle, backdrop, panel);

  const closeButton = panel.querySelector(".settings-close");
  const latestEl = panel.querySelector("#settingsLatestVersion");
  const statusEl = panel.querySelector("#settingsVersionStatus");
  const refreshButton = panel.querySelector("#settingsRefresh");
  const checkButton = panel.querySelector("#settingsCheck");

  toggle.addEventListener("click", () => panel.classList.contains("open") ? close() : open());
  backdrop.addEventListener("click", close);
  closeButton.addEventListener("click", close);
  checkButton.addEventListener("click", checkVersion);

  refreshButton.addEventListener("click", () => {
    const latest = refreshButton.dataset.version || "latest";
    const url = new URL(location.href);
    url.searchParams.set("app", latest);
    location.replace(url.toString());
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("open")) close();
  });

  function open() {
    panel.classList.add("open");
    backdrop.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "설정 닫기");
    checkVersion();
  }

  function close() {
    panel.classList.remove("open");
    backdrop.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "설정 열기");
  }

  async function checkVersion() {
    latestEl.textContent = "확인 중…";
    statusEl.textContent = "업데이트 확인 중";
    statusEl.classList.remove("latest");
    refreshButton.classList.remove("visible");

    try {
      const response = await fetch(`./version.json?t=${Date.now()}`, {
        cache: "no-store",
        credentials: "same-origin"
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const latest = String(data?.version || "").trim();
      if (!latest) throw new Error("missing version");

      latestEl.textContent = latest;

      if (latest === CURRENT_VERSION) {
        statusEl.textContent = "최신 버전입니다";
        statusEl.classList.add("latest");
      } else {
        statusEl.textContent = `새 버전 ${latest} 있음`;
        refreshButton.dataset.version = latest;
        refreshButton.classList.add("visible");
      }
    } catch (error) {
      console.warn("Version check failed", error);
      latestEl.textContent = "확인 실패";
      statusEl.textContent = "네트워크 연결 후 다시 확인";
    }
  }
})();