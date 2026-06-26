import { AppFrame } from "../components/AppFrame";
import { usePlatform } from "../hooks/usePlatformState";

export function ImportPage() {
  const { currentBundle, setCurrentDomain } = usePlatform();

  return (
    <AppFrame
      page="import"
      eyebrow="01 / 导入与自动建模"
      title="用统一接入台承接数据导入、本体建模和样例域加载"
      description="当前页只提供前端演示，不执行真实建模。页面重点展示接入入口、自动化建模预览和一键加载样例 domain 的产品形态。"
    >
      <section className="content-grid import-grid">
        <article className="panel">
          <div className="panel-head">
            <h2>接入入口</h2>
            <span className="panel-badge">UI Only</span>
          </div>
          <div className="source-list">
            <button className="source-card" type="button">
              <strong>上传结构化文件</strong>
              <span>预留 CSV / JSON / Excel 进入自动化本体建模流水线。</span>
            </button>
            <button className="source-card" type="button">
              <strong>连接图数据库</strong>
              <span>预留 Neo4j 接入，后续将按对象与关系自动归类。</span>
            </button>
            <button className="source-card source-card--active" type="button" onClick={() => setCurrentDomain("manufacture-design-change")}>
              <strong>加载制造设计变更样例</strong>
              <span>把样例 domain 设为当前上下文，继续进入本体页和问答页。</span>
            </button>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>当前 Domain</span>
              <input id="import-current-domain" name="importCurrentDomain" readOnly value={currentBundle.domainMeta.name} />
            </label>
            <label className="field">
              <span>资源布局</span>
              <input id="import-resource-layout" name="importResourceLayout" readOnly value={currentBundle.domainMeta.resourceLayout} />
            </label>
            <label className="field">
              <span>自动建模状态</span>
              <input id="import-modeling-status" name="importModelingStatus" readOnly value="未接通，当前使用内置样例数据与资源定义" />
            </label>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>自动建模结果预览</h2>
            <span className="panel-badge">Preview</span>
          </div>
          <div className="metric-grid">
            <div className="metric-card">
              <span>Object</span>
              <strong>{currentBundle.objects.length}</strong>
            </div>
            <div className="metric-card">
              <span>Link</span>
              <strong>{currentBundle.links.length}</strong>
            </div>
            <div className="metric-card">
              <span>Function</span>
              <strong>{currentBundle.functions.length}</strong>
            </div>
            <div className="metric-card">
              <span>Action</span>
              <strong>{currentBundle.actions.length}</strong>
            </div>
          </div>
          <div className="preview-columns">
            <section>
              <h3>语义面</h3>
              <ul className="dense-list">
                {currentBundle.objects.slice(0, 5).map((item) => (
                  <li key={item.id}>
                    <strong>{item.name}</strong>
                    <span>{item.summary}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3>能力面</h3>
              <ul className="dense-list">
                {currentBundle.functions.slice(0, 4).map((item) => (
                  <li key={item.id}>
                    <strong>{item.name}</strong>
                    <span>{item.summary}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>演示路径</h2>
            <span className="panel-badge">Guide</span>
          </div>
          <ol className="timeline">
            <li>
              <strong>导入与建模</strong>
              <span>确认当前 domain、接入模式和自动建模预览。</span>
            </li>
            <li>
              <strong>本体查看与管理</strong>
              <span>进入图谱主画布，查看语义面与能力面，并通过抽屉做草稿编辑。</span>
            </li>
            <li>
              <strong>Agent 业务问答</strong>
              <span>通过左侧对话和右侧推理链演示已知流程问题与能力缺口问题。</span>
            </li>
          </ol>
          <div className="cta-row">
            <a className="button-primary" href="./ontology.html">
              进入本体图谱
            </a>
            <a className="button-secondary" href="./qa.html">
              进入 Agent 问答
            </a>
          </div>
          <div className="note-card">
            当前样例域为 <strong>{currentBundle.domainMeta.name}</strong>。本页只负责界面占位，不提供真实导入、自动建模和发布流程。
          </div>
        </article>
      </section>
    </AppFrame>
  );
}
