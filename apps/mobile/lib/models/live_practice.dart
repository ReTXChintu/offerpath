/// Live practice: two people practise interviews face to face with the phone
/// on the table. The phone records, the API transcribes and finds the
/// questions, writes an AI answer for each, and grades the spoken answers.
/// Mirrors the API's `LivePracticeView` (`docs/live-practice.md`). Every
/// field is read defensively: the server can be a version ahead of this app.
library;

import '../services/api_client.dart';
import 'json.dart';

/// Who the AI answers are written for: the user (from the prep's CV, else
/// the synced profile) or a neutral candidate (no CV).
enum AnswerFor { me, neutral }

enum LineKind { question, answer, other }

enum LiveStatus { active, ended }

AnswerFor answerForOf(dynamic v) =>
    str(v).toLowerCase() == 'neutral' ? AnswerFor.neutral : AnswerFor.me;

/// The wire value: `me` | `neutral`.
String answerForValue(AnswerFor a) => switch (a) {
  AnswerFor.me => 'me',
  AnswerFor.neutral => 'neutral',
};

String answerForLabel(AnswerFor a) => switch (a) {
  AnswerFor.me => 'Me',
  AnswerFor.neutral => 'Neutral',
};

LineKind lineKindOf(dynamic v) => switch (str(v).toUpperCase()) {
  'QUESTION' => LineKind.question,
  'ANSWER' => LineKind.answer,
  _ => LineKind.other,
};

LiveStatus liveStatusOf(dynamic v) =>
    str(v).toUpperCase() == 'ENDED' ? LiveStatus.ended : LiveStatus.active;

/// The sentence to show for a failed live-practice call. A 503 here means
/// OpenAI failed (never the desktop), so it doesn't use
/// [ApiException.message]'s desktop-offline wording.
String liveErrorMessage(Object? error) {
  if (error is ApiException) {
    if (error.isNetwork) return error.title;
    if (error.status == 503 || error.kind == 'ai-unavailable') {
      final detail = error.detail?.trim() ?? '';
      return detail.isNotEmpty ? detail : "OpenAI didn't answer in time.";
    }
    return error.message;
  }
  return "Couldn't reach the Offerpath server. Check your connection.";
}

/// `GET /live-practice/ready`.
class LiveReady {
  const LiveReady({required this.ready, this.reason});

  factory LiveReady.fromJson(Map<String, dynamic> j) =>
      LiveReady(ready: boolOf(j['ready']), reason: optStr(j['reason']));

  final bool ready;

  /// Why it can't start (no OpenAI key saved, ...).
  final String? reason;
}

/// One transcribed line.
class LiveLine {
  const LiveLine({
    required this.id,
    required this.order,
    required this.text,
    required this.kind,
    this.questionId,
    this.createdAt,
  });

  factory LiveLine.fromJson(Map<String, dynamic> j) => LiveLine(
    id: str(j['id']),
    order: intOf(j['order']),
    text: str(j['text']),
    kind: lineKindOf(j['kind']),
    questionId: optStr(j['questionId']),
    createdAt: dateOf(j['createdAt']),
  );

  final String id;
  final int order;
  final String text;
  final LineKind kind;

  /// The question this line asks or answers; null for OTHER lines.
  final String? questionId;
  final DateTime? createdAt;
}

/// The AI's answer to a question, for comparison.
class LiveAiAnswer {
  const LiveAiAnswer({
    required this.summary,
    required this.points,
    required this.detail,
  });

  factory LiveAiAnswer.fromJson(Map<String, dynamic> j) => LiveAiAnswer(
    summary: str(j['summary']),
    points: strList(j['points']).where((p) => p.trim().isNotEmpty).toList(),
    detail: str(j['detail']),
  );

  static const empty = LiveAiAnswer(summary: '', points: [], detail: '');

  final String summary;
  final List<String> points;

  /// A fuller answer in markdown; '' when there is nothing to add.
  final String detail;

  bool get isEmpty =>
      summary.trim().isEmpty && points.isEmpty && detail.trim().isEmpty;
}

/// How a spoken answer compared with the AI answer.
class LiveFeedback {
  const LiveFeedback({
    required this.covered,
    required this.missed,
    required this.feedback,
  });

  factory LiveFeedback.fromJson(Map<String, dynamic> j) => LiveFeedback(
    covered: strList(j['covered']),
    missed: strList(j['missed']),
    feedback: str(j['feedback']),
  );

  final List<String> covered;
  final List<String> missed;
  final String feedback;
}

/// One question asked during the session.
class LiveQuestion {
  const LiveQuestion({
    required this.id,
    required this.order,
    required this.text,
    required this.answerFor,
    required this.aiAnswer,
    this.spokenAnswer,
    this.score,
    this.feedback,
    this.grading = false,
    this.gradedAt,
    this.createdAt,
  });

  factory LiveQuestion.fromJson(Map<String, dynamic> j) {
    final ai = asMap(j['aiAnswer']);
    final fb = asMap(j['feedback']);
    return LiveQuestion(
      id: str(j['id']),
      order: intOf(j['order']),
      text: str(j['text']),
      answerFor: answerForOf(j['answerFor']),
      aiAnswer: ai == null ? LiveAiAnswer.empty : LiveAiAnswer.fromJson(ai),
      spokenAnswer: optStr(j['spokenAnswer']),
      score: doubleOrNull(j['score']),
      feedback: fb == null ? null : LiveFeedback.fromJson(fb),
      grading: boolOf(j['grading']),
      gradedAt: dateOf(j['gradedAt']),
      createdAt: dateOf(j['createdAt']),
    );
  }

  final String id;

  /// 0-based.
  final int order;
  final String text;
  final AnswerFor answerFor;
  final LiveAiAnswer aiAnswer;

  /// The ANSWER lines joined; null before anyone answered.
  final String? spokenAnswer;

  /// 0-10 once graded.
  final double? score;
  final LiveFeedback? feedback;

  /// A grade is being written now.
  final bool grading;
  final DateTime? gradedAt;
  final DateTime? createdAt;

  bool get hasSpokenAnswer =>
      spokenAnswer != null && spokenAnswer!.trim().isNotEmpty;
  bool get isGraded => score != null;

  /// "Grade now" makes sense: answered, not graded, not being graded.
  bool get canGrade => hasSpokenAnswer && !isGraded && !grading;
}

class LiveStats {
  const LiveStats({
    required this.questions,
    required this.graded,
    this.averageScore,
  });

  factory LiveStats.fromJson(Map<String, dynamic> j) => LiveStats(
    questions: intOf(j['questions']),
    graded: intOf(j['graded']),
    averageScore: doubleOrNull(j['averageScore']),
  );

  static const empty = LiveStats(questions: 0, graded: 0);

  final int questions;
  final int graded;
  final double? averageScore;
}

/// A whole live-practice session, as every mutating route returns it.
class LivePracticeView {
  const LivePracticeView({
    required this.id,
    this.prepId,
    required this.title,
    required this.technologies,
    required this.answerFor,
    required this.status,
    required this.lines,
    required this.questions,
    required this.stats,
    this.createdAt,
    this.endedAt,
  });

  factory LivePracticeView.fromJson(Map<String, dynamic> j) {
    final lines = mapList(j['lines']).map(LiveLine.fromJson).toList()
      ..sort((a, b) => a.order.compareTo(b.order));
    final questions =
        mapList(j['questions']).map(LiveQuestion.fromJson).toList()
          ..sort((a, b) => a.order.compareTo(b.order));
    final stats = asMap(j['stats']);
    return LivePracticeView(
      id: str(j['id']),
      prepId: optStr(j['prepId']),
      title: str(j['title'], 'Live practice'),
      technologies: strList(j['technologies']),
      answerFor: answerForOf(j['answerFor']),
      status: liveStatusOf(j['status']),
      lines: lines,
      questions: questions,
      stats: stats == null ? LiveStats.empty : LiveStats.fromJson(stats),
      createdAt: dateOf(j['createdAt']),
      endedAt: dateOf(j['endedAt']),
    );
  }

  final String id;
  final String? prepId;
  final String title;
  final List<String> technologies;
  final AnswerFor answerFor;
  final LiveStatus status;

  /// Oldest first.
  final List<LiveLine> lines;

  /// Oldest first.
  final List<LiveQuestion> questions;
  final LiveStats stats;
  final DateTime? createdAt;
  final DateTime? endedAt;

  bool get isEnded => status == LiveStatus.ended;
  bool get isActive => status == LiveStatus.active;

  /// Some grade is being written: worth checking again.
  bool get anyGrading => questions.any((q) => q.grading);

  /// The question after [q], if any.
  bool hasNewerQuestion(LiveQuestion q) =>
      questions.any((other) => other.order > q.order);
}

/// One row of `GET /live-practice`.
class LivePracticeSummary {
  const LivePracticeSummary({
    required this.id,
    this.prepId,
    required this.title,
    required this.status,
    required this.stats,
    this.createdAt,
    this.endedAt,
  });

  factory LivePracticeSummary.fromJson(Map<String, dynamic> j) {
    final stats = asMap(j['stats']);
    return LivePracticeSummary(
      id: str(j['id']),
      prepId: optStr(j['prepId']),
      title: str(j['title'], 'Live practice'),
      status: liveStatusOf(j['status']),
      stats: stats == null ? LiveStats.empty : LiveStats.fromJson(stats),
      createdAt: dateOf(j['createdAt']),
      endedAt: dateOf(j['endedAt']),
    );
  }

  final String id;
  final String? prepId;
  final String title;
  final LiveStatus status;
  final LiveStats stats;
  final DateTime? createdAt;
  final DateTime? endedAt;
}
