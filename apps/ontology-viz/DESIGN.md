# OntologyViz

OntologyViz 当前处于应用优先的开发阶段。所有正式实现均位于本目录，暂不维护独立 npm 包兼容层。

开发依据：

- [SPEC.md](./docs/SPEC.md)：产品范围、交互规则和验收标准。
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md)：模块边界、数据流和 G6 使用原则。
- [VERIFICATION.md](./docs/VERIFICATION.md)：构建门禁和浏览器回归矩阵。
- [basic.html](./basic.html)：便于分享的单文件版本，也是正式应用的视觉参考。

`basic.html` 不承担大图性能、持久化和多格式扩展职责。正式应用稳定后，再从 `src` 中提取可发布包。
