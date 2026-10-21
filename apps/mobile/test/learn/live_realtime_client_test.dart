import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/realtime_client.dart';
import 'package:offerpath_mobile/models/live_practice.dart';

void main() {
  late List<LiveCard> finished;
  late List<String> errors;
  late LiveConversation conv;

  setUp(() {
    finished = [];
    errors = [];
    conv = LiveConversation(
      onChanged: () {},
      onFinished: finished.add,
      onError: (message, code) => errors.add('$code: $message'),
      transcriptWait: const Duration(milliseconds: 20),
    );
  });
  tearDown(() => conv.dispose());

  void send(Map<String, Object?> event) => conv.handle(jsonEncode(event));

  test(
    'beta event names work the same: item.created, text.delta, text.done',
    () {
      send({
        'type': 'conversation.item.created',
        'item': {
          'id': 'item_9',
          'type': 'message',
          'role': 'user',
          'content': [
            {'type': 'input_audio', 'transcript': null},
          ],
        },
      });
      send({
        'type': 'conversation.item.input_audio_transcription.completed',
        'item_id': 'item_9',
        'transcript': ' What is Docker? ',
      });
      send({
        'type': 'response.created',
        'response': {'id': 'r1'},
      });
      send({'type': 'response.text.delta', 'response_id': 'r1', 'delta': 'A '});
      send({
        'type': 'response.text.delta',
        'response_id': 'r1',
        'delta': 'container tool.',
      });
      send({
        'type': 'response.text.done',
        'response_id': 'r1',
        'text': 'A container tool.',
      });
      expect(finished.single.question, 'What is Docker?');
      expect(finished.single.answer, 'A container tool.');
    },
  );

  test('a GA user item added after the commit is the same turn', () {
    send({'type': 'input_audio_buffer.committed', 'item_id': 'item_1'});
    send({
      'type': 'conversation.item.added',
      'item': {
        'id': 'item_1',
        'role': 'user',
        'content': [
          {'type': 'input_audio'},
        ],
      },
    });
    send({
      'type': 'response.created',
      'response': {'id': 'r1'},
    });
    send({
      'type': 'response.output_text.delta',
      'response_id': 'r1',
      'delta': 'Yes.',
    });
    expect(conv.visibleCards.single.turns, hasLength(1));
  });

  test('a markdown list that starts with "-" still shows', () {
    send({
      'type': 'response.created',
      'response': {'id': 'r1'},
    });
    send({
      'type': 'response.output_text.delta',
      'response_id': 'r1',
      'delta': '-',
    });
    expect(conv.visibleCards, isEmpty);
    send({
      'type': 'response.output_text.delta',
      'response_id': 'r1',
      'delta': ' First point',
    });
    expect(conv.visibleCards.single.answer, '- First point');
  });

  test('response.done carries the text when no delta did', () {
    send({'type': 'input_audio_buffer.committed', 'item_id': 'item_1'});
    send({
      'type': 'conversation.item.input_audio_transcription.completed',
      'item_id': 'item_1',
      'transcript': 'Why Rust?',
    });
    send({
      'type': 'response.created',
      'response': {'id': 'r1'},
    });
    send({
      'type': 'response.done',
      'response': {
        'id': 'r1',
        'status': 'completed',
        'output': [
          {
            'type': 'message',
            'content': [
              {'type': 'output_text', 'text': 'Memory safety.'},
            ],
          },
        ],
      },
    });
    expect(finished.single.answer, 'Memory safety.');
  });

  test("a failed response reports OpenAI's message", () {
    send({
      'type': 'response.created',
      'response': {'id': 'r1'},
    });
    send({
      'type': 'response.done',
      'response': {
        'id': 'r1',
        'status': 'failed',
        'status_details': {
          'error': {'code': 'rate_limit_exceeded', 'message': 'Slow down.'},
        },
      },
    });
    expect(errors, ['rate_limit_exceeded: Slow down.']);
    expect(conv.cards, isEmpty);
  });

  test('two turns answered together make one question', () {
    send({'type': 'input_audio_buffer.committed', 'item_id': 'a'});
    send({'type': 'input_audio_buffer.committed', 'item_id': 'b'});
    send({
      'type': 'conversation.item.input_audio_transcription.completed',
      'item_id': 'a',
      'transcript': 'Two questions.',
    });
    send({
      'type': 'conversation.item.input_audio_transcription.completed',
      'item_id': 'b',
      'transcript': 'What is SQL?',
    });
    send({
      'type': 'response.created',
      'response': {'id': 'r1'},
    });
    send({
      'type': 'response.output_text.delta',
      'response_id': 'r1',
      'delta': 'A query language.',
    });
    send({
      'type': 'response.done',
      'response': {'id': 'r1', 'status': 'completed'},
    });
    expect(finished.single.question, 'Two questions. What is SQL?');
  });

  test('the level of PCM16 audio', () {
    expect(pcmLevel(const []), 0);
    expect(pcmLevel(List.filled(200, 0)), 0);
    // Full scale: 0x7fff little-endian.
    final loud = [
      for (var i = 0; i < 100; i++) ...[0xff, 0x7f],
    ];
    expect(pcmLevel(loud), closeTo(1, 0.01));
    expect(realtimeChunkBytes, 4800);
  });

  test('the events the phone sends', () {
    expect(appendAudioEvent([1, 2, 3]), {
      'type': 'input_audio_buffer.append',
      'audio': 'AQID',
    });
    expect(typedQuestionEvents('Hi?').map((e) => e['type']), [
      'conversation.item.create',
      'response.create',
    ]);
    expect(isNotAQuestion(' - '), isTrue);
    expect(isNotAQuestion(''), isTrue);
    expect(isNotAQuestion('-1 is negative'), isFalse);
    expect(AnswerFor.values, hasLength(2));
  });
}
