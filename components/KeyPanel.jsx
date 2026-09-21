'use client';
import { useState } from 'react';

/** Bring-your-own-key box for Live mode. The key is kept in this browser only (see lib/store.js). */
export default function KeyPanel({ s, savedKey, serverHasKey, required, onSave, onClear }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const expanded = open || required;

  const submit = (e) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    onSave(v);
    setValue('');
    setOpen(false);
  };

  return (
    <div className="keybox">
      <button type="button" className="keybox-head" aria-expanded={expanded} onClick={() => setOpen((o) => !o)} disabled={required}>
        <span>{s.keyTitle}</span>
        <span className="keybox-state">{savedKey ? s.keySaved : serverHasKey ? '✓' : ''}</span>
      </button>
      {expanded && (
        <form className="keybox-body" onSubmit={submit}>
          <p>{s.keyHelp}</p>
          {serverHasKey && !savedKey && <p>{s.keyServer}</p>}
          <div className="keybox-row">
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={savedKey ? '••••••••••••' : s.keyPlaceholder}
              aria-label={s.keyTitle}
              autoComplete="off"
              spellCheck={false}
              maxLength={300}
            />
            <button type="submit" disabled={!value.trim()}>{s.keySave}</button>
            {savedKey && (
              <button type="button" className="keybox-remove" onClick={onClear}>{s.keyRemove}</button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
