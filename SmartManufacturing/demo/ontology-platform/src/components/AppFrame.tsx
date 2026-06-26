import type { ReactNode } from "react";
import { usePlatform } from "../hooks/usePlatformState";
import type { PageKind } from "../utils/types";

const PAGE_LINKS: Array<{ id: PageKind; label: string; href: string }> = [
  { id: "about", label: "About", href: "./about.html" },
  { id: "import", label: "导入与建模", href: "./index.html" },
  { id: "ontology", label: "本体查看与管理", href: "./ontology.html" },
  { id: "qa", label: "Agent 问答", href: "./qa.html" },
];

export function AppFrame({
  page,
  eyebrow: _eyebrow,
  title: _title,
  description: _description,
  children,
}: {
  page: PageKind;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { domains, state, setCurrentDomain } = usePlatform();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳转到主内容
      </a>

      <header className="topbar">
        <div className="brand-block">
          <a className="brand-mark" href="./about.html">
            Ontology Platform
          </a>
          <p className="brand-subtitle">语义资源与能力资源统一工作台</p>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          {PAGE_LINKS.map((item) => (
            <a
              key={item.id}
              className={item.id === page ? "active" : undefined}
              href={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <label className="field field-compact">
          <span>当前 Domain</span>
          <select
            id="domain-select"
            name="domainSelect"
            value={state.currentDomainId}
            onChange={(event) => setCurrentDomain(event.target.value)}
          >
            {domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main id="main-content" className="page-shell">
        {children}
      </main>
    </div>
  );
}
