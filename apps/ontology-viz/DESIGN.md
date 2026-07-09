# OntologyViz Design Notes

## 目标

OntologyViz 的长期目标不是只做一个独立页面，而是沉淀一套可嵌入其他本体产品的可视化能力。

后续开发以 G6 生态为主，不再保留此前基于 React Flow、D3 Force、Dagre 和自定义边连接逻辑的实现负担。旧代码可以作为需求参考，但不作为必须兼容的技术基础；重构时允许从头开始实现。

## 产物形态

当前只考虑两个主要产物：

1. **静态 Web App**
   - 面向普通业务用户。
   - 用户通过浏览器访问 URL 使用，不需要安装 Node、pnpm、npm 或 corepack。
   - 支持文件导入、默认本体加载、最近打开、设置弹窗、布局保存等完整应用能力。
   - 构建结果是 Vite `dist`，可部署到内网静态服务器、Nginx、对象存储或 Pages 服务。

2. **npm 组件包**
   - 面向其他前端产品和开发者。
   - 提供本体解析、图数据转换、G6 画布、可选配置 UI 等模块。
   - 不应该强制包含独立 Web App 的文件导入、最近打开、顶部工具栏和本地存储策略。

Tauri 暂不作为当前路线。Electron 也不作为默认路线。

## 分层原则

Web App 是组件包的一个消费者，不是组件包能力的中心。

推荐的模块边界如下：

```text
@ontology/viz
  core
    本体解析、标准图模型、配置 schema、纯数据转换

  g6
    G6 GraphData 适配、布局配置、样式映射、行为和插件配置

  react
    可嵌入 React 组件，例如 OntologyGraphCanvas、SettingsDialog、DetailPanel

  standalone
    完整 Web App 壳：文件导入、最近打开、顶部栏、本地存储、默认本体加载
```

初期可以先保持一个 npm 包，通过 subpath exports 暴露模块：

```ts
import { parseOntology } from "@ontology/viz/core";
import { toG6GraphData } from "@ontology/viz/g6";
import { OntologyGraphCanvas } from "@ontology/viz/react";
import { OntologyVizApp } from "@ontology/viz/standalone";
```

未来如果包体积、依赖或版本管理需要更细，可以再拆成多个 npm 包。

## 嵌入式使用边界

其他本体产品嵌入时，通常已经有自己的数据来源、导航、权限、配置存储和页面布局。因此核心组件必须数据驱动，不依赖 standalone app 的 UI。

核心画布组件应接近下面的形态：

```tsx
<OntologyGraphCanvas
  data={graphData}
  config={visualConfig}
  layout={layoutConfig}
  selectedId={selectedId}
  onSelect={setSelectedId}
  onLayoutChange={saveLayout}
/>
```

不应该由 `OntologyGraphCanvas` 自己决定：

- 从哪个 URL 加载本体。
- 是否显示文件导入按钮。
- 最近打开如何保存。
- 顶部工具栏长什么样。
- 布局配置保存到 localStorage 还是后端。

这些属于 standalone app 或宿主产品。

## 本体转换模块

本体转换能力必须是无 UI 依赖的纯模块。

职责包括：

- 读取 OWL、RDF/XML、Turtle、N3 等文本内容。
- 提取 `owl:Class`、`owl:ObjectProperty`、`owl:DatatypeProperty`、`owl:AnnotationProperty`。
- 提取 `rdfs:subClassOf`、`rdfs:domain`、`rdfs:range`、`rdfs:subPropertyOf` 等显式关系。
- 保留 label、comment、namespace、IRI、sourceRefs 等原始字段。
- 输出统一的 `OntologyGraphData`。

不做的事情：

- 不做类型推断。
- 不内置 NPD、3GPP 或其他数据集特定规则。
- 不依赖 React、DOM、G6 或浏览器文件控件。

## G6 适配模块

G6 适配层负责把通用本体图数据转换为 G6 可渲染配置。

职责包括：

- `OntologyGraphData` 到 G6 `GraphData` 的转换。
- 节点颜色、边颜色、标签、箭头、状态样式映射。
- ForceAtlas2、D3 Force、AntV Dagre、Concentric、Radial 等布局配置。
- Minimap、Tooltip、Legend、History、Contextmenu、Hull、EdgeBundling 等插件配置。
- click select、hover activate、focus element、drag canvas、zoom canvas 等行为配置。
- 布局快照导入导出。

不做的事情：

- 不解析本体文件。
- 不写宿主产品的业务 UI。
- 不硬编码某个数据集的字段解释。

## React 组件模块

React 组件分为低层和高层：

1. **低层画布组件**
   - 只接收 `data`、`config`、`layout` 和事件回调。
   - 内部创建、更新和销毁 G6 Graph 实例。
   - 不显示导入按钮、最近打开、应用标题。

2. **可选 UI 组件**
   - 设置弹窗。
   - 详情面板。
   - 布局选择器。
   - 搜索框。
   - 图例和过滤器。

3. **Standalone App**
   - 组合低层画布和可选 UI。
   - 负责完整产品体验。

## 配置与存储

配置数据应该由宿主决定如何保存。

组件包可以提供默认 localStorage 适配器，但不能强制使用：

```ts
interface LayoutStorageAdapter {
  loadLayout(ontologyId: string): Promise<LayoutSnapshot | undefined>;
  saveLayout(ontologyId: string, layout: LayoutSnapshot): Promise<void>;
}
```

Standalone app 可使用 localStorage 或 IndexedDB。其他产品可接入后端、项目配置、用户偏好或知识库配置中心。

## 样式与主题

组件包样式应局部化，避免污染宿主产品。

要求：

- 使用稳定 class 前缀，例如 `ontology-viz-`。
- 通过 CSS variables 暴露主题能力。
- 不依赖全局 reset。
- 不把宿主页面背景、字体、滚动条等全局样式写死。

示例：

```css
.ontology-viz-root {
  --ontology-viz-node-class-color: #2563eb;
  --ontology-viz-node-property-color: #7c3aed;
  --ontology-viz-edge-default-color: #64748b;
}
```

## npm 包发布要求

当前 workspace 内的源码直出形式只适合本仓库开发，不适合正式发布。

正式 npm 包应满足：

- `private: false`。
- 构建输出到 `dist`。
- `exports` 指向构建产物，而不是 `src`。
- 输出 `.d.ts` 类型文件。
- CSS 通过 subpath export 暴露。
- React 和 ReactDOM 放在 peerDependencies。
- G6 依赖由包管理，或在需要更强控制时声明为 peerDependency。
- 配置 `files`，避免发布测试数据、应用代码和无关文档。

推荐导出形态：

```json
{
  "name": "@ontology/viz",
  "type": "module",
  "exports": {
    "./core": {
      "types": "./dist/core/index.d.ts",
      "import": "./dist/core/index.js"
    },
    "./g6": {
      "types": "./dist/g6/index.d.ts",
      "import": "./dist/g6/index.js"
    },
    "./react": {
      "types": "./dist/react/index.d.ts",
      "import": "./dist/react/index.js"
    },
    "./standalone": {
      "types": "./dist/standalone/index.d.ts",
      "import": "./dist/standalone/index.js"
    },
    "./styles": "./dist/styles.css"
  }
}
```

## Web App 职责

`apps/ontology-viz` 只负责独立应用体验。

包括：

- 默认本体文件加载。
- 用户文件导入。
- 最近打开。
- 顶栏、设置入口、搜索框、布局选择器。
- 调用组件包提供的画布和设置组件。
- 使用本地存储保存 standalone app 的配置。

不包括：

- G6 底层实现。
- 本体解析核心逻辑。
- 数据集特定规则。
- 其他产品的业务流程。

## G6-first 重写原则

后续实现时遵循：

- 不继续维护 React Flow handle、edge path、minimap、selection、viewport 等自研逻辑。
- 不继续维护自写 D3/Dagre 布局引擎。
- 优先使用 G6 内置布局、行为、插件和 transform。
- 对 G6 做薄封装，而不是再造一套图引擎。
- 如果 G6 能通过配置解决，不写自定义算法。
- 如果必须扩展，扩展点应集中在 `g6` adapter 层。

旧代码可以删除或整体替换。不要为了兼容旧实现保留复杂适配层。

## 近期实施顺序

1. 定义新的 `OntologyGraphData`、`VisualConfig`、`LayoutConfig`、`LayoutSnapshot`。
2. 将本体解析整理为 `core` 纯函数。
3. 新建 G6 adapter 和低层 `OntologyGraphCanvas`。
4. 用 NPD 作为默认测试输入验证 ForceAtlas2、D3 Force 和 AntV Dagre。
5. 重建 standalone app 壳，复用低层组件。
6. 移除 React Flow、D3 Force、Dagre 和旧自研布局代码。
7. 补齐 npm package build、exports、类型声明和 app build 脚本。

## 实施记录

### 阶段 1：core 子模块出口

状态：已实现并验证。

目标：

- 给无 UI 的本体解析和图数据模型建立稳定入口。
- 让后续 G6 adapter、React canvas、standalone app 都依赖同一份 `OntologyGraphData`。
- 暂时保留现有解析实现，先建立新边界，避免在同一步里同时改 parser、G6 和 UI。

范围：

- 新增 `@ontology/viz/core` subpath。
- 导出通用命名的 `OntologyGraphData`、`OntologyEntity`、`OntologyEdge`、`OntologyParseOptions` 等类型。
- 导出 `parseOntology`、`getOntologyDefaultLabel`、`getOntologyDefaultDescription`、`getOntologyDisplayValue` 等纯函数。
- 保留旧的 `ExplicitOntology*` API，避免当前 app 立即断裂。

不在本阶段做：

- 不引入 G6。
- 不修改当前 React Flow viewer。
- 不修改 standalone app 的文件导入和最近打开。
- 不改变解析语义，不做类型推断。

验收标准：

- `@ontology/viz/core` 可以被 TypeScript 解析。
- `parseOntology` 返回现有 parser 等价的图数据。
- 包内类型检查通过。
- 工作区只提交 core 子模块和设计文档相关变动。

验证记录：

- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 目录执行 `node --input-type=module -e "console.log(await import.meta.resolve('@ontology/viz/core'))"`，解析到 `packages/ontology-viz/src/core/index.ts`。
- `pnpm --filter @ontology/viz typecheck` 在当前环境会触发 pnpm registry 元数据请求并失败，本阶段未依赖该命令作为验证依据。

### 阶段 2：G6 数据与布局适配层

状态：已实现并验证。

目标：

- 新增 `@ontology/viz/g6` subpath，作为 core 图数据和 G6 渲染之间的唯一适配边界。
- 把 `OntologyGraphData` 转换为 G6 风格的 `{ nodes, edges }` 数据。
- 提供 G6 内置布局的默认配置，不实现自定义布局算法。

范围：

- 新增 `toG6GraphData(data, options)`。
- 新增 ForceAtlas2、D3 Force、AntV Dagre 的默认布局配置函数。
- 节点默认使用 G6 circle 节点，固定 `36px` 视觉尺寸。
- 节点和边的颜色仅按类型映射，不做数据集特定规则。
- 边默认使用直线、中心连接，由 G6 元素模型处理端点。

不在本阶段做：

- 不创建 G6 `Graph` 实例。
- 不创建 React 组件。
- 不实现拖拽、选择、高亮、tooltip、minimap 等交互。
- 不引入自定义边 path、handle 或碰撞算法。

验收标准：

- `@ontology/viz/g6` 可以被 Node package exports 解析。
- 包内类型检查通过。
- G6 adapter 不依赖 React Flow、D3 Force 或 Dagre。
- 工作区只提交 G6 adapter 和设计文档相关变动。

验证记录：

- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 目录执行 `node --input-type=module -e "console.log(await import.meta.resolve('@ontology/viz/g6'))"`，解析到 `packages/ontology-viz/src/g6/index.ts`。
- `rg -n "from ['\"](@xyflow/react|d3-force|@dagrejs/dagre)" packages/ontology-viz/src/g6 packages/ontology-viz/src/core` 无匹配，确认新 adapter 没有 import 旧图谱库。

### 阶段 3：G6 依赖与低层 React 画布

状态：已实现并验证。

目标：

- 引入官方 G6 运行时依赖。
- 新增低层 `OntologyGraphCanvas`，只负责创建、更新和销毁 G6 `Graph` 实例。
- 让 React 层消费 `@ontology/viz/core` 和 `@ontology/viz/g6`，不直接处理本体解析细节。

范围：

- 增加 `@antv/g6` 依赖。
- 新增 `@ontology/viz/react` subpath。
- `OntologyGraphCanvas` props 只接收 `data`、adapter options、layout mode 和选择事件。
- 使用 G6 内置布局、行为和插件。
- 组件本身不包含文件导入、最近打开、应用顶栏和配置弹窗。

不在本阶段做：

- 不替换 standalone app。
- 不迁移旧 `ConfigurableOntologyViewer`。
- 不实现复杂详情面板。
- 不实现自定义 G6 node/edge class。

验收标准：

- 包内类型检查通过。
- `@ontology/viz/react` 可以被 package exports 解析。
- 组件代码不 import React Flow、D3 Force 或 Dagre。
- G6 Graph 实例在 React effect cleanup 中销毁。

验证记录：

- `pnpm add @antv/g6@5.1.1 --filter @ontology/viz --config.confirmModulesPurge=false`
- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 目录执行 `node --input-type=module -e "console.log(await import.meta.resolve('@ontology/viz/react'))"`，解析到 `packages/ontology-viz/src/react/index.ts`。
- `rg -n "from ['\"](@xyflow/react|d3-force|@dagrejs/dagre)" packages/ontology-viz/src/react packages/ontology-viz/src/g6 packages/ontology-viz/src/core` 无匹配。
- `OntologyGraphCanvas` 在 mount 时创建 G6 `Graph`，在 effect cleanup 中调用 `graph.destroy()`。
