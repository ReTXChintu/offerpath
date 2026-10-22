import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/live_practice_list_page.dart';
import 'package:offerpath_mobile/learn/live/live_practice_page.dart';
import 'package:offerpath_mobile/learn/live/voice_repository.dart';
import 'package:offerpath_mobile/learn/live/voice_setup_page.dart';
import 'package:offerpath_mobile/learn/prep_detail_page.dart';
import 'package:offerpath_mobile/state/live_practice_controller.dart';

import '../support/fake_api.dart';
import '../support/fake_realtime.dart';
import '../support/fake_voice.dart';
import '../support/live_fixtures.dart';
import '../support/prep_fixtures.dart';

const _base = '/api/v1/live-practice';
const _get = '$_base/s1';
const _voice = '$_base/voice';
const _model = '/api/v1/downloads/speaker-model';

Finder _rich(String text) => find.textContaining(text, findRichText: true);

void main() {
  late FakeLiveMic mic;
  late FakeConnector connector;
  late List<bool> wakelock;
  late FakeEmbedder embedder;

  setUp(() {
    mic = FakeLiveMic();
    connector = FakeConnector();
    wakelock = [];
    embedder = FakeEmbedder();
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
          voice: fakeVoiceRepo(fake.client(), embedder: embedder),
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
      // No voice set up: every turn gets an answer, and it says how to fix it.
      expect(find.byKey(const ValueKey('live-voice-hint')), findsOneWidget);
      expect(find.text(liveVoiceHint), findsOneWidget);
      expect(find.text('Answers for'), findsNothing);

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
      expect(find.byKey(const ValueKey('live-transcript')), findsOneWidget);
      expect(find.text('How do you reverse'), findsOneWidget);
      // Without a voiceprint it can't say who spoke.
      expect(find.text('Heard'), findsOneWidget);

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
    'a typed question is asked; End session ends it and shows the saved answers',
    (tester) async {
      final fake = activeSession(exchanges: [liveExchangeJson()])
        ..on(
          'POST',
          '$_get/end',
          FakeReply.ok(
            liveViewJson(
              status: 'ENDED',
              exchanges: [
                liveExchangeJson(),
                liveExchangeJson(
                  id: 'x2',
                  order: 1,
                  question: 'Typed question?',
                  answer: 'Typed answer.',
                ),
              ],
            ),
          ),
        );
      await open(tester, fake);
      // Saved earlier in this session.
      expect(find.text('What is a closure in JavaScript?'), findsOneWidget);
      expect(find.text('QUESTIONS · 1'), findsOneWidget);
      expect(find.text('Neutral'), findsNothing);

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
      expect(fake.requests.where((r) => r.method == 'PATCH'), isEmpty);
      expect(find.text('Typed question?'), findsOneWidget);
      expect(_rich('Typed answer.'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
      expect(find.byKey(const ValueKey('live-mic')), findsNothing);
    },
  );

  testWidgets(
    'with a voiceprint, captions say who spoke and only the interviewer gets an answer',
    (tester) async {
      final fake = activeSession()
        ..on('GET', _voice, FakeReply.ok(voiceProfileJson()))
        ..on('GET', _model, FakeReply.ok(speakerModelJson()));
      await open(tester, fake);
      expect(find.byKey(const ValueKey('live-voice-hint')), findsNothing);

      await tester.tap(find.byKey(const ValueKey('live-mic')));
      await flush(tester);
      final socket = connector.last;
      mic.push([...tone(3000, ownerVoice), ...tone(3000, otherVoice)]);
      await flush(tester);

      socket
        ..emit({'type': 'input_audio_buffer.speech_started', 'item_id': 'me', 'audio_start_ms': 100})
        ..emit({'type': 'input_audio_buffer.speech_stopped', 'item_id': 'me', 'audio_end_ms': 2900})
        ..emit({'type': 'input_audio_buffer.committed', 'item_id': 'me'})
        ..emit({
          'type': 'conversation.item.input_audio_transcription.completed',
          'item_id': 'me',
          'transcript': 'I worked on payments.',
        })
        ..emit({'type': 'input_audio_buffer.speech_started', 'item_id': 'them', 'audio_start_ms': 3100})
        ..emit({'type': 'input_audio_buffer.speech_stopped', 'item_id': 'them', 'audio_end_ms': 5900})
        ..emit({'type': 'input_audio_buffer.committed', 'item_id': 'them'})
        ..emit({
          'type': 'conversation.item.input_audio_transcription.completed',
          'item_id': 'them',
          'transcript': 'How did you test it?',
        });
      await flush(tester);
      expect(socket.sentTypes.where((t) => t == 'response.create'), hasLength(1));
      expect(find.text('You'), findsOneWidget);
      expect(find.text('Interviewer'), findsOneWidget);
      expect(find.text('I worked on payments.'), findsOneWidget);

      socket
        ..emit({'type': 'response.created', 'response': {'id': 'r1'}})
        ..emit({'type': 'response.output_text.delta', 'response_id': 'r1', 'delta': 'With contract tests.'})
        ..emit({'type': 'response.done', 'response': {'id': 'r1', 'status': 'completed'}});
      await flush(tester);
      expect(find.text('QUESTIONS · 1'), findsOneWidget);
      // The caption and the card.
      expect(find.text('How did you test it?'), findsNWidgets(2));
      expect(
        fake.requests.where((r) => r.path == '$_get/exchanges').single.body,
        {'question': 'How did you test it?', 'answer': 'With contract tests.'},
      );
    },
  );

  testWidgets('the hint opens the voice setup', (tester) async {
    final fake = activeSession()
      ..on('GET', _model, FakeReply.ok(speakerModelJson()));
    await open(tester, fake);
    await tester.tap(find.widgetWithText(TextButton, 'Set up'));
    await tester.pumpAndSettle();
    expect(find.byType(VoiceSetupPage), findsOneWidget);
    expect(find.textContaining('read three sentences'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.byType(VoiceSetupPage), findsNothing);
    expect(find.text(liveVoiceHint), findsOneWidget);
  });

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

        expect(find.byKey(const ValueKey('live-voice-card')), findsOneWidget);
        expect(find.text('Not set up'), findsOneWidget);
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
      'the new-session sheet sends technologies and title',
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
        expect(find.text('Answers for'), findsNothing);
        await tester.tap(find.text('Start'));
        await tester.pumpAndSettle();

        final post = fake.requests.lastWhere((r) => r.method == 'POST');
        expect(post.body, {
          'technologies': ['React', 'Go'],
          'title': 'Evening round',
        });
        // The API's refusal stays on the sheet.
        expect(find.text('Save your OpenAI key first.'), findsOneWidget);
      },
    );

    testWidgets('the Your voice card opens the setup and shows when it is set up', (
      tester,
    ) async {
      tallScreen(tester);
      final fake = FakeApi()
        ..on('GET', _base, const FakeReply.ok({'sessions': []}))
        ..on('GET', _voice, FakeReply.ok(voiceProfileJson()))
        ..on('GET', _model, FakeReply.ok(speakerModelJson()));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: LivePracticeListPage(
              api: fake.client(),
              voice: fakeVoiceRepo(fake.client()),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Set up'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('live-voice-card')));
      await tester.pumpAndSettle();
      expect(find.text('Your voice is set up'), findsOneWidget);
    });

    testWidgets(
      'before the first session without a voiceprint, the voice setup comes first (once)',
      (tester) async {
        tallScreen(tester);
        final cache = MemoryVoiceCache();
        final fake = FakeApi()
          ..on('GET', _base, const FakeReply.ok({'sessions': []}))
          ..on('GET', '$_base/ready', const FakeReply.ok({'ready': true, 'reason': null}))
          ..on('POST', _base, FakeReply(201, liveViewJson()))
          ..on('GET', _model, FakeReply.ok(speakerModelJson()));
        final voice = fakeVoiceRepo(fake.client(), cache: cache);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: LivePracticeListPage(api: fake.client(), voice: voice),
            ),
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.text('New live practice'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Start'));
        await tester.pumpAndSettle();
        expect(find.byType(VoiceSetupPage), findsOneWidget);
        expect(cache.offered, isTrue);

        await tester.tap(find.text('Not now'));
        await tester.pumpAndSettle();
        expect(find.byType(LivePracticePage), findsOneWidget);
        expect(find.text(liveVoiceHint), findsOneWidget);
        // Never offered on its own again.
        expect(await voice.offerSetup(), isFalse);
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
