# 增强版变更说明

[English](EXTENSION-CHANGES.md) | 中文

本仓库是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的独立增强发行版：保留上游完整历史，并叠加以下功能。跟踪上游的 fork 仓库在 [hypergraphdev/deepseek-harness](https://github.com/hypergraphdev/deepseek-harness)。

## 相对上游的变更

### 1. 浏览器侧边栏扩展（Chrome Side Panel）

- 新增 `apps/extension/`：Manifest V3 扩展，点工具栏图标即在侧边栏打开 dsh Web GUI；
- 通过 native-messaging host 按需拉起本地 `dsh web` 服务器（`dsh install-browser-host --extension <id>` 一次注册，源码模式与构建产物模式均支持）；
- 内嵌应用的 iframe 显式委派 `microphone` 与 `clipboard-write` 两项权限——跨源 iframe 默认两项都没有，缺后者会让消息的复制按钮静默失效；
- 提交：`051b610f`、`894bbee2`、`90ce867b`、`c6e053d3`。

### 2. 页面上下文与正文读取

- **上下文**：侧边栏内提问时，Agent 自动知道当前活动标签页（含本地 `file://` 文档，如 PDF）；关闭页面后有显式的"无活动页面"更正快照，杜绝过期上下文；上下文作为持久 `user/message` source 元数据入会话日志，满足上游"模型可见 ⟺ 已记录"不变式；同页去重，只在变化时注入一次快照；
- **读取本页正文**：右下角"📄 读取本页"按钮，把当前标签页**结构化**成 Markdown 随下一条消息发出——先按"文字量 ÷ 链接密度"给候选容器打分挑出正文根（阅读模式那套），再保留标题层级、表格、带语言标注的代码块、列表、引用、链接和图片；登录后的页面、JS 渲染的阅读器都能读，这是 `web_fetch` 抓不到的；你的选中文字一并带上；正文一次性使用、发完即清；
- **正文里的图片**转成绝对 URL 的 Markdown 图片链接（模型拿到的是地址和 alt，不是像素）；配合下面的 vision-bridge，再让模型用 `read_image` 去读具体那张图；
- **站点适配器**：数字根本不进 DOM 的页面（行情、K 线）走配置化适配器——`match` 匹主机名 → `capture` 从 URL/DOM 取参数 → `request` 拉公开接口 → `extract` 挑字段，结果作为 `<site_data>` 一并发出。**引擎不内置任何站点知识**，适配器是你自己的 `apps/extension/site-adapters.json`（已 gitignore，仓库里只有 `site-adapters.example.json` 示例）；
- **页内流嗅探**：只对在适配器里声明了 `sniff` 的站点，在 `document_start` 往 MAIN world 注入一个 `window.WebSocket` 包装，解码站点自己的帧、按时间合并序列后挂到页面上供抽取——**只读不改**，不发任何帧、不动业务逻辑，这是读 TradingView 这类"数据只走 WebSocket"图表的唯一办法；
- 提交：`4e1e15a3`、`d4899824`、`848d2993`、`275c692a`、`76c4c068`。

### 3. vision-bridge 多模态读图（含链路修复）

- `vision-bridge` 让纯文本模型（如 DeepSeek-V4-Flash）借助本地多模态模型（如 ollama 的 gemma4）读图：请求因图片被拒时自动转写为文字描述并重试，另提供 `analyze_image` 工具追问细节；
- 本版修复了两处链路缺口：`read_image` 工具的路由门禁认可已武装的桥接；工具结果（tool/result）内嵌图片同样被转写，且替换保持 call/result 配对；
- 提交：`4683f0e5`、`cfafe74d`、`a3f3f786`。

### 4. 语音输入（Voice Input）

- 输入框工具栏新增麦克风按钮，基于 Web Speech API 听写，转写文字经草稿状态机追加（撤销/命令 token/发送行为与手打一致）；
- 侧边栏内识别运行在扩展顶级页面并桥接回应用（绕过 Chrome 对跨源 iframe 的 Web Speech 限制），配套一次性的扩展麦克风授权页；
- 提交：`0b81b3cf`、`44f340a5`、`90ce867b`。

### 5. AI 团队：本机专家 + 远程队友

把工作台从「单个 agent」变成「你的常驻席位 + 一支可召唤的团队」。两条互补的路径：

**本机专家（进程内，无需任何服务）**——主 agent 一句话直接拉起本机 CLI 干活、拿回结果：

- 新增 `codex` / `claude_code` 两个委派工具（`dsh-base` 组合了上游自带的 `subagent-codex` / `subagent-claude-code` provider），在会话工作区内起官方 CLI，一次性任务返回最终答案；
- 说「让 codex 看看这段代码」即可，不经过任何 hub 或 daemon。

**HXA 团队（跨机器，持久在线）**——新增 `packages/hxa/` 能力家族，接入自托管的 [HXA Connect](https://github.com/hypergraphdev/hxa-connect) hub：

- `dsh-hxa`（`ctx.hxa`）：org 级 bot 连接（联系人 / DM / 离线补收 / WebSocket 票据），响应过线校验、结构化错误码；**未配置时完全休眠**，不注册任何工具、不占一个 token；
- `dsh-tool-hxa`：模型工具 `hxa_contacts`（花名册+在线状态）、`hxa_send`（给队友派活）、`hxa_inbox`（增量收件，带水位线）；
- `dsh-hxa-inbound`：**入站桥**——一条 WebSocket 让本机 bot 常驻在线（presence 与 coordinator 相互独立，互不拖累），队友来消息实时唤醒一个带 `hxa:coordinator` 人设的协调 agent，由它用自己的 `hxa_send` 应答；消息经 `followup` 落成持久 `user/message`，满足「模型可见 ⟺ 已记录」；
- 桥接创建的 agent 显式取用部署默认模型（人设里的 `{{model}}` 变量读的是 agent 自己的 options，不给就在调模型前拼提示词失败）；固定的 session id 采用 resume-or-create——持久层拒绝在已有日志上重建，只 create 会让重启后每一轮都撞 id；
- `scripts/connect-teammate.sh <teammate>`：一条命令把本机 CLI 挂成 org 里的在线队友（读环境或 `.env` 的 `HXA_HUB_URL` / `HXA_<NAME>_TOKEN`，零硬编码路径，daemon 包可用 `SLOCK_DAEMON_PACKAGE` 覆盖为本地 checkout）；
- 提交：`930b5bc6`、`ae1ee795`、`b9ad8615`、`cb959a02`、`95fe159f`、`c6e053d3`、`d987d77d`。

### 6. 侧边栏 Agents 面板

- 侧栏新增 `sidebar.agents` 座位与 `dsh-client-ui-agents` 插件：只读团队花名册，每行一个队友（在线绿点 + 角色），20 秒轮询刷新；
- 数据经宿主新增的同源 `GET /api/hxa/contacts` 路由（精确路由，拒绝跨站请求）取自 `ctx.hxa`；HXA 休眠时路由返回 404、面板整个不渲染，未配置的部署一个像素都不占；
- 提交：`668eb169`。

### 7. 微信接入（扫码即用）

让微信成为主 agent 的一个入口：在微信里发消息，本机智能体回答，回复直接发回聊天。

- 新增 `packages/weixin/`：`dsh-weixin`（`ctx.weixin`）用 iLink bot 协议管一个扫码关联的微信账号——扫码拿到的长期凭证以 0600 权限存在 harness home，**只需关联一次**，重启自动恢复；服务内含登录状态机、带游标持久化的长轮询收信、文本发送，服务端判定会话失效时自动解除关联而不是空转；
- `dsh-weixin-agent` 把这个账号变成一段对话：收到消息唤醒一个专属 agent（带 `weixin:persona` 人设——聊天口吻、纯文本，因为微信不渲染 Markdown），该轮结束的助手文本自动发回给发信人，模型完全不需要知道"微信"这个概念；
- 该轮跑着的时候在聊天里显示「对方正在输入」，让等待有反馈；指示器的任何失败都被吞掉——少个小点不值得赔上一条回复；
- 设置页新增「微信」分区：未关联时显示二维码，关联后只显示账号与解除关联按钮；**二维码在面板内本地编码**（送给第三方图片服务等于把登录凭证交出去）；
- 默认休眠：没有存储凭证时，服务不建连接、分区显示未关联；
- 提交：`c6ef2c8c`、`c6e053d3`、`d987d77d`。

### 8. 界面打磨

- 设置页左侧导航补上文字标签，图标按分区区分（消息类分区用会话图标，为将来接入微信之外的平台留位）；
- 消息的复制按钮在侧边栏里恢复可用（见第 1 节的 iframe 权限委派）；
- 提交：`c6e053d3`。

## 快速开始

1. 构建并注册 native host（macOS）：

```sh
pnpm install && pnpm run build
pnpm dsh install-browser-host --extension <你的扩展id>
```

2. `chrome://extensions` 开启开发者模式，"加载已解压的扩展程序"选择 `apps/extension/`，记下扩展 id 后重跑上一步；
3. 点工具栏图标打开侧边栏即用。

### 启用 vision-bridge（可选，读图能力需要）

vision-bridge 需要一个**本地多模态模型**做转写引擎，先安装 [ollama](https://ollama.com) 并拉取模型：

```sh
brew install ollama          # 或从 ollama.com 下载安装包
ollama pull gemma4:12b       # 多模态小模型，约 7.6 GB；任何支持图片输入的模型均可
ollama serve                 # 桌面版 ollama 会自动常驻，可跳过这步
```

然后在 `~/.dsh/settings.yaml` 配置**两段**：先把 ollama 注册为 provider，再指给 vision-bridge（只配后一段会因 provider 不存在而失效）：

```yaml
llm-pi-ai:
  providers:
    ollama:
      displayName: ollama
      apiKeyEnv: OLLAMA_API_KEY
      api: openai-completions
      baseURL: http://127.0.0.1:11434/v1
      defaultInput: [ text, image ]
      models:
        - id: gemma4:12b
vision-bridge:
  provider: ollama
  model: gemma4:12b
```

配置热加载，无需重启。生效后：文本模型的会话里上传图片、`read_image` 读本地图片都会经 gemma4 自动转写为文字描述，模型还可用 `analyze_image` 工具对图追问。注意键名全部小写（`model:` 写成 `Model:` 会被丢弃导致半配置休眠）。

### 配置站点适配器（可选，站点结构化数据需要）

复制示例，按自己关心的站点增删（该文件已 gitignore，不会进版本库）：

```sh
cp apps/extension/site-adapters.example.json apps/extension/site-adapters.json
```

每条适配器的字段：`match` 匹主机名/路径，`capture` 从 URL 或 DOM 里取参数（如交易对、股票代码），`request` 用这些参数拼公开接口，`extract` 从响应里挑要给模型的字段；`sniff` 则改为读页内 WebSocket 流。改完在 `chrome://extensions` 重新加载扩展生效。示例文件里的站点只是示例，删光了扩展照常工作——正文抽取不依赖适配器。

### 呼叫本机 Codex / Claude（开箱即用）

无需任何配置。装了官方 CLI（`codex` / `claude` 在 PATH 上）就能对主 agent 说「让 codex 重构这个函数」「让 claude 看看这段代码」——它会在当前工作区起 CLI、把最终答案带回来。CLI 缺失时该工具调用失败，不影响其他功能。

### 启用 HXA 团队（可选，跨机器协作需要）

需要一个自托管的 [HXA Connect](https://github.com/hypergraphdev/hxa-connect) hub（单进程 + SQLite，`docker compose up` 即起）。

1. **在 hub 上建 bot**：给工作台建一个主 bot（下例 `dsh-main`），每个队友各建一个（如 `codex`、`hermes`）。建完记得设 runtime，否则 hub 会一律兜底成 `claude`：

```sh
curl -X PATCH https://<your-hub>/api/me/profile \
  -H "authorization: Bearer <该 bot 的 token>" \
  -H 'content-type: application/json' \
  -d '{"runtime":"codex"}'   # claude / codex / gemini / cursor / copilot / kimi
```

2. **配置 dsh**：hub 地址写进 `~/.dsh/cordis.patch.yml`，主 bot 的 token 走环境变量（仓库根 `.env` 即可）：

```yaml
- id: hxa
  config:
    url: https://<your-hub>
```

```sh
# .env
HXA_HUB_URL=https://<your-hub>
HXA_BOT_TOKEN=<主 bot 的 token>
HXA_CODEX_TOKEN=<codex 队友的 token>
```

重启后主 bot 自动在线，侧栏出现 Agents 面板，主 agent 获得 `hxa_*` 工具。

3. **让本机 CLI 成为在线队友**（可选）：

```sh
scripts/connect-teammate.sh codex
```

daemon 常驻期间该 bot 在花名册里显示在线，主 agent 就能给它派活、收结果。远程队友（如部署在服务器上的 Hermes）由对应框架自己的 HXA 插件接入，不需要这个脚本。

### 关联微信（可选）

无需任何配置：打开 Web GUI 的设置页 →「微信」→ 生成二维码 → 用微信扫码并在手机上确认。关联后凭证存在 `~/.dsh/weixin/link.json`（0600），重启自动恢复，二维码不再出现。之后微信里发给该账号的消息由本机智能体回答，回复直接发回聊天；在设置页可随时解除关联。

## 同步上游

```sh
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git fetch upstream && git merge upstream/master
```
