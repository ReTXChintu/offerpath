import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/models/live_practice.dart';
import 'package:offerpath_mobile/services/api_client.dart';

import '../support/live_fixtures.dart';

void main() {
  test('a full LivePracticeView parses, exchanges oldest first', () {
    final view = LivePracticeView.fromJson(
      liveViewJson(
        prepId: 'p1',
        answerFor: 'neutral',
        exchanges: [
          liveExchangeJson(
            id: 'x2',
            order: 1,
            question: 'Why React?',
            answer: 'I like its component model.',
            answerFor: 'neutral',
          ),
          liveExchangeJson(),
        ],
      ),
    );
    expect(view.id, 's1');
    expect(view.prepId, 'p1');
    expect(view.title, 'React, Node.js');
    expect(view.technologies, ['React', 'Node.js']);
    expect(view.answerFor, AnswerFor.neutral);
    expect(view.status, LiveStatus.active);
    expect(view.isActive, isTrue);
    expect(view.createdAt, DateTime.utc(2026, 10, 21, 10));
    expect(view.endedAt, isNull);

    expect(view.exchanges.map((e) => e.id), ['x1', 'x2']);
    final first = view.exchanges.first;
    expect(first.order, 0);
    expect(first.question, 'What is a closure in JavaScript?');
    expect(first.answer, startsWith('A closure is a function'));
    expect(first.answerFor, AnswerFor.me);
    expect(first.createdAt, DateTime.utc(2026, 10, 21, 10, 1));
    expect(view.exchanges.last.answerFor, AnswerFor.neutral);
  });

  test('an ended view, and a sparse one, parse without throwing', () {
    final ended = LivePracticeView.fromJson(liveViewJson(status: 'ENDED'));
    expect(ended.isEnded, isTrue);
    expect(ended.endedAt, isNotNull);

    final sparse = LivePracticeView.fromJson(const {'id': 's9'});
    expect(sparse.title, 'Live practice');
    expect(sparse.answerFor, AnswerFor.me);
    expect(sparse.exchanges, isEmpty);
    expect(sparse.technologies, isEmpty);
  });

  test('summaries carry the number of exchanges', () {
    final s = LivePracticeSummary.fromJson(liveSummaryJson());
    expect(s.title, 'React, Node.js');
    expect(s.status, LiveStatus.ended);
    expect(s.exchanges, 3);
    expect(s.endedAt, DateTime.utc(2026, 10, 21, 10, 30));
    expect(LivePracticeSummary.fromJson(const {'id': 's'}).exchanges, 0);
  });

  test('a realtime pass parses, and falls back to the model url', () {
    final pass = RealtimePass.fromJson(realtimePassJson());
    expect(pass.clientSecret, 'ek_test1');
    expect(pass.model, 'gpt-realtime');
    expect(pass.url, 'wss://api.openai.com/v1/realtime?model=gpt-realtime');
    expect(pass.expiresAt, DateTime.utc(2026, 10, 21, 10, 10));

    final bare = RealtimePass.fromJson(const {
      'clientSecret': 'ek_2',
      'model': 'gpt-realtime-mini',
    });
    expect(
      bare.url,
      'wss://api.openai.com/v1/realtime?model=gpt-realtime-mini',
    );
    expect(bare.expiresAt, isNull);
  });

  test('readiness', () {
    final ready = LiveReady.fromJson(const {
      'ready': false,
      'reason': 'No OpenAI key is saved.',
    });
    expect(ready.ready, isFalse);
    expect(ready.reason, 'No OpenAI key is saved.');
    expect(
      LiveReady.fromJson(const {'ready': true, 'reason': null}).reason,
      isNull,
    );
  });

  test("a 503 from live practice shows OpenAI's message, not the desktop", () {
    const e = ApiException(
      status: 503,
      type: 'urn:offerpath:error:ai-unavailable',
      title: 'AI unavailable',
      detail: 'Incorrect API key provided.',
    );
    expect(liveErrorMessage(e), 'Incorrect API key provided.');
    const bare = ApiException(
      status: 503,
      type: 'urn:offerpath:error:unavailable',
      title: 'Unavailable',
    );
    expect(liveErrorMessage(bare), "OpenAI didn't answer.");
    const ended = ApiException(
      status: 409,
      type: 'urn:offerpath:error:conflict',
      title: 'Conflict',
      detail: 'This session has ended.',
    );
    expect(liveErrorMessage(ended), 'This session has ended.');
  });
}
