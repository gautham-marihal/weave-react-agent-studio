import CallsView from '../studio/calls/CallsView.jsx';

// Every call of every agent: real callers and test conversations, with filters, and a trace of what happened in each. It is a page of the Home shell
// (the sidebar and top bar belong to the Dashboard), like Voices and Integrations.
export function CallsPage({ bots = [], onOpenAgent }) {
  return (
    <div className="sessionsContent">
      {/* the same title as every page of the workspace; the calls themselves are in the panel below it */}
      <section className="welcomeBlock pageHeaderBlock">
        <div>
          <h1>Calls</h1>
          <p>Every conversation your agents have had: real callers and test conversations. Open one to see what was said and what the agent did.</p>
        </div>
      </section>
      <section className="sessionsTablePanel callsPanel" aria-label="Calls">
        <CallsView bots={bots} onOpenAgent={onOpenAgent} />
      </section>
    </div>
  );
}
