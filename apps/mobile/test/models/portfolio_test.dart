import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/models/portfolio.dart';

import '../support/portfolio_fixtures.dart';

void main() {
  test('the overview reads the handle, counts and settings', () {
    final o = PortfolioOverview.fromJson(portfolioViewJson());
    expect(o.handle, 'asha');
    expect(o.heroName, 'Asha Rao');
    expect(o.publicUrl, '/api/v1/public/portfolio/asha/site');
    expect(o.cloudinaryConfigured, isTrue);
    expect(o.counts.projects, 3);
    expect(o.counts.drafts, 2);
    expect(o.counts.unreadMessages, 1);
    expect(o.updatedAt, DateTime.utc(2026, 10, 22, 9));

    final empty = PortfolioOverview.fromJson({'counts': 'nope'});
    expect(empty.handle, '');
    expect(empty.counts.drafts, 0);
    expect(empty.cloudinaryConfigured, isFalse);
  });

  test('messages parse defensively and sort newest first', () {
    final m = PortfolioMessage.fromJson(messageJson());
    expect(m.id, 'm1');
    expect(m.name, 'Ravi Kumar');
    expect(m.email, 'ravi@example.com');
    expect(m.read, isFalse);
    expect(m.createdAt, DateTime.utc(2026, 10, 23, 8));
    expect(
      m.preview,
      'Hi Asha, loved the Offerpath project. Are you open to a contract role?',
      reason: 'one line',
    );
    expect(m.copyWith(read: true).read, isTrue);

    final odd = PortfolioMessage.fromJson({
      'id': 7,
      'read': 'true',
      'createdAt': 12,
    });
    expect(odd.id, '7');
    expect(odd.read, isTrue);
    expect(odd.name, '');
    expect(odd.createdAt, isNull);

    final sorted = sortMessagesNewest([
      PortfolioMessage.fromJson(
        messageJson(id: 'old', createdAt: '2026-10-01T00:00:00Z'),
      ),
      odd,
      PortfolioMessage.fromJson(
        messageJson(id: 'new', createdAt: '2026-10-22T00:00:00Z'),
      ),
    ]);
    expect(sorted.map((m) => m.id), ['new', 'old', '7']);
  });

  test(
    'items of every kind read a title, a line, published and the source',
    () {
      final project = PortfolioItem.fromJson(
        PortfolioKind.projects,
        projectJson(),
      );
      expect(project.title, 'Offerpath');
      expect(project.subtitle, startsWith('Finds jobs'));
      expect(project.published, isFalse);
      expect(project.fromProfile, isTrue);
      expect(project.source!.collection, 'projects');
      expect(project.source!.id, 'prof-1');
      expect(project.imageUrl, isNull);
      expect(project.publishBlockedReason, portfolioNeedsImageMessage);

      final withImage = PortfolioItem.fromJson(
        PortfolioKind.projects,
        projectJson(imageUrl: 'https://res.cloudinary.com/x.png', source: null),
      );
      expect(withImage.publishBlockedReason, isNull);
      expect(withImage.fromProfile, isFalse);
      expect(
        PortfolioItem.fromJson(
          PortfolioKind.projects,
          projectJson(imageUrl: ''),
        ).publishBlockedReason,
        isNotNull,
        reason: 'an empty url is no image',
      );

      final skill = PortfolioItem.fromJson(PortfolioKind.skills, skillJson());
      expect(skill.title, 'Frontend');
      expect(skill.subtitle, 'React, Flutter');
      expect(skill.source!.id, 'skills:frontend');
      expect(
        skill.publishBlockedReason,
        isNull,
        reason: 'only projects need an image',
      );

      final exp = PortfolioItem.fromJson(
        PortfolioKind.experience,
        experienceJson(),
      );
      expect(exp.title, 'Senior engineer');
      expect(exp.subtitle, 'Acme · Jan 2024 – Present');
      expect(exp.published, isTrue);
      expect(exp.source, isNull);

      final tool = PortfolioItem.fromJson(
        PortfolioKind.developerTools,
        toolJson(),
      );
      expect(tool.title, 'json-diff-cli');
      expect(tool.subtitle, 'Diff two JSON files in the terminal.');
      expect(tool.order, 2, reason: 'tools order by sortOrder');
      expect(tool.source, isNull, reason: 'tools have no source');

      final bare = PortfolioItem.fromJson(PortfolioKind.projects, {
        'id': 'x',
        'source': 'weird',
      });
      expect(bare.title, 'Untitled');
      expect(bare.source, isNull);
      expect(bare.published, isFalse);
    },
  );

  test('kinds map to their routes', () {
    expect(PortfolioKind.values.map((k) => k.path), [
      'projects',
      'skills',
      'experience',
      'developer-tools',
    ]);
  });
}
