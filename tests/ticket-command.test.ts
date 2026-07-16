import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTicketCommand,
  TICKET_COMMAND_USAGE,
} from '../extensions/workflow-monitor/ticket-command.ts';

test('runtime help lists Ticket forms and claim-management restrictions', () => {
  for (const command of [
    '/addy-build --ticket <ticket-ref>',
    '/addy-auto --tickets --label <label>',
    '/addy-auto --tickets --status <status>',
    '/addy-stats --ticket <ticket-ref>',
    '/addy-ticket status <ticket-ref>',
    '/addy-ticket release <ticket-ref>',
    '/addy-ticket reclaim <ticket-ref>',
    '/addy-ticket add-repository <ticket-ref> <repository>',
  ])
    assert.match(
      TICKET_COMMAND_USAGE,
      new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  assert.match(TICKET_COMMAND_USAGE, /BUILD may create.*claim/i);
  assert.match(TICKET_COMMAND_USAGE, /same live claim/i);
});

test('preserves legacy positional lifecycle plan forms', () => {
  assert.deepEqual(parseTicketCommand('/addy-build', ['docs/plans/a b.md']), {
    kind: 'plan-lifecycle',
    command: '/addy-build',
    artifact: 'docs/plans/a b.md',
  });
  assert.deepEqual(parseTicketCommand('/addy-review', []), {
    kind: 'plan-lifecycle',
    command: '/addy-review',
  });
});

test('parses direct ticket lifecycle forms without treating refs as paths', () => {
  assert.deepEqual(parseTicketCommand('/addy-build', ['--ticket', 'ENG-42']), {
    kind: 'ticket-lifecycle',
    command: '/addy-build',
    ticketRef: 'ENG-42',
    claim: 'create',
  });
  for (const command of [
    '/addy-code-simplify',
    '/addy-verify',
    '/addy-review',
    '/addy-fix-all',
    '/addy-finish',
  ] as const) {
    assert.deepEqual(parseTicketCommand(command, ['--ticket', 'ENG-42']), {
      kind: 'ticket-lifecycle',
      command,
      ticketRef: 'ENG-42',
      claim: 'required',
    });
  }
  assert.equal(
    parseTicketCommand('/addy-build', ['--ticket', 'ENG-42', 'docs/plans/x.md'])
      .kind,
    'error',
  );
});

test('parses ticket queues strictly', () => {
  assert.deepEqual(parseTicketCommand('/addy-auto', ['--tickets']), {
    kind: 'ticket-queue',
    selector: { kind: 'default', value: 'unbound' },
  });
  for (const kind of ['label', 'status'] as const)
    assert.deepEqual(
      parseTicketCommand('/addy-auto', ['--tickets', `--${kind}`, 'backend']),
      {
        kind: 'ticket-queue',
        selector: { kind, value: 'backend' },
      },
    );
  for (const [command, args] of [
    ['/addy-auto', ['--label', 'backend']],
    ['/addy-auto', ['stop', '--tickets']],
    ['/addy-build', ['--tickets']],
    ['/addy-auto', ['--tickets', '--tickets']],
    ['/addy-auto', ['--tickets', '--unknown']],
    ['/addy-auto', ['--tickets', '--label', '--unknown']],
  ] as const)
    assert.equal(parseTicketCommand(command, [...args]).kind, 'error');
});

test('parses strict ticket management arity', () => {
  for (const operation of ['claim', 'status', 'release', 'reclaim'] as const)
    assert.deepEqual(
      parseTicketCommand('/addy-ticket', [operation, 'ENG-42']),
      {
        kind: 'ticket-management',
        operation,
        ticketRef: 'ENG-42',
      },
    );
  assert.deepEqual(
    parseTicketCommand('/addy-ticket', ['add-repository', 'ENG-42', '../repo']),
    {
      kind: 'ticket-management',
      operation: 'add-repository',
      ticketRef: 'ENG-42',
      repository: '../repo',
    },
  );
  assert.equal(parseTicketCommand('/addy-ticket', ['status']).kind, 'error');
  for (const args of [
    ['status', '--foo'],
    ['add-repository', '--foo', '../repo'],
    ['add-repository', 'ENG-42', '--bar'],
    ['status', 'ENG-42', '--unknown'],
  ])
    assert.equal(parseTicketCommand('/addy-ticket', args).kind, 'error');
});

test('parses ticket stats and rejects duplicate or unknown flags', () => {
  assert.deepEqual(parseTicketCommand('/addy-stats', ['--ticket', 'ENG-42']), {
    kind: 'ticket-stats',
    ticketRef: 'ENG-42',
  });
  assert.equal(
    parseTicketCommand('/addy-stats', ['--ticket', 'ENG-42', '--all']).kind,
    'error',
  );
  assert.equal(
    parseTicketCommand('/addy-verify', [
      '--ticket',
      'ENG-42',
      '--ticket',
      'ENG-43',
    ]).kind,
    'error',
  );
  for (const command of ['/addy-build', '/addy-stats'] as const)
    assert.equal(
      parseTicketCommand(command, ['--ticket', '--unknown']).kind,
      'error',
    );
});
