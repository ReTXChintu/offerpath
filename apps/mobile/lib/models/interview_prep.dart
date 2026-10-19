/// Interview prep: a real interview the user is preparing for, with the
/// plan and practice questions AI wrote for it. Mirrors the API's `PrepView`
/// (`apps/api/src/modules/interview-prep`). AI runs on the user's laptop
/// (Claude), or on their own OpenAI key when the laptop is offline.
library;

import '../services/api_client.dart';
import 'json.dart';

/// What the phone shows when a prep AI call can't run anywhere: the laptop
/// is offline and no OpenAI key is saved (a 503 `ai-unavailable`).
const prepAiOfflineMessage = "Your laptop is offline and no OpenAI key is saved: AI answers come back when it's on.";

/// The sentence for a failed prep call.
String prepErrorMessage(Object? error) {
  if (error is ApiException) {
    if (isPrepAiUnavailable(error)) return prepAiOfflineMessage;
    return error.message;
  }
  return "Couldn't reach the Offerpath server. Check your connection.";
}

/// Whether [error] only means no AI could run (laptop off, no OpenAI key).
bool isPrepAiUnavailable(Object? error) => error is ApiException && (error.status == 503 || error.kind == 'ai-unavailable');

enum PrepStatus { generating, ready, failed }

PrepStatus _status(dynamic v) => switch (str(v).toUpperCase()) {
      'READY' => PrepStatus.ready,
      'FAILED' => PrepStatus.failed,
      _ => PrepStatus.generating,
    };

/// Where prep AI runs (or ran): Claude on the laptop, or the user's OpenAI key.
enum PrepAiSource { desktop, openai }

PrepAiSource? prepAiSourceOf(dynamic v) => switch (v) {
      'desktop' => PrepAiSource.desktop,
      'openai' => PrepAiSource.openai,
      _ => null,
    };

/// Said on the create screen before submitting: where the AI will run.
String prepAiSourceLine(PrepAiSource? source) => switch (source) {
      PrepAiSource.desktop => 'AI runs on Claude on your laptop, which is online now.',
      PrepAiSource.openai => 'Your laptop is offline, so AI runs on your OpenAI key.',
      null => 'Your laptop is offline and no OpenAI key is saved: it will start when your laptop comes online.',
    };

class PrepFocusArea {
  const PrepFocusArea({required this.topic, required this.why, required this.priority});

  factory PrepFocusArea.fromJson(Map<String, dynamic> j) => PrepFocusArea(topic: str(j['topic']), why: str(j['why']), priority: intOf(j['priority'], 2));

  final String topic;
  final String why;

  /// 1 = highest.
  final int priority;
}

class PrepScheduleDay {
  const PrepScheduleDay({required this.day, required this.focus});

  factory PrepScheduleDay.fromJson(Map<String, dynamic> j) => PrepScheduleDay(day: intOf(j['day'], 1), focus: str(j['focus']));

  final int day;
  final String focus;
}

class PrepPlan {
  const PrepPlan({required this.summary, required this.focusAreas, required this.schedule});

  factory PrepPlan.fromJson(Map<String, dynamic> j) => PrepPlan(
        summary: str(j['summary']),
        focusAreas: mapList(j['focusAreas']).map(PrepFocusArea.fromJson).toList()..sort((a, b) => a.priority.compareTo(b.priority)),
        schedule: mapList(j['schedule']).map(PrepScheduleDay.fromJson).toList()..sort((a, b) => a.day.compareTo(b.day)),
      );

  final String summary;
  final List<PrepFocusArea> focusAreas;
  final List<PrepScheduleDay> schedule;
}

/// The grade of a practice answer.
class PrepFeedback {
  const PrepFeedback({required this.covered, required this.missed, required this.feedback});

  factory PrepFeedback.fromJson(Map<String, dynamic> j) => PrepFeedback(covered: strList(j['covered']), missed: strList(j['missed']), feedback: str(j['feedback']));

  final List<String> covered;
  final List<String> missed;
  final String feedback;
}

class PrepQuestion {
  const PrepQuestion({
    required this.id,
    required this.order,
    required this.kind,
    required this.topic,
    required this.question,
    required this.difficulty,
    this.keyPoints,
    this.answer,
    this.score,
    this.feedback,
    this.answeredAt,
  });

  factory PrepQuestion.fromJson(Map<String, dynamic> j) => PrepQuestion(
        id: str(j['id']),
        order: intOf(j['order']),
        kind: str(j['kind'], 'TECHNICAL'),
        topic: str(j['topic']),
        question: str(j['question']),
        difficulty: intOf(j['difficulty'], 3),
        keyPoints: j['keyPoints'] is List ? strList(j['keyPoints']) : null,
        answer: optStr(j['answer']),
        score: doubleOrNull(j['score']),
        feedback: asMap(j['feedback']) == null ? null : PrepFeedback.fromJson(asMap(j['feedback'])!),
        answeredAt: dateOf(j['answeredAt']),
      );

  final String id;
  final int order;

  /// TECHNICAL | SYSTEM_DESIGN | CODING | BEHAVIORAL | COMPANY
  final String kind;
  final String topic;
  final String question;

  /// 1-5.
  final int difficulty;

  /// What a strong answer covers; null until the question has been answered.
  final List<String>? keyPoints;
  final String? answer;

  /// 0-10; null while unanswered.
  final double? score;
  final PrepFeedback? feedback;
  final DateTime? answeredAt;

  bool get isAnswered => score != null;
}

class PrepProgress {
  const PrepProgress({required this.answered, required this.total, this.averageScore});

  factory PrepProgress.fromJson(Map<String, dynamic> j) => PrepProgress(answered: intOf(j['answered']), total: intOf(j['total']), averageScore: doubleOrNull(j['averageScore']));

  final int answered;
  final int total;

  /// 0-10; null until something is answered.
  final double? averageScore;
}

/// One interview being prepared for.
class Prep {
  const Prep({
    required this.id,
    required this.company,
    required this.role,
    required this.jobDescription,
    required this.technologies,
    required this.scheduledAt,
    required this.status,
    required this.error,
    required this.generatedBy,
    required this.plan,
    required this.questions,
    required this.progress,
    required this.createdAt,
  });

  factory Prep.fromJson(Map<String, dynamic> j) => Prep(
        id: str(j['id']),
        company: optStr(j['company']),
        role: optStr(j['role']),
        jobDescription: optStr(j['jobDescription']),
        technologies: strList(j['technologies']),
        scheduledAt: dateOf(j['scheduledAt']) ?? epoch,
        status: _status(j['status']),
        error: optStr(j['error']),
        generatedBy: prepAiSourceOf(j['generatedBy']),
        plan: asMap(j['plan']) == null ? null : PrepPlan.fromJson(asMap(j['plan'])!),
        questions: mapList(j['questions']).map(PrepQuestion.fromJson).toList()..sort((a, b) => a.order.compareTo(b.order)),
        progress: PrepProgress.fromJson(mapOrEmpty(j['progress'])),
        createdAt: dateOf(j['createdAt']),
      );

  final String id;
  final String? company;
  final String? role;
  final String? jobDescription;
  final List<String> technologies;

  /// When the interview is (UTC from the server; show it with `toLocal()`).
  final DateTime scheduledAt;
  final PrepStatus status;
  final String? error;
  final PrepAiSource? generatedBy;
  final PrepPlan? plan;
  final List<PrepQuestion> questions;
  final PrepProgress progress;
  final DateTime? createdAt;

  bool get isGenerating => status == PrepStatus.generating;
  bool get isReady => status == PrepStatus.ready;
  bool get isFailed => status == PrepStatus.failed;

  /// "Backend developer at Acme", "Acme", or the technologies.
  String get title {
    if (role != null && company != null) return '$role at $company';
    if (role != null) return role!;
    if (company != null) return company!;
    if (technologies.isNotEmpty) return technologies.take(3).join(', ');
    return 'Interview';
  }

  /// The questions grouped by kind, in [prepKindOrder].
  List<(String, List<PrepQuestion>)> get questionsByKind {
    final groups = <String, List<PrepQuestion>>{};
    for (final q in questions) {
      groups.putIfAbsent(q.kind, () => []).add(q);
    }
    final kinds = groups.keys.toList()..sort((a, b) => _kindRank(a).compareTo(_kindRank(b)));
    return [for (final k in kinds) (k, groups[k]!)];
  }

  Prep withQuestion(PrepQuestion updated) {
    final questions = [for (final q in this.questions) q.id == updated.id ? updated : q];
    final scored = questions.where((q) => q.score != null).toList();
    final average = scored.isEmpty ? null : (scored.fold<double>(0, (s, q) => s + q.score!) / scored.length * 10).round() / 10;
    return Prep(
      id: id,
      company: company,
      role: role,
      jobDescription: jobDescription,
      technologies: technologies,
      scheduledAt: scheduledAt,
      status: status,
      error: error,
      generatedBy: generatedBy,
      plan: plan,
      questions: questions,
      progress: PrepProgress(answered: scored.length, total: questions.length, averageScore: average),
      createdAt: createdAt,
    );
  }
}

const prepKindOrder = ['TECHNICAL', 'CODING', 'SYSTEM_DESIGN', 'BEHAVIORAL', 'COMPANY'];

int _kindRank(String kind) {
  final i = prepKindOrder.indexOf(kind);
  return i < 0 ? prepKindOrder.length : i;
}

String prepKindLabel(String kind) => switch (kind) {
      'TECHNICAL' => 'Technical',
      'SYSTEM_DESIGN' => 'System design',
      'CODING' => 'Coding',
      'BEHAVIORAL' => 'Behavioural',
      'COMPANY' => 'About the company',
      _ => kind.isEmpty ? 'Other' : kind[0] + kind.substring(1).toLowerCase().replaceAll('_', ' '),
    };

String prepStatusLabel(PrepStatus status) => switch (status) {
      PrepStatus.generating => 'Preparing',
      PrepStatus.ready => 'Ready',
      PrepStatus.failed => 'Failed',
    };

/// How long until [at]: "in 3 days", "tomorrow", "in 5 h", "in 20 min",
/// "now", "2 days ago".
String prepCountdown(DateTime at, {DateTime? now}) {
  final current = now ?? DateTime.now();
  final diff = at.difference(current);
  if (diff.isNegative) {
    final ago = -diff.inMinutes;
    if (ago < 60) return 'now';
    if (ago < 24 * 60) return '${ago ~/ 60} h ago';
    final days = ago ~/ (24 * 60);
    return days == 1 ? 'yesterday' : '$days days ago';
  }
  if (diff.inMinutes < 1) return 'now';
  if (diff.inMinutes < 60) return 'in ${diff.inMinutes} min';
  if (diff.inHours < 12) return 'in ${diff.inHours} h';
  final localAt = at.toLocal(), localNow = current.toLocal();
  final days = DateTime(localAt.year, localAt.month, localAt.day).difference(DateTime(localNow.year, localNow.month, localNow.day)).inDays;
  if (days <= 0) return 'in ${diff.inHours} h';
  if (days == 1) return 'tomorrow';
  return 'in $days days';
}

/// Preps whose interview is from three hours ago up to [days] ahead,
/// soonest first (Today's card).
List<Prep> upcomingPreps(Iterable<Prep> preps, {DateTime? now, int days = 14}) {
  final current = now ?? DateTime.now();
  final from = current.subtract(const Duration(hours: 3));
  final until = current.add(Duration(days: days));
  return preps.where((p) => !p.scheduledAt.isBefore(from) && !p.scheduledAt.isAfter(until)).toList()..sort((a, b) => a.scheduledAt.compareTo(b.scheduledAt));
}

/// [local] as an ISO date-time with its UTC offset, which is what the API
/// takes: `2026-11-03T10:30:00+05:30`.
String isoWithOffset(DateTime local) {
  final at = local.isUtc ? local.toLocal() : local;
  final offset = at.timeZoneOffset;
  String two(int n) => n.toString().padLeft(2, '0');
  final sign = offset.isNegative ? '-' : '+';
  final abs = offset.abs();
  return '${at.year.toString().padLeft(4, '0')}-${two(at.month)}-${two(at.day)}'
      'T${two(at.hour)}:${two(at.minute)}:${two(at.second)}'
      '$sign${two(abs.inHours)}:${two(abs.inMinutes % 60)}';
}

/// The create form's fields, checked the way the API checks them. Returns
/// field name -> message; empty means it can be sent.
Map<String, String> validatePrepForm({
  required String company,
  required String role,
  required String jobDescription,
  required List<String> technologies,
  required DateTime? date,
  required int? minutesOfDay,
  DateTime? now,
}) {
  final errors = <String, String>{};
  if (company.trim().length > 120) errors['company'] = 'Keep the company under 120 characters.';
  if (role.trim().length > 120) errors['role'] = 'Keep the role under 120 characters.';
  if (jobDescription.trim().length > 20000) errors['jobDescription'] = 'The job description is too long (20,000 characters at most).';
  if (jobDescription.trim().isEmpty && technologies.isEmpty) errors['jobDescription'] = 'Add the job description, or the technologies to prepare.';
  if (technologies.length > 20) errors['technologies'] = 'Up to 20 technologies.';
  if (technologies.any((t) => t.length > 60)) errors['technologies'] = 'Keep each technology under 60 characters.';
  if (date == null) errors['date'] = 'Pick the interview date.';
  if (minutesOfDay == null) errors['time'] = 'Pick the interview time.';
  if (date != null && minutesOfDay != null) {
    final at = DateTime(date.year, date.month, date.day, minutesOfDay ~/ 60, minutesOfDay % 60);
    if (at.isBefore(now ?? DateTime.now())) errors['time'] = 'That time has already passed.';
  }
  return errors;
}

/// Splits what was typed into the technologies box ("React, Node; SQL")
/// into separate, trimmed, de-duplicated entries not already in [existing].
List<String> splitTechnologies(String text, {List<String> existing = const []}) {
  final seen = existing.map((e) => e.toLowerCase()).toSet();
  final out = <String>[];
  for (final part in text.split(RegExp(r'[,;\n]'))) {
    final t = part.trim();
    if (t.isEmpty || !seen.add(t.toLowerCase())) continue;
    out.add(t);
  }
  return out;
}
