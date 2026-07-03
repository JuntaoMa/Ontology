import { useMemo, useState, type ReactNode } from "react";
import {
  OntologyMappingGraph,
  type MappingGraphData,
  type MappingGraphEdge,
  type MappingGraphLayoutMode,
  type MappingGraphNode,
  type MappingGraphObjectNode,
  type MappingGraphRelationNode,
  type MappingGraphSourceTableNode,
} from "@ontology/viz";
import npdMappingGraphJson from "./generatedMappingGraph.json";

const npdMappingGraph = npdMappingGraphJson as MappingGraphData;

type Selection =
  | { type: "node"; item: MappingGraphNode }
  | { type: "edge"; item: MappingGraphEdge }
  | null;

const NODE_KIND_LABELS = {
  ontologyObject: "本体对象",
  ontologyRelation: "本体关系",
  sourceTable: "源表",
};

export function NpdMappingExplorer() {
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [layoutMode, setLayoutMode] = useState<MappingGraphLayoutMode>("dagre");

  const selection = useMemo<Selection>(() => {
    const node = npdMappingGraph.nodes.find((item) => item.id === selectedId);
    if (node) return { type: "node", item: node };
    const edge = npdMappingGraph.edges.find((item) => item.id === selectedId);
    if (edge) return { type: "edge", item: edge };
    return null;
  }, [selectedId]);

  return (
    <div className="npd-graph-page">
      <div className="npd-graph-toolbar">
        <div className="npd-graph-stats" aria-label="NPD 映射图谱统计">
          <Stat value={npdMappingGraph.stats.ontologyObjectCount} label="本体对象" />
          <Stat value={npdMappingGraph.stats.ontologyRelationCount} label="关系" />
          <Stat value={npdMappingGraph.stats.sourceTableCount} label="源表" />
          <Stat value={npdMappingGraph.stats.dataPropertyMappingCount} label="属性映射" />
          <Stat value={npdMappingGraph.stats.mappingCount} label="OBDA 映射" />
        </div>

        <div className="npd-graph-controls">
          <label className="npd-graph-search">
            <span>搜索</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="对象、关系、表、列、中英文名称"
            />
          </label>

          <div className="npd-graph-layout" aria-label="布局切换">
            <button
              className={layoutMode === "dagre" ? "is-active" : ""}
              onClick={() => setLayoutMode("dagre")}
            >
              层次布局
            </button>
            <button
              className={layoutMode === "force" ? "is-active" : ""}
              onClick={() => setLayoutMode("force")}
            >
              力导向
            </button>
          </div>
        </div>

        <div className="npd-graph-legend" aria-label="图例">
          <span><i className="npd-legend-dot npd-legend-dot--object" />对象</span>
          <span><i className="npd-legend-dot npd-legend-dot--relation" />关系</span>
          <span><i className="npd-legend-dot npd-legend-dot--table" />源表</span>
        </div>
      </div>

      <div className="npd-graph-stage">
        <OntologyMappingGraph
          data={npdMappingGraph}
          selectedId={selectedId}
          search={search}
          layoutMode={layoutMode}
          onSelect={setSelectedId}
          onClearSelection={() => setSelectedId("")}
        />
      </div>

      {selection && (
        <NpdMappingPanel
          selection={selection}
          data={npdMappingGraph}
          onClose={() => setSelectedId("")}
        />
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="npd-graph-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function NpdMappingPanel({
  selection,
  data,
  onClose,
}: {
  selection: Selection;
  data: MappingGraphData;
  onClose: () => void;
}) {
  if (!selection) return null;

  return (
    <aside className="npd-graph-panel" aria-label="映射详情">
      <button className="npd-graph-panel__close" onClick={onClose} aria-label="关闭详情">
        ×
      </button>
      {selection.type === "node" ? (
        <NodePanel node={selection.item} data={data} />
      ) : (
        <EdgePanel edge={selection.item} data={data} />
      )}
    </aside>
  );
}

function PanelHeader({
  type,
  zh,
  en,
}: {
  type: string;
  zh: string;
  en: string;
}) {
  return (
    <header className="npd-graph-panel__header">
      <span>{type}</span>
      <h2>{zh}</h2>
      <p>{en}</p>
    </header>
  );
}

function NodePanel({ node, data }: { node: MappingGraphNode; data: MappingGraphData }) {
  if (node.kind === "ontologyObject") {
    return <ObjectNodePanel node={node} data={data} />;
  }
  if (node.kind === "ontologyRelation") {
    return <RelationNodePanel node={node} data={data} />;
  }
  return <SourceTableNodePanel node={node} />;
}

function ObjectNodePanel({ node, data }: { node: MappingGraphObjectNode; data: MappingGraphData }) {
  const relations = (node.relations ?? [])
    .map((id) => data.nodes.find((item) => item.id === id))
    .filter((item): item is MappingGraphRelationNode => item?.kind === "ontologyRelation");

  return (
    <>
      <PanelHeader type={NODE_KIND_LABELS[node.kind]} zh={node.label.zh} en={node.label.en} />
      <PanelSection title="来源表">
        <ChipList items={node.sourceTables} />
      </PanelSection>

      <details className="npd-graph-details" open>
        <summary>属性映射 ({node.properties.length})</summary>
        <div className="npd-property-list">
          {node.properties.slice(0, 80).map((property) => (
            <div className="npd-property" key={property.mappingId}>
              <strong>{property.label.zh}</strong>
              <span>{property.label.en}</span>
              <small>{property.sourceColumns.slice(0, 4).join(" · ")}</small>
            </div>
          ))}
        </div>
      </details>

      <details className="npd-graph-details">
        <summary>关系 ({relations.length})</summary>
        <div className="npd-property-list">
          {relations.map((relation) => (
            <div className="npd-property" key={relation.id}>
              <strong>{relation.label.zh}</strong>
              <span>{relation.sourceObjectName} → {relation.targetObjectName}</span>
              <small>{relation.sourceTables.join(" · ")}</small>
            </div>
          ))}
        </div>
      </details>

      <details className="npd-graph-details">
        <summary>URI 模板 ({node.uriTemplates.length})</summary>
        <CodeList items={node.uriTemplates} />
      </details>

      <details className="npd-graph-details">
        <summary>对象类型映射 ({node.classMappings.length})</summary>
        <MappingList items={node.classMappings} />
      </details>
    </>
  );
}

function RelationNodePanel({ node, data }: { node: MappingGraphRelationNode; data: MappingGraphData }) {
  const source = data.nodes.find((item) => item.id === node.sourceObjectId);
  const target = data.nodes.find((item) => item.id === node.targetObjectId);

  return (
    <>
      <PanelHeader type={NODE_KIND_LABELS[node.kind]} zh={node.label.zh} en={node.label.en} />
      <PanelSection title="对象关系">
        <div className="npd-relation-flow">
          <span>{source?.label.zh ?? node.sourceObjectName}</span>
          <strong>{node.label.zh}</strong>
          <span>{target?.label.zh ?? node.targetObjectName}</span>
        </div>
      </PanelSection>
      <PanelSection title="来源表">
        <ChipList items={node.sourceTables} />
      </PanelSection>
      <PanelSection title="来源列">
        <ChipList items={node.sourceColumns.slice(0, 80)} dense />
      </PanelSection>
      <details className="npd-graph-details" open>
        <summary>关系映射 ({node.mappings.length})</summary>
        <MappingList items={node.mappings} />
      </details>
    </>
  );
}

function SourceTableNodePanel({ node }: { node: MappingGraphSourceTableNode }) {
  return (
    <>
      <PanelHeader type={NODE_KIND_LABELS[node.kind]} zh={node.label.zh} en={node.label.en} />
      <PanelSection title="源列">
        <ChipList items={node.sourceColumns.slice(0, 120)} dense />
      </PanelSection>
      <PanelSection title="映射数量">
        <p className="npd-panel-text">{node.mappingIds.length} 条 OBDA 映射使用该表。</p>
      </PanelSection>
    </>
  );
}

function EdgePanel({ edge, data }: { edge: MappingGraphEdge; data: MappingGraphData }) {
  const source = data.nodes.find((node) => node.id === edge.source);
  const target = data.nodes.find((node) => node.id === edge.target);

  return (
    <>
      <PanelHeader
        type="映射边"
        zh={edge.label.zh}
        en={edge.label.en}
      />
      <PanelSection title="连接">
        <div className="npd-relation-flow">
          <span>{source?.label.zh ?? edge.source}</span>
          <strong>→</strong>
          <span>{target?.label.zh ?? edge.target}</span>
        </div>
      </PanelSection>
      <PanelSection title="来源列">
        <ChipList items={edge.sourceColumns.slice(0, 120)} dense />
      </PanelSection>
      <PanelSection title="目标对象.属性">
        <ChipList items={edge.targetProperties.slice(0, 120)} dense />
      </PanelSection>
      <details className="npd-graph-details" open>
        <summary>映射证据 ({edge.mappings.length})</summary>
        <MappingList items={edge.mappings} />
      </details>
    </>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="npd-graph-panel__section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function ChipList({ items, dense = false }: { items: string[]; dense?: boolean }) {
  if (items.length === 0) return <p className="npd-panel-text">无</p>;
  return (
    <div className={`npd-graph-chips ${dense ? "npd-graph-chips--dense" : ""}`}>
      {items.map((item) => <span key={item}>{item}</span>)}
    </div>
  );
}

function CodeList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="npd-panel-text">无</p>;
  return (
    <div className="npd-code-list">
      {items.map((item) => <code key={item}>{item}</code>)}
    </div>
  );
}

function MappingList({
  items,
}: {
  items: Array<{
    mappingId: string;
    sourceTables?: string[];
    sourceColumns: string[];
    targetColumns?: string[];
    targetProperty?: string;
    targetLabel?: { zh: string; en: string };
    abstraction: string;
    condition?: string;
  }>;
}) {
  if (items.length === 0) return <p className="npd-panel-text">无</p>;

  return (
    <div className="npd-mapping-evidence">
      {items.slice(0, 80).map((item) => (
        <article key={item.mappingId}>
          <strong>{item.targetLabel?.zh ?? item.targetProperty ?? item.mappingId}</strong>
          {item.targetLabel && <span>{item.targetLabel.en}</span>}
          <small>{item.sourceColumns.slice(0, 5).join(" · ")}</small>
          <em>{item.abstraction}</em>
          {item.condition && <code>{item.condition}</code>}
        </article>
      ))}
    </div>
  );
}
