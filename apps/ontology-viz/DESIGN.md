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

### 阶段 4：standalone app 切换到 G6 canvas

状态：已实现并验证。

目标：

- 让独立 Web App 使用新的 `core + react canvas` 分层。
- 用最小可用 app 壳替换旧 `ConfigurableOntologyViewer` 入口。
- 保留默认本体加载和用户文件导入，先让 G6 可视化路径跑通。

范围：

- `OntologyVizApp` 使用 `parseOntology` 和 `OntologyGraphCanvas`。
- 页面只包含标题、当前本体名称、导入按钮、加载/错误状态和全屏画布。
- 点击节点/边时记录当前选择 id，作为后续详情面板的数据入口。
- 不再从 standalone app 入口调用旧 React Flow viewer。

不在本阶段做：

- 不迁移旧设置弹窗。
- 不实现详情侧栏。
- 不实现最近打开。
- 不删除旧组件文件。

验收标准：

- app 构建通过。
- 包内类型检查通过。
- `OntologyVizApp` 不 import `ConfigurableOntologyViewer`。
- 应用入口不 import React Flow、D3 Force 或 Dagre。

验证记录：

- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 目录执行 `node_modules/.bin/vite build`，构建通过。
- `rg -n "ConfigurableOntologyViewer|@xyflow/react|d3-force|@dagrejs/dagre" packages/ontology-viz/src/components/OntologyVizApp.tsx apps/ontology-viz/src` 无匹配。
- 当前构建产物提示主 JS chunk 约 `1.9 MB`，后续需要 code split 或 manualChunks 优化；这不阻塞阶段 4 的功能切换验收。

### 阶段 5：可复用详情面板

状态：已实现并验证。

目标：

- 新增可嵌入的 `OntologyDetailPanel`，展示当前选中的本体实体或关系。
- 让 standalone app 点击节点/边时显示浮动详情面板，点击画布或关闭按钮时隐藏。
- 保持详情面板独立于 G6 `Graph` 实例、文件导入和应用顶栏。

范围：

- `OntologyDetailPanel` 放在 `@ontology/viz/react`。
- 组件接收已解析的实体或边对象，不自己查询图数据。
- 实体详情展示 label、kind、IRI、namespace 和 description。
- 边详情展示 label、kind、source、target 和 property IRI。
- standalone app 根据当前 selection 从 `OntologyGraphData` 中查找实体或边后传入面板。

不在本阶段做：

- 不实现一跳高亮。
- 不实现字段配置和详情字段选择。
- 不实现编辑能力。
- 不引入 G6 tooltip 插件。

验收标准：

- 未选择节点或边时不渲染详情面板。
- 选择节点或边时显示对应详情。
- 包内类型检查和 app 构建通过。
- 详情组件不 import G6、React Flow、D3 Force 或 Dagre。

验证记录：

- `OntologyDetailPanel` 在 `item` 为空时返回 `null`。
- `OntologyVizApp` 根据当前 selection 从 `OntologyGraphData` 查找实体或边后传入 `OntologyDetailPanel`。
- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 目录执行 `node_modules/.bin/vite build`，构建通过。
- `rg -n "@antv/g6|@xyflow/react|d3-force|@dagrejs/dagre" packages/ontology-viz/src/react/OntologyDetailPanel.tsx` 无匹配。
- 当前构建产物主 JS chunk 约 `1.91 MB`，仍需后续做 code split 或 manualChunks。

### 阶段 6：布局切换控件

状态：已实现并验证。

目标：

- 新增可复用的布局切换控件。
- standalone app 支持在 ForceAtlas2、D3 Force、AntV Dagre 之间切换。
- 布局切换只改变 `OntologyGraphCanvas` 的 `layoutMode`，实际布局仍由 G6 内置布局执行。

范围：

- `OntologyLayoutControl` 放在 `@ontology/viz/react`。
- 控件接收当前布局值和 `onChange` 回调。
- standalone app 在顶栏展示布局控件。
- 默认布局仍为 ForceAtlas2。

不在本阶段做：

- 不保存用户布局偏好。
- 不保存节点坐标。
- 不增加布局参数编辑。
- 不实现自定义布局算法。

验收标准：

- 切换控件不 import 官方 `@antv/g6` runtime、React Flow、D3 Force 或 Dagre。
- `OntologyVizApp` 将 layout mode 传给 `OntologyGraphCanvas`。
- 包内类型检查和 app 构建通过。

验证记录：

- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 目录执行 `node_modules/.bin/vite build`，构建通过。
- `rg -n "from ['\"](@antv/g6|@xyflow/react|d3-force|@dagrejs/dagre)" packages/ontology-viz/src/react/OntologyLayoutControl.tsx` 无匹配。
- `OntologyVizApp` 持有 `layoutMode` state，并传给 `OntologyGraphCanvas`。

### 阶段 7：删除旧可视化实现与依赖

状态：已实现并验证。

目标：

- 删除已经脱离 standalone 入口的旧 React Flow viewer。
- 删除自写 D3/Dagre 布局实现。
- 从 package dependencies 中移除 React Flow、D3 Force 和 Dagre。

范围：

- 删除 `ConfigurableOntologyViewer.tsx`。
- 删除 `graphLayout.ts`。
- 从根出口移除 `ConfigurableOntologyViewer` 和 `DEFAULT_EXPLICIT_ONTOLOGY_CONFIG`。
- 更新 README，描述新的 `core`、`g6`、`react` 和 standalone API。
- 更新 package dependencies 和 lockfile。

不在本阶段做：

- 不删除 parser 和 `ExplicitOntology*` 类型。
- 不重写配置 schema。
- 不清理所有旧 CSS 选择器。
- 不改变 standalone app 当前行为。

验收标准：

- `packages/ontology-viz/src` 不再 import `@xyflow/react`、`d3-force` 或 `@dagrejs/dagre`。
- `packages/ontology-viz/package.json` 不再声明旧图谱依赖。
- 包内类型检查和 app 构建通过。
- README 不再推荐旧 `ConfigurableOntologyViewer`。

验证记录：

- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 目录执行 `node_modules/.bin/vite build`，构建通过。
- `rg -n "from ['\"](@xyflow/react|d3-force|@dagrejs/dagre)" packages/ontology-viz/src` 无匹配。
- `rg -n "\"(@xyflow/react|d3-force|@dagrejs/dagre|@types/d3-force)\"" packages/ontology-viz/package.json` 无匹配。
- 删除旧实现后构建主 JS chunk 从约 `1.91 MB` 降到约 `1.69 MB`；仍需后续 code split 或 manualChunks。

### 阶段 8：standalone app 构建分块

状态：已实现并验证。

目标：

- 降低 standalone app 主 JS chunk 体积。
- 把 AntV/G6 相关依赖拆成独立 vendor chunk。
- 保持运行时代码和组件 API 不变。

范围：

- 在 `apps/ontology-viz/vite.config.ts` 配置 Rollup `manualChunks`。
- 将 `node_modules/@antv` 与 G6 相关依赖拆到 `antv-g6` chunk。
- 其他第三方依赖统一拆到 `vendor` chunk。
- 保留 `base: "./"`，继续支持静态文件部署。

不在本阶段做：

- 不做动态 import。
- 不改变 npm 包 exports。
- 不改变组件代码。

验收标准：

- app 构建通过。
- 构建输出中出现独立 `antv-g6` chunk。
- app 主 JS chunk 低于阶段 7 的约 `1.69 MB`。

验证记录：

- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 目录执行 `node_modules/.bin/vite build`，构建通过。
- 初始尝试拆分 `react-vendor` 时出现 Rollup circular chunk 警告，已更新设计并收窄为 `antv-g6 + vendor`。
- 最终构建输出包含 `antv-g6-Dt7M8Rid.js`，主 app chunk 降到约 `15 KB`，`antv-g6` chunk 约 `1.18 MB`，`vendor` chunk 约 `579 KB`。
