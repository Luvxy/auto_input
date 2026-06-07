const statusElement = document.querySelector("#status");

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("현재 탭을 찾을 수 없습니다.");
  }
  return tab;
}

function getOriginPattern(tabUrl) {
  const url = new URL(tabUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("http 또는 https 웹페이지에서만 사용할 수 있습니다.");
  }
  return `${url.origin}/*`;
}

async function ensureCurrentSitePermission(tab) {
  const origin = getOriginPattern(tab.url);
  const hasPermission = await chrome.permissions.contains({ origins: [origin] });
  if (hasPermission) {
    return;
  }

  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    throw new Error("현재 사이트 권한이 필요합니다.");
  }
}

async function ensureContentScript(tab) {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  });
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  await ensureCurrentSitePermission(tab);
  await ensureContentScript(tab);
  await chrome.tabs.sendMessage(tab.id, message);
}

document.querySelector("#start").addEventListener("click", async () => {
  try {
    statusElement.textContent = "현재 사이트 권한을 확인하는 중입니다.";
    await sendToActiveTab({ type: "start-mapping" });
    statusElement.textContent = "페이지에서 입력창이나 버튼을 클릭하세요.";
  } catch (error) {
    statusElement.textContent = error.message || "매핑 모드를 시작하지 못했습니다.";
  }
});

document.querySelector("#stop").addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    await chrome.tabs.sendMessage(tab.id, { type: "stop-mapping" });
    statusElement.textContent = "매핑 모드를 껐습니다.";
  } catch {
    statusElement.textContent = "매핑 모드가 실행 중인 탭이 없습니다.";
  }
});
