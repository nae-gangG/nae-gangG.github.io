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

// 패치 노트 기록
const PATCH_NOTES = [
  {
    version: "v1.3",
    date: "2026. 11. 16.",
    title: "신규 서비스 1: '기다림의 노트' 오픈",
    latest: true,
    items: [
      "볼펜·형광펜·지우개 및 3단계 굵기·컬러 팔레트를 지원하는 드로잉 노트 구현",
      "사용자 선택 시 'm분 s초 동안 기다리는 중..' 실시간 타이머 작동 및 완성 시 제목·소요 시간 기록",
      "그림 완성 후 활성화되는 '그림 저장하기' 및 기기 자동 판별(iOS: 강쥐 / Android 외: 승이) 기반 누적 저장 횟수 DB 영구 카운팅"
    ]
  },
  {
    version: "v1.2",
    date: "2026. 11. 16.",
    title: "스케줄러 편의성 개선 & 되돌리기(Undo) 추가",
    latest: false,
    items: [
      "일정 마감 시간 선택 범위를 23:00까지 확장",
      "주간 이동 화살표로 넘어간 주에 '이번 주에만 등록'이 귀속되도록 개선",
      "직전 스케줄 작업을 복구하는 '↩ 되돌리기(Undo)' 및 '패치 노트' 열람 창 신설"
    ]
  }
];

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

/**
 * 기기 자동 판별:
 * - iOS 기기(아이폰/아이패드) 또는 A로 등록된 기기 -> 'A' (강쥐)
 * - 안드로이드(갤럭시) 등 그 외 모든 기기 -> 'B' (승이)
 */
function detectUserByDevice() {
  const ua = navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (isIOS) {
    localStorage.setItem("couple_registered_owner", "A");
    return "A";
  }

  if (localStorage.getItem("couple_registered_owner") === "A") {
    return "A";
  }

  return "B";
}

// 애플리케이션 상태
let state = {
  profiles: {
    A: "강쥐",
    B: "승이"
  },
  captureCounts: {
    A: 0,
    B: 0
  },
  sharedNote: null // { title, author: 'A'|'B', durationSec, imageDataUrl, createdAt }
};

// 로컬 그리기 세션 상태
let drawingSession = {
  isDrawingMode: false,
  activeUser: "A",
  startTimeMs: 0,
  elapsedSec: 0,
  timerInterval: null,
  tool: "ballpoint", // 'ballpoint' | 'highlighter' | 'eraser'
  sizeKey: "medium", // 'thin' | 'medium' | 'thick'
  color: "#1E1B18",
  strokes: [],
  redoStack: [],
  currentStroke: null,
  isPointerDown: false
};

let db = null;
let scheduleDocRef = null;
let noteDocRef = null;
let presenceDocRef = null;
let isCloudConnected = false;
let hasLoadedNoteDoc = false;
let latestPresenceMap = {};
let pendingConfirmAction = null;

const LOCAL_NOTE_CACHE_KEY = "gangjwi_seungyi_waiting_note_v1";
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
const captureCountAEl = document.getElementById("capture-count-a");
const captureCountBEl = document.getElementById("capture-count-b");
const viewSelectUser = document.getElementById("view-select-user");
const viewWorkspace = document.getElementById("view-workspace");
const btnStartUserA = document.getElementById("btn-start-user-a");
const btnStartUserB = document.getElementById("btn-start-user-b");

const drawingHeader = document.getElementById("drawing-header");
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

const canvasSaveFooter = document.getElementById("canvas-save-footer");
const btnSaveNote = document.getElementById("btn-save-note");
const shutterFlash = document.getElementById("shutter-flash");

const completeModal = document.getElementById("complete-modal");
const completeTimeSummary = document.getElementById("complete-time-summary");
const completeForm = document.getElementById("complete-form");
const noteTitleInput = document.getElementById("note-title-input");
const titleError = document.getElementById("title-error");
const btnCancelComplete = document.getElementById("btn-cancel-complete");

init();

function init() {
  renderPatchNotes();
  bindCommonEvents();
  bindNoteEvents();
  bindCanvasDrawingEvents();
  initDataSync();
  renderAll();
}

// ==========================================
// 1. 시간 포맷 유틸리티 ("m분 s초")
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

// ==========================================
// 2. Firebase 실시간 DB 연동 & 접속자 배너
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
      if (parsed.captureCounts) state.captureCounts = parsed.captureCounts;
      if (parsed.sharedNote !== undefined) state.sharedNote = parsed.sharedNote;
    } catch (e) {
      console.error(e);
    }
  }

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
        }
      }
    });

    onSnapshot(
      noteDocRef,
      async (snapshot) => {
        isCloudConnected = true;
        hasLoadedNoteDoc = true;
        updateSyncBadgeUI();

        if (snapshot.exists()) {
          const data = snapshot.data();
          state.captureCounts = data.captureCounts || { A: 0, B: 0 };
          state.sharedNote = data.sharedNote || null;

          renderCaptureCounts();
          if (!drawingSession.isDrawingMode) {
            renderAll();
          }

          localStorage.setItem(
            LOCAL_NOTE_CACHE_KEY,
            JSON.stringify({
              captureCounts: state.captureCounts,
              sharedNote: state.sharedNote
            })
          );
        } else {
          await saveNoteData();
        }
      },
      (err) => {
        console.error("기다림의 노트 DB 읽기 오류:", err);
        isCloudConnected = false;
        updateSyncBadgeUI();
      }
    );

    initPresenceTracking();
  } catch (err) {
    console.error("Firebase 연결 실패:", err);
    isCloudConnected = false;
    updateSyncBadgeUI();
  }
}

async function saveNoteData() {
  const payload = {
    captureCounts: state.captureCounts,
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
// 3. 사용자 선택 & 기다림 타이머 & 노트 완성/새로 그리기
// ==========================================
function startWaitingAndDrawing(userKey) {
  drawingSession.isDrawingMode = true;
  drawingSession.activeUser = userKey;
  drawingSession.startTimeMs = Date.now();
  drawingSession.elapsedSec = 0;
  drawingSession.strokes = [];
  drawingSession.redoStack = [];

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
}

function stopWaitingTimer() {
  if (drawingSession.timerInterval) {
    clearInterval(drawingSession.timerInterval);
    drawingSession.timerInterval = null;
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

function openCompleteModal() {
  drawingSession.elapsedSec = Math.max(
    1,
    Math.floor((Date.now() - drawingSession.startTimeMs) / 1000)
  );
  stopWaitingTimer();

  const userName =
    drawingSession.activeUser === "A" ? state.profiles.A : state.profiles.B;
  completeTimeSummary.textContent = `${userName}님이 ${formatMinSec(
    drawingSession.elapsedSec
  )} 동안 그리며 기다렸어요.`;
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

  // 흰 배경이 포함된 경량 이미지 DataURL 생성
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exCtx = exportCanvas.getContext("2d");
  exCtx.fillStyle = "#FFFFFF";
  exCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  exCtx.drawImage(canvas, 0, 0);

  const imageDataUrl = exportCanvas.toDataURL("image/webp", 0.85);

  state.sharedNote = {
    title,
    author: drawingSession.activeUser,
    durationSec: drawingSession.elapsedSec,
    imageDataUrl,
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
// 4. 캔버스 드로잉 엔진 (볼펜 / 형광펜 / 지우개)
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
// 5. 기기 자동 추적 기반 그림 저장 카운팅 (완성 이후에만 활성화)
// ==========================================
async function triggerNoteSave(downloadImage = true) {
  // 그림이 완성된 공유 상태일 때만 작동
  if (!state.sharedNote || drawingSession.isDrawingMode) return;

  // 1) 화면 플래시 효과
  if (shutterFlash) {
    shutterFlash.classList.remove("hidden");
    setTimeout(() => {
      shutterFlash.classList.add("hidden");
    }, 360);
  }

  // 2) 접속 기기(iOS -> A, 그 외 안드로이드 등 -> B)를 자동 판별하여 저장 횟수 +1
  const userKey = detectUserByDevice();
  state.captureCounts[userKey] = (Number(state.captureCounts[userKey]) || 0) + 1;
  renderCaptureCounts();
  await saveNoteData();

  // 3) 제목·그린 사람·기다린 시간이 포함된 이미지 저장
  if (downloadImage) {
    exportSavedImageWithStamp();
  }
}

function exportSavedImageWithStamp() {
  if (!state.sharedNote) return;

  const outCanvas = document.createElement("canvas");
  const w = 1080;
  const h = 1280;
  outCanvas.width = w;
  outCanvas.height = h;
  const oCtx = outCanvas.getContext("2d");

  oCtx.fillStyle = "#FFF9FA";
  oCtx.fillRect(0, 0, w, h);

  oCtx.fillStyle = "#FFFFFF";
  oCtx.strokeStyle = "#F4C2C2";
  oCtx.lineWidth = 4;
  oCtx.fillRect(40, 150, w - 80, h - 210);
  oCtx.strokeRect(40, 150, w - 80, h - 210);

  const authorKey = state.sharedNote.author;
  const authorName = authorKey === "A" ? state.profiles.A : state.profiles.B;
  const durationSec = state.sharedNote.durationSec || 0;
  const titleText = state.sharedNote.title || "기다림의 노트";

  oCtx.fillStyle = "#800020";
  oCtx.font = "800 36px Pretendard, sans-serif";
  oCtx.fillText(titleText, 44, 78);

  oCtx.fillStyle = "#7D5A62";
  oCtx.font = "700 24px Pretendard, sans-serif";
  oCtx.fillText(
    `${authorName} · ${formatMinSec(durationSec)} 동안 그리며 기다림`,
    44,
    118
  );

  if (sharedNoteImage.complete && sharedNoteImage.naturalWidth > 0) {
    oCtx.drawImage(sharedNoteImage, 48, 158, w - 96, h - 226);
  }

  const link = document.createElement("a");
  link.download = `기다림의노트_${titleText}.png`;
  link.href = outCanvas.toDataURL("image/png");
  link.click();
}

// ==========================================
// 6. 이벤트 바인딩 & 전체 렌더링
// ==========================================
function bindNoteEvents() {
  btnStartUserA.addEventListener("click", () => startWaitingAndDrawing("A"));
  btnStartUserB.addEventListener("click", () => startWaitingAndDrawing("B"));

  btnCancelDrawing.addEventListener("click", () => {
    stopWaitingTimer();
    drawingSession.isDrawingMode = false;
    renderAll();
  });

  btnFinishDrawing.addEventListener("click", openCompleteModal);
  btnCancelComplete.addEventListener("click", resumeDrawingFromCompleteModal);
  completeForm.addEventListener("submit", handleCompleteSubmit);
  noteTitleInput.addEventListener("input", () => titleError.classList.add("hidden"));

  // 새로 그리기 버튼
  btnDeleteNote.addEventListener("click", () => {
    openConfirmModal({
      title: "새로 그리기",
      desc: "현재 공유된 그림과 기록을 지우고 새로 그릴까요? (누적 저장 횟수는 그대로 유지됩니다.)",
      okText: "새로 그리기",
      onConfirm: async () => {
        state.sharedNote = null;
        drawingSession.isDrawingMode = false;
        await saveNoteData();
        renderAll();
      }
    });
  });

  // 툴바: 도구 선택 (볼펜 / 형광펜 / 지우개)
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

  // 완성 후 활성화되는 '그림 저장하기' 버튼
  btnSaveNote.addEventListener("click", () => triggerNoteSave(true));

  // 완성 화면에서 키보드 PrintScreen 감지 시에도 자동 기기 판별 카운트
  window.addEventListener("keyup", (e) => {
    if (e.key === "PrintScreen") {
      triggerNoteSave(false);
    }
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
      await saveProfileNicknames();
    });
  }

  if (btnDrawerPatchnotes) {
    btnDrawerPatchnotes.addEventListener("click", () => {
      closeDrawer();
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

function renderPatchNotes() {
  if (!patchnotesListEl) return;
  patchnotesListEl.innerHTML = PATCH_NOTES.map(
    (note) => `
      <div class="patch-card ${note.latest ? "latest" : ""}">
        <div class="patch-card-top">
          <span class="patch-version">${note.version}</span>
          <span class="patch-date">${note.date}</span>
        </div>
        <div class="patch-title">${note.title}</div>
        <ul class="patch-items">
          ${note.items.map((item) => `<li>${item}</li>`).join("")}
        </ul>
      </div>
    `
  ).join("");
}

function renderProfileNames() {
  document.querySelectorAll(".name-a").forEach((el) => {
    el.textContent = state.profiles.A;
  });
  document.querySelectorAll(".name-b").forEach((el) => {
    el.textContent = state.profiles.B;
  });
}

function renderCaptureCounts() {
  if (captureCountAEl) {
    captureCountAEl.textContent = `${state.captureCounts.A || 0}회`;
  }
  if (captureCountBEl) {
    captureCountBEl.textContent = `${state.captureCounts.B || 0}회`;
  }
}

function renderAll() {
  renderProfileNames();
  renderCaptureCounts();

  // 1) 현재 그리는 중인 경우 (저장 버튼 비활성/숨김)
  if (drawingSession.isDrawingMode) {
    viewSelectUser.classList.add("hidden");
    viewWorkspace.classList.remove("hidden");
    drawingHeader.classList.remove("hidden");
    completedHeader.classList.add("hidden");
    goodnotesToolbar.classList.remove("hidden");
    canvas.classList.remove("hidden");
    sharedNoteImage.classList.add("hidden");
    canvasSaveFooter.classList.add("hidden");
    updateTimerUI();
    updateHistoryButtonsUI();
    return;
  }

  // 2) 완성되어 공유 중인 그림이 있는 경우 ('그림 저장하기' 활성화)
  if (state.sharedNote) {
    viewSelectUser.classList.add("hidden");
    viewWorkspace.classList.remove("hidden");
    drawingHeader.classList.add("hidden");
    completedHeader.classList.remove("hidden");
    goodnotesToolbar.classList.add("hidden");
    canvas.classList.add("hidden");
    sharedNoteImage.classList.remove("hidden");
    canvasSaveFooter.classList.remove("hidden");

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
    return;
  }

  // 3) 공유된 그림이 없고 대기 중인 초기 상태 -> 중앙 사용자 선택 화면 표시
  viewSelectUser.classList.remove("hidden");
  viewWorkspace.classList.add("hidden");
}