const styleOptions = {
  xiaohei: { preset: "xiaohei", line: "fine", background: "white", whitespace: "spacious", accent: "#ff6b20", custom: "" }
};
const savedStyle = localStorage.getItem("meimei-style");
const defaultStyle = { ...(styleOptions[savedStyle] || styleOptions.xiaohei) };
const defaultCharacter = { id: "meimei", enabled: true, archetype: "custom", name: "咩咩", shape: "bean", eyes: "dots", expression: "curious", accessory: "none", personality: "温柔、专注、安静好奇", custom: "极简黑白手绘女性角色；始终保留高盘发、额前弧形碎发和两侧松散发丝；只使用少量橙色点缀", referenceUrl: "/characters/meimei.png" };
const LIBRARY_KEY = "peitu-character-library";
const SELECTED_CHARACTER_KEY = "peitu-selected-character-id";
const TOKEN_KEY = "imagecraft-token";
const authState = { user: null };
function readCharacterLibrary() {
  let library = [];
  try {
    const saved = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]");
    library = Array.isArray(saved) ? saved.filter((item) => item?.referenceUrl && item.name) : [];
  } catch { library = []; }
  library = library.map((item, index) => ({ ...item, id: item.id || `character-${index}-${Date.now()}` }));
  try {
    const legacy = JSON.parse(localStorage.getItem("xiaohei-character") || "null");
    if (legacy?.referenceUrl && legacy.referenceUrl !== "/characters/meimei.png" && legacy.name !== "小黑" && !library.some((item) => item.referenceUrl === legacy.referenceUrl)) {
      library.unshift({ ...legacy, id: `legacy-${Date.now()}`, createdAt: new Date().toISOString() });
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(library.slice(0, 10)));
    }
  } catch {}
  return [defaultCharacter, ...library.filter((item) => item.id !== "meimei")];
}
let characterLibrary = readCharacterLibrary();
const selectedCharacterId = localStorage.getItem(SELECTED_CHARACTER_KEY);
const savedCharacter = characterLibrary.find((item) => item.id === selectedCharacterId) || characterLibrary[0] || defaultCharacter;
const state = { step: 1, count: 1, shots: [], activeShots: [], results: [], style: { ...defaultStyle, character: savedCharacter }, character: savedCharacter };
let characterSearchTerm = "";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const sample = `我们常常以为，灵感是一种偶然到访的东西。于是打开空白文档，等一个好念头从天花板上掉下来。\n\n但真正稳定的内容生产，不靠等待，而靠打捞。日常对话、项目复盘、读书笔记和失败记录，都是漂在水面下的素材。问题不是没有灵感，而是没有把它们捞起来的动作。\n\n先记录，再判断。记录时不要急着证明价值；判断时只问一件事：这条信息能不能帮助某个具体的人看清一个问题？\n\n当素材被持续收集、筛选和重新组合，灵感就不再是一场天气，而变成一套可以重复启动的小机器。`;

// 一次性草稿:仅用于"去角色工作室"往返时保留文章,恢复后立即销毁,普通刷新不残留
const articleDraft = sessionStorage.getItem("imagecraft-article-draft");
if (articleDraft) {
  $("#article").value = articleDraft;
  sessionStorage.removeItem("imagecraft-article-draft");
}

function setFieldError(inputId, message) {
  const input = $("#" + inputId);
  if (!input) return;
  input.classList.add("input-invalid");
  let tip = input.parentElement.querySelector(".field-error");
  if (!tip) {
    tip = document.createElement("span");
    tip.className = "field-error";
    input.parentElement.appendChild(tip);
  }
  tip.textContent = message;
  input.focus();
}

function clearFieldErrors(formId) {
  const form = $("#" + formId);
  if (!form) return;
  form.querySelectorAll(".input-invalid").forEach((el) => el.classList.remove("input-invalid"));
  form.querySelectorAll(".field-error").forEach((el) => el.remove());
}

function authNotice(formId, type, message) {
  const form = $("#" + formId);
  if (!form) return;
  form.querySelector(".auth-notice")?.remove();
  if (!message) return;
  const box = document.createElement("p");
  box.className = "auth-notice " + type;
  box.textContent = message;
  form.prepend(box);
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2300);
}

async function request(url, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const auth = token ? { authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...auth, ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "请求失败");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function fetchMe() {
  if (!localStorage.getItem(TOKEN_KEY)) { authState.user = null; return null; }
  try {
    const data = await request("/api/me");
    authState.user = data.user;
  } catch {
    authState.user = null;
    localStorage.removeItem(TOKEN_KEY);
  }
  return authState.user;
}

function go(step) {
  state.step = step;
  $$(".panel").forEach((panel, index) => panel.classList.toggle("active", index + 1 === step));
  $$(".step").forEach((button, index) => button.classList.toggle("active", index + 1 === step));
  $(".workspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncArticle() {
  $("#charCount").textContent = $("#article").value.length.toLocaleString("zh-CN");
}

function renderShots() {
  $("#shotList").innerHTML = state.shots.map((shot, index) => `
    <article class="shot" data-id="${shot.id}">
      <input class="shot-check" type="checkbox" ${shot.selected ? "checked" : ""} aria-label="选择第 ${index + 1} 张配图" />
      <div class="shot-fields">
        <input class="shot-title" value="${escapeHtml(shot.title)}" aria-label="配图主题" />
        <textarea class="shot-idea" rows="2" aria-label="核心意思">${escapeHtml(shot.coreIdea)}</textarea>
        <textarea class="shot-action" rows="2" aria-label="角色动作">${escapeHtml(shot.action)}</textarea>
      </div>
      <span class="shot-tag">${escapeHtml(shot.structure)}</span>
    </article>`).join("");
}

function pullShots() {
  $$(".shot").forEach((card) => {
    const shot = state.shots.find((item) => item.id === card.dataset.id);
    shot.selected = card.querySelector(".shot-check").checked;
    shot.title = card.querySelector(".shot-title").value.trim();
    shot.coreIdea = card.querySelector(".shot-idea").value.trim();
    shot.action = card.querySelector(".shot-action").value.trim();
  });
}

function escapeHtml(text = "") {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function currentUser() {
  return authState.user;
}

function openAuth(tab = currentUser() ? "profile" : "login") {
  $("#authModal").hidden = false;
  setAuthTab(tab);
  renderAccount();
}

function closeAuth() {
  $("#authModal").hidden = true;
}

function setAuthTab(tab) {
  $$(".auth-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.authTab === tab));
  $$(".auth-form").forEach((panel) => panel.classList.toggle("active", panel.dataset.authPanel === tab));
  const resetForm = $("#resetForm");
  if (resetForm) { resetForm.hidden = true; resetForm.classList.remove("active"); }
  const loginForm = $("#loginForm");
  if (loginForm) loginForm.hidden = false;
  if (tab === "profile") renderProfileForm();
}

function renderAccount() {
  const user = currentUser();
  const area = $("#accountArea");
  if (!area) return;
  area.innerHTML = user ? `
    <button class="account-entry signed-in" id="openAuth" type="button"><span>${escapeHtml(user.phone)}</span><small>剩余 ${user.remaining} 张</small></button>
    <button class="account-logout" id="logoutButton" type="button">退出</button>
  ` : `<button class="account-entry" id="openAuth" type="button">登录 / 注册</button>`;
  $("#openAuth")?.addEventListener("click", () => openAuth(user ? "profile" : "login"));
  $("#logoutButton")?.addEventListener("click", async () => {
    try { await request("/api/auth/logout", { method: "POST" }); } catch {}
    localStorage.removeItem(TOKEN_KEY);
    authState.user = null;
    renderAccount();
    renderProfileForm();
    toast("已退出登录");
  });
}

function renderProfileForm() {
  const user = currentUser();
  const empty = $("#profileEmpty");
  const fields = $("#profileFields");
  if (!empty || !fields) return;
  empty.hidden = Boolean(user);
  fields.hidden = !user;
  if (!user) return;
  $("#profileName").value = user.phone;
  if ($("#profileQuota")) $("#profileQuota").value = `已用 ${user.used} / 共 ${user.quota} 张（剩余 ${user.remaining} 张）`;
}

async function registerUser(event) {
  event.preventDefault();
  clearFieldErrors("registerForm");
  authNotice("registerForm", "err", "");
  const phone = $("#registerPhone").value.trim();
  const invite = $("#registerInvite").value.trim();
  const password = $("#registerPassword").value;
  const confirmPassword = $("#registerPasswordConfirm").value;
  if (!/^1\d{10}$/.test(phone)) return setFieldError("registerPhone", "请输入 11 位手机号");
  if (!invite) return setFieldError("registerInvite", "请输入邀请码");
  if (password.length < 6) return setFieldError("registerPassword", "密码至少 6 位");
  if (password !== confirmPassword) return setFieldError("registerPasswordConfirm", "两次输入的密码不一致");
  if (!$("#registerAgreement").checked) return authNotice("registerForm", "err", "请先勾选同意用户协议和隐私政策");
  try {
    const smsCode = smsEnabled ? $("#registerCode").value.trim() : undefined;
    if (smsEnabled && !smsCode) return setFieldError("registerCode", "请输入短信验证码");
    const data = await request("/api/auth/register", { method: "POST", body: JSON.stringify({ phone, password, invite, code: smsCode }) });
    const quota = data.user.quota;
    $("#registerForm").reset();
    setAuthTab("login");
    $("#loginName").value = phone;
    authNotice("loginForm", "ok", `注册成功！你有 ${quota} 张免费生成额度，请输入密码登录`);
    $("#loginPassword")?.focus();
    toast("注册成功，请登录");
  } catch (error) {
    const message = error.message || "注册失败，请重试";
    if (message.includes("手机号")) setFieldError("registerPhone", message);
    else if (message.includes("邀请码")) setFieldError("registerInvite", message);
    else if (message.includes("密码")) setFieldError("registerPassword", message);
    else authNotice("registerForm", "err", message);
  }
}

async function loginUser(event) {
  event.preventDefault();
  clearFieldErrors("loginForm");
  const phone = $("#loginName").value.trim();
  const password = $("#loginPassword").value;
  if (!/^1\d{10}$/.test(phone)) return setFieldError("loginName", "请输入 11 位手机号");
  if (!password) return setFieldError("loginPassword", "请输入密码");
  try {
    const data = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ phone, password }) });
    localStorage.setItem(TOKEN_KEY, data.token);
    authState.user = data.user;
    $("#loginForm").reset();
    authNotice("loginForm", "ok", "");
    renderAccount();
    setAuthTab("profile");
    renderProfileForm();
    toast(`欢迎回来，${data.user.phone}`);
  } catch (error) {
    authNotice("loginForm", "err", error.message || "登录失败，请重试");
  }
}

function saveProfile(event) {
  event.preventDefault();
  toast("MVP 阶段暂无可保存资料");
}

function renderCharacterLibrary() {
  const grid = $("#characterLibraryGrid");
  if (!grid) return;
  const hasCustomCharacters = characterLibrary.some((character) => character.id !== "meimei");
  const keyword = characterSearchTerm.trim().toLowerCase();
  const matchedCharacters = characterLibrary.filter((character) => !keyword || String(character.name || "").toLowerCase().includes(keyword));
  const rows = matchedCharacters.map((character) => `
    <article class="character-row ${character.id === state.character.id ? "active" : ""}" data-id="${escapeHtml(character.id)}">
      <span class="character-row-image"><img src="${escapeHtml(character.referenceUrl)}" alt="" /></span>
      <span class="character-row-main">
        <b>${escapeHtml(character.name || "专属角色")}</b>
        <small>${character.id === "meimei" ? "预设角色" : "自定义角色"}</small>
      </span>
      <span class="character-row-actions">
        ${character.id === state.character.id ? '<em>使用中</em>' : '<button data-action="select" type="button">使用</button>'}
        ${character.id === "meimei" ? "" : '<button class="danger" data-action="delete" type="button">删除</button>'}
      </span>
    </article>`).join("");
  const empty = hasCustomCharacters ? `
    <div class="character-empty-state">
      <b>没有找到这个角色</b>
      <a href="/character.html">去角色工作室创建 →</a>
    </div>` : `
    <a class="character-empty-state add" href="/character.html">
      <i>＋</i>
      <b>待加入角色</b>
      <small>创建一个专属插图角色</small>
    </a>`;
  grid.innerHTML = rows || empty;
  $("#characterStatus").textContent = "从照片生成你的专属插图角色";
  $("#selectedCharacterLine").textContent = `当前使用：${state.character.name || "专属角色"}`;
  $("#generateButton span").textContent = `用${state.character.name || "角色"}生成配图`;
}

function resultCard(shot, index) {
  return `<article class="art-card" id="result-${index}">
    <div class="art-frame"><div class="loader"></div></div>
    <div class="art-info"><h3>${escapeHtml(shot.title)}</h3><span>第 ${index + 1} 张</span></div>
  </article>`;
}

function updateDownloadAllState() {
  const button = $("#downloadAllButton");
  if (!button) return;
  const successCount = state.results.filter((item) => item?.url).length;
  button.disabled = successCount === 0;
  $("#downloadHint").textContent = successCount ? `已有 ${successCount} 张可下载。浏览器可能会询问是否允许多个文件下载。` : "生成完成后可批量下载已成功的图片。";
}

function renderResultSuccess(card, shot, result, index) {
  card.querySelector(".art-frame").innerHTML = `<img src="${result.url}" alt="${escapeHtml(shot.title)}" /><span class="ai-tag">AI生成</span>`;
  card.querySelector(".art-info").innerHTML = `
    <h3>${escapeHtml(shot.title)}</h3>
    <span class="art-actions">
      <a class="download" href="${result.url}" download="imagecraft-${index + 1}.png">下载 PNG ↓</a>
      <button class="retry-image" data-index="${index}" type="button">重新生成</button>
    </span>`;
}

function renderResultError(card, shot, error, index) {
  card.querySelector(".art-frame").innerHTML = `<div class="error-card">生成失败<br />${escapeHtml(error.message)}</div>`;
  card.querySelector(".art-info").innerHTML = `
    <h3>${escapeHtml(shot.title)}</h3>
    <span class="art-actions">
      <button class="retry-image" data-index="${index}" type="button">重试这一张</button>
    </span>`;
}

function startProgress(frame, stageEl) {
  // 模拟进度:3秒内到30%,之后渐进逼近93%,出图时外部调用finish()跳到100%
  const startAt = Date.now();
  frame.innerHTML = `<div class="gen-progress"><span class="pct">0%</span><span class="bar"><i></i></span><span class="stage">正在连接生图模型…</span></div>`;
  const pctEl = frame.querySelector(".pct");
  const barEl = frame.querySelector(".bar i");
  const stgEl = frame.querySelector(".stage");
  const stages = [
    [0, "正在连接生图模型…"],
    [10, "模型正在理解画面结构…"],
    [35, "正在绘制线稿…"],
    [65, "正在细化角色与标注…"],
    [85, "即将完成,正在传输图片…"]
  ];
  const timer = setInterval(() => {
    const seconds = (Date.now() - startAt) / 1000;
    let pct;
    if (seconds <= 3) pct = seconds / 3 * 30;
    else pct = 30 + 63 * (1 - Math.exp(-(seconds - 3) / 18));
    pct = Math.min(93, pct);
    pctEl.textContent = `${Math.floor(pct)}%`;
    barEl.style.width = `${pct}%`;
    const stage = stages.filter(([at]) => pct >= at).pop();
    stgEl.textContent = `${stage[1]} · 已用 ${Math.floor(seconds)} 秒`;
  }, 250);
  return {
    finish() {
      clearInterval(timer);
      pctEl.textContent = "100%";
      barEl.style.width = "100%";
      stgEl.textContent = "完成";
    },
    stop() { clearInterval(timer); }
  };
}

async function generateOne(index) {
  const shot = state.activeShots[index];
  const card = $(`#result-${index}`);
  if (!shot || !card) return;
  state.results[index] = null;
  updateDownloadAllState();
  const progress = startProgress(card.querySelector(".art-frame"));
  card.querySelector(".art-info").innerHTML = `<h3>${escapeHtml(shot.title)}</h3><span>第 ${index + 1} 张生成中</span>`;
  try {
    const result = await request("/api/generate", { method: "POST", body: JSON.stringify({ shot, style: state.style }) });
    state.results[index] = result;
    progress.finish();
    await new Promise((resolve) => setTimeout(resolve, 350));
    renderResultSuccess(card, shot, result, index);
    if (result.quota && authState.user) {
      authState.user.used = result.quota.used;
      authState.user.remaining = result.quota.remaining;
      renderAccount();
    }
  } catch (error) {
    progress.stop();
    state.results[index] = { error: error.message };
    renderResultError(card, shot, error, index);
    if (error.status === 401) { toast("请先登录再生成插图"); openAuth("login"); }
    if (error.status === 403) toast(error.message);
  }
  updateDownloadAllState();
}

async function generateAll() {
  pullShots();
  const chosen = state.shots.filter((shot) => shot.selected);
  if (!chosen.length) return toast("至少选择一张配图方案");
  go(3);
  state.activeShots = chosen;
  state.results = Array(chosen.length).fill(null);
  $("#gallery").innerHTML = chosen.map(resultCard).join("");
  $("#resultSummary").textContent = `正在生成 ${chosen.length} 张配图，请稍等。`;
  updateDownloadAllState();

  const CONCURRENCY = 3;
  let cursor = 0;
  const updateBatchProgress = () => {
    const done = state.results.filter((item) => item && (item.url || item.error)).length;
    $("#resultSummary").textContent = `生成中… 已完成 ${done} / ${chosen.length} 张`;
  };
  updateBatchProgress();
  const originalGenerate = generateOne;
  const trackedWorker = async () => {
    while (cursor < chosen.length) {
      const index = cursor;
      cursor += 1;
      await originalGenerate(index);
      updateBatchProgress();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chosen.length) }, trackedWorker));
  const successCount = state.results.filter((item) => item?.url).length;
  $("#resultSummary").textContent = `完成 ${successCount} 张。${state.results.some((item) => item?.demo) ? "当前为演示模式，配置 API Key 后将逐张生成不同图片。" : "图片已保存到服务端 outputs 目录。"}`;
}

$("#article").addEventListener("input", syncArticle);
$("#presetGrid").addEventListener("click", (event) => {
  const preset = event.target.closest(".preset");
  if (!preset) return;
  const selected = styleOptions[preset.dataset.preset];
  state.style = { ...selected, character: state.character };
  localStorage.setItem("meimei-style", preset.dataset.preset);
  $$("#presetGrid .preset").forEach((item) => item.classList.toggle("active", item === preset));
});
$("#characterLibraryGrid").addEventListener("click", (event) => {
  const row = event.target.closest(".character-row");
  if (!row) return;
  const character = characterLibrary.find((item) => item.id === row.dataset.id);
  if (!character) return;
  const action = event.target.closest("button")?.dataset.action || "select";
  if (action === "delete") {
    if (character.id === "meimei") return;
    if (!confirm(`确定删除角色「${character.name || "专属角色"}」吗？这个操作只会删除本地角色库记录。`)) return;
    characterLibrary = characterLibrary.filter((item) => item.id === "meimei" || item.id !== character.id);
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(characterLibrary.filter((item) => item.id !== "meimei")));
    if (state.character.id === character.id) {
      state.character = defaultCharacter;
      state.style = { ...state.style, character: defaultCharacter };
      localStorage.setItem(SELECTED_CHARACTER_KEY, "meimei");
      localStorage.setItem("xiaohei-character", JSON.stringify(defaultCharacter));
    }
    renderCharacterLibrary();
    toast(`已删除角色：${character.name || "专属角色"}`);
    return;
  }
  state.character = character;
  state.style = { ...state.style, character };
  localStorage.setItem(SELECTED_CHARACTER_KEY, character.id);
  localStorage.setItem("xiaohei-character", JSON.stringify(character));
  renderCharacterLibrary();
  toast(`已选择角色：${character.name || "专属角色"}`);
});
$("#characterSearch").addEventListener("input", (event) => {
  characterSearchTerm = event.target.value;
  renderCharacterLibrary();
});
$(".character-jump").addEventListener("click", () => sessionStorage.setItem("imagecraft-article-draft", $("#article").value));
$("#sampleButton").addEventListener("click", () => { $("#article").value = sample; syncArticle(); toast("示例文章已放入"); });
$("#accountArea")?.addEventListener("click", (event) => {
  if (event.target.closest("#openAuth")) openAuth(currentUser() ? "profile" : "login");
});
$$("[data-auth-close]").forEach((item) => item.addEventListener("click", closeAuth));
$$(".auth-tabs button").forEach((button) => button.addEventListener("click", () => setAuthTab(button.dataset.authTab)));
$$("[data-auth-tab-link]").forEach((button) => button.addEventListener("click", () => setAuthTab(button.dataset.authTabLink)));
$("#registerForm")?.addEventListener("submit", registerUser);
$("#loginForm")?.addEventListener("submit", loginUser);
$("#profileForm")?.addEventListener("submit", saveProfile);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#authModal")?.hidden) closeAuth();
});
$("#countPicker").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  state.count = Number(button.dataset.count);
  $$("#countPicker button").forEach((item) => item.classList.toggle("active", item === button));
});
$("#planButton").addEventListener("click", async () => {
  const article = $("#article").value.trim();
  const button = $("#planButton");
  button.disabled = true;
  button.querySelector("span").textContent = "正在生成配图方案…";
  try {
    const result = await request("/api/plan", { method: "POST", body: JSON.stringify({ article, count: state.count }) });
    state.shots = result.shots;
    renderShots();
    go(2);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.querySelector("span").textContent = "生成配图方案"; }
});
$("#generateButton").addEventListener("click", generateAll);
$("#gallery").addEventListener("click", async (event) => {
  const button = event.target.closest(".retry-image");
  if (!button) return;
  button.disabled = true;
  button.textContent = "重试中…";
  await generateOne(Number(button.dataset.index));
});
$("#downloadAllButton").addEventListener("click", () => {
  const urls = state.results.map((item, index) => item?.url ? { url: item.url, index } : null).filter(Boolean);
  if (!urls.length) return toast("还没有可下载的图片");
  urls.forEach((item, order) => {
    setTimeout(() => {
      const link = document.createElement("a");
      link.href = item.url;
      link.download = `imagecraft-${item.index + 1}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }, order * 180);
  });
  toast(`开始下载 ${urls.length} 张图片`);
});
$("#restartButton").addEventListener("click", () => { state.shots = []; state.activeShots = []; state.results = []; $("#gallery").innerHTML = ""; updateDownloadAllState(); go(1); });
$$('.back').forEach((button) => button.addEventListener("click", () => go(Number(button.dataset.target))));
$$('.step').forEach((button) => button.addEventListener("click", () => {
  const target = Number(button.dataset.step);
  if (target === 1 || (target === 2 && state.shots.length) || (target === 3 && state.results.length)) go(target);
}));

let smsEnabled = false;
function applySmsVisibility() {
  document.querySelectorAll(".sms-only").forEach((el) => { el.hidden = !smsEnabled; });
}

function bindSendCode(buttonId, phoneInputId, purpose) {
  const button = $(buttonId);
  if (!button) return;
  button.addEventListener("click", async () => {
    const phone = $(phoneInputId).value.trim();
    if (!/^1\d{10}$/.test(phone)) return toast("请先输入 11 位手机号");
    button.disabled = true;
    try {
      await request("/api/auth/send-code", { method: "POST", body: JSON.stringify({ phone, purpose }) });
      toast("验证码已发送，请查收短信");
      let left = 60;
      const original = button.textContent;
      button.textContent = `${left}秒后重发`;
      const timer = setInterval(() => {
        left -= 1;
        if (left <= 0) { clearInterval(timer); button.disabled = false; button.textContent = original; }
        else button.textContent = `${left}秒后重发`;
      }, 1000);
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  });
}
bindSendCode("#registerSendCode", "#registerPhone", "register");
bindSendCode("#resetSendCode", "#resetPhone", "reset");

$("#forgotLink")?.addEventListener("click", (event) => {
  event.preventDefault();
  if (!smsEnabled) return authNotice("loginForm", "err", "短信服务尚未开通，请联系管理员重置密码");
  $("#loginForm").classList.remove("active");
  $("#loginForm").hidden = true;
  $("#resetForm").hidden = false;
  $("#resetForm").classList.add("active");
});
$("#backToLogin")?.addEventListener("click", (event) => {
  event.preventDefault();
  $("#resetForm").classList.remove("active");
  $("#resetForm").hidden = true;
  $("#loginForm").hidden = false;
  $("#loginForm").classList.add("active");
});
$("#resetForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFieldErrors("resetForm");
  const phone = $("#resetPhone").value.trim();
  const code = $("#resetCode").value.trim();
  const password = $("#resetPassword").value;
  const confirm = $("#resetPasswordConfirm").value;
  if (!/^1\d{10}$/.test(phone)) return setFieldError("resetPhone", "请输入 11 位手机号");
  if (!code) return setFieldError("resetCode", "请输入短信验证码");
  if (password.length < 6) return setFieldError("resetPassword", "密码至少 6 位");
  if (password !== confirm) return setFieldError("resetPasswordConfirm", "两次输入的密码不一致");
  try {
    await request("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ phone, code, password }) });
    $("#resetForm").reset();
    $("#backToLogin").click();
    $("#loginName").value = phone;
    authNotice("loginForm", "ok", "密码已重置，请用新密码登录");
  } catch (error) {
    authNotice("resetForm", "err", error.message);
  }
});

$("#deleteAccountBtn")?.addEventListener("click", () => {
  const box = $("#deleteConfirm");
  box.hidden = !box.hidden;
});
bindSendCode("#deleteSendCode", "#profileName", "delete");
$("#deleteAccountConfirm")?.addEventListener("click", async () => {
  const password = $("#deletePassword").value;
  if (!password) return toast("请输入密码确认身份");
  const payload = { password };
  if (smsEnabled) {
    const code = $("#deleteCode").value.trim();
    if (!code) return toast("请输入短信验证码");
    payload.code = code;
  }
  if (!window.confirm("最后确认：注销后账号与剩余额度将永久删除，无法恢复。确定注销吗？")) return;
  try {
    await request("/api/auth/delete-account", { method: "POST", body: JSON.stringify(payload) });
    localStorage.removeItem(TOKEN_KEY);
    authState.user = null;
    closeAuth();
    renderAccount();
    renderProfileForm();
    toast("账号已注销，感谢体验 ImageCraft");
  } catch (error) {
    toast(error.message);
  }
});

request("/api/status").then((status) => {
  smsEnabled = Boolean(status.sms);
  applySmsVisibility();
  const pill = $(".mode-pill");
  if (!pill) return;
  const live = status.mode === "live";
  pill.classList.toggle("live", live);
  $("#modeText").textContent = live ? `在线生图 · ${status.model}` : "演示模式";
}).catch(() => { if ($("#modeText")) $("#modeText").textContent = "服务未连接"; });

$$("#presetGrid .preset").forEach((item) => item.classList.toggle("active", item.dataset.preset === state.style.preset));
renderCharacterLibrary();
renderAccount();
renderProfileForm();
fetchMe().then(() => { renderAccount(); renderProfileForm(); });
syncArticle();
