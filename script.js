import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore,
  doc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * [실시간 동기화 설정]
 * Firebase 프로젝트 키를 입력하면 두 사람의 기기(갤럭시 & 아이폰)가 실시간 연동됩니다.
 */
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

const START_HOUR = 9;
const END_HOUR = 22;
const SHORT_DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const PRESENCE_TIMEOUT_MS = 35000;
const HEARTBEAT_INTERVAL_MS = 15000;

function getHourHeight() {
  return window.innerWidth >= 960 ? 50 : 44;
}

function getDefaultLastPeriodDate() {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return formatDateYMD(d);
}

function getOrCreateSessionId() {
  const key = "couple_session_id_v1";
  let sid = sessionStorage.getItem(key);
  if (!sid) {
    sid = "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    sessionStorage.setItem(key, sid);
  }
  return sid;
}

const SESSION_ID = getOrCreateSessionId();

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

let showDerivedFreeTime = true;
let currentWeekOffset = 0;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let pendingConfirmAction = null;
let deferredInstallPrompt = null; // 갤럭시(Android) 원클릭 PWA 설치 이벤트 저장용

let db = null;
let sharedDocRef = null;
let presenceDocRef = null;
let latestPresenceMap = { [SESSION_ID]: Date.now() };

const LOCAL_STORAGE_KEY = "gangjwi_seungyi_schedule_v5";

// 공통 DOM
const btnOpenDrawer = document.getElementById("btn-open-drawer");
const btnCloseDrawer = document.getElementById("btn-close-drawer");
const navDrawer = document.getElementById("nav-drawer");
const drawerBackdrop = document.getElementById("drawer-backdrop");
const btnDrawerNickname = document.getElementById("btn-drawer-nickname");

const syncStatusEl = document.getElementById("sync-status");
const syncTextEl = document.getElementById("sync-text");
const nicknameModal = document.getElementById("nickname-modal");
const btnCloseModal = document.getElementById("btn-close-modal");
const btnSaveNickname = document.getElementById("btn-save-nickname");
const inputNameA = document.getElementById("input-name-a");
const inputNameB = document.getElementById("input-name-b");

// 확인 모달 DOM
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
const btnClearAll = document.getElementById("btn-clear-all");

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
  bindCommonEvents();
  if (isSchedulerPage) {
    populateTimeOptions();
    bindSchedulerEvents();
  }
  initDataSync();
  if (isSchedulerPage) {
    syncCycleFormInputs();
  }
  renderAll();
  initPwaSupport();
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

  // 갤럭시(Android) 뒤로가기 제스처/버튼을 눌렀을 때 앱이 꺼지지 않고 열린 메뉴/모달만 닫히도록 처리
  window.addEventListener("popstate", () => {
    if (navDrawer && navDrawer.classList.contains("open")) {
      navDrawer.classList.remove("open");
      drawerBackdrop.classList.add("hidden");
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

  // 와이파이 / 셀룰러 데이터 연결 및 갤럭시 화면 켜짐(focus/pageshow) 즉시 반영
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

// 오버레이 열릴 때 히스토리 스택을 1칸 추가해 갤럭시 뒤로가기 제스처를 가로챔
function pushOverlayState() {
  if (window.history && window.history.pushState) {
    window.history.pushState({ overlayOpen: true }, "");
  }
}

// ==========================================
// 3단계 접속 상태 배너 (갤럭시/아이폰 셀룰러 & 와이파이 공용)
// ==========================================
function updateSyncBadgeUI() {
  if (!syncStatusEl || !syncTextEl) return;

  syncStatusEl.classList.remove("mode-local", "mode-alone", "mode-both");

  if (navigator.onLine === false) {
    syncStatusEl.classList.add("mode-local");
    syncTextEl.textContent = "로컬 모드";
    return;
  }

  const now = Date.now();
  latestPresenceMap[SESSION_ID] = now;

  const activeSessions = Object.entries(latestPresenceMap).filter(
    ([, lastSeen]) => typeof lastSeen === "number" && now - lastSeen < PRESENCE_TIMEOUT_MS
  );

  if (activeSessions.length >= 2) {
    syncStatusEl.classList.add("mode-both");
    syncTextEl.textContent = "둘 다 접속 중!!!";
  } else {
    syncStatusEl.classList.add("mode-alone");
    syncTextEl.textContent = "혼자 접속 중...";
  }
}

async function sendPresenceHeartbeat(isActive = true) {
  latestPresenceMap[SESSION_ID] = isActive ? Date.now() : 0;
  updateSyncBadgeUI();

  if (!presenceDocRef || navigator.onLine === false) return;

  try {
    await setDoc(
      presenceDocRef,
      {
        sessions: {
          [SESSION_ID]: isActive ? Date.now() : 0
        }
      },
      { merge: true }
    );
  } catch (err) {
    console.error("접속 상태 업데이트 오류:", err);
  }
}

function initPresenceTracking() {
  updateSyncBadgeUI();

  if (db) {
    presenceDocRef = doc(db, "couple_space", "presence_v1");

    onSnapshot(
      presenceDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          latestPresenceMap = {
            ...(data.sessions || {}),
            [SESSION_ID]: Date.now()
          };
        }
        updateSyncBadgeUI();
      },
      () => {
        updateSyncBadgeUI();
      }
    );

    sendPresenceHeartbeat(true);
  }

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

function openConfirmModal({ title, desc, okText = "확인", onConfirm }) {
  if (!confirmModal) return;
  confirmModalTitle.textContent = title;
  confirmModalDesc.textContent = desc;
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

  const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

  if (isFirebaseConfigured) {
    try {
      const app = initializeApp(firebaseConfig);
      db = initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true
      });
      sharedDocRef = doc(db, "couple_space", "weekly_schedule_v5");

      onSnapshot(
        sharedDocRef,
        (snapshot) => {
          updateSyncBadgeUI();
          if (snapshot.exists()) {
            const data = snapshot.data();
            state.profiles = data.profiles || { A: "강쥐", B: "승이" };
            state.schedules = data.schedules || [];
            if (data.cycleConfig) {
              state.cycleConfig = data.cycleConfig;
              if (isSchedulerPage) syncCycleFormInputs();
            }
            renderAll();
          }
        },
        () => {
          updateSyncBadgeUI();
        }
      );
    } catch (err) {
      console.error("Firebase 초기화 실패:", err);
    }
  }

  initPresenceTracking();

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

  if (sharedDocRef && navigator.onLine) {
    try {
      await setDoc(sharedDocRef, payload);
    } catch (err) {
      console.error("실시간 저장 오류:", err);
    }
  }
}

function bindSchedulerEvents() {
  btnMobileFormToggle.addEventListener("click", () => {
    const isOpen = scheduleFormCard.classList.toggle("open");
    btnMobileFormToggle.textContent = isOpen
      ? "개인 스케줄 등록창 접기 ▴"
      : "+ 개인 스케줄 등록하기 ▾";
  });

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

  btnToggleCycleConfig.addEventListener("click", () => {
    const isHidden = cycleConfigPanel.classList.toggle("hidden");
    btnToggleCycleConfig.textContent = isHidden ? "주기 설정" : "설정 닫기";
  });

  cycleForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const lastStartDate = cycleLastDateInput.value;
    const cycleLength = Math.min(45, Math.max(20, Number(cycleLengthInput.value) || 28));
    const periodLength = Math.min(10, Math.max(2, Number(periodLengthInput.value) || 5));

    if (!lastStartDate) return;

    state.cycleConfig = { lastStartDate, cycleLength, periodLength };
    cycleConfigPanel.classList.add("hidden");
    btnToggleCycleConfig.textContent = "주기 설정";
    saveData();
    renderAll();
  });

  btnToggleCycleMore.addEventListener("click", () => {
    const isHidden = cycleMorePanel.classList.toggle("hidden");
    btnToggleCycleMore.textContent = isHidden
      ? "전체 일정 더보기 ▾"
      : "전체 일정 접기 ▴";
  });

  btnToggleFreeView.addEventListener("click", () => {
    showDerivedFreeTime = !showDerivedFreeTime;
    btnToggleFreeView.classList.toggle("active", showDerivedFreeTime);
    btnToggleFreeView.textContent = showDerivedFreeTime
      ? "공강 표시 켜짐"
      : "공강 표시 꺼짐";
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

  btnClearAll.addEventListener("click", () => {
    openConfirmModal({
      title: "시간표 전체 초기화",
      desc: "고정 시간표와 이번 주 일정을 모두 초기화할까요?",
      okText: "전체 초기화",
      onConfirm: () => {
        state.schedules = [];
        saveData();
        renderAll();
      }
    });
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

function getRealTimeThisWeekKey() {
  const thisWeekMonday = getWeekDates(0)[0];
  return formatDateYMD(thisWeekMonday);
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
// 고정 스케줄 & 이번 주 스케줄 등록/필터링 로직
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

  const weekKey = mode === "this_week" ? getRealTimeThisWeekKey() : null;

  const newEntry = {
    id: "sch_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    user: state.selectedUser,
    day,
    start,
    end,
    location,
    weekKey
  };

  state.schedules.push(newEntry);
  locationInput.value = "";

  if (mode === "this_week" && currentWeekOffset !== 0) {
    currentWeekOffset = 0;
  }

  if (window.innerWidth < 960) {
    scheduleFormCard.classList.remove("open");
    btnMobileFormToggle.textContent = "+ 개인 스케줄 등록하기 ▾";
  }

  saveData();
  renderAll();
}

function deleteSchedule(id) {
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
    const derivedFreeSlots = showDerivedFreeTime
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
            <span class="tt-free-badge">공강<br>${slot.start}~${slot.end}</span>
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
        const userName = item.user === "A" ? state.profiles.A : state.profiles.B;
        const blockClass = item.user === "A" ? "block-a" : "block-b";
        const onceClass = item.weekKey ? "block-once" : "";

        return `
          <div
            class="tt-block ${blockClass} ${onceClass}"
            style="top:${topPx}px; height:${heightPx}px;"
            data-id="${item.id}"
          >
            <div class="block-title">${escapeHtml(userName)}</div>
            <div class="block-place">${escapeHtml(item.location)}</div>
          </div>
        `;
      })
      .join("");

    daysHtml += `<div class="tt-day-col" style="height:${colHeight}px">${freeHtml}${blocksHtml}</div>`;
  }

  timetableBodyEl.innerHTML = timeColHtml + daysHtml;

  timetableBodyEl.querySelectorAll(".tt-block").forEach((block) => {
    block.addEventListener("click", () => {
      const targetId = block.dataset.id;
      const targetItem = state.schedules.find((s) => s.id === targetId);
      if (!targetItem) return;

      const userName = targetItem.user === "A" ? state.profiles.A : state.profiles.B;
      const typeLabel = targetItem.weekKey ? "이번 주만 등록된 일정" : "매주 고정 일정";

      openConfirmModal({
        title: "스케줄 삭제",
        desc: `[${userName}] ${SHORT_DAYS[targetItem.day]}요일 ${targetItem.start}~${targetItem.end} (${targetItem.location} · ${typeLabel})을 삭제할까요?`,
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

  // 이미 홈 화면 앱으로 실행 중이거나 닫기를 누른 경우 표시하지 않음
  if (isStandalone || isToastDismissed) return;

  // 1) 갤럭시(Android): 크롬/삼성 인터넷 원클릭 설치 이벤트 감지
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

  // 앱 설치 완료 시 토스트 즉시 숨김
  window.addEventListener("appinstalled", () => {
    pwaToast.classList.add("hidden");
    deferredInstallPrompt = null;
  });

  // 2) iOS 사파리 또는 갤럭시 수동 설치(인앱 브라우저 등) 안내
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