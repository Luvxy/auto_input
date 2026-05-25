let mappingMode = false;
let hoveredElement = null;
let previousOutline = "";
let previousCursor = "";
let bridgeSocket;
let reconnectTimer;

connectBridge();

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "start-mapping") {
    mappingMode = true;
    document.documentElement.style.cursor = "crosshair";
  }

  if (message.type === "stop-mapping") {
    stopMappingMode();
  }
});

document.addEventListener("mouseover", (event) => {
  if (!mappingMode) return;
  if (hoveredElement && hoveredElement !== event.target) {
    restoreHover();
  }

  hoveredElement = event.target;
  previousOutline = hoveredElement.style.outline;
  previousCursor = hoveredElement.style.cursor;
  hoveredElement.style.outline = "2px solid #1f7a66";
  hoveredElement.style.cursor = "crosshair";
}, true);

document.addEventListener("mouseout", () => {
  if (!mappingMode) return;
  restoreHover();
}, true);

document.addEventListener("click", (event) => {
  if (!mappingMode) return;

  event.preventDefault();
  event.stopPropagation();

  const element = event.target;
  const payload = inspectElement(element);
  sendMapping(payload);
  stopMappingMode();
}, true);

function stopMappingMode() {
  mappingMode = false;
  document.documentElement.style.cursor = "";
  restoreHover();
}

function restoreHover() {
  if (!hoveredElement) return;
  hoveredElement.style.outline = previousOutline;
  hoveredElement.style.cursor = previousCursor;
  hoveredElement = null;
  previousOutline = "";
  previousCursor = "";
}

function inspectElement(element) {
  const tagName = element.tagName.toLowerCase();
  const type = inferType(element);
  const label = findLabel(element);
  const text = normalize(element.innerText || element.value || element.getAttribute("aria-label") || "");
  const placeholder = element.getAttribute("placeholder") || "";

  return {
    name: label || text || placeholder || `${tagName} ${type}`,
    type,
    selector: buildSelector(element),
    tagName,
    text,
    placeholder,
    url: location.href
  };
}

function inferType(element) {
  const tagName = element.tagName.toLowerCase();
  const inputType = (element.getAttribute("type") || "").toLowerCase();

  if (tagName === "button" || inputType === "button" || inputType === "submit") {
    return "button";
  }

  if (tagName === "select") {
    return "select";
  }

  if (inputType === "checkbox") {
    return "checkbox";
  }

  return "input";
}

function findLabel(element) {
  const id = element.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) {
      return normalize(label.innerText);
    }
  }

  const wrapperLabel = element.closest("label");
  if (wrapperLabel) {
    return normalize(wrapperLabel.innerText);
  }

  return "";
}

function buildSelector(element) {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const testId = element.getAttribute("data-testid") || element.getAttribute("data-test");
  if (testId) {
    return `[data-testid="${cssString(testId)}"]`;
  }

  const name = element.getAttribute("name");
  if (name) {
    return `${element.tagName.toLowerCase()}[name="${cssString(name)}"]`;
  }

  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    let part = current.tagName.toLowerCase();
    const className = [...current.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join("");
    part += className;

    const parent = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }

    parts.unshift(part);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

function cssString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function sendMapping(payload) {
  sendBridgeMessage({ type: "element-mapped", payload });
}

function connectBridge() {
  if (bridgeSocket && bridgeSocket.readyState <= WebSocket.OPEN) {
    return;
  }

  bridgeSocket = new WebSocket("ws://localhost:4173/ws");

  bridgeSocket.addEventListener("open", () => {
    sendBridgeMessage({
      type: "extension-ready",
      payload: {
        url: location.href,
        title: document.title
      }
    });
  });

  bridgeSocket.addEventListener("message", async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "automation-run") {
      await runAutomation(message.payload);
    }
  });

  bridgeSocket.addEventListener("close", () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectBridge, 1200);
  });
}

function sendBridgeMessage(message) {
  const text = JSON.stringify(message);
  if (bridgeSocket?.readyState === WebSocket.OPEN) {
    bridgeSocket.send(text);
    return;
  }

  const socket = new WebSocket("ws://localhost:4173/ws");
  socket.addEventListener("open", () => {
    socket.send(text);
    socket.close();
  });
}

async function runAutomation(payload = {}) {
  const rows = payload.rows || [];
  const steps = payload.steps || [];
  const mappings = payload.mappings || [];
  const runId = payload.runId || crypto.randomUUID();

  sendBridgeMessage({
    type: "automation-status",
    payload: { runId, level: "info", message: `확장프로그램 실행 시작: ${rows.length}행` }
  });

  for (const [rowIndex, row] of rows.entries()) {
    for (const step of steps) {
      const mapping = mappings.find((item) => item.id === step.targetId);
      if (!mapping) {
        sendStatus(runId, "error", `${rowIndex + 1}행: 매핑을 찾을 수 없습니다.`);
        continue;
      }

      try {
        await executeStep(step, mapping, row);
        sendStatus(runId, "success", `${rowIndex + 1}행: ${mapping.name} ${actionLabel(step)}`);
      } catch (error) {
        sendStatus(runId, "error", `${rowIndex + 1}행: ${mapping.name} 실패 - ${error.message}`);
      }
    }
  }

  sendBridgeMessage({
    type: "automation-status",
    payload: { runId, level: "success", message: "확장프로그램 실행 완료" }
  });
}

async function executeStep(step, mapping, row) {
  if (step.type === "wait") {
    await sleep(step.ms || 1000);
    return;
  }

  const element = await waitForElement(mapping.selector, 5000);
  if (!element) {
    throw new Error(`요소 없음: ${mapping.selector}`);
  }

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  highlightRunElement(element);
  await sleep(220);

  if (step.type === "input") {
    const value = step.valueSource === "column" ? row[step.column] : step.value;
    setElementValue(element, value ?? "");
    await sleep(260);
    return;
  }

  if (step.type === "click") {
    element.click();
    await sleep(320);
  }
}

function setElementValue(element, value) {
  element.focus();

  if (element.tagName.toLowerCase() === "select") {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function waitForElement(selector, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const find = () => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }

      setTimeout(find, 120);
    };

    find();
  });
}

function highlightRunElement(element) {
  const previousOutlineValue = element.style.outline;
  const previousBackgroundValue = element.style.backgroundColor;
  element.style.outline = "3px solid #1f7a66";
  element.style.backgroundColor = "#dff4ec";
  setTimeout(() => {
    element.style.outline = previousOutlineValue;
    element.style.backgroundColor = previousBackgroundValue;
  }, 520);
}

function sendStatus(runId, level, message) {
  sendBridgeMessage({ type: "automation-status", payload: { runId, level, message } });
}

function actionLabel(step) {
  if (step.type === "input") return "입력";
  if (step.type === "click") return "클릭";
  return "대기";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
