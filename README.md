# Word Record

在网页上右键记录英文单词/短句，自动保存所在句子并解析**语境含义**，在本地 Web 应用里查看原词、按艾宾浩斯遗忘曲线复习。

```
浏览器扩展 ──右键/快捷键──▶ 本地服务 (Express + SQLite) ──▶ magpie 本地接口 (LLM 解析)
                                   │
                                   └──▶ Web 应用：词库 / 复习
```

## 快速开始

需要 Node 22+，并保持 magpie 运行（默认地址 `http://127.0.0.1:3425/v1`）。

```bash
npm install
npm start          # 构建 Web 应用并启动服务：http://127.0.0.1:5178
```

数据保存在 `data/word-record.db`（SQLite），可以直接备份这个文件。

### 安装浏览器扩展

1. 打开 `chrome://extensions`，开启右上角「开发者模式」
2. 点「加载已解压的扩展程序」，选择本项目的 `extension/` 目录
3. 在任意网页选中单词或短句 → 右键「记录到 Word Record」，或按 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>

页面右下角会弹出解析结果。点工具栏图标可以查看最近记录、打开词库或开始复习。

## 功能

- **记录**：选中内容和它所在的整句话、页面标题、链接一起保存。同一个词在新句子里再次记录时，会作为新的语境追加，并单独解析这句话里的意思。
- **解析**（magpie）：原形（running → run，took into account → take into account）、音标、词性、词形说明、语境含义及原因、整句翻译、英文释义、常见释义和例句。
- **词库**：大字显示原词，可以朗读；按日期分组，支持搜索和单词/短语筛选；每条语境里的目标词都会高亮；可以写笔记、重新解析、手动添加。
- **同词聚合**：同一个词的不同形式会自动归到一个词条，例如 running / ran / runs 都归入 run，took / taking into account 都归入 take into account。每个形式和它所在的句子都会保留，复习时只算一张卡片。如果模型给的原形不一致，可以在词条底部用「合并到…」手动合并。
- **模型服务**：「设置」页可以选接口格式（OpenAI Chat Completions、Codex 即 OpenAI Responses、Claude 即 Anthropic Messages），并修改服务地址和 API Key，默认是 magpie 的本地接口。保存前可以先「测试连接」。Key 只保存在本机数据库里，接口只返回打码后的提示（如 ••••abcd）。
- **模型切换**：「设置」页列出 magpie 当前提供的全部模型（按 Claude / Codex / Kiro / Antigravity 分组），一键切换，也可以先「测试」确认能用（会显示耗时或具体错误，例如账号登录过期）。选择保存在 SQLite 里，每个词条会记录是哪个模型解析的。
- **复习**：卡片正面是原词加原句，回想后显示释义，再按 `1 忘了 / 2 模糊 / 3 记得` 打分。复习间隔依次为 5 分钟、30 分钟、12 小时、1、2、4、7、15、30、60、120 天：
  - 记得：进入下一个间隔
  - 模糊：重复当前间隔
  - 忘了：回到 5 分钟，并在本轮最后再出现一次

## 配置

通过环境变量配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WR_PORT` | `5178` | 服务端口（改了之后要在扩展的「设置」里同步修改） |
| `WR_DB` | `data/word-record.db` | SQLite 文件路径 |
| `WR_MAGPIE_URL` | `http://127.0.0.1:3425/v1` | 默认服务地址（在「设置」页修改后以设置为准） |
| `WR_MODEL` | `claude/claude-haiku-5-5` | 默认解析模型（在「设置」页选择后以设置为准） |
| `WR_MAGPIE_KEY` | 空 | 默认 API Key（在「设置」页修改后以设置为准） |
| `WR_API_FORMAT` | `openai` | 默认接口格式：`openai`、`codex` 或 `claude`（在「设置」页修改后以设置为准） |
| `WR_ALLOWED_ORIGINS` | 空 | 额外允许调用 API 的网页来源，逗号分隔。本应用和浏览器扩展始终允许，其他网站一律拒绝 |

## 开发

```bash
npm run dev        # 服务 (tsx watch, :5178) + Vite 开发服务器 (:5173, /api 代理到 :5178)
npm test           # 服务端测试
```

目录结构：

- `server/`：Express API、SQLite 迁移、模型服务客户端 (`src/llm.ts`)、复习调度 (`src/srs.ts`)
- `web/`：React + Vite 前端
- `extension/`：Chrome MV3 扩展（无需构建）
