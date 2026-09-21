import { createTaskService } from './tasksService.js';

// The database module is loaded lazily and can be replaced, which keeps the API routes testable
// without a real database (see test/routes.test.js).
let factory = async () => {
  const { getRepo } = await import('../../db/repo.js');
  return getRepo();
};

export function setRepoFactory(next) {
  factory = next;
}

export async function getService() {
  return createTaskService({ repo: await factory() });
}
