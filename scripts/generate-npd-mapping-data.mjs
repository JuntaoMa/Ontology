import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const mappingPath = path.join(
  repoRoot,
  "datasets/npd-benchmark/mappings/postgres/npd-v2-ql.obda",
);
const outputPath = path.join(
  repoRoot,
  "3GPP_Ontology/viz/src/npd/generatedMappingData.ts",
);
const graphOutputPath = path.join(
  repoRoot,
  "3GPP_Ontology/viz/src/npd/generatedMappingGraph.json",
);

if (!fs.existsSync(mappingPath)) {
  throw new Error(`NPD mapping file not found: ${mappingPath}`);
}

const text = fs.readFileSync(mappingPath, "utf8");
const section = text.match(/\[MappingDeclaration\]\s+@collection\s+\[\[([\s\S]*)\]\]/);
if (!section) {
  throw new Error("Could not find OBDA MappingDeclaration collection.");
}

function localName(term) {
  const cleaned = term.replace(/[.]\s*$/, "");
  const hash = cleaned.lastIndexOf("#");
  if (hash >= 0) return cleaned.slice(hash + 1);
  const colon = cleaned.lastIndexOf(":");
  if (colon >= 0) return cleaned.slice(colon + 1);
  const slash = cleaned.lastIndexOf("/");
  if (slash >= 0) return cleaned.slice(slash + 1);
  return cleaned;
}

function extractTables(source) {
  const tables = new Set();
  for (const match of source.matchAll(/\b(?:FROM|JOIN)\s+"([^"]+)"/gi)) {
    tables.add(match[1]);
  }

  const fromMatch = source.match(/\bFROM\s+(.+?)(?:\s+WHERE|\s+INNER\s+JOIN|\s+LEFT\s+JOIN|\s+RIGHT\s+JOIN|\s+FULL\s+JOIN|$)/i);
  if (fromMatch) {
    for (const rawPart of fromMatch[1].split(",")) {
      const part = rawPart.trim();
      const quoted = part.match(/^"([^"]+)"/);
      const bare = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (quoted) tables.add(quoted[1]);
      else if (bare && !["SELECT", "WHERE"].includes(bare[1].toUpperCase())) tables.add(bare[1]);
    }
  }

  return [...tables].sort();
}

function extractColumns(source, tables) {
  const columns = new Set();
  for (const match of source.matchAll(/"([^"]+)"\."([^"]+)"/g)) {
    columns.add(`${match[1]}.${match[2]}`);
  }

  const quoted = [...source.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const tableSet = new Set(tables);
  const hasQualified = columns.size > 0;
  for (const item of quoted) {
    if (tableSet.has(item)) continue;
    if (hasQualified) {
      columns.add(item);
    } else if (tables.length === 1) {
      columns.add(`${tables[0]}.${item}`);
    } else {
      columns.add(item);
    }
  }

  return [...columns].sort();
}

function extractCondition(source) {
  const where = source.match(/\bWHERE\s+(.+)$/i);
  return where ? where[1].trim() : undefined;
}

function parseTarget(target) {
  const classMatch = target.match(/\s+a\s+([A-Za-z0-9_]+):([A-Za-z0-9_]+)/);
  const tokens = target.trim().replace(/[.]\s*$/, "").trim().split(/\s+/);
  const subject = tokens[0] ?? "";
  const predicate = classMatch ? "rdf:type" : (tokens[1] ?? "");
  const object = classMatch ? `${classMatch[1]}:${classMatch[2]}` : tokens.slice(2).join(" ");

  if (classMatch) {
    return {
      subject,
      predicate,
      object,
      entityPrefix: classMatch[1],
      entityName: classMatch[2],
      kind: "class",
    };
  }

  const predicateName = localName(predicate);
  const isResourceObject = /^npd:/.test(object.trim()) || /^<https?:/.test(object.trim());
  const isLiteral = !isResourceObject ||
    /\{[^}]+\}\^\^|^"[^"]*"|\s"[^"]*"/.test(object) ||
    object.includes("xsd:");

  return {
    subject,
    predicate,
    object,
    entityPrefix: predicate.includes(":") ? predicate.split(":")[0] : "",
    entityName: predicateName,
    kind: isLiteral ? "dataProperty" : "objectProperty",
  };
}

function classifyAbstraction(kind, mappingId, entityName, target, source, condition) {
  if (mappingId.includes("Table:Subs")) return "枚举值提升为子类";
  if (mappingId.includes("ForeignKey") || /\bJOIN\b/i.test(source)) return "外键或 Join 推导关系";
  if (condition && /='|= "|<>|WHERE/i.test(condition) && kind !== "class") return "条件规则映射";

  if (kind === "class") {
    if (target.includes("/history/")) return "关系或状态历史实体化";
    if (target.includes("/production/") || /Production|Investment/.test(entityName)) return "时间序列或指标对象";
    if (/Area|Point|Coordinate/.test(entityName) || target.includes("/point")) return "空间或几何对象";
    if (/Reserve/.test(entityName) || target.includes("/reserve")) return "储量或资源汇总对象";
    if (/Test|Sample|Core|Document|Stratum/.test(entityName) || target.includes("/test/")) return "从属记录对象";
    return "实体表到业务对象";
  }

  if (kind === "objectProperty") {
    if (target.includes("/history/")) return "历史对象关系";
    if (/For|Operator|Licensee|Owner|included|belongs|contains|location/i.test(entityName)) {
      return "业务关系";
    }
    return "对象属性关系";
  }

  if (kind === "dataProperty") {
    if (mappingId.includes("Trans:") || /"true"|"false"/.test(target)) return "值归一化或布尔转换";
    if (target.includes("/production/") || /produced|remaining|recoverable|investment/i.test(entityName)) {
      return "指标值属性";
    }
    if (target.includes("/history/") || /date.*From|date.*To|dateUpdated/i.test(entityName)) {
      return "历史属性";
    }
    if (target.includes("/point") || /utm|degree|minute|second|WKT|coordinate|geometry/i.test(entityName)) {
      return "空间坐标属性";
    }
    return "数据属性";
  }

  return "其他映射";
}

const WORD_TRANSLATIONS = {
  acquisition: "采集",
  activity: "活动",
  address: "地址",
  amount: "数量",
  appraisal: "评价",
  area: "区域",
  award: "授予",
  baa: "业务安排区域",
  belongs: "属于",
  block: "区块",
  blowout: "井喷",
  bottom: "底部",
  business: "业务",
  casing: "套管",
  code: "代码",
  company: "公司",
  condensate: "凝析油",
  contains: "包含",
  coordinate: "坐标",
  coordinates: "坐标",
  core: "岩心",
  cores: "岩心",
  current: "当前",
  date: "日期",
  datum: "基准",
  degree: "度",
  degrees: "度",
  depth: "深度",
  development: "开发",
  discovery: "发现",
  document: "文档",
  drilling: "钻井",
  drillstem: "钻杆测试",
  dst: "钻杆测试",
  ew: "东西",
  exploration: "勘探",
  facility: "设施",
  feeder: "支线",
  field: "油气田",
  fixed: "固定",
  for: "关联",
  formation: "地层",
  from: "起始",
  function: "功能",
  gas: "气",
  geometry: "几何",
  geodetic: "大地",
  gross: "总量",
  history: "历史",
  hst: "历史",
  id: "ID",
  in: "位于",
  included: "纳入",
  investment: "投资",
  is: "是否",
  licensee: "持证方",
  licence: "许可证",
  litho: "岩性",
  lithostratigraphic: "岩性地层",
  location: "位置",
  lot: "泄漏测试",
  main: "主要",
  medium: "介质",
  minute: "分",
  minutes: "分",
  monthly: "月度",
  moveable: "可移动",
  mud: "泥浆",
  name: "名称",
  ncs: "挪威大陆架",
  net: "净量",
  npd: "NPD",
  npdid: "NPD ID",
  ns: "南北",
  number: "编号",
  of: "的",
  oil: "油",
  operator: "运营方",
  overview: "概览",
  owner: "所有者",
  parent: "父级",
  phase: "阶段",
  photo: "照片",
  pipe: "管道",
  pipeline: "管道",
  point: "点",
  polygon: "多边形",
  pressure: "压力",
  production: "生产",
  progress: "进度",
  province: "省区",
  quadrant: "象限",
  recoverable: "可采",
  remaining: "剩余",
  reserve: "储量",
  reserves: "储量",
  resource: "资源",
  resources: "资源",
  responsible: "负责",
  sample: "样品",
  sea: "海域",
  second: "秒",
  sensor: "传感器",
  shallow: "浅层",
  short: "简称",
  size: "大小",
  source: "震源",
  status: "状态",
  strat: "地层",
  stratum: "地层",
  survey: "测线调查",
  sync: "同步",
  task: "任务",
  test: "测试",
  to: "目标",
  top: "顶部",
  total: "累计",
  transportation: "输送",
  transfer: "转让",
  tuf: "TUF",
  type: "类型",
  updated: "更新",
  utm: "UTM",
  valid: "有效",
  wkt: "WKT",
  well: "井",
  wellbore: "井筒",
  wildcat: "预探",
  yearly: "年度",
};

const PHRASE_TRANSLATIONS = {
  "appraisal wellbore": "评价井筒",
  "belongs to facility": "属于设施",
  "belongs to well": "属于井",
  "blowout wellbore": "井喷井筒",
  "condensate pipeline": "凝析油管道",
  "date sync npd": "NPD 同步日期",
  "feeder pipeline": "支线管道",
  "gas pipeline": "天然气管道",
  "is former licence operator": "曾为许可证运营方",
  "oil gas pipeline": "油气管道",
  "oil pipeline": "石油管道",
  "short name": "简称",
  "transportation pipeline": "输送管道",
  "wildcat wellbore": "预探井筒",
};

const ACRONYMS = new Set(["BAA", "DST", "EW", "LOT", "NCS", "NPD", "NPDID", "NS", "TUF", "UTM", "WKT"]);

function splitName(value) {
  return String(value)
    .replace(/^npdv?:/i, "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./-]+/g, " ")
    .replace(/\bNpdid\b/gi, "NPDID")
    .replace(/\bNpd\b/gi, "NPD")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function titleWord(word) {
  const upper = word.toUpperCase();
  if (ACRONYMS.has(upper)) return upper === "NPDID" ? "NPD ID" : upper;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function makeLabel(value) {
  const words = splitName(value);
  const en = words.map(titleWord).join(" ") || String(value);
  const phraseKey = words.map((word) => word.toLowerCase()).join(" ");
  const zh = PHRASE_TRANSLATIONS[phraseKey] ?? words
    .map((word) => WORD_TRANSLATIONS[word.toLowerCase()] ?? titleWord(word))
    .join("");
  return { en, zh: zh || en };
}

function normalizeTemplate(term) {
  return String(term)
    .trim()
    .replace(/[.]\s*$/, "")
    .replace(/\{[^}]+\}/g, "{}")
    .replace(/\/+/g, "/");
}

function stableTemplateParts(term) {
  return normalizeTemplate(term)
    .replace(/^npd:/, "")
    .split("/")
    .filter((part) => part && part !== "{}" && !/^\d+$/.test(part));
}

function pascalCase(words) {
  return words.map((word) => titleWord(word).replace(/\s+/g, "")).join("");
}

function inferObjectName(term) {
  const parts = stableTemplateParts(term);
  if (parts.length === 0) return "UnknownObject";
  const compactParts = parts.slice(0, Math.min(parts.length, 3));
  return pascalCase(compactParts);
}

function makeId(prefix, value) {
  return `${prefix}:${String(value).replace(/[^A-Za-z0-9_:-]+/g, "_")}`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function firstColumnsForTable(sourceColumns, table) {
  const prefix = `${table}.`;
  return sourceColumns.filter((column) => column.startsWith(prefix)).slice(0, 4);
}

function buildMappingGraph(entries, sourcePath) {
  const templateVotes = new Map();

  for (const entry of entries) {
    if (entry.kind !== "class" && entry.kind !== "subclass") continue;
    const template = normalizeTemplate(entry.targetSubject);
    const votes = templateVotes.get(template) ?? new Map();
    const weight = entry.kind === "class" ? 2 : 1;
    votes.set(entry.entityName, (votes.get(entry.entityName) ?? 0) + weight);
    templateVotes.set(template, votes);
  }

  const templateToObjectName = new Map();
  for (const [template, votes] of templateVotes) {
    const [name] = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    templateToObjectName.set(template, name);
  }

  const objects = new Map();
  const tables = new Map();
  const edges = new Map();

  function resolveObjectName(term) {
    const template = normalizeTemplate(term);
    return templateToObjectName.get(template) ?? inferObjectName(term);
  }

  function ensureObject(name, term) {
    const id = makeId("object", name);
    if (!objects.has(id)) {
      objects.set(id, {
        id,
        kind: "ontologyObject",
        name,
        label: makeLabel(name),
        uriTemplates: [],
        sourceTables: [],
        mappingIds: [],
        classMappings: [],
        properties: [],
        relations: [],
      });
    }
    const node = objects.get(id);
    if (term) node.uriTemplates.push(normalizeTemplate(term));
    return node;
  }

  function ensureTable(name) {
    const id = makeId("table", name);
    if (!tables.has(id)) {
      tables.set(id, {
        id,
        kind: "sourceTable",
        name,
        label: makeLabel(name),
        sourceTables: [name],
        sourceColumns: [],
        mappingIds: [],
      });
    }
    return tables.get(id);
  }

  function upsertEdge(next) {
    if (!edges.has(next.id)) {
      edges.set(next.id, {
        sourceTables: [],
        sourceColumns: [],
        targetProperties: [],
        ...next,
      });
    }
    return edges.get(next.id);
  }

  function addMappingToEdge(edge, mapping) {
    edge.mappingIds.push(mapping.mappingId);
    edge.mappings.push(mapping);
    edge.sourceTables.push(...(mapping.sourceTables ?? []));
    edge.sourceColumns.push(...mapping.sourceColumns);
    if (mapping.targetProperty) edge.targetProperties.push(mapping.targetProperty);
  }

  for (const entry of entries) {
    for (const tableName of entry.sourceTables) {
      const table = ensureTable(tableName);
      table.sourceColumns.push(...firstColumnsForTable(entry.sourceColumns, tableName));
      table.mappingIds.push(entry.id);
    }

    if (entry.kind === "class" || entry.kind === "subclass") {
      const object = ensureObject(entry.entityName, entry.targetSubject);
      object.sourceTables.push(...entry.sourceTables);
      object.mappingIds.push(entry.id);
      object.classMappings.push({
        mappingId: entry.id,
        sourceTables: entry.sourceTables,
        sourceColumns: entry.sourceColumns,
        targetColumns: entry.targetColumns,
        targetSubject: entry.targetSubject,
        abstraction: entry.abstraction,
        condition: entry.condition,
      });

      for (const tableName of entry.sourceTables) {
        const table = ensureTable(tableName);
        const edge = upsertEdge({
          id: `${table.id}->${object.id}`,
          kind: "tableToObject",
          source: table.id,
          target: object.id,
          label: { en: "table rows to object", zh: "表记录到对象" },
          mappingIds: [],
          mappings: [],
        });
        addMappingToEdge(edge, {
          mappingId: entry.id,
          sourceTables: [tableName],
          sourceColumns: firstColumnsForTable(entry.sourceColumns, tableName),
          targetProperty: `${entry.entityName}.rdf:type`,
          targetLabel: makeLabel(`${entry.entityName} type`),
          abstraction: entry.abstraction,
        });
      }
      continue;
    }

    const sourceObjectName = resolveObjectName(entry.targetSubject);
    const sourceObject = ensureObject(sourceObjectName, entry.targetSubject);
    sourceObject.sourceTables.push(...entry.sourceTables);
    sourceObject.mappingIds.push(entry.id);

    if (entry.kind === "objectProperty" && /^npd:/.test(entry.targetObject.trim())) {
      const targetObjectName = resolveObjectName(entry.targetObject);
      const targetObject = ensureObject(targetObjectName, entry.targetObject);
      const mapping = {
        mappingId: entry.id,
        sourceTables: entry.sourceTables,
        sourceColumns: entry.sourceColumns,
        targetColumns: entry.targetColumns,
        targetSubject: entry.targetSubject,
        targetObject: entry.targetObject,
        targetProperty: `${sourceObject.name}.${entry.entityName}`,
        targetLabel: makeLabel(`${sourceObject.name} ${entry.entityName}`),
        abstraction: entry.abstraction,
        condition: entry.condition,
      };
      const relationEdge = upsertEdge({
        id: makeId("edge", `${sourceObject.name}:${entry.entityName}:${targetObject.name}`),
        kind: "objectRelation",
        name: entry.entityName,
        predicate: entry.targetPredicate,
        source: sourceObject.id,
        target: targetObject.id,
        label: makeLabel(entry.entityName),
        sourceObjectName: sourceObject.name,
        targetObjectName: targetObject.name,
        mappingIds: [],
        mappings: [],
      });
      addMappingToEdge(relationEdge, mapping);
      sourceObject.relations.push(relationEdge.id);
      targetObject.relations.push(relationEdge.id);

      for (const tableName of entry.sourceTables) {
        const table = ensureTable(tableName);
        const edge = upsertEdge({
          id: `${table.id}->${sourceObject.id}`,
          kind: "tableToObject",
          source: table.id,
          target: sourceObject.id,
          label: { en: "columns to relationship", zh: "列到对象关系" },
          mappingIds: [],
          mappings: [],
        });
        addMappingToEdge(edge, {
          ...mapping,
          sourceTables: [tableName],
          sourceColumns: firstColumnsForTable(entry.sourceColumns, tableName),
        });
      }
      continue;
    }

    const property = {
      mappingId: entry.id,
      name: entry.entityName,
      label: makeLabel(entry.entityName),
      predicate: entry.targetPredicate,
      sourceTables: entry.sourceTables,
      sourceColumns: entry.sourceColumns,
      targetColumns: entry.targetColumns,
      targetSubject: entry.targetSubject,
      targetObject: entry.targetObject,
      abstraction: entry.abstraction,
      condition: entry.condition,
    };
    sourceObject.properties.push(property);

    for (const tableName of entry.sourceTables) {
      const table = ensureTable(tableName);
      const edge = upsertEdge({
        id: `${table.id}->${sourceObject.id}`,
        kind: "tableToObject",
        source: table.id,
        target: sourceObject.id,
        label: { en: "columns to attributes", zh: "列到属性" },
        mappingIds: [],
        mappings: [],
      });
      addMappingToEdge(edge, {
        mappingId: entry.id,
        sourceTables: [tableName],
        sourceColumns: firstColumnsForTable(entry.sourceColumns, tableName),
        targetProperty: `${sourceObject.name}.${entry.entityName}`,
        targetLabel: makeLabel(`${sourceObject.name} ${entry.entityName}`),
        abstraction: entry.abstraction,
        condition: entry.condition,
      });
    }
  }

  const nodes = [...objects.values(), ...tables.values()].map((node) => ({
    ...node,
    uriTemplates: node.uriTemplates ? uniqueSorted(node.uriTemplates) : undefined,
    sourceTables: uniqueSorted(node.sourceTables ?? []),
    sourceColumns: uniqueSorted(node.sourceColumns ?? []),
    mappingIds: uniqueSorted(node.mappingIds ?? []),
    relations: node.relations ? uniqueSorted(node.relations) : undefined,
  })).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  const graphEdges = [...edges.values()].map((edge) => {
    const sourceColumns = uniqueSorted(edge.sourceColumns ?? []);
    const targetProperties = uniqueSorted(edge.targetProperties ?? []);
    const firstMapping = edge.mappings[0];
    const label = edge.kind === "objectRelation"
      ? edge.label
      : firstMapping
      ? {
          en: edge.mappings.length > 1
            ? `${edge.mappings.length} mappings`
            : `${firstMapping.sourceColumns[0] ?? "source"} -> ${firstMapping.targetProperty ?? "target"}`,
          zh: edge.mappings.length > 1
            ? `${edge.mappings.length} 个映射`
            : `${firstMapping.sourceColumns[0] ?? "来源"} -> ${firstMapping.targetLabel?.zh ?? firstMapping.targetProperty ?? "目标"}`,
        }
      : edge.label;
    return {
      ...edge,
      label,
      sourceTables: uniqueSorted(edge.sourceTables ?? []),
      sourceColumns,
      targetProperties,
      mappingIds: uniqueSorted(edge.mappingIds ?? []),
      mappings: edge.mappings.slice(0, 80),
    };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  return {
    schemaVersion: 1,
    source: sourcePath,
    generatedFrom: "NPD Benchmark v1.10.1 PostgreSQL OBDA mappings",
    stats: {
      mappingCount: entries.length,
      ontologyObjectCount: objects.size,
      ontologyRelationCount: graphEdges.filter((edge) => edge.kind === "objectRelation").length,
      sourceTableCount: tables.size,
      dataPropertyMappingCount: entries.filter((entry) => entry.kind === "dataProperty").length,
      classMappingCount: entries.filter((entry) => entry.kind === "class" || entry.kind === "subclass").length,
    },
    nodes,
    edges: graphEdges,
  };
}

const entries = [];
const regex = /mappingId\s+([^\n]+)\ntarget\s+(.+?)\nsource\s+([\s\S]*?)(?=\n\nmappingId\s+|\s*$)/g;
let match;
while ((match = regex.exec(section[1])) !== null) {
  const id = match[1].trim();
  const target = match[2].trim();
  const sourceSql = match[3].trim();
  const parsed = parseTarget(target);
  const kind = id.includes("Table:Subs") && parsed.kind === "class" ? "subclass" : parsed.kind;
  const sourceTables = extractTables(sourceSql);
  const sourceColumns = extractColumns(sourceSql, sourceTables);
  const condition = extractCondition(sourceSql);
  const targetColumns = [...target.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

  entries.push({
    id,
    kind,
    abstraction: classifyAbstraction(kind, id, parsed.entityName, target, sourceSql, condition),
    entityPrefix: parsed.entityPrefix,
    entityName: parsed.entityName,
    targetSubject: parsed.subject,
    targetPredicate: parsed.predicate,
    targetObject: parsed.object,
    target,
    sourceSql,
    sourceTables,
    sourceColumns,
    targetColumns,
    condition,
  });
}

const totals = entries.reduce((acc, entry) => {
  acc.byKind[entry.kind] = (acc.byKind[entry.kind] ?? 0) + 1;
  acc.byAbstraction[entry.abstraction] = (acc.byAbstraction[entry.abstraction] ?? 0) + 1;
  for (const table of entry.sourceTables) {
    acc.byTable[table] = (acc.byTable[table] ?? 0) + 1;
  }
  return acc;
}, { byKind: {}, byAbstraction: {}, byTable: {} });

const payload = {
  source: "datasets/npd-benchmark/mappings/postgres/npd-v2-ql.obda",
  generatedFrom: "NPD Benchmark v1.10.1 PostgreSQL OBDA mappings",
  mappingCount: entries.length,
  totals,
  entries,
};
const graphPayload = buildMappingGraph(entries, payload.source);

const header = `// Generated by scripts/generate-npd-mapping-data.mjs from the local NPD benchmark.\n` +
  `// Do not edit this file by hand; regenerate after updating datasets/npd-benchmark.\n\n` +
  `import type { OntologyMappingDataset } from "../mapping/types";\n\n` +
  `export const npdMappingData = `;
const body = JSON.stringify(payload, null, 2);
const footer = ` satisfies OntologyMappingDataset;\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${header}${body}${footer}`);
fs.writeFileSync(graphOutputPath, `${JSON.stringify(graphPayload, null, 2)}\n`);
console.log(`Wrote ${entries.length} mapping entries to ${path.relative(repoRoot, outputPath)}`);
console.log(`Wrote ${graphPayload.nodes.length} graph nodes and ${graphPayload.edges.length} edges to ${path.relative(repoRoot, graphOutputPath)}`);
