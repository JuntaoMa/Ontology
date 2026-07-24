# 电信运维知识图谱（Telecom Operations KG）

这是一次从零开始、与仓库中既有抽取结果隔离的公开标准知识图谱工程。基线以 3GPP Release 18 为主，ITU-T、IETF 等公开标准按实际引用的精确版次纳入；Release 19 仅作为后续差分范围，不静默混入当前图谱。

覆盖范围包括：

- 4G/LTE/EPC 与 CUPS；
- 5G/NG-RAN/5GC/SBA；
- IMS、VoLTE、VoNR、短信与紧急通信；
- OTN、以太网 OAM、IP/MPLS/MPLS-TP、VPN、SR/SRv6、同步与主动测量；
- 网元、网络功能、接口、协议栈、消息、IE/AVP、Cause、Timer；
- 关键端到端信令流程、流程变体、参与角色和有序消息交换；
- Counter、KPI、KQI、告警、故障、服务影响和跨层依赖。

## 证据与版本原则

每条可发布断言都必须沿以下链路回溯：

`Assertion → AssertionEvidence → EvidenceSpan → DocumentPart → DocumentArtifact → DocumentEdition → DocumentFamily`

其中制品记录官方落地页、实际下载地址、精确版本/版次、抓取时间、媒体类型、字节数与 SHA-256；证据片段记录规范定位符、正文片段哈希及短引。外部标准（非 3GPP）还要求短引必须在已哈希制品的抽取文本中实际命中；3GPP 证据使用可复核的 clause/fragment 定位，不复制大段受版权保护正文。任何显式 `match` 都是完整性约束：没有命中时构建必须失败，不能回退到同一规范中的无关片段。目录很宽并不等于证据已经落地：只有已下载、已哈希且被目录引用的制品才进入可复现基线。

对于标准未规定、但运维上有价值的 KPI→KQI 组合，必须标记为 `proposed`/`derived`，记录推导规则，并明确权重或阈值属于运营配置，不能伪装成标准公式。

## 目录

- `config/standards.json`：公开标准来源清单与版本选择策略；
- `sources/lock.json`：解析后的精确版本、制品 URL 与 SHA-256 锁；
- `ontology/`：核心本体和受控词表；
- `shapes/`：严格 SHACL 约束；
- `catalog/`：按 4G、5G、IMS/业务、传输、运维保障分模块的结构化抽取；
- `evidence/`：本地抽取片段及 SQLite 查询索引（可由官方制品重建）；
- `release/`：RDF Dataset、Turtle、JSONL、CSV、清单与校验结果；
- `reports/`：覆盖、缺口与实际引用来源锁报告。

## 可复现构建

项目严格使用项目内 `uv` 环境：

```bash
uv sync
uv run tokg-sync-sources --resolve-only
uv run tokg-sync-sources --extract --cited-only
uv run tokg-audit-evidence
uv run tokg-build
uv run tokg-validate
uv run tokg-report
uv run pytest
```

`--cited-only` 只下载目录中真正引用的制品，但仍保留完整来源清单和版本锁。重复执行会校验并复用本地缓存；3GPP 旧二进制 Word 文档会先转换成 DOCX，再按相同证据规则抽取。证据审计报告写入 `reports/evidence-audit.json`；任何失败或 locator-only 警告都会阻止覆盖报告标记为可发布。

## “完整”的判定

电信标准持续演进，因此这里不作无边界的“绝对完整”声明。`reports/COVERAGE.md` 把完整性限定为当前锁定的公开标准语料基线；仅当所有必需领域有直接证据、所有被引制品有哈希、所有流程有步骤、所有已审阅断言可追溯、SHACL 与自定义校验全部通过且缺口为零时，报告才会标记 `publishable=true`。
