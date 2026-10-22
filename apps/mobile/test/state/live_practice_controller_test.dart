import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/realtime_client.dart';
import 'package:offerpath_mobile/learn/live/speaker_embedder.dart';
import 'package:offerpath_mobile/models/live_practice.dart';
import 'package:offerpath_mobile/state/live_practice_controller.dart';

import '../support/fake_api.dart';
import '../support/fake_realtime.dart';
import '../support/fake_voice.dart';
import '../support/live_fixtures.dart';

const _s1 = '/api/v1/live-practice/s1';

/// A controller on fakes, with short waits.
class _Rig {
  _Rig({LivePracticeView? initial, LiveVoice? voice}) {
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
      loadVoice: voice == null ? null : () async => voice,
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

Map<String, Object?> _started(String item, int ms) => {
  'type': 'input_audio_buffer.speech_started',
  'item_id': item,
  'audio_start_ms': ms,
};

Map<String, Object?> _stopped(String item, int ms) => {
  'type': 'input_audio_buffer.speech_stopped',
  'item_id': item,
  'audio_end_ms': ms,
};

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

  test('without a voice profile every turn is answered: response.create after its commit, with the hint', () async {
    final rig = _Rig();
    addTearDown(rig.c.dispose);
    await rig.c.startListening();
    expect(rig.c.voice, isNull);
    expect(rig.c.showVoiceHint, isTrue);

    await rig.emit(_started('item_1', 0));
    await rig.emit(_stopped('item_1', 3000));
    expect(rig.socket.sentTypes, isNot(contains('response.create')));
    await rig.emit(_committed('item_1'));
    expect(rig.socket.sentTypes.where((t) => t == 'response.create'), hasLength(1));
    expect(rig.c.conversation.turn('item_1')!.role, LiveRole.interviewer);
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
    // The old one only asked for its turn's answer.
    expect(first.sentTypes, ['response.create']);
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

  group('whose voice', () {
    late FakeEmbedder embedder;
    late _Rig rig;

    /// Listening with the user's voiceprint; [audio] has been sent.
    Future<void> listen(List<int> audio) async {
      embedder = FakeEmbedder();
      rig = _Rig(voice: fakeLiveVoice(embedder));
      addTearDown(rig.c.dispose);
      expect(await rig.c.startListening(), isTrue);
      expect(rig.c.showVoiceHint, isFalse);
      rig.mic.push(audio);
      await settle();
    }

    int responseCreates() =>
        rig.socket.sentTypes.where((t) => t == 'response.create').length;

    test('the interviewee is captioned "You" and never answered', () async {
      await listen(tone(3000, ownerVoice));
      await rig.emit(_started('item_1', 200));
      await rig.emit(_stopped('item_1', 2800));
      await rig.emit(_committed('item_1'));
      await rig.emit(_transcript('item_1', 'I led the payments migration.'));

      // The turn's 2.6 s went to the model at 16 kHz.
      expect(embedder.calls.single.length, 2600 * 16);
      expect(responseCreates(), 0);
      final line = rig.c.conversation.transcript.single;
      expect(line.role, LiveRole.interviewee);
      expect(line.text, 'I led the payments migration.');
      expect(rig.c.conversation.speech, LiveSpeech.quiet);
      expect(rig.c.cards, isEmpty);
    });

    test('the interviewer is answered once the voice check and the commit are both in (check first)', () async {
      await listen(tone(3000, otherVoice));
      embedder.hold = Completer<void>();
      await rig.emit(_started('item_1', 200));
      await rig.emit(_stopped('item_1', 2800));
      expect(rig.c.conversation.turn('item_1')!.role, isNull);

      embedder.hold!.complete();
      await settle();
      expect(rig.c.conversation.turn('item_1')!.role, LiveRole.interviewer);
      // Not in the conversation yet.
      expect(responseCreates(), 0);

      await rig.emit(_committed('item_1'));
      expect(responseCreates(), 1);
    });

    test('... and when the commit comes before the voice check is done', () async {
      await listen(tone(3000, otherVoice));
      embedder.hold = Completer<void>();
      await rig.emit(_started('item_1', 200));
      await rig.emit(_stopped('item_1', 2800));
      await rig.emit(_committed('item_1'));
      expect(responseCreates(), 0);

      embedder.hold!.complete();
      await settle();
      expect(responseCreates(), 1);
      await rig.emit(_transcript('item_1', 'Why do you want this job?'));
      expect(rig.c.conversation.transcript.single.role, LiveRole.interviewer);
    });

    test('a turn under a second is too short to check: the interviewer', () async {
      await listen(tone(3000, ownerVoice));
      await rig.emit(_started('item_1', 1000));
      await rig.emit(_stopped('item_1', 1700));
      await rig.emit(_committed('item_1'));
      expect(embedder.calls, isEmpty);
      expect(responseCreates(), 1);
    });

    test('a turn no longer in the buffer, or without times, is the interviewer', () async {
      await listen(tone(2000, ownerVoice));
      // Starts after what was sent.
      await rig.emit(_started('item_1', 5000));
      await rig.emit(_stopped('item_1', 7000));
      await rig.emit(_committed('item_1'));
      // No start or stop at all.
      await rig.emit(_committed('item_2'));
      expect(embedder.calls, isEmpty);
      expect(responseCreates(), 1);
    });

    test('one answer at a time: the next is asked for when the current one is done', () async {
      await listen([...tone(3000, otherVoice), ...tone(3000, otherVoice)]);
      await rig.emit(_started('a', 100));
      await rig.emit(_stopped('a', 2900));
      await rig.emit(_committed('a'));
      await rig.emit(_transcript('a', 'Tell me about yourself.'));
      expect(responseCreates(), 1);
      await rig.emit(_created('resp_1'));
      await rig.emit(_delta('resp_1', 'I build backends.'));

      await rig.emit(_started('b', 3100));
      await rig.emit(_stopped('b', 5900));
      await rig.emit(_committed('b'));
      await rig.emit(_transcript('b', 'Why Go?'));
      // Still writing the first answer.
      expect(responseCreates(), 1);

      await rig.emit(_done('resp_1'));
      expect(responseCreates(), 2);
      await rig.emit(_created('resp_2'));
      await rig.emit(_delta('resp_2', 'Simple concurrency.'));
      await rig.emit(_done('resp_2'));

      expect(
        rig.c.cards.map((c) => c.question),
        ['Why Go?', 'Tell me about yourself.'],
      );
      expect(rig.posts('/exchanges').map((r) => (r.body as Map)['question']), [
        'Tell me about yourself.',
        'Why Go?',
      ]);
    });

    test('a refused response.create (one already active) is asked again, without a banner', () async {
      await listen(tone(3000, otherVoice));
      await rig.emit(_started('a', 100));
      await rig.emit(_stopped('a', 2900));
      await rig.emit(_committed('a'));
      expect(responseCreates(), 1);
      await rig.emit({
        'type': 'error',
        'error': {
          'code': 'conversation_already_has_active_response',
          'message': 'Conversation already has an active response.',
        },
      });
      expect(rig.c.banner, isNull);
      expect(responseCreates(), 1);
      await rig.emit(_done('resp_0'));
      expect(responseCreates(), 2);
    });

    test('only the interviewer\'s question is saved; the interviewee\'s words are not part of it', () async {
      await listen([...tone(3000, ownerVoice), ...tone(3000, otherVoice)]);
      await rig.emit(_started('me', 100));
      await rig.emit(_stopped('me', 2900));
      await rig.emit(_committed('me'));
      await rig.emit(_transcript('me', 'Let me think about that.'));
      await rig.emit(_started('them', 3100));
      await rig.emit(_stopped('them', 5900));
      await rig.emit(_committed('them'));
      await rig.emit(_transcript('them', 'What is a closure?'));
      expect(responseCreates(), 1);

      await rig.emit(_created('resp_1'));
      await rig.emit(_delta('resp_1', 'A function with its scope.'));
      await rig.emit(_done('resp_1'));

      expect(rig.c.cards.single.question, 'What is a closure?');
      expect(rig.posts('/exchanges').single.body, {
        'question': 'What is a closure?',
        'answer': 'A function with its scope.',
      });
      expect(
        rig.c.conversation.transcript.map((t) => (t.text, t.role)),
        [
          ('Let me think about that.', LiveRole.interviewee),
          ('What is a closure?', LiveRole.interviewer),
        ],
      );
    });

    test('a reconnect starts the milliseconds again: turns are cut from the new connection', () async {
      // The interviewer's voice on the first connection.
      await listen(tone(3000, otherVoice));
      rig.socket.drop();
      await settle();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await settle();
      expect(rig.connector.sockets, hasLength(2));

      // The user's voice on the new one, from its 0 ms.
      rig.mic.push(tone(2000, ownerVoice));
      await settle();
      await rig.emit(_started('item_9', 0));
      await rig.emit(_stopped('item_9', 1800));
      await rig.emit(_committed('item_9'));
      expect(rig.c.conversation.turn('item_9')!.role, LiveRole.interviewee);
      expect(responseCreates(), 0);
    });

    test('a voice check that finishes after a reconnect is dropped', () async {
      await listen(tone(3000, otherVoice));
      embedder.hold = Completer<void>();
      await rig.emit(_started('item_1', 200));
      await rig.emit(_stopped('item_1', 2800));
      await rig.emit(_committed('item_1'));
      rig.socket.drop();
      await settle();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await settle();
      embedder.hold!.complete();
      await settle();
      expect(rig.connector.sockets, hasLength(2));
      expect(responseCreates(), 0);
      expect(rig.connector.sockets.first.sentTypes, isNot(contains('response.create')));
    });

    test('a typed question is the interviewer\'s and waits its turn too', () async {
      await listen(tone(3000, otherVoice));
      await rig.emit(_started('a', 100));
      await rig.emit(_stopped('a', 2900));
      await rig.emit(_committed('a'));
      await rig.emit(_created('resp_1'));
      expect(await rig.c.ask('What is REST?'), isTrue);
      expect(rig.socket.sentTypes.last, 'conversation.item.create');
      expect(responseCreates(), 1);
      await rig.emit(_done('resp_1'));
      expect(responseCreates(), 2);
    });
  });
}
