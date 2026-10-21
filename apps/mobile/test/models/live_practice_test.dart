import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/models/live_practice.dart';
import 'package:offerpath_mobile/services/api_client.dart';

import '../support/live_fixtures.dart';

void main() {
  test('a full LivePracticeView parses', () {
    final view = LivePracticeView.fromJson(
      liveViewJson(
        prepId: 'p1',
        answerFor: 'neutral',
        averageScore: 6.5,
        questions: [
          liveQuestionJson(
            id: 'q2',
            order: 1,
            text: 'Why React?',
            grading: true,
            spokenAnswer: 'Components.',
          ),
          liveQuestionJson(spokenAnswer: 'It keeps variables.', score: 6.5),
        ],
        lines: [
          liveLineJson(
            id: 'l3',
            order: 2,
            text: 'Okay, next one.',
            kind: 'OTHER',
            questionId: null,
          ),
          liveLineJson(),
          liveLineJson(
            id: 'l2',
            order: 1,
            text: 'It keeps variables.',
            kind: 'ANSWER',
          ),
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

    // Sorted by order.
    expect(view.lines.map((l) => l.id), ['l1', 'l2', 'l3']);
    expect(view.lines[0].kind, LineKind.question);
    expect(view.lines[1].kind, LineKind.answer);
    expect(view.lines[1].questionId, 'lq1');
    expect(view.lines[2].kind, LineKind.other);
    expect(view.lines[2].questionId, isNull);

    expect(view.questions.map((q) => q.id), ['lq1', 'q2']);
    final q = view.questions.first;
    expect(q.text, 'What is a closure in JavaScript?');
    expect(q.answerFor, AnswerFor.me);
    expect(q.aiAnswer.summary, startsWith('A function bundled'));
    expect(q.aiAnswer.points, hasLength(2));
    expect(q.aiAnswer.detail, contains('**closures**'));
    expect(q.spokenAnswer, 'It keeps variables.');
    expect(q.score, 6.5);
    expect(q.isGraded, isTrue);
    expect(q.canGrade, isFalse);
    expect(q.feedback!.covered, [
      'Inner functions keep access to outer variables',
    ]);
    expect(q.feedback!.missed, ['Used for private state']);
    expect(q.feedback!.feedback, 'Clear, but give an example.');
    expect(q.gradedAt, DateTime.utc(2026, 10, 21, 10, 5));

    final q2 = view.questions.last;
    expect(q2.grading, isTrue);
    expect(q2.score, isNull);
    expect(q2.feedback, isNull);
    expect(view.anyGrading, isTrue);
    expect(view.hasNewerQuestion(q), isTrue);
    expect(view.hasNewerQuestion(q2), isFalse);

    expect(view.stats.questions, 2);
    expect(view.stats.graded, 1);
    expect(view.stats.averageScore, 6.5);
  });

  test('an ended view, and a sparse one, parse without throwing', () {
    final ended = LivePracticeView.fromJson(liveViewJson(status: 'ENDED'));
    expect(ended.isEnded, isTrue);
    expect(ended.endedAt, isNotNull);

    final sparse = LivePracticeView.fromJson(const {'id': 's9'});
    expect(sparse.title, 'Live practice');
    expect(sparse.answerFor, AnswerFor.me);
    expect(sparse.lines, isEmpty);
    expect(sparse.questions, isEmpty);
    expect(sparse.stats.averageScore, isNull);

    final q = LiveQuestion.fromJson(const {
      'id': 'q',
      'text': 'Hi?',
      'spokenAnswer': 'Yes',
    });
    expect(q.aiAnswer.isEmpty, isTrue);
    expect(q.canGrade, isTrue);
  });

  test('summaries and readiness', () {
    final s = LivePracticeSummary.fromJson(liveSummaryJson());
    expect(s.title, 'React, Node.js');
    expect(s.status, LiveStatus.ended);
    expect(s.stats.questions, 3);
    expect(s.stats.averageScore, 7.5);

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

  test('a 503 from live practice talks about OpenAI, not the desktop', () {
    const e = ApiException(
      status: 503,
      type: 'urn:offerpath:error:ai-unavailable',
      title: 'AI unavailable',
      detail: 'OpenAI did not answer.',
    );
    expect(liveErrorMessage(e), 'OpenAI did not answer.');
    const bare = ApiException(
      status: 503,
      type: 'urn:offerpath:error:unavailable',
      title: 'Unavailable',
    );
    expect(liveErrorMessage(bare), "OpenAI didn't answer in time.");
    const ended = ApiException(
      status: 409,
      type: 'urn:offerpath:error:conflict',
      title: 'Conflict',
      detail: 'This session has ended.',
    );
    expect(liveErrorMessage(ended), 'This session has ended.');
  });
}
