# 制造设计变更切换成本分析 Demo

这是一个无依赖的最小 Demo，用于展示：

- 本体 schema 如何表达制造设计变更切换成本分析场景
- `FunctionSpec / ActionSpec` 如何驱动 Agent 的分析链路
- 用户问题如何被对齐到本体，再生成可追溯的成本报告

## 目录

- `index.html`：三联屏演示页面
- `data.mjs`：本体 schema、能力层和案例数据
- `engine.mjs`：Agent 推理引擎与报告生成逻辑
- `main.mjs`：前端交互与页面渲染
- `styles.css`：页面样式

## 运行

在仓库根目录执行：

```bash
python3 -m http.server 8000
```

然后访问：

```text
http://localhost:8000/demo/manufacturing-cutover/
```

## 验证

运行无依赖测试：

```bash
node tests/manufacturing-demo.test.mjs
```
