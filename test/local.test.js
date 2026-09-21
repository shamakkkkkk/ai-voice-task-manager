import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommandLocal } from '../lib/nlu/local.js';

// Friday, 18 Sep 2026, 14:20
const ctx = { today: '2026-09-18', now: '14:20' };
const tasks = [
  { id: 'milk', title: 'Купить молоко', createdAt: 1 },
  { id: 'deck', title: 'Подготовить презентацию', createdAt: 2 },
  { id: 'mom', title: 'Call mom', createdAt: 3 },
];
const add = (text) => parseCommandLocal({ text, ...ctx, tasks });
const pick = ({ title, dueDate, dueTime, priority, tags }) => ({ title, dueDate, dueTime, priority, tags });

test('russian: tomorrow + evening time', () => {
  const [a] = add('Напомни позвонить маме завтра в 5 вечера');
  assert.deepEqual(pick(a), { title: 'Позвонить маме', dueDate: '2026-09-19', dueTime: '17:00', priority: 'normal', tags: [] });
});

test('russian: part of day + priority', () => {
  const [a] = add('Купить молоко сегодня вечером срочно');
  assert.deepEqual(pick(a), { title: 'Купить молоко', dueDate: '2026-09-18', dueTime: '19:00', priority: 'high', tags: [] });
});

test('russian: two tasks in one phrase, weekday and calendar date', () => {
  const list = add('Добавь задачу подготовить презентацию в понедельник в 10:30 и еще оплатить интернет до 25 сентября');
  assert.equal(list.length, 2);
  assert.deepEqual(pick(list[0]), { title: 'Подготовить презентацию', dueDate: '2026-09-21', dueTime: '10:30', priority: 'normal', tags: [] });
  assert.deepEqual(pick(list[1]), { title: 'Оплатить интернет', dueDate: '2026-09-25', dueTime: null, priority: 'normal', tags: [] });
});

test('russian: relative duration in hours', () => {
  const [a] = add('через 2 часа выпить воду');
  assert.equal(a.title, 'Выпить воду');
  assert.equal(a.dueDate, '2026-09-18');
  assert.equal(a.dueTime, '16:20');
});

test('russian: "через неделю" and number words', () => {
  assert.equal(add('Записаться на стрижку через неделю')[0].dueDate, '2026-09-25');
  assert.equal(add('позвонить бабушке в восемь вечера')[0].dueTime, '20:00');
});

test('russian: hashtag, month name, "9 утра"', () => {
  const [a] = add('позвонить врачу 15 октября в 9 утра #здоровье');
  assert.deepEqual(pick(a), { title: 'Позвонить врачу', dueDate: '2026-10-15', dueTime: '09:00', priority: 'normal', tags: ['здоровье'] });
});

test('russian: keeps ё and number words that belong to the title', () => {
  assert.equal(add('Отправить отчёт в пятницу')[0].title, 'Отправить отчёт');
  assert.equal(add('купить три яблока')[0].title, 'Купить три яблока');
});

test('russian: low priority and morning', () => {
  const [a] = add('сделать зарядку утром не срочно');
  assert.deepEqual(pick(a), { title: 'Сделать зарядку', dueDate: '2026-09-19', dueTime: '09:00', priority: 'low', tags: [] });
});

test('russian: sentence split and weekend', () => {
  const list = add('В пятницу отправить отчёт. Потом забронировать столик на выходных');
  assert.equal(list.length, 2);
  assert.equal(list[0].dueDate, '2026-09-25');
  assert.equal(list[1].title, 'Забронировать столик');
  assert.equal(list[1].dueDate, '2026-09-19'); // Saturday
});

test('english: next friday, 3pm, urgent', () => {
  const [a] = add('remind me to send the report next friday at 3pm urgent');
  assert.deepEqual(pick(a), { title: 'Send the report', dueDate: '2026-09-25', dueTime: '15:00', priority: 'high', tags: [] });
});

test('english: one task with "and" is not split', () => {
  const list = add('buy milk and eggs tomorrow');
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Buy milk and eggs');
});

test('english: date with year rollover and noon', () => {
  const [a] = add('meeting with Anna on 1 January at noon');
  assert.equal(a.dueDate, '2027-01-01');
  assert.equal(a.dueTime, '12:00');
});

test('time without a date: later today, or tomorrow if already passed', () => {
  assert.equal(add('позвонить бабушке в 8 вечера')[0].dueDate, '2026-09-18');
  assert.equal(add('позвонить бабушке в 9 утра')[0].dueDate, '2026-09-19');
});

test('"in 30 minutes" and "in a week"', () => {
  const [a] = add('stretch in 30 minutes');
  assert.equal(a.dueTime, '14:50');
  assert.equal(add('renew passport in a week')[0].dueDate, '2026-09-25');
});

test('complete: russian imperative and english "mark … done"', () => {
  const [a] = add('отметь купить молоко выполненной');
  assert.equal(a.type, 'complete');
  assert.equal(a.taskId, 'milk');
  const [b] = add('mark call mom as done');
  assert.equal(b.type, 'complete');
  assert.equal(b.taskId, 'mom');
});

test('delete: matches inflected words', () => {
  const [a] = add('удали задачу про презентацию');
  assert.equal(a.type, 'delete');
  assert.equal(a.taskId, 'deck');
});

test('ambiguous english verbs become tasks unless they match an existing one', () => {
  assert.equal(add('delete old files')[0].type, 'add');
  assert.equal(add('delete call mom')[0].type, 'delete');
});

test('unknown target keeps the query so the UI can say "not found"', () => {
  const [a] = add('удали задачу про самолёт');
  assert.equal(a.type, 'delete');
  assert.equal(a.taskId, null);
  assert.match(a.query, /самолёт/);
});

test('garbage in, nothing out', () => {
  assert.deepEqual(add('   '), []);
  assert.deepEqual(add('...'), []);
});

test('"and" splits only before a new command verb', () => {
  const list = add('buy milk tomorrow at 9am and delete call mom');
  assert.deepEqual(list.map((a) => a.type), ['add', 'delete']);
  assert.equal(list[1].taskId, 'mom');
  const ru = add('позвонить маме завтра и отметь купить молоко выполненной');
  assert.deepEqual(ru.map((a) => a.type), ['add', 'complete']);
});
