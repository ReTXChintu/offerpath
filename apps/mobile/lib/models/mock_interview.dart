/// Mock interviews for an interview prep: a live, turn-by-turn conversation
/// with an AI interviewer, then a report. Mirrors the API's
/// `MockInterviewView` (`docs/mock-interview.md`). Every field is read
/// defensively: the server can be a version ahead of this app.
library;

import 'json.dart';

enum MockStage { intro, technical, coding, wrapUp }

enum MockStatus { inProgress, reporting, completed, failed, abandoned }

MockStage mockStageOf(dynamic v) => switch (str(v).toUpperCase()) {
  'TECHNICAL' => MockStage.technical,
  'CODING' => MockStage.coding,
  'WRAP_UP' => MockStage.wrapUp,
  _ => MockStage.intro,
};

MockStatus mockStatusOf(dynamic v) => switch (str(v).toUpperCase()) {
  'REPORTING' => MockStatus.reporting,
  'COMPLETED' => MockStatus.completed,
  'FAILED' => MockStatus.failed,
  'ABANDONED' => MockStatus.abandoned,
  _ => MockStatus.inProgress,
};

/// The default order of the progress bar, when the server sends none.
const defaultMockStages = [
  MockStage.intro,
  MockStage.technical,
  MockStage.coding,
  MockStage.wrapUp,
];

String mockStageLabel(MockStage stage) => switch (stage) {
  MockStage.intro => 'Intro',
  MockStage.technical => 'Technical',
  MockStage.coding => 'Coding',
  MockStage.wrapUp => 'Wrap-up',
};

String mockStatusLabel(MockStatus status) => switch (status) {
  MockStatus.inProgress => 'In progress',
  MockStatus.reporting => 'Writing report',
  MockStatus.completed => 'Completed',
  MockStatus.failed => 'Report failed',
  MockStatus.abandoned => 'Ended',
};

/// "Strong hire", "Lean no hire", ...: STRONG_HIRE | HIRE | LEAN_HIRE |
/// LEAN_NO_HIRE | NO_HIRE.
String mockVerdictLabel(String verdict) => switch (verdict) {
  'STRONG_HIRE' => 'Strong hire',
  'HIRE' => 'Hire',
  'LEAN_HIRE' => 'Lean hire',
  'LEAN_NO_HIRE' => 'Lean no hire',
  'NO_HIRE' => 'No hire',
  _ => _humanise(verdict),
};

/// Whether a hiring verdict is on the "hire" side.
bool mockVerdictIsPositive(String verdict) =>
    verdict == 'STRONG_HIRE' || verdict == 'HIRE' || verdict == 'LEAN_HIRE';

/// One answer's verdict: STRONG | CORRECT | PARTIAL | WRONG | NO_ANSWER.
String mockAssessmentLabel(String verdict) => switch (verdict) {
  'STRONG' => 'Strong',
  'CORRECT' => 'Correct',
  'PARTIAL' => 'Partly right',
  'WRONG' => 'Wrong',
  'NO_ANSWER' => 'No answer',
  _ => _humanise(verdict),
};

/// SELF_PRESENTATION | TECHNICAL_DEPTH | PROBLEM_SOLVING | CODING |
/// COMMUNICATION | LANGUAGE.
String mockDimensionLabel(String name) => switch (name) {
  'SELF_PRESENTATION' => 'Self-presentation',
  'TECHNICAL_DEPTH' => 'Technical depth',
  'PROBLEM_SOLVING' => 'Problem solving',
  'CODING' => 'Coding',
  'COMMUNICATION' => 'Communication',
  'LANGUAGE' => 'Language',
  _ => _humanise(name),
};

String _humanise(String s) {
  if (s.isEmpty) return s;
  final spaced = s.replaceAll('_', ' ').toLowerCase();
  return spaced[0].toUpperCase() + spaced.substring(1);
}

/// One grammar or wording fix under a candidate answer.
class LanguageFix {
  const LanguageFix({
    required this.original,
    required this.corrected,
    required this.note,
  });

  factory LanguageFix.fromJson(Map<String, dynamic> j) => LanguageFix(
    original: str(j['original']),
    corrected: str(j['corrected']),
    note: str(j['note']),
  );

  final String original;
  final String corrected;
  final String note;
}

/// The language feedback on a candidate turn; [ok] means nothing to fix.
class TurnLanguage {
  const TurnLanguage({required this.ok, required this.corrections});

  factory TurnLanguage.fromJson(Map<String, dynamic> j) {
    final corrections = mapList(j['corrections'])
        .map(LanguageFix.fromJson)
        .where((c) => c.original.isNotEmpty || c.corrected.isNotEmpty)
        .toList();
    // `ok` missing: nothing to fix means it's fine.
    return TurnLanguage(
      ok: j['ok'] == null ? corrections.isEmpty : boolOf(j['ok']),
      corrections: corrections,
    );
  }

  final bool ok;
  final List<LanguageFix> corrections;
}

/// How one candidate answer went (only once the interview is over).
class TurnAssessment {
  const TurnAssessment({required this.verdict, required this.note});

  factory TurnAssessment.fromJson(Map<String, dynamic> j) => TurnAssessment(
    verdict: str(j['verdict']).toUpperCase(),
    note: str(j['note']),
  );

  /// STRONG | CORRECT | PARTIAL | WRONG | NO_ANSWER
  final String verdict;
  final String note;
}

class CodingExample {
  const CodingExample({
    required this.input,
    required this.output,
    this.explanation,
  });

  factory CodingExample.fromJson(Map<String, dynamic> j) => CodingExample(
    input: str(j['input']),
    output: str(j['output']),
    explanation: optStr(j['explanation']),
  );

  final String input;
  final String output;
  final String? explanation;
}

/// The problem an interviewer CODING turn sets.
class CodingProblem {
  const CodingProblem({
    required this.title,
    required this.statement,
    required this.examples,
    required this.constraints,
  });

  factory CodingProblem.fromJson(Map<String, dynamic> j) => CodingProblem(
    title: str(j['title']),
    statement: str(j['statement']),
    examples: mapList(j['examples']).map(CodingExample.fromJson).toList(),
    constraints: strList(j['constraints']),
  );

  final String title;

  /// Markdown.
  final String statement;
  final List<CodingExample> examples;
  final List<String> constraints;
}

/// One turn of the conversation, the interviewer's or the candidate's.
class MockTurn {
  const MockTurn({
    required this.id,
    required this.order,
    required this.isInterviewer,
    required this.stage,
    required this.kind,
    required this.text,
    this.code,
    this.codeLanguage,
    this.problem,
    this.language,
    this.assessment,
    this.createdAt,
  });

  factory MockTurn.fromJson(Map<String, dynamic> j) {
    final kind = str(j['kind']).toUpperCase();
    final speaker = str(j['speaker']).toUpperCase();
    return MockTurn(
      id: str(j['id']),
      order: intOf(j['order']),
      // An unknown speaker: the candidate only ever answers.
      isInterviewer: speaker.isEmpty
          ? kind != 'ANSWER'
          : speaker == 'INTERVIEWER',
      stage: mockStageOf(j['stage']),
      kind: kind,
      text: str(j['text']),
      code: optStr(j['code']),
      codeLanguage: optStr(j['codeLanguage']),
      problem: asMap(j['problem']) == null
          ? null
          : CodingProblem.fromJson(asMap(j['problem'])!),
      language: asMap(j['language']) == null
          ? null
          : TurnLanguage.fromJson(asMap(j['language'])!),
      assessment: asMap(j['assessment']) == null
          ? null
          : TurnAssessment.fromJson(asMap(j['assessment'])!),
      createdAt: dateOf(j['createdAt']),
    );
  }

  final String id;

  /// 0-based, interleaved between the two speakers.
  final int order;
  final bool isInterviewer;
  final MockStage stage;

  /// OPENING | FOLLOW_UP | CROSS_QUESTION | NEW_QUESTION | CODING | CLOSING
  /// (interviewer), ANSWER (candidate).
  final String kind;

  /// Markdown for the interviewer.
  final String text;
  final String? code;
  final String? codeLanguage;
  final CodingProblem? problem;
  final TurnLanguage? language;
  final TurnAssessment? assessment;
  final DateTime? createdAt;

  bool get isCandidate => !isInterviewer;
  bool get isCodingQuestion =>
      isInterviewer && (kind == 'CODING' || problem != null);
}

class MockDimension {
  const MockDimension({
    required this.name,
    required this.score,
    required this.comment,
  });

  factory MockDimension.fromJson(Map<String, dynamic> j) => MockDimension(
    name: str(j['name']).toUpperCase(),
    score: doubleOrNull(j['score']) ?? 0,
    comment: str(j['comment']),
  );

  final String name;

  /// 0-10.
  final double score;
  final String comment;
}

/// The report's review of one question the interviewer asked.
class MockQuestionReview {
  const MockQuestionReview({
    required this.turnOrder,
    required this.question,
    required this.answerSummary,
    required this.score,
    required this.wentWell,
    required this.couldBeBetter,
    required this.strongerAnswer,
  });

  factory MockQuestionReview.fromJson(Map<String, dynamic> j) =>
      MockQuestionReview(
        turnOrder: intOf(j['turnOrder'], -1),
        question: str(j['question']),
        answerSummary: str(j['answerSummary']),
        score: doubleOrNull(j['score']) ?? 0,
        wentWell: str(j['wentWell']),
        couldBeBetter: str(j['couldBeBetter']),
        strongerAnswer: str(j['strongerAnswer']),
      );

  /// The interviewer turn's `order`; the answer is the next candidate turn.
  final int turnOrder;

  /// A short restatement.
  final String question;
  final String answerSummary;

  /// 0-10.
  final double score;
  final String wentWell;
  final String couldBeBetter;
  final String strongerAnswer;
}

class MockLanguageReport {
  const MockLanguageReport({
    required this.score,
    required this.patterns,
    required this.note,
  });

  factory MockLanguageReport.fromJson(Map<String, dynamic> j) =>
      MockLanguageReport(
        score: doubleOrNull(j['score']),
        patterns: strList(j['patterns']),
        note: str(j['note']),
      );

  /// 0-10; null when the report left it out.
  final double? score;
  final List<String> patterns;
  final String note;
}

/// The report written at the end of an interview.
class MockReport {
  const MockReport({
    required this.overallScore,
    required this.verdict,
    required this.summary,
    required this.dimensions,
    required this.questions,
    required this.language,
    required this.strengths,
    required this.improvements,
    required this.nextSteps,
  });

  factory MockReport.fromJson(Map<String, dynamic> j) => MockReport(
    overallScore: doubleOrNull(j['overallScore']) ?? 0,
    verdict: str(j['verdict']).toUpperCase(),
    summary: str(j['summary']),
    dimensions: mapList(j['dimensions']).map(MockDimension.fromJson).toList(),
    questions: mapList(j['questions']).map(MockQuestionReview.fromJson).toList()
      ..sort((a, b) => a.turnOrder.compareTo(b.turnOrder)),
    language: MockLanguageReport.fromJson(mapOrEmpty(j['language'])),
    strengths: strList(j['strengths']),
    improvements: strList(j['improvements']),
    nextSteps: strList(j['nextSteps']),
  );

  /// 0-10, one decimal.
  final double overallScore;

  /// STRONG_HIRE | HIRE | LEAN_HIRE | LEAN_NO_HIRE | NO_HIRE
  final String verdict;
  final String summary;
  final List<MockDimension> dimensions;
  final List<MockQuestionReview> questions;
  final MockLanguageReport language;
  final List<String> strengths;
  final List<String> improvements;
  final List<String> nextSteps;
}

/// One question in the report, next to what was actually said.
class MockReviewItem {
  const MockReviewItem({required this.review, this.question, this.answer});

  final MockQuestionReview review;

  /// The interviewer turn (`order == turnOrder`), when it's in the transcript.
  final MockTurn? question;

  /// The candidate turn that answered it (the next candidate turn).
  final MockTurn? answer;
}

/// A whole mock interview: the transcript, where it is, and the report.
class MockInterview {
  const MockInterview({
    required this.id,
    required this.prepId,
    required this.status,
    required this.stage,
    required this.stages,
    required this.awaitingReply,
    required this.replying,
    required this.aiSource,
    required this.turns,
    required this.answered,
    required this.report,
    required this.overallScore,
    required this.error,
    required this.startedAt,
    required this.endedAt,
  });

  factory MockInterview.fromJson(Map<String, dynamic> j) {
    final turns = mapList(j['turns']).map(MockTurn.fromJson).toList()
      ..sort((a, b) => a.order.compareTo(b.order));
    final stages = j['stages'] is List
        ? (j['stages'] as List).map(mockStageOf).toSet().toList()
        : const <MockStage>[];
    final report = asMap(j['report']) == null
        ? null
        : MockReport.fromJson(asMap(j['report'])!);
    return MockInterview(
      id: str(j['id']),
      prepId: str(j['prepId']),
      status: mockStatusOf(j['status']),
      stage: mockStageOf(j['stage']),
      stages: stages.isEmpty ? defaultMockStages : stages,
      awaitingReply: boolOf(j['awaitingReply']),
      replying: boolOf(j['replying']),
      aiSource: optStr(j['aiSource']),
      turns: turns,
      answered: j['answered'] == null
          ? turns.where((t) => t.isCandidate).length
          : intOf(j['answered']),
      report: report,
      overallScore: doubleOrNull(j['overallScore']) ?? report?.overallScore,
      error: optStr(j['error']),
      startedAt: dateOf(j['startedAt']) ?? epoch,
      endedAt: dateOf(j['endedAt']),
    );
  }

  final String id;
  final String prepId;
  final MockStatus status;
  final MockStage stage;

  /// The order shown in the progress bar.
  final List<MockStage> stages;

  /// The last turn is the candidate's: the interviewer is replying
  /// ([replying]) or the reply failed (retry with `reply`).
  final bool awaitingReply;
  final bool replying;

  /// `desktop` | `openai` | null.
  final String? aiSource;
  final List<MockTurn> turns;
  final int answered;
  final MockReport? report;
  final double? overallScore;

  /// Why the report or the last reply failed.
  final String? error;
  final DateTime startedAt;
  final DateTime? endedAt;

  bool get isInProgress => status == MockStatus.inProgress;
  bool get isReporting => status == MockStatus.reporting;
  bool get isCompleted => status == MockStatus.completed;
  bool get isFailed => status == MockStatus.failed;
  bool get isAbandoned => status == MockStatus.abandoned;

  /// The interviewer's reply failed: show why, with Retry.
  bool get replyFailed => isInProgress && awaitingReply && !replying;

  /// Something is happening on the server: check again soon.
  bool get needsPolling => isReporting || (isInProgress && replying);

  /// Whether the candidate can answer now.
  bool get canAnswer => isInProgress && !awaitingReply;

  /// The interviewer's latest turn: the question being answered.
  MockTurn? get currentQuestion {
    for (final t in turns.reversed) {
      if (t.isInterviewer) return t;
    }
    return null;
  }

  /// Whether the question being answered asks for code.
  bool get isCodingQuestion {
    final q = currentQuestion;
    return q != null && (q.isCodingQuestion || q.stage == MockStage.coding);
  }

  /// The report's questions, each with the interviewer turn it reviews and
  /// the candidate turn that answered it.
  List<MockReviewItem> get reviewItems {
    final r = report;
    if (r == null) return const [];
    return [
      for (final q in r.questions)
        MockReviewItem(
          review: q,
          question: turns
              .where((t) => t.isInterviewer && t.order == q.turnOrder)
              .firstOrNull,
          answer: turns
              .where((t) => t.isCandidate && t.order > q.turnOrder)
              .firstOrNull,
        ),
    ];
  }

  MockInterviewSummary get summary => MockInterviewSummary(
    id: id,
    status: status,
    stage: stage,
    overallScore: overallScore,
    verdict: report?.verdict,
    answered: answered,
    startedAt: startedAt,
    endedAt: endedAt,
  );
}

/// A mock interview in a prep's list.
class MockInterviewSummary {
  const MockInterviewSummary({
    required this.id,
    required this.status,
    required this.stage,
    required this.overallScore,
    required this.verdict,
    required this.answered,
    required this.startedAt,
    required this.endedAt,
  });

  factory MockInterviewSummary.fromJson(Map<String, dynamic> j) =>
      MockInterviewSummary(
        id: str(j['id']),
        status: mockStatusOf(j['status']),
        stage: mockStageOf(j['stage']),
        overallScore: doubleOrNull(j['overallScore']),
        verdict: optStr(j['verdict'])?.toUpperCase(),
        answered: intOf(j['answered']),
        startedAt: dateOf(j['startedAt']) ?? epoch,
        endedAt: dateOf(j['endedAt']),
      );

  final String id;
  final MockStatus status;
  final MockStage stage;
  final double? overallScore;
  final String? verdict;
  final int answered;
  final DateTime startedAt;
  final DateTime? endedAt;

  bool get isInProgress => status == MockStatus.inProgress;
}

/// What `POST /interview-preps/cv/extract` returns.
class CvExtract {
  const CvExtract({
    required this.text,
    required this.fileName,
    required this.chars,
  });

  factory CvExtract.fromJson(Map<String, dynamic> j) {
    final text = str(j['text']);
    return CvExtract(
      text: text,
      fileName: str(j['fileName']),
      chars: intOf(j['chars'], text.length),
    );
  }

  final String text;
  final String fileName;
  final int chars;
}

/// The CV file types the API reads, and the largest it takes.
const cvFileExtensions = ['pdf', 'docx', 'txt', 'md'];
const cvMaxBytes = 4 * 1024 * 1024;

/// Why a picked CV file can't be sent, or null when it can.
String? cvFileProblem(String fileName, int? size) {
  final dot = fileName.lastIndexOf('.');
  final ext = dot < 0 ? '' : fileName.substring(dot + 1).toLowerCase();
  if (!cvFileExtensions.contains(ext)) {
    return 'Pick a PDF, Word (.docx), .txt or .md file.';
  }
  if (size != null && size > cvMaxBytes) {
    return 'That file is over 4 MB. Pick a smaller one, or paste the text.';
  }
  if (size == 0) return 'That file is empty.';
  return null;
}
