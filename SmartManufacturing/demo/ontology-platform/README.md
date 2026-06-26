# Ontology Platform Demo

这是一个基于 `React + TypeScript + Vite` 的前端 demo，用于演示：

- About 页面
- 本体数据导入与自动化建模入口
- 本体查看与管理
- 基于本体的 Agent 业务问答

其中本体查看页使用交互式图谱主画布，围绕 `Object / Link / Function / Action` 展示异构结构；详情、依赖和逻辑体编辑下沉到抽屉与次级窗口。

## 运行方式

在 `demo/ontology-platform` 目录安装依赖并启动：

```bash
npm install
npm run dev
```

默认访问：

```text
http://127.0.0.1:5173/
```

主要页面分别是：

- `/about.html`：About
- `/index.html`：导入与建模
- `/ontology.html`：本体查看与管理
- `/qa.html`：Agent 问答

## 构建

```bash
npm run build
```
