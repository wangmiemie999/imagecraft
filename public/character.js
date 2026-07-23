// HTTP 环境下 crypto.randomUUID 不可用(仅限安全上下文),提供降级
function safeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

const $ = (selector) => document.querySelector(selector);
const profiles = {
  meimei: { enabled: true, archetype: "custom", name: "咩咩", proportion: "natural", preserve: "hair-face", outfit: "original", signature: "hairpin", personality: "温柔、专注、安静好奇", custom: "极简黑白手绘女性角色；始终保留高盘发、额前弧形碎发和两侧松散发丝；只使用少量橙色点缀", referenceUrl: "/characters/meimei.png" },
  custom: { enabled: true, archetype: "custom", name: "我的角色", proportion: "natural", preserve: "hair-face", outfit: "original", signature: "none", personality: "安静、好奇、有自己的做事方式", custom: "", referenceUrl: "" }
};
const LIBRARY_KEY = "peitu-character-library";
const SELECTED_CHARACTER_KEY = "peitu-selected-character-id";
const defaults = profiles.meimei;
let archetype = "creature";
let profileMode = "meimei";
let generatedCharacterUrl = "";
const labels = {
  proportion: { natural: "自然人物", "light-cartoon": "轻卡通", chibi: "Q版" },
  preserve: { "hair-face": "保留发型与脸型", hair: "发型优先", outfit: "穿搭优先" },
  outfit: { original: "保留原图服装", casual: "简约日常", business: "清爽职场", creator: "创作者工装" },
  signature: { none: "无额外标志", hairpin: "简洁发饰", glasses: "眼镜", toolbag: "小工具包" }
};

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2300);
}

function hideGeneratedPanel() {
  const target = $("#generatedCharacter");
  target.hidden = true;
  target.innerHTML = "";
  $("#saveCharacter").hidden = profileMode === "custom";
  $("#generationStatus").textContent = "";
}

function resetPhotoUpload() {
  $("#characterPhoto").value = "";
  $("#photoPreview").removeAttribute("src");
  $("#photoPreviewWrap").hidden = true;
  $("#clearPhoto").hidden = true;
  $("#photoPlaceholder").hidden = false;
  hideGeneratedPanel();
}

function saveCharacter() {
  const character = readForm();
  if (profileMode === "custom" && !character.referenceUrl) {
    toast("请先生成角色定妆照，再保存到角色库");
    return;
  }
  const savedCharacter = saveToCharacterLibrary(character);
  localStorage.setItem("xiaohei-character", JSON.stringify(savedCharacter));
  localStorage.setItem(SELECTED_CHARACTER_KEY, savedCharacter.id);
  toast("已保存到我的角色库，并设为当前插图角色");
  setTimeout(() => { location.href = "/"; }, 650);
}

function readCharacterLibrary() {
  try {
    const library = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]");
    return Array.isArray(library) ? library.filter((item) => item?.referenceUrl && item.id !== "meimei") : [];
  } catch { return []; }
}

function saveToCharacterLibrary(character) {
  if (character.referenceUrl === "/characters/meimei.png") return { ...profiles.meimei, id: "meimei", createdAt: new Date().toISOString() };
  const library = readCharacterLibrary();
  const existingIndex = library.findIndex((item) => item.referenceUrl === character.referenceUrl);
  const item = {
    ...character,
    id: existingIndex >= 0 ? library[existingIndex].id : `character-${Date.now()}`,
    createdAt: existingIndex >= 0 ? library[existingIndex].createdAt : new Date().toISOString()
  };
  if (existingIndex >= 0) library[existingIndex] = item;
  else library.unshift(item);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(library.slice(0, 10)));
  return item;
}

function readForm() {
  const personality = generatedCharacterUrl === "/characters/meimei.png" ? profiles.meimei.personality : profiles.custom.personality;
  return { enabled: true, archetype, name: $("#characterName").value.trim() || "专属角色", proportion: $("#characterProportion").value, preserve: $("#characterPreserve").value, outfit: $("#characterOutfit").value, signature: $("#characterSignature").value, personality, custom: $("#characterCustom").value.trim(), referenceUrl: generatedCharacterUrl || undefined };
}

function writeForm(character) {
  archetype = ["creature", "custom"].includes(character.archetype) ? character.archetype : "custom";
  generatedCharacterUrl = character.referenceUrl || "";
  const profile = character.referenceUrl === "/characters/meimei.png" ? "meimei" : "custom";
  profileMode = profile;
  document.querySelectorAll(".profile-template").forEach((button) => button.classList.toggle("active", button.dataset.profile === profile));
  $("#characterName").value = character.name; $("#characterProportion").value = character.proportion || "natural"; $("#characterPreserve").value = character.preserve || "hair-face"; $("#characterOutfit").value = character.outfit || "original"; $("#characterSignature").value = character.signature || "none"; $("#characterCustom").value = character.custom || "";
  render();
}

function render() {
  const character = readForm();
  const isCustomProfile = profileMode === "custom";
  const previewUrl = isCustomProfile && !character.referenceUrl ? profiles.meimei.referenceUrl : character.referenceUrl;
  const figure = $("#characterFigure");
  figure.className = `character-figure archetype-${character.archetype}`;
  figure.style.backgroundImage = previewUrl ? `url(${previewUrl})` : "";
  figure.classList.toggle("reference-character", Boolean(previewUrl));
  $("#characterSpec").textContent = isCustomProfile ? `${character.name} · 默认预览咩咩 · 上传照片后替换` : `${character.name} · ${labels.proportion[character.proportion]} · ${labels.preserve[character.preserve]} · ${labels.outfit[character.outfit]} · ${labels.signature[character.signature]}`;
  $("#figureNote").textContent = character.personality || "认真，但不知道为什么这么认真。";
  document.querySelectorAll(".advanced-character-fields").forEach((group) => { group.hidden = isCustomProfile; });
  $("#photoUpload").hidden = !isCustomProfile;
  $("#saveCharacter").hidden = isCustomProfile && !character.referenceUrl;
  $("#generateCharacter span").textContent = "确认生成角色定妆照";
}

async function request(url, options) {
  const token = localStorage.getItem("imagecraft-token");
  const auth = token ? { authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...auth } });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "生成失败");
    error.status = response.status;
    throw error;
  }
  return data;
}

$("#characterForm").addEventListener("input", render);
$("#profileTemplates").addEventListener("click", (event) => {
  const button = event.target.closest(".profile-template");
  if (!button) return;
  writeForm(profiles[button.dataset.profile]);
  resetPhotoUpload();
});
$("#characterForm").addEventListener("submit", (event) => { event.preventDefault(); });
$("#saveCharacter").addEventListener("click", saveCharacter);
$("#resetCharacter").addEventListener("click", () => writeForm(defaults));
$("#clearPhoto").addEventListener("click", resetPhotoUpload);
$("#characterPhoto").addEventListener("change", () => {
  const file = $("#characterPhoto").files[0];
  if (!file) return;
  $("#photoPlaceholder").hidden = true;
  const preview = $("#photoPreview"); preview.src = URL.createObjectURL(file);
  $("#photoPreviewWrap").hidden = false;
  $("#clearPhoto").hidden = false;
  hideGeneratedPanel();
});

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
}

$("#generateCharacter").addEventListener("click", async () => {
  const button = $("#generateCharacter"); const character = readForm();
  button.disabled = true; button.querySelector("span").textContent = "角色正在站好…";
  try {
    let result;
    if (profileMode === "custom") {
      const file = $("#characterPhoto").files[0];
      if (!file) throw new Error("请先选择一张角色照片");
      if (file.size > 10_000_000) throw new Error("照片不能超过 10MB");
      $("#generationStatus").textContent = "正在根据照片生成角色定妆图…";
      result = await request("/api/character/simple", { method: "POST", body: JSON.stringify({ image: await fileAsDataUrl(file), settings: character }) });
    } else {
      const shot = { id: safeId(), title: `${character.name}角色定妆图`, coreIdea: "建立一个可反复用于中文文章插图的角色视觉设定", structure: "角色状态", action: "角色独自站在画面中央，正面、侧面和一个核心工作动作以松散角色设定稿方式呈现", labels: [character.name, "正面", "动作"] };
      result = await request("/api/generate", { method: "POST", body: JSON.stringify({ shot, style: { preset: "xiaohei", line: "fine", background: "white", whitespace: "balanced", accent: "#ff6b20", character } }) });
    }
    generatedCharacterUrl = result.url;
    const target = $("#generatedCharacter"); target.hidden = false; target.innerHTML = `<img src="${result.url}" alt="${character.name}角色定妆图" /><a href="${result.url}" download="character-${character.name}.png">下载定妆图 ↓</a>`;
    $("#saveCharacter").hidden = false;
    $("#generationStatus").textContent = "角色定妆照已生成。满意后点击“保存到我的角色库”，首页生成配图时会自动使用它。";
  } catch (error) { toast(error.status === 401 ? "请先回首页登录,再来生成角色" : error.message); }
  finally { button.disabled = false; render(); }
});

writeForm(defaults);
hideGeneratedPanel();
