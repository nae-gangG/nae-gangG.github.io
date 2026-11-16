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

// 일정 마감 시간을 23시까지 확장
const START_HOUR = 9;
const END_HOUR = 23;
const SHORT_DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const PRESENCE_TIMEOUT_MS = 35000;
const HEARTBEAT_INTERVAL_MS = 12000;

// 사이트 패치 노트 기록 (새로운 업데이트마다 맨 위에 추가)
const PATCH_NOTES = [
  {
    version: "v1.3",
    date: "2026. 11. 16.",
    title: "'기다림의 노트' 추가",
    latest: true,
    items: [
      "기다리는 시간 측정 및 그림판 기능 추가",
      "볼펜·형광펜·지우개 도구 및 3단계 굵기, 색상 팔레트, 실행 취소(Undo/Redo) 지원",
      "그림 완성 시 제목과 기다린 시간 기록 및 새로 그리기 전까지 두 사용자 간 화면 공유",
      "완성된 그림에 메모 남기기 기능 및 누적 기다린 횟수 카운팅"
    ]
  },
  {
    version: "v1.2",
    date: "2026. 11. 16.",
    title: "스케줄러 편의성 개선 & 되돌리기(Undo) 추가",
    latest: true,
    items: [
      "일정 마감 시간 선택 범위를 기존 22:00에서 23:00까지 확장",
      "주간 이동 화살표(◀/▶)로 다른 주로 넘어간 상태에서 '이번 주에만 등록' 클릭 시 해당 주에 일정이 등록되도록 개선",
      "실수로 등록하거나 삭제한 직전 스케줄을 즉시 복구하는 '↩ 되돌리기(Undo)' 기능 추가 (전체 초기화 제거)",
      "스케줄 정보 모달의 [삭제하기]·[취소] 버튼 위치 맞교환 및 버튼 간격 확장",
      "사이드 메뉴 하단 '패치 노트' 열람 창 신설"
    ]
  },
  {
    version: "v1.1",
    date: "2026. 11. 15.",
    title: "모바일 웹앱(PWA) & 미니멀 시간표 리뉴얼",
    latest: false,
    items: [
      "아이폰(iOS) 및 갤럭시(Android) 홈 화면 바로가기 앱 설치 & 라이트 모드 고정 지원",
      "주간 스케줄 블록을 깔끔한 컬러 전용 블록으로 변경하고 터치 시 상세 '스케줄 정보' 창이 뜨도록 개선",
      "'예정된 강쥐지직 열람' 접이식 배너 도입 및 새로고침 시에도 접기·펼침 상태가 유지되도록 저장",
      "3단계 실시간 접속 배너('로컬 모드' / '혼자 접속 중...' / '둘 다 접속 중!!!') 적용"
    ]
  },
  {
    version: "v1.0",
    date: "2026. 11. 13.",
    title: "강쥐랑 승이 주간 스케줄러 오픈",
    latest: false,
    items: [
      "Blush Pink & Burgundy 테마 기반 주간 시간표 및 공통 공강 자동 도출 기능 구현",
      "고정 시간표 등록 및 일회성 주간 일정 등록 분리",
      "주기 설정 기반 '금주의 강쥐지직' 및 6주기 예측 캘린더 연동"
    ]
  }
];

function getHourHeight() {
  return window.innerWidth >= 960 ? 50 : 44;
}

function getDefaultLastPeriodDate() {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return formatDateYMD(d);
}

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

let state = {
  selectedUser: "A",
  profiles: {
    A: "강쥐",
    B: "승이"
  },
  schedules: [],
  cycleConfig: {
    lastStartDate: getDefaultLastPeriodDate(),
    cycleLength: 28,
    periodLength: 5
  }
};

// 새로고침이나 스케줄 추가/삭제 이벤트 시에도 접기·펼침 상태를 그대로 유지하기 위한 UI 상태
let uiState = {
  isScheduleFormOpen: false,
  isCycleCardOpen: false,
  isCycleConfigOpen: false,
  isCycleMoreOpen: false,
  showDerivedFreeTime: true
};

// 가장 최근 스케줄 작업 1건을 되돌리기(Undo) 위한 스냅샷
let lastScheduleSnapshot = null;

let currentWeekOffset = 0;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let pendingConfirmAction = null;
let deferredInstallPrompt = null;

let db = null;
let sharedDocRef = null;
let presenceDocRef = null;
let isCloudConnected = false;
let hasLoadedFromCloud = false;
let latestPresenceMap = {};

const LOCAL_STORAGE_KEY = "gangjwi_seungyi_schedule_v5";
const UI_STATE_STORAGE_KEY = "gangjwi_seungyi_ui_state_v1";

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

// 패치 노트 모달 DOM
const patchnotesModal = document.getElementById("patchnotes-modal");
const btnClosePatchnotes = document.getElementById("btn-close-patchnotes");
const patchnotesListEl = document.getElementById("patchnotes-list");

// 확인/정보 모달 DOM
const confirmModal = document.getElementById("confirm-modal");
const confirmModalTitle = document.getElementById("confirm-modal-title");
const confirmModalDesc = document.getElementById("confirm-modal-desc");
const btnConfirmCancel = document.getElementById("btn-confirm-cancel");
const btnConfirmOk = document.getElementById("btn-confirm-ok");

// 스케줄러 전용 DOM
const isSchedulerPage = Boolean(document.getElementById("timetable"));
const btnMobileFormToggle = document.getElementById("btn-mobile-form-toggle");
const scheduleFormCard = document.getElementById("schedule-form-card");
const selectUserABtn = document.getElementById("select-user-a");
const selectUserBBtn = document.getElementById("select-user-b");
const daySelect = document.getElementById("day-select");
const startTimeSelect = document.getElementById("start-time");
const endTimeSelect = document.getElementById("end-time");
const locationInput = document.getElementById("location-input");
const scheduleForm = document.getElementById("schedule-form");
const btnAddFixed = document.getElementById("btn-add-fixed");
const btnAddThisWeek = document.getElementById("btn-add-this-week");
const formError = document.getElementById("form-error");
const ttHeaderRowEl = document.getElementById("tt-header-row");
const ttCycleRowEl = document.getElementById("tt-cycle-row");
const timetableBodyEl = document.getElementById("timetable-body");
const btnToggleFreeView = document.getElementById("btn-toggle-free-view");
const btnUndo = document.getElementById("btn-undo");

// 예정된 강쥐지직 열람 접이식 배너 및 내부 DOM
const btnCycleCardToggle = document.getElementById("btn-cycle-card-toggle");
const cycleWeeklyCard = document.getElementById("cycle-weekly-card");
const btnToggleCycleConfig = document.getElementById("btn-toggle-cycle-config");
const cycleConfigPanel = document.getElementById("cycle-config-panel");
const cycleForm = document.getElementById("cycle-form");
const cycleLastDateInput = document.getElementById("cycle-last-date");
const cycleLengthInput = document.getElementById("cycle-length");
const periodLengthInput = document.getElementById("period-length");
const cycleDdayBadge = document.getElementById("cycle-dday-badge");
const cycleWeekTitle = document.getElementById("cycle-week-title");
const cycleStatusDesc = document.getElementById("cycle-status-desc");
const weeklyCycleIssuesEl = document.getElementById("weekly-cycle-issues");
const btnToggleCycleMore = document.getElementById("btn-toggle-cycle-more");
const cycleMorePanel = document.getElementById("cycle-more-panel");
const btnPrevMonth = document.getElementById("btn-prev-month");
const btnNextMonth = document.getElementById("btn-next-month");
const calMonthLabel = document.getElementById("cal-month-label");
const monthlyCalGrid = document.getElementById("monthly-cal-grid");
const upcomingCyclesList = document.getElementById("upcoming-cycles-list");

const btnPrevWeek = document.getElementById("btn-prev-week");
const btnThisWeek = document.getElementById("btn-this-week");
const btnNextWeek = document.getElementById("btn-next-week");
const currentWeekLabel = document.getElementById("current-week-label");

init();

function init() {
  loadUiState();
  renderPatchNotes();
  bindCommonEvents();
  if (isSchedulerPage) {
    populateTimeOptions();
    bindSchedulerEvents();
    applyUiState();
    updateUndoButtonUI();
  }
  initDataSync();
  if (isSchedulerPage) {
    syncCycleFormInputs();
  }
  renderAll();
  initPwaSupport();
}

// ==========================================
// 접기/펼침 UI 상태 저장 및 복원
// ==========================================
function loadUiState() {
  const saved = localStorage.getItem(UI_STATE_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      uiState = { ...uiState, ...parsed };
    } catch (e) {
      console.error(e);
    }
  }
}

function saveUiState() {
  localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(uiState));
}

function applyUiState() {
  if (!isSchedulerPage) return;

  if (scheduleFormCard && btnMobileFormToggle) {
    scheduleFormCard.classList.toggle("open", Boolean(uiState.isScheduleFormOpen));
    btnMobileFormToggle.textContent = uiState.isScheduleFormOpen
      ? "개인 스케줄 등록창 접기 ▴"
      : "+ 개인 스케줄 등록하기 ▾";
  }

  if (cycleWeeklyCard && btnCycleCardToggle) {
    cycleWeeklyCard.classList.toggle("hidden", !uiState.isCycleCardOpen);
    btnCycleCardToggle.textContent = uiState.isCycleCardOpen
      ? "예정된 강쥐지직 접기 ▴"
      : "예정된 강쥐지직 열람 ▾";
  }

  if (cycleConfigPanel && btnToggleCycleConfig) {
    cycleConfigPanel.classList.toggle("hidden", !uiState.isCycleConfigOpen);
    btnToggleCycleConfig.textContent = uiState.isCycleConfigOpen
      ? "설정 닫기"
      : "주기 설정";
  }

  if (cycleMorePanel && btnToggleCycleMore) {
    cycleMorePanel.classList.toggle("hidden", !uiState.isCycleMoreOpen);
    btnToggleCycleMore.textContent = uiState.isCycleMoreOpen
      ? "전체 일정 접기 ▴"
      : "전체 일정 더보기 ▾";
  }

  if (btnToggleFreeView) {
    btnToggleFreeView.classList.toggle("active", Boolean(uiState.showDerivedFreeTime));
    btnToggleFreeView.textContent = uiState.showDerivedFreeTime
      ? "공강 표시 켜짐"
      : "공강 표시 꺼짐";
  }
}

// ==========================================
// 패치 노트 렌더링 및 열람 모달
// ==========================================
function renderPatchNotes() {
  if (!patchnotesListEl) return;

  patchnotesListEl.innerHTML = PATCH_NOTES.map(
    (note) => `
      <div class="patch-card ${note.latest ? "latest" : ""}">
        <div class="patch-card-top">
          <span class="patch-version">${escapeHtml(note.version)}</span>
          <span class="patch-date">${escapeHtml(note.date)}</span>
        </div>
        <div class="patch-title">${escapeHtml(note.title)}</div>
        <ul class="patch-items">
          ${note.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
    `
  ).join("");
}

function openPatchnotesModal() {
  if (!patchnotesModal) return;
  patchnotesModal.classList.remove("hidden");
  pushOverlayState();
}

function closePatchnotesModal() {
  if (!patchnotesModal) return;
  patchnotesModal.classList.add("hidden");
}

function bindCommonEvents() {
  if (btnOpenDrawer) btnOpenDrawer.addEventListener("click", openDrawer);
  if (btnCloseDrawer) btnCloseDrawer.addEventListener("click", closeDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeDrawer);

  if (btnDrawerNickname) {
    btnDrawerNickname.addEventListener("click", () => {
      closeDrawer();
      openNicknameModal();
    });
  }

  if (btnDrawerPatchnotes) {
    btnDrawerPatchnotes.addEventListener("click", () => {
      closeDrawer();
      openPatchnotesModal();
    });
  }

  if (btnClosePatchnotes) {
    btnClosePatchnotes.addEventListener("click", closePatchnotesModal);
  }

  if (patchnotesModal) {
    patchnotesModal.addEventListener("click", (e) => {
      if (e.target === patchnotesModal) {
        closePatchnotesModal();
      }
    });
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener("click", () => {
      nicknameModal.classList.add("hidden");
    });
  }

  if (btnSaveNickname) {
    btnSaveNickname.addEventListener("click", () => {
      const nameA = inputNameA.value.trim() || "강쥐";
      const nameB = inputNameB.value.trim() || "승이";
      state.profiles = { A: nameA, B: nameB };
      nicknameModal.classList.add("hidden");
      saveData();
      renderAll();
    });
  }

  if (btnConfirmCancel) {
    btnConfirmCancel.addEventListener("click", closeConfirmModal);
  }
  if (btnConfirmOk) {
    btnConfirmOk.addEventListener("click", () => {
      const action = pendingConfirmAction;
      closeConfirmModal();
      if (typeof action === "function") {
        action();
      }
    });
  }

  window.addEventListener("popstate", () => {
    if (navDrawer && navDrawer.classList.contains("open")) {
      navDrawer.classList.remove("open");
      drawerBackdrop.classList.add("hidden");
      return;
    }
    if (patchnotesModal && !patchnotesModal.classList.contains("hidden")) {
      closePatchnotesModal();
      return;
    }
    if (nicknameModal && !nicknameModal.classList.contains("hidden")) {
      nicknameModal.classList.add("hidden");
      return;
    }
    if (confirmModal && !confirmModal.classList.contains("hidden")) {
      closeConfirmModal();
    }
  });

  window.addEventListener("online", () => {
    sendPresenceHeartbeat(true);
    updateSyncBadgeUI();
  });
  window.addEventListener("offline", () => {
    updateSyncBadgeUI();
  });
  window.addEventListener("focus", () => {
    sendPresenceHeartbeat(true);
  });
  window.addEventListener("pageshow", () => {
    sendPresenceHeartbeat(true);
  });

  window.addEventListener("resize", () => {
    if (isSchedulerPage) {
      renderTimetable(getWeekDates(currentWeekOffset));
    }
  });
}

function pushOverlayState() {
  if (window.history && window.history.pushState) {
    window.history.pushState({ overlayOpen: true }, "");
  }
}

// ==========================================
// 3단계 접속 상태 배너
// ==========================================
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

  const activeCount = Math.max(1, activeDevices.length);

  if (activeCount >= 2) {
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
      {
        devices: {
          [DEVICE_ID]: timestamp
        }
      },
      { merge: true }
    );
  } catch (err) {
    console.error("접속 상태 업데이트 오류:", err);
  }
}

function initPresenceTracking() {
  if (!db) {
    updateSyncBadgeUI();
    return;
  }

  presenceDocRef = doc(db, "couple_space", "presence_v2");

  onSnapshot(
    presenceDocRef,
    (snapshot) => {
      isCloudConnected = true;
      if (snapshot.exists()) {
        const data = snapshot.data();
        latestPresenceMap = data.devices || {};
      }
      updateSyncBadgeUI();
    },
    (err) => {
      console.error("동시 접속 감지 오류:", err);
      isCloudConnected = false;
      updateSyncBadgeUI();
    }
  );

  sendPresenceHeartbeat(true);

  setInterval(() => {
    if (document.visibilityState === "visible") {
      sendPresenceHeartbeat(true);
    } else {
      updateSyncBadgeUI();
    }
  }, HEARTBEAT_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      sendPresenceHeartbeat(true);
    } else {
      sendPresenceHeartbeat(false);
    }
  });

  window.addEventListener("pagehide", () => {
    sendPresenceHeartbeat(false);
  });
}

// ==========================================
// 실시간 Firebase Firestore DB 동기화 핵심 로직
// ==========================================
function initDataSync() {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.profiles = parsed.profiles || { A: "강쥐", B: "승이" };
      state.schedules = parsed.schedules || [];
      if (parsed.cycleConfig) {
        state.cycleConfig = parsed.cycleConfig;
      }
    } catch (e) {
      console.error(e);
    }
  }

  const isFirebaseConfigured = Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey.trim() !== "" &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId.trim() !== ""
  );

  if (isFirebaseConfigured) {
    try {
      const app = initializeApp(firebaseConfig);
      db = initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true
      });
      sharedDocRef = doc(db, "couple_space", "weekly_schedule_v5");

      onSnapshot(
        sharedDocRef,
        async (snapshot) => {
          isCloudConnected = true;
          hasLoadedFromCloud = true;
          updateSyncBadgeUI();

          if (snapshot.exists()) {
            const data = snapshot.data();
            state.profiles = data.profiles || { A: "강쥐", B: "승이" };
            state.schedules = data.schedules || [];
            if (data.cycleConfig) {
              state.cycleConfig = data.cycleConfig;
              if (isSchedulerPage) syncCycleFormInputs();
            }
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
            renderAll();
          } else {
            await saveData();
          }
        },
        (err) => {
          console.error("Firestore DB 읽기 오류:", err);
          isCloudConnected = false;
          updateSyncBadgeUI();
        }
      );

      initPresenceTracking();
      return;
    } catch (err) {
      console.error("Firebase 초기화 실패:", err);
    }
  }

  isCloudConnected = false;
  updateSyncBadgeUI();

  window.addEventListener("storage", (e) => {
    if (e.key === LOCAL_STORAGE_KEY && e.newValue) {
      const parsed = JSON.parse(e.newValue);
      state.profiles = parsed.profiles || { A: "강쥐", B: "승이" };
      state.schedules = parsed.schedules || [];
      if (parsed.cycleConfig) {
        state.cycleConfig = parsed.cycleConfig;
        if (isSchedulerPage) syncCycleFormInputs();
      }
      renderAll();
    }
  });
}

async function saveData() {
  const payload = {
    profiles: state.profiles,
    schedules: state.schedules,
    cycleConfig: state.cycleConfig,
    updatedAt: Date.now()
  };

  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));

  if (sharedDocRef && hasLoadedFromCloud) {
    try {
      await setDoc(sharedDocRef, payload);
    } catch (err) {
      console.error("실시간 DB 저장 오류:", err);
    }
  }
}

function openConfirmModal({ title, desc, bodyHtml, okText = "확인", onConfirm }) {
  if (!confirmModal) return;
  confirmModalTitle.textContent = title;
  if (bodyHtml) {
    confirmModalDesc.innerHTML = bodyHtml;
  } else {
    confirmModalDesc.textContent = desc || "";
  }
  btnConfirmOk.textContent = okText;
  pendingConfirmAction = onConfirm;
  confirmModal.classList.remove("hidden");
  pushOverlayState();
}

function closeConfirmModal() {
  if (!confirmModal) return;
  confirmModal.classList.add("hidden");
  pendingConfirmAction = null;
}

function openDrawer() {
  navDrawer.classList.add("open");
  drawerBackdrop.classList.remove("hidden");
  pushOverlayState();
}

function closeDrawer() {
  navDrawer.classList.remove("open");
  drawerBackdrop.classList.add("hidden");
}

function openNicknameModal() {
  inputNameA.value = state.profiles.A;
  inputNameB.value = state.profiles.B;
  nicknameModal.classList.remove("hidden");
  pushOverlayState();
}

function populateTimeOptions() {
  const times = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    const hh = String(h).padStart(2, "0");
    times.push(`${hh}:00`);
    if (h < END_HOUR) {
      times.push(`${hh}:30`);
    }
  }

  startTimeSelect.innerHTML = times
    .slice(0, -1)
    .map((t) => `<option value="${t}">${t}</option>`)
    .join("");

  endTimeSelect.innerHTML = times
    .slice(1)
    .map((t) => `<option value="${t}">${t}</option>`)
    .join("");

  startTimeSelect.value = "13:00";
  endTimeSelect.value = "15:00";
}

function syncCycleFormInputs() {
  cycleLastDateInput.value = state.cycleConfig.lastStartDate;
  cycleLengthInput.value = state.cycleConfig.cycleLength;
  periodLengthInput.value = state.cycleConfig.periodLength;
}

// ==========================================
// 가장 최근 작업 1건 되돌리기 (Undo / Ctrl+Z)
// ==========================================
function saveUndoSnapshot() {
  lastScheduleSnapshot = JSON.parse(JSON.stringify(state.schedules));
  updateUndoButtonUI();
}

function updateUndoButtonUI() {
  if (!btnUndo) return;
  btnUndo.disabled = !lastScheduleSnapshot;
}

function handleUndo() {
  if (!lastScheduleSnapshot) return;
  state.schedules = lastScheduleSnapshot;
  lastScheduleSnapshot = null;
  updateUndoButtonUI();
  saveData();
  renderAll();
}

function bindSchedulerEvents() {
  btnMobileFormToggle.addEventListener("click", () => {
    uiState.isScheduleFormOpen = !uiState.isScheduleFormOpen;
    saveUiState();
    applyUiState();
  });

  if (btnCycleCardToggle && cycleWeeklyCard) {
    btnCycleCardToggle.addEventListener("click", () => {
      uiState.isCycleCardOpen = !uiState.isCycleCardOpen;
      saveUiState();
      applyUiState();
    });
  }

  selectUserABtn.addEventListener("click", () => setSelectedUser("A"));
  selectUserBBtn.addEventListener("click", () => setSelectedUser("B"));

  locationInput.addEventListener("input", () => {
    formError.classList.add("hidden");
  });

  scheduleForm.addEventListener("submit", (e) => {
    e.preventDefault();
    handleAddSchedule("fixed");
  });

  btnAddFixed.addEventListener("click", () => {
    handleAddSchedule("fixed");
  });

  btnAddThisWeek.addEventListener("click", () => {
    handleAddSchedule("this_week");
  });

  // 되돌리기 버튼 클릭 이벤트 및 Ctrl+Z / Cmd+Z 단축키 지원
  if (btnUndo) {
    btnUndo.addEventListener("click", handleUndo);
  }

  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      if (lastScheduleSnapshot) {
        e.preventDefault();
        handleUndo();
      }
    }
  });

  btnToggleCycleConfig.addEventListener("click", () => {
    uiState.isCycleConfigOpen = !uiState.isCycleConfigOpen;
    saveUiState();
    applyUiState();
  });

  cycleForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const lastStartDate = cycleLastDateInput.value;
    const cycleLength = Math.min(45, Math.max(20, Number(cycleLengthInput.value) || 28));
    const periodLength = Math.min(10, Math.max(2, Number(periodLengthInput.value) || 5));

    if (!lastStartDate) return;

    state.cycleConfig = { lastStartDate, cycleLength, periodLength };
    saveData();
    renderAll();
  });

  btnToggleCycleMore.addEventListener("click", () => {
    uiState.isCycleMoreOpen = !uiState.isCycleMoreOpen;
    saveUiState();
    applyUiState();
  });

  btnToggleFreeView.addEventListener("click", () => {
    uiState.showDerivedFreeTime = !uiState.showDerivedFreeTime;
    saveUiState();
    applyUiState();
    renderAll();
  });

  btnPrevMonth.addEventListener("click", () => {
    calMonth--;
    if (calMonth < 0) {
      calMonth = 11;
      calYear--;
    }
    renderMonthlyCalendar();
  });

  btnNextMonth.addEventListener("click", () => {
    calMonth++;
    if (calMonth > 11) {
      calMonth = 0;
      calYear++;
    }
    renderMonthlyCalendar();
  });

  btnPrevWeek.addEventListener("click", () => {
    currentWeekOffset--;
    renderAll();
  });

  btnThisWeek.addEventListener("click", () => {
    currentWeekOffset = 0;
    renderAll();
  });

  btnNextWeek.addEventListener("click", () => {
    currentWeekOffset++;
    renderAll();
  });
}

function setSelectedUser(user) {
  state.selectedUser = user;
  selectUserABtn.classList.toggle("active", user === "A");
  selectUserBBtn.classList.toggle("active", user === "B");
}

// ==========================================
// 날짜 및 생리 주기 계산 유틸리티
// ==========================================
function parseDateYMD(ymdStr) {
  const [y, m, d] = ymdStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateYMD(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatShortMD(dateObj) {
  return `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
}

function addDays(dateObj, days) {
  const copy = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function diffDays(dateA, dateB) {
  const utcA = Date.UTC(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
  const utcB = Date.UTC(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());
  return Math.round((utcA - utcB) / (1000 * 60 * 60 * 24));
}

function getWeekDates(weekOffset = 0) {
  const today = new Date();
  const currentDay = today.getDay();
  const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  const monday = addDays(today, diffToMonday + weekOffset * 7);

  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push(addDays(monday, i));
  }
  return days;
}

// 현재 화면에서 보고 있는 주(currentWeekOffset 반영)의 월요일 날짜 Key 반환
function getViewedWeekKey() {
  const viewedMonday = getWeekDates(currentWeekOffset)[0];
  return formatDateYMD(viewedMonday);
}

function getCycleStatusForDate(targetDate) {
  const { lastStartDate, cycleLength, periodLength } = state.cycleConfig;
  if (!lastStartDate) return null;

  const baseStart = parseDateYMD(lastStartDate);
  const totalDiff = diffDays(targetDate, baseStart);

  const cycleIndex = Math.floor(totalDiff / cycleLength);
  const dayInCycle = totalDiff - cycleIndex * cycleLength;

  const ovulationOffset = cycleLength - 14;
  const fertileStart = ovulationOffset - 5;
  const fertileEnd = ovulationOffset + 2;
  const pmsStart = cycleLength - 4;

  if (dayInCycle >= 0 && dayInCycle < periodLength) {
    const dayNum = dayInCycle + 1;
    return {
      type: "period",
      label: `생리 ${dayNum}일째`
    };
  }

  if (dayInCycle === ovulationOffset) {
    return {
      type: "ovulation",
      label: "배란 예정일"
    };
  }

  if (dayInCycle >= fertileStart && dayInCycle <= fertileEnd) {
    return {
      type: "fertile",
      label: "가임기"
    };
  }

  if (dayInCycle >= pmsStart && dayInCycle < cycleLength) {
    return {
      type: "pms",
      label: "PMS 주의"
    };
  }

  return null;
}

function getUpcomingCycles(count = 6) {
  const { lastStartDate, cycleLength, periodLength } = state.cycleConfig;
  if (!lastStartDate) return [];

  const baseStart = parseDateYMD(lastStartDate);
  const today = new Date();
  const totalDiff = diffDays(today, baseStart);
  const startCycleIndex = Math.max(0, Math.floor(totalDiff / cycleLength));

  const list = [];
  for (let i = 0; i < count; i++) {
    const idx = startCycleIndex + i;
    const pStart = addDays(baseStart, idx * cycleLength);
    const pEnd = addDays(pStart, periodLength - 1);
    const nextPStart = addDays(pStart, cycleLength);
    const ovulDate = addDays(nextPStart, -14);
    const fStart = addDays(ovulDate, -5);
    const fEnd = addDays(ovulDate, 2);

    list.push({
      order: i === 0 ? "이번 주기" : `+${i}주기`,
      periodRange: `${formatShortMD(pStart)} ~ ${formatShortMD(pEnd)}`,
      fertileRange: `${formatShortMD(fStart)} ~ ${formatShortMD(fEnd)}`,
      ovulationDate: formatShortMD(ovulDate)
    });
  }
  return list;
}

// ==========================================
// 고정 스케줄 & 선택된 주 스케줄 등록/필터링 로직
// ==========================================
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function handleAddSchedule(mode = "fixed") {
  formError.classList.add("hidden");

  const day = Number(daySelect.value);
  const start = startTimeSelect.value;
  const end = endTimeSelect.value;
  const location = locationInput.value.trim();

  if (!location) {
    formError.textContent = "일정이나 머무르는 장소를 입력해 주세요.";
    formError.classList.remove("hidden");
    locationInput.focus();
    return;
  }

  if (timeToMinutes(start) >= timeToMinutes(end)) {
    formError.textContent = "마감 시간은 시작 시간보다 뒤여야 합니다.";
    formError.classList.remove("hidden");
    return;
  }

  // 다른 주로 이동한 상태에서 '이번 주에만 등록' 클릭 시 현재 보고 있는 그 주에 등록
  const weekKey = mode === "this_week" ? getViewedWeekKey() : null;

  const newEntry = {
    id: "sch_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    user: state.selectedUser,
    day,
    start,
    end,
    location,
    weekKey
  };

  // 작업 전 스냅샷 저장 (되돌리기 지원)
  saveUndoSnapshot();

  state.schedules.push(newEntry);
  locationInput.value = "";

  saveData();
  renderAll();
}

function deleteSchedule(id) {
  // 삭제 전 스냅샷 저장 (되돌리기 지원)
  saveUndoSnapshot();

  state.schedules = state.schedules.filter((item) => item.id !== id);
  saveData();
  renderAll();
}

function getSchedulesForWeek(day, viewedWeekKey) {
  return state.schedules.filter(
    (s) => s.day === day && (!s.weekKey || s.weekKey === viewedWeekKey)
  );
}

function deriveFreeSlotsForDay(day, viewedWeekKey) {
  const daySchedules = getSchedulesForWeek(day, viewedWeekKey);
  if (daySchedules.length === 0) return [];

  const dayStartMin = START_HOUR * 60;
  const dayEndMin = END_HOUR * 60;

  const busyIntervals = daySchedules
    .map((s) => ({
      start: Math.max(dayStartMin, timeToMinutes(s.start)),
      end: Math.min(dayEndMin, timeToMinutes(s.end))
    }))
    .filter((iv) => iv.start < iv.end)
    .sort((a, b) => a.start - b.start);

  const mergedBusy = [];
  for (const cur of busyIntervals) {
    if (mergedBusy.length === 0 || mergedBusy[mergedBusy.length - 1].end < cur.start) {
      mergedBusy.push({ ...cur });
    } else {
      mergedBusy[mergedBusy.length - 1].end = Math.max(
        mergedBusy[mergedBusy.length - 1].end,
        cur.end
      );
    }
  }

  const freeSlots = [];
  let cursor = dayStartMin;

  for (const busy of mergedBusy) {
    if (cursor < busy.start) {
      freeSlots.push({
        startMin: cursor,
        endMin: busy.start,
        start: minutesToTime(cursor),
        end: minutesToTime(busy.start)
      });
    }
    cursor = Math.max(cursor, busy.end);
  }

  if (cursor < dayEndMin) {
    freeSlots.push({
      startMin: cursor,
      endMin: dayEndMin,
      start: minutesToTime(cursor),
      end: minutesToTime(dayEndMin)
    });
  }

  return freeSlots;
}

// ==========================================
// 렌더링
// ==========================================
function renderAll() {
  renderProfileNames();
  if (!isSchedulerPage) return;

  applyUiState();
  const weekDates = getWeekDates(currentWeekOffset);
  renderWeeklyCycleSection(weekDates);
  renderMonthlyCalendar();
  renderUpcomingCyclesList();
  renderTimetable(weekDates);
}

function renderProfileNames() {
  document.querySelectorAll(".name-a").forEach((el) => {
    el.textContent = state.profiles.A;
  });
  document.querySelectorAll(".name-b").forEach((el) => {
    el.textContent = state.profiles.B;
  });
}

function renderWeeklyCycleSection(weekDates) {
  const today = new Date();
  const { lastStartDate, cycleLength } = state.cycleConfig;
  const baseStart = parseDateYMD(lastStartDate);
  const diff = diffDays(today, baseStart);
  const currentCycleIndex = Math.floor(diff / cycleLength);
  const nextPeriodDate = addDays(baseStart, (currentCycleIndex + 1) * cycleLength);
  const daysUntilNext = diffDays(nextPeriodDate, today);

  const todayStatus = getCycleStatusForDate(today);
  if (todayStatus && todayStatus.type === "period") {
    cycleDdayBadge.textContent = `현재 ${todayStatus.label}`;
  } else {
    cycleDdayBadge.textContent = `생리 예정 D-${daysUntilNext} (${formatShortMD(nextPeriodDate)})`;
  }

  const startStr = formatShortMD(weekDates[0]);
  const endStr = formatShortMD(weekDates[6]);
  cycleWeekTitle.textContent = `금주의 강쥐지직 (${startStr}~${endStr})`;

  const weekIssues = [];
  weekDates.forEach((d, idx) => {
    const status = getCycleStatusForDate(d);
    if (status) {
      weekIssues.push({
        date: d,
        dayName: SHORT_DAYS[idx],
        ...status
      });
    }
  });

  if (weekIssues.length === 0) {
    cycleStatusDesc.textContent = "선택된 주에는 예정된 생리나 가임기 일정이 없습니다.";
    weeklyCycleIssuesEl.innerHTML = `
      <div class="empty-box">이번 주에는 예정된 케어 일정이 없습니다.</div>
    `;
    return;
  }

  cycleStatusDesc.textContent = `총 ${weekIssues.length}일의 전기 고문 이슈가 있습니다.`;

  weeklyCycleIssuesEl.innerHTML = weekIssues
    .map(
      (item) => `
      <div class="weekly-issue-chip type-${item.type}">
        <span class="issue-chip-date">${formatShortMD(item.date)} (${item.dayName})</span>
        <span class="issue-chip-label">${item.label}</span>
      </div>
    `
    )
    .join("");
}

function renderMonthlyCalendar() {
  calMonthLabel.textContent = `${calYear}년 ${calMonth + 1}월`;

  const firstDay = new Date(calYear, calMonth, 1);
  const startDayOfWeek = firstDay.getDay();
  const gridStartDate = addDays(firstDay, -startDayOfWeek);
  const todayYMD = formatDateYMD(new Date());

  let html = "";
  for (let i = 0; i < 42; i++) {
    const cellDate = addDays(gridStartDate, i);
    const isOtherMonth = cellDate.getMonth() !== calMonth;
    const isToday = formatDateYMD(cellDate) === todayYMD;
    const status = getCycleStatusForDate(cellDate);

    const classes = ["cal-day"];
    if (isOtherMonth) classes.push("other-month");
    if (isToday) classes.push("today");
    if (status) classes.push(`type-${status.type}`);

    html += `
      <div class="${classes.join(" ")}" title="${status ? status.label : ""}">
        <span>${cellDate.getDate()}</span>
      </div>
    `;
  }

  monthlyCalGrid.innerHTML = html;
}

function renderUpcomingCyclesList() {
  const upcoming = getUpcomingCycles(6);
  upcomingCyclesList.innerHTML = upcoming
    .map(
      (c) => `
      <div class="upcoming-cycle-row">
        <span class="cycle-order-badge">${c.order}</span>
        <div class="cycle-row-details">
          <span><strong>생리 예정:</strong> ${c.periodRange}</span>
          <span><strong>가임기:</strong> ${c.fertileRange} (배란 ${c.ovulationDate})</span>
        </div>
      </div>
    `
    )
    .join("");
}

function renderTimetable(weekDates) {
  const hourHeight = getHourHeight();
  const startLabel = formatShortMD(weekDates[0]);
  const endLabel = formatShortMD(weekDates[6]);
  const viewedWeekKey = formatDateYMD(weekDates[0]);

  currentWeekLabel.textContent =
    currentWeekOffset === 0 ? `이번 주 (${startLabel}~${endLabel})` : `${startLabel}~${endLabel}`;

  // 1) 요일 + 날짜 헤더
  let headerHtml = `<div class="tt-time-col-header">시간</div>`;
  weekDates.forEach((d, idx) => {
    headerHtml += `
      <div class="tt-day-header">
        ${SHORT_DAYS[idx]}
        <span class="tt-day-date">${formatShortMD(d)}</span>
      </div>
    `;
  });
  ttHeaderRowEl.innerHTML = headerHtml;

  // 2) 주간 생리 이슈 행: 텍스트 없이 색상 바(bar)로만 표시
  let cycleRowHtml = `<div class="tt-cycle-label">케어</div>`;
  weekDates.forEach((d) => {
    const status = getCycleStatusForDate(d);
    if (status) {
      cycleRowHtml += `
        <div class="tt-cycle-cell" title="${status.label}">
          <span class="tt-cycle-bar type-${status.type}"></span>
        </div>
      `;
    } else {
      cycleRowHtml += `<div class="tt-cycle-cell"></div>`;
    }
  });
  ttCycleRowEl.innerHTML = cycleRowHtml;

  // 3) 시간표 본문
  const totalHours = END_HOUR - START_HOUR;
  const colHeight = totalHours * hourHeight;

  let timeColHtml = `<div class="tt-time-col" style="height:${colHeight}px">`;
  for (let h = START_HOUR; h < END_HOUR; h++) {
    timeColHtml += `<div class="tt-time-label">${String(h).padStart(2, "0")}</div>`;
  }
  timeColHtml += `</div>`;

  let daysHtml = "";
  for (let day = 0; day < 7; day++) {
    const daySchedules = getSchedulesForWeek(day, viewedWeekKey);
    const derivedFreeSlots = uiState.showDerivedFreeTime
      ? deriveFreeSlotsForDay(day, viewedWeekKey)
      : [];

    const freeHtml = derivedFreeSlots
      .map((slot) => {
        const startOffsetMin = slot.startMin - START_HOUR * 60;
        const durationMin = slot.endMin - slot.startMin;
        const topPx = (startOffsetMin / 60) * hourHeight;
        const heightPx = (durationMin / 60) * hourHeight;

        return `
          <div class="tt-free-slot" style="top:${topPx}px; height:${heightPx}px;">
            <span class="tt-free-badge">공강</span>
          </div>
        `;
      })
      .join("");

    const blocksHtml = daySchedules
      .map((item) => {
        const startOffsetMin = timeToMinutes(item.start) - START_HOUR * 60;
        const durationMin = timeToMinutes(item.end) - timeToMinutes(item.start);
        const topPx = (startOffsetMin / 60) * hourHeight;
        const heightPx = (durationMin / 60) * hourHeight;
        const blockClass = item.user === "A" ? "block-a" : "block-b";
        const onceClass = item.weekKey ? "block-once" : "";

        return `
          <div
            class="tt-block ${blockClass} ${onceClass}"
            style="top:${topPx}px; height:${heightPx}px;"
            data-id="${item.id}"
          ></div>
        `;
      })
      .join("");

    daysHtml += `<div class="tt-day-col" style="height:${colHeight}px">${freeHtml}${blocksHtml}</div>`;
  }

  timetableBodyEl.innerHTML = timeColHtml + daysHtml;

  // 블록 클릭 시 '스케줄 정보' 모달 표시
  timetableBodyEl.querySelectorAll(".tt-block").forEach((block) => {
    block.addEventListener("click", () => {
      const targetId = block.dataset.id;
      const targetItem = state.schedules.find((s) => s.id === targetId);
      if (!targetItem) return;

      const userName = targetItem.user === "A" ? state.profiles.A : state.profiles.B;
      const userBadgeClass = targetItem.user === "A" ? "user-a" : "user-b";
      const typeLabel = targetItem.weekKey
        ? `${startLabel}~${endLabel} 주간에만 등록된 일정`
        : "매주 고정 일정";

      const infoHtml = `
        <div class="schedule-info-card">
          <div class="schedule-info-row">
            <span class="schedule-info-label">등록자</span>
            <span class="info-user-badge ${userBadgeClass}">${escapeHtml(userName)}</span>
          </div>
          <div class="schedule-info-row">
            <span class="schedule-info-label">시간대</span>
            <span class="schedule-info-value">
              ${SHORT_DAYS[targetItem.day]}요일 ${targetItem.start} ~ ${targetItem.end}
              <span class="schedule-info-sub">${typeLabel}</span>
            </span>
          </div>
          <div class="schedule-info-row">
            <span class="schedule-info-label">장소 · 내용</span>
            <span class="schedule-info-value">${escapeHtml(targetItem.location)}</span>
          </div>
        </div>
      `;

      openConfirmModal({
        title: "스케줄 정보",
        bodyHtml: infoHtml,
        okText: "삭제하기",
        onConfirm: () => deleteSchedule(targetId)
      });
    });
  });
}

// ==========================================
// PWA 서비스워커 & 갤럭시(Android) + 아이폰(iOS) 홈 화면 설치 지원
// ==========================================
function initPwaSupport() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .catch((err) => console.error("서비스 워커 등록 실패:", err));
    });
  }

  const pwaToast = document.getElementById("pwa-toast");
  const pwaToastDesc = document.getElementById("pwa-toast-desc");
  const btnInstallPwa = document.getElementById("btn-install-pwa");
  const btnClosePwa = document.getElementById("btn-close-pwa-toast");

  if (!pwaToast) return;

  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isAndroid = /Android/i.test(ua);
  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  const isToastDismissed = localStorage.getItem("pwa-toast-dismissed") === "true";

  if (isStandalone || isToastDismissed) return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;

    pwaToastDesc.innerHTML =
      "홈 화면에 앱을 설치하면 언제든 한 번에 바로 열 수 있습니다.";
    btnInstallPwa.classList.remove("hidden");
    pwaToast.classList.remove("hidden");
  });

  if (btnInstallPwa) {
    btnInstallPwa.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === "accepted") {
        pwaToast.classList.add("hidden");
      }
      deferredInstallPrompt = null;
    });
  }

  window.addEventListener("appinstalled", () => {
    pwaToast.classList.add("hidden");
    deferredInstallPrompt = null;
  });

  setTimeout(() => {
    if (isStandalone || localStorage.getItem("pwa-toast-dismissed") === "true") return;

    if (isIOS) {
      pwaToastDesc.innerHTML =
        "아래 공유 버튼 <span class=\"ios-share-badge\">📤</span> 누른 뒤, <strong>'홈 화면에 추가'</strong>를 누르시오";
      btnInstallPwa.classList.add("hidden");
      pwaToast.classList.remove("hidden");
    } else if (isAndroid && !deferredInstallPrompt) {
      pwaToastDesc.innerHTML =
        "브라우저 메뉴 <span class=\"ios-share-badge\">⋮</span> 또는 <span class=\"ios-share-badge\">≡</span> 버튼을 누른 뒤, <strong>'홈 화면에 추가(앱 설치)'</strong>를 눌러주세요.";
      btnInstallPwa.classList.add("hidden");
      pwaToast.classList.remove("hidden");
    }
  }, 2200);

  if (btnClosePwa) {
    btnClosePwa.addEventListener("click", () => {
      pwaToast.classList.add("hidden");
      localStorage.setItem("pwa-toast-dismissed", "true");
    });
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}