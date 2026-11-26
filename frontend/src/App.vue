<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { api, reportEvent } from "./api";
import { useLearningStore } from "./stores/learning";
const store = useLearningStore(),
  view = ref("home"),
  unit = ref(0),
  cursor = ref(0),
  answer = ref(""),
  memoryAnswer = ref(""),
  feedback = ref(""),
  showExample = ref(false),
  completed = ref(false),
  inputRef = ref(null),
  memoryInputRef = ref(null),
  timer = ref(null),
  cardShake = ref(false),
  runAllCorrect = ref(true),
  rewardMessage = ref(""),
  runWrongWords = ref([]),
  settling = ref(false),
  leaderboardOpen = ref(false),
  leaderboard = ref([]),
  leaderboardPage = ref(1),
  leaderboardPages = ref(1),
  gameInput = ref(""),
  gameInputRef = ref(null),
  gameSeconds = ref(180),
  gameMonsters = ref([]),
  gameStatus = ref("idle"),
  gameMessage = ref(""),
  gameInterval = ref(null),
  cannonShake = ref(false),
  gameAreaRef = ref(null),
  gameShot = ref(null),
  gameFiring = ref(false),
  pkChallenges = ref([]),
  pkCreateOpen = ref(false),
  pkError = ref(""),
  pkForm = ref({
    name: "",
    libraryId: "",
    startAt: "",
    endAt: "",
    wordCount: 20,
  }),
  pkDetail = ref(null),
  pkWords = ref([]),
  pkStage = ref("quiz"),
  pkCursor = ref(0),
  pkAnswer = ref(""),
  pkFeedback = ref(""),
  pkChoices = ref([]),
  pkStartedAt = ref(null),
  pkElapsed = ref(0),
  pkClock = ref(null),
  pkQuestionSeconds = ref(30),
  pkQuestionClock = ref(null),
  pkSkipTimer = ref(null),
  pkInputRef = ref(null),
  pkFinished = ref(null);
const pkPage = ref(1), pkPages = ref(1);
async function changePkPage(page) { pkPage.value = page; await loadPkChallenges(); }
async function deletePkChallenge(item) {
  if (!confirm(`删除挑战“${item.name}”及其成绩？`)) return;
  try { await api.delete(`/pk-challenges/${item.id}`); await loadPkChallenges(); }
  catch (e) { alert(e.response?.data?.message || "删除失败"); }
}
const notes = ref([]), notePage = ref(1), notePages = ref(1), noteError = ref(""), noteBusy = ref(false);
const note = ref(null), noteEditing = ref(false), noteEditor = ref(null);
async function loadNotes(page = 1) {
  try {
    const { data } = await api.get("/notes", { params: { page } });
    notes.value = data.items; notePage.value = page; notePages.value = data.pages;
    if (page > data.pages) return loadNotes(data.pages);
  } catch (e) { noteError.value = e.response?.data?.message || "读取笔记失败"; }
}
async function openNotebook() { view.value = "notebook"; note.value = null; noteError.value = ""; await loadNotes(); }
async function openNote(item, editing = false) {
  noteError.value = "";
  try {
    note.value = item ? (await api.get(`/notes/${item.id}`)).data : { title: "", content: "" };
    noteEditing.value = editing;
    await nextTick();
    if (editing && noteEditor.value) noteEditor.value.innerHTML = note.value.content;
  } catch (e) { noteError.value = e.response?.data?.message || "读取笔记失败"; }
}
function formatNote(command, value = null) { document.execCommand(command, false, value); noteEditor.value?.focus(); }
function pasteNote(event) { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); }
async function saveNote() {
  if (noteBusy.value) return;
  noteBusy.value = true; noteError.value = "";
  try {
    const body = { title: note.value.title, content: noteEditor.value.innerHTML };
    if (note.value.id) await api.put(`/notes/${note.value.id}`, body);
    else await api.post("/notes", body);
    note.value = null; await loadNotes(notePage.value);
  } catch (e) { noteError.value = e.response?.data?.message || "保存失败"; }
  finally { noteBusy.value = false; }
}
async function deleteNote(item) {
  if (!confirm(`删除笔记“${item.title}”？`)) return;
  try { await api.delete(`/notes/${item.id}`); note.value = null; await loadNotes(notePage.value); }
  catch (e) { noteError.value = e.response?.data?.message || "删除失败"; }
}
async function uploadWordAudio(word, event) {
  const file = event.target.files?.[0]; if (!file) return;
  if (file.size > 10485760) { alert("音频不能超过 10MB"); return; }
  try { await api.put(`/admin/words/${word.id}/audio`, file, { timeout: 45000, headers: { "Content-Type": "audio/mpeg" } }); await loadAdminWords(adminWordPage.value); }
  catch (e) { alert(e.response?.data?.message || "上传失败"); }
  finally { event.target.value = ""; }
}
async function importWordAudio(word) {
  const url = prompt("输入 MP3 音频的 HTTP/HTTPS 地址（最多 10MB）"); if (!url) return;
  try { await api.put(`/admin/words/${word.id}/audio`, { url }, { timeout: 45000 }); await loadAdminWords(adminWordPage.value); }
  catch (e) { alert(e.response?.data?.message || "导入失败"); }
}
const authMode = ref("login"),
  auth = ref({ username: "", password: "", name: "", phone: "", email: "" }),
  authError = ref(""),
  notice = ref("");
const adminTab = ref("users"),
  adminUsers = ref([]),
  adminLogs = ref([]),
  selectedUsers = ref([]),
  adminUserPage = ref(1),
  adminUserPages = ref(1),
  adminLogPage = ref(1),
  adminLogPages = ref(1),
  adminLogTypes = ref([]),
  adminLogFilter = ref({ type: "", keyword: "" }),
  adminWords = ref([]),
  adminWordLibraries = ref([]),
  adminWordPage = ref(1),
  adminWordPages = ref(1),
  adminWordTotal = ref(0),
  adminWordFilter = ref({ libraryId: "", word: "", meaning: "" }),
  adminWordEditorOpen = ref(false),
  adminWordEditingId = ref(null),
  adminWordError = ref(""),
  adminWordForm = ref({
    libraryId: "",
    word: "",
    phonetic: "",
    meaning: "",
    exampleEn: "",
    exampleCn: "",
    source: "MANUAL",
  });
const eventTypeLabels = {
  LOGIN_SUCCESS: "登录成功",
  LOGIN_FAILED: "登录失败",
  LOGOUT: "退出登录",
  REGISTER: "用户注册",
  PASSWORD_CHANGED: "修改密码",
  PASSWORD_RECOVERED: "找回密码",
  ADMIN_PASSWORD_RESET: "管理员重置密码",
  ADMIN_USER_AUDIT: "用户状态管理",
  START_STUDY: "开始学习",
  PAGE_VIEW: "页面访问",
  USER_WORD_ADD: "新增用户单词",
  USER_WORD_EDIT: "编辑用户单词",
  USER_WORD_DELETE: "删除用户单词",
  ADMIN_WORD_ADD: "管理员新增单词",
  ADMIN_WORD_EDIT: "管理员编辑单词",
  ADMIN_WORD_DELETE: "管理员删除单词",
  PK_CREATE: "发起限时 PK",
  PK_START: "参加限时 PK",
  PK_COMPLETE: "完成限时 PK",
};
const passwordOpen = ref(false),
  passwordForm = ref({ oldPassword: "", newPassword: "", confirmPassword: "" }),
  passwordMessage = ref(""),
  forgotOpen = ref(false),
  forgotEmail = ref(""),
  resetTarget = ref(null),
  resetPassword = ref("");
const messages = ref([]),
  messageText = ref(""),
  messagePage = ref(1),
  messagePages = ref(1),
  petTick = ref(null),
  dragPet = ref(null),
  petPositions = ref({});
const userWords = ref([]),
  wordQuery = ref(""),
  searchResults = ref([]),
  searching = ref(false),
  wordError = ref(""),
  editingId = ref(null),
  wordForm = ref({
    word: "",
    phonetic: "",
    meaning: "",
    exampleEn: "",
    exampleCn: "",
    source: "MANUAL",
  });
onMounted(async () => {
  const token = new URLSearchParams(location.search).get("verify");
  if (token) {
    try {
      const { data } = await api.get("/auth/verify-email", {
        params: { token },
      });
      notice.value = data.message;
    } catch (e) {
      authError.value = e.response?.data?.message || "邮箱验证失败";
    }
    history.replaceState({}, "", location.pathname);
  }
  await store.bootstrap();
  if (store.user) {
    if (!store.isGuest)
      await Promise.all([loadMessages(), loadPkChallenges()]);
    petPositions.value = JSON.parse(
      localStorage.getItem(`wordhop-pets-${store.user.id}`) || "{}",
    );
    await scrollToLastUnit();
  }
  petTick.value = setInterval(trackStudy, 60000);
});
onBeforeUnmount(() => {
  clearTimeout(timer.value);
  clearInterval(petTick.value);
  clearInterval(gameInterval.value);
  clearInterval(pkClock.value);
  clearInterval(pkQuestionClock.value);
  clearTimeout(pkSkipTimer.value);
});
const isWrong = computed(() => view.value.startsWith("wrong-")),
  isDictation = computed(
    () => view.value === "dictation" || view.value === "wrong-dictation",
  ),
  isSpelling = computed(() => view.value === "spelling"),
  isQuiz = computed(() => view.value === "quiz" || view.value === "wrong-quiz"),
  isMemory = computed(
    () => view.value === "memory" || view.value === "wrong-memory",
  ),
  isGame = computed(() => view.value === "game"),
  currentPkWord = computed(() => pkWords.value[pkCursor.value]);
const totalUnits = computed(() =>
    Math.ceil(store.words.length / store.unitSize),
  ),
  unitWords = computed(() =>
    store.words.slice(
      unit.value * store.unitSize,
      (unit.value + 1) * store.unitSize,
    ),
  ),
  pool = computed(() => (isWrong.value ? store.wrongWords : unitWords.value)),
  current = computed(() => pool.value[cursor.value]),
  pct = computed(() =>
    Math.round((store.mastered.length / Math.max(store.words.length, 1)) * 100),
  );
const modeName = computed(() =>
  isDictation.value
    ? "dictation"
    : isSpelling.value
      ? "spelling"
      : isQuiz.value
        ? "quiz"
        : "memory",
);
function perfectCount(mode, unitIndex) {
  return Number(
    store.perfectCounts.find(
      (item) => item.mode === mode && item.unitIndex === unitIndex,
    )?.perfectCount || 0,
  );
}
function example(w) {
  if (w.exampleEn && w.exampleCn) return { en: w.exampleEn, cn: w.exampleCn };
  return { en: "正在查找真实例句…", cn: "请稍候" };
}
async function loadExample(w) {
  if (!w || (w.exampleEn && w.exampleCn)) return;
  try {
    const prefix = store.isGuest ? "/guest" : "";
    const { data } = await api.get(`${prefix}/words/${w.id}/example`, {
      params: { libraryId: store.selectedLibraryId },
    });
    w.exampleEn = data.exampleEn;
    w.exampleCn = data.exampleCn;
  } catch (error) {
    w.exampleEn = "No suitable example is available yet.";
    w.exampleCn = "暂时没有查询到合适的双语例句。";
  }
}
async function toggleExample() {
  showExample.value = !showExample.value;
  if (showExample.value) await loadExample(current.value);
}
let activeAudio = null;
const audioCache = new Map();
const failedAudio = ref(new Set());
const missingAudio = (item) => !item?.audioUrl || failedAudio.value.has(item.audioUrl);
function cachedAudio(url) {
  if (audioCache.has(url)) return audioCache.get(url);
  const audio = new Audio(url);
  audio.preload = "auto";
  audioCache.set(url, audio);
  if (audioCache.size > 20) {
    const first = audioCache.keys().next().value;
    if (audioCache.get(first) !== activeAudio) audioCache.delete(first);
  }
  return audio;
}
function preloadAudio(item) {
  if (item?.audioUrl) {
    const audio = cachedAudio(item.audioUrl);
    if (audio.readyState === 0) audio.load();
  }
}
function browserSpeak(text, times) {
  if (!window.speechSynthesis || !text) return;
  let count = 0;
  const play = () => {
    if (count++ >= times) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.82;
    u.onend = () => setTimeout(play, 180);
    window.speechSynthesis.speak(u);
  };
  play();
}
function speakTimes(item, times = 3) {
  const text = typeof item === "string" ? item : item?.word,
    audioUrl =
      typeof item === "object"
        ? item?.audioUrl
        : current.value?.word === item
          ? current.value?.audioUrl
          : null;
  if (!text) return;
  window.speechSynthesis?.cancel();
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio = null;
  }
  if (!audioUrl) {
    return;
  }
  let count = 0,
    fallback = false;
  const audio = cachedAudio(audioUrl);
  activeAudio = audio;
  const fail = () => {
    if (fallback) return;
    fallback = true;
    audio.onended = null;
    audio.onerror = null;
    activeAudio = null;
    failedAudio.value.add(audioUrl);
  };
  const play = () => {
    if (count >= times || fallback) {
      activeAudio = null;
      return;
    }
    count++;
    audio.currentTime = 0;
    audio.play().catch(fail);
  };
  audio.onended = () => setTimeout(play, 150);
  audio.onerror = fail;
  play();
}
async function prepareQuestion() {
  clearTimeout(timer.value);
  answer.value = "";
  memoryAnswer.value = "";
  feedback.value = "";
  showExample.value = false;
  cardShake.value = false;
  preloadAudio(current.value);
  preloadAudio(pool.value[cursor.value + 1]);
  await nextTick();
  if (isDictation.value || isSpelling.value) inputRef.value?.focus();
  if (isMemory.value) memoryInputRef.value?.focus();
  if (isDictation.value || isMemory.value) speakTimes(current.value);
  if (isMemory.value) loadExample(current.value);
}
function trackedUnit(index = store.lastUnit) {
  return Math.max(0, Math.min(Number(index) || 0, totalUnits.value - 1));
}
async function scrollToLastUnit(behavior = "auto") {
  if (view.value !== "home" || !totalUnits.value) return;
  await nextTick();
  const target = document.querySelector(
    `[data-unit-index="${trackedUnit()}"]`,
  );
  target?.scrollIntoView({ behavior, block: "center" });
}
function open(next, n = unit.value) {
  unit.value = n;
  if (["memory", "dictation", "spelling", "quiz", "game"].includes(next)) {
    store.lastUnit = trackedUnit(n);
    store.save().catch(() => {});
  }
  view.value = next;
  cursor.value = 0;
  completed.value = false;
  runAllCorrect.value = true;
  runWrongWords.value = [];
  rewardMessage.value = "";
  reportEvent("START_STUDY", { mode: next, unitIndex: n });
  prepareQuestion();
}
async function goHome() {
  clearTimeout(timer.value);
  window.speechSynthesis?.cancel();
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
  view.value = "home";
  completed.value = false;
  clearInterval(gameInterval.value);
  clearInterval(pkClock.value);
  clearInterval(pkQuestionClock.value);
  clearTimeout(pkSkipTimer.value);
  if (!store.isGuest)
    Promise.all([loadMessages(messagePage.value), loadPkChallenges()]);
  await scrollToLastUnit();
}
function restart() {
  cursor.value = 0;
  completed.value = false;
  runAllCorrect.value = true;
  runWrongWords.value = [];
  rewardMessage.value = "";
  prepareQuestion();
}
async function move(step = 1) {
  if (settling.value) return;
  clearTimeout(timer.value);
  const target = cursor.value + step;
  if (target < 0) {
    cursor.value = 0;
    prepareQuestion();
    return;
  }
  if (target >= pool.value.length) {
    settling.value = true;
    try {
      if (
        !isWrong.value &&
        (isQuiz.value || isDictation.value || isSpelling.value)
      ) {
        if (store.isGuest) {
          rewardMessage.value = runAllCorrect.value
            ? "全对啦！游客模式不记录积分和学习数据。"
            : "本轮已完成；游客错题仅在当前访问期间保留。";
          completed.value = true;
          return;
        }
        const { data } = await api.post("/study/complete", {
          libraryId: store.selectedLibraryId,
          mode: modeName.value,
          unitIndex: unit.value,
          unitSize: store.unitSize,
          allCorrect: runAllCorrect.value,
        });
        store.user.score = data.score;
        rewardMessage.value = data.message;
        if (runAllCorrect.value)
          store.perfectCounts = [
            ...store.perfectCounts.filter(
              (item) =>
                item.mode !== modeName.value || item.unitIndex !== unit.value,
            ),
            {
              mode: modeName.value,
              unitIndex: unit.value,
              perfectCount: perfectCount(modeName.value, unit.value) + 1,
            },
          ];
      }
      completed.value = true;
    } catch (error) {
      rewardMessage.value =
        error.response?.data?.message || "本轮结算失败，请重试最后一步";
      completed.value = true;
    } finally {
      settling.value = false;
    }
    return;
  }
  cursor.value = target;
  prepareQuestion();
}
async function memoryMark(ok) {
  await store.mark(current.value.id, ok, modeName.value, unit.value);
  move(1);
}
async function checkMemory(event) {
  if (feedback.value === "ok") {
    move(1);
    return;
  }
  if (event?.type === "click") {
    await memoryMark(true);
    return;
  }
  if (
    memoryAnswer.value.trim().toLowerCase() === current.value.word.toLowerCase()
  ) {
    feedback.value = "ok";
    await store.mark(current.value.id, true, modeName.value, unit.value);
    await nextTick();
    memoryInputRef.value?.focus();
    return;
  }
  cardShake.value = false;
  await nextTick();
  cardShake.value = true;
  setTimeout(() => (cardShake.value = false), 450);
  memoryInputRef.value?.focus();
}
async function checkDictation() {
  if (feedback.value) {
    move(1);
    return;
  }
  const ok =
    answer.value.trim().toLowerCase() === current.value.word.toLowerCase();
  if (!ok) {
    runAllCorrect.value = false;
    if (!runWrongWords.value.includes(current.value.word))
      runWrongWords.value.push(current.value.word);
  }
  feedback.value = ok ? "ok" : "bad";
  await store.mark(
    current.value.id,
    ok,
    modeName.value,
    unit.value,
    answer.value,
    isWrong.value,
  );
  await nextTick();
  inputRef.value?.focus();
  timer.value = setTimeout(() => move(1), isWrong.value ? 2000 : 3000);
}
async function pick(option) {
  if (feedback.value) return;
  answer.value = option;
  const ok = option === current.value.word;
  if (!ok) runAllCorrect.value = false;
  if (!ok && !runWrongWords.value.includes(current.value.word))
    runWrongWords.value.push(current.value.word);
  feedback.value = ok ? "ok" : "bad";
  await store.mark(current.value.id, ok, modeName.value, unit.value, option);
  timer.value = setTimeout(() => move(1), 2000);
}
const gameTimeText = computed(
  () =>
    `${String(Math.floor(gameSeconds.value / 60)).padStart(2, "0")}:${String(gameSeconds.value % 60).padStart(2, "0")}`,
);
function openGame(index) {
  open("game", index);
  startGame();
}
async function startGame() {
  clearInterval(gameInterval.value);
  gameSeconds.value = 180;
  gameInput.value = "";
  gameStatus.value = "playing";
  gameMessage.value = "";
  gameShot.value = null;
  gameFiring.value = false;
  gameMonsters.value = unitWords.value.map((word, index) => ({
    ...word,
    alive: true,
    lane: index,
    taunt: index % 3 === 0 ? "来抓我呀！" : "",
  }));
  await nextTick();
  gameInputRef.value?.focus();
  gameInterval.value = setInterval(() => {
    if (gameStatus.value !== "playing") return;
    gameSeconds.value--;
    gameMonsters.value.forEach((monster, index) => {
      monster.taunt =
        (gameSeconds.value + index * 3) % 11 === 0
          ? ["你打不中！", "快来呀 :-P", "略略略～", "我还在！"][index % 4]
          : "";
    });
    if (gameSeconds.value <= 0) {
      clearInterval(gameInterval.value);
      gameStatus.value = "failed";
      gameMessage.value = "时间到，怪物守住了单词城！";
    }
  }, 1000);
}
async function fireCannon() {
  if (gameStatus.value !== "playing" || gameFiring.value) return;
  const typed = gameInput.value.trim().toLowerCase();
  const monster = gameMonsters.value.find(
    (item) => item.alive && item.word.toLowerCase() === typed,
  );
  gameInput.value = "";
  if (!monster) {
    cannonShake.value = false;
    await nextTick();
    cannonShake.value = true;
    setTimeout(() => (cannonShake.value = false), 400);
    gameInputRef.value?.focus();
    return;
  }
  const area = gameAreaRef.value?.getBoundingClientRect();
  const input = gameInputRef.value?.getBoundingClientRect();
  const target = gameAreaRef.value
    ?.querySelector(`[data-monster-id="${monster.id}"]`)
    ?.getBoundingClientRect();
  if (area && input && target) {
    gameFiring.value = true;
    gameShot.value = {
      x: input.left + input.width / 2 - area.left,
      y: input.top + input.height / 2 - area.top,
      dx: target.left + target.width / 2 - input.left - input.width / 2,
      dy: target.top + target.height / 2 - input.top - input.height / 2,
    };
    await nextTick();
    gameInputRef.value?.focus();
    await new Promise((resolve) => setTimeout(resolve, 480));
    monster.exploding = true;
    gameShot.value = null;
    await new Promise((resolve) => setTimeout(resolve, 380));
    monster.alive = false;
    monster.exploding = false;
    gameFiring.value = false;
  } else {
    monster.alive = false;
  }
  if (!gameMonsters.value.some((item) => item.alive)) {
    clearInterval(gameInterval.value);
    gameStatus.value = "won";
    if (store.isGuest) {
      gameMessage.value = "怪物全部消灭！游客模式不记录积分。";
      return;
    }
    const { data } = await api.post("/study/game-complete", {
      libraryId: store.selectedLibraryId,
    });
    store.user.score = data.score;
    gameMessage.value = data.message;
  } else {
    await nextTick();
    gameInputRef.value?.focus();
  }
}
const options = computed(() => {
  if (!current.value) return [];
  const seed = current.value.id,
    others = store.words
      .filter((w) => w.id !== seed)
      .sort((a, b) => ((a.id * 17 + seed) % 997) - ((b.id * 17 + seed) % 997))
      .slice(0, 3)
      .map((w) => w.word);
  return [...others, current.value.word].sort(
    (a, b) => ((a.charCodeAt(0) + seed) % 7) - ((b.charCodeAt(0) + seed) % 7),
  );
});
watch(
  () => store.unitSize,
  async () => {
    if (!store.user) return;
    await store.save();
    await store.loadLearning();
  },
);

function formatPkDate(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
function formatPkTime(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
async function loadPkChallenges() {
  if (!store.user || store.isGuest) return;
  const { data } = await api.get("/pk-challenges", { params: { page: pkPage.value } });
  pkChallenges.value = data.items;
  pkPages.value = data.pages;
  if (pkPage.value > data.pages) { pkPage.value = data.pages; await loadPkChallenges(); }
}
function togglePkCreator() {
  pkCreateOpen.value = !pkCreateOpen.value;
  if (pkCreateOpen.value && !pkForm.value.libraryId)
    pkForm.value.libraryId = store.selectedLibraryId;
  pkError.value = "";
}
async function createPkChallenge() {
  pkError.value = "";
  try {
    await api.post("/pk-challenges", {
      ...pkForm.value,
      libraryId: Number(pkForm.value.libraryId),
      wordCount: Number(pkForm.value.wordCount),
      startAt: new Date(pkForm.value.startAt).toISOString(),
      endAt: new Date(pkForm.value.endAt).toISOString(),
    });
    pkCreateOpen.value = false;
    pkForm.value = {
      name: "",
      libraryId: store.selectedLibraryId,
      startAt: "",
      endAt: "",
      wordCount: 20,
    };
    await loadPkChallenges();
  } catch (error) {
    pkError.value = error.response?.data?.message || "创建 PK 失败";
  }
}
async function openPkDetail(id) {
  try {
    const { data } = await api.get(`/pk-challenges/${id}`);
    pkDetail.value = data;
    pkError.value = "";
  } catch (error) {
    alert(error.response?.data?.message || "读取 PK 失败");
  }
}
function makePkChoices() {
  const word = currentPkWord.value;
  if (!word) return;
  const others = pkWords.value
    .filter((item) => item.id !== word.id)
    .map((item) => item.word)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
  pkChoices.value = [word.word, ...others].sort(() => Math.random() - 0.5);
}
async function preparePkQuestion() {
  clearInterval(pkQuestionClock.value);
  clearTimeout(pkSkipTimer.value);
  pkQuestionSeconds.value = 30;
  pkAnswer.value = "";
  pkFeedback.value = "";
  makePkChoices();
  await nextTick();
  if (pkStage.value !== "quiz") pkInputRef.value?.focus();
  if (pkStage.value === "dictation") speakTimes(currentPkWord.value, 3);
  pkQuestionClock.value = setInterval(() => {
    pkQuestionSeconds.value--;
    if (pkQuestionSeconds.value > 0) return;
    clearInterval(pkQuestionClock.value);
    pkFeedback.value = "timeout";
    pkSkipTimer.value = setTimeout(() => advancePk(), 3000);
  }, 1000);
}
async function startPkChallenge(id) {
  try {
    const { data } = await api.post(`/pk-challenges/${id}/start`);
    pkWords.value = data.words;
    pkStartedAt.value = new Date(data.startedAt).getTime();
    pkStage.value = "quiz";
    pkCursor.value = 0;
    pkFinished.value = null;
    pkDetail.value = { ...(pkDetail.value || {}), id };
    view.value = "pk";
    clearInterval(pkClock.value);
    const tick = () => {
      pkElapsed.value = Date.now() - pkStartedAt.value;
    };
    tick();
    pkClock.value = setInterval(tick, 250);
    await preparePkQuestion();
  } catch (error) {
    alert(error.response?.data?.message || "暂时不能参加这场 PK");
  }
}
async function advancePk() {
  clearInterval(pkQuestionClock.value);
  clearTimeout(pkSkipTimer.value);
  if (pkCursor.value + 1 < pkWords.value.length) {
    pkCursor.value++;
    await preparePkQuestion();
    return;
  }
  if (pkStage.value === "quiz") pkStage.value = "dictation";
  else if (pkStage.value === "dictation") pkStage.value = "spelling";
  else {
    clearInterval(pkClock.value);
    try {
      const { data } = await api.post(
        `/pk-challenges/${pkDetail.value.id}/complete`,
      );
      pkElapsed.value = data.totalMs;
      pkFinished.value = data;
      pkDetail.value = { ...pkDetail.value, rankings: data.rankings };
      await loadPkChallenges();
    } catch (error) {
      alert(error.response?.data?.message || "成绩提交失败");
    }
    return;
  }
  pkCursor.value = 0;
  await preparePkQuestion();
}
async function pickPkWord(choice) {
  if (pkFeedback.value === "timeout") return;
  if (choice !== currentPkWord.value.word) {
    pkFeedback.value = "bad";
    return;
  }
  pkFeedback.value = "ok";
  await advancePk();
}
async function submitPkWord() {
  if (pkFeedback.value === "timeout" || pkFeedback.value === "reveal") return;
  if (
    pkAnswer.value.trim().toLowerCase() !==
    currentPkWord.value.word.toLowerCase()
  ) {
    pkFeedback.value = "bad";
    return;
  }
  if (pkStage.value === "dictation") {
    clearInterval(pkQuestionClock.value);
    pkFeedback.value = "reveal";
    pkSkipTimer.value = setTimeout(() => advancePk(), 3000);
    return;
  }
  pkFeedback.value = "ok";
  await advancePk();
}

async function submitAuth() {
  authError.value = "";
  notice.value = "";
  try {
    if (authMode.value === "register") {
      const { data } = await api.post("/auth/register", auth.value);
      notice.value = data.message;
      authMode.value = "login";
      auth.value.password = "";
    } else {
      await api.post("/auth/login", auth.value);
      await store.bootstrap();
      await Promise.all([loadMessages(), loadPkChallenges()]);
      await scrollToLastUnit();
      reportEvent("PAGE_VIEW", { path: "/" });
      auth.value.password = "";
    }
  } catch (e) {
    authError.value = e.response?.data?.message || "操作失败，请稍后再试";
  }
}
async function enterGuest() {
  authError.value = "";
  notice.value = "";
  try {
    await store.enterGuest();
    view.value = "home";
    await nextTick();
    window.scrollTo({ top: 0, behavior: "auto" });
  } catch (error) {
    authError.value =
      error.response?.data?.message || "游客模式暂时无法进入，请稍后重试";
  }
}
async function logout() {
  if (!store.isGuest) await api.post("/auth/logout");
  store.$reset();
  store.loaded = true;
  view.value = "home";
}
async function openAdmin() {
  view.value = "admin";
  await loadAdmin();
}
async function loadAdmin() {
  const [
    { data: users },
    { data: logs },
    { data: libraries },
    { data: words },
  ] = await Promise.all([
    api.get("/admin/users", { params: { page: adminUserPage.value } }),
    api.get("/admin/logs", {
      params: { page: adminLogPage.value, ...adminLogFilter.value },
    }),
    api.get("/admin/word-libraries"),
    api.get("/admin/words", {
      params: { page: adminWordPage.value, ...adminWordFilter.value },
    }),
  ]);
  adminUsers.value = users.items;
  adminUserPage.value = users.page;
  adminUserPages.value = users.pages;
  adminLogs.value = logs.items;
  adminLogPage.value = logs.page;
  adminLogPages.value = logs.pages;
  adminLogTypes.value = logs.types;
  adminWordLibraries.value = libraries;
  adminWords.value = words.items;
  adminWordPage.value = words.page;
  adminWordPages.value = words.pages;
  adminWordTotal.value = words.total;
}
async function loadAdminUsers(page) {
  adminUserPage.value = page;
  const { data } = await api.get("/admin/users", { params: { page } });
  adminUsers.value = data.items;
  adminUserPages.value = data.pages;
  selectedUsers.value = [];
}
async function loadAdminLogs(page = 1) {
  adminLogPage.value = page;
  const { data } = await api.get("/admin/logs", {
    params: { page, ...adminLogFilter.value },
  });
  adminLogs.value = data.items;
  adminLogPages.value = data.pages;
  adminLogTypes.value = data.types;
}
function adminLibraryLabel(library) {
  return library.libraryType === "USER"
    ? `用户库 · ${library.username || library.ownerUserId}`
    : library.name;
}
async function loadAdminWords(page = 1) {
  adminWordPage.value = page;
  const { data } = await api.get("/admin/words", {
    params: { page, ...adminWordFilter.value },
  });
  adminWords.value = data.items;
  adminWordPages.value = data.pages;
  adminWordTotal.value = data.total;
}
function resetAdminWordForm() {
  adminWordEditingId.value = null;
  adminWordError.value = "";
  adminWordForm.value = {
    libraryId:
      Number(adminWordFilter.value.libraryId) ||
      Number(adminWordLibraries.value[0]?.id) ||
      "",
    word: "",
    phonetic: "",
    meaning: "",
    exampleEn: "",
    exampleCn: "",
    source: "MANUAL",
  };
}
function openAdminWordEditor(word = null) {
  resetAdminWordForm();
  if (word) {
    adminWordEditingId.value = word.id;
    adminWordForm.value = {
      libraryId: Number(word.libraryId),
      word: word.word,
      phonetic: word.phonetic || "",
      meaning: word.meaning || "",
      exampleEn: word.exampleEn || "",
      exampleCn: word.exampleCn || "",
      source: ["LOCAL", "MANUAL", "BASE", "INTERNET"].includes(word.source)
        ? word.source
        : "MANUAL",
    };
  }
  adminWordEditorOpen.value = true;
}
async function saveAdminWord() {
  adminWordError.value = "";
  try {
    const payload = {
      ...adminWordForm.value,
      libraryId: Number(adminWordForm.value.libraryId),
    };
    if (adminWordEditingId.value)
      await api.put(`/admin/words/${adminWordEditingId.value}`, payload, { timeout: 45000 });
    else await api.post("/admin/words", payload, { timeout: 45000 });
    adminWordEditorOpen.value = false;
    await Promise.all([loadAdminWords(adminWordPage.value), loadAdminWordLibraries()]);
  } catch (error) {
    adminWordError.value =
      error.response?.data?.message || "保存单词失败，请稍后重试";
  }
}
async function loadAdminWordLibraries() {
  const { data } = await api.get("/admin/word-libraries");
  adminWordLibraries.value = data;
}
async function deleteAdminWord(word) {
  if (!confirm(`确定从“${word.libraryName}”删除单词 ${word.word} 吗？`))
    return;
  try {
    await api.delete(`/admin/words/${word.id}`);
    if (adminWords.value.length === 1 && adminWordPage.value > 1)
      adminWordPage.value--;
    await Promise.all([loadAdminWords(adminWordPage.value), loadAdminWordLibraries()]);
  } catch (error) {
    alert(error.response?.data?.message || "删除失败");
  }
}
async function audit(ids, status) {
  await api.patch("/admin/users/status", { userIds: ids, status });
  selectedUsers.value = [];
  await loadAdmin();
}
async function changeLibrary(event) {
  await store.selectLibrary(Number(event.target.value));
  unit.value = trackedUnit();
  view.value = "home";
  await scrollToLastUnit();
}
async function openUserLibrary() {
  view.value = "user-library";
  await loadUserWords();
}
async function loadUserWords() {
  const { data } = await api.get("/user-library/words");
  userWords.value = data;
}
function resetWordForm() {
  editingId.value = null;
  wordForm.value = {
    word: "",
    phonetic: "",
    meaning: "",
    exampleEn: "",
    exampleCn: "",
    source: "MANUAL",
  };
  wordError.value = "";
}
function useWord(w, source = "BASE") {
  wordForm.value = {
    word: w.word,
    phonetic: w.phonetic || "",
    meaning: w.meaning || "",
    exampleEn: w.exampleEn || "",
    exampleCn: w.exampleCn || "",
    source,
  };
  editingId.value = null;
  wordError.value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function editWord(w) {
  wordForm.value = {
    word: w.word,
    phonetic: w.phonetic || "",
    meaning: w.meaning || "",
    exampleEn: w.exampleEn || "",
    exampleCn: w.exampleCn || "",
    source: w.source || "MANUAL",
  };
  editingId.value = w.id;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
async function searchBase() {
  searching.value = true;
  wordError.value = "";
  try {
    const { data } = await api.get("/word-search", {
      params: { q: wordQuery.value },
    });
    searchResults.value = data;
    if (!data.length) wordError.value = "基础词库中没有找到结果";
  } finally {
    searching.value = false;
  }
}
async function searchInternet() {
  searching.value = true;
  wordError.value = "";
  try {
    const { data } = await api.get("/word-search/internet", {
      params: { q: wordQuery.value },
    });
    searchResults.value = [{ ...data, libraryName: "互联网词典" }];
  } catch (e) {
    wordError.value = e.response?.data?.message || "互联网查询失败";
  } finally {
    searching.value = false;
  }
}
async function saveUserWord() {
  wordError.value = "";
  try {
    if (editingId.value)
      await api.put(`/user-library/words/${editingId.value}`, wordForm.value);
    else {
      const { data } = await api.post("/user-library/words", wordForm.value, { timeout: 45000 });
      if (data.message) notice.value = data.message;
    }
    resetWordForm();
    await loadUserWords();
    await store.loadLibraries();
    if (store.selectedLibrary?.libraryType === "USER")
      await store.loadLearning();
  } catch (e) {
    wordError.value = e.response?.data?.message || "保存失败";
  }
}
async function deleteWord(id) {
  if (!confirm("确定从你的用户库删除这个单词吗？")) return;
  try {
    await api.delete(`/user-library/words/${id}`);
    await loadUserWords();
    await store.loadLibraries();
    if (store.selectedLibrary?.libraryType === "USER")
      await store.loadLearning();
  } catch (error) {
    alert(error.response?.data?.message || "删除失败");
  }
}
async function changePassword() {
  passwordMessage.value = "";
  try {
    const { data } = await api.post(
      "/auth/change-password",
      passwordForm.value,
    );
    passwordOpen.value = false;
    passwordForm.value = {
      oldPassword: "",
      newPassword: "",
      confirmPassword: "",
    };
    store.$reset();
    store.loaded = true;
    view.value = "home";
    notice.value = data.message;
  } catch (e) {
    passwordMessage.value = e.response?.data?.message || "修改失败";
  }
}
async function forgotPassword() {
  authError.value = "";
  try {
    const { data } = await api.post("/auth/forgot-password", {
      email: forgotEmail.value,
    });
    notice.value = data.message;
    forgotOpen.value = false;
  } catch (e) {
    authError.value = e.response?.data?.message || "找回密码失败";
  }
}
function openReset(user) {
  resetTarget.value = user;
  resetPassword.value = "";
}
async function resetUserPassword() {
  try {
    const { data } = await api.post(
      `/admin/users/${resetTarget.value.id}/reset-password`,
      { newPassword: resetPassword.value },
    );
    alert(data.message);
    resetTarget.value = null;
    resetPassword.value = "";
  } catch (e) {
    alert(e.response?.data?.message || "重置失败");
  }
}
async function loadMessages(page = messagePage.value, retry = true) {
  try {
    const { data } = await api.get("/messages", { params: { page } });
    messages.value = data.items;
    messagePage.value = data.page;
    messagePages.value = data.pages;
  } catch (error) {
    if (retry)
      setTimeout(() => loadMessages(page, false), 800);
  }
}
async function sendMessage() {
  if (!messageText.value.trim()) return;
  await api.post("/messages", { content: messageText.value });
  messageText.value = "";
  await loadMessages(1);
}
async function deleteMessage(id) {
  if (!confirm("确定删除这条留言吗？")) return;
  await api.delete(`/messages/${id}`);
  await loadMessages(messagePage.value);
  if (!messages.value.length && messagePage.value > 1)
    await loadMessages(messagePage.value - 1);
}
async function trackStudy() {
  if (!store.user || store.isGuest || document.hidden) return;
  const { data } = await api.post("/study/heartbeat", { seconds: 60 });
  store.user.studySeconds = data.studySeconds;
  store.user.redeemedPets = data.redeemedPets;
}
const iconPath = (code) => `/icons/${code}.svg`,
  petIcons = [
    "1f436",
    "1f431",
    "1f430",
    "1f98a",
    "1f43c",
    "1f438",
    "1f427",
    "1f981",
    "1f42f",
    "1f428",
  ].map(iconPath),
  monsterIcons = ["1f47e", "1f479", "1f916", "1f47b"].map(iconPath),
  petCount = computed(() =>
    Math.max(
      0,
      1 +
        Math.floor((store.user?.studySeconds || 0) / 300) -
        (store.user?.redeemedPets || 0),
    ),
  );
async function redeemPets() {
  if (!petCount.value) return alert("当前没有可以回归的宠物");
  if (!confirm(`让当前 ${petCount.value} 只宠物回归，并兑换同等积分吗？`))
    return;
  const { data } = await api.post("/pets/redeem");
  store.user.score = data.score;
  store.user.redeemedPets = data.redeemedPets;
  petPositions.value = {};
  localStorage.removeItem(`wordhop-pets-${store.user.id}`);
  alert(data.message);
  window.location.reload();
}
async function openLeaderboard(page = 1) {
  const { data } = await api.get("/leaderboard", { params: { page } });
  leaderboard.value = data.items;
  leaderboardPage.value = data.page;
  leaderboardPages.value = data.pages;
  leaderboardOpen.value = true;
}
function petStyle(i) {
  const saved = petPositions.value[i];
  if (saved) return { left: `${saved.x}px`, top: `${saved.y}px` };
  const side = i % 4;
  return side === 0
    ? { left: `${20 + i * 47}px`, top: "4px" }
    : side === 1
      ? { right: "4px", top: `${70 + i * 43}px` }
      : side === 2
        ? { right: `${30 + i * 47}px`, bottom: "4px" }
        : { left: "4px", top: `${90 + i * 43}px` };
}
let petDragged = false;
function startPetDrag(e, i) {
  dragPet.value = {
    i,
    startX: e.clientX,
    startY: e.clientY,
    dx: e.clientX - e.currentTarget.offsetLeft,
    dy: e.clientY - e.currentTarget.offsetTop,
    moved: false,
  };
  window.addEventListener("pointermove", movePet);
  window.addEventListener("pointerup", endPetDrag, { once: true });
}
function movePet(e) {
  if (!dragPet.value) return;
  if (
    Math.abs(e.clientX - dragPet.value.startX) > 4 ||
    Math.abs(e.clientY - dragPet.value.startY) > 4
  )
    dragPet.value.moved = true;
  petPositions.value = {
    ...petPositions.value,
    [dragPet.value.i]: {
      x: Math.max(0, Math.min(innerWidth - 50, e.clientX - dragPet.value.dx)),
      y: Math.max(0, Math.min(innerHeight - 50, e.clientY - dragPet.value.dy)),
    },
  };
}
function endPetDrag() {
  petDragged = !!dragPet.value?.moved;
  dragPet.value = null;
  window.removeEventListener("pointermove", movePet);
  if (store.user)
    localStorage.setItem(
      `wordhop-pets-${store.user.id}`,
      JSON.stringify(petPositions.value),
    );
  setTimeout(() => (petDragged = false), 80);
}
function playPetSound(i) {
  if (petDragged) return;
  const sounds = [
      "汪汪！",
      "喵呜～",
      "咕咕！",
      "嘤嘤！",
      "嗯嗯～",
      "呱呱！",
      "啾啾！",
      "嗷呜！",
      "吼！",
      "呜呜～",
    ],
    utterance = new SpeechSynthesisUtterance(sounds[i % sounds.length]);
  utterance.lang = "zh-CN";
  utterance.rate = 0.85;
  utterance.pitch = 1.3;
  window.speechSynthesis?.cancel();
  window.speechSynthesis?.speak(utterance);
}
function scrollTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
</script>
<template>
  <main v-if="!store.loaded" class="loading">正在连接 WordHop…</main>
  <main v-else-if="!store.user" class="auth-page">
    <section class="auth-brand">
      <div class="brand"><span>W</span> 单词口袋 · WordHop</div>
      <h1>把单词，<em>慢慢装进口袋。</em></h1>
      <p>登录后开始你的专属学习旅程，每一份进度都安全隔离。</p>
    </section>
    <form class="auth-card" @submit.prevent="submitAuth">
      <p class="eyebrow">WORDHOP ACCOUNT</p>
      <h2>{{ authMode === "login" ? "登录学习" : "申请学习账户" }}</h2>
      <input
        v-if="authMode === 'register'"
        v-model="auth.name"
        placeholder="真实姓名"
        required
        maxlength="80"
      /><input
        v-if="authMode === 'register'"
        v-model="auth.phone"
        placeholder="手机号"
        required
        pattern="1[3-9][0-9]{9}"
      /><input
        v-if="authMode === 'register'"
        v-model.trim="auth.email"
        type="email"
        placeholder="邮箱（用于验证和找回密码）"
        required
      /><input
        v-model="auth.username"
        :placeholder="
          authMode === 'login' ? '登录名或注册邮箱' : '登录名（不可重复）'
        "
        required
        minlength="3"
      /><input
        v-model="auth.password"
        type="password"
        placeholder="密码（至少 8 位）"
        required
        minlength="8"
      />
      <p v-if="authError" class="auth-error">{{ authError }}</p>
      <p v-if="notice" class="auth-notice">{{ notice }}</p>
      <button class="primary wide">
        {{ authMode === "login" ? "登录" : "发送验证邮件" }}</button
      ><button
        v-if="authMode === 'login'"
        type="button"
        class="guest-button"
        @click="enterGuest"
      >
        游客访问
        <small>无需注册，学习记录不会保存</small></button
      ><button
        v-if="authMode === 'login'"
        type="button"
        class="switch"
        @click="
          forgotOpen = true;
          forgotEmail = '';
        "
      >
        忘记密码？通过邮箱找回</button
      ><button
        type="button"
        class="switch"
        @click="
          authMode = authMode === 'login' ? 'register' : 'login';
          authError = '';
          notice = '';
        "
      >
        {{ authMode === "login" ? "没有账户？申请注册" : "已有账户？返回登录" }}
      </button>
    </form>
  </main>
  <main v-else-if="view === 'notebook'" class="app notebook-page">
    <button class="back" @click="goHome">← 返回首页</button>
    <header class="notebook-header"><h1>我的笔记本</h1><button class="primary" @click="openNote(null, true)">新增笔记</button></header>
    <p v-if="noteError" role="alert">{{ noteError }}</p>
    <section v-if="note" class="study-card note-panel">
      <template v-if="noteEditing">
        <label>标题<input v-model="note.title" maxlength="200" placeholder="笔记标题" /></label>
        <div class="note-toolbar" role="toolbar" aria-label="富文本格式">
          <button type="button" class="soft" @mousedown.prevent="formatNote('bold')">加粗</button><button type="button" class="soft" @mousedown.prevent="formatNote('italic')">斜体</button><button type="button" class="soft" @mousedown.prevent="formatNote('underline')">下划线</button><button type="button" class="soft" @mousedown.prevent="formatNote('formatBlock', 'h2')">标题</button><button type="button" class="soft" @mousedown.prevent="formatNote('formatBlock', 'p')">正文</button><button type="button" class="soft" @mousedown.prevent="formatNote('insertUnorderedList')">无序列表</button><button type="button" class="soft" @mousedown.prevent="formatNote('insertOrderedList')">有序列表</button><button type="button" class="soft" @mousedown.prevent="formatNote('undo')">撤销</button>
        </div>
        <div ref="noteEditor" class="note-content note-editor" contenteditable="true" role="textbox" aria-label="笔记内容" aria-multiline="true" @paste="pasteNote" @drop.prevent></div>
        <button class="primary" :disabled="noteBusy || !note.title.trim()" @click="saveNote">{{ noteBusy ? '保存中…' : '保存笔记' }}</button><button class="soft" @click="note = null">取消</button>
      </template>
      <template v-else><h2>{{ note.title }}</h2><time>{{ formatPkDate(note.createdAt) }}</time><div class="note-content" v-html="note.content"></div><button class="soft" @click="openNote(note, true)">修改</button><button class="soft danger" @click="deleteNote(note)">删除</button><button class="soft" @click="note = null">返回列表</button></template>
    </section>
    <template v-else>
      <article v-for="item in notes" :key="item.id" class="note-row"><div><h2>{{ item.title }}</h2><time>创建于 {{ formatPkDate(item.createdAt) }}</time></div><div class="actions"><button class="soft" @click="openNote(item)">查看</button><button class="soft" @click="openNote(item, true)">修改</button><button class="soft danger" @click="deleteNote(item)">删除</button></div></article>
      <p v-if="!notes.length">还没有笔记，点击“新增笔记”开始记录。</p>
      <div class="pagination" v-if="notePages > 1"><button class="soft" :disabled="notePage <= 1" @click="loadNotes(notePage - 1)">上一页</button><span>{{ notePage }} / {{ notePages }}</span><button class="soft" :disabled="notePage >= notePages" @click="loadNotes(notePage + 1)">下一页</button></div>
    </template>
  </main>
  <main v-else-if="view === 'user-library'" class="app library-page">
    <header class="topbar">
      <button class="back" @click="view = 'home'">← 返回学习首页</button>
      <h2>我的用户库</h2>
      <span>{{ userWords.length }} 个单词</span>
    </header>
    <section class="word-editor">
      <p class="eyebrow">{{ editingId ? "EDIT WORD" : "ADD A WORD" }}</p>
      <h3>{{ editingId ? "编辑单词" : "添加到我的用户库" }}</h3>
      <div class="word-form-grid">
        <input v-model.trim="wordForm.word" placeholder="英文单词" /><input
          v-model.trim="wordForm.phonetic"
          placeholder="音标"
        /><textarea
          v-model.trim="wordForm.meaning"
          placeholder="中文释义或英文解释"
        ></textarea
        ><input
          v-model.trim="wordForm.exampleEn"
          placeholder="英文例句"
        /><input v-model.trim="wordForm.exampleCn" placeholder="例句中文" />
      </div>
      <p v-if="wordError" class="auth-error">{{ wordError }}</p>
      <div class="editor-actions">
        <button v-if="editingId" class="soft" @click="resetWordForm">
          取消编辑</button
        ><button class="primary" @click="saveUserWord">
          {{ editingId ? "保存修改" : "加入用户库" }}
        </button>
      </div>
    </section>
    <section class="word-search">
      <h3>从其他词库或互联网查找</h3>
      <div class="search-row">
        <input
          v-model.trim="wordQuery"
          @keydown.enter="searchBase"
          placeholder="输入英文单词"
        /><button
          class="soft"
          :disabled="searching || !wordQuery"
          @click="searchBase"
        >
          查询基础库</button
        ><button
          class="soft"
          :disabled="searching || !wordQuery"
          @click="searchInternet"
        >
          查询互联网
        </button>
      </div>
      <div class="search-results">
        <article
          v-for="w in searchResults"
          :key="`${w.libraryName}-${w.id || w.word}`"
        >
          <div>
            <b>{{ w.word }}</b
            ><span>{{ w.phonetic }}</span
            ><small>{{ w.libraryName }}</small>
            <p>{{ w.meaning }}</p>
          </div>
          <button
            class="primary"
            @click="
              useWord(w, w.libraryName === '互联网词典' ? 'INTERNET' : 'BASE')
            "
          >
            使用此单词
          </button>
        </article>
      </div>
    </section>
    <section class="my-words">
      <h3>我的单词</h3>
      <div v-if="!userWords.length" class="empty-inline">
        用户库还没有单词，可以从上方查询或手工新增。
      </div>
      <article v-for="w in userWords" :key="w.id">
        <div>
          <b>{{ w.word }}</b
          ><span>{{ w.phonetic }}</span>
          <p>{{ w.meaning }}</p>
        </div>
        <div>
          <button class="link-btn" @click="editWord(w)">编辑</button
          ><button class="link-btn danger" @click="deleteWord(w.id)">
            删除
          </button>
        </div>
      </article>
    </section>
  </main>
  <main v-else-if="view === 'admin'" class="app admin-page">
    <header class="topbar">
      <button class="back" @click="view = 'home'">← 返回学习首页</button>
      <h2>管理后台</h2>
      <div>
        <button
          class="account"
          @click="
            passwordOpen = true;
            passwordMessage = '';
          "
        >
          修改我的密码</button
        ><button class="account" @click="logout">退出</button>
      </div>
    </header>
    <nav class="admin-tabs">
      <button
        :class="{ active: adminTab === 'users' }"
        @click="adminTab = 'users'"
      >
        用户审核</button
      ><button
        :class="{ active: adminTab === 'logs' }"
        @click="adminTab = 'logs'"
      >
        操作日志
      </button
      ><button
        :class="{ active: adminTab === 'words' }"
        @click="adminTab = 'words'"
      >
        单词管理
      </button>
    </nav>
    <section v-if="adminTab === 'users'" class="admin-panel">
      <div class="admin-toolbar">
        <b>用户列表</b>
        <div>
          <button
            class="soft"
            :disabled="!selectedUsers.length"
            @click="audit(selectedUsers, 'ACTIVE')"
          >
            批量通过</button
          ><button
            class="soft"
            :disabled="!selectedUsers.length"
            @click="audit(selectedUsers, 'DISABLED')"
          >
            批量禁用
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>登录名</th>
              <th>姓名</th>
              <th>手机号</th>
              <th>邮箱</th>
              <th>邮箱验证</th>
              <th>状态</th>
              <th>注册时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in adminUsers" :key="u.id">
              <td>
                <input type="checkbox" :value="u.id" v-model="selectedUsers" />
              </td>
              <td>{{ u.username }}</td>
              <td>{{ u.name }}</td>
              <td>{{ u.phone }}</td>
              <td>{{ u.email || "—" }}</td>
              <td>{{ u.emailVerifiedAt ? "已验证" : "未验证" }}</td>
              <td>
                <span :class="['status', u.status.toLowerCase()]">{{
                  u.status
                }}</span>
              </td>
              <td>{{ new Date(u.createdAt).toLocaleString() }}</td>
              <td>
                <button
                  v-if="u.status !== 'ACTIVE'"
                  class="link-btn"
                  @click="audit([u.id], 'ACTIVE')"
                >
                  通过</button
                ><button
                  v-if="u.status === 'ACTIVE' && u.role !== 'ADMIN'"
                  class="link-btn"
                  @click="openReset(u)"
                >
                  重置密码</button
                ><button
                  v-if="u.status !== 'DISABLED' && u.role !== 'ADMIN'"
                  class="link-btn danger"
                  @click="audit([u.id], 'DISABLED')"
                >
                  禁用
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination" v-if="adminUserPages > 1">
        <button
          class="soft"
          :disabled="adminUserPage <= 1"
          @click="loadAdminUsers(adminUserPage - 1)"
        >
          上一页
        </button>
        <span>第 {{ adminUserPage }} / {{ adminUserPages }} 页</span>
        <button
          class="soft"
          :disabled="adminUserPage >= adminUserPages"
          @click="loadAdminUsers(adminUserPage + 1)"
        >
          下一页
        </button>
      </div>
    </section>
    <section v-else-if="adminTab === 'logs'" class="admin-panel">
      <form class="admin-log-filters" @submit.prevent="loadAdminLogs(1)">
        <select v-model="adminLogFilter.type">
          <option value="">全部类型</option>
          <option v-for="type in adminLogTypes" :key="type" :value="type">
            {{ eventTypeLabels[type] || type }}
          </option>
        </select>
        <input
          v-model.trim="adminLogFilter.keyword"
          placeholder="按登录名或 IP 查询"
          maxlength="80"
        />
        <button class="primary">查询</button>
        <button
          type="button"
          class="soft"
          @click="
            adminLogFilter = { type: '', keyword: '' };
            loadAdminLogs(1);
          "
        >
          清空
        </button>
      </form>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>类型</th>
              <th>IP 地址</th>
              <th>内容</th>
              <th>客户端</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in adminLogs" :key="l.id">
              <td>{{ new Date(l.createdAt).toLocaleString() }}</td>
              <td>{{ l.username || "匿名" }}</td>
              <td>{{ eventTypeLabels[l.eventType] || l.eventType }}</td>
              <td>{{ l.ipAddress || "—" }}</td>
              <td>
                <code>{{ l.metadata }}</code>
              </td>
              <td class="ua">{{ l.userAgent }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination" v-if="adminLogPages > 1">
        <button
          class="soft"
          :disabled="adminLogPage <= 1"
          @click="loadAdminLogs(adminLogPage - 1)"
        >
          上一页
        </button>
        <span>第 {{ adminLogPage }} / {{ adminLogPages }} 页</span>
        <button
          class="soft"
          :disabled="adminLogPage >= adminLogPages"
          @click="loadAdminLogs(adminLogPage + 1)"
        >
          下一页
        </button>
      </div>
    </section>
    <section v-else class="admin-panel admin-words-panel">
      <div class="admin-toolbar">
        <div>
          <b>单词管理</b>
          <small>共 {{ adminWordTotal }} 条单词数据</small>
        </div>
        <button class="primary" @click="openAdminWordEditor()">新增单词</button>
      </div>
      <form class="admin-word-filters" @submit.prevent="loadAdminWords(1)">
        <select v-model="adminWordFilter.libraryId">
          <option value="">全部分类</option>
          <option
            v-for="library in adminWordLibraries"
            :key="library.id"
            :value="library.id"
          >
            {{ adminLibraryLabel(library) }}（{{ library.wordCount }}）
          </option>
        </select>
        <input
          v-model.trim="adminWordFilter.word"
          placeholder="英文单词模糊查询"
          maxlength="120"
        />
        <input
          v-model.trim="adminWordFilter.meaning"
          placeholder="中文释义模糊查询"
          maxlength="120"
        />
        <button class="primary">查询</button>
        <button
          type="button"
          class="soft"
          @click="
            adminWordFilter = { libraryId: '', word: '', meaning: '' };
            loadAdminWords(1);
          "
        >
          清空
        </button>
      </form>
      <div class="table-wrap">
        <table class="admin-words-table">
          <thead>
            <tr>
              <th>分类</th>
              <th>英文</th>
              <th>音标</th>
              <th>中文释义</th>
              <th>来源</th>
              <th>发音</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="word in adminWords" :key="word.id">
              <td>
                {{ word.libraryType === "USER" ? `用户库 · ${word.ownerUsername}` : word.libraryName }}
              </td>
              <td><b>{{ word.word }}</b></td>
              <td>{{ word.phonetic || "—" }}</td>
              <td class="word-meaning-cell" :title="word.meaning">
                {{ word.meaning }}
              </td>
              <td>{{ word.source }}</td>
              <td class="word-audio-cell"><template v-if="word.audioUrl"><a :href="word.audioUrl" target="_blank" rel="noopener">{{ word.audioUrl }}</a><audio :src="word.audioUrl" controls preload="none" @error="failedAudio.add(word.audioUrl)"></audio></template><small v-if="word.audioExists === false || missingAudio(word)">发音缺失或不可播放</small><label class="link-btn">上传 MP3<input type="file" accept="audio/mpeg,.mp3" @change="uploadWordAudio(word, $event)" /></label><button class="link-btn" @click="importWordAudio(word)">导入音频地址</button></td>
              <td>{{ new Date(word.updatedAt).toLocaleString() }}</td>
              <td>
                <button class="link-btn" @click="openAdminWordEditor(word)">
                  编辑</button
                ><button
                  class="link-btn danger"
                  @click="deleteAdminWord(word)"
                >
                  删除
                </button>
              </td>
            </tr>
            <tr v-if="!adminWords.length">
              <td colspan="8" class="empty-table">没有符合条件的单词</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination" v-if="adminWordPages > 1">
        <button
          class="soft"
          :disabled="adminWordPage <= 1"
          @click="loadAdminWords(adminWordPage - 1)"
        >
          上一页
        </button>
        <span>第 {{ adminWordPage }} / {{ adminWordPages }} 页</span>
        <button
          class="soft"
          :disabled="adminWordPage >= adminWordPages"
          @click="loadAdminWords(adminWordPage + 1)"
        >
          下一页
        </button>
      </div>
    </section>
  </main>
  <main v-else-if="view === 'pk'" class="app study-shell pk-play-page">
    <header class="topbar">
      <button class="back" @click="goHome">← 返回首页</button>
      <div class="mini-progress">
        <span
          :style="{
            width: `${((['quiz', 'dictation', 'spelling'].indexOf(pkStage) * pkWords.length + pkCursor + 1) / (pkWords.length * 3)) * 100}%`,
          }"
        />
      </div>
      <b class="pk-question-time" :class="{ urgent: pkQuestionSeconds <= 10 }">
        本题 {{ pkQuestionSeconds }} 秒
      </b>
      <b class="pk-live-time">{{ formatPkTime(pkElapsed) }}</b>
    </header>
    <section v-if="pkFinished" class="study-card pk-finished">
      <p class="eyebrow">PK COMPLETE</p>
      <h1>挑战完成！</h1>
      <p>总用时 <b>{{ formatPkTime(pkFinished.totalMs) }}</b></p>
      <p v-if="pkFinished.rank">当前排名第 {{ pkFinished.rank }} 名</p>
      <div class="pk-ranking compact">
        <h3>实时排行榜</h3>
        <ol>
          <li v-for="item in pkFinished.rankings" :key="item.username">
            <b>{{ item.rank }}</b><span>@{{ item.username }}</span
            ><strong>{{ formatPkTime(item.totalMs) }}</strong>
          </li>
        </ol>
      </div>
      <button class="primary wide" @click="goHome">返回首页</button>
    </section>
    <section v-else-if="currentPkWord" class="study-card pk-card">
      <p class="eyebrow">
        限时 PK · {{ { quiz: "选择", dictation: "听写", spelling: "默写" }[pkStage] }}
        · {{ pkCursor + 1 }}/{{ pkWords.length }}
      </p>
      <template v-if="pkStage === 'quiz'">
        <h2>{{ currentPkWord.meaning }}</h2>
        <div class="choices">
          <button
            v-for="(choice, index) in pkChoices"
            :key="choice"
            :disabled="pkFeedback === 'timeout' || pkFeedback === 'reveal'"
            :class="pkFeedback === 'bad' && choice !== currentPkWord.word ? 'dim' : ''"
            @click="pickPkWord(choice)"
          >
            <kbd>{{ String.fromCharCode(65 + index) }}</kbd>{{ choice }}
          </button>
        </div>
      </template>
      <template v-else>
        <h2 v-if="pkStage === 'spelling' || missingAudio(currentPkWord)">{{ currentPkWord.meaning }}</h2>
        <button
          v-else
          class="listen-orb"
          @click="speakTimes(currentPkWord, 1)"
        >
          <img class="listen-icon" :src="iconPath('1f50a')" alt="播放发音" />
          <span>再听一遍</span>
        </button>
        <form class="pk-answer-form" @submit.prevent="submitPkWord">
          <input
            ref="pkInputRef"
            v-model="pkAnswer"
            :disabled="pkFeedback === 'timeout'"
            autocomplete="off"
            :placeholder="pkStage === 'dictation' ? '输入听到的英文单词' : '输入中文对应的英文单词'"
          />
          <button
            class="primary"
            :disabled="pkFeedback === 'timeout' || pkFeedback === 'reveal'"
          >确认</button>
        </form>
      </template>
      <p v-if="pkFeedback === 'bad'" class="result bad">
        不正确，再试一次
      </p>
      <div v-else-if="pkFeedback === 'timeout'" class="result timeout word-reveal">
        <small>30 秒已到，自动跳过</small>
        <b>{{ currentPkWord.word }}</b>
        <span>{{ currentPkWord.phonetic || "暂无音标" }}</span>
        <strong>{{ currentPkWord.meaning }}</strong>
      </div>
      <div v-else-if="pkFeedback === 'reveal'" class="result ok word-reveal">
        <b>{{ currentPkWord.word }}</b>
        <span>{{ currentPkWord.phonetic || "暂无音标" }}</span>
        <strong>{{ currentPkWord.meaning }}</strong>
        <small>回答正确，即将进入下一题</small>
      </div>
    </section>
  </main>
  <main v-else-if="view !== 'home'" class="app study-shell">
    <header class="topbar">
      <button class="back" @click="goHome">← 返回首页</button
      ><button
        v-if="(isQuiz || isDictation || isSpelling || isMemory) && cursor > 0"
        class="soft prev"
        @click="move(-1)"
      >
        ← 上一题
      </button>
      <div v-if="!isGame" class="mini-progress">
        <span
          :style="{
            width: `${pool.length ? ((cursor + 1) / pool.length) * 100 : 0}%`,
          }"
        />
      </div>
      <span v-if="!isGame" class="counter"
        >{{ pool.length ? cursor + 1 : 0 }} / {{ pool.length }}</span
      >
      <span v-else class="game-clock"
        ><img class="ui-icon" :src="iconPath('231b')" alt="倒计时" />
        {{ gameTimeText }}</span
      >
    </header>
    <section v-if="isGame" ref="gameAreaRef" class="word-game">
      <div class="game-sky">
        <article
          v-for="monster in gameMonsters"
          v-show="monster.alive"
          :key="monster.id"
          :data-monster-id="monster.id"
          :class="['word-monster', { exploding: monster.exploding }]"
          :style="{
            '--lane': monster.lane,
            animationDuration: `${5 + (monster.lane % 4)}s`,
          }"
        >
          <span class="taunt">{{ monster.taunt }}</span>
          <b>{{ monster.meaning }}</b>
          <i
            ><img
              :src="monsterIcons[monster.lane % monsterIcons.length]"
              alt="怪兽"
          /></i>
          <span v-if="monster.exploding" class="explosion"
            ><img :src="iconPath('1f4a5')" alt="爆炸"
          /></span>
        </article>
      </div>
      <span
        v-if="gameShot"
        class="game-projectile"
        :style="{
          left: `${gameShot.x}px`,
          top: `${gameShot.y}px`,
          '--shot-x': `${gameShot.dx}px`,
          '--shot-y': `${gameShot.dy}px`,
        }"
      />
      <div :class="['cannon-zone', { shake: cannonShake }]">
        <form @submit.prevent="fireCannon">
          <input
            ref="gameInputRef"
            v-model="gameInput"
            :disabled="gameStatus !== 'playing'"
            autocomplete="off"
            placeholder="输入怪物对应的英文单词，回车开炮"
          />
          <button
            class="primary"
            :disabled="gameStatus !== 'playing' || gameFiring"
          >
            发射
          </button>
        </form>
      </div>
      <div v-if="gameStatus !== 'playing'" class="game-result">
        <h2>{{ gameStatus === "won" ? "挑战成功！" : "挑战失败" }}</h2>
        <p>{{ gameMessage }}</p>
        <div class="actions">
          <button class="soft" @click="startGame">再试一次</button>
          <button class="primary" @click="goHome">返回首页</button>
        </div>
      </div>
    </section>
    <section v-else-if="!current" class="empty">
      <div class="big-emoji">
        <img :src="iconPath('1f331')" alt="嫩芽" />
      </div>
      <h2>错题本空空的</h2>
      <p>答错的单词会自动来到这里。</p>
      <button class="primary" @click="goHome">返回首页</button>
    </section>
    <section
      v-else-if="isMemory"
      :class="['study-card', 'memory-card', { shake: cardShake }]"
    >
      <p class="eyebrow">
        {{ isWrong ? "错题记忆 · 拼写确认" : "先听三遍，再拼写确认" }}
      </p>
      <button class="sound" @click="speakTimes(current.word, 1)">
        <img class="ui-icon" :src="iconPath('1f50a')" alt="播放发音" />
      </button>
      <h1>{{ current.word }}</h1>
      <p class="phonetic">{{ current.phonetic }}</p>
      <div class="meaning">{{ current.meaning }}</div>
      <div class="example">
        <b>{{ example(current).en }}</b
        ><span>{{ example(current).cn }}</span>
      </div>
      <input
        ref="memoryInputRef"
        v-model="memoryAnswer"
        @keydown.enter="checkMemory"
        autocomplete="off"
        placeholder="输入这个单词，回车确认"
      />
      <div class="actions">
        <button class="soft" @click="memoryMark(false)">还不熟</button
        ><button class="primary" @click="checkMemory">记住了</button>
      </div>
      <div v-if="feedback === 'ok'" class="result ok">
        <div><b>拼写正确！再按一次回车进入下一题</b></div>
        <button class="primary" @click="move(1)">下一题 →</button>
      </div>
    </section>
    <section v-else-if="isQuiz" class="study-card quiz-card">
      <p class="eyebrow">{{ isWrong ? "错题选择" : "选出对应的英文单词" }}</p>
      <h2>{{ current.meaning }}</h2>
      <button class="hint-btn" @click="toggleExample">
        <img class="ui-icon" :src="iconPath('1f4a1')" alt="" />
        {{ showExample ? "收起例句" : "查看例句" }}
      </button>
      <div v-if="showExample" class="example mini">
        <b>{{ example(current).en }}</b
        ><span>{{ example(current).cn }}</span>
      </div>
      <div class="choices">
        <button
          v-for="(o, i) in options"
          :key="o"
          :disabled="!!feedback"
          :class="feedback ? (o === current.word ? 'correct' : 'dim') : ''"
          @click="pick(o)"
        >
          <kbd>{{ String.fromCharCode(65 + i) }}</kbd
          >{{ o }}
        </button>
      </div>
      <div v-if="feedback" :class="['result', feedback]">
        <div>
          <b>{{
            feedback === "ok"
              ? "选对了，2 秒后进入下一题"
              : `答案是 ${current.word}`
          }}</b
          ><span>{{ current.phonetic }} · {{ current.meaning }}</span>
        </div>
        <button class="primary" @click="move(1)">下一题 →</button>
      </div>
    </section>
    <section v-else class="study-card dictation-card">
      <p class="eyebrow">
        {{
          isSpelling
            ? "根据中文，默写英文单词"
            : isWrong
              ? "错题本 · 三遍听写"
              : "听三遍，拼出这个单词"
        }}
      </p>
      <h2 v-if="isSpelling || missingAudio(current)" class="spelling-meaning">
        {{ current.meaning }}
      </h2>
      <button
        v-if="!isSpelling"
        class="listen-orb"
        @click="speakTimes(current.word, 1)"
      >
        <img class="listen-icon" :src="iconPath('1f50a')" alt="播放发音" /><span
          >再听一遍</span
        ></button
      ><button v-if="!isSpelling" class="hint-btn" @click="toggleExample">
        <img class="ui-icon" :src="iconPath('1f4a1')" alt="" />
        {{ showExample ? "收起例句" : "查看例句" }}
      </button>
      <div v-if="showExample && !isSpelling" class="example mini">
        <b>{{ example(current).en }}</b
        ><span>{{ example(current).cn }}</span>
      </div>
      <input
        ref="inputRef"
        v-model="answer"
        :readonly="!!feedback"
        @keydown.enter="checkDictation"
        :placeholder="isSpelling ? '输入中文对应的英文单词' : '输入听到的单词'"
      /><button v-if="!feedback" class="primary wide" @click="checkDictation">
        检查答案
      </button>
      <div v-else :class="['result', feedback]">
        <div class="word-reveal">
          <small>{{
            feedback === "ok"
              ? `回答正确，${isWrong ? "2" : "3"} 秒后进入下一题`
              : "回答错误，正确答案是"
          }}</small>
          <b>{{ current.word }}</b>
          <span>{{ current.phonetic || "暂无音标" }}</span>
          <strong>{{ current.meaning }}</strong>
        </div>
        <button class="primary" @click="move(1)">下一题 →</button>
      </div>
    </section>
  </main>
  <main v-else class="app">
    <header class="hero">
      <div class="brand"><span>W</span> 单词口袋 · WordHop</div>
      <div class="header-actions">
        <button v-if="!store.isGuest" class="account" @click="openNotebook">我的笔记本</button>
        <label class="library-switch"
          >当前词库
          <select :value="store.selectedLibraryId" @change="changeLibrary">
            <option v-for="l in store.libraries" :key="l.id" :value="l.id">
              {{ l.name }}（{{ l.wordCount }}）
            </option>
          </select></label
        ><button
          v-if="!store.isGuest"
          class="account"
          @click="openUserLibrary"
        >
          管理我的词库</button
        ><button
          v-if="store.user.role === 'ADMIN'"
          class="account"
          @click="openAdmin"
        >
          管理后台
        </button>
        <div v-if="!store.isGuest" class="score-badge">
          <img class="ui-icon" :src="iconPath('1f464')" alt="用户" />
          {{ store.user.username }} ·
          <img class="ui-icon" :src="iconPath('2b50')" alt="积分" />
          {{ store.user.score || 0 }} 积分
        </div>
        <div class="streak">
          <img class="ui-icon" :src="iconPath('1f525')" alt="连续答对" />
          连续答对 <b>{{ store.streak }}</b> 词
        </div>
        <button class="account" @click="logout">
          {{ store.user.name }} · {{ store.isGuest ? "退出游客模式" : "退出" }}
        </button>
      </div>
    </header>
    <section class="welcome">
      <div>
        <p class="eyebrow">{{ store.selectedLibrary?.name || "当前词库" }}</p>
        <h1>把单词，<em>慢慢装进口袋。</em></h1>
        <p>
          当前共
          {{ store.words.length }} 个单词，{{
            store.isGuest
              ? "游客学习记录仅在本次访问期间有效。"
              : "上次选择会在下次登录时自动恢复。"
          }}
        </p>
      </div>
      <div class="mascot">
        <img :src="iconPath('2601')" alt="云朵" /><span>Hi!</span>
      </div>
    </section>
    <section v-if="!store.isGuest" class="pk-hub">
      <div class="pk-hub-head">
        <div>
          <p class="eyebrow">TIMED PK</p>
          <h2>限时 PK 挑战</h2>
          <p>连续完成选择、听写和默写，用时越短排名越靠前。</p>
        </div>
        <button class="primary" @click="togglePkCreator">
          {{ pkCreateOpen ? "收起" : "发起一个 PK" }}
        </button>
      </div>
      <form
        v-if="pkCreateOpen"
        class="pk-create-form"
        @submit.prevent="createPkChallenge"
      >
        <label><span>PK 名称</span><input v-model.trim="pkForm.name" required maxlength="100" /></label>
        <label
          ><span>选择词库</span
          ><select v-model.number="pkForm.libraryId" required>
            <option
              v-for="library in store.libraries"
              :key="library.id"
              :value="library.id"
            >
              {{ library.name }}（{{ library.wordCount }} 词）
            </option>
          </select></label
        >
        <label><span>开始时间</span><input v-model="pkForm.startAt" type="datetime-local" required /></label>
        <label><span>结束时间</span><input v-model="pkForm.endAt" type="datetime-local" required /></label>
        <label
          ><span>单词数量（20–100）</span
          ><input v-model.number="pkForm.wordCount" type="number" min="20" max="100" required
        /></label>
        <p class="pk-library-note">
          系统将从所选词库的全部单词中随机抽取，所有参与者使用同一组题目。
        </p>
        <p v-if="pkError" class="auth-error">{{ pkError }}</p>
        <button class="primary">创建挑战</button>
      </form>
      <div v-if="pkChallenges.length" class="pk-list">
        <article v-for="challenge in pkChallenges" :key="challenge.id">
          <div class="pk-status" :class="challenge.status.toLowerCase()">
            {{ challenge.status === "ACTIVE" ? "进行中" : challenge.status === "UPCOMING" ? "未开始" : "已结束" }}
          </div>
          <h3>{{ challenge.name }}</h3>
          <p>@{{ challenge.creator }} · {{ challenge.libraryName }} · {{ challenge.wordCount }} 词</p>
          <time>{{ formatPkDate(challenge.startAt) }} — {{ formatPkDate(challenge.endAt) }}</time>
          <small>{{ challenge.participantCount }} 人参加</small>
          <div class="actions">
            <button class="soft" @click="openPkDetail(challenge.id)">排行榜</button>
            <button v-if="store.user.role === 'ADMIN'" class="soft danger" @click="deletePkChallenge(challenge)">删除</button>
            <small v-if="challenge.myCompletedAt">上次成绩 {{ formatPkTime(challenge.myTotalMs) }}</small>
            <button
              class="primary"
              :disabled="challenge.status !== 'ACTIVE'"
              @click="startPkChallenge(challenge.id)"
            >
              {{ challenge.myStartedAt ? "重新挑战" : "参加挑战" }}
            </button>
          </div>
        </article>
      </div>
      <p v-else class="empty-inline">目前还没有可参加的 PK，来发起第一场吧。</p>
      <div class="pagination" v-if="pkPages > 1"><button class="soft" :disabled="pkPage <= 1" @click="changePkPage(pkPage - 1)">上一页</button><span>{{ pkPage }} / {{ pkPages }}</span><button class="soft" :disabled="pkPage >= pkPages" @click="changePkPage(pkPage + 1)">下一页</button></div>
      <p class="empty-inline">挑战有效期内可重新参加，重新开始将重置计时及上次成绩。</p>
    </section>
    <section v-if="!store.isGuest" class="message-board">
      <div class="board-compose">
        <div>
          <p class="eyebrow">MESSAGE BOARD</p>
          <h3>留言板</h3>
        </div>
        <textarea
          v-model="messageText"
          maxlength="100"
          placeholder="写下想和大家分享的话（最多 100 字）"
        ></textarea>
        <span>{{ messageText.length }} / 100</span>
        <button
          class="primary"
          :disabled="!messageText.trim()"
          @click="sendMessage"
        >
          发布留言
        </button>
      </div>
      <div class="message-history">
        <article v-for="m in messages" :key="m.id">
          <div class="message-meta">
            <b>@{{ m.username }}</b>
            <button
              v-if="m.userId === store.user.id || store.user.role === 'ADMIN'"
              class="message-delete"
              title="删除留言"
              @click="deleteMessage(m.id)"
            >
              ×
            </button>
          </div>
          <p>{{ m.content }}</p>
          <time>{{ new Date(m.createdAt).toLocaleString() }}</time>
        </article>
        <div class="board-pages">
          <button
            class="soft"
            :disabled="messagePage <= 1"
            @click="loadMessages(messagePage - 1)"
          >
            上一页
          </button>
          <span>{{ messagePage }} / {{ messagePages }}</span>
          <button
            class="soft"
            :disabled="messagePage >= messagePages"
            @click="loadMessages(messagePage + 1)"
          >
            下一页
          </button>
        </div>
      </div>
    </section>
    <section class="stats">
      <div>
        <b>{{ store.mastered.length }}</b
        ><span>已掌握</span>
      </div>
      <div>
        <b>{{ store.wrong.length }}</b
        ><span>待复习</span>
      </div>
      <div class="progress-stat">
        <b>{{ pct }}%</b><span>总进度</span
        ><i><u :style="{ width: `${pct}%` }" /></i>
      </div>
    </section>
    <div class="section-head">
      <div>
        <p class="eyebrow">LEARNING PATH</p>
        <h2>选择一个单元</h2>
      </div>
      <label
        >每单元
        <select v-model.number="store.unitSize">
          <option>10</option>
          <option>20</option>
          <option>30</option>
          <option>50</option>
        </select>
        词</label
      >
    </div>
    <section v-if="store.words.length" class="units">
      <article
        v-for="(_, i) in totalUnits"
        :key="i"
        :data-unit-index="i"
        :class="['unit', { 'last-visited-unit': i === trackedUnit() }]"
      >
        <div class="unit-no">{{ String(i + 1).padStart(2, "0") }}</div>
        <div class="unit-info">
          <h3>
            Unit {{ i + 1 }}
            <span class="perfect-badges">
              <small>听写全对 {{ perfectCount("dictation", i) }} 次</small>
              <small>选择全对 {{ perfectCount("quiz", i) }} 次</small>
              <small>默写全对 {{ perfectCount("spelling", i) }} 次</small>
            </span>
          </h3>
          <p>
            {{
              store.words
                .slice(i * store.unitSize, i * store.unitSize + 3)
                .map((w) => w.word)
                .join(" · ")
            }}
          </p>
          <div class="unit-progress">
            <span
              :style="{
                width: `${(store.words.slice(i * store.unitSize, (i + 1) * store.unitSize).filter((w) => store.mastered.includes(w.id)).length / store.words.slice(i * store.unitSize, (i + 1) * store.unitSize).length) * 100}%`,
              }"
            />
          </div>
        </div>
        <div class="mode-buttons">
          <button @click="open('memory', i)">
            <img class="ui-icon" :src="iconPath('1f9e0')" alt="" /> 记忆</button
          ><button @click="open('dictation', i)">
            <img class="ui-icon" :src="iconPath('1f3a7')" alt="" /> 听写</button
          ><button @click="open('spelling', i)">
            <img class="ui-icon" :src="iconPath('270d')" alt="" /> 默写</button
          ><button @click="open('quiz', i)">
            <img class="ui-icon" :src="iconPath('2728')" alt="" /> 选择</button
          ><button class="game-button" @click="openGame(i)">
            <img class="ui-icon" :src="iconPath('1f3af')" alt="" /> 游戏
          </button>
        </div>
      </article>
    </section>
    <section v-else class="empty-inline home-empty">
      这个词库还没有单词，请先进入“管理我的词库”添加。
    </section>
    <section class="wrong-area">
      <div>
        <span><img class="section-icon" :src="iconPath('1f4d2')" alt="错题本" /></span>
        <div>
          <b>错题本</b
          ><small>{{
            store.wrong.length
              ? `${store.wrong.length} 个单词等你复习`
              : "目前没有错题，继续保持！"
          }}</small>
        </div>
      </div>
      <div class="mode-buttons">
        <button @click="open('wrong-memory')">
          <img class="ui-icon" :src="iconPath('1f9e0')" alt="" /> 记忆错题</button
        ><button @click="open('wrong-dictation')">
          <img class="ui-icon" :src="iconPath('1f3a7')" alt="" /> 听写错题</button
        ><button @click="open('wrong-quiz')">
          <img class="ui-icon" :src="iconPath('2728')" alt="" /> 选择错题
        </button>
      </div>
    </section>
  </main>
  <div v-if="store.user && !store.isGuest" class="pet-layer">
    <button
      v-for="(_, i) in petCount"
      :key="i"
      class="edge-pet"
      :style="petStyle(i)"
      :title="`宠物 ${i + 1} · 可拖动，点击听叫声`"
      @pointerdown.prevent="startPetDrag($event, i)"
      @click="playPetSound(i)"
    >
      <span
        ><img :src="petIcons[i % petIcons.length]" :alt="`宠物 ${i + 1}`"
      /></span>
    </button>
  </div>
  <button
    v-if="store.user && !store.isGuest"
    class="password-fab"
    @click="
      passwordOpen = true;
      passwordMessage = '';
    "
  >
    <img class="ui-icon" :src="iconPath('1f510')" alt="" /> 修改密码
  </button>
  <button
    v-if="store.user && view === 'home'"
    class="scroll-top"
    title="返回页面顶部"
    @click="scrollTop"
  >
    ↑
  </button>
  <div v-if="store.user && !store.isGuest && view === 'home'" class="home-rewards">
    <button @click="redeemPets">
      <img class="ui-icon" :src="iconPath('1f3e1')" alt="" />
      宠物回归（{{ petCount }}）
    </button>
    <button @click="openLeaderboard()">
      <img class="ui-icon" :src="iconPath('1f3c6')" alt="" /> 查看积分榜
    </button>
  </div>
  <div v-if="completed" class="modal">
    <section class="complete-card">
      <div class="big-emoji">
        <img :src="iconPath('1f389')" alt="完成" />
      </div>
      <p class="eyebrow">UNIT COMPLETE</p>
      <h2>这个单元完成啦！</h2>
      <p>已经走完本轮 {{ pool.length }} 个单词。</p>
      <p v-if="rewardMessage" class="reward-message">
        <img class="ui-icon" :src="iconPath('2b50')" alt="" />
        {{ rewardMessage }}
      </p>
      <p v-if="runWrongWords.length" class="wrong-summary">
        答错单词：{{ runWrongWords.join("、") }}
      </p>
      <div class="actions">
        <button class="soft" @click="restart">再来一遍</button
        ><button class="primary" @click="goHome">返回首页</button>
      </div>
    </section>
  </div>
  <div v-if="forgotOpen" class="modal">
    <form class="complete-card account-dialog" @submit.prevent="forgotPassword">
      <h2>找回密码</h2>
      <p>仅限邮箱已验证且状态正常的账户。新密码将发送到注册邮箱。</p>
      <input
        v-model.trim="forgotEmail"
        type="email"
        placeholder="注册邮箱"
        required
        autofocus
      />
      <div class="actions">
        <button type="button" class="soft" @click="forgotOpen = false">
          取消</button
        ><button class="primary">发送新密码</button>
      </div>
    </form>
  </div>
  <div v-if="passwordOpen" class="modal">
    <form class="complete-card account-dialog" @submit.prevent="changePassword">
      <h2>修改登录密码</h2>
      <input
        v-model="passwordForm.oldPassword"
        type="password"
        placeholder="原密码"
        required
      /><input
        v-model="passwordForm.newPassword"
        type="password"
        placeholder="新密码（至少 8 位）"
        required
        minlength="8"
      /><input
        v-model="passwordForm.confirmPassword"
        type="password"
        placeholder="再次输入新密码"
        required
        minlength="8"
      />
      <p v-if="passwordMessage" class="auth-notice">{{ passwordMessage }}</p>
      <div class="actions">
        <button type="button" class="soft" @click="passwordOpen = false">
          关闭</button
        ><button class="primary">确认修改</button>
      </div>
    </form>
  </div>
  <div v-if="resetTarget" class="modal">
    <section class="complete-card account-dialog">
      <h2>重置 {{ resetTarget.name }} 的密码</h2>
      <p>
        新密码会发送到
        {{ resetTarget.email }}。可以输入指定密码，或由系统随机生成。
      </p>
      <input
        v-model="resetPassword"
        type="password"
        placeholder="指定新密码（至少 8 位）"
      />
      <div class="actions">
        <button class="soft" @click="resetTarget = null">取消</button
        ><button
          class="soft"
          @click="
            resetPassword = '';
            resetUserPassword();
          "
        >
          随机生成并发送</button
        ><button
          class="primary"
          :disabled="resetPassword.length < 8"
          @click="resetUserPassword"
        >
          使用指定密码
        </button>
      </div>
    </section>
  </div>
  <div v-if="adminWordEditorOpen" class="modal">
    <form
      class="complete-card admin-word-dialog"
      @submit.prevent="saveAdminWord"
    >
      <h2>{{ adminWordEditingId ? "编辑单词" : "新增单词" }}</h2>
      <label>
        <span>所属分类</span>
        <select v-model.number="adminWordForm.libraryId" required>
          <option
            v-for="library in adminWordLibraries"
            :key="library.id"
            :value="library.id"
          >
            {{ adminLibraryLabel(library) }}
          </option>
        </select>
      </label>
      <div class="admin-word-form-grid">
        <label>
          <span>英文单词</span>
          <input
            v-model.trim="adminWordForm.word"
            required
            maxlength="120"
            placeholder="例如：vocabulary"
          />
        </label>
        <label>
          <span>音标</span>
          <input
            v-model.trim="adminWordForm.phonetic"
            maxlength="255"
            placeholder="例如：/vəˈkæbjələri/"
          />
        </label>
      </div>
      <label>
        <span>中文释义</span>
        <textarea
          v-model.trim="adminWordForm.meaning"
          required
          maxlength="4000"
          placeholder="请输入中文释义"
        ></textarea>
      </label>
      <label>
        <span>英文例句</span>
        <textarea
          v-model.trim="adminWordForm.exampleEn"
          maxlength="4000"
          placeholder="可选"
        ></textarea>
      </label>
      <label>
        <span>例句中文</span>
        <textarea
          v-model.trim="adminWordForm.exampleCn"
          maxlength="4000"
          placeholder="可选"
        ></textarea>
      </label>
      <label>
        <span>数据来源</span>
        <select v-model="adminWordForm.source">
          <option value="LOCAL">本地基础数据</option>
          <option value="MANUAL">手工录入</option>
          <option value="BASE">其他词库</option>
          <option value="INTERNET">互联网</option>
        </select>
      </label>
      <small class="form-help"
        >新增时会自动查找或下载同名单词的发音文件。</small
      >
      <p v-if="adminWordError" class="auth-error">{{ adminWordError }}</p>
      <div class="actions">
        <button
          type="button"
          class="soft"
          @click="adminWordEditorOpen = false"
        >
          取消</button
        ><button class="primary">保存</button>
      </div>
    </form>
  </div>
  <div v-if="pkDetail && view !== 'pk'" class="modal">
    <section class="complete-card pk-detail-card">
      <p class="eyebrow">TIMED PK</p>
      <h2>{{ pkDetail.name }}</h2>
      <p>@{{ pkDetail.creator }} · {{ pkDetail.libraryName }} · {{ pkDetail.wordCount }} 词</p>
      <time>{{ formatPkDate(pkDetail.startAt) }} — {{ formatPkDate(pkDetail.endAt) }}</time>
      <div class="pk-ranking">
        <h3>成绩排行</h3>
        <ol v-if="pkDetail.rankings?.length">
          <li v-for="item in pkDetail.rankings" :key="item.rank">
            <b>{{ item.rank }}</b><span>@{{ item.username }}</span
            ><strong>{{ formatPkTime(item.totalMs) }}</strong>
          </li>
        </ol>
        <p v-else>还没有用户完成挑战。</p>
      </div>
      <div class="actions">
        <button class="soft" @click="pkDetail = null">关闭</button>
        <button
          class="primary"
          :disabled="pkDetail.status !== 'ACTIVE' || !!pkDetail.mine?.completedAt"
          @click="startPkChallenge(pkDetail.id)"
        >
          {{ pkDetail.mine?.completedAt ? "已经完成" : "参加挑战" }}
        </button>
      </div>
    </section>
  </div>
  <div v-if="leaderboardOpen" class="modal">
    <section class="complete-card leaderboard-card">
      <h2>积分排行榜</h2>
      <p>每一次坚持，都在榜单上留下痕迹。</p>
      <ol>
        <li v-for="item in leaderboard" :key="item.rank">
          <b>{{ item.rank }}</b
          ><span>{{ item.username }}</span
          ><strong>{{ item.score }} 分</strong>
        </li>
      </ol>
      <div class="board-pages">
        <button
          class="soft"
          :disabled="leaderboardPage <= 1"
          @click="openLeaderboard(leaderboardPage - 1)"
        >
          上一页
        </button>
        <span>{{ leaderboardPage }} / {{ leaderboardPages }}</span>
        <button
          class="soft"
          :disabled="leaderboardPage >= leaderboardPages"
          @click="openLeaderboard(leaderboardPage + 1)"
        >
          下一页
        </button>
      </div>
      <button class="primary wide" @click="leaderboardOpen = false">
        关闭
      </button>
    </section>
  </div>
</template>
