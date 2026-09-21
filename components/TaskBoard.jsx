'use client';
import { AnimatePresence, motion } from 'motion/react';
import { doneTasks, groupOpen } from '../lib/commands.js';
import { dueText } from '../lib/format.js';
import { IconCheck, IconTrash } from './Icons.jsx';

const GROUP_ORDER = ['overdue', 'today', 'tomorrow', 'later', 'someday'];

function Slip({ task, today, s, onToggle, onDelete }) {
  const due = dueText(task, today, s);
  const overdue = !task.done && task.dueDate && task.dueDate < today;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -28, transition: { duration: 0.16 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.8 }}
      className={`slip prio-${task.priority}${task.done ? ' is-done' : ''}`}
    >
      <button
        type="button"
        className="check"
        onClick={() => onToggle(task.id)}
        aria-label={`${task.done ? s.reopen : s.complete}: ${task.title}`}
        aria-pressed={task.done}
      >
        {task.done && <IconCheck width={16} height={16} />}
      </button>
      <div className="slip-body">
        <p className="slip-title">{task.title}</p>
        {(due || task.priority !== 'normal' || task.tags.length > 0) && (
          <p className="slip-meta">
            {due && <span className={overdue ? 'due is-overdue' : 'due'}>{due}</span>}
            {task.priority === 'high' && <span className="badge badge-high">{s.high}</span>}
            {task.priority === 'low' && <span className="badge badge-low">{s.low}</span>}
            {task.tags.map((tag) => (
              <span key={tag} className="tag">#{tag}</span>
            ))}
          </p>
        )}
      </div>
      <button type="button" className="slip-del" onClick={() => onDelete(task.id)} aria-label={`${s.remove}: ${task.title}`}>
        <IconTrash width={18} height={18} />
      </button>
    </motion.li>
  );
}

function SlipList({ tasks, ...rest }) {
  return (
    <ul className="slips">
      <AnimatePresence initial={false} mode="popLayout">
        {tasks.map((t) => (
          <Slip key={t.id} task={t} {...rest} />
        ))}
      </AnimatePresence>
    </ul>
  );
}

export default function TaskBoard({ tasks, today, tomorrow, tab, onTab, s, onToggle, onDelete, onClearDone }) {
  const groups = groupOpen(tasks, today, tomorrow);
  const done = doneTasks(tasks);
  const openCount = tasks.length - done.length;
  const todayOpen = groups.overdue.length + groups.today.length;
  const dueToday = tasks.filter((t) => t.dueDate === today);
  const dueTodayDone = dueToday.filter((t) => t.done).length;
  const rest = { today, s, onToggle, onDelete };

  const tabs = [
    ['open', s.tabs.open, openCount],
    ['today', s.tabs.today, todayOpen],
    ['done', s.tabs.done, done.length],
  ];

  let body;
  if (tab === 'done') {
    body = done.length ? (
      <>
        <SlipList tasks={done} {...rest} />
        <button type="button" className="ghost-btn" onClick={onClearDone}>{s.clearDone}</button>
      </>
    ) : (
      <p className="empty">{s.emptyDone}</p>
    );
  } else {
    const keys = tab === 'today' ? ['overdue', 'today'] : GROUP_ORDER;
    const visible = keys.filter((k) => groups[k].length);
    body = visible.length ? (
      visible.map((k) => (
        <section key={k} className="group" aria-label={s.groups[k]}>
          <h3 className={`group-title${k === 'overdue' ? ' is-hot' : ''}`}>
            {s.groups[k]}
            <span>{groups[k].length}</span>
          </h3>
          <SlipList tasks={groups[k]} {...rest} />
        </section>
      ))
    ) : (
      <p className="empty">{tab === 'today' ? s.emptyToday : s.emptyOpen}</p>
    );
  }

  return (
    <div className="board">
      <div className="board-head">
        <div className="tabs" role="tablist">
          {tabs.map(([id, label, count]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className="tab" onClick={() => onTab(id)}>
              {label}
              <span className="tab-count">{count}</span>
            </button>
          ))}
        </div>
        {dueToday.length > 0 && (
          <div className="progress" aria-label={s.progress(dueTodayDone, dueToday.length)}>
            <div className="progress-bar"><i style={{ width: `${(dueTodayDone / dueToday.length) * 100}%` }} /></div>
            <span>{s.progress(dueTodayDone, dueToday.length)}</span>
          </div>
        )}
      </div>
      {body}
    </div>
  );
}
