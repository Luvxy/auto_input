const storageKey = "web-automation-pc-mvp-state";
const desktopSessionStorageKey = "web-automation-pc-mvp-desktop-session";
const desktopLoginBaseUrl = "https://auto-web-8f2de.web.app";
const desktopLoginTimeoutMs = 120000;
const desktopLoginPollMs = 2000;
const trialDurationMs = 7 * 24 * 60 * 60 * 1000;

const plans = {
  free: {
    id: "free",
    name: "Free",
    price: "0원",
    projectLimit: 2,
    description: "처음 자동화를 체험하는 사용자"
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: "월 4,900원",
    projectLimit: Infinity,
    description: "프로젝트 무제한 개인 플랜"
  },
  business: {
    id: "business",
    name: "Business",
    price: "월 29,000원",
    projectLimit: Infinity,
    description: "백업, 예약 실행, 우선 지원을 위한 업무용 플랜"
  }
};

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
  executionMode: "automation",
  shortcut: "",
  shortcutAutoAdvance: true,
  shortcutFlows: [],
  nextRowIndex: 0,
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
let selectedShortcutFlowId = state.projects[0]?.shortcutFlows?.[0]?.id;
let currentView = "builder";
let bridgeSocket;
let bridgeReconnectTimer;
let globalShortcutListening = false;
let globalShortcutSignature = "";
let bridgeState = {
  connected: false,
  lastMessage: "Waiting for extension"
};
let firebaseState = {
  configured: false,
  connected: false,
  loading: true,
  uid: "",
  email: "",
  displayName: "",
  photoURL: "",
  appSessionToken: "",
  message: "Firebase 확인 중"
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    return { plan: "free", trial: {}, projects: [sampleProject] };
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      plan: parsed.plan || "free",
      trial: parsed.trial || {},
      projects: parsed.projects?.length ? parsed.projects.map(normalizeProject) : [normalizeProject(sampleProject)]
    };
  } catch {
    return { plan: "free", trial: {}, projects: [normalizeProject(sampleProject)] };
  }
}

function normalizeProject(project) {
  const executionMode = project.executionMode === "shortcut" ? "shortcut" : "automation";
  return {
    ...project,
    executionMode,
    steps: Array.isArray(project.steps) ? project.steps : [],
    shortcut: project.shortcut || "",
    shortcutAutoAdvance: project.shortcutAutoAdvance !== false,
    shortcutFlows: normalizeShortcutFlows(project),
    nextRowIndex: Number.isInteger(project.nextRowIndex) ? project.nextRowIndex : 0
  };
}

function normalizeShortcutFlows(project) {
  const existing = Array.isArray(project.shortcutFlows) ? project.shortcutFlows : [];
  const migrated = existing.length
    ? existing
    : project.shortcut || project.executionMode === "shortcut"
      ? [{
          id: crypto.randomUUID(),
          name: "단축키 1",
          shortcut: project.shortcut || "",
          steps: Array.isArray(project.steps) ? [...project.steps] : [],
          autoAdvance: project.shortcutAutoAdvance !== false,
          nextRowIndex: Number.isInteger(project.nextRowIndex) ? project.nextRowIndex : 0
        }]
      : [];

  return Array.from({ length: 3 }, (_, index) => {
    const flow = migrated[index] || {};
    return {
      id: flow.id || crypto.randomUUID(),
      name: flow.name || `단축키 ${index + 1}`,
      shortcut: flow.shortcut || "",
      steps: Array.isArray(flow.steps) ? flow.steps : [],
      autoAdvance: flow.autoAdvance !== false,
      nextRowIndex: Number.isInteger(flow.nextRowIndex) ? flow.nextRowIndex : 0
    };
  });
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  if (globalShortcutListening) {
    window.setTimeout(registerGlobalShortcuts, 0);
  }
}

function isFirebaseConfigured() {
  const config = window.firebaseConfig || window.firebaseConfig || {};
  return Boolean(
    window.firebase &&
      config.apiKey &&
      config.projectId &&
      !String(config.apiKey).startsWith("YOUR_") &&
      !String(config.projectId).startsWith("YOUR_")
  );
}

async function initFirebase() {
  if (!window.firebase && window.firebaseConfig) {
    firebaseState = {
      configured: true,
      connected: false,
      loading: false,
      uid: "",
      email: "",
      displayName: "",
      photoURL: "",
      message: "Firebase SDK 로드 실패"
    };
    render();
    return;
  }

  if (!isFirebaseConfigured()) {
    firebaseState = {
      configured: false,
      connected: false,
      loading: false,
      uid: "",
      email: "",
      displayName: "",
      photoURL: "",
      message: "Firebase 설정 필요"
    };
    render();
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(window.firebaseConfig);
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        const restored = await restoreDesktopSession();
        if (restored) {
          render();
          return;
        }

        firebaseState = {
          configured: true,
          connected: false,
          loading: false,
          uid: "",
          email: "",
          displayName: "",
          photoURL: "",
          appSessionToken: "",
          message: "Google 로그인이 필요합니다"
        };
        state.plan = "free";
        saveState();
        render();
        return;
      }

      firebaseState = {
        configured: true,
        connected: true,
        loading: false,
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        photoURL: user.photoURL || "",
        appSessionToken: "",
        message: "Google 로그인됨"
      };

      await syncLicenseFromFirebase(user.uid);
      render();
    });

    await firebase.auth().getRedirectResult();
  } catch (error) {
    firebaseState = {
      configured: true,
      connected: false,
      loading: false,
      uid: "",
      email: "",
      displayName: "",
      photoURL: "",
      message: `Firebase 오류: ${error.message}`
    };
    render();
  }
}

async function signInWithGoogle() {
  if (!isFirebaseConfigured()) {
    firebaseState = {
      ...firebaseState,
      configured: false,
      connected: false,
      loading: false,
      message: "Firebase 설정 필요"
    };
    render();
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(window.firebaseConfig);
    }

    firebaseState = {
      ...firebaseState,
      configured: true,
      loading: true,
      message: "Google 로그인 중"
    };
    render();

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await firebase.auth().signInWithPopup(provider);
    } catch (popupError) {
      if (
        popupError.code === "auth/internal-error" ||
        popupError.code === "auth/popup-blocked" ||
        popupError.code === "auth/popup-closed-by-user" ||
        popupError.code === "auth/cancelled-popup-request" ||
        popupError.code === "auth/operation-not-supported-in-this-environment" ||
        popupError.code === "auth/unauthorized-domain"
      ) {
        await signInWithDesktopBridge();
        return;
      }

      if (
        popupError.code === "auth/popup-blocked" ||
        popupError.code === "auth/popup-closed-by-user" ||
        popupError.code === "auth/cancelled-popup-request"
      ) {
        firebaseState = {
          ...firebaseState,
          configured: true,
          loading: true,
          message: "Google 로그인 페이지로 이동 중"
        };
        render();
        await firebase.auth().signInWithRedirect(provider);
        return;
      }

      throw popupError;
    }
  } catch (error) {
    firebaseState = {
      ...firebaseState,
      configured: true,
      connected: false,
      loading: false,
      message: `Google 로그인 실패: ${error.message}`
    };
    render();
  }
}

function createDesktopLoginSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function openExternalUrl(url, context = "external page") {
  const invoke = getTauriInvoke();

  if (invoke) {
    try {
      await invoke("open_external_url", { url });
      return true;
    } catch (error) {
      console.warn(`Falling back to window.open for ${context}`, error);
    }
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    location.href = url;
  }
  return true;
}

async function openDesktopLoginPage(sessionId) {
  const url = `${desktopLoginBaseUrl}/desktop-login.html?session=${encodeURIComponent(sessionId)}`;
  await openExternalUrl(url, "desktop login");
}

async function signInWithDesktopBridge() {
  const sessionId = createDesktopLoginSessionId();
  const startedAt = Date.now();

  firebaseState = {
    ...firebaseState,
    configured: true,
    loading: true,
    message: "Opening browser login..."
  };
  render();
  await openDesktopLoginPage(sessionId);

  while (Date.now() - startedAt < desktopLoginTimeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, desktopLoginPollMs));
    const response = await fetch(`${desktopLoginBaseUrl}/desktop-login-status?session=${encodeURIComponent(sessionId)}`);
    const result = await parseLoginStatusResponse(response);

    if (result.status === "completed") {
      applyDesktopLoginResult(result);
      return;
    }

    if (result.status === "expired" || result.status === "error") {
      throw new Error(result.error || "Desktop login session expired.");
    }
  }

  throw new Error("Desktop login timed out.");
}

async function parseLoginStatusResponse(response) {
  const text = await response.text();
  try {
    const result = JSON.parse(text);
    if (!response.ok) {
      throw new Error(result.error || `Login server error (${response.status})`);
    }
    return result;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Login server error (${response.status}): ${text.slice(0, 120)}`);
    }
    throw error;
  }
}

function applyDesktopLoginResult(result) {
  const user = result.user || {};
  firebaseState = {
    configured: true,
    connected: true,
    loading: false,
    uid: user.uid || "",
    email: user.email || "",
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    appSessionToken: result.appSessionToken || firebaseState.appSessionToken || "",
    message: "Google login connected"
  };

  if (firebaseState.appSessionToken) {
    localStorage.setItem(desktopSessionStorageKey, firebaseState.appSessionToken);
  }
  applyLicense(result.license);
  saveState();
  render();
}

function applyLicense(license) {
  applyTrialFromLicense(license);
  if (!license || license.status !== "active" || !plans[license.plan] || isLicenseExpired(license)) {
    state.plan = "free";
    return;
  }
  state.plan = license.plan;
}

function applyTrialFromLicense(license) {
  if (!license?.trialEndsAt) return;
  state.trial = {
    startedAt: normalizeDateValue(license.trialStartedAt)?.toISOString?.() || state.trial?.startedAt || "",
    endsAt: normalizeDateValue(license.trialEndsAt)?.toISOString?.() || ""
  };
}

async function restoreDesktopSession() {
  const token = localStorage.getItem(desktopSessionStorageKey);
  if (!token) return false;

  try {
    const response = await fetch(`${desktopLoginBaseUrl}/desktop-license?token=${encodeURIComponent(token)}`);
    const result = await parseLoginStatusResponse(response);
    if (result.status !== "active") return false;
    applyDesktopLoginResult({ ...result, appSessionToken: token });
    return true;
  } catch {
    localStorage.removeItem(desktopSessionStorageKey);
    return false;
  }
}

async function signOutGoogle() {
  localStorage.removeItem(desktopSessionStorageKey);
  if (!window.firebase || !firebase.apps.length) return;
  await firebase.auth().signOut();
}

async function syncLicenseFromFirebase(uid = firebaseState.uid) {
  if (!firebaseState.connected || !uid) return;

  if (firebaseState.appSessionToken && (!window.firebase || !firebase.auth().currentUser)) {
    const response = await fetch(`${desktopLoginBaseUrl}/desktop-license?token=${encodeURIComponent(firebaseState.appSessionToken)}`);
    const result = await parseLoginStatusResponse(response);
    applyLicense(result.license);
    saveState();
    render();
    return;
  }

  const snapshot = await firebase.firestore().collection("licenses").doc(uid).get();
  if (!snapshot.exists) {
    await firebase.firestore().collection("licenses").doc(uid).set({
      plan: state.plan || "free",
      status: "active",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return;
  }

  const license = snapshot.data();
  applyTrialFromLicense(license);
  if (license.status === "active" && plans[license.plan] && !isLicenseExpired(license)) {
    state.plan = license.plan;
    saveState();
    return;
  }

  if (license.plan !== "free") {
    state.plan = "free";
    saveState();
  }
}

function isLicenseExpired(license) {
  if (!license.expiresAt) return false;
  const expiresAt = normalizeDateValue(license.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now();
}

function normalizeDateValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function saveLicenseToFirebase(planId) {
  if (!firebaseState.connected || !firebaseState.uid) return;
  if (firebaseState.appSessionToken && (!window.firebase || !firebase.auth().currentUser)) {
    state.plan = planId;
    saveState();
    return;
  }

  await firebase.firestore().collection("licenses").doc(firebaseState.uid).set(
    {
      plan: planId,
      status: "active",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

async function startFreeTrial() {
  if (!firebaseState.connected || !firebaseState.uid) {
    addLog(getProject(), "error", "무료체험은 Google 로그인 후 시작할 수 있습니다.");
    refreshLogs(getProject());
    return;
  }

  if (isTrialActive()) {
    addLog(getProject(), "info", `이미 무료체험이 진행 중입니다. ${trialDaysLeft()}일 남았습니다.`);
    refreshLogs(getProject());
    return;
  }

  if (hasTrialStarted()) {
    addLog(getProject(), "error", "무료체험은 계정당 1회만 사용할 수 있습니다.");
    refreshLogs(getProject());
    return;
  }

  if (firebaseState.appSessionToken && (!window.firebase || !firebase.auth().currentUser)) {
    const response = await fetch(`${desktopLoginBaseUrl}/start-trial`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: firebaseState.appSessionToken })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      addLog(getProject(), "error", `무료체험 시작 실패: ${result.error || response.status}`);
      refreshLogs(getProject());
      return;
    }
    applyLicense(result.license);
    saveState();
    addLog(getProject(), "success", "7일 무료체험을 시작했습니다. 프로젝트 제한이 해제됩니다.");
    render();
    return;
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + trialDurationMs);
  await firebase.firestore().collection("licenses").doc(firebaseState.uid).set(
    {
      plan: state.plan || "free",
      status: "active",
      trialStartedAt: firebase.firestore.Timestamp.fromDate(now),
      trialEndsAt: firebase.firestore.Timestamp.fromDate(endsAt),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  state.trial = {
    startedAt: now.toISOString(),
    endsAt: endsAt.toISOString()
  };
  saveState();
  addLog(getProject(), "success", "7일 무료체험을 시작했습니다. 프로젝트 제한이 해제됩니다.");
  render();
}

function getProject() {
  return state.projects.find((project) => project.id === selectedProjectId) || state.projects[0];
}

function getCurrentPlan() {
  if (isTrialEffective()) {
    return {
      ...plans.pro,
      id: "trial",
      name: "Free Trial",
      price: "7일 무료",
      description: "7일 동안 프로젝트 무제한"
    };
  }
  return plans[state.plan] || plans.free;
}

function isTrialActive() {
  const endsAt = normalizeDateValue(state.trial?.endsAt);
  return Boolean(endsAt && endsAt.getTime() > Date.now());
}

function isTrialEffective() {
  return isTrialActive() && (!state.plan || state.plan === "free");
}

function hasTrialStarted() {
  return Boolean(state.trial?.startedAt || state.trial?.endsAt);
}

function trialDaysLeft() {
  const endsAt = normalizeDateValue(state.trial?.endsAt);
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function trialStatusText() {
  if (isTrialActive()) return `무료체험 ${trialDaysLeft()}일 남음`;
  if (hasTrialStarted()) return "무료체험 종료";
  return "무료체험 미사용";
}

function canCreateProject() {
  const plan = getCurrentPlan();
  return state.projects.length < plan.projectLimit;
}

function projectLimitText() {
  const plan = getCurrentPlan();
  return Number.isFinite(plan.projectLimit) ? `${state.projects.length}/${plan.projectLimit}` : `${state.projects.length}/무제한`;
}

function shortUid() {
  if (!firebaseState.uid) return "";
  return `${firebaseState.uid.slice(0, 6)}...${firebaseState.uid.slice(-4)}`;
}

function accountLabel() {
  return firebaseState.email || firebaseState.displayName || shortUid() || firebaseState.message;
}

function isPaymentConfigured() {
  const config = window.paymentConfig || {};
  return Boolean(config.checkoutBaseUrl && !String(config.checkoutBaseUrl).includes("YOUR_PAYMENT_SERVER_DOMAIN"));
}

function buildCheckoutUrl(planId) {
  const config = window.paymentConfig || {};
  const url = new URL(config.checkoutBaseUrl);
  url.searchParams.set("provider", config.provider || "nicepay");
  url.searchParams.set("plan", planId);
  url.searchParams.set("uid", firebaseState.uid);
  url.searchParams.set("email", firebaseState.email);
  url.searchParams.set("successUrl", config.successUrl || "");
  url.searchParams.set("failUrl", config.failUrl || "");
  return url.toString();
}

async function startPaidPlanCheckout(planId) {
  if (!isPaymentConfigured()) {
    const project = getProject();
    addLog(project, "error", "나이스페이 결제 서버 URL 설정이 필요합니다. src/payment-config.js를 확인하세요.");
    refreshLogs(project);
    return false;
  }

  await openExternalUrl(buildCheckoutUrl(planId), "checkout");
  return true;
}

function setProject(mutator) {
  const project = getProject();
  mutator(project);
  saveState();
  render();
}

function isShortcutMode(project) {
  return project.executionMode === "shortcut";
}

function getShortcutFlows(project) {
  project.shortcutFlows = normalizeShortcutFlows(project);
  return project.shortcutFlows;
}

function getSelectedShortcutFlow(project) {
  const flows = getShortcutFlows(project);
  let flow = flows.find((item) => item.id === selectedShortcutFlowId);
  if (!flow) {
    flow = flows[0];
    selectedShortcutFlowId = flow?.id;
  }
  return flow;
}

function getEditableSteps(project) {
  return isShortcutMode(project) ? getSelectedShortcutFlow(project).steps : project.steps;
}

function getTauriInvoke() {
  return window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
}

function getTauriListen() {
  return window.__TAURI__?.event?.listen;
}

function getRegisteredShortcutFlows() {
  return state.projects
    .filter((project) => isShortcutMode(project))
    .flatMap((project) => getShortcutFlows(project).map((flow) => ({ project, flow })))
    .filter(({ flow }) => flow.shortcut);
}

async function registerGlobalShortcuts() {
  const invoke = getTauriInvoke();
  if (!invoke) return;

  const shortcuts = [...new Set(getRegisteredShortcutFlows().map(({ flow }) => flow.shortcut))];
  const signature = shortcuts.join("|");
  try {
    await invoke("update_global_shortcuts", { shortcuts });
    const project = getProject();
    if (shortcuts.length && signature !== globalShortcutSignature) {
      addLog(project, "info", `전역 단축키 ${shortcuts.length}개를 등록했습니다.`);
      refreshLogs(project);
    }
    globalShortcutSignature = signature;
  } catch (error) {
    const project = getProject();
    addLog(project, "error", `전역 단축키 등록 실패: ${error?.message || error}`);
    refreshLogs(project);
  }
}

async function initGlobalShortcutBridge() {
  if (globalShortcutListening) return;
  const listen = getTauriListen();
  if (!listen) {
    addLog(getProject(), "info", "전역 단축키는 설치된 PC 앱에서만 작동합니다.");
    refreshLogs(getProject());
    return;
  }

  globalShortcutListening = true;
  try {
    await listen("global-shortcut", async (event) => {
      await handleShortcutTrigger(event.payload);
    });
    await registerGlobalShortcuts();
  } catch (error) {
    globalShortcutListening = false;
    addLog(getProject(), "error", `전역 단축키 연결 실패: ${error?.message || error}`);
    refreshLogs(getProject());
  }
}

async function handleShortcutTrigger(shortcut) {
  const match = getRegisteredShortcutFlows().find(({ flow }) => flow.shortcut === shortcut);
  if (!match) return;
  selectedProjectId = match.project.id;
  currentView = "builder";
  await runShortcutFlow(match.flow.id);
}

function syncProjectForm(project) {
  const nameInput = document.querySelector("#project-name");
  const targetInput = document.querySelector("#target-url");
  const executionModeInput = document.querySelector("#execution-mode");
  const shortcutInput = document.querySelector("#shortcut-key");
  const shortcutAutoAdvanceInput = document.querySelector("#shortcut-auto-advance");
  const shortcutNameInput = document.querySelector("#shortcut-flow-name");
  const shortcutFlow = isShortcutMode(project) ? getSelectedShortcutFlow(project) : null;

  if (nameInput) {
    project.name = nameInput.value.trim() || "이름 없는 프로젝트";
  }

  if (targetInput) {
    project.targetUrl = normalizeTargetUrl(targetInput.value);
  }

  if (executionModeInput) {
    project.executionMode = executionModeInput.value === "shortcut" ? "shortcut" : "automation";
  }

  if (shortcutInput) {
    const value = shortcutInput.value.trim();
    if (shortcutFlow) {
      shortcutFlow.shortcut = value;
    } else {
      project.shortcut = value;
    }
  }

  if (shortcutAutoAdvanceInput) {
    if (shortcutFlow) {
      shortcutFlow.autoAdvance = shortcutAutoAdvanceInput.checked;
    } else {
      project.shortcutAutoAdvance = shortcutAutoAdvanceInput.checked;
    }
  }

  if (shortcutNameInput && shortcutFlow) {
    shortcutFlow.name = shortcutNameInput.value.trim() || "단축키 플로우";
  }

  saveState();
}

function connectBridge() {
  if (bridgeSocket && bridgeSocket.readyState <= WebSocket.OPEN) {
    return;
  }

  bridgeSocket = new WebSocket(getBridgeSocketUrl());

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

function getBridgeSocketUrl() {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return `ws://${location.host}/ws`;
  }
  return "ws://localhost:4173/ws";
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
    executionMode: "shortcut",
    shortcut: "Ctrl+Alt+1",
    shortcutAutoAdvance: true,
    shortcutFlows: [
      {
        id: crypto.randomUUID(),
        name: "고객 저장",
        shortcut: "Ctrl+Alt+1",
        steps: [
          { id: crypto.randomUUID(), type: "input", targetId: nameMappingId, valueSource: "column", column: "name" },
          { id: crypto.randomUUID(), type: "input", targetId: phoneMappingId, valueSource: "column", column: "phone" },
          { id: crypto.randomUUID(), type: "click", targetId: saveMappingId }
        ],
        autoAdvance: true,
        nextRowIndex: 0
      },
      {
        id: crypto.randomUUID(),
        name: "이름만 입력",
        shortcut: "",
        steps: [
          { id: crypto.randomUUID(), type: "input", targetId: nameMappingId, valueSource: "column", column: "name" }
        ],
        autoAdvance: false,
        nextRowIndex: 0
      },
      {
        id: crypto.randomUUID(),
        name: "전화번호만 입력",
        shortcut: "",
        steps: [
          { id: crypto.randomUUID(), type: "input", targetId: phoneMappingId, valueSource: "column", column: "phone" }
        ],
        autoAdvance: false,
        nextRowIndex: 0
      }
    ],
    nextRowIndex: 0,
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

function renderPricingPage() {
  const currentPlan = getCurrentPlan();
  const canStartTrial = firebaseState.connected && !hasTrialStarted();

  return `
    <section class="pricing-page">
      <header class="help-hero">
        <div>
          <h2>요금제</h2>
          <p>무료로 2개 프로젝트까지 써보고, 더 필요하면 월 4,900원으로 프로젝트를 무제한으로 늘릴 수 있습니다.</p>
        </div>
        <div class="current-plan-box">
          <span>현재 플랜</span>
          <strong>${currentPlan.name}</strong>
          <small>프로젝트 ${projectLimitText()}</small>
          <small>${trialStatusText()}</small>
        </div>
      </header>

      <section class="pricing-grid">
        <article class="pricing-card firebase-card">
          <div>
            <h3>Google 계정</h3>
            <p>Google 로그인 계정의 UID를 기준으로 Firestore의 <strong>licenses/{uid}</strong> 문서와 플랜을 동기화합니다.</p>
          </div>
          <strong class="price">${firebaseState.connected ? "로그인됨" : "로그인 필요"}</strong>
          <ul>
            <li>${firebaseState.message}</li>
            <li>${firebaseState.connected ? escapeHtml(accountLabel()) : "Google 로그인을 하면 라이선스를 확인합니다."}</li>
            <li>${trialStatusText()}</li>
            <li>결제 연동 후 서버가 이 계정의 라이선스 문서를 갱신하면 됩니다.</li>
          </ul>
          <div class="account-actions">
            <button class="${firebaseState.connected ? "" : "primary"}" data-action="${firebaseState.connected ? "sync-license" : "google-login"}">
              ${firebaseState.connected ? "라이선스 새로고침" : "Google 로그인"}
            </button>
            <button class="${canStartTrial ? "primary" : ""}" data-action="${firebaseState.connected ? "start-trial" : "google-login"}" ${firebaseState.connected && hasTrialStarted() ? "disabled" : ""}>
              ${isTrialActive() ? "무료체험 사용 중" : hasTrialStarted() ? "무료체험 종료" : "7일 무료체험"}
            </button>
            ${firebaseState.connected ? `<button data-action="google-logout">로그아웃</button>` : ""}
          </div>
        </article>
        ${Object.values(plans).map((plan) => `
          <article class="pricing-card ${plan.id === state.plan ? "active" : ""}">
            <div>
              <h3>${plan.name}</h3>
              <p>${plan.description}</p>
            </div>
            <strong class="price">${plan.price}</strong>
            <ul>
              <li>${Number.isFinite(plan.projectLimit) ? `프로젝트 ${plan.projectLimit}개` : "프로젝트 무제한"}</li>
              <li>크롬 확장프로그램 매핑</li>
              <li>CSV 데이터 반복 실행</li>
              ${plan.id === "business" ? "<li>백업/복원, 예약 실행, 우선 지원 예정</li>" : ""}
            </ul>
            <button class="${plan.id === state.plan ? "" : "primary"}" data-action="select-plan" data-plan-id="${plan.id}">
              ${plan.id === state.plan ? "현재 사용 중" : plan.id === "free" ? "Free 선택" : `${plan.name} 결제`}
            </button>
          </article>
        `).join("")}
      </section>
    </section>
  `;
}

function render() {
  const project = getProject();
  selectedProjectId = project.id;
  selectedMappingId = selectedMappingId || project.mappings[0]?.id;
  const shortcutFlow = getSelectedShortcutFlow(project);
  const editableSteps = getEditableSteps(project);

  document.querySelector("#app").innerHTML = `
    <div class="app-shell ${currentView !== "builder" ? "page-mode" : ""}">
      <aside class="sidebar">
        <div class="brand">
          <h1>자동화 PC</h1>
          <span class="status-pill ${bridgeState.connected ? "" : "offline"}" title="${escapeHtml(bridgeState.lastMessage)}"><span class="dot"></span>${bridgeState.connected ? "Bridge ON" : "Bridge OFF"}</span>
        </div>
        <div class="plan-summary">
          <span>${getCurrentPlan().name}</span>
          <strong>프로젝트 ${projectLimitText()}</strong>
          <small>${firebaseState.connected ? accountLabel() : firebaseState.message}</small>
        </div>
        <div class="account-strip">
          ${firebaseState.connected ? `
            ${firebaseState.photoURL ? `<img src="${escapeHtml(firebaseState.photoURL)}" alt="" />` : `<span class="avatar-fallback">${escapeHtml(accountLabel().slice(0, 1).toUpperCase())}</span>`}
            <button data-action="google-logout">로그아웃</button>
          ` : `
            <button data-action="google-login">Google 로그인</button>
          `}
        </div>
        <button class="primary" data-action="new-project">${canCreateProject() ? "새 프로젝트" : "업그레이드 필요"}</button>
        <button class="nav-button ${currentView === "help" ? "active" : ""}" data-action="show-help">도움말</button>
        <button class="nav-button ${currentView === "pricing" ? "active" : ""}" data-action="show-pricing">요금제</button>
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
        ${currentView === "pricing" ? renderPricingPage() : ""}
        <header class="topbar">
          <div>
            <h2>${escapeHtml(project.name)}</h2>
            <p>${escapeHtml(project.targetUrl || "프로젝트 설정에서 대상 URL을 입력하세요.")}</p>
          </div>
          <div class="toolbar">
            <button data-action="save-project">저장</button>
            ${isShortcutMode(project)
              ? `<button class="primary" data-action="run-shortcut-flow">현재 행 실행</button>`
              : `
                <button data-action="test-run">테스트 실행</button>
                <button class="primary" data-action="run-all">전체 실행</button>
              `}
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
              <div class="inline-fields">
                <div class="field">
                  <label for="execution-mode">실행 방식</label>
                  <select id="execution-mode">
                    <option value="automation" ${!isShortcutMode(project) ? "selected" : ""}>자동화</option>
                    <option value="shortcut" ${isShortcutMode(project) ? "selected" : ""}>단축키</option>
                  </select>
                </div>
                <div class="field">
                  <label for="shortcut-auto-advance">단축키 데이터 이동</label>
                  <label class="checkbox-field ${!isShortcutMode(project) ? "muted" : ""}">
                    <input id="shortcut-auto-advance" type="checkbox" ${shortcutFlow.autoAdvance !== false ? "checked" : ""} ${!isShortcutMode(project) ? "disabled" : ""} />
                    실행이 끝나면 다음 데이터 준비
                  </label>
                </div>
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
                <h3>${isShortcutMode(project) ? `단축키 플로우: ${escapeHtml(shortcutFlow.name)}` : "자동화 단계"}</h3>
                <span>${isShortcutMode(project) ? "선택한 단축키 하나에 연결될 실행 순서" : "위에서 아래 순서로 실행"}</span>
              </div>
            </div>
            <div class="panel-body stack">
              ${isShortcutMode(project) ? renderShortcutFlowTabs(project) : ""}
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
                ${editableSteps.length ? editableSteps.map((step, index) => `
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
                `).join("") : `<div class="empty-state">${isShortcutMode(project) ? "선택한 단축키 플로우에 아직 단계가 없습니다." : "아직 자동화 단계가 없습니다."}</div>`}
              </div>
            </div>
          </section>

          <section class="panel run-panel">
            ${renderDemoPanel(project)}
            ${isShortcutMode(project) ? renderShortcutPanel(project) : ""}
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

function renderShortcutFlowTabs(project) {
  const flows = getShortcutFlows(project);
  return `
    <div class="shortcut-flow-tabs">
      ${flows.map((flow, index) => `
        <button class="shortcut-flow-tab ${flow.id === selectedShortcutFlowId ? "active" : ""}" data-action="select-shortcut-flow" data-flow-id="${flow.id}">
          <span>${escapeHtml(flow.name || `단축키 ${index + 1}`)}</span>
          <small>${escapeHtml(flow.shortcut || "단축키 미등록")}</small>
        </button>
      `).join("")}
    </div>
  `;
}

function renderShortcutPanel(project) {
  const rows = project.data?.rows || [];
  const columns = project.data?.columns || [];
  const flow = getSelectedShortcutFlow(project);
  const index = getDisplayRowIndex(project, flow);
  const row = rows[index] || {};
  const completed = rows.length > 0 && flow.nextRowIndex >= rows.length;
  const advanceLabel = flow.autoAdvance !== false
    ? "실행 후 다음 데이터로 이동"
    : "실행 후 같은 데이터 유지";

  return `
    <div class="panel-header">
      <div>
        <h3>단축키 실행</h3>
        <span>${advanceLabel}</span>
      </div>
      <button class="primary" data-action="run-shortcut-flow">현재 행 실행</button>
    </div>
    <div class="panel-body stack">
      <div class="inline-fields">
        <div class="field">
          <label for="shortcut-flow-name">플로우 이름</label>
          <input id="shortcut-flow-name" value="${escapeHtml(flow.name || "")}" placeholder="예: 고객 저장" />
        </div>
        <div class="field">
          <label for="shortcut-key">전역 단축키</label>
          <input id="shortcut-key" value="${escapeHtml(flow.shortcut || "")}" placeholder="예: Ctrl+Alt+1" readonly />
        </div>
      </div>
      <div class="inline-fields">
        <div class="field">
          <label>다음 데이터</label>
          <div class="shortcut-row-indicator">${rows.length ? completed ? "모든 데이터 실행 완료" : `${index + 1} / ${rows.length}행` : "데이터 없음"}</div>
        </div>
        <div class="field">
          <label>백그라운드 실행</label>
          <div class="shortcut-row-indicator">${flow.shortcut ? "앱이 켜져 있으면 다른 창에서도 작동" : "단축키를 먼저 등록하세요"}</div>
        </div>
      </div>
      <div class="shortcut-preview">
        ${completed
          ? "모든 행을 실행했습니다. 처음 행으로 돌아가 다시 실행할 수 있습니다."
          : rows.length && columns.length
          ? columns.slice(0, 4).map((column) => `
            <span><strong>${escapeHtml(column)}</strong>${escapeHtml(row[column] ?? "")}</span>
          `).join("")
          : "CSV 데이터를 불러오면 단축키 실행 대상 행이 표시됩니다."}
      </div>
      <div class="row-actions">
        <button data-action="reset-shortcut-row">처음 행으로</button>
        <button data-action="prev-shortcut-row">이전 행</button>
        <button data-action="next-shortcut-row">다음 행</button>
        <button data-action="clear-shortcut">단축키 해제</button>
      </div>
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

function buildRunPayload(project, targetRows, steps = project.steps) {
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
    steps: steps.map((step) => ({
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

function clampNextRowIndex(project, flow = project) {
  const rows = project.data?.rows || [];
  if (!rows.length) {
    flow.nextRowIndex = 0;
    return 0;
  }

  if (!Number.isInteger(flow.nextRowIndex)) {
    flow.nextRowIndex = 0;
  }

  flow.nextRowIndex = Math.min(Math.max(flow.nextRowIndex, 0), rows.length - 1);
  return flow.nextRowIndex;
}

function getDisplayRowIndex(project, flow = project) {
  const rows = project.data?.rows || [];
  if (!rows.length) return 0;
  if (!Number.isInteger(flow.nextRowIndex)) flow.nextRowIndex = 0;
  return Math.min(Math.max(flow.nextRowIndex, 0), rows.length - 1);
}

function advanceShortcutRow(project, amount, flow = project) {
  const rows = project.data?.rows || [];
  if (!rows.length) {
    flow.nextRowIndex = 0;
    return;
  }
  const nextIndex = (Number.isInteger(flow.nextRowIndex) ? flow.nextRowIndex : 0) + amount;
  flow.nextRowIndex = Math.min(Math.max(nextIndex, 0), rows.length);
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

  if (isShortcutMode(project)) {
    addLog(project, "info", "이 프로젝트는 단축키 모드입니다. 현재 행 실행 또는 등록한 단축키로 실행하세요.");
    refreshLogs(project);
    return;
  }

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

async function runShortcutFlow(flowId = selectedShortcutFlowId) {
  const project = getProject();
  const shouldSyncVisibleForm = flowId === selectedShortcutFlowId;
  if (shouldSyncVisibleForm) {
    syncProjectForm(project);
  }
  const rows = project.data?.rows || [];
  const flow = getShortcutFlows(project).find((item) => item.id === flowId) || getSelectedShortcutFlow(project);
  selectedShortcutFlowId = flow.id;

  if (!isShortcutMode(project)) {
    addLog(project, "info", "이 프로젝트는 자동화 모드입니다. 테스트 실행 또는 전체 실행을 사용하세요.");
    refreshLogs(project);
    return;
  }

  if (!flow.steps.length) {
    addLog(project, "error", "선택한 단축키 플로우에 실행 단계가 없습니다.");
    refreshLogs(project);
    return;
  }

  if (!rows.length) {
    addLog(project, "error", "단축키로 실행할 데이터가 없습니다.");
    refreshLogs(project);
    return;
  }

  if (!Number.isInteger(flow.nextRowIndex)) {
    flow.nextRowIndex = 0;
  }

  if (flow.nextRowIndex >= rows.length) {
    addLog(project, "info", `${flow.name}의 모든 데이터 행을 실행했습니다. 처음 행으로 돌아가 다시 실행할 수 있습니다.`);
    refreshLogs(project);
    render();
    return;
  }

  const rowIndex = flow.nextRowIndex;
  const row = rows[rowIndex];
  addLog(project, "info", `${flow.name} 실행: ${rowIndex + 1}행`);
  refreshLogs(project);

  if (!isDemoProject(project)) {
    const sent = sendBridgeMessage({
      type: "automation-run",
      payload: buildRunPayload(project, [row], flow.steps)
    });

    if (!sent) return;
    if (flow.autoAdvance !== false) {
      advanceShortcutRow(project, 1, flow);
      addLog(project, "success", `다음 데이터 준비: ${Math.min(flow.nextRowIndex + 1, rows.length)} / ${rows.length}행`);
    } else {
      addLog(project, "success", `${rowIndex + 1}행 실행 요청 완료. 같은 데이터를 유지합니다.`);
    }
    saveState();
    refreshLogs(project);
    render();
    return;
  }

  for (const step of flow.steps) {
    await runDemoStep(project, step, row);
  }

  if (flow.autoAdvance !== false) {
    advanceShortcutRow(project, 1, flow);
    addLog(project, "success", `${rowIndex + 1}행 실행 완료. 다음 데이터를 준비했습니다.`);
  } else {
    addLog(project, "success", `${rowIndex + 1}행 실행 완료. 같은 데이터를 유지합니다.`);
  }
  saveState();
  refreshLogs(project);
  render();
}

document.addEventListener("click", async (event) => {
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
    selectedShortcutFlowId = getSelectedShortcutFlow(getProject())?.id;
    currentView = "builder";
    render();
    return;
  }

  if (action === "select-shortcut-flow") {
    selectedShortcutFlowId = button.dataset.flowId;
    render();
    return;
  }

  if (action === "show-help") {
    currentView = "help";
    render();
    return;
  }

  if (action === "show-pricing") {
    currentView = "pricing";
    render();
    return;
  }

  if (action === "new-project") {
    if (!canCreateProject()) {
      const activeProject = getProject();
      addLog(activeProject, "error", "Free 플랜은 프로젝트 2개까지 만들 수 있습니다. Pro로 업그레이드하면 무제한으로 만들 수 있습니다.");
      currentView = "pricing";
      saveState();
      render();
      return;
    }

    const next = {
      id: crypto.randomUUID(),
      name: "새 자동화 프로젝트",
      targetUrl: "",
      mappings: [],
      steps: [],
      executionMode: "automation",
      shortcut: "",
      shortcutAutoAdvance: true,
      shortcutFlows: normalizeShortcutFlows({ executionMode: "shortcut", steps: [] }),
      nextRowIndex: 0,
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
    if (!canCreateProject()) {
      const activeProject = getProject();
      addLog(activeProject, "error", "Free 플랜은 프로젝트 2개까지 만들 수 있습니다. Pro로 업그레이드하면 예시 프로젝트를 더 만들 수 있습니다.");
      currentView = "pricing";
      saveState();
      render();
      return;
    }

    const example = createExampleProject();
    state.projects.push(example);
    selectedProjectId = example.id;
    selectedMappingId = example.mappings[0]?.id;
    selectedShortcutFlowId = getSelectedShortcutFlow(example)?.id;
    currentView = "builder";
    addLog(example, "success", "예시 자동화를 만들었습니다. 테스트 실행으로 흐름을 확인해보세요.");
    saveState();
    render();
  }

  if (action === "sync-license") {
    if (firebaseState.connected) {
      await syncLicenseFromFirebase();
    } else {
      await initFirebase();
    }
    render();
  }

  if (action === "google-login") {
    await signInWithGoogle();
  }

  if (action === "google-logout") {
    await signOutGoogle();
  }

  if (action === "start-trial") {
    await startFreeTrial();
  }

  if (action === "select-plan") {
    const nextPlan = button.dataset.planId || "free";
    if (nextPlan !== "free" && !firebaseState.connected) {
      const activeProject = getProject();
      addLog(activeProject, "error", "유료 플랜은 Google 로그인 후 적용할 수 있습니다.");
      currentView = "pricing";
      saveState();
      render();
      return;
    }

    if (nextPlan !== "free") {
      const opened = await startPaidPlanCheckout(nextPlan);
      if (opened) {
        const activeProject = getProject();
        addLog(activeProject, "info", `${plans[nextPlan].name} 나이스페이 결제 페이지를 열었습니다.`);
        refreshLogs(activeProject);
      }
      return;
    }

    state.plan = nextPlan;
    const activeProject = getProject();
    addLog(activeProject, "success", `${getCurrentPlan().name} 플랜이 적용되었습니다.`);
    await saveLicenseToFirebase(state.plan);
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

    getEditableSteps(project).push(step);
    addLog(project, "success", "자동화 단계를 추가했습니다.");
    saveState();
    render();
  }

  if (action === "remove-step") {
    if (isShortcutMode(project)) {
      const flow = getSelectedShortcutFlow(project);
      flow.steps = flow.steps.filter((step) => step.id !== button.dataset.stepId);
    } else {
      project.steps = project.steps.filter((step) => step.id !== button.dataset.stepId);
    }
    addLog(project, "info", "자동화 단계를 삭제했습니다.");
    saveState();
    render();
  }

  if (action === "clear-steps") {
    if (isShortcutMode(project)) {
      getSelectedShortcutFlow(project).steps = [];
    } else {
      project.steps = [];
    }
    addLog(project, "info", "자동화 단계를 모두 비웠습니다.");
    saveState();
    render();
  }

  if (action === "run-shortcut-flow") {
    await runShortcutFlow();
  }

  if (action === "reset-shortcut-row") {
    setProject((activeProject) => {
      getSelectedShortcutFlow(activeProject).nextRowIndex = 0;
    });
  }

  if (action === "prev-shortcut-row") {
    setProject((activeProject) => {
      advanceShortcutRow(activeProject, -1, getSelectedShortcutFlow(activeProject));
    });
  }

  if (action === "next-shortcut-row") {
    setProject((activeProject) => {
      advanceShortcutRow(activeProject, 1, getSelectedShortcutFlow(activeProject));
    });
  }

  if (action === "clear-shortcut") {
    setProject((activeProject) => {
      getSelectedShortcutFlow(activeProject).shortcut = "";
    });
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
  if (["target-url", "execution-mode", "shortcut-auto-advance", "shortcut-flow-name"].includes(event.target.id)) {
    const project = getProject();
    syncProjectForm(project);
    if (event.target.id === "target-url") {
      addLog(project, "info", "대상 URL을 적용했습니다.");
    }
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
    project.nextRowIndex = 0;
    getShortcutFlows(project).forEach((flow) => {
      flow.nextRowIndex = 0;
    });
    addLog(project, "success", `${file.name} 파일을 불러왔습니다.`);
  });
});

document.addEventListener("keydown", async (event) => {
  const shortcut = formatShortcutEvent(event);
  if (!shortcut) return;

  if (event.target.id === "shortcut-key") {
    event.preventDefault();
    setProject((project) => {
      getSelectedShortcutFlow(project).shortcut = shortcut;
    });
    return;
  }

  const project = getProject();
  if (!isShortcutMode(project)) return;
  const flow = getShortcutFlows(project).find((item) => item.shortcut === shortcut);
  if (!flow) return;

  event.preventDefault();
  await runShortcutFlow(flow.id);
});

function isEditableTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
}

function formatShortcutEvent(event) {
  if (event.isComposing || event.key === "Process") return "";

  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");

  const key = normalizeShortcutKey(event.key);
  if (!key || ["Control", "Alt", "Shift", "Meta"].includes(key)) return "";
  parts.push(key);
  if (parts.length < 2 && !/^F\d{1,2}$/.test(key)) return "";
  return parts.join("+");
}

function normalizeShortcutKey(key) {
  if (!key) return "";
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

render();
connectBridge();
initFirebase();
initGlobalShortcutBridge();
