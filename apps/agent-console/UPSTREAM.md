# Upstream provenance

`src/` 中的 Web 客户端源自：

- project: [formulahendry/acp-ui](https://github.com/formulahendry/acp-ui)
- version: `0.1.16`
- commit: `cd9c3cb464a4b321bff652101953a64c07473e31`
- commit date: 2026-05-25
- license: MIT，见本目录 `LICENSE`

## 保留的上游能力

- ACP 初始化、Session 创建/加载、Prompt、取消、认证和 Permission 交互；
- Agent 消息、Thinking、Plan 与 Tool Call 展示；
- Vue/Pinia 的单页对话基础结构。

## 有意偏离

- 只保留 Web 传输；删除桌面/本地前端传输、主机存储抽象和浏览器自定义 Agent 入口。
- Profile、Dataset 和 Runtime Catalog 只来自同源 Bridge；浏览器不能提供命令、cwd、
  模型或环境变量。
- OpenCode 的 `session/list` 是 Session Catalog 事实源；浏览器不持久化 Session、
  Agent 地址、凭据或运行历史。
- 每个 Runtime 复用一条 ACP 连接，并按 `runtimeId + sessionId` 投影多个会话。
- Profile 与 Dataset 先复制为 Runtime 普通文件快照；OpenCode cwd 固定为 Runtime 的
  `workspace/`，对浏览器只投影成逻辑值 `.`。
- Runtime 的创建、状态、信息和安全删除是本项目的薄管理层，不改变 ACP 消息协议。
- 保留 ACP Tool Call 的 `rawInput`、`rawOutput` 和 `content`，用于检查与 artifact
  提取；UI 不重复显示通用 `ACP content` 面板。
- 支持 `ONTOLOGY_ARTIFACT:` 子图的轻量 SVG 预览。
- Markdown 经 DOMPurify 消毒；不会信任 Agent 或 Tool 返回的原始 HTML。
- `session/prompt` 不使用普通短请求超时；传输关闭会显式拒绝所有待处理请求并取消
  Permission。
- 删除 Azure Application Insights、传输事件诊断面板和产品遥测。
- 使用简单的原生对话框、`details` 与 CSS；不引入额外 UI 框架。

上游升级必须是显式工作。更新 pinned commit 前，应重新核对上述偏离、运行 ACP
能力测试，并在真实 WebUI 中完成多 Runtime 回归。
