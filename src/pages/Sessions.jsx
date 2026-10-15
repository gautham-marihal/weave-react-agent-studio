import CallsView from '../studio/calls/CallsView.jsx';

// Every call of every agent: real callers and test conversations, with filters, and a trace of what happened in each. It is a page of the Home shell
// (the sidebar and top bar belong to the Dashboard), like Voices and Integrations.
export function CallsPage({ bots = [], onOpenAgent }) {
  return (
    <div className="sessionsContent">
      <section className="sessionsTablePanel callsPanel">
        <div className="sessionsPanelHeader">
          <div>
            <h2>Calls</h2>
            <p>Every conversation your agents have had: real callers and test conversations. Open one to see what was said and what the agent did.</p>
          </div>
        </div>
        <CallsView bots={bots} onOpenAgent={onOpenAgent} />
      </section>
    </div>
  );
}
