import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/realtime_client.dart';
import 'package:offerpath_mobile/models/live_practice.dart';
import 'package:offerpath_mobile/state/live_practice_controller.dart';

import '../support/fake_api.dart';
import '../support/fake_realtime.dart';
import '../support/live_fixtures.dart';

const _s1 = '/api/v1/live-practice/s1';

/// A controller on fakes, with short waits.
class _Rig {
  _Rig({LivePracticeView? initial}) {
    var passes = 0;
    api.routes['POST $_s1/realtime'] = (_) =>
        FakeReply.ok(realtimePassJson(secret: 'ek_${++passes}'));
    var saved = 0;
    api.routes['POST $_s1/exchanges'] = (r) {
      final body = (r.body as Map).cast<String, dynamic>();
      return FakeReply(
        201,
        liveExchangeJson(
          id: 'x${++saved}',
          question: body['question'] as String,
          answer: body['answer'] as String,
        ),
      );
    };
    c = LivePracticeController(
      api: api.client(),
      sessionId: 's1',
      initial: initial ?? LivePracticeView.fromJson(liveViewJson()),
      mic: mic,
      connect: connector.call,
      reconnectDelays: const [
        Duration(milliseconds: 5),
        Duration(milliseconds: 5),
      ],
      saveRetryDelays: const [Duration(milliseconds: 5)],
      transcriptWait: const Duration(milliseconds: 40),
    );
  }

  final api = FakeApi();
  final mic = FakeLiveMic();
  final connector = FakeConnector();
  late final LivePracticeController c;

  FakeSocket get socket => connector.last;

  Future<void> emit(Map<String, Object?> event) async {
    socket.emit(event);
    await settle();
  }

  List<FakeRequest> posts(String suffix) => api.requests
      .where((r) => r.method == 'POST' && r.path == '$_s1$suffix')
      .toList();
}

Future<void> settle() async {
  for (var i = 0; i < 5; i++) {
    await pumpEventQueue();
  }
}

Map<String, Object?> _committed(String item) => {
  'type': 'input_audio_buffer.committed',
  'item_id': item,
};

Map<String, Object?> _transcript(String item, String text) => {
  'type': 'conversation.item.input_audio_transcription.completed',
  'item_id': item,
  'transcript': text,
};

Map<String, Object?> _created(String id) => {
  'type': 'response.created',
  'response': {'id': id, 'status': 'in_progress'},
};

Map<String, Object?> _delta(String id, String delta, {bool beta = false}) => {
  'type': beta ? 'response.text.delta' : 'response.output_text.delta',
  'response_id': id,
  'delta': delta,
};

Map<String, Object?> _textDone(String id, String text) => {
  'type': 'response.output_text.done',
  'response_id': id,
  'text': text,
};

Map<String, Object?> _done(String id) => {
  'type': 'response.done',
  'response': {'id': id, 'status': 'completed'},
};

void main() {
  test('listening gets a pass, connects with it, and sends the audio as base64 append events of ~100 ms', () async {
    final rig = _Rig();
    addTearDown(rig.c.dispose);

    expect(await rig.c.startListening(), isTrue);
    expect(rig.c.listening, isTrue);
    expect(rig.c.connection, LiveConnection.connected);
    expect(rig.posts('/realtime'), hasLength(1));
    expect(
      rig.connector.urls.single.toString(),
      'wss://api.openai.com/v1/realtime?model=gpt-realtime',
    );
    expect(rig.connector.headers.single, {'Authorization': 'Bearer ek_1'});
    expect(rig.mic.starts, 1);

    rig.mic.push(List.filled(3000, 1));
    await settle();
    expect(rig.socket.sent, isEmpty);

    // 4,801 bytes: 4,800 go (whole samples), one waits.
    rig.mic.push(List.filled(1801, 2));
    await settle();
    final append = rig.socket.sent.single;
    expect(append['type'], 'input_audio_buffer.append');
    expect(base64Decode(append['audio'] as String), [
      ...List.filled(3000, 1),
      ...List.filled(1800, 2),
    ]);
    expect(rig.c.level.value, greaterThan(0));

    await rig.c.pauseListening();
    expect(rig.c.listening, isFalse);
    expect(rig.mic.recording, isFalse);
    expect(rig.mic.stops, 1);
    expect(rig.c.level.value, 0);
    // The socket stays open for typed questions.
    expect(rig.socket.closed, isFalse);
  });

  test('a full turn yields one card and one saved exchange; the caption follows the transcript', () async {
    final rig = _Rig();
    addTearDown(rig.c.dispose);
    await rig.c.startListening();

    await rig.emit({'type': 'input_audio_buffer.speech_started'});
    expect(rig.c.conversation.speech, LiveSpeech.hearing);
    await rig.emit({'type': 'input_audio_buffer.speech_stopped'});
    expect(rig.c.conversation.speech, LiveSpeech.thinking);
    await rig.emit(_committed('item_1'));
    await rig.emit({
      'type': 'conversation.item.input_audio_transcription.delta',
      'item_id': 'item_1',
      'delta': 'What is a ',
    });
    expect(rig.c.conversation.caption, 'What is a ');
    await rig.emit(_transcript('item_1', 'What is a closure?'));
    expect(rig.c.conversation.caption, 'What is a closure?');

    await rig.emit(_created('resp_1'));
    expect(rig.c.cards, isEmpty);
    await rig.emit(_delta('resp_1', 'A closure is '));
    await rig.emit(_delta('resp_1', 'a function.', beta: true));
    final card = rig.c.cards.single;
    expect(card.question, 'What is a closure?');
    expect(card.answer, 'A closure is a function.');
    expect(card.answerDone, isFalse);
    expect(rig.posts('/exchanges'), isEmpty);

    await rig.emit(_textDone('resp_1', 'A closure is a function.'));
    await rig.emit(_done('resp_1'));
    expect(rig.c.cards.single.answerDone, isTrue);
    final saves = rig.posts('/exchanges');
    expect(saves, hasLength(1));
    expect(saves.single.body, {
      'question': 'What is a closure?',
      'answer': 'A closure is a function.',
    });
    expect(card.save, LiveSaveState.saved);
    expect(card.exchangeId, 'x1');
    expect(rig.c.conversation.speech, LiveSpeech.quiet);
  });

  test(
    'a transcript that arrives after the answer still fills the question',
    () async {
      final rig = _Rig();
      addTearDown(rig.c.dispose);
      await rig.c.startListening();

      await rig.emit(_committed('item_1'));
      await rig.emit(_created('resp_1'));
      await rig.emit(_delta('resp_1', 'REST is an architectural style.'));
      await rig.emit(_done('resp_1'));
      final card = rig.c.cards.single;
      expect(card.question, isEmpty);
      expect(card.questionDone, isFalse);
      // It waits for the question before saving.
      expect(rig.posts('/exchanges'), isEmpty);

      await rig.emit(_transcript('item_1', 'What is REST?'));
      expect(card.question, 'What is REST?');
      expect(rig.posts('/exchanges').single.body, {
        'question': 'What is REST?',
        'answer': 'REST is an architectural style.',
      });
    },
  );

  test('with no transcript at all, it is saved after a short wait', () async {
    final rig = _Rig();
    addTearDown(rig.c.dispose);
    await rig.c.startListening();

    await rig.emit(_committed('item_1'));
    await rig.emit(_created('resp_1'));
    await rig.emit(_delta('resp_1', 'An answer.'));
    await rig.emit(_done('resp_1'));
    expect(rig.posts('/exchanges'), isEmpty);
    await Future<void>.delayed(const Duration(milliseconds: 80));
    await settle();
    expect(rig.posts('/exchanges').single.body, {
      'question': liveQuestionNotCaptured,
      'answer': 'An answer.',
    });
  });

  test('a "-" reply (not a question) yields no card and no save', () async {
    final rig = _Rig();
    addTearDown(rig.c.dispose);
    await rig.c.startListening();

    await rig.emit(_committed('item_1'));
    await rig.emit(_transcript('item_1', 'Okay, let me think.'));
    await rig.emit(_created('resp_1'));
    await rig.emit(_delta('resp_1', '-'));
    expect(rig.c.cards, isEmpty);
    await rig.emit(_textDone('resp_1', '-'));
    await rig.emit(_done('resp_1'));
    expect(rig.c.cards, isEmpty);
    expect(rig.c.conversation.cards, isEmpty);
    await Future<void>.delayed(const Duration(milliseconds: 80));
    await settle();
    expect(rig.posts('/exchanges'), isEmpty);
  });

  test(
    'an error event surfaces its message as it is, until dismissed',
    () async {
      final rig = _Rig();
      addTearDown(rig.c.dispose);
      await rig.c.startListening();

      await rig.emit({
        'type': 'error',
        'error': {
          'type': 'invalid_request_error',
          'code': 'invalid_value',
          'message':
              "Invalid value: 'gpt-x'. Supported values are: 'gpt-realtime'.",
        },
      });
      expect(
        rig.c.banner,
        "Invalid value: 'gpt-x'. Supported values are: 'gpt-realtime'.",
      );
      rig.c.dismissBanner();
      expect(rig.c.banner, isNull);
    },
  );

  test('an unexpected close while listening gets a new pass and reconnects, keeping the cards', () async {
    final rig = _Rig();
    addTearDown(rig.c.dispose);
    await rig.c.startListening();

    await rig.emit(_committed('item_1'));
    await rig.emit(_transcript('item_1', 'Tell me about yourself.'));
    await rig.emit(_created('resp_1'));
    await rig.emit(_delta('resp_1', 'I build web apps.'));
    await rig.emit(_done('resp_1'));
    final first = rig.socket;

    first.drop();
    await settle();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await settle();

    expect(rig.connector.sockets, hasLength(2));
    expect(rig.posts('/realtime'), hasLength(2));
    expect(rig.connector.headers.last, {'Authorization': 'Bearer ek_2'});
    expect(rig.c.connection, LiveConnection.connected);
    expect(rig.c.listening, isTrue);
    expect(rig.c.cards.single.answer, 'I build web apps.');

    // Audio goes to the new socket.
    rig.mic.push(List.filled(realtimeChunkBytes, 3));
    await settle();
    expect(rig.socket.sentTypes, ['input_audio_buffer.append']);
    expect(first.sent, isEmpty);
  });

  test(
    'a session-expired error reconnects instead of showing a banner',
    () async {
      final rig = _Rig();
      addTearDown(rig.c.dispose);
      await rig.c.startListening();
      await rig.emit({
        'type': 'error',
        'error': {
          'code': 'session_expired',
          'message': 'Your session hit the maximum duration of 60 minutes.',
        },
      });
      await settle();
      expect(rig.c.banner, isNull);
      expect(rig.connector.sockets, hasLength(2));
      expect(rig.connector.sockets.first.closed, isTrue);
      expect(rig.c.connection, LiveConnection.connected);
    },
  );

  test('when reconnecting keeps failing it stops and says why', () async {
    final rig = _Rig();
    addTearDown(rig.c.dispose);
    await rig.c.startListening();
    rig.connector.failWith = Exception('HTTP 401');
    rig.socket.drop();
    await Future<void>.delayed(const Duration(milliseconds: 60));
    await settle();
    // One immediate attempt and one per delay.
    expect(rig.connector.urls, hasLength(4));
    expect(rig.c.connection, LiveConnection.offline);
    expect(rig.c.listening, isFalse);
    expect(rig.mic.recording, isFalse);
    expect(rig.c.banner, contains('HTTP 401'));
  });

  test('a typed question sends the item and a response request', () async {
    final rig = _Rig();
    addTearDown(rig.c.dispose);

    // Not listening: it connects for the question.
    expect(await rig.c.ask('  What is REST?  '), isTrue);
    expect(rig.c.listening, isFalse);
    expect(rig.socket.sent, [
      {
        'type': 'conversation.item.create',
        'item': {
          'type': 'message',
          'role': 'user',
          'content': [
            {'type': 'input_text', 'text': 'What is REST?'},
          ],
        },
      },
      {'type': 'response.create'},
    ]);

    await rig.emit(_created('resp_1'));
    await rig.emit(_delta('resp_1', 'An architectural style.'));
    await rig.emit(_done('resp_1'));
    expect(rig.c.cards.single.question, 'What is REST?');
    expect(rig.posts('/exchanges').single.body, {
      'question': 'What is REST?',
      'answer': 'An architectural style.',
    });
  });

  test(
    'Answers for is saved, then the connection is replaced with a new pass',
    () async {
      final rig = _Rig();
      rig.api.on(
        'PATCH',
        _s1,
        FakeReply.ok(liveViewJson(answerFor: 'neutral')),
      );
      addTearDown(rig.c.dispose);
      await rig.c.startListening();

      await rig.c.setAnswerFor(AnswerFor.neutral);
      await settle();
      expect(rig.api.requests.firstWhere((r) => r.method == 'PATCH').body, {
        'answerFor': 'neutral',
      });
      expect(rig.c.view!.answerFor, AnswerFor.neutral);
      expect(rig.connector.sockets, hasLength(2));
      expect(rig.connector.sockets.first.closed, isTrue);
      expect(rig.c.connection, LiveConnection.connected);

      await rig.emit(_created('resp_1'));
      await rig.emit(_delta('resp_1', 'Answer.'));
      expect(rig.c.cards.single.answerFor, AnswerFor.neutral);
    },
  );

  test('a failed save is retried, then shown on the card', () async {
    final rig = _Rig();
    rig.api.on(
      'POST',
      '$_s1/exchanges',
      FakeReply.problem(500, 'internal', 'Server error'),
    );
    addTearDown(rig.c.dispose);
    await rig.c.startListening();
    await rig.emit(_committed('item_1'));
    await rig.emit(_transcript('item_1', 'Why Go?'));
    await rig.emit(_created('resp_1'));
    await rig.emit(_delta('resp_1', 'Simple concurrency.'));
    await rig.emit(_done('resp_1'));
    await Future<void>.delayed(const Duration(milliseconds: 30));
    await settle();
    expect(rig.posts('/exchanges'), hasLength(2));
    expect(rig.c.cards.single.save, LiveSaveState.failed);
    expect(rig.c.cards.single.saveError, 'Server error');
  });

  test('ending stops the mic, saves what is on screen, closes the socket, then ends', () async {
    final rig = _Rig();
    rig.api.on(
      'POST',
      '$_s1/end',
      FakeReply.ok(
        liveViewJson(
          status: 'ENDED',
          exchanges: [liveExchangeJson(question: 'Why Go?')],
        ),
      ),
    );
    addTearDown(rig.c.dispose);
    await rig.c.startListening();
    await rig.emit(_committed('item_1'));
    await rig.emit(_transcript('item_1', 'Why Go?'));
    await rig.emit(_created('resp_1'));
    // Still being written when the session ends: kept as it is.
    await rig.emit(_delta('resp_1', 'Simple concurrency.'));

    expect(await rig.c.end(), isTrue);
    expect(rig.c.listening, isFalse);
    expect(rig.mic.recording, isFalse);
    expect(rig.socket.closed, isTrue);
    expect(
      rig.api.requests
          .where((r) => r.method == 'POST')
          .map((r) => r.path.substring(_s1.length)),
      ['/realtime', '/exchanges', '/end'],
    );
    expect(rig.posts('/exchanges').single.body, {
      'question': 'Why Go?',
      'answer': 'Simple concurrency.',
    });
    expect(rig.c.isEnded, isTrue);
  });

  test('a refused microphone says so and does not connect', () async {
    final rig = _Rig();
    rig.mic.permission = false;
    addTearDown(rig.c.dispose);
    expect(await rig.c.startListening(), isFalse);
    expect(rig.c.micError, liveMicDeniedMessage);
    expect(rig.connector.urls, isEmpty);
    expect(rig.mic.starts, 0);
  });

  test("a refused pass shows OpenAI's message and does not listen", () async {
    final rig = _Rig();
    rig.api.on(
      'POST',
      '$_s1/realtime',
      FakeReply.problem(
        503,
        'ai-unavailable',
        'AI unavailable',
        detail: 'Incorrect API key provided.',
      ),
    );
    addTearDown(rig.c.dispose);
    expect(await rig.c.startListening(), isFalse);
    expect(rig.c.banner, 'Incorrect API key provided.');
    expect(rig.c.connection, LiveConnection.offline);
    expect(rig.mic.starts, 0);
  });
}
