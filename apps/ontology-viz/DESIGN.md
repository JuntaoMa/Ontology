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

### 阶段 9：standalone subpath export

状态：已实现并验证。

目标：

- 将完整 Web App 壳作为独立 subpath 暴露。
- 让嵌入式消费者可以明确选择 `core`、`g6`、`react` 或 `standalone`。
- 降低包根出口的语义混杂。

范围：

- 新增 `@ontology/viz/standalone` subpath。
- `standalone` 只导出 `OntologyVizApp`、`OntologyVizAppProps`、`OntologyVizSource`。
- README 中将 standalone app 示例改为从 `@ontology/viz/standalone` 导入。
- 保留包根对 `OntologyVizApp` 的导出，避免当前 app 和已有调用立即断裂。

不在本阶段做：

- 不改变 `OntologyVizApp` 行为。
- 不移动源码文件。
- 不切换 package exports 到 `dist`。

验收标准：

- `@ontology/viz/standalone` 可以被 Node package exports 解析。
- 包内类型检查和 app 构建通过。
- README 展示的 standalone 导入路径使用 `@ontology/viz/standalone`。

验证记录：

- 在 `apps/ontology-viz` 目录执行 `node --input-type=module -e "console.log(await import.meta.resolve('@ontology/viz/standalone'))"`，解析到 `packages/ontology-viz/src/standalone/index.ts`。
- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 目录执行 `node_modules/.bin/vite build`，构建通过。
- README 的 standalone 示例使用 `@ontology/viz/standalone`。

### 阶段 10：npm package dist build

状态：已实现并验证。

目标：

- 让 `@ontology/viz` 具备可发布的 `dist` 构建产物。
- package exports 指向构建产物，而不是源码文件。
- app 的 `dev/build` 在运行前先构建组件包，避免 workspace 使用断裂。

范围：

- 新增 package build 脚本，清理并生成 `dist`。
- 使用 TypeScript 输出 unbundled ESM 和 `.d.ts` 类型文件。
- 复制 `src/styles/index.css` 到 `dist/styles.css`。
- 更新 `package.json` 的 `main`、`types`、`exports`、`files`。
- 更新 app scripts，使 standalone app 先构建 `@ontology/viz`。

不在本阶段做：

- 不引入 tsup、rollup library build 或 dts plugin。
- 不切换为 bundled library。
- 不处理 Node ESM 直接执行下的相对 import 扩展名问题；当前目标是前端 bundler/npm 消费。
- 不发布 npm 包。

验收标准：

- `pnpm --filter @ontology/viz build` 成功并生成 `dist/index.js`、`dist/index.d.ts`、`dist/styles.css`。
- `@ontology/viz/core`、`@ontology/viz/g6`、`@ontology/viz/react`、`@ontology/viz/standalone` 从 package exports 解析到 `dist`。
- app 构建通过。
- `dist` 不进入 git 提交。

验证记录：

- `pnpm --filter @ontology/viz build`
- `test -f packages/ontology-viz/dist/index.js && test -f packages/ontology-viz/dist/index.d.ts && test -f packages/ontology-viz/dist/styles.css`
- 在 `apps/ontology-viz` 目录执行 `node --input-type=module -e "console.log(await import.meta.resolve('@ontology/viz/core')); console.log(await import.meta.resolve('@ontology/viz/g6')); console.log(await import.meta.resolve('@ontology/viz/react')); console.log(await import.meta.resolve('@ontology/viz/standalone'))"`，全部解析到 `packages/ontology-viz/dist/*`。
- 在 `apps/ontology-viz` 目录执行 `node --input-type=module -e "console.log(await import.meta.resolve('@ontology/viz')); console.log(await import.meta.resolve('@ontology/viz/styles'))"`，解析到 `packages/ontology-viz/dist/index.js` 和 `packages/ontology-viz/dist/styles.css`。
- `pnpm --filter ontology-viz-app build`
- `git status --short` 未显示 `packages/ontology-viz/dist`，确认构建产物被 `.gitignore` 忽略。

### 阶段 11：workspace root scripts

状态：已实现并验证。

目标：

- 让开发者可以从仓库根目录启动和构建 OntologyViz。
- 将 package build、app build、typecheck 的入口统一到根 `package.json`。
- 降低新环境运行成本。

范围：

- 根 `package.json` 增加 `private`、`packageManager` 和 scripts。
- `dev` 委托到 `ontology-viz-app`。
- `build` 委托到 `ontology-viz-app`，由 app 脚本负责先构建 `@ontology/viz`。
- `build:pkg` 只构建 npm 组件包。
- `typecheck` 先构建 package，再检查 package 和 app TypeScript。

不在本阶段做：

- 不改依赖版本。
- 不改 app 或 package 运行时代码。
- 不引入新工具。

验收标准：

- 根目录 `pnpm run build:pkg` 成功。
- 根目录 `pnpm run typecheck` 成功。
- 根目录 `pnpm run build` 成功。

验证记录：

- `pnpm run build:pkg`
- 初版 `typecheck` 未先构建 package，在 exports 指向 `dist` 时 app typecheck 无法解析 `@ontology/viz`；已更新设计和脚本，使 `typecheck` 先执行 `pnpm --filter @ontology/viz build`。
- `pnpm run typecheck`
- `pnpm run build`

### 阶段 12：实体搜索与 G6 聚焦

状态：已实现并验证。

目标：

- 新增可复用实体搜索控件。
- standalone app 支持按 label、localName、IRI 搜索实体。
- 选中搜索结果后显示详情，并调用 G6 `focusElement` 聚焦元素。

范围：

- 新增 `OntologySearchBox`，放在 `@ontology/viz/react`。
- 控件接收候选项和 `onSelect` 回调，不读取 G6 或本体图数据。
- `OntologyGraphCanvas` 新增可选 `focusedElementId` prop，变化时调用 G6 `focusElement`。
- standalone app 从 `OntologyGraphData.entities` 构造搜索候选项。

不在本阶段做：

- 不搜索边。
- 不实现模糊匹配算法，只做大小写不敏感的包含匹配。
- 不实现搜索历史。
- 不自己计算视口位置或缩放。

验收标准：

- 搜索控件不 import G6、React Flow、D3 Force 或 Dagre。
- `OntologyGraphCanvas` 使用 G6 `focusElement`，不自写坐标计算。
- 选择搜索结果后 standalone app 设置 selection 并传入 `focusedElementId`。
- 包内类型检查和 app 构建通过。

验证记录：

- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- `pnpm run build`
- `pnpm run typecheck`
- `rg -n "from ['\"](@antv/g6|@xyflow/react|d3-force|@dagrejs/dagre)" packages/ontology-viz/src/react/OntologySearchBox.tsx` 无匹配。
- `OntologyGraphCanvas` 在 `focusedElementId` 变化时调用 G6 `graph.focusElement(...)`。

### 阶段 13：一跳关系高亮

状态：已实现并验证。

目标：

- 将选中节点或边的一跳邻域高亮做成 `OntologyGraphCanvas` 的通用能力。
- 使用 G6 element state 和 state style 实现视觉变化。
- standalone app 只传入当前选中元素 id，不直接操作 G6 实例。

范围：

- `OntologyGraphCanvas` 新增 `selectedElementId` prop。
- 根据当前 G6 graph data 计算一跳节点和边集合。
- 调用 G6 `setElementState` 设置 `selected`、`related`、`dimmed` 状态。
- 配置 node/edge 的 `selected`、`related`、`dimmed` state style。

不在本阶段做：

- 不实现多跳高亮。
- 不实现方向过滤。
- 不实现高亮颜色配置 UI。
- 不自己绘制高亮边或路径。

验收标准：

- `OntologyGraphCanvas` 使用 G6 `setElementState` 和 state style。
- 选中节点时，高亮该节点、一跳邻居和关联边，其余元素 dim。
- 选中边时，高亮该边和两端节点，其余元素 dim。
- 清空选择时清除所有高亮状态。
- 包内类型检查和 app 构建通过。

验证记录：

- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- `pnpm run build`
- `pnpm run typecheck`
- `OntologyGraphCanvas` 配置了 G6 node/edge `state` 样式，并在 `selectedElementId` 变化时调用 `graph.setElementState(...)`。
- `OntologyVizApp` 将当前 selection id 作为 `selectedElementId` 传给 `OntologyGraphCanvas`，画布点击和详情关闭会清空 selection。

### 阶段 14：G6 Minimap 插件

状态：已实现并验证。

目标：

- 使用 G6 官方 minimap 插件提供图谱概览。
- 将 minimap 配置放在 `@ontology/viz/g6` adapter 层，避免 standalone app 自行理解 G6 插件细节。
- 继续避免自研缩略图渲染、视口同步和元素过滤逻辑。

范围：

- 新增 G6 插件配置 helper。
- standalone app 将默认插件配置传给 `OntologyGraphCanvas`。
- minimap 使用 G6 内置的 `type: "minimap"` 插件。

不在本阶段做：

- 不实现自定义 minimap 画布。
- 不实现 minimap 参数配置 UI。
- 不实现数据集特定的 minimap 过滤规则。
- 不改变画布选择、高亮、搜索和布局逻辑。

验收标准：

- minimap 配置从 `@ontology/viz/g6` 导出。
- standalone app 只组合插件配置，不包含 minimap 渲染逻辑。
- `OntologyGraphCanvas` 继续只接收 `plugins` prop，不硬编码 standalone app 行为。
- 包内类型检查和 app 构建通过。

验证记录：

- `pnpm run typecheck`
- `pnpm run build`
- `createG6StandalonePlugins` 从 `@ontology/viz/g6` 导出，并返回 G6 `type: "minimap"` 插件配置。
- `OntologyVizApp` 使用 `useMemo` 创建插件配置，并通过 `OntologyGraphCanvas` 的 `plugins` prop 传入。
- `OntologyGraphCanvas` 未硬编码 minimap，仍由宿主决定是否传入插件。

### 阶段 15：G6 Tooltip 插件

状态：已实现并验证。

目标：

- 使用 G6 官方 tooltip 插件提供 hover 信息。
- tooltip 内容从 G6 datum 中的本体实体和关系数据生成，避免 standalone app 拼接字段。
- 将 tooltip 配置保持在 `@ontology/viz/g6` adapter 层，作为可选插件能力。

范围：

- 新增 `createG6TooltipPlugin`。
- 将 tooltip 加入 `createG6StandalonePlugins` 的默认插件组合。
- tooltip 展示实体的 label、kind、localName、IRI，以及关系的 label、kind、source、target、property IRI。
- 使用组件包样式前缀定义 tooltip 内容样式。

不在本阶段做：

- 不实现自定义 tooltip React 浮层。
- 不实现 tooltip 字段配置 UI。
- 不做多语言配置。
- 不改变点击详情面板。

验收标准：

- tooltip 使用 G6 `type: "tooltip"` 插件。
- tooltip 内容函数在 G6 adapter 层实现。
- standalone app 不 import tooltip 组件或手写 hover 事件。
- 包内类型检查和 app 构建通过。

验证记录：

- `pnpm run typecheck`
- `pnpm run build`
- `createG6TooltipPlugin` 从 `@ontology/viz/g6` 导出，并返回 G6 `type: "tooltip"` 插件配置。
- `createG6StandalonePlugins` 组合 tooltip 和 minimap，standalone app 无需单独处理 hover 事件。
- tooltip 内容通过 G6 datum 的 `data.entity` / `data.edge` 生成，并使用 `ontology-viz-` 前缀样式。

### 阶段 16：可复用视觉设置弹窗

状态：已实现并验证。

目标：

- 将当前已有的 G6 adapter options 暴露为可视化设置 UI。
- 设置组件放在 `@ontology/viz/react`，standalone app 只保存配置状态并传给画布。
- 配置范围保持克制，只覆盖实体类型可见性、节点标签、边标签和边箭头。

范围：

- 新增 `OntologyVisualSettings`。
- 组件接收 `OntologyG6AdapterOptions` 和 `onChange`。
- 设置弹窗支持点击按钮打开、点击空白关闭、按 Escape 关闭。
- standalone app 将设置结果作为 `adapterOptions` 传给 `OntologyGraphCanvas`。

不在本阶段做：

- 不做颜色选择器。
- 不做字段选择器。
- 不做布局参数编辑。
- 不做配置持久化。
- 不做数据集特定设置项。

验收标准：

- 设置组件不 import G6 runtime。
- standalone app 不直接改 G6 图实例，只更新 `adapterOptions`。
- 设置项均来自已有 adapter options。
- 包内类型检查和 app 构建通过。

验证记录：

- `pnpm run typecheck`
- `pnpm run build`
- `OntologyVisualSettings` 从 `@ontology/viz/react` 导出，接收 `OntologyG6AdapterOptions` 和 `onChange`。
- `OntologyVizApp` 只保存 `adapterOptions` state，并传给 `OntologyGraphCanvas`。
- `rg -n "@antv/g6|Graph\\b|new Graph|setData|setLayout" packages/ontology-viz/src/react/OntologyVisualSettings.tsx packages/ontology-viz/src/components/OntologyVizApp.tsx` 只命中 app 的 `setLayoutMode` 状态命名，未发现设置组件或 app 直接 import `@antv/g6`、创建 `Graph` 或调用图实例数据 API。

### 阶段 17：standalone 视图偏好持久化

状态：已实现并验证。

目标：

- standalone app 自动保存并恢复当前本体的布局模式和视觉设置。
- 存储策略保留在 standalone app，低层画布和设置组件不直接访问 localStorage。
- 偏好绑定本体来源 key，而不是绑定全局页面状态。

范围：

- 默认 URL 本体使用 `source.storageKey ?? source.url` 作为偏好 key。
- 用户导入文件使用文件名和内容 hash 作为偏好 key。
- 保存 `layoutMode` 和 `adapterOptions`。
- 加载同一来源本体时自动恢复偏好。

不在本阶段做：

- 不保存节点坐标快照。
- 不实现后端配置存储。
- 不实现最近打开列表。
- 不将 localStorage 策略下沉到低层画布。

验收标准：

- `OntologyGraphCanvas` 不访问 localStorage。
- `OntologyVisualSettings` 不访问 localStorage。
- standalone app 负责读取和保存偏好。
- 包内类型检查和 app 构建通过。

验证记录：

- `pnpm run typecheck`
- `pnpm run build`
- `rg -n "localStorage|VIEW_PREFERENCES|sourceKeyFromFile|hashContent" packages/ontology-viz/src/react packages/ontology-viz/src/components/OntologyVizApp.tsx packages/ontology-viz/src/g6` 只命中 `OntologyVizApp.tsx`。
- `OntologyVizApp` 在加载默认 URL 或导入文件时读取偏好，并在当前本体 ready 后保存 `layoutMode` 和 `adapterOptions`。
- 导入文件的偏好 key 使用文件名和内容 hash，不再依赖 UI 展示 label。

### 阶段 18：删除旧可视化样式

状态：已实现并验证。

目标：

- 删除 React Flow、旧 3GPP/NPD 卡片、旧 provenance panel 和旧 toolbar 的样式残留。
- 让组件包样式只覆盖当前 G6-first 实现实际使用的 `ontology-viz-*` 类。
- 降低 CSS 体积和后续误用旧组件样式的风险。

范围：

- 重建 `src/styles/index.css`。
- 保留当前 app shell、导入按钮、G6 canvas、详情面板、布局控件、搜索框、视觉设置弹窗和 tooltip 样式。
- 删除 `.explicit-*`、`.mapping-*`、`.prov-*`、`.ontology-node*` 和 `.react-flow*` 相关规则。

不在本阶段做：

- 不调整 React 组件结构。
- 不重设计视觉风格。
- 不删除 parser 或 core 兼容类型。

验收标准：

- 源码中未使用的旧样式前缀从 CSS 中移除。
- 当前 TSX 使用的 class 仍有样式覆盖。
- 包内类型检查和 app 构建通过。

验证记录：

- `wc -l packages/ontology-viz/src/styles/index.css` 从 1964 行降到 540 行。
- `rg -n "explicit-|mapping-|prov-|ontology-node|react-flow" packages/ontology-viz/src/styles/index.css` 无匹配。
- `pnpm run typecheck`
- `pnpm run build`
- Vite CSS 产物从约 `31 kB` 降到 `8.86 kB`。

### 阶段 19：布局坐标快照

状态：已实现并验证。

目标：

- 保存并恢复同一本体的节点坐标快照。
- 使用 G6 `getElementPosition` 和 `translateElementTo` 读写位置，不自己实现布局算法。
- 坐标快照作为通用图谱能力暴露给宿主，standalone app 只负责按 source key 持久化。

范围：

- 新增 `OntologyLayoutSnapshot` 类型。
- `OntologyGraphCanvas` 接收 `layoutSnapshot`，并在 G6 render 后应用快照。
- `OntologyGraphCanvas` 在首次布局完成和节点拖拽结束后回调 `onLayoutSnapshotChange`。
- standalone app 将快照保存到当前本体的 view preferences。
- 切换布局模式时清空旧快照，让 G6 重新布局并生成新快照。

不在本阶段做：

- 不保存 viewport pan/zoom。
- 不实现手动“保存布局”按钮。
- 不实现后端布局存储。
- 不在 app 中直接调用 G6 图实例。

验收标准：

- 画布使用 G6 位置 API 读写坐标。
- standalone app 不直接 import `Graph` 或调用 G6 实例方法。
- 低层画布不访问 localStorage。
- 包内类型检查和 app 构建通过。

验证记录：

- `pnpm run typecheck`
- `pnpm run build`
- `rg -n "localStorage|VIEW_PREFERENCES|sourceKeyFromFile|hashContent" packages/ontology-viz/src/react packages/ontology-viz/src/components/OntologyVizApp.tsx packages/ontology-viz/src/g6` 只命中 `OntologyVizApp.tsx`。
- `rg -n "getElementPosition|translateElementTo|onLayoutSnapshotChange|layoutSnapshot|OntologyLayoutSnapshot" packages/ontology-viz/src/react packages/ontology-viz/src/components/OntologyVizApp.tsx packages/ontology-viz/src/core` 显示 G6 坐标 API 只在 `OntologyGraphCanvas`，app 只传入和保存快照。
- `rg -n "@antv/g6|Graph\\b|getElementPosition|translateElementTo" packages/ontology-viz/src/components/OntologyVizApp.tsx packages/ontology-viz/src/react/OntologyVisualSettings.tsx` 无匹配。

### 阶段 20：standalone 最近打开

状态：已实现并验证。

目标：

- standalone app 记录最近成功打开的本体，并允许用户直接再次打开。
- 列表展示本体解析后的 label，不暴露内部 storage key、内容 hash 或完整文件路径。
- 本地文件记录必须可恢复实际内容，不能只保存一个浏览器无法再次读取的文件名。
- 最近打开的存储和 UI 保留在 standalone 层，不进入 core、G6 adapter 或低层 React 画布。

范围：

- URL 来源保存可重新请求的 URL、可选 storage key、解析选项和最后打开时间。
- 本地文件的列表元数据保存在 localStorage，文件正文保存在 IndexedDB，避免大文件占满 localStorage。
- 最近记录以 source key 去重，按最后打开时间倒序排列，最多保留 8 条。
- 新增 standalone 专用的最近打开菜单，使用浏览器原生 Popover API 获得再次点击、点击空白和 Escape 自动关闭能力。
- 菜单项的 label 和打开时间保持单行；label 超出可用宽度时在尾部淡化，时间保持完整可见。
- 默认 URL、本地导入和最近打开复用同一套解析、偏好恢复和 ready-state 提交流程。
- localStorage 或 IndexedDB 不可用、容量不足时不阻断当前本体的正常加载。

不在本阶段做：

- 不请求 File System Access API 持久权限。
- 不同步到后端或跨浏览器同步。
- 不增加最近记录搜索、固定、重命名或批量管理。
- 不把最近打开组件导出到 `@ontology/viz/react`。
- 不改变 G6 图实例、布局或渲染逻辑。

验收标准：

- 成功加载默认 URL 或导入本地文件后，最近打开列表立即出现对应 label。
- 同一 source key 重复打开时只更新一条记录的 label 和时间。
- URL 记录可重新 fetch；本地文件记录可从 IndexedDB 读取正文并重新解析。
- 菜单使用 `popover` / `popoverTarget`，不手写全局 outside-click 监听。
- 列表中不显示 `file:*:*`、内容 hash 或完整路径。
- core、G6 和低层 React 组件不访问最近打开存储。
- 包内类型检查和 app 构建通过。

验证记录：

- `pnpm run typecheck`
- `pnpm run build`
- 浏览器使用 NPD 默认 URL 加载后，最近打开菜单显示解析后的 `npd-v2-ql`，重复打开仍只有 1 条记录。
- 移除默认 URL 并重启开发服务器后，空状态中的最近打开按钮仍可用；从记录重新打开后恢复到 785 个节点、776 条边的 NPD 画布。
- 独立端口的临时浏览器测试页调用 `rememberRecentFile` 写入 Turtle 正文，结果为 `saved: true`；随后 `loadRecentOntology` 返回 `kind: "file"`、正文完全一致，并由 `parseOntology` 解析出 1 个实体和 `Local test ontology` 标题。测试页验证后已删除，未进入工作区提交。
- 最近打开菜单使用 `popover="auto"` 和 `popoverTarget`；再次点击触发器可关闭菜单，未增加 document 级 outside-click 监听。
- 实际页面截图确认菜单项的 label 与相对打开时间在同一行显示，时间列不会被 label 挤压。
- `rg -n "recentOntology|RecentOntology|localStorage|indexedDB|popoverTarget|popover=" packages/ontology-viz/src/core packages/ontology-viz/src/g6 packages/ontology-viz/src/react packages/ontology-viz/src/components packages/ontology-viz/src/standalone` 显示最近存储和菜单实现只位于 standalone 文件及其 app 组合入口。

### 阶段 21：G6 渲染生命周期收敛

状态：已实现并验证。

问题与根因：

- ForceAtlas2 配置启用了 `enableWorker`，但 G6 5.1.1 在默认布局动画路径中向 layout options 注入 `onTick` 函数；函数无法通过 Web Worker 的 structured clone，实际运行每次都报 `DataCloneError` 后回退主线程。
- React StrictMode 首次挂载会执行一次 effect setup/cleanup 探测。当前 render effect 立即调用异步 `graph.render()`，创建 effect 的 cleanup 随后销毁 Graph，G6 的 `prepare()` 微任务继续访问已销毁实例，产生 `The graph instance has been destroyed` 和 `draw` 未定义错误。
- element state 和 focus effect 不等待当前数据 render 完成，会在元素尚未绘制或新一轮 render 进行中调用 G6 API。

目标：

- 消除正常挂载、StrictMode 重挂载、最近打开重载时的 G6 worker 回退和已销毁实例错误。
- 保持 G6 负责布局、绘制、状态和聚焦，React 层只协调调用时序。
- 不引入自定义布局 worker、图元素渲染器或 Graph API 替代实现。

范围：

- ForceAtlas2 明确关闭当前不兼容的 worker 路径；这与当前报错后回退主线程的实际执行路径一致。
- render effect 延迟到下一个 task 启动，使 StrictMode 的探测 cleanup 可以在 `graph.render()` 调用前取消任务。
- 用递增 render revision 区分当前 render 与已经失效的异步结果。
- 只有当前 Graph、当前 revision 完成 render 后，才应用布局快照、元素状态、聚焦和布局快照回调。
- selection/focus 更新发生在画布 ready 后时仍直接调用 G6 API；render 期间的更新由 render 完成回调读取最新 ref 后统一应用。
- Graph cleanup 使所有旧 revision 失效，并避免异步回调继续操作已销毁实例。

不在本阶段做：

- 不重新实现 Web Worker 布局协议。
- 不更换 G6 或 `@antv/layout` 版本。
- 不改变 ForceAtlas2 参数、节点尺寸、边样式或布局结果语义。
- 不处理 G6 bundle 体积告警。
- 不调整 standalone 最近打开行为。

验收标准：

- `createG6LayoutOptions("force-atlas2")` 不再启用当前不兼容的 worker。
- `setElementState` 和 `focusElement` 不会在当前 graph data render 完成前执行。
- StrictMode 初次加载和最近记录重新打开后，控制台不再出现 worker structured-clone、graph destroyed 或 `draw` 未定义错误。
- NPD 画布仍正常渲染，搜索聚焦、点击选择、一跳高亮和布局快照仍可使用。
- 包内类型检查和 app 构建通过。

验证记录：

- `pnpm run typecheck`
- `pnpm run build`
- 检查当前依赖源码确认：`@antv/layout` 在 `enableWorker` 时通过 structured clone 传递 options，而 G6 5.1.1 的动画布局路径会注入 `onTick` 函数；显式关闭该路径与原先报错后回退主线程的实际执行方式一致。
- 全新浏览器标签页执行“空状态 → 最近打开 → NPD”后，画布恢复到 785 个节点、776 条边，控制台 error/warn 为 0。
- 在同一会话中执行 D3 Force → ForceAtlas2，强制走无坐标快照的 ForceAtlas2 布局；等待布局完成后控制台 error/warn 仍为 0，不再出现 worker `DataCloneError`。
- 搜索并选择 `AppraisalWellbore` 后，G6 聚焦、选择状态、一跳高亮和浮动详情均正常；关闭详情清除选择后控制台仍无错误。
- 浏览器截图确认修复后 NPD 节点、边、标签和 minimap 均正常绘制，画布非空。
- `rg -n "enableWorker|setElementState|focusElement|renderRevision|setTimeout|graph\\.render" packages/ontology-viz/src/g6/layouts.ts packages/ontology-viz/src/react/OntologyGraphCanvas.tsx` 确认 worker 关闭、render revision 和 ready 后状态/聚焦调用均已落在 G6 adapter/画布边界内。

### 阶段 22：standalone 源码与公开出口收敛

状态：已实现并验证。

问题：

- 完整 Web App 壳仍位于通用命名的 `src/components/OntologyVizApp.tsx`，而最近打开存储和菜单已经位于 `src/standalone`，源码所有权被拆散。
- package root 仍导出 `OntologyVizApp`，仓库内实际应用也从 package root 导入；消费者容易在未明确选择 standalone 的情况下依赖文件导入、最近打开、顶栏和 localStorage 策略。
- `@ontology/viz/standalone` 当前只是跨目录转发，不是完整 app 壳的真实模块边界。

目标：

- 让完整 Web App 壳及其专用存储/UI 都归属于 standalone 源码目录。
- 让 standalone app 的使用必须显式选择 `@ontology/viz/standalone`。
- 保持 `core`、`g6`、`react` 和 package root 的可嵌入能力不依赖 standalone。

范围：

- 将 `OntologyVizApp.tsx` 移到 `src/standalone`，修正同目录及跨层 import。
- `src/standalone/index.ts` 从同目录导出 `OntologyVizApp` 及其公开类型。
- 仓库内 Web App 改从 `@ontology/viz/standalone` 导入。
- package root 删除 `OntologyVizApp` 及其类型导出，并更新入口注释，避免推荐错误的 quick start。
- 删除迁移后空置的 `src/components` 路径。

不在本阶段做：

- 不改变 `OntologyVizApp` props、加载流程、UI 或存储行为。
- 不删除 legacy `ExplicitOntology*` API；该兼容层另立阶段处理。
- 不改变 package exports map 或构建方式。
- 不拆成多个 npm package。

验收标准：

- `@ontology/viz/standalone` 仍导出 `OntologyVizApp`、`OntologyVizAppProps`、`OntologyVizSource`。
- app 源码只从 `@ontology/viz/standalone` 导入完整应用壳。
- package root 和 `@ontology/viz/react` 不导出 `OntologyVizApp`。
- `src/components/OntologyVizApp.tsx` 不再存在。
- 最近打开、默认 URL、文件导入和 G6 画布行为不变。
- 包内类型检查和 app 构建通过。

验证记录：

- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- 使用 package 本地 TypeScript 二进制执行 `packages/ontology-viz/scripts/build.mjs`，重新生成 ESM、类型声明和 CSS dist。
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 执行 `node_modules/.bin/vite build`，生产构建通过；主 app chunk 约 32.34 kB，既有 G6/vendor 大 chunk 告警不属于本阶段。
- 在 app 目录执行 `import.meta.resolve`，package root 和 `@ontology/viz/standalone` 分别解析到 `dist/index.js` 与 `dist/standalone/index.js`。
- `dist/index.js` / `dist/index.d.ts` 和 `src/index.ts` 均不再导出 `OntologyVizApp`；standalone 的源码与 dist index 仍导出 app 及两个公开类型。
- 原文件与迁移后文件的逐行 diff 只有两处同目录 import 路径变化，确认 app 壳内部运行逻辑未改动。
- `rg -n "export \\{ OntologyVizApp|export type \\{ OntologyVizAppProps|components/OntologyVizApp|from ['\\\"]@ontology/viz['\\\"]" packages/ontology-viz/src packages/ontology-viz/dist --glob '!*.map' apps/ontology-viz/src` 只命中 standalone index；仓库 app 已显式从 `@ontology/viz/standalone` 导入。
- 最后的 localhost 浏览器重载被当前浏览器安全策略拒绝，未尝试绕过；迁移前阶段 21 已完成完整运行回归，本阶段以未改运行逻辑的文件 diff、类型检查、dist 检查和生产构建作为验收证据。

### 阶段 23：移除 legacy ExplicitOntology core 兼容层

状态：已实现并验证。

问题：

- `src/core/types.ts` 只把 `ExplicitOntology*` 类型逐一改名导出，真正的数据模型仍位于 `src/lib/explicitOntologyTypes.ts`。
- `src/core/parseOntology.ts` 只转发 `parseExplicitOntology` 和四个 `getExplicitOntology*` helper，真正的 parser 仍位于 legacy `lib`。
- package root 继续公开全部 `ExplicitOntology*` 类型和函数，保留了本项目已经不需要的兼容面。
- legacy types 中的 card/visual/layout 配置属于已删除的卡片式 viewer，没有任何当前源码消费者，并且与现行 G6 adapter options 不一致。

目标：

- 让 `@ontology/viz/core` 直接拥有通用本体数据模型和解析实现。
- 删除无调用方的 legacy API 与旧视觉配置 schema，避免两套命名和两套配置概念继续并存。
- 保持 OWL/RDF/XML/Turtle 的显式类型解析规则和输出结构不变，不增加类型推断。

范围：

- 将通用实体、边、字段、值、图数据、解析选项和布局快照类型直接定义在 `core/types.ts`。
- 将 parser 与字段 helper 实现迁入 `core/parseOntology.ts`，统一使用 `Ontology*` 命名。
- 删除 `src/lib/explicitOntologyTypes.ts`、`src/lib/explicitOntologyParser.ts` 及迁移后空置的 `src/lib` 路径。
- package root 删除 legacy `ExplicitOntology*` 类型和函数导出，只保留现代 core/G6/React 聚合出口。
- 删除无调用方的 `OntologyCardConfig`、`OntologyColorMode`、`OntologyEdgeConfig`、`OntologyLayoutMode`、`OntologyVisualConfig`。

不在本阶段做：

- 不改变 entity/edge kind、字段内容、edge 构造或 label/description 选择顺序。
- 不增加 OWL 推理、blank node 展开或 parser 格式。
- 不修改 G6 adapter、React 组件或 standalone UI。
- 不提供 legacy deprecated alias；当前版本尚未正式发布，优先保持 API 简洁。

验收标准：

- `packages/ontology-viz/src` 和生成的 `dist` 不再包含 `ExplicitOntology`、`parseExplicitOntology`、`explicitOntology*`。
- `@ontology/viz/core` 继续导出当前实际使用的 `Ontology*` 数据类型、layout snapshot、parser 和字段 helper。
- 同一 Turtle 输入在重构前后得到完全相同的序列化图数据。
- NPD app 类型检查和生产构建通过。
- package root、core、G6、React 和 standalone subpath 均仍能生成类型声明。

验证记录：

- 重构前将覆盖 Class、ObjectProperty、DatatypeProperty、AnnotationProperty、subClassOf、subPropertyOf、domain/range、label/comment 的 Turtle fixture 完整图数据序列化并计算 SHA-256，得到 `38359ea6f38087c98e04d08588015552cd62ecd43841d5b5a9c9cc5012127a98`。
- 迁移后使用同一 fixture 调用 `parseOntology`，SHA-256 仍为 `38359ea6f38087c98e04d08588015552cd62ecd43841d5b5a9c9cc5012127a98`；两次结果均为 6 个实体、9 条边、6 个字段，四类实体统计完全一致。临时测试入口验证后已删除。
- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- 使用 package 本地 TypeScript 二进制执行 `packages/ontology-viz/scripts/build.mjs`，dist 重建成功。
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 执行 `node_modules/.bin/vite build`，1388 个模块转换和生产构建成功；既有 G6/vendor chunk 体积告警不属于本阶段。
- `rg -n "ExplicitOntology|explicitOntology|parseExplicit|getExplicit|OntologyCardConfig|OntologyVisualConfig|OntologyLayoutMode" packages/ontology-viz/src apps/ontology-viz/src` 无匹配。
- 对生成的 `packages/ontology-viz/dist` 执行同样的 legacy API 检索无匹配；`dist/lib` 不再存在，`dist/core/parseOntology.js`、`dist/core/types.d.ts` 及各 subpath 类型声明仍存在。

### 阶段 24：npm package pack-ready

状态：已实现并验证。

问题：

- `@ontology/viz` 已能生成 dist 和 subpath exports，但 manifest 仍为 `private: true`，无法作为 npm 包发布。
- package README 只有仓库内构建命令，没有面向使用者的安装入口。
- CSS export 没有显式声明 side effect，激进 tree-shaking 配置可能错误删除样式导入。

目标：

- 让当前 package 可以被内部或外部 npm registry 正常接收，并能由前端消费者按 subpath 安装使用。
- 保持 registry、访问级别和许可证由发布环境决定，不在仓库中假设组织策略。
- 用本地 `npm pack` 检查实际 tarball 文件白名单，不执行 publish。

范围：

- 将 package manifest 设置为 `private: false`，补充简短 description。
- 将 `dist/styles.css` 标记为 package side effect。
- README 增加 pnpm/npm 安装命令，并明确 core、g6、react、standalone、styles 五个消费入口。
- 构建后执行 `npm pack --dry-run --json`，检查 tarball 只包含 manifest、README 和 dist 白名单内容。

不在本阶段做：

- 不执行 `npm publish`，不访问 registry。
- 不设置 `publishConfig.registry` 或 `publishConfig.access`。
- 不添加未经项目所有者确认的 license、repository 或 organization metadata。
- 不 bundle G6、N3 或 React，不改变 dependencies/peerDependencies 关系。
- 不改变任何运行时代码或 app UI。

验收标准：

- manifest 不再阻止发布，且 CSS 不会被 tree-shaking 当作无副作用模块。
- README 用户可直接看到 pnpm/npm 安装方式和各 subpath 用途。
- package、app 类型检查和生产构建通过。
- dry-run tarball 不包含 `src`、`scripts`、测试数据、apps、design 文档或 workspace 文件。
- tarball 中存在 package root、core、g6、react、standalone 类型/JS 入口与 `styles.css`。

验证记录：

- manifest 已设置 `private: false` 和 description，并用 `sideEffects: ["./dist/styles.css"]` 保留样式入口；未增加 registry、access 或 license 假设。
- README 已增加 pnpm/npm 安装命令、React peer 版本提示和五个 package entry point 的用途表。
- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- 使用 package 本地 TypeScript 二进制执行 `packages/ontology-viz/scripts/build.mjs`，dist 重建成功。
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 执行 `node_modules/.bin/vite build`，1388 个模块转换和生产构建成功；既有 G6/vendor chunk 体积告警不属于本阶段。
- 首次 `npm pack --dry-run --json` 因本机 `~/.npm` 中历史 root 所有权缓存文件返回 EPERM；没有使用 sudo 或修改用户目录，改用隔离临时 cache 后完成同一 dry-run。
- `npm pack --dry-run --json --cache /tmp/ontology-viz-npm-cache` 成功：tarball 约 38.2 KB，解包约 178.4 KB，共 79 个文件。
- dry-run 文件清单只包含 `package.json`、`README.md` 和 `dist/**`；root/core/g6/react/standalone 的 JS 与 `.d.ts`、`dist/styles.css` 均存在，未包含 src、scripts、apps、设计文档、测试文件或数据集。

### 阶段 25：Web App 内置 NPD 默认本体

状态：已实现并验证。

问题：

- `OntologyVizApp` 已支持 `defaultSource`，但仓库 app 仅在设置 `VITE_ONTOLOGY_SOURCE_URL` 时传入；默认启动只显示文件导入空状态。
- 这不满足独立 Web App 的“默认本体加载”职责，也不满足当前以 NPD 作为默认测试对象的产品要求。
- NPD 下载目录被 `.gitignore` 排除，新环境克隆仓库后不能依赖 `datasets/` 中的本地文件。

目标：

- 静态 Web App 构建产物自带 NPD 本体，首次打开即可进入真实图谱。
- NPD 只属于 standalone app 的默认内容，不进入 npm package，也不向 core/G6/react 引入数据集规则。
- 保留部署时通过环境变量替换默认本体的能力。

范围：

- 将 `npd-v2-ql.owl` 作为 app public asset 纳入版本控制和 Vite 静态构建。
- 将 NPD benchmark 的 Apache-2.0 许可证副本随 app public asset 分发。
- 对上游 OWL 文件设置精确路径的 Git whitespace 例外，保留原始字节与校验和；其他项目文件仍使用默认 whitespace 检查。
- app 未配置 `VITE_ONTOLOGY_SOURCE_URL` 时使用 `import.meta.env.BASE_URL` 下的 bundled NPD；配置后仍优先使用环境 URL。
- bundled NPD 使用稳定 storage key，使同一本体在不同部署路径下共享同一份视图偏好语义。
- 更新 app README，说明默认 NPD 和环境覆盖方式。

不在本阶段做：

- 不把 NPD 文件放入 `@ontology/viz` npm tarball。
- 不在 parser、G6 adapter 或 React 组件中加入 NPD 专用逻辑。
- 不修改 NPD 本体内容或许可证文本。
- 不下载其他 NPD benchmark 数据到 app 构建。

验收标准：

- app 无环境变量时 `defaultSource` 指向 bundled `npd-v2-ql.owl`，有环境变量时使用配置 URL。
- `vite build` 产物包含 NPD OWL 与许可证，OWL 文件 SHA-256 与已下载原件一致。
- app/package 类型检查和生产构建通过。
- npm dry-run tarball 仍不包含 NPD、datasets 或 app public 资产。
- package/core/G6/react 源码中不出现 NPD 数据集分支或字段规则。

验证记录：

- 原始 `datasets/npd-benchmark/ontology/npd-v2-ql.owl` 与 `apps/ontology-viz/public/npd-v2-ql.owl` 的 SHA-256 均为 `0436de7c28f8fb8a0392dbe808d63d6f1be4dc6da9ee1500ecf0f1952e6e783a`。
- 原始 NPD benchmark `LICENSE` 与 `apps/ontology-viz/public/NPD-LICENSE.txt` 的 SHA-256 均为 `6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a`，确认许可证文本未修改。
- app 默认 source 使用 `${import.meta.env.BASE_URL}npd-v2-ql.owl` 和稳定 key `bundled:npd-v2-ql`；设置 `VITE_ONTOLOGY_SOURCE_URL` 时仍优先使用环境 URL。
- `packages/ontology-viz/node_modules/.bin/tsc --noEmit -p packages/ontology-viz/tsconfig.json`
- `apps/ontology-viz/node_modules/.bin/tsc -b apps/ontology-viz/tsconfig.json`
- 在 `apps/ontology-viz` 执行 `node_modules/.bin/vite build`，1388 个模块转换和生产构建成功；既有 G6/vendor chunk 告警不属于本阶段。
- build 后 `dist/npd-v2-ql.owl` 与 public 原件 SHA-256 一致，`dist/NPD-LICENSE.txt` 与 public 许可证 SHA-256 一致；静态 app dist 总大小约 3.8 MB。
- 编译后的 app 入口包含 `url: "./npd-v2-ql.owl"` 和 `storageKey: "bundled:npd-v2-ql"`。
- 使用隔离 cache 再次执行 npm dry-run 并解析清单，结果为 `entryCount: 79`、`size: 38216`、`hasNpd: false`、`unexpected: []`，确认 npm 包不携带 app NPD 资产。
- `rg -n "npd|NPD" packages/ontology-viz/src packages/ontology-viz/package.json packages/ontology-viz/README.md` 无匹配，组件包仍保持数据集无关。

### 阶段 26：忽略 workspace pnpm store

状态：已实现并验证。

问题：

- 当前 `.gitignore` 忽略 `node_modules/`，但 pnpm 在受限环境运行时可能在仓库根生成 `.pnpm-store/`。
- 该目录是可再生依赖缓存，不属于源码；此前验证中已多次造成额外未跟踪文件并需要手动清理。

范围：

- 在 dependencies ignore 规则中增加根及子目录适用的 `.pnpm-store/`。
- 不修改 pnpm store 配置，不删除用户已有的全局缓存。

验收标准：

- `git check-ignore -v .pnpm-store/test` 命中仓库 `.gitignore`。
- 当前工作区除用户已有 `docs/g6-research/` 外无未跟踪构建或依赖缓存。

验证记录：

- `git check-ignore -v .pnpm-store/test` 返回 `.gitignore:6:.pnpm-store/`。
- `git diff --check` 通过。
- `git status --short` 只显示本阶段两个待提交文件和用户已有 `docs/g6-research/`，没有 `.pnpm-store/`、dist、node_modules 或临时测试文件。

### 阶段 27：G6-first 重写完成性审计

状态：已实现并验证。

审计结论：

- **Spec 驱动**：阶段 1 至 26 均先记录目标、范围、不做事项与验收标准，再实现并回写验证；最终检索没有“设计完成，待实现”、TODO 或 FIXME。
- **独立提交**：审计前设计文档有 26 个“已实现并验证”阶段，分支相对 main 恰好有 26 个提交；每个 core、G6、React、standalone、构建或清理功能独立提交。
- **G6-first**：源码不再包含 React Flow、旧 D3 Force/Dagre 依赖或自研 edge handle/path；G6 Graph runtime 和位置/状态/聚焦 API 只由低层 `OntologyGraphCanvas` 调用，G6 adapter 层只提供数据、布局和插件配置。
- **通用边界**：core、G6、React 与 npm package 中没有 NPD、3GPP 或其他数据集字段规则；NPD 仅作为独立 Web App 的 public 默认资产。
- **宿主可控**：低层画布、搜索、详情、设置和布局控件不访问 localStorage/IndexedDB；文件导入、最近打开和本地偏好只位于 standalone。
- **交付形态**：静态 Web App 默认加载 bundled NPD；npm package 提供 root/core/g6/react/standalone/styles 六个 exports，`private: false`，tarball 白名单有效。

最终验证：

- 使用 package 本地 TypeScript 二进制重建 `packages/ontology-viz/dist` 成功。
- package 源码类型检查与 app TypeScript build 均通过。
- Vite 生产构建通过，转换 1388 个模块；主 app chunk 约 32.29 kB。G6/vendor chunk 超过 500 kB 的警告仍存在，但已经独立分块，不影响功能或发布。
- NPD public 与 app dist OWL SHA-256 均为 `0436de7c28f8fb8a0392dbe808d63d6f1be4dc6da9ee1500ecf0f1952e6e783a`；许可证 public/dist 校验和一致。
- 六个 package exports 全部解析到 `dist`，对应 JS、`.d.ts` 与 CSS 文件均存在。
- npm dry-run：79 个文件、约 38.2 KB，required entry 缺失为 0，unexpected 文件为 0，dataset/app 资产为 0。
- 旧图谱库、legacy API、旧样式前缀、package 数据集耦合和低层存储访问检索均无匹配。
- 阶段 21 曾在浏览器完整验证 StrictMode、最近打开、D3 Force/ForceAtlas2、搜索、聚焦、一跳高亮和详情，控制台 error/warn 为 0；之后浏览器策略禁止继续访问该 localhost，后续阶段使用等价哈希、类型、dist、tarball 和生产构建证据，没有尝试绕过策略。
- 最终 tracked worktree 无未提交改动；仅保留任务开始前已有且未触碰的 `docs/g6-research/` 未跟踪目录。

### 阶段 28：G6 大图性能收敛

状态：已实现；生产构建通过，末次局部高亮优化待浏览器策略允许后复测。

问题定位：

- NPD 首屏同时承担本体解析、785 节点/776 边布局、标签、箭头、Tooltip、Minimap 和 React 状态同步；G6 5000 节点示例的渲染负载不包含这些完整产品功能，不能只按节点数量直接比较。
- 旧实现对布局结果先 `render`，再逐节点读取、回写和位移；设置变化也可能重新触发布局，抵消了 G6 的增量数据和原生渲染能力。
- standalone 默认 Minimap 使用了覆写插件私有生命周期方法的补丁，仍会在销毁竞态中访问已释放的 graph，产生 `getData` 异常并增加一个额外画布。
- `click-select.unselectedState` 会在每次选择和清除时更新全部 1561 个元素；这是一跳高亮交互中最明显的剩余卡顿来源。
- G6 5.1.1 的 ForceAtlas2 `preventOverlap` 在 NPD 多连通分量上无法可靠收敛；单独运行 300 次仍有 1624 对节点小于 43.9 px，不能机械地用单阶段配置替代防碰撞处理。

实现：

- 画布保留 G6 原生 `drag-canvas`、`zoom-canvas`、`drag-element`、`click-select` 和 `optimize-viewport-transform`；平移缩放期间只保留节点 key shape。
- React 不再为原生点击重复写整图状态。搜索、关闭详情等受控操作通过 G6 `getElementDataByState` 和 `setElementState` 只更新旧、新一跳集合。
- 取消 `unselectedState` 全图变淡，只保留 `selected`/`related` 一跳强化；适配器显式输出空 `states`，避免 `setData` 合并并保留过期状态。
- 布局快照直接写入节点 style；首次使用快照调用 G6 `render()`，后续设置更新调用 `draw()`，不再逐节点 `translateElementTo`。
- standalone 默认插件只启用 G6 Tooltip。Minimap 工厂仍作为可选 API 保留，但不再覆写私有方法，也不默认创建额外画布。
- bundled NPD 增加 app-only ForceAtlas2 布局文件；包层只增加通用的可选 `initialLayout` source 配置，没有 NPD 分支。
- D3 Force、Dagre 关闭布局动画。ForceAtlas2 使用 G6 支持的布局流水线：ForceAtlas2 生成拓扑结构，再由 D3 Force 的 collide 阶段消除重叠；没有自研布局或坐标后处理算法。

验证记录：

- 浏览器中默认 NPD 可交互时间实测约 398-445 ms；画布数由 5 个降为 4 个，控制台不再出现 Minimap `getData` 错误。
- 浏览器确认 D3 Force 与 ForceAtlas2 产生明显不同结果；ForceAtlas2 按钮事件约 296 ms 返回，约 2 s 后标签和边恢复完整显示。
- 浏览器确认节点原生点击可切换到相邻节点、显示一跳高亮并打开详情；设置开关不会重新运行布局。
- 末次取消全图 `dimmed` 后，浏览器策略拒绝继续访问本地地址；未绕过限制，因此该局部交互优化仍需下一次允许访问时做视觉复测。
- package 源码类型检查和 dist 构建通过；app TypeScript build 和 Vite 生产构建通过，转换 1388 个模块。
- 预计算布局包含 785 个有限坐标，最小节点中心距离约 43.999 px；public 与生产 dist 文件均为 83,492 bytes。
- `rg` 确认 package 源码和 dist 中没有 NPD、私有 Minimap 补丁或 `renderMinimap` 残留；`git diff --check` 通过。

### 阶段 29：按节点度数映射尺寸

状态：已实现并完成静态验证。

实现：

- 使用 G6 内置 `map-node-size` Transform，不在组件中重复实现度数统计和尺寸写回；仅为 G6 5.1.1 的等度数 `log` 除零边界增加保护。
- 默认按总度数 `degree + direction: both`，以 `log` 比例映射到 `24-44px`；标签字号保持固定。
- `OntologyGraphCanvas` 默认启用该 Transform，并公开 `transforms` 属性；宿主可传空数组关闭，也可使用 `createG6DegreeNodeSizeTransform` 切换 `in`、`out`、尺寸范围或比例函数。
- D3 Force 和 ForceAtlas2 的碰撞阶段改用 G6 `preventOverlap`、`nodeSpacing`、`collideStrength` 和 `collideIterations`，让布局控制器从实际节点元素读取动态尺寸，不再使用固定半径。
- 低层本体模型和 G6 adapter 不写入度数统计字段，保持输入本体与中间模型无派生业务字段。

验证记录：

- 当前 G6 5.1.1 源码与官方文档均确认 `map-node-size` 支持 `degree`，且方向可选 `in`、`out`、`both`。
- NPD 度数分布为：785 节点、776 边、194 个孤立节点，中位数 1、P95 6、最大值 100；因此显式使用 `log`，避免少数枢纽压缩其余节点的视觉差异。
- 按默认 `24-44px` 映射检查现有 NPD 预计算布局：节点重叠数为 0，最小节点边界间距约 4.44px。
- 直接实例化 G6 `MapNodeSize` 验证：度数 `0/1/2` 分别得到 `24/36.62/44px`；所有节点同度数时稳定返回 `24px`，没有 `NaN`。
- package 源码类型检查、dist 构建、app TypeScript build 和 Vite 生产构建通过；生产构建转换 1389 个模块。

### 阶段 30：G6 原生探索交互与信息层级

状态：已实现并完成静态验证；受既有浏览器策略限制，待本地地址重新允许后补视觉复测。

实现：

- 使用 G6 内置 `fix-element-size` Behavior，在画布缩放超过 100% 后固定节点与标签的屏幕尺寸；放大时主要变化转移到节点间距和边长，低倍率总览仍可自然缩小。
- 使用 G6 内置 Toolbar 和 Fullscreen 插件提供放大、缩小、适应画布、导出 PNG 与全屏；没有增加自研画布控制层。
- 提供 `createG6FisheyePlugin()` 作为显式可选能力，使用 click trigger、160px 半径和轻量镜头样式。standalone 不默认加载，避免鱼眼对全体节点的几何更新影响常规点击选择和密集图性能。
- 未恢复 `unselectedState` 或全图 `dimmed`。节点和边的基础透明度统一降低，选中节点、一跳节点和对应边只更新局部状态并恢复完整不透明度；hover 仅激活当前元素。
- 节点继续使用 G6 Circle，按本体类型着色并增加白色描边、克制标签和统一 hover/selected 状态；没有阴影、渐变、额外 shape 或自定义绘制循环。
- Tooltip 增加 compact IRI、namespace、description 和关系端点信息；详情面板增加完整属性列表、IRI 属性、一跳入/出/自环关系和可点击端点导航。
- D3 Force 的理想边长由 120 提高到 180，增加碰撞间距与弱 `x/y` 回拉，避免孤立节点在斥力下无限撑大视图。
- ForceAtlas2 使用有效的官方参数 `mode`，而不是会被忽略的 `linLog`；参数扫描后采用 `normal`、`kr=44`、`kg=0.9`，再使用 G6 D3 collide 阶段处理动态节点尺寸。
- bundled NPD 的布局偏好 key 更新为 `v4`，默认 ForceAtlas2 快照按新参数和 `24-44px` 动态尺寸重新生成。

性能取舍：

- G6 `click-select.unselectedState` 会为 NPD 一次更新约 1561 个元素，既有浏览器实测已确认它是选择交互的主要卡顿来源，因此本阶段不以“点击后再给全图变灰”换取视觉效果。
- 当前方案的低透明基础样式不产生选择时的全图写入；一跳高亮只更新旧、新关联集合。
- Fisheye 的实现会在镜头移动时遍历节点并更新相关边，适合用户主动开启的局部探索，不适合作为 700+ 节点画布的常驻 pointermove 行为。

验证记录：

- 对 785 节点、776 边的 NPD 数据扫描 ForceAtlas2 参数；`linlog` 即使在 `kr=5` 时中位边长仍约 639px，过度放大社区间距离，最终选择 `normal` 模式。
- 新默认快照包含 785 个有限坐标；按 `24-44px` 动态节点尺寸检查，节点重叠对为 0，最小边界净距为 12px，中位边长约 134px，P90 约 368px，整体边界约 `2208 x 2204`。
- D3 Force 新参数离线检查中位边长约 233px，P90 约 318px，无节点重叠，整体边界约 `3103 x 3153`；弱轴向回拉将无约束版本约 8764px 的边界显著收敛。
- package 源码类型检查、dist TypeScript 构建、app TypeScript build 均通过。
- Vite 生产构建通过，转换 1389 个模块；既有 G6/vendor 大 chunk 告警仍存在，没有新增运行时依赖。
- `git diff --check` 通过。既有浏览器策略继续禁止访问本地地址，本阶段未绕过，因此 Toolbar、固定尺寸和详情视觉仍需策略允许后补交互复测。
