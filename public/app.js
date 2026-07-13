const styleOptions = {
  xiaohei: { preset: "xiaohei", line: "fine", background: "white", whitespace: "spacious", accent: "#ff6b20", custom: "" }
};
const savedStyle = localStorage.getItem("meimei-style");
const defaultStyle = { ...(styleOptions[savedStyle] || styleOptions.xiaohei) };
const defaultCharacter = { id: "meimei", enabled: true, archetype: "custom", name: "咩咩", shape: "bean", eyes: "dots", expression: "curious", accessory: "none", personality: "温柔、专注、安静好奇", custom: "极简黑白手绘女性角色；始终保留高盘发、额前弧形碎发和两侧松散发丝；只使用少量橙色点缀", referenceUrl: "/characters/meimei.png" };
const LIBRARY_KEY = "peitu-character-library";
const SELECTED_CHARACTER_KEY = "peitu-selected-character-id";
const USERS_KEY = "shitu-users";
const SESSION_USER_KEY = "shitu-current-user";
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
let demoSmsCode = "";
let demoSmsPhone = "";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const sample = `我们常常以为，灵感是一种偶然到访的东西。于是打开空白文档，等一个好念头从天花板上掉下来。\n\n但真正稳定的内容生产，不靠等待，而靠打捞。日常对话、项目复盘、读书笔记和失败记录，都是漂在水面下的素材。问题不是没有灵感，而是没有把它们捞起来的动作。\n\n先记录，再判断。记录时不要急着证明价值；判断时只问一件事：这条信息能不能帮助某个具体的人看清一个问题？\n\n当素材被持续收集、筛选和重新组合，灵感就不再是一场天气，而变成一套可以重复启动的小机器。`;

const articleDraft = sessionStorage.getItem("xiaohei-article-draft");
if (articleDraft) $("#article").value = articleDraft;

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2300);
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
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

function readUsers() {
  try {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function currentUser() {
  const name = localStorage.getItem(SESSION_USER_KEY);
  return readUsers().find((user) => user.name === name) || null;
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
  if (tab === "profile") renderProfileForm();
}

function renderAccount() {
  const user = currentUser();
  const area = $("#accountArea");
  if (!area) return;
  area.innerHTML = user ? `
    <button class="account-entry signed-in" id="openAuth" type="button"><span>${escapeHtml(user.name)}</span><small>个人中心</small></button>
    <button class="account-logout" id="logoutButton" type="button">退出</button>
  ` : `<button class="account-entry" id="openAuth" type="button">登录 / 注册</button>`;
  $("#openAuth")?.addEventListener("click", () => openAuth(user ? "profile" : "login"));
  $("#logoutButton")?.addEventListener("click", () => {
    localStorage.removeItem(SESSION_USER_KEY);
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
  $("#profileName").value = user.name;
}

function registerUser(event) {
  event.preventDefault();
  const name = $("#registerPhone").value.trim();
  const code = $("#registerCode").value.trim();
  const password = $("#registerPassword").value;
  const confirmPassword = $("#registerPasswordConfirm").value;
  if (!/^1\d{10}$/.test(name)) return toast("请输入 11 位手机号");
  if (!demoSmsCode || demoSmsPhone !== name) return toast("请先获取验证码");
  if (code !== demoSmsCode) return toast("验证码不正确");
  if (password.length < 4) return toast("密码至少 4 位");
  if (password !== confirmPassword) return toast("两次密码不一致");
  if (!$("#registerAgreement").checked) return toast("请先同意用户协议和隐私政策");
  const users = readUsers();
  if (users.some((user) => user.name === name)) return toast("这个手机号已经注册");
  users.push({ name, phone: name, password, createdAt: new Date().toISOString() });
  saveUsers(users);
  localStorage.setItem(SESSION_USER_KEY, name);
  demoSmsCode = "";
  demoSmsPhone = "";
  $("#registerForm").reset();
  renderAccount();
  setAuthTab("profile");
  toast("注册成功，已登录");
}

function loginUser(event) {
  event.preventDefault();
  const name = $("#loginName").value.trim();
  const password = $("#loginPassword").value;
  const user = readUsers().find((item) => item.name === name && item.password === password);
  if (!user) return toast("账户名或密码不正确");
  localStorage.setItem(SESSION_USER_KEY, user.name);
  $("#loginForm").reset();
  renderAccount();
  setAuthTab("profile");
  toast(`欢迎回来，${user.name}`);
}

function saveProfile(event) {
  event.preventDefault();
  toast("MVP 阶段暂无可保存资料");
}

function sendDemoCode() {
  const phone = $("#registerPhone").value.trim();
  if (!/^1\d{10}$/.test(phone)) return toast("请先输入 11 位手机号");
  demoSmsPhone = phone;
  demoSmsCode = String(Math.floor(100000 + Math.random() * 900000));
  $("#registerCode").value = demoSmsCode;
  toast(`演示验证码：${demoSmsCode}`);
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
  card.querySelector(".art-frame").innerHTML = `<img src="${result.url}" alt="${escapeHtml(shot.title)}" />`;
  card.querySelector(".art-info").innerHTML = `
    <h3>${escapeHtml(shot.title)}</h3>
    <span class="art-actions">
      <a class="download" href="${result.url}" download="shitu-${index + 1}.png">下载 PNG ↓</a>
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

async function generateOne(index) {
  const shot = state.activeShots[index];
  const card = $(`#result-${index}`);
  if (!shot || !card) return;
  state.results[index] = null;
  updateDownloadAllState();
  card.querySelector(".art-frame").innerHTML = `<div class="loader"></div>`;
  card.querySelector(".art-info").innerHTML = `<h3>${escapeHtml(shot.title)}</h3><span>第 ${index + 1} 张生成中</span>`;
  try {
    const result = await request("/api/generate", { method: "POST", body: JSON.stringify({ shot, style: state.style }) });
    state.results[index] = result;
    renderResultSuccess(card, shot, result, index);
  } catch (error) {
    state.results[index] = { error: error.message };
    renderResultError(card, shot, error, index);
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

  for (let index = 0; index < chosen.length; index += 1) {
    await generateOne(index);
  }
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
$(".character-jump").addEventListener("click", () => sessionStorage.setItem("xiaohei-article-draft", $("#article").value));
$("#sampleButton").addEventListener("click", () => { $("#article").value = sample; syncArticle(); toast("示例文章已放入"); });
$("#accountArea")?.addEventListener("click", (event) => {
  if (event.target.closest("#openAuth")) openAuth(currentUser() ? "profile" : "login");
});
$$("[data-auth-close]").forEach((item) => item.addEventListener("click", closeAuth));
$$(".auth-tabs button").forEach((button) => button.addEventListener("click", () => setAuthTab(button.dataset.authTab)));
$$("[data-auth-tab-link]").forEach((button) => button.addEventListener("click", () => setAuthTab(button.dataset.authTabLink)));
$("#sendCodeButton")?.addEventListener("click", sendDemoCode);
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
      link.download = `shitu-${item.index + 1}.png`;
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

request("/api/status").then((status) => {
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
syncArticle();
