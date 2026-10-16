import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/concept_page.dart';
import 'package:offerpath_mobile/learn/models.dart';
import 'package:offerpath_mobile/learn/progress_page.dart';
import 'package:offerpath_mobile/learn/recall.dart';
import 'package:offerpath_mobile/learn/ui.dart';

import '../support/fake_api.dart';

const _offline = "Your desktop is offline: AI answers come back when it's on";

void main() {
  group('IndependenceCard (ported from ForgeRoutine)', () {
    Future<void> pump(WidgetTester tester, IndependenceScore score) => tester.pumpWidget(MaterialApp(home: Scaffold(body: IndependenceCard(score: score))));

    testWidgets('shows a dash, not 0%, when there is not enough evidence', (tester) async {
      await pump(tester, const IndependenceScore(score: null, status: 'INSUFFICIENT_DATA', attemptsConsidered: 2, windowDays: 30));
      expect(find.text('—'), findsOneWidget);
      expect(find.text('0%'), findsNothing);
      expect(find.text('2 of 5 attempts needed'), findsOneWidget);
    });

    testWidgets('shows the percentage once there is enough evidence', (tester) async {
      await pump(tester, const IndependenceScore(score: 0.78, status: 'OK', attemptsConsidered: 12, windowDays: 30));
      expect(find.text('78%'), findsOneWidget);
      expect(find.text('Last 30 days · 12 attempts'), findsOneWidget);
    });

    testWidgets('an improvement in the pass colour, a decline in the fail colour, no "+0.0"', (tester) async {
      await pump(tester, const IndependenceScore(score: 0.78, status: 'OK', attemptsConsidered: 12, windowDays: 30, deltaFromPreviousWindow: 12.0));
      expect(tester.widget<Text>(find.text('+12.0')).style?.color, LearnTone.pass);
      await pump(tester, const IndependenceScore(score: 0.5, status: 'OK', attemptsConsidered: 12, windowDays: 30, deltaFromPreviousWindow: -8.0));
      expect(find.text('-8.0'), findsOneWidget);
      await pump(tester, const IndependenceScore(score: 0.6, status: 'OK', attemptsConsidered: 9, windowDays: 30, deltaFromPreviousWindow: 0));
      expect(find.text('+0.0'), findsNothing);
    });
  });

  group('models', () {
    test('coding work goes to the desktop; review and learning stay on the phone', () {
      for (final kind in ['CODE', 'BLIND_CODE', 'DEBUG']) {
        expect(NextAction(kind: kind, title: 'x', rationale: 'y', estimatedMinutes: 20).requiresDesktop, isTrue, reason: kind);
      }
      for (final kind in ['REVIEW', 'LEARN', 'RECALL', 'INTERVIEW']) {
        expect(NextAction(kind: kind, title: 'x', rationale: 'y', estimatedMinutes: 10).requiresDesktop, isFalse, reason: kind);
      }
    });

    test('DashboardOverview survives a sparse payload', () {
      final overview = DashboardOverview.fromJson(const <String, dynamic>{});
      expect(overview.greeting, 'Hello.');
      expect(overview.independence.hasEnoughData, isFalse);
      expect(overview.nextAction, isNull);
    });

    test('the reading list is the roadmap concepts, in order, once each', () {
      final list = readingListFromRoadmap({
        'currentItemId': 'i2',
        'phases': [
          {
            'title': 'Basics',
            'items': [
              {'id': 'i1', 'conceptId': 'c1', 'title': 'Closures', 'status': 'DONE', 'estimatedMinutes': 10},
              {'id': 'i2', 'conceptId': 'c2', 'title': 'Promises', 'status': 'PENDING', 'estimatedMinutes': 15},
              {'id': 'i3', 'conceptId': 'c1', 'title': 'Closures again', 'status': 'PENDING'},
              {'id': 'i4', 'conceptId': null, 'title': 'Project', 'status': 'PENDING'},
            ],
          },
        ],
      });
      expect(list.map((i) => i.title), ['Closures', 'Promises']);
      expect(list.first.isDone, isTrue);
      expect(list[1].isCurrent, isTrue);
      expect(readingListFromRoadmap(null), isEmpty);
    });

    test('describeDue', () {
      final now = DateTime(2026, 10, 16, 12);
      expect(describeDue(now, now: now), 'today');
      expect(describeDue(now.add(const Duration(days: 1, hours: 1)), now: now), 'tomorrow');
      expect(describeDue(now.add(const Duration(days: 5, hours: 1)), now: now), 'in 5 days');
    });
  });

  group('RecallPage', () {
    testWidgets('one card at a time; the answer shows the explanation', (tester) async {
      final fake = FakeApi()
        ..on('GET', '/api/v1/recall/due', const FakeReply.ok([
          {'id': 'r1', 'conceptId': 'c1', 'conceptName': 'Closures', 'technologyName': 'JavaScript', 'prompt': 'What does a closure capture?', 'options': ['Values', 'Bindings']},
        ]))
        ..on('POST', '/api/v1/recall/answer', FakeReply.ok({'correct': true, 'correctIndex': 1, 'explanation': 'Variables, not copies.', 'nextDueAt': DateTime.now().add(const Duration(days: 4, hours: 1)).toIso8601String()}));
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: RecallPage(api: fake.client()))));
      await tester.pumpAndSettle();
      expect(find.text('Card 1 of 1'), findsOneWidget);
      expect(find.text('Variables, not copies.'), findsNothing);
      await tester.tap(find.text('Bindings'));
      await tester.pumpAndSettle();
      expect(fake.requests.last.body, {'questionId': 'r1', 'selectedIndex': 1});
      expect(find.text('Variables, not copies.'), findsOneWidget);
      await tester.tap(find.text('Finish'));
      await tester.pumpAndSettle();
      expect(find.text('Reviews done'), findsOneWidget);
    });

    testWidgets('nothing due says so', (tester) async {
      final fake = FakeApi()..on('GET', '/api/v1/recall/due', const FakeReply.ok([]));
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: RecallPage(api: fake.client()))));
      await tester.pumpAndSettle();
      expect(find.text('Nothing due'), findsOneWidget);
    });
  });

  group('ConceptPage', () {
    FakeApi concept() => FakeApi()
      ..on('GET', '/api/v1/concepts/c1', const FakeReply.ok({'id': 'c1', 'name': 'Closures', 'technologyName': 'JavaScript', 'description': 'Functions that remember.', 'learningObjectives': ['Explain capture'], 'commonMistakes': []}))
      ..on('GET', '/api/v1/concepts/c1/chat', const FakeReply.ok([]));

    testWidgets('shows the explanation and the tutor answer', (tester) async {
      final fake = concept()
        ..on('GET', '/api/v1/concepts/c1/explainer', const FakeReply.ok({'summary': 'A closure keeps its scope alive.', 'realWorld': '', 'examples': [], 'pitfalls': ['Loops and var'], 'available': true}))
        ..on('POST', '/api/v1/concepts/c1/chat', const FakeReply.ok([
          {'id': 'm1', 'role': 'user', 'content': 'Why var?', 'createdAt': ''},
          {'id': 'm2', 'role': 'assistant', 'content': 'var is function-scoped.', 'createdAt': ''},
        ]));
      await tester.pumpWidget(MaterialApp(home: ConceptPage(api: fake.client(), conceptId: 'c1')));
      await tester.pumpAndSettle();
      expect(find.text('A closure keeps its scope alive.'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'Why var?');
      await tester.tap(find.byTooltip('Ask'));
      await tester.pumpAndSettle();
      expect(find.text('var is function-scoped.'), findsOneWidget);
      expect(fake.requests.last.body, {'question': 'Why var?'});
    });

    testWidgets('with the desktop off, says so and keeps the question', (tester) async {
      final fake = concept()
        ..on('GET', '/api/v1/concepts/c1/explainer', FakeReply.problem(503, 'ai-unavailable', 'AI assistance unavailable'))
        ..on('POST', '/api/v1/concepts/c1/chat', FakeReply.problem(503, 'ai-unavailable', 'AI assistance unavailable'));
      await tester.pumpWidget(MaterialApp(home: ConceptPage(api: fake.client(), conceptId: 'c1')));
      await tester.pumpAndSettle();
      // The concept itself still reads; only the AI parts wait.
      expect(find.text('Functions that remember.'), findsOneWidget);
      expect(find.text(_offline), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'Why var?');
      await tester.tap(find.byTooltip('Ask'));
      await tester.pumpAndSettle();
      expect(find.text(_offline), findsNWidgets(2));
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, 'Why var?');
    });
  });
}
