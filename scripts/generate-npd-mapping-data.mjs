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
  const tokens = target.trim().replace(/[.]\s*$/, "").split(/\s+/);
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
  const isLiteral = /\{[^}]+\}\^\^|^"[^"]*"|\s"[^"]*"/.test(object) ||
    /\{[^}]+\}$/.test(object) ||
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

const header = `// Generated by scripts/generate-npd-mapping-data.mjs from the local NPD benchmark.\n` +
  `// Do not edit this file by hand; regenerate after updating datasets/npd-benchmark.\n\n` +
  `import type { OntologyMappingDataset } from "../mapping/types";\n\n` +
  `export const npdMappingData = `;
const body = JSON.stringify(payload, null, 2);
const footer = ` satisfies OntologyMappingDataset;\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${header}${body}${footer}`);
console.log(`Wrote ${entries.length} mapping entries to ${path.relative(repoRoot, outputPath)}`);
