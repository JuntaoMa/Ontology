import { StoreProvider, useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { RunBar } from "./components/RunBar";
import { Overview } from "./sections/Overview";
import { Inbox } from "./sections/Inbox";
import { OntologySection } from "./sections/OntologySection";
import { RulesSection } from "./sections/RulesSection";
import { ProcessSection } from "./sections/ProcessSection";
import { LabSection } from "./sections/LabSection";
import { GateSection } from "./sections/GateSection";

function Body() {
  const { section } = useStore();
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <RunBar />
      <main className="min-h-0 flex-1 overflow-auto p-5">
        {section === "overview" && <Overview />}
        {section === "inbox" && <Inbox />}
        {section === "ontology" && <OntologySection />}
        {section === "rules" && <RulesSection />}
        {section === "process" && <ProcessSection />}
        {section === "lab" && <LabSection />}
        {section === "gate" && <GateSection />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <Body />
      </div>
    </StoreProvider>
  );
}
