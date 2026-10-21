import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/models/live_practice.dart';
import 'package:offerpath_mobile/services/api_client.dart';

import '../support/fake_api.dart';
import '../support/live_fixtures.dart';

void main() {
  const base = '/api/v1/live-practice';

  test('ready', () async {
    final fake = FakeApi()
      ..on(
        'GET',
        '$base/ready',
        const FakeReply.ok({
          'ready': false,
          'reason': 'Save an OpenAI key first.',
        }),
      );
    final ready = await fake.client().livePracticeReady();
    expect(ready.ready, isFalse);
    expect(ready.reason, 'Save an OpenAI key first.');
  });

  test('list', () async {
    final fake = FakeApi()
      ..on(
        'GET',
        base,
        FakeReply.ok({
          'sessions': [
            liveSummaryJson(),
            liveSummaryJson(id: 's2', status: 'ACTIVE', exchanges: 0),
          ],
        }),
      );
    final sessions = await fake.client().listLivePractice();
    expect(sessions.map((s) => s.id), ['s1', 's2']);
    expect(sessions.first.exchanges, 3);
    expect(sessions.last.status, LiveStatus.active);
  });

  test('start sends the prep, technologies, title and answerFor', () async {
    final fake = FakeApi()..on('POST', base, FakeReply(201, liveViewJson()));
    final api = fake.client();
    final view = await api.startLivePractice(
      technologies: [' React ', '', 'SQL'],
      title: ' Evening ',
      answerFor: AnswerFor.neutral,
    );
    expect(view.id, 's1');
    expect(fake.requests.single.body, {
      'technologies': ['React', 'SQL'],
      'title': 'Evening',
      'answerFor': 'neutral',
    });

    await api.startLivePractice(prepId: 'p1');
    expect(fake.requests.last.body, {'prepId': 'p1', 'answerFor': 'me'});
  });

  test('start without a key is a 400 with its detail', () async {
    final fake = FakeApi()
      ..on(
        'POST',
        base,
        FakeReply.problem(
          400,
          'bad-request',
          'Bad request',
          detail: 'Save your OpenAI key in Settings → AI first.',
        ),
      );
    await expectLater(
      fake.client().startLivePractice(),
      throwsA(
        isA<ApiException>().having(
          liveErrorMessage,
          'message',
          'Save your OpenAI key in Settings → AI first.',
        ),
      ),
    );
  });

  test('get, patch, end and delete', () async {
    final fake = FakeApi()
      ..on('GET', '$base/s1', FakeReply.ok(liveViewJson()))
      ..on(
        'PATCH',
        '$base/s1',
        FakeReply.ok(liveViewJson(answerFor: 'neutral')),
      )
      ..on('POST', '$base/s1/end', FakeReply.ok(liveViewJson(status: 'ENDED')))
      ..on('DELETE', '$base/s1', const FakeReply(204));
    final api = fake.client();
    expect((await api.getLivePractice('s1')).id, 's1');
    expect(
      (await api.updateLivePractice(
        's1',
        answerFor: AnswerFor.neutral,
      )).answerFor,
      AnswerFor.neutral,
    );
    expect(fake.requests.last.body, {'answerFor': 'neutral'});
    await api.updateLivePractice('s1', title: ' Mock night ');
    expect(fake.requests.last.body, {'title': 'Mock night'});
    expect((await api.endLivePractice('s1')).isEnded, isTrue);
    await api.deleteLivePractice('s1');
    expect(fake.requests.map((r) => '${r.method} ${r.path}'), [
      'GET $base/s1',
      'PATCH $base/s1',
      'PATCH $base/s1',
      'POST $base/s1/end',
      'DELETE $base/s1',
    ]);
  });

  test('a realtime pass is a POST to /realtime', () async {
    final fake = FakeApi()
      ..on('POST', '$base/s1/realtime', FakeReply.ok(realtimePassJson()));
    final pass = await fake.client().livePracticeRealtime('s1');
    expect(pass.clientSecret, 'ek_test1');
    expect(pass.url, startsWith('wss://api.openai.com/v1/realtime'));
    expect(fake.requests.single.method, 'POST');
    expect(fake.requests.single.path, '$base/s1/realtime');
  });

  test('OpenAI refusing the pass is a 503 with its own message', () async {
    final fake = FakeApi()
      ..on(
        'POST',
        '$base/s1/realtime',
        FakeReply.problem(
          503,
          'ai-unavailable',
          'AI unavailable',
          detail: 'Incorrect API key provided: sk-abc***.',
        ),
      );
    await expectLater(
      fake.client().livePracticeRealtime('s1'),
      throwsA(
        isA<ApiException>().having(
          liveErrorMessage,
          'message',
          'Incorrect API key provided: sk-abc***.',
        ),
      ),
    );
  });

  test('an exchange is saved with its question and answer, trimmed and cut to the limits', () async {
    final fake = FakeApi()
      ..on('POST', '$base/s1/exchanges', FakeReply(201, liveExchangeJson()));
    final api = fake.client();
    final saved = await api.saveLivePracticeExchange(
      's1',
      question: '  What is a closure?  ',
      answer: ' A function with its scope. ',
    );
    expect(saved.id, 'x1');
    expect(fake.requests.single.path, '$base/s1/exchanges');
    expect(fake.requests.single.body, {
      'question': 'What is a closure?',
      'answer': 'A function with its scope.',
    });

    await api.saveLivePracticeExchange(
      's1',
      question: 'q' * 2500,
      answer: 'a' * 9000,
    );
    final body = fake.requests.last.body as Map;
    expect((body['question'] as String).length, 2000);
    expect((body['answer'] as String).length, 8000);
  });
}
