import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/models/portfolio.dart';
import 'package:offerpath_mobile/services/api_client.dart';

import '../support/fake_api.dart';
import '../support/portfolio_fixtures.dart';

void main() {
  group('portfolio calls', () {
    test('GET /portfolio reads the overview, with the device token', () async {
      final fake = FakeApi()
        ..on('GET', '/api/v1/portfolio', FakeReply.ok(portfolioViewJson()));
      final o = await fake.client(token: 'tok').getPortfolio();
      expect(o!.handle, 'asha');
      expect(fake.requests.single.method, 'GET');
      expect(fake.requests.single.path, '/api/v1/portfolio');
      expect(fake.requests.single.headers['Authorization'], 'Bearer tok');
    });

    test('no portfolio yet (404) is null; other failures throw', () async {
      final fake = FakeApi();
      expect(await fake.client().getPortfolio(), isNull);

      fake.on(
        'GET',
        '/api/v1/portfolio',
        FakeReply.problem(500, 'internal', 'Server error'),
      );
      await expectLater(
        fake.client().getPortfolio(),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 500)),
      );
    });

    test('messages: list newest first, mark read or unread, delete', () async {
      final fake = FakeApi()
        ..on(
          'GET',
          '/api/v1/portfolio/messages',
          FakeReply.ok({
            'items': [
              messageJson(id: 'old', createdAt: '2026-10-01T00:00:00Z'),
              messageJson(id: 'new', createdAt: '2026-10-22T00:00:00Z'),
            ],
          }),
        )
        ..on(
          'PATCH',
          '/api/v1/portfolio/messages/m1',
          FakeReply.ok(messageJson(id: 'm1', read: true)),
        )
        ..on('DELETE', '/api/v1/portfolio/messages/m1', const FakeReply(204));
      final api = fake.client();

      final list = await api.listPortfolioMessages();
      expect(list.map((m) => m.id), ['new', 'old']);

      final read = await api.setPortfolioMessageRead('m1', true);
      expect(read.read, isTrue);
      final patch = fake.requests.last;
      expect(patch.method, 'PATCH');
      expect(patch.path, '/api/v1/portfolio/messages/m1');
      expect(patch.body, {'read': true});

      await api.setPortfolioMessageRead('m1', false);
      expect(fake.requests.last.body, {'read': false});

      await api.deletePortfolioMessage('m1');
      expect(fake.requests.last.method, 'DELETE');
      expect(fake.requests.last.path, '/api/v1/portfolio/messages/m1');
    });

    test('items: each kind lists from its own route', () async {
      final fake = FakeApi()
        ..on(
          'GET',
          '/api/v1/portfolio/projects',
          FakeReply.ok({
            'items': [projectJson()],
          }),
        )
        ..on(
          'GET',
          '/api/v1/portfolio/skills',
          FakeReply.ok({
            'items': [skillJson()],
          }),
        )
        ..on(
          'GET',
          '/api/v1/portfolio/experience',
          FakeReply.ok({
            'items': [experienceJson()],
          }),
        )
        ..on(
          'GET',
          '/api/v1/portfolio/developer-tools',
          FakeReply.ok({
            'items': [toolJson(), 'junk'],
          }),
        );
      final api = fake.client();
      for (final kind in PortfolioKind.values) {
        final items = await api.listPortfolioItems(kind);
        expect(
          items,
          hasLength(1),
          reason: '${kind.path}: odd rows are skipped',
        );
        expect(items.single.kind, kind);
        expect(fake.requests.last.path, '/api/v1/portfolio/${kind.path}');
      }
    });

    test(
      'publishing sends {published} to the item, and a 400 says why',
      () async {
        final fake = FakeApi()
          ..on(
            'PATCH',
            '/api/v1/portfolio/skills/s1',
            FakeReply.ok(skillJson(published: true)),
          )
          ..on(
            'PATCH',
            '/api/v1/portfolio/projects/pr1',
            FakeReply.problem(
              400,
              'bad-request',
              'Bad request',
              detail: 'A project needs an image before it can be published.',
            ),
          );
        final api = fake.client();

        final skill = await api.setPortfolioItemPublished(
          PortfolioKind.skills,
          's1',
          true,
        );
        expect(skill.published, isTrue);
        expect(fake.requests.last.method, 'PATCH');
        expect(fake.requests.last.body, {'published': true});

        await expectLater(
          api.setPortfolioItemPublished(PortfolioKind.projects, 'pr1', true),
          throwsA(
            isA<ApiException>().having(
              (e) => e.message,
              'message',
              'A project needs an image before it can be published.',
            ),
          ),
        );
        expect(fake.requests.last.path, '/api/v1/portfolio/projects/pr1');
      },
    );
  });
}
