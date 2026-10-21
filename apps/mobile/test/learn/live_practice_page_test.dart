import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/live_practice_list_page.dart';
import 'package:offerpath_mobile/learn/live/live_practice_page.dart';
import 'package:offerpath_mobile/learn/live/segment_recorder.dart';
import 'package:offerpath_mobile/learn/prep_detail_page.dart';
import 'package:offerpath_mobile/state/live_practice_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import '../support/fake_mic.dart';
import '../support/live_fixtures.dart';
import '../support/prep_fixtures.dart';

const _base = '/api/v1/live-practice';
const _get = '$_base/s1';

Finder _rich(String text) => find.textContaining(text, findRichText: true);

void main() {
  late FakeMicRecorder mic;
  late List<bool> wakelock;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    mic = FakeMicRecorder();
    wakelock = [];
  });

  void tallScreen(WidgetTester tester) {
    tester.view.physicalSize = const Size(1080, 3200);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

  Future<void> open(
    WidgetTester tester,
    FakeApi fake, {
    bool settle = true,
  }) async {
    tallScreen(tester);
    await tester.pumpWidget(
      MaterialApp(
        home: LivePracticePage(
          api: fake.client(),
          sessionId: 's1',
          recorder: SegmentRecorder(recorder: mic),
          wakelock: (on) async => wakelock.add(on),
          pollEvery: const Duration(minutes: 5),
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
    'a question card shows the AI answer right away, with More for the detail',
    (tester) async {
      final fake = FakeApi()
        ..on(
          'GET',
          _get,
          FakeReply.ok(liveViewJson(questions: [liveQuestionJson()])),
        );
      await open(tester, fake);

      expect(find.text('React, Node.js'), findsOneWidget);
      expect(find.text('Paused'), findsOneWidget);
      expect(find.text('QUESTIONS · 1'), findsOneWidget);
      expect(find.text('What is a closure in JavaScript?'), findsOneWidget);
      expect(
        find.text(
          'A function bundled with the variables of the scope it was created in.',
        ),
        findsOneWidget,
      );
      expect(find.text('Used for private state'), findsOneWidget);
      expect(find.text('Waiting for the answer…'), findsOneWidget);
      expect(find.text('Grade now'), findsNothing);
      expect(find.text('Reveal'), findsNothing);

      expect(_rich('A counter made with'), findsNothing);
      await tester.tap(find.text('More'));
      await tester.pumpAndSettle();
      expect(_rich('A counter made with'), findsOneWidget);
    },
  );

  testWidgets(
    '"After the answer" hides the AI answer behind Reveal until it was answered and moved on',
    (tester) async {
      SharedPreferences.setMockInitialValues({liveRevealAfterKey: true});
      final fake = FakeApi()
        ..on(
          'GET',
          _get,
          FakeReply.ok(
            liveViewJson(
              questions: [
                // Answered, and the next question was asked: unlocked.
                liveQuestionJson(
                  id: 'q1',
                  order: 0,
                  text: 'First question?',
                  spokenAnswer: 'My first answer.',
                ),
                liveQuestionJson(id: 'q2', order: 1, text: 'Second question?'),
              ],
            ),
          ),
        );
      await open(tester, fake);

      // One summary visible (q1), one hidden (q2).
      expect(
        find.text(
          'A function bundled with the variables of the scope it was created in.',
        ),
        findsOneWidget,
      );
      expect(find.text('Reveal'), findsOneWidget);
      expect(
        find.text('AI answer hidden until the question is answered'),
        findsOneWidget,
      );

      await tester.tap(find.text('Reveal'));
      await tester.pumpAndSettle();
      expect(find.text('Reveal'), findsNothing);
      expect(
        find.text(
          'A function bundled with the variables of the scope it was created in.',
        ),
        findsNWidgets(2),
      );

      // Switching back to "Right away" is remembered on the phone.
      await tester.tap(find.text('Right away'));
      await tester.pumpAndSettle();
      expect(
        (await SharedPreferences.getInstance()).getBool(liveRevealAfterKey),
        isFalse,
      );
    },
  );

  testWidgets(
    'a graded answer shows its score, what was covered and missed, and the feedback',
    (tester) async {
      final fake = FakeApi()
        ..on(
          'GET',
          _get,
          FakeReply.ok(
            liveViewJson(
              questions: [
                liveQuestionJson(
                  spokenAnswer: 'It keeps the outer variables.',
                  score: 6.5,
                ),
              ],
            ),
          ),
        );
      await open(tester, fake);

      expect(find.text('It keeps the outer variables.'), findsOneWidget);
      expect(find.text('6.5/10'), findsOneWidget);
      expect(find.text('GRADE · 6.5/10'), findsOneWidget);
      expect(find.text('Clear, but give an example.'), findsOneWidget);
      // Covered appears as an AI point and as covered; missed likewise.
      expect(
        find.text('Inner functions keep access to outer variables'),
        findsNWidgets(2),
      );
      expect(find.byIcon(Icons.check_circle_outline), findsOneWidget);
      expect(find.byIcon(Icons.highlight_off), findsOneWidget);
      expect(find.text('Grade now'), findsNothing);
    },
  );

  testWidgets('Grade now calls the route and shows the grade', (tester) async {
    final fake = FakeApi()
      ..on(
        'GET',
        _get,
        FakeReply.ok(
          liveViewJson(
            questions: [liveQuestionJson(spokenAnswer: 'It keeps variables.')],
          ),
        ),
      )
      ..on(
        'POST',
        '$_get/questions/lq1/grade',
        FakeReply.ok(
          liveViewJson(
            questions: [
              liveQuestionJson(spokenAnswer: 'It keeps variables.', score: 8),
            ],
          ),
        ),
      );
    await open(tester, fake);

    await tester.tap(find.text('Grade now'));
    await tester.pumpAndSettle();
    expect(
      fake.requests.where((r) => r.method == 'POST').single.path,
      '$_get/questions/lq1/grade',
    );
    expect(find.text('8/10'), findsOneWidget);
    expect(find.text('Grade now'), findsNothing);
  });

  testWidgets('a question being graded shows a spinner', (tester) async {
    final fake = FakeApi()
      ..on(
        'GET',
        _get,
        FakeReply.ok(
          liveViewJson(
            questions: [liveQuestionJson(spokenAnswer: 'x', grading: true)],
          ),
        ),
      );
    await open(tester, fake, settle: false);
    expect(find.text('Grading…'), findsOneWidget);
    expect(find.text('Grade now'), findsNothing);
  });

  testWidgets('a refused microphone says so', (tester) async {
    mic.permission = false;
    final fake = FakeApi()..on('GET', _get, FakeReply.ok(liveViewJson()));
    await open(tester, fake);
    await tester.tap(find.byKey(const ValueKey('live-mic')));
    await tester.pumpAndSettle();
    expect(find.text(liveMicDeniedMessage), findsOneWidget);
    expect(find.text('Paused'), findsOneWidget);
    expect(mic.starts, 0);
  });

  testWidgets(
    'listening keeps the screen on, uploads segments, and a failed one is a small notice',
    (tester) async {
      final fake = FakeApi()..on('GET', _get, FakeReply.ok(liveViewJson()));
      var uploads = 0;
      fake.routes['POST $_base/s1/audio'] = (_) {
        uploads++;
        return uploads == 1
            ? FakeReply.problem(
                503,
                'ai-unavailable',
                'AI unavailable',
                detail: 'OpenAI timed out.',
              )
            : FakeReply.ok(
                liveViewJson(
                  questions: [
                    liveQuestionJson(text: 'Tell me about yourself.'),
                  ],
                ),
              );
      };
      await open(tester, fake);

      await tester.tap(find.byKey(const ValueKey('live-mic')));
      await tester.pumpAndSettle();
      expect(find.text('Listening'), findsOneWidget);
      expect(mic.starts, 1);
      expect(wakelock, [true]);

      Future<void> speak(int speech, int silence) async {
        for (var i = 0; i < speech + silence; i++) {
          mic.pushLevel(i < speech ? -20 : -70);
          // The real clock: let 100 ms pass per sample.
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 100)),
          );
          await tester.pump();
        }
      }

      await speak(5, 13);
      await tester.pumpAndSettle();
      expect(find.text('Missed a segment: OpenAI timed out.'), findsOneWidget);
      expect(find.text('Listening'), findsOneWidget);

      await speak(5, 13);
      await tester.pumpAndSettle();
      expect(uploads, 2);
      expect(find.text('Missed a segment: OpenAI timed out.'), findsNothing);
      expect(find.text('Tell me about yourself.'), findsOneWidget);
      final audio = fake.requests
          .where((r) => r.path.endsWith('/audio'))
          .toList();
      expect((audio.last.body as Map)['fileName'], 'segment.m4a');
      expect((audio.last.body as Map)['durationMs'], greaterThan(1500));

      await tester.tap(find.byKey(const ValueKey('live-mic')));
      await tester.pumpAndSettle();
      expect(find.text('Paused'), findsOneWidget);
      expect(mic.recording, isFalse);
      expect(wakelock, [true, false]);
    },
  );

  testWidgets(
    'Answers for sends a PATCH; typed text is sent; End session ends it and shows the summary',
    (tester) async {
      final fake = FakeApi()
        ..on('GET', _get, FakeReply.ok(liveViewJson()))
        ..on('PATCH', _get, FakeReply.ok(liveViewJson(answerFor: 'neutral')))
        ..on(
          'POST',
          '$_get/text',
          FakeReply.ok(
            liveViewJson(
              answerFor: 'neutral',
              questions: [liveQuestionJson(text: 'Typed question?')],
            ),
          ),
        )
        ..on(
          'POST',
          '$_get/end',
          FakeReply.ok(
            liveViewJson(
              status: 'ENDED',
              answerFor: 'neutral',
              averageScore: 7,
              questions: [
                liveQuestionJson(
                  text: 'Typed question?',
                  spokenAnswer: 'y',
                  score: 7,
                ),
              ],
            ),
          ),
        );
      await open(tester, fake);

      await tester.tap(find.text('Neutral'));
      await tester.pumpAndSettle();
      expect(fake.requests.last.method, 'PATCH');
      expect(fake.requests.last.body, {'answerFor': 'neutral'});

      await tester.enterText(find.byType(TextField), 'Typed question?');
      await tester.tap(find.byTooltip('Send'));
      await tester.pumpAndSettle();
      expect(fake.requests.last.path, '$_get/text');
      expect(fake.requests.last.body, {'text': 'Typed question?'});
      expect(find.text('Typed question?'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );

      await tester.tap(find.text('End session').first);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'End session'));
      await tester.pumpAndSettle();
      expect(fake.requests.last.path, '$_get/end');
      expect(find.text('Session ended'), findsOneWidget);
      expect(find.text('7/10'), findsWidgets);
      expect(find.byType(TextField), findsNothing);
    },
  );

  testWidgets('the transcript sheet lists every line', (tester) async {
    final fake = FakeApi()
      ..on(
        'GET',
        _get,
        FakeReply.ok(
          liveViewJson(
            lines: [
              liveLineJson(),
              liveLineJson(
                id: 'l2',
                order: 1,
                text: 'It keeps variables.',
                kind: 'ANSWER',
              ),
              liveLineJson(
                id: 'l3',
                order: 2,
                text: 'Okay.',
                kind: 'OTHER',
                questionId: null,
              ),
            ],
          ),
        ),
      );
    await open(tester, fake);
    await tester.tap(find.byTooltip('Transcript'));
    await tester.pumpAndSettle();
    expect(find.text('TRANSCRIPT'), findsOneWidget);
    expect(find.text('It keeps variables.'), findsOneWidget);
    expect(find.text('Okay.'), findsOneWidget);
    expect(find.text('QUESTION'), findsOneWidget);
  });

  group('entry points', () {
    testWidgets(
      'the Learn page lists sessions; a new one without a key says where to add it',
      (tester) async {
        tallScreen(tester);
        final fake = FakeApi()
          ..on(
            'GET',
            _base,
            FakeReply.ok({
              'sessions': [liveSummaryJson()],
            }),
          )
          ..on(
            'GET',
            '$_base/ready',
            const FakeReply.ok({
              'ready': false,
              'reason': 'No OpenAI key is saved.',
            }),
          );
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(body: LivePracticeListPage(api: fake.client())),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('React, Node.js'), findsOneWidget);
        expect(find.text('Ended'), findsOneWidget);
        expect(find.textContaining('3 questions'), findsOneWidget);
        expect(find.text('7.5/10'), findsOneWidget);

        await tester.tap(find.text('New live practice'));
        await tester.pumpAndSettle();
        expect(
          find.text('Live practice needs your OpenAI key'),
          findsOneWidget,
        );
        expect(find.textContaining('No OpenAI key is saved.'), findsOneWidget);
        expect(find.textContaining(liveOpenAiKeyHint), findsOneWidget);
        expect(
          tester
              .widget<FilledButton>(find.widgetWithText(FilledButton, 'Start'))
              .onPressed,
          isNull,
        );
        expect(fake.requests.where((r) => r.method == 'POST'), isEmpty);
      },
    );

    testWidgets(
      'the new-session sheet sends technologies, title and answerFor',
      (tester) async {
        tallScreen(tester);
        final fake = FakeApi()
          ..on('GET', _base, const FakeReply.ok({'sessions': []}))
          ..on(
            'GET',
            '$_base/ready',
            const FakeReply.ok({'ready': true, 'reason': null}),
          )
          ..on(
            'POST',
            _base,
            FakeReply(400, {
              'type': 'urn:offerpath:error:bad-request',
              'title': 'Bad request',
              'status': 400,
              'detail': 'Save your OpenAI key first.',
            }),
          );
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(body: LivePracticeListPage(api: fake.client())),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Practise with a partner'), findsOneWidget);

        await tester.tap(find.text('New live practice'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextField, 'Technologies'),
          'React, Go,',
        );
        await tester.pump();
        await tester.enterText(
          find.widgetWithText(TextField, 'Title'),
          'Evening round',
        );
        await tester.tap(find.text('Neutral'));
        await tester.pump();
        await tester.tap(find.text('Start'));
        await tester.pumpAndSettle();

        final post = fake.requests.lastWhere((r) => r.method == 'POST');
        expect(post.body, {
          'technologies': ['React', 'Go'],
          'title': 'Evening round',
          'answerFor': 'neutral',
        });
        // The API's refusal stays on the sheet.
        expect(find.text('Save your OpenAI key first.'), findsOneWidget);
      },
    );

    testWidgets(
      'the prep screen offers live practice, and checks for the key first',
      (tester) async {
        tallScreen(tester);
        final fake = FakeApi()
          ..on('GET', '/api/v1/interview-preps/p1', FakeReply.ok(prepJson()))
          ..on(
            'GET',
            '$_base/ready',
            const FakeReply.ok({
              'ready': false,
              'reason': 'No OpenAI key is saved.',
            }),
          );
        await tester.pumpWidget(
          MaterialApp(
            home: PrepDetailPage(api: fake.client(), prepId: 'p1'),
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.text('Practise live with a partner'));
        await tester.pumpAndSettle();
        expect(
          find.text('Live practice needs your OpenAI key'),
          findsOneWidget,
        );
        expect(find.textContaining(liveOpenAiKeyHint), findsOneWidget);
        expect(fake.requests.where((r) => r.method == 'POST'), isEmpty);
      },
    );
  });
}
