import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/live_practice_list_page.dart';
import 'package:offerpath_mobile/learn/live/live_practice_page.dart';
import 'package:offerpath_mobile/learn/prep_detail_page.dart';
import 'package:offerpath_mobile/state/live_practice_controller.dart';

import '../support/fake_api.dart';
import '../support/fake_realtime.dart';
import '../support/live_fixtures.dart';
import '../support/prep_fixtures.dart';

const _base = '/api/v1/live-practice';
const _get = '$_base/s1';

Finder _rich(String text) => find.textContaining(text, findRichText: true);

void main() {
  late FakeLiveMic mic;
  late FakeConnector connector;
  late List<bool> wakelock;

  setUp(() {
    mic = FakeLiveMic();
    connector = FakeConnector();
    wakelock = [];
  });

  void tallScreen(WidgetTester tester) {
    tester.view.physicalSize = const Size(1080, 3200);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

  /// Lets requests and socket events through without waiting for spinners
  /// to stop.
  Future<void> flush(WidgetTester tester) async {
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
  }

  Future<void> open(WidgetTester tester, FakeApi fake) async {
    tallScreen(tester);
    await tester.pumpWidget(
      MaterialApp(
        home: LivePracticePage(
          api: fake.client(),
          sessionId: 's1',
          mic: mic,
          connect: connector.call,
          wakelock: (on) async => wakelock.add(on),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  FakeApi activeSession({List<Map<String, Object?>>? exchanges}) => FakeApi()
    ..on('GET', _get, FakeReply.ok(liveViewJson(exchanges: exchanges)))
    ..on('POST', '$_get/realtime', FakeReply.ok(realtimePassJson()))
    ..on('POST', '$_get/exchanges', FakeReply(201, liveExchangeJson(id: 'x9')));

  testWidgets(
    'listening shows the caption and a streaming answer card, then saves it; an error shows as a dismissible banner',
    (tester) async {
      final fake = activeSession();
      await open(tester, fake);

      expect(find.text('React, Node.js'), findsOneWidget);
      expect(find.text('Paused'), findsOneWidget);
      expect(find.text('QUESTIONS · 0'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('live-mic')));
      await flush(tester);
      expect(find.text('Listening'), findsOneWidget);
      expect(connector.headers.single, {'Authorization': 'Bearer ek_test1'});
      expect(wakelock, [true]);
      final socket = connector.last;

      socket.emit({'type': 'input_audio_buffer.speech_started'});
      await flush(tester);
      expect(find.text('Listening…'), findsOneWidget);
      socket
        ..emit({'type': 'input_audio_buffer.speech_stopped'})
        ..emit({'type': 'input_audio_buffer.committed', 'item_id': 'item_1'})
        ..emit({
          'type': 'conversation.item.input_audio_transcription.delta',
          'item_id': 'item_1',
          'delta': 'How do you reverse',
        });
      await flush(tester);
      expect(find.text('Thinking…'), findsOneWidget);
      expect(find.byKey(const ValueKey('live-caption')), findsOneWidget);
      expect(find.text('How do you reverse'), findsOneWidget);

      socket
        ..emit({
          'type': 'conversation.item.input_audio_transcription.completed',
          'item_id': 'item_1',
          'transcript': 'How do you reverse a list in Python?',
        })
        ..emit({
          'type': 'response.created',
          'response': {'id': 'resp_1'},
        })
        ..emit({
          'type': 'response.output_text.delta',
          'response_id': 'resp_1',
          'delta': 'I use slicing:\n\n```python\nitems[::-1]\n```',
        });
      await flush(tester);
      // The question shows in the caption and on its card.
      expect(
        find.text('How do you reverse a list in Python?'),
        findsNWidgets(2),
      );
      expect(_rich('I use slicing:'), findsOneWidget);
      expect(_rich('items[::-1]'), findsOneWidget);
      expect(find.text('Writing…'), findsOneWidget);
      expect(find.text('QUESTIONS · 1'), findsOneWidget);
      // No grading anywhere.
      expect(find.textContaining('/10'), findsNothing);
      expect(find.text('Reveal'), findsNothing);

      socket.emit({
        'type': 'response.done',
        'response': {'id': 'resp_1', 'status': 'completed'},
      });
      await flush(tester);
      expect(find.text('Writing…'), findsNothing);
      expect(
        fake.requests.where((r) => r.path == '$_get/exchanges').single.body,
        {
          'question': 'How do you reverse a list in Python?',
          'answer': 'I use slicing:\n\n```python\nitems[::-1]\n```',
        },
      );

      socket.emit({
        'type': 'error',
        'error': {
          'type': 'invalid_request_error',
          'message': "Unknown parameter: 'session.voice'.",
        },
      });
      await flush(tester);
      expect(find.byKey(const ValueKey('live-banner')), findsOneWidget);
      expect(find.text("Unknown parameter: 'session.voice'."), findsOneWidget);
      await tester.tap(find.bySemanticsLabel('Dismiss'));
      await flush(tester);
      expect(find.text("Unknown parameter: 'session.voice'."), findsNothing);

      await tester.tap(find.byKey(const ValueKey('live-mic')));
      await flush(tester);
      expect(find.text('Paused'), findsOneWidget);
      expect(mic.recording, isFalse);
      expect(wakelock, [true, false]);
    },
  );

  testWidgets('a "-" reply shows no card', (tester) async {
    final fake = activeSession();
    await open(tester, fake);
    await tester.tap(find.byKey(const ValueKey('live-mic')));
    await flush(tester);
    connector.last
      ..emit({'type': 'input_audio_buffer.committed', 'item_id': 'item_1'})
      ..emit({
        'type': 'conversation.item.input_audio_transcription.completed',
        'item_id': 'item_1',
        'transcript': 'Okay.',
      })
      ..emit({
        'type': 'response.created',
        'response': {'id': 'resp_1'},
      })
      ..emit({
        'type': 'response.output_text.delta',
        'response_id': 'resp_1',
        'delta': '-',
      })
      ..emit({
        'type': 'response.done',
        'response': {'id': 'resp_1', 'status': 'completed'},
      });
    await flush(tester);
    expect(find.text('QUESTIONS · 0'), findsOneWidget);
    expect(fake.requests.where((r) => r.path == '$_get/exchanges'), isEmpty);
  });

  testWidgets('a refused microphone says so', (tester) async {
    mic.permission = false;
    await open(tester, activeSession());
    await tester.tap(find.byKey(const ValueKey('live-mic')));
    await tester.pumpAndSettle();
    expect(find.text(liveMicDeniedMessage), findsOneWidget);
    expect(find.text('Paused'), findsOneWidget);
    expect(mic.starts, 0);
    expect(connector.urls, isEmpty);
  });

  testWidgets(
    'Answers for sends a PATCH; a typed question is asked; End session ends it and shows the saved answers',
    (tester) async {
      final fake = activeSession(exchanges: [liveExchangeJson()])
        ..on('PATCH', _get, FakeReply.ok(liveViewJson(answerFor: 'neutral')))
        ..on(
          'POST',
          '$_get/end',
          FakeReply.ok(
            liveViewJson(
              status: 'ENDED',
              answerFor: 'neutral',
              exchanges: [
                liveExchangeJson(),
                liveExchangeJson(
                  id: 'x2',
                  order: 1,
                  question: 'Typed question?',
                  answer: 'Typed answer.',
                  answerFor: 'neutral',
                ),
              ],
            ),
          ),
        );
      await open(tester, fake);
      // Saved earlier in this session.
      expect(find.text('What is a closure in JavaScript?'), findsOneWidget);
      expect(find.text('QUESTIONS · 1'), findsOneWidget);

      await tester.tap(find.text('Neutral'));
      await tester.pumpAndSettle();
      expect(fake.requests.last.method, 'PATCH');
      expect(fake.requests.last.body, {'answerFor': 'neutral'});

      await tester.enterText(find.byType(TextField), 'Typed question?');
      await tester.tap(find.byTooltip('Ask'));
      await flush(tester);
      expect(connector.last.sentTypes, [
        'conversation.item.create',
        'response.create',
      ]);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );

      await tester.tap(find.text('End session').first);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'End session'));
      await tester.pumpAndSettle();
      expect(fake.requests.last.path, '$_get/end');
      expect(connector.last.closed, isTrue);
      expect(find.text('Session ended'), findsOneWidget);
      expect(find.text('2 questions answered'), findsOneWidget);
      expect(find.text('Typed question?'), findsOneWidget);
      expect(_rich('Typed answer.'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
      expect(find.byKey(const ValueKey('live-mic')), findsNothing);
    },
  );

  testWidgets('a past session shows its saved answers, read-only', (
    tester,
  ) async {
    final fake = FakeApi()
      ..on(
        'GET',
        _get,
        FakeReply.ok(
          liveViewJson(
            status: 'ENDED',
            exchanges: [
              liveExchangeJson(),
              liveExchangeJson(
                id: 'x2',
                order: 1,
                question: 'Why React?',
                answer: '- Components\n- Hooks',
              ),
            ],
          ),
        ),
      );
    await open(tester, fake);
    expect(find.text('Session ended'), findsOneWidget);
    expect(find.text('QUESTIONS · 2'), findsOneWidget);
    expect(find.text('Why React?'), findsOneWidget);
    expect(_rich('Components'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
    expect(find.text('Answers for'), findsNothing);
    // Newest first.
    expect(
      tester.getTopLeft(find.text('Why React?')).dy,
      lessThan(
        tester.getTopLeft(find.text('What is a closure in JavaScript?')).dy,
      ),
    );
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
        expect(find.textContaining('/10'), findsNothing);

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
