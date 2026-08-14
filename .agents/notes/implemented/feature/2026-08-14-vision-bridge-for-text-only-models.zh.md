# Agent Note: 纯文本模型的视觉桥接

Status: implemented

[English](2026-08-14-vision-bridge-for-text-only-models.md) | 中文

## 问题

纯文本路由（DeepSeek 适配器声明 `inputModalities: ['text']`）在两处拒绝含图片的对话：API 宿主在准入时拒绝图片上传，图片一旦到达序列化，适配器抛出 `UNSUPPORTED_CONTENT`。同时部署了本地多模态模型（如 Ollama 提供的 Qwen）的环境无法让文本模型借用它，尽管 harness 已经为压缩与会话标题路由辅助模型调用。

## 决策

**在 `agent/request-error` 上做响应式修复，而不是请求时改写。** `@deepseek-ai/dsh-vision-bridge` 挂载 `visionBridge` 服务（休眠，直到 `vision-bridge:` settings 段或组合条目给出 provider/model 对）。图片原样进入会话日志。当某步以 `UNSUPPORTED_CONTENT` 失败且路由已配置时，桥接把每个含图片 `user/message` surface 节点中的图片逐一交给视觉路由转述（`purpose: 'vision-bridge'`），每张图追加一条 `vision-bridge/caption` 事件，用 `surfaceOp: {op: replace}`（压缩同款机制）以纯文本替换遮蔽节点，然后返回 `{kind: 'retry'}`。agent-loop 的请求重建不变量（请求消息必须等于派发时的持久派生）天然成立，因为替换先于重试的派生落盘。

**人类转录保留图片。** 按 surface 契约替换节点仅对模型可见；append-origin 事件仍是转录来源，UI 继续显示原图，附件也保持被日志引用、可授权读取。

**追问细节走随路由注册的工具。** `analyze_image(attachment_id, question)` 仅在路由可解析时注册（settings 变更实时开关），把持久图片引用和问题发给视觉路由作答。替换文本引用 attachment id 并点名该工具，文本模型可以据此找回转述中丢失的细节。

**准入只在桥接可用时放宽。** API 宿主的两处图片门（提示准入、模型切换）在 `ctx.get('visionBridge')?.route()` 可解析时也放行，采用 type-only 引用——未组合桥接的部署保持完全一致的旧拒绝行为。

## 后果

- 每次修复前有一次被拒请求（DeepSeek 适配器在序列化时拒绝，不产生 provider 往返），且修复改写派生历史前缀，重试请求需完整重读一次上下文。
- 对模型面而言转述有损且不可逆：会话切回视觉模型后看到的仍是转述，`analyze_image` 是找回细节的通道。
- 嵌在 `tool-result` 内容中的图片不做桥接；这类会话在纯文本路由上仍被拒绝。
- `GenerateOptions.purpose` 新增 `'vision-bridge'`；base bundle 以休眠状态挂载该包，未配置的部署行为与之前完全一致。

## 曾考虑的替代方案

**在 `agent/pre-step` 改写进入的消息来转述。** 不采用：换过的消息成为持久 `user/message`，图片从人类转录与附件授权中被抹掉；响应式路径两者都保留，且不需要在认领时猜测路由（模型双向切换会让 pre-step 的路由判断失准）。

**在 `llm/stream` 瀑布里改写消息。** 不采用：loop 的请求重建不变量会将派发消息与持久派生逐字对比，且架构规定消息改写只能走已记录通道。

**子代理委派（把 `tool-subagent` 实例钉在视觉模型上）。** 不作为主路径：它把整轮交给视觉模型而不是让所选文本模型作答，也无法修复已含图片的历史。需要的部署可以直接使用现成的配置机制。

**在上传准入时主动转述。** 暂缓：它省掉每个图片轮次一次本地被拒的请求，但即使会话模型本身能看图（按会话选择会变）也要花一次视觉调用，还把桥接卷入宿主准入路径。若被拒请求的成本在实践中显现再考虑。
