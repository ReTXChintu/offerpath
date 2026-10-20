import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/models/interview_prep.dart';
import 'package:offerpath_mobile/models/mock_interview.dart';
import 'package:offerpath_mobile/services/api_client.dart';

import '../support/fake_api.dart';
import '../support/mock_fixtures.dart';
import '../support/prep_fixtures.dart';

void main() {
  group('CV helpers', () {
    test('extract sends the file as base64 and reads the text back', () async {
      final fake = FakeApi()
        ..on(
          'POST',
          '/api/v1/interview-preps/cv/extract',
          const FakeReply.ok({
            'text': 'Jane Doe, engineer',
            'fileName': 'cv.pdf',
            'chars': 18,
          }),
        );
      final cv = await fake.client().extractCv(
        'cv.pdf',
        utf8.encode('%PDF-1.4'),
      );
      expect(fake.requests.single.body, {
        'fileName': 'cv.pdf',
        'contentBase64': base64Encode(utf8.encode('%PDF-1.4')),
      });
      expect(cv.text, 'Jane Doe, engineer');
      expect(cv.fileName, 'cv.pdf');
      expect(cv.chars, 18);
    });

    test(
      'a file with no text is a validation error with its message',
      () async {
        final fake = FakeApi()
          ..on(
            'POST',
            '/api/v1/interview-preps/cv/extract',
            FakeReply.problem(
              400,
              'validation-failed',
              'Validation failed',
              errors: {
                'contentBase64': ['No text came out of this file.'],
              },
            ),
          );
        await expectLater(
          fake.client().extractCv('scan.pdf', [1, 2, 3]),
          throwsA(
            isA<ApiException>().having(
              (e) => prepErrorMessage(e),
              'message',
              'No text came out of this file.',
            ),
          ),
        );
      },
    );

    test('the profile CV, or null when there is none', () async {
      final fake = FakeApi()
        ..on(
          'GET',
          '/api/v1/interview-preps/cv/profile',
          const FakeReply.ok({'text': 'From the profile'}),
        );
      expect(await fake.client().profileCv(), 'From the profile');
      fake.on(
        'GET',
        '/api/v1/interview-preps/cv/profile',
        const FakeReply.ok({'text': null}),
      );
      expect(await fake.client().profileCv(), isNull);
    });
  });

  group('prep create and update', () {
    test('create sends DSA and the CV', () async {
      final fake = FakeApi()
        ..on(
          'POST',
          '/api/v1/interview-preps',
          FakeReply.ok(prepJson(status: 'GENERATING')),
        );
      await fake.client().createPrep(
        technologies: ['Go'],
        scheduledAt: DateTime(2026, 11, 3, 10),
        includeDsa: true,
        resume: const PrepResume(
          source: PrepResumeSource.upload,
          text: 'CV text',
          fileName: 'cv.pdf',
        ),
      );
      final body = fake.requests.single.body as Map;
      expect(body['includeDsa'], isTrue);
      expect(body['resume'], {
        'text': 'CV text',
        'source': 'upload',
        'fileName': 'cv.pdf',
      });
    });

    test('update sends only what changed, and null to remove the CV', () async {
      final fake = FakeApi()
        ..on(
          'PATCH',
          '/api/v1/interview-preps/p1',
          FakeReply.ok(prepJson(status: 'GENERATING')),
        );
      final api = fake.client();
      await api.updatePrep(
        'p1',
        jobDescription: ' New JD ',
        technologies: ['Go', 'Kafka'],
        includeDsa: false,
      );
      expect(fake.requests.last.body, {
        'jobDescription': 'New JD',
        'technologies': ['Go', 'Kafka'],
        'includeDsa': false,
      });
      await api.updatePrep('p1', removeResume: true);
      expect(fake.requests.last.body, {'resume': null});
      await api.updatePrep(
        'p1',
        resume: const PrepResume(
          source: PrepResumeSource.pasted,
          text: 'Pasted',
        ),
      );
      expect(fake.requests.last.body, {
        'resume': {'text': 'Pasted', 'source': 'pasted', 'fileName': null},
      });
    });
  });

  group('mock interview calls', () {
    test(
      'start, get, answer, reply, finish, report and delete hit their paths',
      () async {
        final fake = FakeApi()
          ..on(
            'POST',
            '/api/v1/interview-preps/p1/mock-interviews',
            FakeReply.ok(mockInterviewJson()),
          )
          ..on(
            'GET',
            '/api/v1/mock-interviews/m1',
            FakeReply.ok(mockInterviewJson()),
          )
          ..on(
            'POST',
            '/api/v1/mock-interviews/m1/answer',
            FakeReply.ok(mockInterviewJson()),
          )
          ..on(
            'POST',
            '/api/v1/mock-interviews/m1/reply',
            FakeReply.ok(mockInterviewJson()),
          )
          ..on(
            'POST',
            '/api/v1/mock-interviews/m1/finish',
            FakeReply.ok(mockInterviewJson(status: 'REPORTING')),
          )
          ..on(
            'POST',
            '/api/v1/mock-interviews/m1/report',
            FakeReply.ok(mockInterviewJson(status: 'REPORTING')),
          )
          ..on('DELETE', '/api/v1/mock-interviews/m1', const FakeReply(204));
        final api = fake.client();

        expect((await api.startMockInterview('p1')).id, 'm1');
        expect(fake.requests.last.body, isEmpty);
        await api.startMockInterview('p1', restart: true);
        expect(fake.requests.last.body, {'restart': true});

        expect((await api.getMockInterview('m1')).turns, hasLength(5));

        await api.answerMockInterview('m1', text: '  My answer  ');
        expect(fake.requests.last.body, {'text': 'My answer'});
        await api.answerMockInterview(
          'm1',
          text: '',
          code: 'print(1)',
          codeLanguage: 'python',
        );
        expect(fake.requests.last.body, {
          'code': 'print(1)',
          'codeLanguage': 'python',
        });
        await api.answerMockInterview(
          'm1',
          text: 'Approach',
          code: '   ',
          codeLanguage: 'python',
        );
        expect(fake.requests.last.body, {
          'text': 'Approach',
        }, reason: 'blank code is not sent');

        await api.replyMockInterview('m1');
        expect(fake.requests.last.path, '/api/v1/mock-interviews/m1/reply');
        expect(
          (await api.finishMockInterview('m1')).status,
          MockStatus.reporting,
        );
        expect((await api.retryMockReport('m1')).isReporting, isTrue);
        await api.deleteMockInterview('m1');
        expect(fake.requests.last.method, 'DELETE');
      },
    );

    test('answer and reply wait long enough for the interviewer (at least 2 minutes)', () async {
      final fake = FakeApi()
        ..on(
          'POST',
          '/api/v1/mock-interviews/m1/answer',
          FakeReply.ok(mockInterviewJson()),
        )
        ..on(
          'POST',
          '/api/v1/mock-interviews/m1/reply',
          FakeReply.ok(mockInterviewJson()),
        );
      final api = fake.client();
      await api.answerMockInterview('m1', text: 'x');
      await api.replyMockInterview('m1');
      for (final r in fake.requests) {
        expect(
          r.receiveTimeout,
          greaterThanOrEqualTo(const Duration(seconds: 120)),
          reason: r.path,
        );
      }
    });

    test('503 ai-unavailable reads as the AI-offline sentence', () async {
      final fake = FakeApi()
        ..on(
          'POST',
          '/api/v1/mock-interviews/m1/answer',
          FakeReply.problem(503, 'ai-unavailable', 'AI assistance unavailable'),
        );
      try {
        await fake.client().answerMockInterview('m1', text: 'x');
        fail('should throw');
      } on ApiException catch (e) {
        expect(prepErrorMessage(e), prepAiOfflineMessage);
      }
    });
  });
}
