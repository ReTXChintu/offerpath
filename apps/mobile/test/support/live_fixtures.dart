/// Live-practice replies shaped exactly like the API's `LivePracticeView`
/// (`docs/live-practice.md`).
library;

Map<String, Object?> liveQuestionJson({
  String id = 'lq1',
  int order = 0,
  String text = 'What is a closure in JavaScript?',
  String answerFor = 'me',
  String? spokenAnswer,
  double? score,
  bool grading = false,
  String detail = '## Example\n\nA counter made with **closures**.',
}) => {
  'id': id,
  'order': order,
  'text': text,
  'answerFor': answerFor,
  'aiAnswer': {
    'summary':
        'A function bundled with the variables of the scope it was created in.',
    'points': [
      'Inner functions keep access to outer variables',
      'Used for private state',
    ],
    'detail': detail,
  },
  'spokenAnswer': spokenAnswer,
  'score': score,
  'feedback': score == null
      ? null
      : {
          'covered': ['Inner functions keep access to outer variables'],
          'missed': ['Used for private state'],
          'feedback': 'Clear, but give an example.',
        },
  'grading': grading,
  'gradedAt': score == null ? null : '2026-10-21T10:05:00.000Z',
  'createdAt': '2026-10-21T10:00:00.000Z',
};

Map<String, Object?> liveLineJson({
  String id = 'l1',
  int order = 0,
  String text = 'What is a closure in JavaScript?',
  String kind = 'QUESTION',
  String? questionId = 'lq1',
}) => {
  'id': id,
  'order': order,
  'text': text,
  'kind': kind,
  'questionId': questionId,
  'createdAt': '2026-10-21T10:00:00.000Z',
};

Map<String, Object?> liveViewJson({
  String id = 's1',
  String? prepId,
  String title = 'React, Node.js',
  String status = 'ACTIVE',
  String answerFor = 'me',
  List<Map<String, Object?>>? questions,
  List<Map<String, Object?>>? lines,
  double? averageScore,
}) {
  final qs = questions ?? const [];
  return {
    'id': id,
    'prepId': prepId,
    'title': title,
    'technologies': ['React', 'Node.js'],
    'answerFor': answerFor,
    'status': status,
    'lines': lines ?? const [],
    'questions': qs,
    'stats': {
      'questions': qs.length,
      'graded': qs.where((q) => q['score'] != null).length,
      'averageScore': averageScore,
    },
    'createdAt': '2026-10-21T10:00:00.000Z',
    'endedAt': status == 'ENDED' ? '2026-10-21T10:30:00.000Z' : null,
  };
}

Map<String, Object?> liveSummaryJson({
  String id = 's1',
  String title = 'React, Node.js',
  String status = 'ENDED',
  int questions = 3,
  double? averageScore = 7.5,
}) => {
  'id': id,
  'prepId': null,
  'title': title,
  'status': status,
  'stats': {
    'questions': questions,
    'graded': questions,
    'averageScore': averageScore,
  },
  'createdAt': '2026-10-21T10:00:00.000Z',
  'endedAt': status == 'ENDED' ? '2026-10-21T10:30:00.000Z' : null,
};
