async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  await chrome.tabs.sendMessage(tab.id, message);
}

document.querySelector("#start").addEventListener("click", async () => {
  await sendToActiveTab({ type: "start-mapping" });
  document.querySelector("#status").textContent = "페이지에서 입력창이나 버튼을 클릭하세요.";
});

document.querySelector("#stop").addEventListener("click", async () => {
  await sendToActiveTab({ type: "stop-mapping" });
  document.querySelector("#status").textContent = "매핑 모드를 껐습니다.";
});
