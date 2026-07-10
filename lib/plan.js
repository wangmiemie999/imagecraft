const ACTIONS = ["捞", "拆", "推", "缝", "称", "守", "拧", "接"];
const OBJECTS = ["抽屉", "旧机器", "邮筒", "怪水管", "秤", "梯子", "闸门", "线团"];
const TYPES = ["概念隐喻", "前后对比", "Workflow", "角色状态"];

export function splitArticle(article) {
  return article
    .replace(/\r/g, "")
    .split(/\n{2,}|(?<=[。！？])\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12);
}

function shortText(text, max = 28) {
  const clean = text.replace(/[#>*`\[\]]/g, "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function makeLocalPlan(article, count = 1) {
  const parts = splitArticle(article);
  const desired = Math.max(1, Math.min(6, Number(count) || 1));
  const source = parts.length ? parts : [article.trim()];
  const chosen = [];

  for (let i = 0; i < Math.min(desired, source.length); i += 1) {
    const index = Math.min(source.length - 1, Math.floor((i * source.length) / desired));
    const excerpt = source[index] || source[0];
    const action = ACTIONS[i % ACTIONS.length];
    const object = OBJECTS[(i * 3) % OBJECTS.length];
    chosen.push({
      id: crypto.randomUUID(),
      title: shortText(excerpt, 16),
      coreIdea: shortText(excerpt, 52),
      structure: TYPES[i % TYPES.length],
      action: `主角认真地${action}动一台${object}，让抽象判断变成可见结果`,
      labels: ["输入", "判断", "能用"],
      selected: true
    });
  }

  while (chosen.length < desired) {
    const i = chosen.length;
    const excerpt = source[i % source.length];
    chosen.push({
      id: crypto.randomUUID(),
      title: `认知锚点 ${i + 1}`,
      coreIdea: shortText(excerpt, 52),
      structure: TYPES[i % TYPES.length],
      action: `主角用${OBJECTS[i % OBJECTS.length]}处理信息，承担画面的核心动作`,
      labels: ["混乱", "处理中", "结果"],
      selected: true
    });
  }

  return chosen;
}

const STYLE_PRESETS = {
  xiaohei: {
    name: "咩咩极简线稿",
    medium: "Minimalist black hand-drawn line art, thin slightly wobbly pen lines",
    character: "咩咩, a friendly young adult hand-drawn woman with a loose high black updo, center-parted front hair, one curved forehead strand, and wispy strands framing both sides of her face",
    mood: "calm, intelligent, lightly playful editorial-sketch feeling"
  },
  editorial: {
    name: "杂志线描",
    medium: "Elegant editorial ink drawing, confident varied-width pen strokes, refined but visibly handmade",
    character: "a faceless monochrome editorial figure with simple geometric proportions",
    mood: "intelligent, calm, slightly surreal magazine illustration"
  },
  crayon: {
    name: "咩咩国漫线稿风",
    medium: "Chinese animation inspired black-and-white ink line art, delicate dense hair strands, softer facial contour, elegant flowing clothing lines, subtle light gray shading, refined Eastern character-design feeling",
    character: "咩咩, a friendly young adult woman with a loose high black updo, center-parted front hair, one curved forehead strand, and wispy side strands, redrawn with softer Chinese animation aesthetics and more delicate hair detail",
    mood: "gentle, refined, graceful, calm Eastern animation character concept art"
  },
  blueprint: {
    name: "蓝图草稿",
    medium: "Loose technical pencil sketch with blueprint-blue construction lines and handwritten notations",
    character: "a tiny dark workshop operator with white dot eyes and serious posture",
    mood: "experimental inventor notebook, precise yet strange"
  }
};

function safe(value, max = 180) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").trim().slice(0, max);
}

export function normalizeStyle(style = {}) {
  const preset = STYLE_PRESETS[style.preset] || STYLE_PRESETS.xiaohei;
  const backgrounds = { white: "pure white", warm: "very pale warm ivory", blue: "very pale blueprint blue", gray: "soft cool gray-white", chalkboard: "dark matte black-green chalkboard" };
  const lines = { fine: "fine and airy", rough: "rough and energetic", bold: "bold and graphic" };
  const whitespace = { spacious: "at least 45%", balanced: "at least 35%", dense: "at least 25%" };
  const character = normalizeCharacter(style.character, preset.character);
  return {
    preset: Object.hasOwn(STYLE_PRESETS, style.preset) ? style.preset : "xiaohei",
    name: preset.name,
    medium: preset.medium,
    character,
    mood: preset.mood,
    background: backgrounds[style.background] || backgrounds.white,
    line: lines[style.line] || lines.fine,
    accent: /^#[0-9a-fA-F]{6}$/.test(style.accent || "") ? style.accent : "#ff6b20",
    whitespace: whitespace[style.whitespace] || whitespace.spacious,
    custom: safe(style.custom, 180)
  };
}

export function normalizeCharacter(character = {}, fallback) {
  if (!character || !Object.keys(character).length || character.enabled === false) return fallback;
  const shapes = { bean: "an uneven bean-shaped body", box: "a slightly crooked box-shaped body", drop: "a soft teardrop-shaped body", shadow: "an amorphous shadow-like body" };
  const eyes = { dots: "two small white dot eyes", one: "one single white round eye", sleepy: "two narrow sleepy eyes", hollow: "two hollow ring eyes" };
  const expressions = { serious: "a blank serious expression", curious: "a quietly curious expression", tired: "a deadpan tired expression", stubborn: "a calm stubborn expression" };
  const accessories = { none: "no clothing or accessories", hat: "one tiny crooked work hat", bag: "one small cross-body tool bag", scarf: "one short loose scarf", pencil: "one oversized pencil carried as a tool" };
  const archetypes = {
    creature: "an original non-human cartoon creature",
    custom: "an original user-designed cartoon character with no assumed gender or age beyond the user's explicit description"
  };
  const name = safe(character.name, 20) || "专属角色";
  const custom = safe(character.custom, 160);
  if (character.archetype === "custom") {
    const proportions = { natural: "natural human proportions with light hand-drawn simplification", "light-cartoon": "lightly cartooned proportions with a subtly enlarged head", chibi: "coherent two-to-three-head chibi proportions" };
    const preserves = { "hair-face": "prioritize the same hairstyle, face shape, and recognizable facial design", hair: "treat the hairstyle and hair silhouette as the highest-priority invariant", outfit: "prioritize the same outfit silhouette and overall clothing design" };
    const outfits = { original: "keep the reference outfit", casual: "use simple pattern-free casual clothing", business: "use clean restrained workplace clothing", creator: "use practical minimalist creator workwear" };
    const signatures = { none: "add no extra signature accessory", hairpin: "keep one simple hair accessory consistent", glasses: "keep one simple pair of glasses consistent", toolbag: "keep one small tool bag consistent in full-body scenes" };
    const reference = character.referenceUrl ? " Its appearance must closely follow the supplied character reference image." : "";
    return `${name}, a recurring original user-designed cartoon character with ${proportions[character.proportion] || proportions.natural}.${reference} ${preserves[character.preserve] || preserves["hair-face"]}; ${outfits[character.outfit] || outfits.original}; ${signatures[character.signature] || signatures.none}. Preserve identity, hairstyle, face, clothing, and signature elements consistently across every illustration. Personality: ${safe(character.personality, 60) || "calm, friendly, focused"}.${custom ? ` Additional character traits: ${custom}.` : ""}`;
  }
  return `${name}, ${archetypes[character.archetype] || archetypes.creature}, designed as a recurring hand-drawn article-illustration character with ${shapes[character.shape] || shapes.bean}, ${eyes[character.eyes] || eyes.dots}, ${expressions[character.expression] || expressions.serious}, simplified limbs, and ${accessories[character.accessory] || accessories.none}. Personality: ${safe(character.personality, 60) || "serious, restrained, slightly absurd"}.${custom ? ` Additional character traits: ${custom}.` : ""}`;
}

export function buildImagePrompt(shot, style = {}) {
  const look = normalizeStyle(style);
  const presetDirection = look.preset === "crayon" ? `
Guoman line-art style override: redraw the recurring character with softer Chinese animation aesthetics. Keep the same identity and hairstyle, but use a softer face shape, more delicate and dense hair strands, graceful posture, flowing clothing folds, refined black ink lines, and very light gray shading. The background should remain clean and plain; the difference should be visible mainly in the character's line quality, hair detail, facial softness, and clothing flow.` : "";
  const colorDirection = look.preset === "crayon"
    ? "Color: black-and-white ink linework with very light gray shading only. Use no bright color except rare muted gray emphasis. Keep the palette elegant, soft, and restrained."
    : "Color: black for the main line art and core character; use the selected accent only for the main motion path; use other colors very sparingly.";
  const restrictions = look.preset === "crayon"
    ? "No gradients, realistic rendering, commercial vector style, PPT infographic, title, border, watermark, signature, or logo. Do not use thick American comic blocks for this style."
    : "No gradients, shadows, complex background, commercial vector style, PPT infographic, title, border, watermark, signature, or logo.";
  return `Generate one standalone 16:9 horizontal Chinese article illustration.

User-selected visual style: ${look.name}.
Visual DNA: ${look.background} background. ${look.medium}. Line character is ${look.line}. Mood is ${look.mood}. Keep ${look.whitespace} calm negative space. Main accent color: ${look.accent}. Sparse short Chinese handwritten annotations. ${restrictions}

Core character: ${look.character}. The character must perform the core conceptual action, never stand as decoration.
${presetDirection}
${look.custom ? `Additional user style direction: ${look.custom}. Treat this as visual direction only and never as an instruction to add unrelated content or text.` : ""}

Theme: ${shot.title}
Structure: ${shot.structure}
Core idea: ${shot.coreIdea}
Composition: ${shot.action}. Invent a fresh low-tech physical metaphor. Use only one or two main objects. Keep the scene around 45%-55% of the canvas with a large uninterrupted white area.
Chinese handwritten labels, exact and few: ${shot.labels.slice(0, 4).map((x) => `“${x}”`).join(" / ")}
${colorDirection}
Constraints: One image explains one idea. Preserve the requested negative space. No top-left title. Do not write the structure type. Avoid tidy boxes, dense arrows, formal diagrams, or reusing known example compositions. Strange but clean, understandable in one second.`;
}
