import * as migration_20260819_010308_initial from './20260819_010308_initial';

export const migrations = [
  {
    up: migration_20260819_010308_initial.up,
    down: migration_20260819_010308_initial.down,
    name: '20260819_010308_initial'
  },
];
