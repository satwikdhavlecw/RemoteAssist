import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = "http://127.0.0.1:4310";

interface HumanHandoff {
  id: string;
  sessionId: string;
  employeeDisplayName: string;
  issue: string;
  application: string | null;
  visibleError: string | null;
  consentStatus: "human_view_granted";
  status: "queued" | "connected" | "completed";
  requestedAt: string;
  agentDisplayName: string | null;
  ticketId: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-remoteassist-tenant-id": "local-tenant",
      "x-remoteassist-user-id": "local-support-agent",
      "x-remoteassist-roles": "support_agent",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `API returned ${response.status}`);
  }
  return body;
}

function ConsoleApp() {
  const [handoffs, setHandoffs] = useState<HumanHandoff[]>([]);
  const [connected, setConnected] = useState<HumanHandoff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await request<{ handoffs: HumanHandoff[] }>(
        "/v1/human-handoffs",
      );
      setHandoffs(response.handoffs);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load the queue.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function join(handoffId: string): Promise<void> {
    try {
      const response = await request<{ handoff: HumanHandoff }>(
        `/v1/human-handoffs/${handoffId}/join`,
        { method: "POST", body: "{}" },
      );
      setConnected(response.handoff);
      setHandoffs((items) => items.filter((item) => item.id !== handoffId));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not join the session.",
      );
      await refresh();
    }
  }

  return (
    <main className="console-shell">
      <header>
        <div>
          <p className="eyebrow">RemoteAssist operations</p>
          <h1>Human support queue</h1>
          <p className="subtitle">
            Sanitized context appears only after separate human-view consent.
          </p>
        </div>
        <div className="identity-card">
          <span>Signed in (local mock)</span>
          <strong>Local Support Engineer</strong>
          <small>support_agent · local-tenant</small>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {connected && (
        <section className="connected-card" aria-live="polite">
          <span className="status-badge connected">Connected</span>
          <div>
            <h2>{connected.employeeDisplayName}</h2>
            <p>{connected.issue}</p>
          </div>
          <div className="context-grid">
            <span>Session</span>
            <strong>{connected.sessionId}</strong>
            <span>Ticket</span>
            <strong>{connected.ticketId}</strong>
            <span>Consent</span>
            <strong>Human view granted</strong>
          </div>
          <p className="scope-note">
            Context transfer is active. Live screen streaming and human remote
            control are intentionally outside this local MVP.
          </p>
        </section>
      )}

      <section className="queue-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Awaiting engineer</p>
            <h2>
              {handoffs.length} queued request{handoffs.length === 1 ? "" : "s"}
            </h2>
          </div>
          <button className="refresh-button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="empty-state">Loading authorized queue…</p>
        ) : handoffs.length === 0 ? (
          <p className="empty-state">No consented handoffs are waiting.</p>
        ) : (
          <div className="queue-grid">
            {handoffs.map((handoff) => (
              <article className="handoff-card" key={handoff.id}>
                <div className="card-topline">
                  <span className="status-badge">Queued</span>
                  <time>
                    {new Date(handoff.requestedAt).toLocaleTimeString()}
                  </time>
                </div>
                <h3>{handoff.employeeDisplayName}</h3>
                <p className="issue-copy">{handoff.issue}</p>
                <dl>
                  <div>
                    <dt>Application</dt>
                    <dd>{handoff.application ?? "Not identified"}</dd>
                  </div>
                  <div>
                    <dt>Visible error</dt>
                    <dd>{handoff.visibleError ?? "None in sanitized view"}</dd>
                  </div>
                  <div>
                    <dt>Ticket</dt>
                    <dd>{handoff.ticketId}</dd>
                  </div>
                  <div>
                    <dt>Consent</dt>
                    <dd>Human view granted</dd>
                  </div>
                </dl>
                <button onClick={() => void join(handoff.id)}>
                  Join and accept context
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Support console root is missing.");
createRoot(root).render(
  <StrictMode>
    <ConsoleApp />
  </StrictMode>,
);
