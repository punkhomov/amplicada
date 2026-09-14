import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { LifecycleImpl } from './lifecycle.js';
import { registerShutdown } from './shutdown.js';

test('app.close runs both phases, reverses module order and closes resources last, only once', async () => {
  const app = Fastify();
  const calls: string[] = [];
  const lifecycle = new LifecycleImpl();
  lifecycle.register({
    name: 'shutdown',
    phase: 'before',
    handler: () => {
      calls.push('before');
    },
  });
  lifecycle.register({
    name: 'shutdown',
    phase: 'after',
    handler: () => {
      calls.push('after');
    },
  });
  const modules = [
    {
      id: 'provider',
      stop() {
        calls.push(this.id);
      },
    },
    {
      id: 'consumer',
      async stop() {
        await Promise.resolve();
        calls.push(this.id);
      },
    },
    { id: 'no-stop' },
  ];
  registerShutdown(app, {
    lifecycle,
    modules,
    stopBackground: [
      {
        name: 'scheduler',
        run() {
          calls.push('scheduler');
        },
      },
    ],
    closeResources: [
      {
        name: 'database',
        run() {
          calls.push('database');
        },
      },
    ],
  });
  await app.ready();
  await app.close();
  await app.close();
  assert.deepEqual(calls, ['before', 'scheduler', 'consumer', 'provider', 'after', 'database']);
  assert.deepEqual(
    modules.map(mod => mod.id),
    ['provider', 'consumer', 'no-stop'],
  );
});

test('shutdown attempts every hook, module and resource despite synchronous and asynchronous failures', async () => {
  const app = Fastify();
  const calls: string[] = [];
  const lifecycle = new LifecycleImpl();
  for (const phase of ['before', 'after'] as const) {
    lifecycle.register({
      name: 'shutdown',
      phase,
      handler: () => {
        throw new Error(phase);
      },
    });
    lifecycle.register({
      name: 'shutdown',
      phase,
      handler: () => {
        calls.push(phase);
      },
    });
  }
  registerShutdown(app, {
    lifecycle,
    modules: [
      {
        id: 'provider',
        stop() {
          calls.push('provider');
        },
      },
      {
        id: 'consumer',
        async stop() {
          calls.push('consumer');
          throw new Error('consumer');
        },
      },
    ],
    stopBackground: [
      {
        name: 'scheduler',
        run() {
          calls.push('scheduler');
          throw new Error('scheduler');
        },
      },
      {
        name: 'heartbeat',
        run() {
          calls.push('heartbeat');
        },
      },
    ],
    closeResources: [
      {
        name: 'redis',
        async run() {
          calls.push('redis');
          throw new Error('redis');
        },
      },
      {
        name: 'database',
        run() {
          calls.push('database');
        },
      },
      {
        name: 'storage',
        run() {
          calls.push('storage');
        },
      },
    ],
  });
  await app.ready();
  await assert.rejects(app.close(), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 5);
    assert.deepEqual(
      error.errors.map((item: Error) => item.message),
      [
        'Shutdown step "shutdown:before" failed',
        'Shutdown step "scheduler" failed',
        'Shutdown step "module:consumer" failed',
        'Shutdown step "shutdown:after" failed',
        'Shutdown step "redis" failed',
      ],
    );
    return true;
  });
  assert.deepEqual(calls, ['before', 'scheduler', 'heartbeat', 'consumer', 'provider', 'after', 'redis', 'database', 'storage']);
});

test('lifecycle operations other than shutdown still fail fast and preserve phase and arguments', async () => {
  const lifecycle = new LifecycleImpl();
  const calls: unknown[] = [];
  const failure = new Error('init');
  lifecycle.register({
    name: 'init',
    phase: 'before',
    handler: value => {
      calls.push(value);
      throw failure;
    },
  });
  lifecycle.register({
    name: 'init',
    phase: 'before',
    handler: () => {
      calls.push('skipped');
    },
  });
  lifecycle.register({
    name: 'init',
    phase: 'after',
    handler: value => {
      calls.push(value);
    },
  });
  await assert.rejects(lifecycle.execute('init', 'before'), error => error === failure);
  assert.deepEqual(calls, ['before']);
  await lifecycle.executeAfter('init', 'after');
  assert.deepEqual(calls, ['before', 'after']);
});
