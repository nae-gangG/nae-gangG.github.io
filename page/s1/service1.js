import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore,
  doc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD043muv8n5HRRIsYMLQxh-oZy9cuE2HYY",
  authDomain: "nae-gangg-24958.firebaseapp.com",
  projectId: "nae-gangg-24958",
  storageBucket: "nae-gangg-24958.firebasestorage.app",
  messagingSenderId: "925867766886",
  appId: "1:925867766886:web:aab1ef0a0868287b3fa9a7"
};

const PRESENCE_TIMEOUT_MS = 35000;
const HEARTBEAT_INTERVAL_MS = 12000;

// 도구별 3단계 굵기 설정 (볼펜 / 형광펜 / 지우개)
const TOOL_WIDTHS = {
  ballpoint: { thin: 1.8, medium: 3.4, thick: 6.0 },
  highlighter: { thin: 12, medium: 20, thick: 30 },
  eraser: { thin: 14, medium: 26, thick: 44 }
};

function getOrCreateDeviceId() {
  const key = "couple_device_id_v1";
  let did = localStorage.getItem(key);
  if (!did) {
    did = "dev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    localStorage.setItem(key, did);
  }
  return did;
}

const DEVICE_ID = getOrCreateDeviceId();

// 애플리케이션 상태
let state = {
  profiles: {
    A: "강쥐",
    B: "승이"
  },
  waitingCounts: {
    A: 0,
    B: 0
  },
  activeDrawing: null, // { user: 'A'|'B', deviceId: string, startedAt: number }
  sharedNote: null     // { title, author: 'A'|'B', durationSec, imageDataUrl, memo, createdAt }
};

// 로컬 그리기 세션 상태
let drawingSession = {
  isDrawingMode: false,
  activeUser: "A",
  startTimeMs: 0,
  elapsedSec: 0,
  timerInterval: null,
  tool: "ballpoint",
  sizeKey: "medium",
  color: "#1E1B18",
  strokes: [],
  redoStack: [],
  currentStroke: null,
  isPointerDown: false
};

let partnerTimerInterval = null;

let db = null;
let scheduleDocRef = null;
let noteDocRef = null;
let presenceDocRef = null;
let isCloudConnected = false;
let hasLoadedNoteDoc = false;
let isInitialStateResolved = false;
let latestPresenceMap = {};
let pendingConfirmAction = null;

const LOCAL_NOTE_CACHE_KEY = "gangjwi_seungyi_waiting_note_v2";
const LOCAL_SCHEDULE_CACHE_KEY = "gangjwi_seungyi_schedule_v5";

// 공통 DOM
const btnOpenDrawer = document.getElementById("btn-open-drawer");
const btnCloseDrawer = document.getElementById("btn-close-drawer");
const navDrawer = document.getElementById("nav-drawer");
const drawerBackdrop = document.getElementById("drawer-backdrop");
const btnDrawerNickname = document.getElementById("btn-drawer-nickname");
const btnDrawerPatchnotes = document.getElementById("btn-drawer-patchnotes");

const syncStatusEl = document.getElementById("sync-status");
const syncTextEl = document.getElementById("sync-text");
const nicknameModal = document.getElementById("nickname-modal");
const btnCloseModal = document.getElementById("btn-close-modal");
const btnSaveNickname = document.getElementById("btn-save-nickname");
const inputNameA = document.getElementById("input-name-a");
const inputNameB = document.getElementById("input-name-b");

const patchnotesModal = document.getElementById("patchnotes-modal");
const btnClosePatchnotes = document.getElementById("btn-close-patchnotes");
const patchnotesListEl = document.getElementById("patchnotes-list");

const confirmModal = document.getElementById("confirm-modal");
const confirmModalTitle = document.getElementById("confirm-modal-title");
const confirmModalDesc = document.getElementById("confirm-modal-desc");
const btnConfirmOk = document.getElementById("btn-confirm-ok");
const btnConfirmCancel = document.getElementById("btn-confirm-cancel");

// 기다림의 노트 전용 DOM
const waitCountAEl = document.getElementById("wait-count-a");
const waitCountBEl = document.getElementById("wait-count-b");
const viewSelectUser = document.getElementById("view-select-user");
const viewPartnerDrawing = document.getElementById("view-partner-drawing");
const partnerDrawingTitle = document.getElementById("partner-drawing-title");
const partnerDrawingTimer = document.getElementById("partner-drawing-timer");
const btnForceUnlock = document.getElementById("btn-force-unlock");

const viewWorkspace = document.getElementById("view-workspace");
const btnStartUserA = document.getElementById("btn-start-user-a");
const btnStartUserB = document.getElementById("btn-start-user-b");

const drawingStatusCard = document.getElementById("drawing-status-card");
const drawingUserBadge = document.getElementById("drawing-user-badge");
const waitingTimerText = document.getElementById("waiting-timer-text");
const btnCancelDrawing = document.getElementById("btn-cancel-drawing");
const btnFinishDrawing = document.getElementById("btn-finish-drawing");

const completedHeader = document.getElementById("completed-header");
const completedAuthorBadge = document.getElementById("completed-author-badge");
const completedDurationBadge = document.getElementById("completed-duration-badge");
const completedDateText = document.getElementById("completed-date-text");
const completedTitleText = document.getElementById("completed-title-text");
const btnDeleteNote = document.getElementById("btn-delete-note");

const goodnotesToolbar = document.getElementById("goodnotes-toolbar");
const btnStrokeUndo = document.getElementById("btn-stroke-undo");
const btnStrokeRedo = document.getElementById("btn-stroke-redo");
const btnClearCanvas = document.getElementById("btn-clear-canvas");
const inputCustomColor = document.getElementById("input-custom-color");

const canvasPaper = document.getElementById("canvas-paper");
const canvas = document.getElementById("drawing-canvas");
const ctx = canvas.getContext("2d");
const sharedNoteImage = document.getElementById("shared-note-image");

const noteMemoDisplay = document.getElementById("note-memo-display");
const noteMemoText = document.getElementById("note-memo-text");
const canvasMemoFooter = document.getElementById("canvas-memo-footer");
const btnOpenMemo = document.getElementById("btn-open-memo");

const completeModal = document.getElementById("complete-modal");
const completeTimeSummary = document.getElementById("complete-time-summary");
const completeForm = document.getElementById("complete-form");
const noteTitleInput = document.getElementById("note-title-input");
const titleError = document.getElementById("title-error");
const btnCancelComplete = document.getElementById("btn-cancel-complete");

// 100자 편지 메모 모달 DOM
const memoModal = document.getElementById("memo-modal");
const memoForm = document.getElementById("memo-form");
const noteMemoInput = document.getElementById("note-memo-input");
const memoCharCount = document.getElementById("memo-char-count");
const memoError = document.getElementById("memo-error");
const btnCancelMemo = document.getElementById("btn-cancel-memo");

init();

function init() {
  loadGlobalPatchNotes();
  bindCommonEvents();
  bindNoteEvents();
  bindCanvasDrawingEvents();
  initDataSync();
  renderAll();
}

// ==========================================
// 0. 전역 패치 노트 로더 (메인 ../../script.js의 PATCH_NOTES 단일 참조)
// ==========================================
async function loadGlobalPatchNotes() {
  if (!patchnotesListEl) return;
  try {
    const res = await fetch("../../script.js", { cache: "no-cache" });
    if (!res.ok) return;
    const text = await res.text();
    const match = text.match(/const\s+PATCH_NOTES\s*=\s*(\[[\s\S]*?\]);/);
    if (match && match[1]) {
      const notes = new Function(`return ${match[1]};`)();
      if (Array.isArray(notes)) {
        renderPatchNotes(notes);
      }
    }
  } catch (err) {
    console.error("전역 패치 노트 불러오기 실패:", err);
  }
}

function renderPatchNotes(notes) {
  if (!patchnotesListEl || !Array.isArray(notes)) return;
  patchnotesListEl.innerHTML = notes
    .map(
      (note) => `
      <div class="patch-card ${note.latest ? "latest" : ""}">
        <div class="patch-card-top">
          <span class="patch-version">${escapeHtml(note.version)}</span>
          <span class="patch-date">${escapeHtml(note.date)}</span>
        </div>
        <div class="patch-title">${escapeHtml(note.title)}</div>
        <ul class="patch-items">
          ${(note.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
    `
    )
    .join("");
}

// ==========================================
// 1. 시간 및 받침 조사("이가/가") 포맷 유틸리티
// ==========================================
function formatMinSec(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}분 ${secs}초`;
}

function formatDateTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

// 이름 마지막 글자에 받침이 있으면 '이가', 없으면 '가' 반환 (예: 강쥐가, 승이가, 동건이가)
function getSubjectParticle(name) {
  if (!name) return "가";
  const lastCode = name.charCodeAt(name.length - 1);
  if (lastCode < 0xac00 || lastCode > 0xd7a3) return "가";
  const hasJongseong = (lastCode - 0xac00) % 28 !== 0;
  return hasJongseong ? "이가" : "가";
}

// ==========================================
// 2. Firebase 실시간 DB 연동 & 초기 화면 깜빡임 방지
// ==========================================
function initDataSync() {
  const savedSchedule = localStorage.getItem(LOCAL_SCHEDULE_CACHE_KEY);
  if (savedSchedule) {
    try {
      const parsed = JSON.parse(savedSchedule);
      if (parsed.profiles) state.profiles = parsed.profiles;
    } catch (e) {
      console.error(e);
    }
  }

  const savedNote = localStorage.getItem(LOCAL_NOTE_CACHE_KEY);
  if (savedNote) {
    try {
      const parsed = JSON.parse(savedNote);
      if (parsed.waitingCounts) state.waitingCounts = parsed.waitingCounts;
      if (parsed.activeDrawing !== undefined) state.activeDrawing = parsed.activeDrawing;
      if (parsed.sharedNote !== undefined) state.sharedNote = parsed.sharedNote;

      if (state.sharedNote || state.activeDrawing) {
        isInitialStateResolved = true;
      }
    } catch (e) {
      console.error(e);
    }
  }

  const fallbackTimer = setTimeout(() => {
    if (!isInitialStateResolved) {
      isInitialStateResolved = true;
      renderAll();
    }
  }, 300);

  try {
    const app = initializeApp(firebaseConfig);
    db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true
    });

    scheduleDocRef = doc(db, "couple_space", "weekly_schedule_v5");
    noteDocRef = doc(db, "couple_space", "waiting_note_v1");

    onSnapshot(scheduleDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.profiles) {
          state.profiles = data.profiles;
          renderProfileNames();
          updatePartnerDrawingUI();
        }
      }
    });

    onSnapshot(
      noteDocRef,
      async (snapshot) => {
        clearTimeout(fallbackTimer);
        isCloudConnected = true;
        hasLoadedNoteDoc = true;
        isInitialStateResolved = true;
        updateSyncBadgeUI();

        if (snapshot.exists()) {
          const data = snapshot.data();
          state.waitingCounts = data.waitingCounts || { A: 0, B: 0 };
          state.activeDrawing = data.activeDrawing || null;
          state.sharedNote = data.sharedNote || null;

          // 만약 상대방이 강제로 대기 잠금을 해제했거나 그림이 완성되었다면 내 그리기 모드 정리
          if (
            drawingSession.isDrawingMode &&
            (!state.activeDrawing || state.activeDrawing.deviceId !== DEVICE_ID)
          ) {
            stopWaitingTimer();
            drawingSession.isDrawingMode = false;
          }

          localStorage.setItem(
            LOCAL_NOTE_CACHE_KEY,
            JSON.stringify({
              waitingCounts: state.waitingCounts,
              activeDrawing: state.activeDrawing,
              sharedNote: state.sharedNote
            })
          );

          renderWaitingCounts();
          if (!drawingSession.isDrawingMode) {
            renderAll();
          }
        } else {
          await saveNoteData();
          if (!drawingSession.isDrawingMode) {
            renderAll();
          }
        }
      },
      (err) => {
        clearTimeout(fallbackTimer);
        console.error("기다림의 노트 DB 읽기 오류:", err);
        isCloudConnected = false;
        isInitialStateResolved = true;
        updateSyncBadgeUI();
        renderAll();
      }
    );

    initPresenceTracking();
  } catch (err) {
    clearTimeout(fallbackTimer);
    console.error("Firebase 연결 실패:", err);
    isCloudConnected = false;
    isInitialStateResolved = true;
    updateSyncBadgeUI();
    renderAll();
  }
}

async function saveNoteData() {
  const payload = {
    waitingCounts: state.waitingCounts,
    activeDrawing: state.activeDrawing,
    sharedNote: state.sharedNote,
    updatedAt: Date.now()
  };

  localStorage.setItem(LOCAL_NOTE_CACHE_KEY, JSON.stringify(payload));

  if (noteDocRef && hasLoadedNoteDoc) {
    try {
      await setDoc(noteDocRef, payload);
    } catch (err) {
      console.error("기다림의 노트 DB 저장 오류:", err);
    }
  }
}

async function saveProfileNicknames() {
  if (!scheduleDocRef) return;
  try {
    await setDoc(
      scheduleDocRef,
      { profiles: state.profiles, updatedAt: Date.now() },
      { merge: true }
    );
  } catch (err) {
    console.error("애칭 저장 오류:", err);
  }
}

function updateSyncBadgeUI() {
  if (!syncStatusEl || !syncTextEl) return;
  syncStatusEl.classList.remove("mode-local", "mode-alone", "mode-both");

  if (navigator.onLine === false || !isCloudConnected) {
    syncStatusEl.classList.add("mode-local");
    syncTextEl.textContent = "로컬 모드";
    return;
  }

  const now = Date.now();
  const activeDevices = Object.entries(latestPresenceMap).filter(
    ([, lastSeen]) => typeof lastSeen === "number" && now - lastSeen < PRESENCE_TIMEOUT_MS
  );

  if (Math.max(1, activeDevices.length) >= 2) {
    syncStatusEl.classList.add("mode-both");
    syncTextEl.textContent = "둘 다 접속 중!!!";
  } else {
    syncStatusEl.classList.add("mode-alone");
    syncTextEl.textContent = "혼자 접속 중...";
  }
}

async function sendPresenceHeartbeat(isActive = true) {
  if (!presenceDocRef || navigator.onLine === false) return;
  const timestamp = isActive ? Date.now() : 0;
  latestPresenceMap[DEVICE_ID] = timestamp;
  updateSyncBadgeUI();

  try {
    await setDoc(
      presenceDocRef,
      { devices: { [DEVICE_ID]: timestamp } },
      { merge: true }
    );
  } catch (err) {
    console.error(err);
  }
}

function initPresenceTracking() {
  if (!db) return;
  presenceDocRef = doc(db, "couple_space", "presence_v2");

  onSnapshot(presenceDocRef, (snapshot) => {
    isCloudConnected = true;
    if (snapshot.exists()) {
      latestPresenceMap = snapshot.data().devices || {};
    }
    updateSyncBadgeUI();
  });

  sendPresenceHeartbeat(true);

  setInterval(() => {
    if (document.visibilityState === "visible") {
      sendPresenceHeartbeat(true);
    } else {
      updateSyncBadgeUI();
    }
  }, HEARTBEAT_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    sendPresenceHeartbeat(document.visibilityState === "visible");
  });

  window.addEventListener("pagehide", () => {
    sendPresenceHeartbeat(false);
  });
}

// ==========================================
// 3. 사용자 선택 & 실시간 그리기 상태 공유 & 타이머
// ==========================================
async function startWaitingAndDrawing(userKey) {
  const now = Date.now();
  drawingSession.isDrawingMode = true;
  drawingSession.activeUser = userKey;
  drawingSession.startTimeMs = now;
  drawingSession.elapsedSec = 0;
  drawingSession.strokes = [];
  drawingSession.redoStack = [];

  // 상대방에게 "(이름)가 그림 그리는 중 ..." 창이 즉시 뜨도록 DB에 상태 기록
  state.activeDrawing = {
    user: userKey,
    deviceId: DEVICE_ID,
    startedAt: now
  };

  renderAll();
  resizeCanvas();
  redrawCanvas();
  updateTimerUI();

  if (drawingSession.timerInterval) {
    clearInterval(drawingSession.timerInterval);
  }
  drawingSession.timerInterval = setInterval(() => {
    drawingSession.elapsedSec = Math.floor((Date.now() - drawingSession.startTimeMs) / 1000);
    updateTimerUI();
  }, 1000);

  await saveNoteData();
}

function stopWaitingTimer() {
  if (drawingSession.timerInterval) {
    clearInterval(drawingSession.timerInterval);
    drawingSession.timerInterval = null;
  }
}

function stopPartnerTimer() {
  if (partnerTimerInterval) {
    clearInterval(partnerTimerInterval);
    partnerTimerInterval = null;
  }
}

function updateTimerUI() {
  const userName =
    drawingSession.activeUser === "A" ? state.profiles.A : state.profiles.B;
  drawingUserBadge.textContent = userName;
  drawingUserBadge.className = `author-badge ${
    drawingSession.activeUser === "A" ? "user-a" : "user-b"
  }`;
  waitingTimerText.textContent = `${formatMinSec(drawingSession.elapsedSec)} 동안 기다리는 중..`;
}

function updatePartnerDrawingUI() {
  if (!state.activeDrawing || !partnerDrawingTitle || !partnerDrawingTimer) return;
  const drawerName =
    state.activeDrawing.user === "A" ? state.profiles.A : state.profiles.B;
  const particle = getSubjectParticle(drawerName);
  partnerDrawingTitle.textContent = `${drawerName}${particle} 그림 그리는 중 ...`;

  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - (state.activeDrawing.startedAt || Date.now())) / 1000)
  );
  partnerDrawingTimer.textContent = `${formatMinSec(elapsed)}째 열중하는 중`;
}

function openCompleteModal() {
  drawingSession.elapsedSec = Math.max(
    1,
    Math.floor((Date.now() - drawingSession.startTimeMs) / 1000)
  );
  stopWaitingTimer();

  completeTimeSummary.textContent = `총 ${formatMinSec(
    drawingSession.elapsedSec
  )} 동안 기다렸어요.`;
  noteTitleInput.value = "";
  titleError.classList.add("hidden");
  completeModal.classList.remove("hidden");
  setTimeout(() => noteTitleInput.focus(), 80);
}

async function handleCompleteSubmit(e) {
  e.preventDefault();
  const title = noteTitleInput.value.trim();
  if (!title) {
    titleError.classList.remove("hidden");
    noteTitleInput.focus();
    return;
  }

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exCtx = exportCanvas.getContext("2d");
  exCtx.fillStyle = "#FFFFFF";
  exCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  exCtx.drawImage(canvas, 0, 0);

  const imageDataUrl = exportCanvas.toDataURL("image/webp", 0.85);
  const authorKey = drawingSession.activeUser;

  // 그림 완성 시 해당 사용자의 '기다린 횟수' +1 증가 & 그리는 중 상태 해제
  state.waitingCounts[authorKey] = (Number(state.waitingCounts[authorKey]) || 0) + 1;
  state.activeDrawing = null;

  state.sharedNote = {
    title,
    author: authorKey,
    durationSec: drawingSession.elapsedSec,
    imageDataUrl,
    memo: "",
    createdAt: Date.now()
  };

  drawingSession.isDrawingMode = false;
  completeModal.classList.add("hidden");

  await saveNoteData();
  renderAll();
}

function resumeDrawingFromCompleteModal() {
  completeModal.classList.add("hidden");
  drawingSession.startTimeMs = Date.now() - drawingSession.elapsedSec * 1000;
  drawingSession.timerInterval = setInterval(() => {
    drawingSession.elapsedSec = Math.floor((Date.now() - drawingSession.startTimeMs) / 1000);
    updateTimerUI();
  }, 1000);
}

// ==========================================
// 4. 100자 편지 메모 추가하기 기능
// ==========================================
function openMemoModal() {
  if (!state.sharedNote) return;
  const currentMemo = state.sharedNote.memo || "";
  noteMemoInput.value = currentMemo;
  memoCharCount.textContent = `${currentMemo.length} / 100`;
  memoError.classList.add("hidden");
  memoModal.classList.remove("hidden");
  setTimeout(() => noteMemoInput.focus(), 80);
}

function closeMemoModal() {
  memoModal.classList.add("hidden");
}

async function handleMemoSubmit(e) {
  e.preventDefault();
  if (!state.sharedNote) return;

  const memoText = noteMemoInput.value.trim();
  if (!memoText) {
    memoError.classList.remove("hidden");
    noteMemoInput.focus();
    return;
  }

  state.sharedNote.memo = memoText.slice(0, 100);
  closeMemoModal();

  await saveNoteData();
  renderAll();
}

// ==========================================
// 5. 캔버스 드로잉 엔진 (볼펜 / 형광펜 / 지우개)
// ==========================================
function resizeCanvas() {
  if (!canvasPaper || !canvas) return;
  const rect = canvasPaper.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawCanvas();
}

function getPointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function bindCanvasDrawingEvents() {
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerUp);

  window.addEventListener("resize", () => {
    if (drawingSession.isDrawingMode) {
      resizeCanvas();
    }
  });
}

function handlePointerDown(e) {
  if (!drawingSession.isDrawingMode) return;
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();

  drawingSession.isPointerDown = true;
  const pt = getPointerPos(e);
  const baseWidth = TOOL_WIDTHS[drawingSession.tool][drawingSession.sizeKey];

  drawingSession.currentStroke = {
    tool: drawingSession.tool,
    color: drawingSession.color,
    baseWidth,
    points: [pt]
  };

  redrawCanvas();
}

function handlePointerMove(e) {
  if (!drawingSession.isPointerDown || !drawingSession.currentStroke) return;
  e.preventDefault();

  const pt = getPointerPos(e);
  const pts = drawingSession.currentStroke.points;
  const lastPt = pts[pts.length - 1];
  const dist = Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y);

  if (dist < 1.5) return;

  pts.push(pt);
  redrawCanvas();
}

function handlePointerUp() {
  if (!drawingSession.isPointerDown || !drawingSession.currentStroke) return;

  drawingSession.isPointerDown = false;
  drawingSession.strokes.push(drawingSession.currentStroke);
  drawingSession.currentStroke = null;
  drawingSession.redoStack = [];

  updateHistoryButtonsUI();
  redrawCanvas();
}

function redrawCanvas() {
  if (!ctx || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  const allStrokes = [...drawingSession.strokes];
  if (drawingSession.currentStroke) {
    allStrokes.push(drawingSession.currentStroke);
  }

  for (const stroke of allStrokes) {
    drawSingleStroke(ctx, stroke);
  }
}

function drawSingleStroke(context, stroke) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  if (stroke.tool === "eraser") {
    context.globalCompositeOperation = "destination-out";
    context.strokeStyle = "rgba(0,0,0,1)";
    context.lineWidth = stroke.baseWidth;
  } else if (stroke.tool === "highlighter") {
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = 0.36;
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.baseWidth;
  } else {
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1.0;
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.baseWidth;
  }

  if (pts.length === 1) {
    context.beginPath();
    context.arc(pts[0].x, pts[0].y, stroke.baseWidth / 2, 0, Math.PI * 2);
    context.fillStyle = stroke.tool === "eraser" ? "rgba(0,0,0,1)" : stroke.color;
    context.fill();
    context.restore();
    return;
  }

  context.beginPath();
  context.moveTo(pts[0].x, pts[0].y);

  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    context.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }

  const last = pts[pts.length - 1];
  context.lineTo(last.x, last.y);
  context.stroke();
  context.restore();
}

function updateHistoryButtonsUI() {
  if (btnStrokeUndo) {
    btnStrokeUndo.disabled = drawingSession.strokes.length === 0;
  }
  if (btnStrokeRedo) {
    btnStrokeRedo.disabled = drawingSession.redoStack.length === 0;
  }
}

// ==========================================
// 6. 이벤트 바인딩 & 전체 렌더링
// ==========================================
function bindNoteEvents() {
  btnStartUserA.addEventListener("click", () => startWaitingAndDrawing("A"));
  btnStartUserB.addEventListener("click", () => startWaitingAndDrawing("B"));

  // 그리기 취소 시 DB의 activeDrawing 잠금도 즉시 해제
  btnCancelDrawing.addEventListener("click", async () => {
    stopWaitingTimer();
    drawingSession.isDrawingMode = false;
    state.activeDrawing = null;
    await saveNoteData();
    renderAll();
  });

  // 상대방이 실수로 창을 닫았을 때 대기 잠금 해제 버튼
  if (btnForceUnlock) {
    btnForceUnlock.addEventListener("click", async () => {
      state.activeDrawing = null;
      await saveNoteData();
      renderAll();
    });
  }

  btnFinishDrawing.addEventListener("click", openCompleteModal);
  btnCancelComplete.addEventListener("click", resumeDrawingFromCompleteModal);
  completeForm.addEventListener("submit", handleCompleteSubmit);
  noteTitleInput.addEventListener("input", () => titleError.classList.add("hidden"));

  // 메모 추가하기 모달 이벤트
  btnOpenMemo.addEventListener("click", openMemoModal);
  btnCancelMemo.addEventListener("click", closeMemoModal);
  memoForm.addEventListener("submit", handleMemoSubmit);
  noteMemoInput.addEventListener("input", () => {
    memoError.classList.add("hidden");
    memoCharCount.textContent = `${noteMemoInput.value.length} / 100`;
  });

  // 새로 그리기 버튼
  btnDeleteNote.addEventListener("click", () => {
    openConfirmModal({
      title: "새로 그리기",
      desc: "전시된 그림을 지우고 새로 그릴까요?",
      okText: "새로 그리기",
      onConfirm: async () => {
        state.sharedNote = null;
        state.activeDrawing = null;
        drawingSession.isDrawingMode = false;
        await saveNoteData();
        renderAll();
      }
    });
  });

  // 툴바: 도구 선택
  document.querySelectorAll(".gn-tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      drawingSession.tool = btn.dataset.tool;
      document.querySelectorAll(".gn-tool-btn").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
    });
  });

  // 툴바: 굵기 3단계 선택
  document.querySelectorAll(".gn-size-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      drawingSession.sizeKey = btn.dataset.size;
      document.querySelectorAll(".gn-size-btn").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
    });
  });

  // 툴바: 색상 칩 선택
  document.querySelectorAll(".gn-color-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      drawingSession.color = chip.dataset.color;
      if (drawingSession.tool === "eraser") {
        drawingSession.tool = "ballpoint";
        document.querySelectorAll(".gn-tool-btn").forEach((b) =>
          b.classList.toggle("active", b.dataset.tool === "ballpoint")
        );
      }
      document.querySelectorAll(".gn-color-chip").forEach((c) =>
        c.classList.toggle("active", c === chip)
      );
    });
  });

  // 커스텀 색상 선택
  inputCustomColor.addEventListener("input", (e) => {
    drawingSession.color = e.target.value;
    if (drawingSession.tool === "eraser") {
      drawingSession.tool = "ballpoint";
      document.querySelectorAll(".gn-tool-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.tool === "ballpoint")
      );
    }
    document.querySelectorAll(".gn-color-chip").forEach((c) =>
      c.classList.remove("active")
    );
  });

  // Undo / Redo / 전체 지움
  btnStrokeUndo.addEventListener("click", () => {
    if (drawingSession.strokes.length === 0) return;
    drawingSession.redoStack.push(drawingSession.strokes.pop());
    updateHistoryButtonsUI();
    redrawCanvas();
  });

  btnStrokeRedo.addEventListener("click", () => {
    if (drawingSession.redoStack.length === 0) return;
    drawingSession.strokes.push(drawingSession.redoStack.pop());
    updateHistoryButtonsUI();
    redrawCanvas();
  });

  btnClearCanvas.addEventListener("click", () => {
    if (drawingSession.strokes.length === 0) return;
    drawingSession.strokes = [];
    drawingSession.redoStack = [];
    updateHistoryButtonsUI();
    redrawCanvas();
  });
}

function bindCommonEvents() {
  if (btnOpenDrawer) btnOpenDrawer.addEventListener("click", openDrawer);
  if (btnCloseDrawer) btnCloseDrawer.addEventListener("click", closeDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeDrawer);

  if (btnDrawerNickname) {
    btnDrawerNickname.addEventListener("click", () => {
      closeDrawer();
      inputNameA.value = state.profiles.A;
      inputNameB.value = state.profiles.B;
      nicknameModal.classList.remove("hidden");
    });
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener("click", () => nicknameModal.classList.add("hidden"));
  }

  if (btnSaveNickname) {
    btnSaveNickname.addEventListener("click", async () => {
      state.profiles = {
        A: inputNameA.value.trim() || "강쥐",
        B: inputNameB.value.trim() || "승이"
      };
      nicknameModal.classList.add("hidden");
      renderProfileNames();
      updatePartnerDrawingUI();
      await saveProfileNicknames();
    });
  }

  if (btnDrawerPatchnotes) {
    btnDrawerPatchnotes.addEventListener("click", async () => {
      closeDrawer();
      await loadGlobalPatchNotes();
      patchnotesModal.classList.remove("hidden");
    });
  }

  if (btnClosePatchnotes) {
    btnClosePatchnotes.addEventListener("click", () =>
      patchnotesModal.classList.add("hidden")
    );
  }

  if (btnConfirmCancel) {
    btnConfirmCancel.addEventListener("click", closeConfirmModal);
  }

  if (btnConfirmOk) {
    btnConfirmOk.addEventListener("click", () => {
      const action = pendingConfirmAction;
      closeConfirmModal();
      if (typeof action === "function") action();
    });
  }
}

function openDrawer() {
  navDrawer.classList.add("open");
  drawerBackdrop.classList.remove("hidden");
}

function closeDrawer() {
  navDrawer.classList.remove("open");
  drawerBackdrop.classList.add("hidden");
}

function openConfirmModal({ title, desc, okText = "확인", onConfirm }) {
  confirmModalTitle.textContent = title;
  confirmModalDesc.textContent = desc;
  btnConfirmOk.textContent = okText;
  pendingConfirmAction = onConfirm;
  confirmModal.classList.remove("hidden");
}

function closeConfirmModal() {
  confirmModal.classList.add("hidden");
  pendingConfirmAction = null;
}

function renderProfileNames() {
  document.querySelectorAll(".name-a").forEach((el) => {
    el.textContent = state.profiles.A;
  });
  document.querySelectorAll(".name-b").forEach((el) => {
    el.textContent = state.profiles.B;
  });
}

function renderWaitingCounts() {
  if (waitCountAEl) {
    waitCountAEl.textContent = `${state.waitingCounts.A || 0}회`;
  }
  if (waitCountBEl) {
    waitCountBEl.textContent = `${state.waitingCounts.B || 0}회`;
  }
}

function renderAll() {
  renderProfileNames();
  renderWaitingCounts();
  stopPartnerTimer();

  // 1) 현재 내 기기에서 내가 그리고 있는 중인 경우
  if (drawingSession.isDrawingMode) {
    viewSelectUser.classList.add("hidden");
    viewPartnerDrawing.classList.add("hidden");
    viewWorkspace.classList.remove("hidden");
    drawingStatusCard.classList.remove("hidden");
    goodnotesToolbar.classList.remove("hidden");
    completedHeader.classList.add("hidden");
    canvas.classList.remove("hidden");
    sharedNoteImage.classList.add("hidden");
    noteMemoDisplay.classList.add("hidden");
    canvasMemoFooter.classList.add("hidden");
    updateTimerUI();
    updateHistoryButtonsUI();
    return;
  }

  // 2) 완성되어 공유 중인 그림이 있는 경우
  if (state.sharedNote) {
    viewSelectUser.classList.add("hidden");
    viewPartnerDrawing.classList.add("hidden");
    viewWorkspace.classList.remove("hidden");
    drawingStatusCard.classList.add("hidden");
    goodnotesToolbar.classList.add("hidden");
    completedHeader.classList.remove("hidden");
    canvas.classList.add("hidden");
    sharedNoteImage.classList.remove("hidden");
    canvasMemoFooter.classList.remove("hidden");

    const note = state.sharedNote;
    const authorName = note.author === "A" ? state.profiles.A : state.profiles.B;
    completedAuthorBadge.textContent = authorName;
    completedAuthorBadge.className = `author-badge ${
      note.author === "A" ? "user-a" : "user-b"
    }`;
    completedDurationBadge.textContent = `${formatMinSec(
      note.durationSec || 0
    )} 동안 그리며 기다림`;
    completedDateText.textContent = formatDateTime(note.createdAt);
    completedTitleText.textContent = note.title || "무제";
    sharedNoteImage.src = note.imageDataUrl || "";

    if (note.memo && note.memo.trim() !== "") {
      noteMemoText.textContent = note.memo;
      noteMemoDisplay.classList.remove("hidden");
    } else {
      noteMemoText.textContent = "";
      noteMemoDisplay.classList.add("hidden");
    }
    return;
  }

  // 3) 상대방이 현재 그림을 그리는 중인 경우 -> "(상대)가 그림 그리는 중 ..." 대기 화면 표시
  if (state.activeDrawing && state.activeDrawing.deviceId !== DEVICE_ID) {
    viewSelectUser.classList.add("hidden");
    viewWorkspace.classList.add("hidden");
    viewPartnerDrawing.classList.remove("hidden");

    updatePartnerDrawingUI();
    partnerTimerInterval = setInterval(updatePartnerDrawingUI, 1000);
    return;
  }

  // 4) 아직 DB 초기 확인 전이라면 '너 누기야 !' 화면을 미리 띄우지 않고 대기
  if (!isInitialStateResolved) {
    viewSelectUser.classList.add("hidden");
    viewPartnerDrawing.classList.add("hidden");
    viewWorkspace.classList.add("hidden");
    return;
  }

  // 5) 아무도 그리는 중이 아니고 완성된 그림도 없을 때만 '너 누기야 !' 표시
  viewPartnerDrawing.classList.add("hidden");
  viewWorkspace.classList.add("hidden");
  viewSelectUser.classList.remove("hidden");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}