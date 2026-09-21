'use client';
import { dueText, modelLabel } from '../lib/format.js';

/** Shows what the NLU understood — the "how it works" moment of the demo. */
export default function Insight({ insight, today, s }) {
  if (!insight) return null;
  const { text, engine, model, ms, fallbackReason, summary } = insight;

  const rows = [
    ...summary.added.map((t) => ({
      kind: 'add',
      title: t.title,
      pills: [
        dueText(t, today, s),
        t.priority === 'high' ? s.high : t.priority === 'low' ? s.low : '',
        ...t.tags.map((x) => `#${x}`),
      ].filter(Boolean),
    })),
    ...summary.completed.map((t) => ({ kind: 'done', title: t.title, pills: [] })),
    ...summary.deleted.map((t) => ({ kind: 'del', title: t.title, pills: [] })),
    ...summary.missed.map((q) => ({ kind: 'miss', title: q || '—', pills: [] })),
  ];

  return (
    <div className="insight" aria-live="polite">
      <p className="insight-heard">
        <span>{s.heard}</span> “{text}”
      </p>
      {rows.length > 0 && (
        <ul className="insight-rows">
          {rows.map((r, i) => (
            <li key={i} className={`irow irow-${r.kind}`}>
              <span className="irow-verb">{s.verbs[r.kind]}</span>
              <span className="irow-title">{r.title}</span>
              {r.pills.map((p) => (
                <span key={p} className="pill">{p}</span>
              ))}
            </li>
          ))}
        </ul>
      )}
      <p className="insight-engine">
        <i className="engine-dot" data-engine={engine} />
        <span>{modelLabel(engine, model, s)}</span>
        {ms != null && <span>{ms} ms</span>}
        {fallbackReason && <span>{s.fallbackNote}</span>}
      </p>
    </div>
  );
}
