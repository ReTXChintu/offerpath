import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/models/interview_prep.dart';
import 'package:offerpath_mobile/models/mock_interview.dart';

import '../support/mock_fixtures.dart';
import '../support/prep_fixtures.dart';

void main() {
  group('MockInterview.fromJson', () {
    test('reads a whole completed interview, its turns and its report', () {
      final m = MockInterview.fromJson(mockInterviewJson(status: 'COMPLETED'));
      expect(m.id, 'm1');
      expect(m.prepId, 'p1');
      expect(m.status, MockStatus.completed);
      expect(m.isCompleted, isTrue);
      expect(m.stage, MockStage.wrapUp);
      expect(m.stages, [
        MockStage.intro,
        MockStage.technical,
        MockStage.coding,
        MockStage.wrapUp,
      ]);
      expect(m.aiSource, 'desktop');
      expect(m.answered, 3);
      expect(m.overallScore, 7.5);
      expect(m.startedAt, DateTime.utc(2026, 10, 20, 10));
      expect(m.endedAt, DateTime.utc(2026, 10, 20, 10, 30));
      expect(m.needsPolling, isFalse);

      expect(m.turns.map((t) => t.order), [0, 1, 2, 3, 4, 5, 6]);
      final opening = m.turns.first;
      expect(opening.isInterviewer, isTrue);
      expect(opening.kind, 'OPENING');
      expect(opening.stage, MockStage.intro);

      final intro = m.turns[1];
      expect(intro.isCandidate, isTrue);
      expect(intro.language!.ok, isFalse);
      expect(intro.language!.corrections.single.original, 'I has');
      expect(intro.language!.corrections.single.corrected, 'I have');
      expect(
        intro.language!.corrections.single.note,
        startsWith('Subject-verb'),
      );
      expect(intro.assessment!.verdict, 'CORRECT');
      expect(m.turns[3].language!.ok, isTrue);

      final coding = m.turns[4];
      expect(coding.isCodingQuestion, isTrue);
      expect(coding.problem!.title, 'Two Sum');
      expect(coding.problem!.examples.single.output, '[0,1]');
      expect(
        coding.problem!.examples.single.explanation,
        'nums[0] + nums[1] == 9',
      );
      expect(coding.problem!.constraints, hasLength(2));
      final code = m.turns[5];
      expect(code.code, startsWith('def two_sum'));
      expect(code.codeLanguage, 'python');

      final r = m.report!;
      expect(r.overallScore, 7.5);
      expect(r.verdict, 'LEAN_HIRE');
      expect(mockVerdictLabel(r.verdict), 'Lean hire');
      expect(mockVerdictIsPositive(r.verdict), isTrue);
      expect(r.summary, startsWith('Solid React'));
      expect(r.dimensions.map((d) => d.name), [
        'SELF_PRESENTATION',
        'TECHNICAL_DEPTH',
        'CODING',
      ]);
      expect(r.dimensions.last.score, 9);
      expect(r.questions.map((q) => q.turnOrder), [
        0,
        2,
        4,
      ], reason: 'sorted by turn');
      expect(r.language.score, 7);
      expect(r.language.patterns, ['Subject-verb agreement']);
      expect(r.strengths, ['Clean code']);
      expect(r.improvements, ['Depth on React internals']);
      expect(r.nextSteps, ['Read about keys and reconciliation']);
    });

    test('pairs each reviewed question with its interviewer turn and the answer after it', () {
      final items = MockInterview.fromJson(
        mockInterviewJson(status: 'COMPLETED'),
      ).reviewItems;
      expect(items, hasLength(3));
      expect(items[0].question!.text, 'Tell me about yourself.');
      expect(
        items[0].answer!.text,
        'I has five years of experience with React.',
      );
      expect(items[1].question!.order, 2);
      expect(items[1].answer!.order, 3);
      expect(items[2].question!.problem!.title, 'Two Sum');
      expect(items[2].answer!.code, isNotNull);
      expect(items[2].answer!.assessment!.verdict, 'STRONG');
    });

    test(
      'in progress: the current question, coding mode and the reply states',
      () {
        final m = MockInterview.fromJson(mockInterviewJson());
        expect(m.isInProgress, isTrue);
        expect(m.canAnswer, isTrue);
        expect(m.currentQuestion!.order, 4);
        expect(m.isCodingQuestion, isTrue);
        expect(m.report, isNull);
        expect(m.reviewItems, isEmpty);

        final failed = MockInterview.fromJson(
          mockInterviewJson(awaitingReply: true, error: 'AI unavailable'),
        );
        expect(failed.replyFailed, isTrue);
        expect(failed.canAnswer, isFalse);
        expect(failed.needsPolling, isFalse);

        final replying = MockInterview.fromJson(
          mockInterviewJson(awaitingReply: true, replying: true),
        );
        expect(replying.replyFailed, isFalse);
        expect(replying.needsPolling, isTrue);
        expect(
          MockInterview.fromJson(mockInterviewJson(status: 'REPORTING'))
              .needsPolling,
          isTrue,
        );
      },
    );

    test('odd or missing fields fall back instead of throwing', () {
      final m = MockInterview.fromJson({
        'id': 'x',
        'status': 'SOMETHING_NEW',
        'stage': 7,
        'stages': 'nope',
        'turns': [
          {
            'order': '1',
            'kind': 'ANSWER',
            'text': 'hi',
            'language': {'corrections': 'x'},
          },
          'garbage',
          {
            'order': 0,
            'speaker': 'INTERVIEWER',
            'problem': {'examples': 3},
          },
        ],
        'report': {
          'dimensions': [{}],
          'questions': null,
          'language': null,
        },
      });
      expect(m.status, MockStatus.inProgress);
      expect(m.stage, MockStage.intro);
      expect(m.stages, defaultMockStages);
      expect(m.turns.map((t) => t.order), [0, 1]);
      expect(
        m.turns[1].isCandidate,
        isTrue,
        reason: 'no speaker: an ANSWER is the candidate',
      );
      expect(m.turns[1].language!.ok, isTrue);
      expect(m.turns[0].problem!.examples, isEmpty);
      expect(m.answered, 1);
      expect(m.report!.questions, isEmpty);
      expect(m.report!.language.score, isNull);
      expect(m.startedAt, isNotNull);
    });

    test('labels', () {
      expect(mockStageLabel(MockStage.wrapUp), 'Wrap-up');
      expect(mockDimensionLabel('PROBLEM_SOLVING'), 'Problem solving');
      expect(mockDimensionLabel('NEW_THING'), 'New thing');
      expect(mockAssessmentLabel('NO_ANSWER'), 'No answer');
      expect(mockVerdictLabel('NO_HIRE'), 'No hire');
      expect(mockVerdictIsPositive('LEAN_NO_HIRE'), isFalse);
    });
  });

  group('prep additions', () {
    test('a prep reads DSA, the CV and its mock interviews (newest first)', () {
      final prep = Prep.fromJson(
        prepJson(
          includeDsa: true,
          resume: {
            'source': 'upload',
            'fileName': 'cv.pdf',
            'chars': 12,
            'text': 'Jane Doe ...',
          },
          mockInterviews: [
            mockSummaryJson(id: 'old', startedAt: '2026-10-18T10:00:00.000Z'),
            mockSummaryJson(
              id: 'new',
              status: 'IN_PROGRESS',
              score: null,
              verdict: null,
              startedAt: '2026-10-20T10:00:00.000Z',
            ),
          ],
        ),
      );
      expect(prep.includeDsa, isTrue);
      expect(prep.resume!.source, PrepResumeSource.upload);
      expect(prep.resume!.fileName, 'cv.pdf');
      expect(prep.resume!.chars, 12);
      expect(prep.resume!.text, 'Jane Doe ...');
      expect(prep.mockInterviews.map((m) => m.id), ['new', 'old']);
      expect(prep.activeMockInterview!.id, 'new');
      expect(prep.mockInterviews.last.verdict, 'LEAN_HIRE');
      expect(prep.mockInterviews.last.overallScore, 7.5);
      // A graded practice answer keeps them.
      final next = prep.withQuestion(prep.questions.first);
      expect(next.includeDsa, isTrue);
      expect(next.resume, isNotNull);
      expect(next.mockInterviews, hasLength(2));
    });

    test(
      'an older server (no new fields) reads as no DSA, no CV, no interviews',
      () {
        final json = prepJson()
          ..remove('includeDsa')
          ..remove('resume')
          ..remove('mockInterviews');
        final prep = Prep.fromJson(json);
        expect(prep.includeDsa, isFalse);
        expect(prep.resume, isNull);
        expect(prep.mockInterviews, isEmpty);
        expect(prep.activeMockInterview, isNull);
      },
    );

    test('DSA questions have a label and a place', () {
      expect(prepKindLabel('DSA'), 'DSA');
      final prep = Prep.fromJson(
        prepJson(
          questions: [
            prepQuestionJson(id: 'a', kind: 'BEHAVIORAL'),
            prepQuestionJson(id: 'b', order: 1, kind: 'DSA'),
            prepQuestionJson(id: 'c', order: 2, kind: 'TECHNICAL'),
          ],
        ),
      );
      expect(prep.questionsByKind.map((g) => g.$1), [
        'TECHNICAL',
        'DSA',
        'BEHAVIORAL',
      ]);
    });

    test('a CV compares by source, text and file name', () {
      const a = PrepResume(source: PrepResumeSource.pasted, text: 'CV');
      expect(
        a.sameAs(
          const PrepResume(source: PrepResumeSource.pasted, text: ' CV '),
        ),
        isTrue,
      );
      expect(
        a.sameAs(
          const PrepResume(source: PrepResumeSource.profile, text: 'CV'),
        ),
        isFalse,
      );
      expect(a.sameAs(null), isFalse);
      expect(a.toJson(), {'text': 'CV', 'source': 'pasted', 'fileName': null});
    });

    test('CV files: type and size', () {
      expect(cvFileProblem('cv.PDF', 1000), isNull);
      expect(cvFileProblem('cv.docx', cvMaxBytes), isNull);
      expect(cvFileProblem('cv.doc', 10), contains('PDF'));
      expect(cvFileProblem('cv.pdf', cvMaxBytes + 1), contains('4 MB'));
      expect(cvFileProblem('cv.md', 0), 'That file is empty.');
    });
  });
}
