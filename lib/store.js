import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = join(ROOT, "data");
const STORE_FILE = join(DATA_DIR, "store.json");
const SESSION_TTL = 1000 * 60 * 60 * 24 * 14; // 14 天

function emptyStore() {
  return { users: [], invites: [], sessions: {}, smsCodes: {} };
}

export function loadStore() {
  try {
    if (!existsSync(STORE_FILE)) return emptyStore();
    const data = JSON.parse(readFileSync(STORE_FILE, "utf8"));
    return { ...emptyStore(), ...data };
  } catch {
    return emptyStore();
  }
}

export function saveStore(store) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STORE_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, STORE_FILE);
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const candidate = scryptSync(String(password), salt, 64);
  const stored = Buffer.from(hash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function registerUser(store, { phone, password, invite }) {
  phone = String(phone || "").trim();
  invite = String(invite || "").trim().toUpperCase();
  if (!/^1\d{10}$/.test(phone)) return { error: "请输入 11 位手机号" };
  if (String(password || "").length < 6) return { error: "密码至少 6 位" };
  if (store.users.some((u) => u.phone === phone)) return { error: "这个手机号已经注册" };
  const code = store.invites.find((c) => c.code === invite);
  if (!code) return { error: "邀请码无效" };
  if (code.usedBy.length >= code.maxUses) return { error: "该邀请码使用名额已满" };
  const { salt, hash } = hashPassword(password);
  const user = { phone, salt, hash, invite, quota: code.quotaPerUser, used: 0, createdAt: new Date().toISOString() };
  store.users.push(user);
  code.usedBy.push(phone);
  return { user };
}

export function loginUser(store, { phone, password }) {
  const user = store.users.find((u) => u.phone === String(phone || "").trim());
  if (!user || !verifyPassword(password, user.salt, user.hash)) return { error: "手机号或密码不正确" };
  return { user };
}

export function createSession(store, phone) {
  const token = randomUUID() + randomBytes(16).toString("hex");
  store.sessions[token] = { phone, expires: Date.now() + SESSION_TTL };
  // 清理过期会话
  for (const [t, s] of Object.entries(store.sessions)) if (s.expires < Date.now()) delete store.sessions[t];
  return token;
}

export function getSessionUser(store, token) {
  const session = store.sessions[String(token || "")];
  if (!session || session.expires < Date.now()) return null;
  return store.users.find((u) => u.phone === session.phone) || null;
}

export function destroySession(store, token) {
  delete store.sessions[String(token || "")];
}

export function createInvite(store, { quotaPerUser = 20, maxUses = 1, note = "" } = {}) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from(randomBytes(8)).map((b) => alphabet[b % alphabet.length]).join("");
  } while (store.invites.some((c) => c.code === code));
  const invite = { code, quotaPerUser: Number(quotaPerUser), maxUses: Number(maxUses), usedBy: [], note: String(note), createdAt: new Date().toISOString() };
  store.invites.push(invite);
  return invite;
}

export function publicUser(user) {
  if (!user) return null;
  return { phone: user.phone, quota: user.quota, used: user.used, remaining: Math.max(0, user.quota - user.used), createdAt: user.createdAt };
}

const SMS_CODE_TTL = 5 * 60 * 1000; // 5 分钟有效
const SMS_SEND_INTERVAL = 60 * 1000; // 同号 60 秒一条
const SMS_DAILY_CAP = 8; // 同号每天上限

export function createSmsCode(store, phone, purpose) {
  phone = String(phone || "").trim();
  if (!/^1\d{10}$/.test(phone)) return { error: "请输入 11 位手机号" };
  const exists = store.users.some((u) => u.phone === phone);
  if (purpose === "register" && exists) return { error: "这个手机号已经注册" };
  if ((purpose === "reset" || purpose === "delete") && !exists) return { error: "这个手机号尚未注册" };
  const now = Date.now();
  const record = store.smsCodes[phone] || { sentToday: 0, dayStamp: "" };
  const today = new Date().toISOString().slice(0, 10);
  if (record.dayStamp !== today) { record.sentToday = 0; record.dayStamp = today; }
  if (record.lastSentAt && now - record.lastSentAt < SMS_SEND_INTERVAL) {
    return { error: `发送太频繁，请 ${Math.ceil((SMS_SEND_INTERVAL - (now - record.lastSentAt)) / 1000)} 秒后再试` };
  }
  if (record.sentToday >= SMS_DAILY_CAP) return { error: "今天发送次数已达上限，请明天再试" };
  const code = String(Math.floor(100000 + Math.random() * 900000));
  store.smsCodes[phone] = { ...record, code, purpose, expires: now + SMS_CODE_TTL, attempts: 0, lastSentAt: now, sentToday: record.sentToday + 1 };
  // 清理过期
  for (const [key, item] of Object.entries(store.smsCodes)) {
    if (item.expires && item.expires < now - 24 * 3600 * 1000) delete store.smsCodes[key];
  }
  return { code };
}

export function verifySmsCode(store, phone, purpose, code) {
  const record = store.smsCodes[String(phone || "").trim()];
  if (!record || !record.code) return { error: "请先获取验证码" };
  if (record.purpose !== purpose) return { error: "验证码用途不符，请重新获取" };
  if (Date.now() > record.expires) return { error: "验证码已过期，请重新获取" };
  record.attempts = (record.attempts || 0) + 1;
  if (record.attempts > 5) { delete record.code; return { error: "尝试次数过多，请重新获取验证码" }; }
  if (String(code || "").trim() !== record.code) return { error: "验证码不正确" };
  delete store.smsCodes[String(phone).trim()].code; // 一次性消费
  return { ok: true };
}

export function resetPassword(store, phone, password) {
  const user = store.users.find((u) => u.phone === String(phone || "").trim());
  if (!user) return { error: "这个手机号尚未注册" };
  if (String(password || "").length < 6) return { error: "密码至少 6 位" };
  const salt = randomBytes(16).toString("hex");
  user.salt = salt;
  user.hash = scryptSync(String(password), salt, 64).toString("hex");
  // 使该用户所有会话失效
  for (const [token, session] of Object.entries(store.sessions)) {
    if (session.phone === user.phone) delete store.sessions[token];
  }
  return { ok: true };
}

export function deleteUser(store, phone) {
  const index = store.users.findIndex((u) => u.phone === String(phone || "").trim());
  if (index < 0) return { error: "这个手机号尚未注册" };
  store.users.splice(index, 1);
  for (const [token, session] of Object.entries(store.sessions)) {
    if (session.phone === phone) delete store.sessions[token];
  }
  delete store.smsCodes[phone];
  // 邀请码占用保留:防止"注销-重注册"刷新额度
  return { ok: true };
}
