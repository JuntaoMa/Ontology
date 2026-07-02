# 结构化数据自动建模测试集

本文档用于整理“从结构化数据自动生成本体/语义层”的高价值测试集。优先选择同时具备以下要素的数据源：

- 真实或接近真实的业务 schema，例如 SQL DDL、表/列、外键、OpenAPI/JSON Schema、CSV 元数据。
- 可验证的语义目标，例如 ontology、R2RML/OBDA mapping、标准数据模型、业务查询或人工标注。
- 能暴露真实业务问题，例如命名不一致、同义词、弱语义字段、跨表关系、指标口径、跨域数据融合。

最后核对日期：2026-07-02。

## 当前首选：NPD Benchmark

**定位**：结构化数据到 ontology/mapping 的 gold reference。
**来源**：[ontop/npd-benchmark](https://github.com/ontop/npd-benchmark)。

NPD Benchmark 基于 Norwegian Petroleum Directorate FactPages，领域是挪威大陆架油气活动。它不是电信数据集，但非常适合验证自动建模能力，因为它同时提供关系数据库、OWL 2 QL ontology、R2RML/OBDA mappings、SPARQL queries 和数据放大工具。

本地快照：

- 下载来源：`https://github.com/ontop/npd-benchmark/archive/refs/heads/master.tar.gz`
- Benchmark 版本：`v1.10.1`
- 解压目录：`datasets/npd-benchmark/`
- 本地归档：`datasets/npd-benchmark-master.tar.gz`
- 解压后大小：约 156 MB
- 归档大小：约 19 MB
- 文件数量：324

核心内容：

| 路径 | 内容 | 用途 |
|---|---|---|
| `datasets/npd-benchmark/data/` | MySQL/PostgreSQL schema、dump、建库脚本 | 作为自动建模输入 |
| `datasets/npd-benchmark/ontology/` | `npd-v2-ql.owl` | 作为 gold ontology |
| `datasets/npd-benchmark/mappings/` | MySQL/PostgreSQL 的 OBDA/R2RML mappings | 作为 gold mapping |
| `datasets/npd-benchmark/queries/` | 31 个 SPARQL 查询 | 作为端到端查询验证 |
| `datasets/npd-benchmark/query_templates/` | 查询模板 | 用于扩展评测 |
| `datasets/npd-benchmark/docs/` | benchmark 文档 | 用于解释 ontology、mapping、query 设计 |

建议评测任务：

| 任务 | 输入 | 目标输出 | 评估方式 |
|---|---|---|---|
| 业务对象发现 | DDL、表名、列名、外键、样本数据 | 类候选，例如 Wellbore、Field、Company、Licence | 与 `ontology/npd-v2-ql.owl` 对齐 |
| 属性归类 | 表列、数据类型、样本值 | datatype property、range、单位/口径说明 | 与 ontology 和 mappings 对齐 |
| 关系抽取 | 外键、关联表、列名模式 | object property | 与 R2RML/OBDA mappings 对齐 |
| 层级发现 | 表名、字段名、样本、业务描述 | superclass/subclass | 与 OWL 类层级对齐 |
| mapping 生成 | SQL schema + ontology candidate | RDB-to-RDF mapping | 与 gold mappings 做结构和查询结果对比 |
| 查询可用性 | 自动 ontology + mapping | benchmark SPARQL 可执行 | 查询成功率、结果一致性、SQL 性能 |

注意事项：

- 使用仓库快照作为固定基线，避免混用当前政府网站数据。
- NPD 的强项是 OBDA 和 mapping 评测，不是同义词治理或指标口径冲突评测。
- 适合作为第一阶段自动建模 pipeline 的端到端基准。

## 其他高价值测试集

### P0：建议纳入第一批

| 数据集 | 领域 | 数据形态 | 价值 | 链接 |
|---|---|---|---|---|
| TM Forum Open APIs | 电信 BSS/OSS | OpenAPI、JSON Schema、API 资源模型 | 电信领域优先级最高；适合从行业 API 元数据生成 Customer、Product、Service、Resource、TroubleTicket、Order 等业务本体 | [GitHub org](https://github.com/tmforum-apis) |
| Spider 1.0 | 跨领域数据库 | 200 个数据库、自然语言问题、SQL | 适合测试 schema linking、表列语义识别、跨域泛化；有大量研究基线 | [Official](https://yale-lily.github.io/spider) |
| Spider 2.0 | 企业级 SQL workflow | 真实企业工作流、复杂数据库、方言和项目上下文 | 比 Spider 1.0 更接近真实企业环境，适合测试长上下文 metadata 理解 | [Official](https://spider2-sql.github.io) |
| BIRD-SQL | 跨领域大数据库 | 95 个大数据库、12,751+ question-SQL pairs、约 33.4 GB | 适合测试真实数据库内容参与下的 schema/语义理解；比 Spider 更重视数据值和业务知识 | [Official](https://bird-bench.github.io/) |
| W3C R2RML / Direct Mapping Test Cases | 标准映射 | 关系表、R2RML、期望 RDF 输出 | 适合做 mapping 生成器的标准合规单元测试 | [W3C](https://www.w3.org/TR/rdb2rdf-test-cases/) |

### P1：建议作为领域扩展

| 数据集 | 领域 | 数据形态 | 价值 | 链接 |
|---|---|---|---|---|
| OpenCelliD | 电信无线网络 | Cell tower CSV/API | 适合构建 Cell、Operator、RAT、LAC/TAC、Coverage 等无线网络实体模型；可与 3GPP ontology 做概念对齐 | [Downloads](https://opencellid.org/downloads.php) |
| Urban Multi-Operator QoE-Aware Cellular Dataset | 电信无线 QoE | CSV、RSRP/RSRQ/SNR、移动场景、业务场景 | 适合测试 KPI/QoE、测量事件、网络质量、用户体验之间的语义建模 | [Paper](https://arxiv.org/abs/2506.22484) |
| OMOP Common Data Model | 医疗 | 标准 CDM DDL、表级/字段级元数据 | 结构非常规范，适合测试“行业标准模型 -> ontology/semantic layer” | [GitHub](https://github.com/OHDSI/CommonDataModel) |
| Synthea | 医疗 | 合成患者数据、FHIR/CSV 等输出 | 无隐私门槛，适合和 OMOP/FHIR 结合做医疗结构化数据建模 | [Official](https://synthetichealth.github.io/synthea/) |

### P2：补充评测

| 数据集 | 领域 | 数据形态 | 价值 | 链接 |
|---|---|---|---|---|
| MIMIC-IV | 医疗 ICU | 关系型临床数据库 | 真实临床数据，适合复杂术语和事件建模；但需要认证和数据使用协议 | [Official](https://mimic.mit.edu/) |
| TPC-H / TPC-DS / TPC-DI | 商业分析/数仓/数据集成 | 可生成关系数据、标准查询 | 适合性能、规模、数据集成流程评测；语义复杂度不如 NPD/TMF/医疗 | [TPC-H](https://www.tpc.org/tpch/) |
| AdventureWorks / Northwind / Chinook | 通用业务 | SQL 示例库 | 轻量、易上手，适合 smoke test；不适合作为最终能力评测 | Microsoft / community samples |
| LUBM / BSBM / WatDiv | RDF/ontology benchmark | 已有 ontology/RDF/query | 适合测试下游 RDF 查询和推理性能；不适合作为结构化数据自动建模主基准 | public benchmark suites |

## 推荐实验路线

1. **NPD 作为第一基准**：先完成 SQL schema/sample rows 到 ontology candidate、mapping candidate、SPARQL query validation 的闭环。
2. **TM Forum Open APIs 作为电信基准**：验证 JSON/OpenAPI 元数据到电信业务本体的生成能力。
3. **OpenCelliD + QoE 数据作为电信实例基准**：验证无线网络实体、测量、位置、KPI/QoE 的实例层建模。
4. **Spider/BIRD 作为跨域泛化基准**：验证模型是否只适配单一领域，还是能泛化到未知 schema。
5. **W3C R2RML tests 作为 mapping 单元测试**：保证自动 mapping 输出不是只在 NPD 上可用，而是满足标准映射语义。

## 下载与版本管理约定

- 大型数据集放在仓库根目录 `datasets/`，该目录已由根 `.gitignore` 忽略。
- 文档、下载脚本、转换脚本和小型 fixture 可以进入 git。
- 每个下载的数据集应记录来源 URL、下载日期、版本/commit、许可限制和本地路径。
- 涉及认证、API token 或数据使用协议的数据集不直接提交，也不在脚本中硬编码凭据。
