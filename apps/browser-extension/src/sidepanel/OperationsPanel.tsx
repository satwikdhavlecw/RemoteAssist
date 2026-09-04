import { useState } from "react";
import type { SanitizedObservation } from "@remoteassist/shared-types";
import {
  createTicket,
  executeDiagnosticWorkflow,
  grantHumanScreenConsent,
  requestHumanHandoff,
} from "./api.js";

interface OperationsPanelProps {
  sessionId: string;
  issue: string;
  observation: SanitizedObservation;
}

export function OperationsPanel({
  sessionId,
  issue,
  observation,
}: OperationsPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "No backend workflow, ticket update, or human handoff has run.",
  );

  async function runDiagnostic(): Promise<void> {
    setBusy("workflow");
    try {
      const response = await executeDiagnosticWorkflow(
        sessionId,
        crypto.randomUUID(),
      );
      setMessage(
        `Diagnostic ${response.execution.verification}: ${JSON.stringify(response.execution.output)}`,
      );
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Diagnostic could not run.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveTicket(): Promise<void> {
    setBusy("ticket");
    try {
      const response = await createTicket(sessionId, issue);
      setMessage(`Ticket ${response.ticket.id} is ${response.ticket.state}.`);
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Ticket could not be saved.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handoff(): Promise<void> {
    setBusy("handoff");
    try {
      await grantHumanScreenConsent(sessionId, observation.origin);
      const response = await requestHumanHandoff(sessionId, issue);
      setMessage(
        `Human support requested. Queue ${response.handoff.id}; ticket ${response.handoff.ticketId}.`,
      );
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Handoff could not start.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card operations-card">
      <p className="section-label">Enterprise operations</p>
      <h2>Choose each action explicitly</h2>
      <p className="muted-copy" aria-live="polite">
        {message}
      </p>
      <div className="operation-list">
        <button
          className="secondary-button"
          onClick={() => void runDiagnostic()}
          disabled={busy !== null}
        >
          {busy === "workflow"
            ? "Running approved diagnostic…"
            : "Approve and run session diagnostic"}
        </button>
        <button
          className="secondary-button"
          onClick={() => void saveTicket()}
          disabled={busy !== null}
        >
          {busy === "ticket"
            ? "Saving ticket…"
            : "Create or update support ticket"}
        </button>
        <button
          className="handoff-button"
          onClick={() => void handoff()}
          disabled={busy !== null}
        >
          {busy === "handoff"
            ? "Requesting human support…"
            : "Request human engineer"}
        </button>
      </div>
      <p className="privacy-note">
        Human viewing is a separate consent. Passwords, tokens, and hidden
        fields remain excluded from the handoff context.
      </p>
    </section>
  );
}
