import test from "node:test";
import assert from "node:assert/strict";
import { buildImagePrompt, makeLocalPlan, normalizeCharacter, normalizeStyle, splitArticle } from "./plan.js";

test("splits Chinese prose and respects shot count", () => {
  const article = "第一段讲的是信息太多导致判断困难。第二段讲的是先筛选，再把有用的内容留下。第三段讲的是输出必须进入真实场景。第四段讲的是复盘能让流程不断变稳定。第五段讲的是角色会帮助用户建立记忆点。第六段讲的是最终结果要能直接服务客户。第七段讲的是多余信息应该被删掉。";
  assert.ok(splitArticle(article).length >= 3);
  assert.equal(makeLocalPlan(article, 3).length, 3);
  assert.equal(makeLocalPlan(article).length, 1);
  assert.equal(makeLocalPlan(article, 9).length, 6);
});

test("custom character replaces the preset character safely", () => {
  const character = normalizeCharacter({ name: "阿墨", shape: "box", eyes: "one", expression: "curious", accessory: "hat", personality: "安静的修理工", custom: "总是微微向左倾斜" });
  assert.match(character, /阿墨/);
  assert.match(character, /box-shaped/);
  const prompt = buildImagePrompt(makeLocalPlan("角色负责把零散的信息装进一个可复用的系统。", 1)[0], { character: { enabled: true, name: "阿墨", shape: "box" } });
  assert.match(prompt, /阿墨/);
  assert.match(normalizeCharacter({ enabled: true, archetype: "custom", name: "团子" }), /user-designed cartoon character/);
});

test("custom style is normalized and included safely", () => {
  const style = normalizeStyle({ preset: "editorial", background: "warm", accent: "#8844cc", custom: "木刻质感\n不要拥挤" });
  assert.equal(style.name, "杂志线描");
  assert.equal(style.accent, "#8844cc");
  assert.doesNotMatch(style.custom, /\n/);
  const prompt = buildImagePrompt(makeLocalPlan("把复杂的方法变成一个能看懂的动作。", 1)[0], style);
  assert.match(prompt, /杂志线描/);
  assert.match(prompt, /木刻质感/);
});

test("prompt includes style invariants", () => {
  const shot = makeLocalPlan("灵感不是等来的，而是从混乱里主动打捞出来的。", 1)[0];
  const prompt = buildImagePrompt(shot);
  assert.match(prompt, /pure white background/i);
  assert.match(prompt, /must perform the core conceptual action/);
  assert.match(prompt, /No top-left title/);
});
