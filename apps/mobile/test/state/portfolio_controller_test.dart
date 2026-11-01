import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/models/app_notification.dart';
import 'package:offerpath_mobile/models/portfolio.dart';
import 'package:offerpath_mobile/state/auth_controller.dart';
import 'package:offerpath_mobile/state/portfolio_controller.dart';

import '../support/fake_api.dart';
import '../support/fakes.dart';
import '../support/portfolio_fixtures.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakeApi fake;
  late PortfolioController c;
  late FakeConnectionController connection;
  late StreamController<AppNotification> pushes;

  Future<void> start(FakeApi api) async {
    fake = api;
    final auth = await signedInAuth(fake);
    // The connection runs signed out: no socket, only the frames a test pushes.
    connection = FakeConnectionController(AuthController());
    pushes = StreamController<AppNotification>.broadcast();
    c = PortfolioController(
      auth,
      connection: connection,
      pushes: pushes.stream,
    );
    await pumpEventQueue();
  }

  tearDown(() => pushes.close());

  int gets(String path) =>
      fake.requests.where((r) => r.method == 'GET' && r.path == path).length;

  test('signing in loads the overview and the inbox, not the items', () async {
    await start(
      portfolioApi(
        messages: [
          messageJson(),
          messageJson(id: 'm2', read: true, createdAt: '2026-10-22T00:00:00Z'),
        ],
      ),
    );
    expect(c.loadedOnce, isTrue);
    expect(c.notSetUp, isFalse);
    expect(c.overview!.handle, 'asha');
    expect(c.messages.map((m) => m.id), ['m1', 'm2']);
    expect(c.unread, 1);
    expect(c.drafts, 2, reason: 'from the overview until the items load');
    expect(gets('/api/v1/portfolio/projects'), 0);
  });

  test('no portfolio (404): not set up, and nothing else is fetched', () async {
    await start(portfolioApi(exists: false));
    expect(c.notSetUp, isTrue);
    expect(c.overview, isNull);
    expect(c.error, isNull);
    expect(c.messages, isEmpty);
    expect(c.unread, 0);
    expect(gets('/api/v1/portfolio/messages'), 0);
  });

  test(
    'opening a message marks it read; an already read one sends nothing',
    () async {
      await start(portfolioApi());
      fake.on(
        'PATCH',
        '/api/v1/portfolio/messages/m1',
        FakeReply.ok(messageJson(read: true)),
      );
      expect(await c.open('m1'), isNull);
      expect(c.message('m1')!.read, isTrue);
      expect(c.unread, 0);
      final patch = fake.requests.last;
      expect(patch.method, 'PATCH');
      expect(patch.path, '/api/v1/portfolio/messages/m1');
      expect(patch.body, {'read': true});

      final before = fake.requests.length;
      await c.open('m1');
      expect(fake.requests.length, before);
    },
  );

  test('marking read or unread puts it back when the server refuses', () async {
    await start(portfolioApi());
    fake.on(
      'PATCH',
      '/api/v1/portfolio/messages/m1',
      FakeReply.problem(500, 'internal', 'Server error'),
    );
    final err = await c.setRead('m1', true);
    expect(err, isNotNull);
    expect(c.message('m1')!.read, isFalse);
  });

  test('deleting a message removes it, and restores it on failure', () async {
    await start(
      portfolioApi(
        messages: [
          messageJson(),
          messageJson(id: 'm2'),
        ],
      ),
    );
    fake.on('DELETE', '/api/v1/portfolio/messages/m1', const FakeReply(204));
    expect(await c.deleteMessage('m1'), isNull);
    expect(c.messages.map((m) => m.id), ['m2']);
    expect(fake.requests.last.method, 'DELETE');

    expect(
      await c.deleteMessage('m2'),
      isNotNull,
      reason: 'not stubbed: a 404',
    );
    expect(c.messages.map((m) => m.id), ['m2']);
  });

  test(
    'publishing: a project with no image is refused without a request',
    () async {
      await start(portfolioApi());
      await c.loadItems();
      final project = c.items[PortfolioKind.projects]!.single;
      final before = fake.requests.length;
      expect(await c.setPublished(project, true), portfolioNeedsImageMessage);
      expect(fake.requests.length, before);
      expect(c.items[PortfolioKind.projects]!.single.published, isFalse);
    },
  );

  test(
    'publishing sends {published}, and a refusal puts the switch back',
    () async {
      await start(portfolioApi());
      await c.loadItems();
      expect(
        c.drafts,
        3,
        reason: 'counted from the lists: project, skill, tool',
      );
      fake.on(
        'PATCH',
        '/api/v1/portfolio/skills/s1',
        FakeReply.ok(skillJson(published: true)),
      );
      final skill = c.items[PortfolioKind.skills]!.single;
      expect(await c.setPublished(skill, true), isNull);
      expect(fake.requests.last.body, {'published': true});
      expect(c.items[PortfolioKind.skills]!.single.published, isTrue);
      expect(c.drafts, 2);

      fake.on(
        'PATCH',
        '/api/v1/portfolio/developer-tools/t1',
        FakeReply.problem(400, 'bad-request', 'Bad request', detail: 'Nope.'),
      );
      final tool = c.items[PortfolioKind.developerTools]!.single;
      expect(await c.setPublished(tool, true), 'Nope.');
      expect(c.items[PortfolioKind.developerTools]!.single.published, isFalse);
    },
  );

  test('drafts only hides published items, except ones just toggled', () async {
    await start(portfolioApi());
    await c.loadItems();
    expect(c.draftsOnly, isTrue, reason: 'on by default');
    expect(c.visible(PortfolioKind.experience), isEmpty);
    expect(c.visible(PortfolioKind.experience, keep: {'e1'}), hasLength(1));
    c.setDraftsOnly(false);
    expect(c.visible(PortfolioKind.experience), hasLength(1));
  });

  test(
    'a PORTFOLIO_MESSAGE notification (hub or Firebase) reloads the inbox',
    () async {
      await start(portfolioApi());
      expect(gets('/api/v1/portfolio/messages'), 1);
      fake.on(
        'GET',
        '/api/v1/portfolio/messages',
        FakeReply.ok({
          'items': [
            messageJson(id: 'm9', createdAt: '2026-10-23T09:00:00Z'),
            messageJson(),
          ],
        }),
      );

      connection.pushNotification(
        AppNotification.fromJson({
          'id': 'n1',
          'kind': 'PORTFOLIO_MESSAGE',
          'linkPage': 'portfolio-messages',
          'linkId': 'm9',
        }),
      );
      await pumpEventQueue();
      expect(gets('/api/v1/portfolio/messages'), 2);
      expect(c.messages.first.id, 'm9');
      expect(c.unread, 2);

      pushes.add(
        AppNotification.fromPushData({
          'kind': 'PORTFOLIO_MESSAGE',
          'linkPage': 'portfolio-messages',
          'linkId': 'm9',
        }),
      );
      await pumpEventQueue();
      expect(gets('/api/v1/portfolio/messages'), 3);

      connection.pushNotification(
        AppNotification.fromJson({'id': 'n2', 'kind': 'INTERVIEW_PREP_READY'}),
      );
      await pumpEventQueue();
      expect(
        gets('/api/v1/portfolio/messages'),
        3,
        reason: 'other kinds are not ours',
      );
    },
  );

  test(
    'a changed frame for the portfolio or the profile reloads; others do not',
    () async {
      await start(portfolioApi());
      await c.loadItems();
      expect(gets('/api/v1/portfolio'), 1);

      connection.pushChanged(['jobs']);
      await pumpEventQueue();
      expect(gets('/api/v1/portfolio'), 1);

      connection.pushChanged(['portfolio']);
      await pumpEventQueue();
      expect(gets('/api/v1/portfolio'), 2);
      expect(
        gets('/api/v1/portfolio/skills'),
        2,
        reason: 'the items too, once they were opened',
      );

      connection.pushChanged(['projects']);
      await pumpEventQueue();
      expect(
        gets('/api/v1/portfolio'),
        3,
        reason: 'profile projects arrive as drafts',
      );
    },
  );
}
