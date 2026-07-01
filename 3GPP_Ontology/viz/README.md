# 3GPP Ontology — 本体可视化应用

基于 `@ontology/viz` 的 3GPP 网络拓扑本体交互式可视化。

## 快速启动

```bash
cd 3GPP_Ontology/viz
pnpm dev
```

浏览器访问 `http://localhost:5173`。

## 架构

```
3GPP_Ontology/viz/
├── src/
│   ├── main.tsx          ← React 入口
│   ├── App.tsx           ← 主应用：加载TTL → 渲染Graph + Panel
│   ├── app.css           ← 应用布局样式
│   ├── config.ts         ← 3GPP专用配置 (TTL路径、色板、筛选维度)
│   └── vite-env.d.ts     ← Vite 类型声明
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 数据源

应用在启动时加载以下 TTL 文件：

1. `../ontology/3gpp-5gs-topology.ttl` — 5G SA 拓扑核心
2. `../ontology/3gpp-epc-topology.ttl` — 4G EPC CUPS 扩展
3. `../ontology/3gpp-pm-qoe-scaffold.ttl` — KPI/QoE 脚手架

## 功能

### 交互式图谱
- 类节点按 **网络域** 着色（终端=红 / 无线=绿 / 传输=黄 / 核心=蓝 / 服务=紫）
- 节点边框标注 **溯源层级**（L1 实线 / L2 虚线 / L3 点线）
- 对象属性边按 **方向** 着色（用户面=绿 / 控制面=蓝）
- 参考点个体以虚线边框节点显示

### 筛选器
- **域筛选**：按 Terminal / Radio Access / Transport / Core / Service 域过滤
- **代际筛选**：按 4G / 5G 过滤
- **溯源层级筛选**：按 L1 / L2 / L3 过滤
- **搜索**：按类名、缩写、描述模糊搜索

### 溯源面板
点击任意节点或边，右侧面板展示：
- **基本信息**：IRI、缩写、类型、中文名
- **描述**：rdfs:comment 完整文本
- **溯源证据**：
  - L1：spec 引用 + 条款号
  - L2：设计理由（中文）+ 推导来源
  - L3：范围说明 + 设计理由
- **拓扑约束**（属性专用）：domain / range / subPropertyOf

## Spec

- OWL 2 Web Ontology Language (W3C Recommendation)
- RDF 1.1 Turtle (W3C Recommendation)
- 3GPP Release 19 specifications (see `../specs/INDEX.md`)
