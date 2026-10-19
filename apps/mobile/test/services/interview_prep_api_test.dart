import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/models/interview_prep.dart';
import 'package:offerpath_mobile/services/api_client.dart';

import '../support/fake_api.dart';
import '../support/prep_fixtures.dart';

void main() {
  group('interview prep calls', () {
    test('lists preps from {preps: [...]} and reads every field', () async {
      final fake = FakeApi()
        ..on('GET', '/api/v1/interview-preps', FakeReply.ok({
          'preps': [
            prepJson(questions: [prepQuestionJson(score: 7.5, answer: 'Props and state.'), prepQuestionJson(id: 'q2', order: 1)]),
            prepJson(id: 'p2', status: 'GENERATING', company: null, role: null),
          ],
        }));
      final preps = await fake.client(token: 'tok').listPreps();
      expect(fake.requests.single.path, '/api/v1/interview-preps');
      expect(fake.requests.single.headers['Authorization'], 'Bearer tok');
      expect(preps, hasLength(2));

      final ready = preps.first;
      expect(ready.id, 'p1');
      expect(ready.title, 'Frontend developer at Acme');
      expect(ready.status, PrepStatus.ready);
      expect(ready.generatedBy, PrepAiSource.desktop);
      expect(ready.scheduledAt, DateTime.utc(2026, 10, 25, 5));
      expect(ready.technologies, ['React', 'TypeScript']);
      expect(ready.plan!.summary, startsWith('Expect React'));
      expect(ready.plan!.focusAreas.first.priority, 1);
      expect(ready.plan!.schedule.map((d) => d.day), [1, 2], reason: 'schedule sorted by day');
      expect(ready.progress.answered, 1);
      expect(ready.progress.total, 2);
      expect(ready.progress.averageScore, 7.5);
      final answered = ready.questions.first;
      expect(answered.isAnswered, isTrue);
      expect(answered.keyPoints, hasLength(3));
      expect(answered.feedback!.missed, ['Context change']);
      expect(ready.questions[1].keyPoints, isNull, reason: 'key points stay hidden until answered');

      final generating = preps[1];
      expect(generating.isGenerating, isTrue);
      expect(generating.plan, isNull);
      expect(generating.title, 'React, TypeScript', reason: 'no company or role: the technologies');
    });

    test('create sends the fields, the technologies and a local time with its offset', () async {
      final fake = FakeApi()..on('POST', '/api/v1/interview-preps', FakeReply.ok(prepJson(status: 'GENERATING')));
      final at = DateTime(2026, 11, 3, 10, 30);
      final prep = await fake.client().createPrep(company: ' Acme ', role: '', jobDescription: 'JD text', technologies: ['React'], scheduledAt: at);
      expect(prep.isGenerating, isTrue);
      final body = fake.requests.single.body as Map;
      expect(body['company'], 'Acme');
      expect(body['role'], isNull, reason: 'blank means absent');
      expect(body['jobDescription'], 'JD text');
      expect(body['technologies'], ['React']);
      final sent = body['scheduledAt'] as String;
      expect(sent, matches(RegExp(r'^2026-11-03T10:30:00[+-]\d\d:\d\d$')));
      expect(DateTime.parse(sent).isAtSameMomentAs(at), isTrue);
    });

    test('update, regenerate, delete and the AI source hit their paths', () async {
      final fake = FakeApi()
        ..on('PATCH', '/api/v1/interview-preps/p1', FakeReply.ok(prepJson()))
        ..on('POST', '/api/v1/interview-preps/p1/regenerate', FakeReply.ok(prepJson(status: 'GENERATING')))
        ..on('DELETE', '/api/v1/interview-preps/p1', const FakeReply(204))
        ..on('GET', '/api/v1/interview-preps/ai', const FakeReply.ok({'source': 'openai'}));
      final api = fake.client();
      await api.updatePrep('p1', scheduledAt: DateTime(2026, 11, 4, 9));
      expect((fake.requests.last.body as Map).keys, ['scheduledAt']);
      await api.updatePrep('p1', company: 'Beta', role: '');
      expect(fake.requests.last.body, {'company': 'Beta', 'role': null});
      expect((await api.regeneratePrep('p1')).isGenerating, isTrue);
      await api.deletePrep('p1');
      expect(fake.requests.last.method, 'DELETE');
      expect(await api.prepAiSource(), PrepAiSource.openai);

      fake.on('GET', '/api/v1/interview-preps/ai', const FakeReply.ok({'source': null}));
      expect(await api.prepAiSource(), isNull);
    });

    test('answering returns the graded question', () async {
      final fake = FakeApi()..on('POST', '/api/v1/interview-preps/p1/questions/q1/answer', FakeReply.ok(prepQuestionJson(score: 6, answer: 'Props.')));
      final q = await fake.client().answerPrepQuestion('p1', 'q1', '  Props.  ');
      expect(fake.requests.single.body, {'answer': 'Props.'});
      expect(q.score, 6);
      expect(q.feedback!.covered, ['State or props change']);
      expect(q.keyPoints, isNotEmpty);
    });

    test('a 503 ai-unavailable reads as the laptop-offline sentence', () async {
      final fake = FakeApi()..on('POST', '/api/v1/interview-preps/p1/questions/q1/answer', FakeReply.problem(503, 'ai-unavailable', 'AI assistance unavailable', detail: 'Your laptop is offline and no OpenAI fallback key is saved.'));
      try {
        await fake.client().answerPrepQuestion('p1', 'q1', 'x');
        fail('should throw');
      } on ApiException catch (e) {
        expect(e.kind, 'ai-unavailable');
        expect(isPrepAiUnavailable(e), isTrue);
        expect(prepErrorMessage(e), prepAiOfflineMessage);
      }
      expect(prepErrorMessage(const ApiException(status: 404, type: 'urn:offerpath:error:not-found', title: 'Not found', detail: 'Interview prep not found')), 'Interview prep not found');
    });
  });

  group('prep helpers', () {
    test('isoWithOffset keeps the wall-clock time and the offset', () {
      final at = DateTime(2026, 1, 5, 7, 5, 9);
      final iso = isoWithOffset(at);
      expect(iso, startsWith('2026-01-05T07:05:09'));
      expect(iso, matches(RegExp(r'[+-]\d\d:\d\d$')));
      expect(DateTime.parse(iso).isAtSameMomentAs(at), isTrue);
    });

    test('countdown', () {
      final now = DateTime(2026, 10, 19, 12);
      expect(prepCountdown(now.add(const Duration(minutes: 20)), now: now), 'in 20 min');
      expect(prepCountdown(now.add(const Duration(hours: 5)), now: now), 'in 5 h');
      expect(prepCountdown(DateTime(2026, 10, 20, 9), now: now), 'tomorrow');
      expect(prepCountdown(DateTime(2026, 10, 24, 9), now: now), 'in 5 days');
      expect(prepCountdown(now.subtract(const Duration(minutes: 30)), now: now), 'now');
      expect(prepCountdown(DateTime(2026, 10, 17, 12), now: now), '2 days ago');
    });

    test("Today's card shows the next 14 days, soonest first", () {
      final now = DateTime.utc(2026, 10, 19, 12);
      Prep at(String id, DateTime when) => Prep.fromJson(prepJson(id: id, scheduledAt: when.toIso8601String()));
      final list = upcomingPreps([
        at('far', now.add(const Duration(days: 20))),
        at('soon', now.add(const Duration(days: 2))),
        at('today', now.add(const Duration(hours: 2))),
        at('past', now.subtract(const Duration(days: 1))),
      ], now: now);
      expect(list.map((p) => p.id), ['today', 'soon']);
    });

    test('a graded answer updates the progress', () {
      final prep = Prep.fromJson(prepJson());
      expect(prep.progress.answered, 0);
      final next = prep.withQuestion(prep.questions.first.copyScored(8));
      expect(next.progress.answered, 1);
      expect(next.progress.averageScore, 8);
    });

    test('questions group by kind in a fixed order', () {
      final prep = Prep.fromJson(prepJson());
      expect(prep.questionsByKind.map((g) => g.$1), ['TECHNICAL', 'SYSTEM_DESIGN', 'BEHAVIORAL']);
      expect(prepKindLabel('SYSTEM_DESIGN'), 'System design');
    });
  });
}

extension on PrepQuestion {
  PrepQuestion copyScored(double score) => PrepQuestion(id: id, order: order, kind: kind, topic: topic, question: question, difficulty: difficulty, score: score, answer: 'x');
}
