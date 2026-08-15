# Extension Edition Changes / 增强版变更说明

This repository is an independent edition of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) carrying the full upstream history plus the changes below. The companion fork that tracks upstream lives at [hypergraphdev/deepseek-harness](https://github.com/hypergraphdev/deepseek-harness).

本仓库是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的独立增强发行版：保留上游完整历史，并叠加以下功能。跟踪上游的 fork 仓库在 [hypergraphdev/deepseek-harness](https://github.com/hypergraphdev/deepseek-harness)。

## 相对上游的变更

### 1. 浏览器侧边栏扩展（Chrome Side Panel）

- 新增 `apps/extension/`：Manifest V3 扩展，点工具栏图标即在侧边栏打开 dsh Web GUI；
- 通过 native-messaging host 按需拉起本地 `dsh web` 服务器（`dsh install-browser-host --extension <id>` 一次注册，源码模式与构建产物模式均支持）；
- 提交：`051b610f`、`894bbee2`、`90ce867b`。

### 2. 页面上下文感知

- 侧边栏内提问时，Agent 自动知道当前活动标签页（含本地 `file://` 文档，如 PDF）；关闭页面后有显式的"无活动页面"更正快照，杜绝过期上下文；
- 上下文作为持久 `user/message` source 元数据入会话日志，满足上游"模型可见 ⟺ 已记录"不变式；同页去重，只在变化时注入一次快照；
- 提交：`4e1e15a3`、`d4899824`。

### 3. vision-bridge 多模态读图（含链路修复）

- `vision-bridge` 让纯文本模型（如 DeepSeek-V4-Flash）借助本地多模态模型（如 ollama 的 gemma4）读图：请求因图片被拒时自动转写为文字描述并重试，另提供 `analyze_image` 工具追问细节；
- 本版修复了两处链路缺口：`read_image` 工具的路由门禁认可已武装的桥接；工具结果（tool/result）内嵌图片同样被转写，且替换保持 call/result 配对；
- 提交：`4683f0e5`、`cfafe74d`、`a3f3f786`。

### 4. 语音输入（Voice Input）

- 输入框工具栏新增麦克风按钮，基于 Web Speech API 听写，转写文字经草稿状态机追加（撤销/命令 token/发送行为与手打一致）；
- 侧边栏内识别运行在扩展顶级页面并桥接回应用（绕过 Chrome 对跨源 iframe 的 Web Speech 限制），配套一次性的扩展麦克风授权页；
- 提交：`0b81b3cf`、`44f340a5`、`90ce867b`。

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

## 同步上游

```sh
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git fetch upstream && git merge upstream/master
```
