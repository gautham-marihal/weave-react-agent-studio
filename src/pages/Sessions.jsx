import CallsView from '../studio/calls/CallsView.jsx';

// Every call of every agent (real and test), with filters and a trace of each. A page inside the Dashboard shell.
export function CallsPage({ bots = [], onOpenAgent }) {
  return (
    <div className="sessionsContent">
      {/* the calls themselves are in the panel below the title */}
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
