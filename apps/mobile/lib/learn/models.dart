/// Read models for the learning pages, ported from ForgeRoutine's app
/// (`apps/mobile/lib/data/routine_models.dart` and `models.dart`). They
/// mirror the API's views under `/api/v1/{routines,recall,interviews,
/// concepts,roadmap,progress,skills}`.
///
/// One rule holds throughout: a `null` score means *unscored* and renders
/// as a dash, never as 0%. A number we did not earn is a lie the user will
/// act on.
library;


class RoutineItem {
  const RoutineItem({
    required this.id,
    required this.kind,
    required this.status,
    required this.minutes,
    required this.title,
    required this.rationale,
    this.conceptId,
    this.exerciseId,
  });

  factory RoutineItem.fromJson(Map<String, dynamic> json) => RoutineItem(
        id: json['id'] as String,
        kind: json['kind'] as String,
        status: json['status'] as String,
        minutes: json['minutes'] as int? ?? 0,
        title: json['title'] as String? ?? '',
        rationale: json['rationale'] as String? ?? '',
        conceptId: json['conceptId'] as String?,
        exerciseId: json['exerciseId'] as String?,
      );

  final String id;
  final String kind;
  final String status;
  final int minutes;
  final String title;
  final String rationale;
  final String? conceptId;
  final String? exerciseId;

  bool get isDone => status == 'DONE';
  bool get isSkipped => status == 'SKIPPED';

  /// Coding work is surfaced here and done on the desktop or the web.
  ///
  /// Reproducing the desktop editor on a phone would be a worse version of
  /// both. Reading the brief on the train and writing the code at a desk is
  /// the workflow this supports.
  bool get requiresDesktop =>
      kind == 'CODE' ||
      kind == 'BLIND_CODE' ||
      kind == 'DEBUG' ||
      kind == 'PROJECT' ||
      kind == 'CHECKPOINT';
}

class Routine {
  const Routine({
    required this.id,
    required this.date,
    required this.totalMinutes,
    required this.completedMinutes,
    required this.items,
    required this.recallDue,
  });

  factory Routine.fromJson(Map<String, dynamic> json) => Routine(
        id: json['id'] as String,
        date: DateTime.parse(json['date'] as String),
        totalMinutes: json['totalMinutes'] as int? ?? 0,
        completedMinutes: json['completedMinutes'] as int? ?? 0,
        items: (json['items'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => RoutineItem.fromJson(e as Map<String, dynamic>))
            .toList(),
        recallDue: json['recallDue'] as int? ?? 0,
      );

  final String id;
  final DateTime date;
  final int totalMinutes;
  final int completedMinutes;
  final List<RoutineItem> items;
  final int recallDue;

  double get progress => totalMinutes == 0 ? 0 : completedMinutes / totalMinutes;

  bool get isFinished =>
      items.isNotEmpty && items.every((item) => item.isDone || item.isSkipped);
}

// -- Recall -------------------------------------------------------------------

class RecallPrompt {
  const RecallPrompt({
    required this.id,
    required this.conceptId,
    required this.conceptName,
    required this.technologyName,
    required this.prompt,
    required this.options,
  });

  factory RecallPrompt.fromJson(Map<String, dynamic> json) => RecallPrompt(
        id: json['id'] as String,
        conceptId: json['conceptId'] as String,
        conceptName: json['conceptName'] as String? ?? '',
        technologyName: json['technologyName'] as String? ?? '',
        prompt: json['prompt'] as String,
        options: (json['options'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => e as String)
            .toList(),
      );

  final String id;
  final String conceptId;
  final String conceptName;
  final String technologyName;
  final String prompt;

  /// Never carries the correct index. The client cannot mark its own homework.
  final List<String> options;
}

class RecallAnswer {
  const RecallAnswer({
    required this.correct,
    required this.correctIndex,
    required this.explanation,
    required this.nextDueAt,
  });

  factory RecallAnswer.fromJson(Map<String, dynamic> json) => RecallAnswer(
        correct: json['correct'] as bool? ?? false,
        correctIndex: json['correctIndex'] as int? ?? 0,
        explanation: json['explanation'] as String? ?? '',
        nextDueAt: DateTime.parse(json['nextDueAt'] as String),
      );

  final bool correct;
  final int correctIndex;
  final String explanation;
  final DateTime nextDueAt;
}

// -- Interview ----------------------------------------------------------------

class InterviewTurn {
  const InterviewTurn({
    required this.questionId,
    required this.prompt,
    this.conceptName,
    this.answer,
  });

  factory InterviewTurn.fromJson(Map<String, dynamic> json) => InterviewTurn(
        questionId: json['questionId'] as String,
        prompt: json['prompt'] as String,
        conceptName: json['conceptName'] as String?,
        answer: json['answer'] as String?,
      );

  final String questionId;
  final String prompt;
  final String? conceptName;
  final String? answer;
}

class Interview {
  const Interview({
    required this.id,
    required this.mode,
    required this.targetLevel,
    required this.status,
    required this.turns,
    required this.turnsRemaining,
    this.currentQuestionId,
    this.currentQuestion,
  });

  factory Interview.fromJson(Map<String, dynamic> json) {
    final current = json['currentQuestion'] as Map<String, dynamic>?;

    return Interview(
      id: json['id'] as String,
      mode: json['mode'] as String? ?? 'TECHNICAL',
      targetLevel: json['targetLevel'] as String? ?? 'MID',
      status: json['status'] as String? ?? 'IN_PROGRESS',
      turns: (json['turns'] as List<dynamic>? ?? <dynamic>[])
          .map((dynamic e) => InterviewTurn.fromJson(e as Map<String, dynamic>))
          .toList(),
      turnsRemaining: json['turnsRemaining'] as int? ?? 0,
      currentQuestionId: current?['id'] as String?,
      currentQuestion: current?['prompt'] as String?,
    );
  }

  final String id;
  final String mode;
  final String targetLevel;
  final String status;
  final List<InterviewTurn> turns;
  final int turnsRemaining;
  final String? currentQuestionId;
  final String? currentQuestion;

  bool get isFinished => status != 'IN_PROGRESS';
}

class InterviewReport {
  const InterviewReport({
    required this.dimensions,
    required this.strongAreas,
    required this.weakAreas,
    required this.recommendedTopics,
    required this.degraded,
    this.overallScore,
    this.summary,
  });

  factory InterviewReport.fromJson(Map<String, dynamic> json) => InterviewReport(
        overallScore: (json['overallScore'] as num?)?.toDouble(),
        dimensions: (json['dimensions'] as Map<String, dynamic>? ?? <String, dynamic>{})
            .map((key, dynamic value) => MapEntry(key, (value as num?)?.toDouble())),
        strongAreas: _strings(json['strongAreas']),
        weakAreas: _strings(json['weakAreas']),
        recommendedTopics: _strings(json['recommendedTopics']),
        summary: json['summary'] as String?,
        degraded: json['degraded'] as bool? ?? false,
      );

  final double? overallScore;

  /// Dimensions the interview did not test come back null and are omitted
  /// from the UI entirely, rather than shown at zero.
  final Map<String, double?> dimensions;
  final List<String> strongAreas;
  final List<String> weakAreas;
  final List<String> recommendedTopics;
  final String? summary;

  /// True when the written review could not be generated and only the
  /// arithmetic is present. Said out loud rather than passed off as insight.
  final bool degraded;
}

class InterviewSummary {
  const InterviewSummary({
    required this.id,
    required this.mode,
    required this.status,
    required this.startedAt,
    required this.questionCount,
    this.overallScore,
  });

  factory InterviewSummary.fromJson(Map<String, dynamic> json) => InterviewSummary(
        id: json['id'] as String,
        mode: json['mode'] as String? ?? '',
        status: json['status'] as String? ?? '',
        startedAt: DateTime.parse(json['startedAt'] as String),
        questionCount: json['questionCount'] as int? ?? 0,
        overallScore: (json['overallScore'] as num?)?.toDouble(),
      );

  final String id;
  final String mode;
  final String status;
  final DateTime startedAt;
  final int questionCount;
  final double? overallScore;
}

// -- Interview guide ----------------------------------------------------------

class GuideTopic {
  const GuideTopic({
    required this.conceptId,
    required this.name,
    required this.status,
    required this.commonMistakes,
    this.readiness,
  });

  factory GuideTopic.fromJson(Map<String, dynamic> json) => GuideTopic(
        conceptId: json['conceptId'] as String,
        name: json['name'] as String? ?? '',
        status: json['status'] as String? ?? 'UNPRACTISED',
        readiness: (json['readiness'] as num?)?.toDouble(),
        commonMistakes: _strings(json['commonMistakes']),
      );

  final String conceptId;
  final String name;
  final String status;
  final double? readiness;
  final List<String> commonMistakes;
}

class GuideTechnology {
  const GuideTechnology({
    required this.technologyId,
    required this.name,
    required this.interviewImportance,
    required this.topics,
    this.readiness,
  });

  factory GuideTechnology.fromJson(Map<String, dynamic> json) => GuideTechnology(
        technologyId: json['technologyId'] as String,
        name: json['name'] as String? ?? '',
        interviewImportance: json['interviewImportance'] as int? ?? 3,
        readiness: (json['readiness'] as num?)?.toDouble(),
        topics: (json['topics'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => GuideTopic.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final String technologyId;
  final String name;
  final int interviewImportance;
  final double? readiness;
  final List<GuideTopic> topics;
}

class GuidePriority {
  const GuidePriority({required this.title, required this.reason, this.conceptId});

  factory GuidePriority.fromJson(Map<String, dynamic> json) => GuidePriority(
        title: json['title'] as String? ?? '',
        reason: json['reason'] as String? ?? '',
        conceptId: json['conceptId'] as String?,
      );

  final String title;
  final String reason;
  final String? conceptId;
}

class InterviewGuide {
  const InterviewGuide({
    required this.technologies,
    required this.priorities,
    required this.recurringWeaknesses,
    required this.interviewsTaken,
    this.overallReadiness,
  });

  factory InterviewGuide.fromJson(Map<String, dynamic> json) => InterviewGuide(
        overallReadiness: (json['overallReadiness'] as num?)?.toDouble(),
        technologies: (json['technologies'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => GuideTechnology.fromJson(e as Map<String, dynamic>))
            .toList(),
        priorities: (json['priorities'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => GuidePriority.fromJson(e as Map<String, dynamic>))
            .toList(),
        recurringWeaknesses: _strings(json['recurringWeaknesses']),
        interviewsTaken: json['interviewsTaken'] as int? ?? 0,
      );

  /// Null below five practised concepts. One well-drilled concept is not 90%
  /// interview readiness, and the API declines to imply that it is.
  final double? overallReadiness;
  final List<GuideTechnology> technologies;
  final List<GuidePriority> priorities;
  final List<String> recurringWeaknesses;
  final int interviewsTaken;
}

List<String> _strings(Object? value) =>
    (value as List<dynamic>? ?? <dynamic>[]).map((dynamic e) => e as String).toList();

// -- Progress -------------------------------------------------------------------

class IndependenceScore {
  const IndependenceScore({
    required this.score,
    required this.status,
    required this.attemptsConsidered,
    required this.windowDays,
    this.deltaFromPreviousWindow,
  });

  factory IndependenceScore.fromJson(Map<String, dynamic> json) => IndependenceScore(
        score: (json['score'] as num?)?.toDouble(),
        status: json['status'] as String? ?? 'INSUFFICIENT_DATA',
        attemptsConsidered: json['attemptsConsidered'] as int? ?? 0,
        windowDays: json['windowDays'] as int? ?? 30,
        deltaFromPreviousWindow: (json['deltaFromPreviousWindow'] as num?)?.toDouble(),
      );

  final double? score;
  final String status;
  final int attemptsConsidered;
  final int windowDays;
  final double? deltaFromPreviousWindow;

  bool get hasEnoughData => status == 'OK' && score != null;
}

class WeakSkill {
  const WeakSkill({
    required this.conceptId,
    required this.conceptName,
    required this.technologyName,
    required this.value,
  });

  factory WeakSkill.fromJson(Map<String, dynamic> json) => WeakSkill(
        conceptId: json['conceptId'] as String,
        conceptName: json['conceptName'] as String,
        technologyName: json['technologyName'] as String,
        value: (json['value'] as num).toDouble(),
      );

  final String conceptId;
  final String conceptName;
  final String technologyName;
  final double value;
}

class NextAction {
  const NextAction({
    required this.kind,
    required this.title,
    required this.rationale,
    required this.estimatedMinutes,
    this.conceptId,
    this.exerciseId,
  });

  factory NextAction.fromJson(Map<String, dynamic> json) => NextAction(
        kind: json['kind'] as String,
        title: json['title'] as String,
        rationale: json['rationale'] as String,
        estimatedMinutes: json['estimatedMinutes'] as int? ?? 15,
        conceptId: json['conceptId'] as String?,
        exerciseId: json['exerciseId'] as String?,
      );

  final String kind;
  final String title;
  final String rationale;
  final int estimatedMinutes;
  final String? conceptId;
  final String? exerciseId;

  /// The phone does not reproduce the desktop editor: coding work is
  /// surfaced here for review and done on the desktop or the web.
  bool get requiresDesktop =>
      kind == 'CODE' || kind == 'BLIND_CODE' || kind == 'DEBUG';
}

class DashboardOverview {
  const DashboardOverview({
    required this.greeting,
    required this.todayMinutesDone,
    required this.todayMinutesTarget,
    required this.independence,
    required this.currentFocus,
    required this.weakestSkills,
    this.interviewReadiness,
    this.nextAction,
  });

  factory DashboardOverview.fromJson(Map<String, dynamic> json) => DashboardOverview(
        greeting: json['greeting'] as String? ?? 'Hello.',
        todayMinutesDone: json['todayMinutesDone'] as int? ?? 0,
        todayMinutesTarget: json['todayMinutesTarget'] as int? ?? 45,
        independence: IndependenceScore.fromJson(
          json['independence'] as Map<String, dynamic>? ?? const <String, dynamic>{},
        ),
        interviewReadiness: (json['interviewReadiness'] as num?)?.toDouble(),
        currentFocus: (json['currentFocus'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => e as String)
            .toList(),
        weakestSkills: (json['weakestSkills'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => WeakSkill.fromJson(e as Map<String, dynamic>))
            .toList(),
        nextAction: json['nextAction'] == null
            ? null
            : NextAction.fromJson(json['nextAction'] as Map<String, dynamic>),
      );

  final String greeting;
  final int todayMinutesDone;
  final int todayMinutesTarget;
  final IndependenceScore independence;
  final double? interviewReadiness;
  final List<String> currentFocus;
  final List<WeakSkill> weakestSkills;
  final NextAction? nextAction;
}

// -- Reading: concepts and the tutor -------------------------------------------

/// `GET /concepts/:id`, trimmed to what the reading page shows.
class ConceptInfo {
  const ConceptInfo({
    required this.id,
    required this.name,
    required this.technologyName,
    required this.description,
    required this.learningObjectives,
    required this.commonMistakes,
  });

  factory ConceptInfo.fromJson(Map<String, dynamic> json) => ConceptInfo(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        technologyName: json['technologyName'] as String? ?? '',
        description: json['description'] as String? ?? '',
        learningObjectives: _strings(json['learningObjectives']),
        commonMistakes: _strings(json['commonMistakes']),
      );

  final String id;
  final String name;
  final String technologyName;
  final String description;
  final List<String> learningObjectives;
  final List<String> commonMistakes;
}

/// `GET /concepts/:id/explainer`: the written explanation, generated once
/// per concept on a desktop and shared by everyone.
class Explainer {
  const Explainer({
    required this.summary,
    required this.realWorld,
    required this.examples,
    required this.pitfalls,
    required this.available,
    this.codeExample,
    this.codeLanguage,
    this.docsUrl,
    this.unavailableReason,
  });

  factory Explainer.fromJson(Map<String, dynamic> json) => Explainer(
        summary: json['summary'] as String? ?? '',
        realWorld: json['realWorld'] as String? ?? '',
        examples: _strings(json['examples']),
        codeExample: json['codeExample'] as String?,
        codeLanguage: json['codeLanguage'] as String?,
        pitfalls: _strings(json['pitfalls']),
        docsUrl: json['docsUrl'] as String?,
        available: json['available'] as bool? ?? false,
        unavailableReason: json['unavailableReason'] as String?,
      );

  final String summary;
  final String realWorld;
  final List<String> examples;
  final String? codeExample;
  final String? codeLanguage;
  final List<String> pitfalls;
  final String? docsUrl;

  /// False when it has not been written yet and cannot be right now.
  final bool available;
  final String? unavailableReason;
}

/// One message of the tutor conversation about a concept.
class ChatMessage {
  const ChatMessage({required this.id, required this.role, required this.content});

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: json['id'] as String? ?? '',
        role: json['role'] as String? ?? 'assistant',
        content: json['content'] as String? ?? '',
      );

  final String id;
  final String role;
  final String content;

  bool get fromUser => role.toLowerCase() == 'user';
}

/// A concept on the roadmap, for the reading list.
class ReadingItem {
  const ReadingItem({
    required this.conceptId,
    required this.title,
    required this.phase,
    required this.status,
    required this.minutes,
    required this.isCurrent,
  });

  final String conceptId;
  final String title;
  final String phase;
  final String status;
  final int minutes;
  final bool isCurrent;

  bool get isDone => status == 'DONE';
}

/// The concepts on the active roadmap (`GET /roadmap`), in order, once
/// each: the reading list. Empty before onboarding (the roadmap is null).
List<ReadingItem> readingListFromRoadmap(Object? roadmap) {
  if (roadmap is! Map) return const [];
  final currentItemId = roadmap['currentItemId'] as String?;
  final seen = <String>{};
  final out = <ReadingItem>[];
  for (final phase in (roadmap['phases'] as List<dynamic>? ?? const [])) {
    if (phase is! Map) continue;
    for (final item in (phase['items'] as List<dynamic>? ?? const [])) {
      if (item is! Map) continue;
      final conceptId = item['conceptId'] as String?;
      if (conceptId == null || !seen.add(conceptId)) continue;
      out.add(ReadingItem(
        conceptId: conceptId,
        title: item['title'] as String? ?? '',
        phase: phase['title'] as String? ?? '',
        status: item['status'] as String? ?? '',
        minutes: (item['estimatedMinutes'] as num?)?.toInt() ?? 0,
        isCurrent: item['id'] == currentItemId,
      ));
    }
  }
  return out;
}

/// The day as `GET /today` plans it: the goal, the streak and whether the
/// day was started. The routine and the hunt have their own models.
class TodayPlan {
  const TodayPlan({
    required this.startedAt,
    required this.streak,
    required this.goalRoles,
    required this.goalDaysLeft,
    required this.prep,
    required this.skillGaps,
  });

  factory TodayPlan.fromJson(Map<String, dynamic> json) {
    final goal = json['goal'] as Map<String, dynamic>?;
    return TodayPlan(
      startedAt: json['startedAt'] == null ? null : DateTime.parse(json['startedAt'] as String),
      streak: json['streak'] as int? ?? 0,
      goalRoles: (goal?['targetRoles'] as List<dynamic>? ?? <dynamic>[]).cast<String>(),
      goalDaysLeft: goal?['daysLeft'] as int?,
      prep: (json['interviews'] as List<dynamic>? ?? <dynamic>[])
          .map((dynamic e) => InterviewPrep.fromJson(e as Map<String, dynamic>))
          .toList(),
      skillGaps: (json['skillGaps'] as List<dynamic>? ?? <dynamic>[])
          .map((dynamic e) => (e as Map<String, dynamic>)['skill'] as String)
          .toList(),
    );
  }

  final DateTime? startedAt;
  final int streak;
  final List<String> goalRoles;
  final int? goalDaysLeft;
  final List<InterviewPrep> prep;
  final List<String> skillGaps;
}

/// An interview in the next two weeks, with what to practise for it.
class InterviewPrep {
  const InterviewPrep({required this.company, required this.title, required this.daysLeft, required this.technologies});

  factory InterviewPrep.fromJson(Map<String, dynamic> json) => InterviewPrep(
        company: json['company'] as String? ?? '',
        title: json['title'] as String? ?? '',
        daysLeft: json['daysLeft'] as int? ?? 0,
        technologies: (json['technologies'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic t) => (t as Map<String, dynamic>)['name'] as String)
            .toList(),
      );

  final String company;
  final String title;
  final int daysLeft;
  final List<String> technologies;
}
