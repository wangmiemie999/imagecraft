#!/usr/bin/env node
// 用户管理工具(管理员用)
// 重置密码: node tools/users.js reset 13800138000 新密码
// 注销账号: node tools/users.js delete 13800138000
// 用户列表: node tools/users.js list
import { loadStore, saveStore, resetPassword, deleteUser } from "../lib/store.js";
import { createInterface } from "node:readline/promises";

const [, , command, phone, password] = process.argv;
const store = loadStore();

if (command === "reset") {
  if (!phone || !password) { console.log("用法: node tools/users.js reset <手机号> <新密码>"); process.exit(1); }
  const result = resetPassword(store, phone, password);
  if (result.error) { console.log("失败:", result.error); process.exit(1); }
  saveStore(store);
  console.log(`已重置 ${phone} 的密码,并注销其所有登录状态。`);
} else if (command === "delete") {
  if (!phone) { console.log("用法: node tools/users.js delete <手机号>"); process.exit(1); }
  const user = store.users.find((u) => u.phone === phone);
  if (!user) { console.log("失败: 这个手机号尚未注册"); process.exit(1); }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`确认注销 ${phone}(已用 ${user.used}/${user.quota} 张)?此操作不可恢复。输入 yes 确认: `);
  rl.close();
  if (answer.trim() !== "yes") { console.log("已取消。"); process.exit(0); }
  deleteUser(store, phone);
  saveStore(store);
  console.log(`已注销 ${phone},其会话已全部失效。邀请码占用保留(防止重复注册刷额度)。`);
} else if (command === "list") {
  if (!store.users.length) { console.log("还没有注册用户。"); process.exit(0); }
  console.log("手机号          已用/配额   注册时间");
  store.users.forEach((u) => console.log(`${u.phone.padEnd(14)} ${String(u.used + "/" + u.quota).padEnd(10)} ${u.createdAt.slice(0, 16).replace("T", " ")}`));
} else {
  console.log("用法:\n  node tools/users.js reset <手机号> <新密码>   # 重置密码\n  node tools/users.js delete <手机号>          # 注销账号\n  node tools/users.js list                     # 用户列表");
}
