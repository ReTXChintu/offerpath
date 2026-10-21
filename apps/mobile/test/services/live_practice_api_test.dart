import 'dart:convert';

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
            liveSummaryJson(id: 's2', status: 'ACTIVE'),
          ],
        }),
      );
    final sessions = await fake.client().listLivePractice();
    expect(sessions.map((s) => s.id), ['s1', 's2']);
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

  test(
    'audio goes as base64 with its name and length, and waits long',
    () async {
      final fake = FakeApi()
        ..on('POST', '$base/s1/audio', FakeReply.ok(liveViewJson()));
      await fake.client().sendLivePracticeAudio('s1', [
        1,
        2,
        3,
        4,
      ], durationMs: 2400);
      final request = fake.requests.single;
      expect(request.body, {
        'audioBase64': base64Encode([1, 2, 3, 4]),
        'fileName': 'segment.m4a',
        'durationMs': 2400,
      });
      expect(request.receiveTimeout, ApiClient.aiTimeout);
    },
  );

  test('text and grade', () async {
    final fake = FakeApi()
      ..on('POST', '$base/s1/text', FakeReply.ok(liveViewJson()))
      ..on(
        'POST',
        '$base/s1/questions/lq1/grade',
        FakeReply.ok(
          liveViewJson(
            questions: [liveQuestionJson(spokenAnswer: 'x', score: 8)],
          ),
        ),
      );
    final api = fake.client();
    await api.sendLivePracticeText('s1', '  What is a closure?  ');
    expect(fake.requests.single.body, {'text': 'What is a closure?'});
    final graded = await api.gradeLivePracticeQuestion('s1', 'lq1');
    expect(graded.questions.single.score, 8);
    expect(fake.requests.last.path, '$base/s1/questions/lq1/grade');
  });

  test(
    'a 503 on audio is an ApiException the screen words as OpenAI',
    () async {
      final fake = FakeApi()
        ..on(
          'POST',
          '$base/s1/audio',
          FakeReply.problem(
            503,
            'ai-unavailable',
            'AI unavailable',
            detail: 'OpenAI is not answering right now.',
          ),
        );
      await expectLater(
        fake.client().sendLivePracticeAudio('s1', [1], durationMs: 1500),
        throwsA(
          isA<ApiException>().having(
            liveErrorMessage,
            'message',
            'OpenAI is not answering right now.',
          ),
        ),
      );
    },
  );
}
