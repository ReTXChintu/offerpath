import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/mock_interview_page.dart';
import 'package:offerpath_mobile/learn/voice.dart';
import 'package:offerpath_mobile/models/interview_prep.dart';
import 'package:offerpath_mobile/state/auth_controller.dart';
import 'package:offerpath_mobile/state/interview_prep_controller.dart';

import '../support/fake_api.dart';
import '../support/fakes.dart';
import '../support/mock_fixtures.dart';
import '../support/prep_fixtures.dart';

const _get = '/api/v1/mock-interviews/m1';
const _answer = '/api/v1/mock-interviews/m1/answer';

Finder _rich(String text) => find.textContaining(text, findRichText: true);

/// The page's own list (code blocks and text fields scroll too).
Finder get _list => find.byType(Scrollable).first;

void main() {
  void tallScreen(WidgetTester tester) {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

  Future<void> open(
    WidgetTester tester,
    FakeApi fake, {
    VoiceInput? voice,
    InterviewPrepController? preps,
    Duration pollEvery = const Duration(minutes: 5),
    bool settle = true,
  }) async {
    tallScreen(tester);
    await tester.pumpWidget(
      MaterialApp(
        home: MockInterviewPage(
          api: fake.client(),
          interviewId: 'm1',
          title: 'Frontend developer at Acme',
          preps: preps,
          voice: voice ?? FakeVoiceInput(available: false),
          pollEvery: pollEvery,
        ),
      ),
    );
    if (settle) {
      await tester.pumpAndSettle();
    } else {
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  testWidgets(
    'shows the transcript: stages, both speakers, the coding problem and the language feedback',
    (tester) async {
      final fake = FakeApi()
        ..on('GET', _get, FakeReply.ok(mockInterviewJson()));
      await open(tester, fake);

      expect(find.text('Frontend developer at Acme'), findsOneWidget);
      expect(find.text('End interview'), findsOneWidget);
      for (final stage in ['Intro', 'Technical', 'Coding', 'Wrap-up']) {
        expect(find.text(stage), findsOneWidget);
      }

      // It opens scrolled to the newest turn.
      expect(find.text('Two Sum'), findsOneWidget);
      await tester.scrollUntilVisible(
        _rich('Tell me about yourself.'),
        -300,
        scrollable: _list,
      );
      expect(_rich('Tell me about yourself.'), findsOneWidget);
      expect(
        _rich('reconcile the virtual DOM'),
        findsOneWidget,
        reason: 'markdown bold rendered inline',
      );
      expect(
        find.text('I has five years of experience with React.'),
        findsOneWidget,
      );
      // The correction under the first answer: original -> corrected, and why.
      expect(_rich('I has → I have'), findsOneWidget);
      expect(
        find.text('Subject-verb agreement: "I" takes "have".'),
        findsOneWidget,
      );
      // Nothing to fix under the second.
      expect(find.text('Language looks good'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.text('• Exactly one solution exists'),
        300,
        scrollable: _list,
      );
      expect(find.text('CODING PROBLEM'), findsOneWidget);
      expect(find.text('Two Sum'), findsOneWidget);
      expect(
        find.text('Input: nums = [2,7,11,15], target = 9'),
        findsOneWidget,
      );
      expect(find.text('• Exactly one solution exists'), findsOneWidget);

      // A coding question: a code box and a language picker.
      expect(find.byKey(const ValueKey('mock-code')), findsOneWidget);
      expect(find.byType(DropdownButton<String>), findsOneWidget);
      // No scores while it's running.
      expect(find.textContaining('/10'), findsNothing);
    },
  );

  testWidgets(
    'an answer shows at once with "Interviewer is thinking…", then the next question and its language feedback',
    (tester) async {
      final intro = mockInterviewJson(
        stage: 'INTRO',
        turns: openingTurns().take(1).toList(),
      );
      final after = mockInterviewJson(
        stage: 'INTRO',
        turns: [
          ...openingTurns().take(2),
          turnJson(
            order: 2,
            speaker: 'INTERVIEWER',
            stage: 'INTRO',
            kind: 'FOLLOW_UP',
            text: 'Which project are you proudest of?',
          ),
        ],
      );
      final fake = FakeApi()
        ..on('GET', _get, FakeReply.ok(intro))
        ..on('POST', _answer, FakeReply.ok(after));
      await open(tester, fake);
      expect(
        find.byKey(const ValueKey('mock-code')),
        findsNothing,
        reason: 'not a coding question',
      );

      await tester.enterText(
        find.byKey(const ValueKey('mock-answer')),
        'I has five years of experience with React.',
      );
      fake.hold = Completer<void>();
      await tester.tap(find.text('Send'));
      await tester.pump();
      expect(find.text('Interviewer is thinking…'), findsOneWidget);
      expect(
        find.text('I has five years of experience with React.'),
        findsOneWidget,
        reason: 'the answer shows while waiting',
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('mock-answer')))
            .controller!
            .text,
        isEmpty,
      );

      fake.hold!.complete();
      fake.hold = null;
      await tester.pumpAndSettle();
      expect(fake.requests.singleWhere((r) => r.method == 'POST').body, {
        'text': 'I has five years of experience with React.',
      });
      expect(find.text('Interviewer is thinking…'), findsNothing);
      expect(_rich('Which project are you proudest of?'), findsOneWidget);
      expect(find.text('Interviewer · Follow-up'), findsOneWidget);
      expect(_rich('I has → I have'), findsOneWidget);
    },
  );

  testWidgets('a reply that fails keeps the answer and offers Retry', (
    tester,
  ) async {
    final intro = mockInterviewJson(
      stage: 'INTRO',
      turns: openingTurns().take(1).toList(),
    );
    final saved = mockInterviewJson(
      stage: 'INTRO',
      awaitingReply: true,
      turns: [
        ...openingTurns().take(1),
        turnJson(
          order: 1,
          speaker: 'CANDIDATE',
          stage: 'INTRO',
          kind: 'ANSWER',
          text: 'My answer.',
        ),
      ],
    );
    final fake = FakeApi()
      ..on('GET', _get, FakeReply.ok(intro))
      ..on(
        'POST',
        _answer,
        FakeReply.problem(503, 'ai-unavailable', 'AI assistance unavailable'),
      );
    await open(tester, fake);

    await tester.enterText(
      find.byKey(const ValueKey('mock-answer')),
      'My answer.',
    );
    fake.on('GET', _get, FakeReply.ok(saved));
    await tester.tap(find.text('Send'));
    await tester.pumpAndSettle();

    expect(find.text("The interviewer couldn't reply"), findsOneWidget);
    expect(find.text(prepAiOfflineMessage), findsOneWidget);
    expect(
      find.text('My answer.'),
      findsOneWidget,
      reason: 'saved, in the transcript',
    );
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('mock-answer')))
          .controller!
          .text,
      isEmpty,
      reason: 'saved: not put back',
    );
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('mock-answer')))
          .enabled,
      isFalse,
      reason: 'no new answer until the reply comes',
    );

    fake.on(
      'POST',
      '/api/v1/mock-interviews/m1/reply',
      FakeReply.ok(
        mockInterviewJson(
          stage: 'INTRO',
          turns: [
            ...openingTurns().take(1),
            turnJson(
              order: 1,
              speaker: 'CANDIDATE',
              stage: 'INTRO',
              kind: 'ANSWER',
              text: 'My answer.',
              language: {'ok': true, 'corrections': <Object?>[]},
            ),
            turnJson(
              order: 2,
              speaker: 'INTERVIEWER',
              stage: 'INTRO',
              kind: 'FOLLOW_UP',
              text: 'Tell me more.',
            ),
          ],
        ),
      ),
    );
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(fake.requests.last.path, '/api/v1/mock-interviews/m1/reply');
    expect(find.text("The interviewer couldn't reply"), findsNothing);
    expect(_rich('Tell me more.'), findsOneWidget);
    expect(find.text('Language looks good'), findsOneWidget);
  });

  testWidgets(
    'an answer that never reached the server is put back in the box',
    (tester) async {
      final fake = FakeApi()
        ..on(
          'GET',
          _get,
          FakeReply.ok(
            mockInterviewJson(
              stage: 'INTRO',
              turns: openingTurns().take(1).toList(),
            ),
          ),
        );
      await open(tester, fake);
      await tester.enterText(
        find.byKey(const ValueKey('mock-answer')),
        'Lost in the tunnel.',
      );
      fake.offline = true;
      await tester.tap(find.text('Send'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('mock-answer')))
            .controller!
            .text,
        'Lost in the tunnel.',
      );
      expect(
        find.textContaining("Couldn't reach the Offerpath server"),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'a coding answer sends the code and the language (guessed from the prep)',
    (tester) async {
      final fake = FakeApi()
        ..on('GET', _get, FakeReply.ok(mockInterviewJson()))
        ..on('POST', _answer, FakeReply.ok(mockInterviewJson()));
      // The prep's technologies are React and TypeScript.
      final preps = InterviewPrepController(
        AuthController(),
        FakeConnectionController(AuthController()),
      )..items = [Prep.fromJson(prepJson())];
      await open(tester, fake, preps: preps);

      expect(find.text('TypeScript'), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('mock-code')),
        'const twoSum = () => {};',
      );
      await tester.enterText(
        find.byKey(const ValueKey('mock-answer')),
        'One pass with a map.',
      );
      await tester.tap(find.text('Send'));
      await tester.pumpAndSettle();
      expect(fake.requests.singleWhere((r) => r.method == 'POST').body, {
        'text': 'One pass with a map.',
        'code': 'const twoSum = () => {};',
        'codeLanguage': 'typescript',
      });
    },
  );

  testWidgets('End interview asks first, then the report is written', (
    tester,
  ) async {
    final fake = FakeApi()
      ..on('GET', _get, FakeReply.ok(mockInterviewJson()))
      ..on(
        'POST',
        '/api/v1/mock-interviews/m1/finish',
        FakeReply.ok(mockInterviewJson(status: 'REPORTING')),
      );
    await open(tester, fake);
    await tester.tap(find.text('End interview'));
    await tester.pumpAndSettle();
    expect(find.text('End the interview?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'End interview'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(
      fake.requests.any((r) => r.path == '/api/v1/mock-interviews/m1/finish'),
      isTrue,
    );
    expect(find.text('Writing your report…'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('mock-answer')),
      findsNothing,
      reason: 'no composer once it has ended',
    );
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('reporting: polls every few seconds until the report is there', (
    tester,
  ) async {
    final fake = FakeApi()
      ..on('GET', _get, FakeReply.ok(mockInterviewJson(status: 'REPORTING')));
    await open(
      tester,
      fake,
      pollEvery: const Duration(seconds: 4),
      settle: false,
    );
    expect(find.text('Writing your report…'), findsOneWidget);

    fake.on('GET', _get, FakeReply.ok(mockInterviewJson(status: 'COMPLETED')));
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
    expect(find.text('Writing your report…'), findsNothing);
    expect(find.text('7.5/10'), findsOneWidget);
    expect(fake.requests.where((r) => r.path == _get), hasLength(2));
  });

  testWidgets('a failed report says why and tries again', (tester) async {
    final fake = FakeApi()
      ..on(
        'GET',
        _get,
        FakeReply.ok(
          mockInterviewJson(
            status: 'FAILED',
            error: 'The laptop went offline.',
          ),
        ),
      )
      ..on(
        'POST',
        '/api/v1/mock-interviews/m1/report',
        FakeReply.ok(mockInterviewJson(status: 'REPORTING')),
      );
    await open(tester, fake);
    expect(find.text('Could not write the report'), findsOneWidget);
    expect(find.text('The laptop went offline.'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(fake.requests.last.path, '/api/v1/mock-interviews/m1/report');
    expect(find.text('Writing your report…'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'the report: score, verdict, dimensions, then each question with my answer and a stronger one',
    (tester) async {
      final fake = FakeApi()
        ..on('GET', _get, FakeReply.ok(mockInterviewJson(status: 'COMPLETED')))
        ..on(
          'POST',
          '/api/v1/interview-preps/p1/mock-interviews',
          FakeReply.ok(
            mockInterviewJson(
              id: 'm2',
              stage: 'INTRO',
              turns: openingTurns().take(1).toList(),
            ),
          ),
        )
        ..on(
          'GET',
          '/api/v1/mock-interviews/m2',
          FakeReply.ok(
            mockInterviewJson(
              id: 'm2',
              stage: 'INTRO',
              turns: openingTurns().take(1).toList(),
            ),
          ),
        );
      await open(tester, fake);

      expect(find.text('7.5/10'), findsOneWidget);
      expect(find.text('Lean hire'), findsOneWidget);
      expect(
        find.text(
          'Solid React fundamentals and a clean coding round; go deeper on reconciliation.',
        ),
        findsOneWidget,
      );
      expect(find.text('Technical depth'), findsOneWidget);
      expect(find.text('Clean code'), findsOneWidget);
      expect(find.text('Read about keys and reconciliation'), findsOneWidget);
      expect(find.text('Subject-verb agreement'), findsOneWidget);

      await tester.scrollUntilVisible(find.text('Q1'), 300, scrollable: _list);
      expect(_rich('Tell me about yourself.'), findsOneWidget);
      expect(
        find.text('I has five years of experience with React.'),
        findsOneWidget,
      );
      expect(find.text('Correct'), findsOneWidget);
      expect(find.text('Clear, but short on specifics.'), findsOneWidget);
      expect(find.text('Confident.'), findsOneWidget);
      expect(find.text('Name a result you are proud of.'), findsOneWidget);
      expect(
        find.text('Lead with your current role and one measurable win.'),
        findsNothing,
        reason: 'collapsed',
      );
      await tester.ensureVisible(find.text('A stronger answer').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('A stronger answer').first);
      await tester.pumpAndSettle();
      expect(
        _rich('Lead with your current role and one measurable win.'),
        findsOneWidget,
      );

      await tester.scrollUntilVisible(find.text('Q3'), 300, scrollable: _list);
      expect(find.text('Strong'), findsOneWidget);
      expect(
        _rich('def two_sum'),
        findsOneWidget,
        reason: 'the code answer, in a code block',
      );

      await tester.scrollUntilVisible(
        find.text('Start a new mock interview'),
        300,
        scrollable: _list,
      );
      await tester.tap(find.text('Start a new mock interview'));
      await tester.pumpAndSettle();
      expect(fake.requests.singleWhere((r) => r.method == 'POST').body, {
        'restart': true,
      });
      expect(_rich('Tell me about yourself.'), findsOneWidget);
      expect(find.text('7.5/10'), findsNothing);
      expect(find.text('End interview'), findsOneWidget);
    },
  );

  testWidgets("the hub's changed frame refreshes a busy interview at once", (
    tester,
  ) async {
    final fake = FakeApi()
      ..on('GET', _get, FakeReply.ok(mockInterviewJson(status: 'REPORTING')));
    final auth = AuthController();
    final connection = FakeConnectionController(auth);
    final preps = InterviewPrepController(auth, connection);
    await open(tester, fake, preps: preps, settle: false);
    expect(find.text('Writing your report…'), findsOneWidget);

    fake.on('GET', _get, FakeReply.ok(mockInterviewJson(status: 'COMPLETED')));
    connection.pushChanged(['interview_preps']);
    await tester.pumpAndSettle();
    expect(find.text('7.5/10'), findsOneWidget);
  });
}
