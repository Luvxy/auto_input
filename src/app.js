const storageKey = "web-automation-pc-mvp-state";

const sampleProject = {
  id: crypto.randomUUID(),
  name: "고객 등록 자동화",
  targetUrl: "https://example.com/admin/customers",
  mappings: [
    {
      id: crypto.randomUUID(),
      name: "고객명 입력창",
      type: "input",
      selector: "#customer-name",
      sample: "placeholder: 이름"
    },
    {
      id: crypto.randomUUID(),
      name: "전화번호 입력창",
      type: "input",
      selector: "input[name='phone']",
      sample: "label: 연락처"
    },
    {
      id: crypto.randomUUID(),
      name: "저장 버튼",
      type: "button",
      selector: "button.save",
      sample: "text: 저장"
    }
  ],
  steps: [],
  data: {
    columns: ["name", "phone"],
    rows: [
      { name: "김민준", phone: "010-1111-2222" },
      { name: "이서연", phone: "010-3333-4444" }
    ]
  },
  logs: []
};

let state = loadState();
let selectedProjectId = state.projects[0]?.id;
let selectedMappingId = state.projects[0]?.mappings[0]?.id;
let currentView = "builder";
let bridgeSocket;
let bridgeReconnectTimer;
let bridgeState = {
  connected: false,
  lastMessage: "Waiting for extension"
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    return { projects: [sampleProject] };
  }

  try {
    return JSON.parse(saved);
  } catch {
    return { projects: [sampleProject] };
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function getProject() {
  return state.projects.find((project) => project.id === selectedProjectId) || state.projects[0];
}

function setProject(mutator) {
  const project = getProject();
  mutator(project);
  saveState();
  render();
}

function syncProjectForm(project) {
  const nameInput = document.querySelector("#project-name");
  const targetInput = document.querySelector("#target-url");

  if (nameInput) {
    project.name = nameInput.value.trim() || "이름 없는 프로젝트";
  }

  if (targetInput) {
    project.targetUrl = normalizeTargetUrl(targetInput.value);
  }

  saveState();
}

function connectBridge() {
  if (bridgeSocket && bridgeSocket.readyState <= WebSocket.OPEN) {
    return;
  }

  bridgeSocket = new WebSocket(`ws://${location.host}/ws`);

  bridgeSocket.addEventListener("open", () => {
    bridgeState = { connected: true, lastMessage: "Extension bridge connected" };
    render();
  });

  bridgeSocket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "bridge-ready") {
      bridgeState = { connected: true, lastMessage: "Bridge ready" };
      render();
      return;
    }

    if (message.type === "element-mapped") {
      receiveMappedElement(message.payload);
    }

    if (message.type === "extension-ready") {
      bridgeState = {
        connected: true,
        lastMessage: `Extension ready: ${message.payload?.title || message.payload?.url || "active tab"}`
      };
      render();
    }

    if (message.type === "automation-status") {
      receiveAutomationStatus(message.payload);
    }
  });

  bridgeSocket.addEventListener("close", () => {
    bridgeState = { connected: false, lastMessage: "Bridge disconnected" };
    render();
    clearTimeout(bridgeReconnectTimer);
    bridgeReconnectTimer = setTimeout(connectBridge, 1200);
  });

  bridgeSocket.addEventListener("error", () => {
    bridgeState = { connected: false, lastMessage: "Bridge error" };
  });
}

function receiveMappedElement(payload = {}) {
  setProject((project) => {
    const mapping = {
      id: crypto.randomUUID(),
      name: payload.name || payload.text || `${typeLabel(payload.type || "input")} ${project.mappings.length + 1}`,
      type: payload.type || "input",
      selector: payload.selector || payload.cssSelector || "",
      sample: [payload.url, payload.text, payload.placeholder, payload.tagName].filter(Boolean).join(" | ")
    };

    project.mappings.push(mapping);
    selectedMappingId = mapping.id;
    bridgeState = { connected: true, lastMessage: `Received ${mapping.name}` };
    addLog(project, "success", `Extension mapping received: ${mapping.name}`);
  });
}

function receiveAutomationStatus(payload = {}) {
  const project = getProject();
  addLog(project, payload.level || "info", payload.message || "확장프로그램 상태를 수신했습니다.");
  refreshLogs(project);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function typeLabel(type) {
  return {
    input: "입력창",
    button: "버튼",
    select: "선택",
    checkbox: "체크박스"
  }[type] || type;
}

function stepLabel(step) {
  if (step.type === "input") {
    return `데이터 ${step.valueSource === "column" ? `[${step.column}]` : "고정값"} 입력`;
  }
  if (step.type === "click") {
    return "버튼 클릭";
  }
  return `${step.ms || 1000}ms 대기`;
}

function mappingName(project, id) {
  return project.mappings.find((mapping) => mapping.id === id)?.name || "대상 없음";
}

function createExampleProject() {
  const nameMappingId = crypto.randomUUID();
  const phoneMappingId = crypto.randomUUID();
  const saveMappingId = crypto.randomUUID();

  return {
    id: crypto.randomUUID(),
    name: "예시: 고객 등록 자동화",
    targetUrl: `${location.origin}/demo-customer.html`,
    mappings: [
      {
        id: nameMappingId,
        name: "고객명 입력창",
        type: "input",
        selector: "#customer-name",
        sample: "확장프로그램 예시 | placeholder: 이름"
      },
      {
        id: phoneMappingId,
        name: "전화번호 입력창",
        type: "input",
        selector: "input[name='phone']",
        sample: "확장프로그램 예시 | label: 연락처"
      },
      {
        id: saveMappingId,
        name: "저장 버튼",
        type: "button",
        selector: "button.save",
        sample: "확장프로그램 예시 | text: 저장"
      }
    ],
    steps: [
      { id: crypto.randomUUID(), type: "input", targetId: nameMappingId, valueSource: "column", column: "name" },
      { id: crypto.randomUUID(), type: "input", targetId: phoneMappingId, valueSource: "column", column: "phone" },
      { id: crypto.randomUUID(), type: "click", targetId: saveMappingId }
    ],
    data: {
      columns: ["name", "phone"],
      rows: [
        { name: "김민준", phone: "010-1111-2222" },
        { name: "이서연", phone: "010-3333-4444" },
        { name: "박지호", phone: "010-5555-6666" }
      ]
    },
    logs: []
  };
}

function isDemoProject(project) {
  return project.targetUrl.includes("/demo-customer.html");
}

function normalizeTargetUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return `${location.origin}${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function renderHelpPage() {
  return `
    <section class="help-page">
      <header class="help-hero">
        <div>
          <h2>도움말</h2>
          <p>웹 요소를 매핑하고, 데이터 행마다 입력과 클릭을 반복하는 기본 흐름을 익혀보세요.</p>
        </div>
        <button class="primary" data-action="create-example-project">예시 프로젝트 만들기</button>
      </header>

      <section class="help-grid">
        <article class="help-card">
          <h3>기본 사용법</h3>
          <ol>
            <li>새 프로젝트를 만들고 대상 사이트 URL을 적습니다.</li>
            <li>크롬 확장프로그램에서 매핑 모드를 켭니다.</li>
            <li>웹페이지의 입력창, 버튼, 선택 요소를 클릭해 PC 앱으로 보냅니다.</li>
            <li>CSV 데이터를 불러오고 컬럼을 확인합니다.</li>
            <li>값 입력, 버튼 클릭, 대기 단계를 순서대로 추가합니다.</li>
            <li>테스트 실행으로 첫 번째 행만 확인한 뒤 전체 실행합니다.</li>
          </ol>
        </article>

        <article class="help-card">
          <h3>예시로 만들어보기</h3>
          <ol>
            <li>고객명 입력창을 <strong>name</strong> 컬럼에 연결합니다.</li>
            <li>전화번호 입력창을 <strong>phone</strong> 컬럼에 연결합니다.</li>
            <li>저장 버튼 클릭 단계를 마지막에 둡니다.</li>
            <li>테스트 실행을 누르면 첫 번째 고객 1명만 시뮬레이션됩니다.</li>
            <li>전체 실행을 누르면 CSV 데이터의 모든 행이 반복 실행됩니다.</li>
          </ol>
          <button data-action="create-example-project">이 예시 자동으로 구성</button>
        </article>

        <article class="help-card">
          <h3>실행 횟수 기준</h3>
          <p>현재 MVP에서 전체 실행 횟수는 CSV 데이터 행 수입니다. 테스트 실행은 첫 번째 행 1개만 사용합니다.</p>
          <div class="help-example">
            <span>name,phone</span>
            <span>김민준,010-1111-2222</span>
            <span>이서연,010-3333-4444</span>
          </div>
        </article>

        <article class="help-card">
          <h3>매핑이 잘 안 될 때</h3>
          <p>입력창이나 버튼이 목록에 안 들어오면 PC 앱의 Bridge 상태가 ON인지 확인하고, 대상 페이지를 새로고침한 뒤 확장프로그램에서 매핑 모드를 다시 켜세요.</p>
        </article>
      </section>
    </section>
  `;
}

function render() {
  const project = getProject();
  selectedProjectId = project.id;
  selectedMappingId = selectedMappingId || project.mappings[0]?.id;

  document.querySelector("#app").innerHTML = `
    <div class="app-shell ${currentView === "help" ? "help-mode" : ""}">
      <aside class="sidebar">
        <div class="brand">
          <h1>자동화 PC</h1>
          <span class="status-pill ${bridgeState.connected ? "" : "offline"}" title="${escapeHtml(bridgeState.lastMessage)}"><span class="dot"></span>${bridgeState.connected ? "Bridge ON" : "Bridge OFF"}</span>
        </div>
        <button class="primary" data-action="new-project">새 프로젝트</button>
        <button class="nav-button ${currentView === "help" ? "active" : ""}" data-action="show-help">도움말</button>
        <div class="project-list">
          ${state.projects.map((item) => `
            <button class="project-item ${currentView === "builder" && item.id === project.id ? "active" : ""}" data-project-id="${item.id}">
              ${escapeHtml(item.name)}
              <small>${escapeHtml(item.targetUrl || "대상 URL 없음")}</small>
            </button>
          `).join("")}
        </div>
      </aside>

      <main class="main">
        ${currentView === "help" ? renderHelpPage() : ""}
        <header class="topbar">
          <div>
            <h2>${escapeHtml(project.name)}</h2>
            <p>${escapeHtml(project.targetUrl || "프로젝트 설정에서 대상 URL을 입력하세요.")}</p>
          </div>
          <div class="toolbar">
            <button data-action="save-project">저장</button>
            <button data-action="test-run">테스트 실행</button>
            <button class="primary" data-action="run-all">전체 실행</button>
          </div>
        </header>

        <section class="workspace">
          <section class="panel">
            <div class="panel-header">
              <div>
                <h3>프로젝트 설정</h3>
                <span>자동화 기본 정보</span>
              </div>
            </div>
            <div class="panel-body stack">
              <div class="field">
                <label for="project-name">프로젝트 이름</label>
                <input id="project-name" value="${escapeHtml(project.name)}" />
              </div>
              <div class="field">
                <label for="target-url">대상 사이트 URL</label>
                <input id="target-url" value="${escapeHtml(project.targetUrl)}" />
              </div>
              <div class="row-actions">
                <button data-action="add-sample-mapping">샘플 매핑 추가</button>
                <button class="danger" data-action="delete-project">삭제</button>
              </div>
            </div>

            <div class="panel-header">
              <div>
                <h3>웹 요소 매핑</h3>
                <span>확장프로그램 연결 전까지 수동 등록</span>
              </div>
            </div>
            <div class="panel-body stack">
              <div class="bridge-hint">크롬 확장프로그램에서 매핑 모드를 켠 뒤 웹페이지의 입력창이나 버튼을 클릭하면 여기에 자동으로 추가됩니다.</div>
              <div class="inline-fields">
                <div class="field">
                  <label for="mapping-type">타입</label>
                  <select id="mapping-type">
                    <option value="input">입력창</option>
                    <option value="button">버튼</option>
                    <option value="select">선택</option>
                    <option value="checkbox">체크박스</option>
                  </select>
                </div>
                <div class="field">
                  <label for="mapping-name">이름</label>
                  <input id="mapping-name" placeholder="예: 저장 버튼" />
                </div>
              </div>
              <div class="field">
                <label for="mapping-selector">CSS selector</label>
                <input id="mapping-selector" placeholder="예: button.save" />
              </div>
              <button data-action="add-mapping">매핑 등록</button>
              <div class="mapping-list">
                ${project.mappings.length ? project.mappings.map((mapping) => `
                  <article class="mapping-item ${mapping.id === selectedMappingId ? "active" : ""}" data-mapping-id="${mapping.id}">
                    <div class="item-title">
                      <span>${escapeHtml(mapping.name)}</span>
                      <small>${typeLabel(mapping.type)}</small>
                    </div>
                    <div class="meta">${escapeHtml(mapping.selector)}<br />${escapeHtml(mapping.sample || "")}</div>
                  </article>
                `).join("") : `<div class="empty-state">아직 매핑된 웹 요소가 없습니다.</div>`}
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <div>
                <h3>자동화 단계</h3>
                <span>위에서 아래 순서로 실행</span>
              </div>
            </div>
            <div class="panel-body stack">
              <div class="inline-fields">
                <div class="field">
                  <label for="step-type">단계 타입</label>
                  <select id="step-type">
                    <option value="input">값 입력</option>
                    <option value="click">버튼 클릭</option>
                    <option value="wait">대기</option>
                  </select>
                </div>
                <div class="field">
                  <label for="step-column">데이터 컬럼 또는 값</label>
                  <input id="step-column" placeholder="예: name 또는 1000" />
                </div>
              </div>
              <div class="field">
                <label for="step-target">대상 매핑</label>
                <select id="step-target">
                  ${project.mappings.map((mapping) => `
                    <option value="${mapping.id}" ${mapping.id === selectedMappingId ? "selected" : ""}>${escapeHtml(mapping.name)}</option>
                  `).join("")}
                </select>
              </div>
              <div class="row-actions">
                <button data-action="add-step">단계 추가</button>
                <button data-action="clear-steps">단계 비우기</button>
              </div>
              <div class="step-list">
                ${project.steps.length ? project.steps.map((step, index) => `
                  <article class="step-item">
                    <div class="step-number">${index + 1}</div>
                    <div>
                      <div class="item-title">
                        <span>${escapeHtml(stepLabel(step))}</span>
                        <span class="badge ${step.type}">${escapeHtml(step.type)}</span>
                      </div>
                      <div class="meta">대상: ${escapeHtml(mappingName(project, step.targetId))}</div>
                    </div>
                    <button class="ghost danger" data-action="remove-step" data-step-id="${step.id}">삭제</button>
                  </article>
                `).join("") : `<div class="empty-state">아직 자동화 단계가 없습니다.</div>`}
              </div>
            </div>
          </section>

          <section class="panel run-panel">
            ${renderDemoPanel(project)}
            <div class="panel-header">
              <div>
                <h3>데이터</h3>
                <span>CSV 첫 줄을 컬럼으로 사용</span>
              </div>
            </div>
            <div class="panel-body stack">
              <input id="csv-file" type="file" accept=".csv,text/csv" />
              ${renderDataTable(project)}
            </div>
            <div class="panel-header">
              <div>
                <h3>실행 로그</h3>
                <span data-log-count>${project.logs.length}개 이벤트</span>
              </div>
              <button data-action="clear-logs">비우기</button>
            </div>
            <div class="panel-body">
              <div class="log-list">
                ${project.logs.length ? project.logs.map((log) => `
                  <div class="log-item">
                    <span class="log-time">${escapeHtml(log.time)}</span>
                    <span class="log-${log.level}">${escapeHtml(log.message)}</span>
                  </div>
                `).join("") : `<div class="empty-state">실행하면 로그가 여기에 표시됩니다.</div>`}
              </div>
            </div>
          </section>
        </section>
      </main>
    </div>
  `;
}

function renderDataTable(project) {
  const { columns, rows } = project.data || { columns: [], rows: [] };
  if (!columns.length) {
    return `<div class="empty-state">CSV 파일을 불러오면 데이터 미리보기가 표시됩니다.</div>`;
  }

  return `
    <div class="data-table-wrap">
      <table>
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.slice(0, 20).map((row) => `
            <tr>${columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDemoPanel(project) {
  if (!project.targetUrl) {
    return "";
  }

  const canPreview = isDemoProject(project);

  return `
    <div class="panel-header">
      <div>
        <h3>${canPreview ? "예시 고객 등록 사이트" : "대상 사이트"}</h3>
        <span>${canPreview ? "테스트 실행 시 실제로 입력됩니다" : "URL 저장 후 적용된 대상입니다"}</span>
      </div>
      ${canPreview ? `<button data-action="reset-demo-site">초기화</button>` : ""}
    </div>
    ${canPreview ? `
      <div class="panel-body demo-frame-body">
        <iframe id="demo-frame" title="예시 고객 등록 사이트" src="${escapeHtml(project.targetUrl)}"></iframe>
      </div>
    ` : `
      <div class="panel-body">
        <div class="target-preview">
          <strong>${escapeHtml(project.targetUrl)}</strong>
          <span>현재 MVP에서는 로컬 예시 사이트만 앱 안에서 직접 실행됩니다. 일반 사이트 자동화는 확장프로그램 연결 단계에서 실행 대상으로 사용됩니다.</span>
        </div>
      </div>
    `}
  `;
}

function addLog(project, level, message) {
  project.logs.unshift({ time: formatTime(), level, message });
  project.logs = project.logs.slice(0, 200);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  const columns = rows.shift() || [];
  return {
    columns,
    rows: rows.map((cells) =>
      Object.fromEntries(columns.map((column, index) => [column, cells[index] || ""]))
    )
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function refreshLogs(project) {
  saveState();
  const logList = document.querySelector(".log-list");
  const logCount = document.querySelector("[data-log-count]");
  if (!logList) return;

  if (logCount) {
    logCount.textContent = `${project.logs.length}개 이벤트`;
  }

  logList.innerHTML = project.logs.length
    ? project.logs.map((log) => `
      <div class="log-item">
        <span class="log-time">${escapeHtml(log.time)}</span>
        <span class="log-${log.level}">${escapeHtml(log.message)}</span>
      </div>
    `).join("")
    : `<div class="empty-state">실행하면 로그가 여기에 표시됩니다.</div>`;
}

function sendBridgeMessage(message) {
  if (bridgeSocket?.readyState !== WebSocket.OPEN) {
    addLog(getProject(), "error", "확장프로그램 브릿지가 연결되어 있지 않습니다.");
    refreshLogs(getProject());
    return false;
  }

  bridgeSocket.send(JSON.stringify(message));
  return true;
}

function buildRunPayload(project, targetRows) {
  return {
    runId: crypto.randomUUID(),
    projectId: project.id,
    targetUrl: project.targetUrl,
    rows: targetRows,
    mappings: project.mappings.map((mapping) => ({
      id: mapping.id,
      name: mapping.name,
      type: mapping.type,
      selector: mapping.selector
    })),
    steps: project.steps.map((step) => ({
      id: step.id,
      type: step.type,
      targetId: step.targetId,
      valueSource: step.valueSource,
      column: step.column,
      value: step.value,
      ms: step.ms
    }))
  };
}

function getDemoDocument() {
  const frame = document.querySelector("#demo-frame");
  return frame?.contentDocument || null;
}

function highlightElement(element) {
  element.classList.remove("flash");
  void element.offsetWidth;
  element.classList.add("flash");
}

async function runDemoStep(project, step, row) {
  const demoDocument = getDemoDocument();
  if (!demoDocument) return;

  const mapping = project.mappings.find((item) => item.id === step.targetId);
  if (!mapping?.selector) return;

  const element = demoDocument.querySelector(mapping.selector);
  if (!element) return;

  if (step.type === "input") {
    const value = step.valueSource === "column" ? row[step.column] : step.value;
    element.focus();
    element.value = value ?? "";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    highlightElement(element);
    await sleep(420);
  }

  if (step.type === "click") {
    highlightElement(element);
    await sleep(260);
    element.click();
    await sleep(420);
  }

  if (step.type === "wait") {
    await sleep(step.ms || 1000);
  }
}

async function runAutomation(limitToFirstRow = false) {
  const project = getProject();
  syncProjectForm(project);
  const rows = project.data?.rows || [];
  const targetRows = limitToFirstRow ? rows.slice(0, 1) : rows;

  if (!project.steps.length) {
    addLog(project, "error", "실행할 자동화 단계가 없습니다.");
    refreshLogs(project);
    return;
  }

  if (!targetRows.length) {
    addLog(project, "error", "실행할 데이터가 없습니다.");
    refreshLogs(project);
    return;
  }

  if (isDemoProject(project)) {
    getDemoDocument()?.defaultView?.demoCustomer?.reset();
  }

  addLog(project, "info", `${limitToFirstRow ? "테스트" : "전체"} 실행 시작: ${targetRows.length}행`);
  refreshLogs(project);

  if (!isDemoProject(project)) {
    const sent = sendBridgeMessage({
      type: "automation-run",
      payload: buildRunPayload(project, targetRows)
    });

    if (sent) {
      addLog(project, "info", "확장프로그램으로 실제 웹페이지 실행 명령을 보냈습니다.");
      refreshLogs(project);
    }

    return;
  }

  for (const [rowIndex, row] of targetRows.entries()) {
    for (const step of project.steps) {
      const target = mappingName(project, step.targetId);

      if (isDemoProject(project)) {
        await runDemoStep(project, step, row);
      }

      if (step.type === "input") {
        const value = step.valueSource === "column" ? row[step.column] : step.value;
        addLog(project, "success", `${rowIndex + 1}행: ${target}에 "${value ?? ""}" 입력`);
      } else if (step.type === "click") {
        addLog(project, "success", `${rowIndex + 1}행: ${target} 클릭`);
      } else {
        addLog(project, "info", `${rowIndex + 1}행: ${step.ms}ms 대기`);
      }

      refreshLogs(project);
      await sleep(120);
    }
  }

  addLog(project, "success", "실행 완료");
  refreshLogs(project);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const mappingItem = event.target.closest(".mapping-item");

  if (mappingItem) {
    selectedMappingId = mappingItem.dataset.mappingId;
    render();
    return;
  }

  if (!button) return;

  const action = button.dataset.action;
  const project = getProject();

  if (button.dataset.projectId) {
    selectedProjectId = button.dataset.projectId;
    selectedMappingId = getProject().mappings[0]?.id;
    currentView = "builder";
    render();
    return;
  }

  if (action === "show-help") {
    currentView = "help";
    render();
    return;
  }

  if (action === "new-project") {
    const next = {
      id: crypto.randomUUID(),
      name: "새 자동화 프로젝트",
      targetUrl: "",
      mappings: [],
      steps: [],
      data: { columns: [], rows: [] },
      logs: []
    };
    state.projects.push(next);
    selectedProjectId = next.id;
    selectedMappingId = undefined;
    currentView = "builder";
    saveState();
    render();
  }

  if (action === "create-example-project") {
    const example = createExampleProject();
    state.projects.push(example);
    selectedProjectId = example.id;
    selectedMappingId = example.mappings[0]?.id;
    currentView = "builder";
    addLog(example, "success", "예시 자동화를 만들었습니다. 테스트 실행으로 흐름을 확인해보세요.");
    saveState();
    render();
  }

  if (action === "save-project") {
    syncProjectForm(project);
    addLog(project, "success", "프로젝트를 저장했습니다.");
    saveState();
    render();
  }

  if (action === "delete-project") {
    if (state.projects.length === 1) {
      addLog(project, "error", "마지막 프로젝트는 삭제할 수 없습니다.");
      saveState();
      render();
      return;
    }

    state.projects = state.projects.filter((item) => item.id !== project.id);
    selectedProjectId = state.projects[0].id;
    selectedMappingId = state.projects[0].mappings[0]?.id;
    saveState();
    render();
  }

  if (action === "add-mapping") {
    const type = document.querySelector("#mapping-type").value;
    const name = document.querySelector("#mapping-name").value.trim();
    const selector = document.querySelector("#mapping-selector").value.trim();

    if (!name || !selector) {
      addLog(project, "error", "매핑 이름과 selector를 입력하세요.");
      saveState();
      render();
      return;
    }

    const mapping = { id: crypto.randomUUID(), name, type, selector, sample: "수동 등록" };
    project.mappings.push(mapping);
    selectedMappingId = mapping.id;
    addLog(project, "success", `${name} 매핑을 등록했습니다.`);
    saveState();
    render();
  }

  if (action === "add-sample-mapping") {
    const mapping = {
      id: crypto.randomUUID(),
      name: `새 입력창 ${project.mappings.length + 1}`,
      type: "input",
      selector: `input[data-auto='field-${project.mappings.length + 1}']`,
      sample: "확장프로그램 연동 전 샘플"
    };
    project.mappings.push(mapping);
    selectedMappingId = mapping.id;
    addLog(project, "success", "샘플 매핑을 추가했습니다.");
    saveState();
    render();
  }

  if (action === "add-step") {
    const type = document.querySelector("#step-type").value;
    const targetId = document.querySelector("#step-target").value;
    const columnOrValue = document.querySelector("#step-column").value.trim();
    const step = { id: crypto.randomUUID(), type, targetId };

    if (type === "input") {
      step.valueSource = "column";
      step.column = columnOrValue || project.data.columns[0] || "";
    }

    if (type === "wait") {
      step.ms = Number(columnOrValue || 1000);
    }

    project.steps.push(step);
    addLog(project, "success", "자동화 단계를 추가했습니다.");
    saveState();
    render();
  }

  if (action === "remove-step") {
    project.steps = project.steps.filter((step) => step.id !== button.dataset.stepId);
    addLog(project, "info", "자동화 단계를 삭제했습니다.");
    saveState();
    render();
  }

  if (action === "clear-steps") {
    project.steps = [];
    addLog(project, "info", "자동화 단계를 모두 비웠습니다.");
    saveState();
    render();
  }

  if (action === "clear-logs") {
    project.logs = [];
    saveState();
    render();
  }

  if (action === "reset-demo-site") {
    getDemoDocument()?.defaultView?.demoCustomer?.reset();
    addLog(project, "info", "예시 고객 등록 사이트를 초기화했습니다.");
    saveState();
    render();
  }

  if (action === "test-run") {
    runAutomation(true);
  }

  if (action === "run-all") {
    runAutomation(false);
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "target-url") {
    const project = getProject();
    syncProjectForm(project);
    addLog(project, "info", "대상 URL을 적용했습니다.");
    saveState();
    render();
    return;
  }

  if (event.target.id === "project-name") {
    const project = getProject();
    syncProjectForm(project);
    saveState();
    render();
    return;
  }

  if (event.target.id !== "csv-file") return;
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();
  setProject((project) => {
    project.data = parseCsv(text);
    addLog(project, "success", `${file.name} 파일을 불러왔습니다.`);
  });
});

render();
connectBridge();
