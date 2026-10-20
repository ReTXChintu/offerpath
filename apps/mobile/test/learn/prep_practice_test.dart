import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/prep_detail_page.dart';
import 'package:offerpath_mobile/learn/prep_practice_page.dart';
import 'package:offerpath_mobile/learn/voice.dart';
import 'package:offerpath_mobile/models/interview_prep.dart';
import 'package:offerpath_mobile/state/auth_controller.dart';
import 'package:offerpath_mobile/state/interview_prep_controller.dart';

import '../support/fake_api.dart';
import '../support/fakes.dart';
import '../support/prep_fixtures.dart';

const _answerPath = '/api/v1/interview-preps/p1/questions/q1/answer';

void main() {
  void tallScreen(WidgetTester tester) {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

  group('practice', () {
    Future<void> openPractice(WidgetTester tester, FakeApi fake, {VoiceInput? voice, ValueChanged<PrepQuestion>? onAnswered}) async {
      tallScreen(tester);
      await tester.pumpWidget(MaterialApp(
        home: PrepPracticePage(
          api: fake.client(),
          prepId: 'p1',
          question: PrepQuestion.fromJson(prepQuestionJson()),
          voice: voice ?? FakeVoiceInput(available: false),
          onAnswered: onAnswered,
        ),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets('typing an answer gets the score, covered, missed, feedback and key points; then answer again', (tester) async {
      final fake = FakeApi()..on('POST', _answerPath, FakeReply.ok(prepQuestionJson(score: 6.5, answer: 'When state or props change.')));
      PrepQuestion? told;
      await openPractice(tester, fake, onAnswered: (q) => told = q);

      expect(find.text('How does React decide when to re-render a component?'), findsOneWidget);
      expect(find.text('What a strong answer covers'), findsNothing, reason: 'key points only after an attempt');

      await tester.enterText(find.byType(TextField), 'When state or props change.');
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();

      expect(fake.requests.single.body, {'answer': 'When state or props change.'});
      expect(find.text('6.5/10'), findsOneWidget);
      expect(find.text('Good start; mention context consumers too.'), findsOneWidget);
      expect(find.text('COVERED'), findsOneWidget);
      expect(find.text('State or props change'), findsWidgets);
      expect(find.text('MISSED'), findsOneWidget);
      expect(find.text('Context change'), findsWidgets);
      expect(find.text('WHAT A STRONG ANSWER COVERS'), findsOneWidget);
      expect(told?.score, 6.5);

      await tester.tap(find.text('Answer again'));
      await tester.pumpAndSettle();
      expect(find.byType(TextField), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);

      fake.on('POST', _answerPath, FakeReply.ok(prepQuestionJson(score: 9, answer: 'Better.')));
      await tester.enterText(find.byType(TextField), 'Better.');
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
      expect(find.text('9/10'), findsOneWidget);
    });

    testWidgets('a spoken answer is sent as text', (tester) async {
      final fake = FakeApi()..on('POST', _answerPath, FakeReply.ok(prepQuestionJson(score: 7, answer: 'x')));
      await openPractice(tester, fake, voice: FakeVoiceInput(transcript: 'props and state changes'));
      expect(find.text('Dictation runs on your device. Only the text is sent.'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'React re-renders on');
      await tester.tap(find.byTooltip('Dictate your answer'));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, 'React re-renders on props and state changes');
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
      expect(fake.requests.single.body, {'answer': 'React re-renders on props and state changes'});
      expect(find.text('7/10'), findsOneWidget);
    });

    testWidgets('with no AI anywhere it says the laptop is offline and keeps the answer', (tester) async {
      final fake = FakeApi()..on('POST', _answerPath, FakeReply.problem(503, 'ai-unavailable', 'AI assistance unavailable'));
      await openPractice(tester, fake);
      await tester.enterText(find.byType(TextField), 'My careful answer.');
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
      expect(find.text("Your laptop is offline and no OpenAI key is saved: AI answers come back when it's on."), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, 'My careful answer.');
    });
  });

  group('prep screen', () {
    testWidgets('ready: summary, focus areas, schedule and questions by kind; practising updates progress', (tester) async {
      tallScreen(tester);
      final fake = FakeApi()
        ..on('GET', '/api/v1/interview-preps/p1', FakeReply.ok(prepJson()))
        ..on('POST', _answerPath, FakeReply.ok(prepQuestionJson(score: 8, answer: 'x')));
      await tester.pumpWidget(MaterialApp(home: PrepDetailPage(api: fake.client(), prepId: 'p1', voice: FakeVoiceInput(available: false))));
      await tester.pumpAndSettle();

      expect(find.text('Frontend developer at Acme'), findsOneWidget);
      expect(find.text('Expect React fundamentals and one system design round.'), findsOneWidget);
      expect(find.text('Rendering'), findsOneWidget);
      expect(find.text('Day 1'), findsOneWidget);
      expect(find.text('Re-read React rendering'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('TECHNICAL · 1'), 200);
      expect(find.text('TECHNICAL · 1'), findsOneWidget);
      expect(find.text('SYSTEM DESIGN · 1'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('BEHAVIOURAL · 1'), 200);
      expect(find.text('BEHAVIOURAL · 1'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('0 of 3 practised'), -200);
      expect(find.text('0 of 3 practised'), findsOneWidget);

      await tester.scrollUntilVisible(find.text('How does React decide when to re-render a component?'), 200);
      await tester.tap(find.text('How does React decide when to re-render a component?'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'x');
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('1 of 3 practised'), -200);
      expect(find.text('1 of 3 practised'), findsOneWidget);
      expect(find.text('8/10'), findsWidgets);
    });

    testWidgets('generating: polls until it is ready', (tester) async {
      tallScreen(tester);
      final fake = FakeApi()..on('GET', '/api/v1/interview-preps/p1', FakeReply.ok(prepJson(status: 'GENERATING')));
      await tester.pumpWidget(MaterialApp(home: PrepDetailPage(api: fake.client(), prepId: 'p1', pollEvery: const Duration(seconds: 2))));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Writing your plan and questions…'), findsOneWidget);

      fake.on('GET', '/api/v1/interview-preps/p1', FakeReply.ok(prepJson()));
      await tester.pump(const Duration(seconds: 2));
      await tester.pumpAndSettle();
      expect(find.text('Writing your plan and questions…'), findsNothing);
      expect(find.text('Expect React fundamentals and one system design round.'), findsOneWidget);
      expect(fake.requests.where((r) => r.path == '/api/v1/interview-preps/p1'), hasLength(2));
    });

    testWidgets("generating: the hub's changed frame refreshes it at once", (tester) async {
      tallScreen(tester);
      final fake = FakeApi()..on('GET', '/api/v1/interview-preps/p1', FakeReply.ok(prepJson(status: 'GENERATING')));
      final auth = AuthController();
      final connection = FakeConnectionController(auth);
      final preps = InterviewPrepController(auth, connection);
      await tester.pumpWidget(MaterialApp(home: PrepDetailPage(api: fake.client(), prepId: 'p1', preps: preps, pollEvery: const Duration(minutes: 5))));
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Writing your plan and questions…'), findsOneWidget);

      fake.on('GET', '/api/v1/interview-preps/p1', FakeReply.ok(prepJson()));
      connection.pushChanged(['interview_preps']);
      await tester.pumpAndSettle();
      expect(find.text('Expect React fundamentals and one system design round.'), findsOneWidget);
      expect(preps.items.single.isReady, isTrue, reason: 'the shared list is updated too');
    });

    testWidgets('failed: shows the error and tries again', (tester) async {
      tallScreen(tester);
      final fake = FakeApi()
        ..on('GET', '/api/v1/interview-preps/p1', FakeReply.ok(prepJson(status: 'FAILED', error: 'Your laptop is offline and no OpenAI fallback key is saved.')))
        ..on('POST', '/api/v1/interview-preps/p1/regenerate', FakeReply.ok(prepJson(status: 'GENERATING')));
      await tester.pumpWidget(MaterialApp(home: PrepDetailPage(api: fake.client(), prepId: 'p1', pollEvery: const Duration(minutes: 5))));
      await tester.pumpAndSettle();
      expect(find.text('Could not prepare this interview'), findsOneWidget);
      expect(find.text('Your laptop is offline and no OpenAI fallback key is saved.'), findsOneWidget);
      await tester.tap(find.text('Try again'));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 100));
      expect(fake.requests.last.path, '/api/v1/interview-preps/p1/regenerate');
      expect(find.text('Writing your plan and questions…'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('delete asks first, then removes it and closes', (tester) async {
      tallScreen(tester);
      final fake = FakeApi()
        ..on('GET', '/api/v1/interview-preps/p1', FakeReply.ok(prepJson()))
        ..on('DELETE', '/api/v1/interview-preps/p1', const FakeReply(204));
      await tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PrepDetailPage(api: fake.client(), prepId: 'p1'))),
              child: const Text('open'),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Delete'));
      await tester.pumpAndSettle();
      expect(find.text('Delete this prep?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();
      expect(fake.requests.last.method, 'DELETE');
      expect(find.byType(PrepDetailPage), findsNothing);
    });
  });
}
