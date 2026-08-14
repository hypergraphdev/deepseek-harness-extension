# @deepseek-ai/dsh-vision-bridge

[English](README.md) | 中文

让纯文本聊天模型借助配置的多模态模型转述，从而在含图片的对话中继续工作。桥接是响应式的：图片原样进入会话日志；当模型请求以 `UNSUPPORTED_CONTENT` 失败时，桥接把每个含图片的 `user/message` surface 节点交给视觉路由转述，每张图追加一条 `vision-bridge/caption` 事件，再用纯文本替换节点（`surfaceOp: replace`，与压缩同一机制）遮蔽原节点并重试该步。原始事件保持 append-origin，因此人类可见的转录里图片不丢，而模型面看到的是转述文本。配置了路由后，`analyze_image` 工具让文本模型继续就日志中的任意图片追问细节，API 宿主也会放行原本因模态检查而拒绝的图片上传与模型切换。

## 配置

```yaml
- id: vision-bridge
  name: '@deepseek-ai/dsh-vision-bridge'
  config:
    provider: ollama          # provider route serving the vision model
    model: qwen3.6:latest     # provider-owned vision model id
    # prompt: <transcription instruction>   # default asks for a detailed description
    # maxTokens: 1024                       # default; output cap per transcription
```

`provider` 与 `model` 必须成对设置；只设一半会在插件加载时抛错，settings 写入点同样拒绝。两者都未设置时桥接以休眠状态挂载：没有工具、不改变准入、所有图片能力拒绝保持原行为。随附的 base bundle 以休眠状态挂载它；`settings.yaml`（热加载）中的 `vision-bridge:` 段可实时提供或清除路由，`analyze_image` 随之注册或撤销。

## 修复流程

1. 某一步以 `UNSUPPORTED_CONTENT` 失败（纯文本适配器拒绝了图片内容）。
2. 逐个转述含图片的 `user/message` surface 节点：每张图一次桥接调用（`purpose: 'vision-bridge'`），每次转述一条持久 `vision-bridge/caption` 事件。
3. 替换 `user/message`（保留原 source，图片换成转述文本）以 `surfaceOp: {op: replace}` 遮蔽原节点；该步重试并派生出纯文本历史。

转述失败时告警并委派，让原失败保持终态。嵌在 `tool-result` 内容里的图片不做处理——替换 `tool/result` 节点会破坏工具调用配对——这类会话在纯文本路由上仍会拒绝。

## Model Experience

### 转述替换

#### 模型看到什么

修复后，派生历史中每张图片的位置换成如下文本（图片本身从模型面移除）：

##### 替换文本

```markdown
[Image "<name>" (attachment <attachmentId>, <mediaType>, <width>x<height>) transcribed by <model>:]
<transcription>
[The original image is preserved. Call the analyze_image tool with this attachment id to ask specific questions about it.]
```

#### Token 影响

每张图片消耗一次辅助视觉请求（受 `maxTokens` 约束），此后该会话的每个请求中由转述文本替代图片字节。

#### KV Cache 影响

修复会改写派生历史的既有前缀，重试请求需完整重读一次上下文；之后的请求在改写后的前缀上仅追加复用。

### `analyze_image` 工具

#### 模型看到什么

配置了路由时多出一个工具 schema：`analyze_image(attachment_id, question)`，返回 `{ answer }`。转述文本中直接给出应传入的 attachment id。

#### Token 影响

配置期间每个请求携带一份工具 schema；每次调用增加一次辅助视觉请求，答案文本作为持久工具结果保留。

#### KV Cache 影响

仅追加；工具结果跟在可复用请求前缀之后，不使既有 KV-cache 条目失效。

## Known Limitations and Deferred Work

- **转述有损且不可逆。** 被替换的节点不会恢复图片形态：会话切回视觉模型后看到的仍是转述而非原图。`analyze_image` 是找回细节的通道。
- **不桥接 `tool-result` 中的图片**——图片经工具进入的会话（如视觉路由上的 `read_image`）在纯文本路由上仍被拒绝。
- **每次出现各转述一次。** 同一附件在后续消息中重发会再次转述；caption 事件是来源记录，不是缓存。
- **主动桥接暂缓。** 修复路径每个图片轮次多付一次被拒请求（DeepSeek 适配器在序列化时本地拒绝，无 provider 往返）；改为准入时转述待响应式路径显出实际成本后再考虑。
