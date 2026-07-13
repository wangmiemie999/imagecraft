# 插图工坊 Illustration Workshop

插图工坊是一个本地优先的中文文章配图生成工具。用户可以粘贴文章、选择插图角色、选择生成张数，并通过 OpenRouter 图像模型生成 16:9 文章插图。

当前版本包含：

- 中文文章锚点拆解
- 1–6 张配图数量选择
- 咩咩极简线稿风格
- 自定义角色工作室
- 本地角色库选择、搜索、删除
- 手机号注册登录 MVP
- OpenRouter 生图接口
- RunningHub 接口预留

## 快速开始

环境要求：

- Node.js 20+

```bash
git clone https://github.com/wangmiemie999/shitu-workshop.git illustration-workshop
cd illustration-workshop
cp .env.example .env
npm start
```

打开：

```text
http://127.0.0.1:4173/
```

## 配置环境变量

编辑 `.env`：

```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_IMAGE_MODEL=bytedance-seed/seedream-4.5
PORT=4173
```

可选 RunningHub 配置：

```env
RUNNINGHUB_API_KEY=your-runninghub-key-here
RUNNINGHUB_WORKFLOW_ID=your-workflow-id-here
RUNNINGHUB_IMAGE_NODE_ID=111
RUNNINGHUB_PROMPT_NODE_ID=
RUNNINGHUB_OUTPUT_NODE_ID=201
```

`.env` 只在服务端读取，不会提交到 GitHub，也不会发送到浏览器。

## 本地开发

```bash
npm run dev
```

运行测试：

```bash
npm test
```

## Docker 部署

构建镜像：

```bash
docker build -t illustration-workshop .
```

运行：

```bash
docker run --env-file .env -p 4173:4173 illustration-workshop
```

访问：

```text
http://127.0.0.1:4173/
```

## 目录结构

```text
.
├── server.js              # 本地 Node 服务与 API
├── lib/plan.js            # 文章拆解与提示词生成
├── public/index.html      # 首页
├── public/app.js          # 首页交互
├── public/character.html  # 角色工作室
├── public/character.js    # 角色生成与角色库
├── public/styles.css      # 首页样式
├── public/character.css   # 角色页样式
└── outputs/               # 生成图片输出目录，本地忽略
```

## 产品化说明

当前账号系统是 MVP 演示版，数据保存在浏览器 `localStorage`。正式上线建议补充：

- 数据库用户系统
- 真实短信验证码
- 密码加密与登录态管理
- 图片对象存储
- 用户额度与计费
- 任务队列与失败重试
- 内容审核与频率限制

## License

MIT
