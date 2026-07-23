import http from "node:http";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildImagePrompt, buildSmartPlanPrompt, makeLocalPlan, parseSmartShots } from "./lib/plan.js";
import { loadStore, saveStore, registerUser, loginUser, createSession, getSessionUser, destroySession, publicUser, createSmsCode, verifySmsCode, resetPassword, deleteUser } from "./lib/store.js";
import { stampAiLabel } from "./lib/watermark.js";
import { checkText, REJECT_MESSAGE } from "./lib/moderation.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
const OUTPUTS = join(ROOT, "outputs");
mkdirSync(OUTPUTS, { recursive: true });

loadEnv(join(ROOT, ".env"));
const PORT = Number(process.env.PORT || 4173);
const API_KEY = process.env.OPENROUTER_API_KEY || "";
const IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || "bytedance-seed/seedream-4.5";
const IMAGE_API_URL = process.env.OPENROUTER_IMAGE_URL || "https://openrouter.ai/api/v1/images";
const IMAGE_TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 120000);
const RELAY_TOKEN = process.env.RELAY_TOKEN || "";
const PLAN_MODEL = process.env.PLAN_MODEL || "openai/gpt-4o-mini";
const CHAT_API_URL = process.env.OPENROUTER_CHAT_URL || "https://openrouter.ai/api/v1/chat/completions";

// 智能配图方案:调用轻量文本模型提炼内容相关的镜头,失败返回 null 由调用方降级
async function smartPlan(article, count) {
  if (!API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(CHAT_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
        "HTTP-Referer": `http://127.0.0.1:${PORT}`,
        "X-Title": "ImageCraft",
        ...(RELAY_TOKEN ? { "x-relay-token": RELAY_TOKEN } : {})
      },
      body: JSON.stringify({
        model: PLAN_MODEL,
        max_tokens: 900,
        messages: [{ role: "user", content: buildSmartPlanPrompt(article, count) }]
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn(`[智能方案] 接口返回 ${response.status}:`, JSON.stringify(payload?.error || payload).slice(0, 200), "→ 降级本地算法");
      return null;
    }
    const text = payload?.choices?.[0]?.message?.content || "";
    const shots = parseSmartShots(text, count);
    if (!shots) {
      console.warn("[智能方案] 模型返回无法解析,原文前200字:", String(text).slice(0, 200), "→ 降级本地算法");
      return null;
    }
    console.log(`[智能方案] 成功,模型 ${PLAN_MODEL} 产出 ${shots.length} 个镜头`);
    return shots;
  } catch (error) {
    console.warn("[智能方案] 调用异常:", error.message, "→ 降级本地算法");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
const SMS = {
  keyId: process.env.SMS_ACCESS_KEY_ID || "",
  keySecret: process.env.SMS_ACCESS_KEY_SECRET || "",
  signName: process.env.SMS_SIGN_NAME || "",
  templateCode: process.env.SMS_TEMPLATE_CODE || ""
};
const SMS_ENABLED = Boolean(SMS.keyId && SMS.keySecret && SMS.signName && SMS.templateCode);

function percentEncode(value) {
  return encodeURIComponent(value).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");
}

// 阿里云短信发送(RPC 签名,无第三方依赖)
async function sendSms(phone, code) {
  const { createHmac } = await import("node:crypto");
  const params = {
    AccessKeyId: SMS.keyId,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: phone,
    RegionId: "cn-hangzhou",
    SignName: SMS.signName,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: randomUUID(),
    SignatureVersion: "1.0",
    TemplateCode: SMS.templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2017-05-25"
  };
  const canonical = Object.keys(params).sort().map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`).join("&");
  const stringToSign = `POST&${percentEncode("/")}&${percentEncode(canonical)}`;
  const signature = createHmac("sha1", SMS.keySecret + "&").update(stringToSign).digest("base64");
  const body = `Signature=${percentEncode(signature)}&${canonical}`;
  const response = await fetch("https://dysmsapi.aliyuncs.com/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.Code !== "OK") throw new Error(payload.Message || "短信发送失败");
  return true;
}

async function fetchWithRetry(url, options, retries = 1) {
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (attempt >= retries) {
        const reason = error?.name === "AbortError" ? `生图接口超时（${IMAGE_TIMEOUT_MS / 1000}秒无响应），可能是服务器到 OpenRouter 的网络不通` : `无法连接生图接口：${error.message}`;
        throw new Error(reason);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
const RUNNINGHUB_API_KEY = process.env.RUNNINGHUB_API_KEY || "";
const RUNNINGHUB_WORKFLOW_ID = process.env.RUNNINGHUB_WORKFLOW_ID || "";
const RUNNINGHUB_IMAGE_NODE_ID = process.env.RUNNINGHUB_IMAGE_NODE_ID || "111";
const RUNNINGHUB_OUTPUT_NODE_ID = process.env.RUNNINGHUB_OUTPUT_NODE_ID || "201";
const RUNNINGHUB_BASE_URL = "https://www.runninghub.cn";
const rateBuckets = new Map();
const RATE_LIMITS = {
  "/api/plan": { limit: 20, windowMs: 60_000, label: "文章分析" },
  "/api/generate": { limit: 8, windowMs: 60_000, label: "图片生成" },
  "/api/character/simple": { limit: 3, windowMs: 60_000, label: "角色生成" },
  "/api/character/runninghub": { limit: 3, windowMs: 60_000, label: "角色生成" },
  "/api/auth/send-code": { limit: 3, windowMs: 60_000, label: "验证码发送" },
  "/api/auth/register": { limit: 10, windowMs: 60_000, label: "注册" },
  "/api/auth/login": { limit: 10, windowMs: 60_000, label: "登录" },
  "/api/auth/reset-password": { limit: 5, windowMs: 60_000, label: "密码重置" },
  "/api/auth/delete-account": { limit: 5, windowMs: 60_000, label: "账号注销" }
};
const RUNNINGHUB_VIEW_PROMPTS = {
  "214": "白色背景。生成角色上半身正视图，姿势参考图二。",
  "215": "白色背景。生成角色全身的正视图，姿势参考图二。",
  "216": "白色背景。生成角色的后视图，姿势参考图二。",
  "217": "白色背景。生成角色的人脸近照。",
  "218": "白色背景。生成图一人物正面45°视角特写，姿势参考图二。",
  "219": "白色背景。生成角色的右侧视图，姿势参考图二。",
  "220": "白色背景。生成角色正面侧45°视角的全身图，姿势参考图二。",
  "221": "白色背景。生成角色的左侧视图，姿势参考图二。",
  "361": "白色背景。生成角色上半身后视图，姿势参考图二。",
  "365": "白色背景。生成角色面朝左方的侧视图，参考图二姿势。",
  "369": "白色背景。生成角色背面侧45°视角的全身图，姿势参考图二。",
  "374": "白色背景。生成角色面朝右方的侧视图，参考图二姿势。"
};

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function logUsage(event, extra = {}) {
  try {
    mkdirSync(join(ROOT, "data"), { recursive: true });
    appendFileSync(join(ROOT, "data", "usage.log"), JSON.stringify({ ts: new Date().toISOString(), event, ...extra }) + "\n");
  } catch {}
}

// 原子扣额:生成完成后重读最新存储再扣,避免并发请求用旧快照互相覆盖导致少扣
function debitQuota(phone) {
  const store = loadStore();
  const user = store.users.find((u) => u.phone === phone);
  if (!user) return null;
  user.used += 1;
  saveStore(store);
  return { used: user.used, total: user.quota, remaining: Math.max(0, user.quota - user.used) };
}

function authToken(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 15_000_000) throw new Error("请求内容过大，请使用 10MB 以内的照片");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("请求提交失败，请刷新页面后重试");
    error.status = 400;
    throw error;
  }
}

function clientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function applyRateLimit(req, res, pathname) {
  const rule = RATE_LIMITS[pathname];
  if (!rule) return false;
  const now = Date.now();
  const key = `${pathname}:${clientKey(req)}`;
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + rule.windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + rule.windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  res.setHeader("x-ratelimit-limit", String(rule.limit));
  res.setHeader("x-ratelimit-remaining", String(Math.max(0, rule.limit - bucket.count)));
  res.setHeader("x-ratelimit-reset", String(retryAfter));
  if (bucket.count <= rule.limit) return false;
  res.setHeader("retry-after", String(retryAfter));
  json(res, 429, {
    error: `${rule.label}请求太频繁，请 ${retryAfter} 秒后再试。`,
    code: "RATE_LIMITED",
    retryAfter
  });
  return true;
}

function friendlyErrorMessage(error) {
  const raw = String(error?.message || error || "");
  if (/billing hard limit|quota|insufficient|credits?|余额|额度|payment|limit has been reached/i.test(raw)) {
    return "当前图片生成服务暂时不可用，请稍后再试或联系管理员。";
  }
  if (/unauthorized|invalid api key|api key|401|403|forbidden|authentication/i.test(raw)) {
    return "图片生成服务配置异常，请联系管理员处理。";
  }
  if (/rate limit|too many requests|429/i.test(raw)) {
    return "图片服务请求太频繁，请稍等后重试。";
  }
  if (/size|pixel|dimension|resolution|尺寸|像素/i.test(raw)) {
    return "图片尺寸暂时不被当前模型支持，系统已尝试自动适配；请稍后重试或换一张图片。";
  }
  if (/content policy|safety|moderation|unsafe|violat/i.test(raw)) {
    return "内容可能触发了模型安全限制，请调整文章内容、角色照片或提示描述后重试。";
  }
  if (/fetch failed|network|timeout|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(raw)) {
    return "连接图片服务失败，请检查网络或稍后重试。";
  }
  if (/没有返回图像数据|没有返回角色图像数据/i.test(raw)) {
    return "图片模型暂时没有返回结果，请稍后重试。";
  }
  if (/OPENROUTER_API_KEY|尚未配置|未配置/i.test(raw)) {
    return "图片生成服务暂未启用，请联系管理员处理。";
  }
  return raw || "服务器出错了，请稍后重试。";
}

function errorStatus(error) {
  if (Number(error?.status)) return Number(error.status);
  const message = String(error?.message || "");
  if (/至少|缺少|请先|不能超过|格式|上传|无效/.test(message)) return 400;
  if (/rate limit|too many requests|请求太频繁/i.test(message)) return 429;
  if (/unauthorized|invalid api key|401|403|forbidden|authentication/i.test(message)) return 502;
  return 500;
}

function runningHubHeaders(jsonBody = false) {
  return { authorization: `Bearer ${RUNNINGHUB_API_KEY}`, ...(jsonBody ? { "content-type": "application/json" } : {}) };
}

async function runningHubJson(path, options) {
  const response = await fetch(`${RUNNINGHUB_BASE_URL}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) throw new Error(payload.msg || payload.message || `RunningHub 请求失败（HTTP ${response.status}）`);
  return payload.data;
}

function buildRunningHubCharacterDirection(settings = {}) {
  const choose = (value, options, fallback) => options[value] || options[fallback];
  const proportion = choose(settings.proportion, { natural: "保持自然人物比例，仅做轻度手绘化", "light-cartoon": "使用轻卡通人物比例，头部略放大但身体仍自然", chibi: "使用协调的Q版二至三头身比例" }, "natural");
  const preserve = choose(settings.preserve, { "hair-face": "重点保持原图的发型、脸型与五官辨识度", hair: "最高优先级保持原图发型及发丝轮廓", outfit: "重点保持原图的整体穿搭、颜色关系与服装轮廓" }, "hair-face");
  const outfit = choose(settings.outfit, { original: "服装保持原图，不主动换装", casual: "服装调整为无复杂图案的简约日常穿搭", business: "服装调整为清爽克制的职场穿搭", creator: "服装调整为简洁实用的创作者工装" }, "original");
  const signature = choose(settings.signature, { none: "不添加额外标志配件", hairpin: "添加一个简洁、易于跨视角保持一致的小发饰", glasses: "添加一副简洁眼镜并在所有视角保持一致", toolbag: "添加一个小工具包并在所有全身视角保持一致" }, "none");
  const custom = String(settings.custom || "").replace(/[<>\r\n]/g, " ").trim().slice(0, 100);
  return `${proportion}；${preserve}；${outfit}；${signature}。所有视角必须是同一个角色，发型、脸型、服装和标志元素保持一致。${custom ? `补充要求：${custom}。` : ""}`;
}

async function createRunningHubCharacter(imageData, fileName = "character.png", settings = {}) {
  if (!RUNNINGHUB_API_KEY || !RUNNINGHUB_WORKFLOW_ID) throw new Error("RunningHub 尚未配置完成");
  const match = String(imageData).match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("请上传 PNG、JPG 或 WEBP 图片");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 10_000_000) throw new Error("照片不能为空且不能超过 10MB");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: match[1] }), fileName);
  const uploaded = await runningHubJson("/openapi/v2/media/upload/binary", { method: "POST", headers: runningHubHeaders(), body: form });
  if (!uploaded?.fileName) throw new Error("RunningHub 上传成功，但没有返回文件名");
  const direction = buildRunningHubCharacterDirection(settings);
  const nodeInfoList = [
    { nodeId: RUNNINGHUB_IMAGE_NODE_ID, fieldName: "image", fieldValue: uploaded.fileName },
    ...Object.entries(RUNNINGHUB_VIEW_PROMPTS).map(([nodeId, prompt]) => ({ nodeId, fieldName: "text", fieldValue: `${prompt}\n统一角色设定：${direction}` }))
  ];
  const task = await runningHubJson("/task/openapi/create", {
    method: "POST",
    headers: runningHubHeaders(true),
    body: JSON.stringify({ apiKey: RUNNINGHUB_API_KEY, workflowId: RUNNINGHUB_WORKFLOW_ID, nodeInfoList })
  });
  if (!task?.taskId) throw new Error("RunningHub 没有返回任务 ID");
  return { taskId: task.taskId, status: task.taskStatus || "QUEUED" };
}

async function getRunningHubCharacter(taskId) {
  if (!/^\d+$/.test(String(taskId))) throw new Error("无效的 RunningHub 任务 ID");
  const outputs = await runningHubJson("/task/openapi/outputs", { method: "POST", headers: runningHubHeaders(true), body: JSON.stringify({ apiKey: RUNNINGHUB_API_KEY, taskId: String(taskId) }) });
  if (!Array.isArray(outputs) || outputs.length === 0) return { status: "RUNNING" };
  const output = outputs.find((item) => String(item.nodeId) === RUNNINGHUB_OUTPUT_NODE_ID) || outputs.find((item) => item.fileUrl);
  if (!output?.fileUrl) throw new Error("RunningHub 任务完成，但没有找到角色图片");
  const imageResponse = await fetch(output.fileUrl);
  if (!imageResponse.ok) throw new Error("无法下载 RunningHub 生成结果");
  const extension = ["png", "jpg", "jpeg", "webp"].includes(output.fileType) ? output.fileType : "png";
  const filename = `${Date.now()}-character-${taskId}.${extension}`;
  writeFileSync(join(OUTPUTS, filename), Buffer.from(await imageResponse.arrayBuffer()));
  return { status: "SUCCESS", url: `/outputs/${filename}`, taskId: String(taskId) };
}

async function generateImage(shot, style) {
  const prompt = buildImagePrompt(shot, style);
  if (!API_KEY) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return { url: "/characters/meimei.png", demo: true, prompt };
  }

  const requestBody = { model: IMAGE_MODEL, prompt, size: "2560x1440", quality: "medium", output_format: "png", n: 1 };
  const referenceUrl = String(style?.character?.referenceUrl || "");
  if (referenceUrl.startsWith("/characters/") || referenceUrl.startsWith("/outputs/")) {
    const base = referenceUrl.startsWith("/outputs/") ? OUTPUTS : PUBLIC;
    const relative = referenceUrl.startsWith("/outputs/") ? referenceUrl.slice(9) : referenceUrl.slice(1);
    const referencePath = normalize(join(base, relative));
    if (referencePath.startsWith(base) && existsSync(referencePath)) {
      const mime = extname(referencePath).toLowerCase() === ".webp" ? "image/webp" : extname(referencePath).toLowerCase() === ".jpg" || extname(referencePath).toLowerCase() === ".jpeg" ? "image/jpeg" : "image/png";
      requestBody.input_references = [{ type: "image_url", image_url: { url: `data:${mime};base64,${readFileSync(referencePath).toString("base64")}` } }];
    }
  }

  const response = await fetchWithRetry(IMAGE_API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      "HTTP-Referer": `http://127.0.0.1:${PORT}`,
      "X-Title": "ImageCraft",
      ...(RELAY_TOKEN ? { "x-relay-token": RELAY_TOKEN } : {})
    },
    body: JSON.stringify(requestBody)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `OpenRouter 请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  const encoded = payload?.data?.[0]?.b64_json;
  if (!encoded) throw new Error("图片接口没有返回图像数据");
  const filename = `${Date.now()}-${shot.id}.png`;
  writeFileSync(join(OUTPUTS, filename), stampAiLabel(Buffer.from(encoded, "base64")));
  return { url: `/outputs/${filename}`, demo: false, prompt };
}

function parseImageDataUrl(imageData) {
  const match = String(imageData).match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("请上传 PNG、JPG 或 WEBP 图片");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 10_000_000) throw new Error("照片不能为空且不能超过 10MB");
  return { mime: match[1], bytes, dataUrl: `data:${match[1]};base64,${match[2]}` };
}

function buildSimpleCharacterPrompt(settings = {}) {
  const choose = (value, options, fallback) => options[value] || options[fallback];
  const proportion = choose(settings.proportion, {
    natural: "保持自然头像/半身人物比例，重点展示头发、脸型和上半身",
    "light-cartoon": "轻卡通化，头部可略微放大，但保持优雅自然",
    chibi: "轻微 Q 版化，比例更可爱，但不要过度幼态"
  }, "natural");
  const preserve = choose(settings.preserve, {
    "hair-face": "最高优先级保留参考照片中的发型、脸型、五官气质和辨识度",
    hair: "最高优先级保留参考照片中的发型、发量、发丝轮廓和刘海/碎发特征",
    outfit: "优先保留参考照片中的整体穿搭、衣领轮廓和颜色关系"
  }, "hair-face");
  const outfit = choose(settings.outfit, {
    original: "服装尽量保持参考照片，不主动换装",
    casual: "服装改为无复杂图案的简约日常穿搭",
    business: "服装改为清爽克制的职场穿搭",
    creator: "服装改为简洁实用的创作者工装"
  }, "original");
  const signature = choose(settings.signature, {
    none: "不要添加额外标志配件",
    hairpin: "可以添加一个极简小发饰，后续适合长期保持一致",
    glasses: "可以添加一副简洁眼镜，后续适合长期保持一致",
    toolbag: "可以添加一个小工具包元素，但不要抢主体"
  }, "none");
  const name = String(settings.name || "自定义角色").replace(/[<>\r\n]/g, " ").trim().slice(0, 20);
  const custom = String(settings.custom || "").replace(/[<>\r\n]/g, " ").trim().slice(0, 100);
  return `根据上传的参考照片，生成一个名为「${name}」的原创文章插图角色定稿图。

角色生成要求：
- ${preserve}
- ${proportion}
- ${outfit}
- ${signature}
- 画风为极简手绘、黑白线稿、干净留白，只允许少量橙色点缀
- 保留人物的整体气质，但不要生成写实照片
- 生成适合作为知识类文章插图主角的稳定角色形象
- 画面以单个角色为主体，白色或极浅暖白背景，避免复杂场景
- 不要添加文字、水印、logo、边框、商业矢量插画质感
${custom ? `- 用户补充设定：${custom}` : ""}

输出：一张清晰的角色头像/半身定稿图，头发和脸型完整可见。`;
}

async function createSimpleCharacter(imageData, settings = {}) {
  const image = parseImageDataUrl(imageData);
  const prompt = buildSimpleCharacterPrompt(settings);
  if (!API_KEY) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return { url: "/characters/meimei.png", demo: true, prompt };
  }

  const sizes = ["2048x2048", "2560x1440", "1920x1920"];
  let payload;
  let usedSize = sizes[0];
  let lastError = "";
  for (const size of sizes) {
    const response = await fetchWithRetry(IMAGE_API_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
        "HTTP-Referer": `http://127.0.0.1:${PORT}`,
        "X-Title": "ImageCraft",
        ...(RELAY_TOKEN ? { "x-relay-token": RELAY_TOKEN } : {})
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt,
        size,
        quality: "medium",
        output_format: "png",
        n: 1,
        input_references: [{ type: "image_url", image_url: { url: image.dataUrl } }]
      })
    });
    payload = await response.json().catch(() => ({}));
    if (response.ok) {
      usedSize = size;
      break;
    }
    lastError = payload?.error?.message || payload?.message || `OpenRouter 请求失败（HTTP ${response.status}）`;
    if (!/size|pixel|dimension|resolution|尺寸|像素/i.test(lastError)) throw new Error(lastError);
    payload = null;
  }
  if (!payload) throw new Error(lastError || "OpenRouter 图片尺寸自动适配失败");
  const encoded = payload?.data?.[0]?.b64_json;
  if (!encoded) throw new Error("图片接口没有返回角色图像数据");
  const filename = `${Date.now()}-simple-character.png`;
  writeFileSync(join(OUTPUTS, filename), stampAiLabel(Buffer.from(encoded, "base64")));
  return { url: `/outputs/${filename}`, demo: false, prompt, size: usedSize };
}

async function api(req, res, pathname) {
  if (req.method !== "GET" && applyRateLimit(req, res, pathname)) return;
  if (req.method === "GET" && pathname === "/api/status") {
    return json(res, 200, { mode: API_KEY ? "live" : "demo", provider: "openrouter", model: IMAGE_MODEL, sms: SMS_ENABLED, runninghub: Boolean(RUNNINGHUB_API_KEY && RUNNINGHUB_WORKFLOW_ID) });
  }
  if (req.method === "POST" && pathname === "/api/auth/send-code") {
    if (!SMS_ENABLED) return json(res, 400, { error: "短信服务尚未开通" });
    const data = await body(req);
    const purpose = ["register", "reset", "delete"].includes(data.purpose) ? data.purpose : "register";
    const store = loadStore();
    const made = createSmsCode(store, data.phone, purpose);
    if (made.error) return json(res, 400, { error: made.error });
    try {
      await sendSms(String(data.phone).trim(), made.code);
    } catch (error) {
      console.warn("[短信] 发送失败:", error.message);
      return json(res, 502, { error: "短信发送失败，请稍后重试" });
    }
    saveStore(store);
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/auth/reset-password") {
    if (!SMS_ENABLED) return json(res, 400, { error: "短信服务尚未开通，请联系管理员重置密码" });
    const data = await body(req);
    const store = loadStore();
    const verified = verifySmsCode(store, data.phone, "reset", data.code);
    if (verified.error) { saveStore(store); return json(res, 400, { error: verified.error }); }
    const result = resetPassword(store, data.phone, data.password);
    if (result.error) { saveStore(store); return json(res, 400, { error: result.error }); }
    saveStore(store);
    logUsage("reset-password", { phone: String(data.phone).trim() });
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/auth/delete-account") {
    const data = await body(req);
    const store = loadStore();
    const user = getSessionUser(store, authToken(req));
    if (!user) return json(res, 401, { error: "未登录" });
    const check = loginUser(store, { phone: user.phone, password: data.password });
    if (check.error) return json(res, 400, { error: "密码不正确，无法注销" });
    if (SMS_ENABLED) {
      const verified = verifySmsCode(store, user.phone, "delete", data.code);
      if (verified.error) { saveStore(store); return json(res, 400, { error: verified.error }); }
    }
    deleteUser(store, user.phone);
    saveStore(store);
    logUsage("delete-account", { phone: user.phone });
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/auth/register") {
    const data = await body(req);
    const store = loadStore();
    if (SMS_ENABLED) {
      const verified = verifySmsCode(store, data.phone, "register", data.code);
      if (verified.error) { saveStore(store); return json(res, 400, { error: verified.error }); }
    }
    const result = registerUser(store, data);
    if (result.error) return json(res, 400, { error: result.error });
    const token = createSession(store, result.user.phone);
    saveStore(store);
    logUsage("register", { phone: result.user.phone, invite: result.user.invite });
    return json(res, 200, { token, user: publicUser(result.user) });
  }
  if (req.method === "POST" && pathname === "/api/auth/login") {
    const data = await body(req);
    const store = loadStore();
    const result = loginUser(store, data);
    if (result.error) return json(res, 400, { error: result.error });
    const token = createSession(store, result.user.phone);
    saveStore(store);
    return json(res, 200, { token, user: publicUser(result.user) });
  }
  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const store = loadStore();
    destroySession(store, authToken(req));
    saveStore(store);
    return json(res, 200, { ok: true });
  }
  if (req.method === "GET" && pathname === "/api/me") {
    const store = loadStore();
    const user = getSessionUser(store, authToken(req));
    if (!user) return json(res, 401, { error: "未登录" });
    return json(res, 200, { user: publicUser(user) });
  }
  if (req.method === "POST" && pathname === "/api/plan") {
    const data = await body(req);
    const article = String(data.article || "").trim();
    if (article.length < 20) return json(res, 400, { error: "请至少输入 20 个字的文章内容" });
    const hit = checkText(article);
    if (hit) {
      console.warn(`[内容过滤] /api/plan 命中违禁词`);
      return json(res, 400, { error: REJECT_MESSAGE });
    }
    const smart = await smartPlan(article, data.count);
    logUsage("plan", { mode: smart ? "smart" : "local" });
    const shots = smart || makeLocalPlan(article, data.count);
    return json(res, 200, { shots, mode: API_KEY ? "live" : "demo", planner: smart ? "smart" : "local" });
  }
  if (req.method === "POST" && pathname === "/api/generate") {
    const data = await body(req);
    if (!data.shot?.id) return json(res, 400, { error: "缺少配图方案" });
    const store = loadStore();
    const user = getSessionUser(store, authToken(req));
    if (!user) return json(res, 401, { error: "请先登录后再生成插图" });
    if (user.used >= user.quota) return json(res, 403, { error: `你的免费生成额度（${user.quota} 张）已用完` });
    const shotHit = checkText(data.shot.title, data.shot.coreIdea, data.shot.action, data.style?.custom, data.style?.character?.custom, data.style?.character?.name);
    if (shotHit) {
      console.warn(`[内容过滤] /api/generate 命中违禁词 用户:${user.phone}`);
      return json(res, 400, { error: REJECT_MESSAGE });
    }
    const result = await generateImage(data.shot, data.style);
    let quota = { used: user.used, total: user.quota, remaining: Math.max(0, user.quota - user.used) };
    if (!result.demo) quota = debitQuota(user.phone) || quota;
    logUsage("generate", { phone: user.phone, demo: Boolean(result.demo) });
    return json(res, 200, { ...result, quota });
  }
  if (req.method === "POST" && pathname === "/api/character/simple") {
    const data = await body(req);
    if (!data.image) return json(res, 400, { error: "请先上传一张角色照片" });
    const store = loadStore();
    const user = getSessionUser(store, authToken(req));
    if (!user) return json(res, 401, { error: "请先登录后再生成角色" });
    if (user.used >= user.quota) return json(res, 403, { error: `你的免费生成额度（${user.quota} 张）已用完` });
    const charHit = checkText(data.settings?.name, data.settings?.custom);
    if (charHit) {
      console.warn(`[内容过滤] /api/character/simple 命中违禁词`);
      return json(res, 400, { error: REJECT_MESSAGE });
    }
    const result = await createSimpleCharacter(data.image, data.settings);
    let quota = { used: user.used, total: user.quota, remaining: Math.max(0, user.quota - user.used) };
    if (!result.demo) {
      quota = debitQuota(user.phone) || quota;
      logUsage("generate-character", { phone: user.phone });
    }
    return json(res, 200, { ...result, quota });
  }
  if (req.method === "POST" && pathname === "/api/character/runninghub") {
    const data = await body(req);
    const rhStore = loadStore();
    const rhUser = getSessionUser(rhStore, authToken(req));
    if (!rhUser) return json(res, 401, { error: "请先登录后再生成角色" });
    return json(res, 200, await createRunningHubCharacter(data.image, data.fileName, data.settings));
  }
  if (req.method === "GET" && pathname === "/api/character/runninghub") {
    const taskId = new URL(req.url, `http://${req.headers.host}`).searchParams.get("taskId");
    return json(res, 200, await getRunningHubCharacter(taskId));
  }
  return json(res, 404, { error: "接口不存在" });
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function staticFile(req, res, pathname) {
  const base = pathname.startsWith("/outputs/") ? OUTPUTS : PUBLIC;
  const relative = pathname.startsWith("/outputs/") ? pathname.slice(9) : pathname === "/" ? "index.html" : pathname.slice(1);
  const file = normalize(join(base, relative));
  if (!file.startsWith(base) || !existsSync(file)) return false;
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  try {
    if (pathname.startsWith("/api/")) return await api(req, res, pathname);
    if (staticFile(req, res, pathname)) return;
    res.writeHead(404).end("Not found");
  } catch (error) {
    console.error(error);
    json(res, errorStatus(error), { error: friendlyErrorMessage(error), detail: process.env.NODE_ENV === "production" ? undefined : error.message || String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ImageCraft已启动：http://127.0.0.1:${PORT}`);
  console.log(API_KEY ? `OpenRouter 在线模式 · ${IMAGE_MODEL}` : "演示模式 · 配置 OPENROUTER_API_KEY 后启用真实生图");
});
