import type { ProofRules, Verdict } from '@/core/shared';
import { Icon } from './symbol';

/** The proof checklist. With a verdict, each check shows whether it passed and why. */
export function RulesList({ rules, verdict }: { rules: ProofRules; verdict?: Verdict | null }) {
  return (
    <ul className="list">
      {rules.checks.map((check) => {
        const result = verdict?.checks.find((c) => c.checkId === check.id);
        return (
          <li key={check.id}>
            {result ? (
              <Icon
                name={result.passed ? 'check_circle' : 'cancel'}
                className={`filled ${result.passed ? 'pass' : 'fail'}`}
                label={result.passed ? 'Passed' : 'Not passed'}
              />
            ) : (
              // A plain marker, not a box or circle, so it does not look like something to tick.
              <span className="rule-marker" aria-hidden="true" />
            )}
            <div className="grow">
              <p>{check.description}</p>
              {result ? <p className="body-small muted">{result.reason}</p> : null}
              {!check.required ? <span className="optional-tag">Optional</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A verdict in full: confidence, every check, anything extra the checker flagged, and the code result. */
export function Findings({ rules, verdict }: { rules: ProofRules; verdict: Verdict }) {
  return (
    <>
      <div className="row spread wrap">
        <h2 className="title-large">What the check found</h2>
        <span className="chip">
          <Icon name="speed" className="small" />
          {Math.round(verdict.confidence * 100)}% confident
        </span>
      </div>
      <RulesList rules={rules} verdict={verdict} />
      {verdict.checks
        .filter((check) => !rules.checks.some((rule) => rule.id === check.checkId))
        .map((check) => (
          <div className={`banner${check.passed ? ' info' : ''}`} key={check.checkId}>
            <Icon name={check.passed ? 'verified' : 'gpp_maybe'} />
            <p className="body-small">{check.reason}</p>
          </div>
        ))}
      <p className="body-small muted row tight">
        <Icon name={verdict.codeFound ? 'check' : 'close'} className="small" />
        One-time code {verdict.codeFound ? 'found' : 'not found'} in the photo
      </p>
    </>
  );
}

