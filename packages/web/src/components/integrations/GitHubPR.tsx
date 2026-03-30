import type { Session, CheckRun } from "../../types";

function checkIcon(check: CheckRun): string {
  if (check.status !== "completed") return "\u25CB"; // pending circle
  if (check.conclusion === "success") return "\u2713"; // checkmark
  if (check.conclusion === "skipped" || check.conclusion === "neutral") return "\u2013"; // dash
  return "\u2717"; // x mark
}

function checkClass(check: CheckRun): string {
  if (check.status !== "completed") return "pending";
  if (check.conclusion === "success") return "success";
  if (check.conclusion === "skipped" || check.conclusion === "neutral") return "neutral";
  return "failure";
}

function stateLabel(state: string): string {
  switch (state) {
    case "merged": return "Merged";
    case "closed": return "Closed";
    default: return "Open";
  }
}

function reviewLabel(decision: string | null): string | null {
  switch (decision) {
    case "APPROVED": return "Approved";
    case "CHANGES_REQUESTED": return "Changes Requested";
    case "REVIEW_REQUIRED": return "Review Required";
    default: return null;
  }
}

interface Props {
  session: Session;
}

export function GitHubPR({ session }: Props) {
  if (!session.gitBranch) return null;

  const pr = session.pullRequest;

  if (!pr) {
    return (
      <div className="integration-stub">
        <div className="integration-stub-header">
          <h4>GitHub</h4>
        </div>
        <div className="placeholder">
          No PR found for <code>{session.gitBranch}</code>
        </div>
      </div>
    );
  }

  const passCount = pr.checks.filter(
    (c) => c.status === "completed" && c.conclusion === "success"
  ).length;
  const totalChecks = pr.checks.length;
  const review = reviewLabel(pr.reviewDecision);

  function handleRefresh() {
    fetch(`/api/sessions/${session.sessionId}/refresh-pr`, { method: "POST" });
  }

  return (
    <div className="pr-card">
      <div className="pr-card-header">
        <h4>GitHub</h4>
        <div className="pr-card-actions">
          <span className={`pr-state-badge ${pr.state}`}>{stateLabel(pr.state)}</span>
          <button className="pr-refresh-btn" onClick={handleRefresh} title="Refresh PR status">
            &#x21BB;
          </button>
        </div>
      </div>

      <a href={pr.url} target="_blank" rel="noopener noreferrer" className="pr-title">
        #{pr.number}: {pr.title}
      </a>

      {totalChecks > 0 && (
        <div className="pr-checks-section">
          <div className="pr-checks-summary">
            CI Checks &middot; {passCount}/{totalChecks} passing
          </div>
          <div className="pr-checks-grid">
            {pr.checks.map((check) => (
              <span key={check.name} className={`pr-check-item ${checkClass(check)}`}>
                <span className="pr-check-icon">{checkIcon(check)}</span>
                {check.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {review && (
        <div className={`pr-review ${pr.reviewDecision === "APPROVED" ? "approved" : pr.reviewDecision === "CHANGES_REQUESTED" ? "changes" : ""}`}>
          Review: {review}
        </div>
      )}
    </div>
  );
}
