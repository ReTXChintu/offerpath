/// Interview-prep replies shaped exactly like the API's `PrepView`.
library;

Map<String, Object?> prepQuestionJson({
  String id = 'q1',
  int order = 0,
  String kind = 'TECHNICAL',
  String topic = 'React',
  String question = 'How does React decide when to re-render a component?',
  int difficulty = 3,
  double? score,
  String? answer,
}) =>
    {
      'id': id,
      'order': order,
      'kind': kind,
      'topic': topic,
      'question': question,
      'difficulty': difficulty,
      'keyPoints': score == null ? null : ['State or props change', 'Parent re-render', 'Context change'],
      'answer': answer,
      'score': score,
      'feedback': score == null
          ? null
          : {
              'covered': ['State or props change'],
              'missed': ['Context change'],
              'feedback': 'Good start; mention context consumers too.',
            },
      'answeredAt': score == null ? null : '2026-10-19T10:00:00.000Z',
    };

Map<String, Object?> prepJson({
  String id = 'p1',
  String status = 'READY',
  String? company = 'Acme',
  String? role = 'Frontend developer',
  String? error,
  String scheduledAt = '2026-10-25T05:00:00.000Z',
  List<Map<String, Object?>>? questions,
  bool includeDsa = false,
  Map<String, Object?>? resume,
  List<Map<String, Object?>> mockInterviews = const [],
}) {
  final qs = questions ??
      (status == 'READY'
          ? [
              prepQuestionJson(),
              prepQuestionJson(id: 'q2', order: 1, kind: 'BEHAVIORAL', topic: 'Ownership', question: 'Tell me about a time you owned a production incident.'),
              prepQuestionJson(id: 'q3', order: 2, kind: 'SYSTEM_DESIGN', topic: 'Caching', question: 'Design the caching layer for a product catalogue.'),
            ]
          : <Map<String, Object?>>[]);
  final answered = qs.where((q) => q['score'] != null).toList();
  return {
    'id': id,
    'company': company,
    'role': role,
    'jobDescription': 'We need a React developer.',
    'technologies': ['React', 'TypeScript'],
    'scheduledAt': scheduledAt,
    'status': status,
    'error': error,
    'generatedBy': status == 'READY' ? 'desktop' : null,
    'plan': status == 'READY'
        ? {
            'summary': 'Expect React fundamentals and one system design round.',
            'focusAreas': [
              {'topic': 'Rendering', 'why': 'The JD stresses performance.', 'priority': 1},
              {'topic': 'Testing', 'why': 'Mentioned twice.', 'priority': 2},
            ],
            'schedule': [
              {'day': 2, 'focus': 'Mock a system design round'},
              {'day': 1, 'focus': 'Re-read React rendering'},
            ],
          }
        : null,
    'questions': qs,
    'progress': {
      'answered': answered.length,
      'total': qs.length,
      'averageScore': answered.isEmpty ? null : (answered.fold<double>(0, (s, q) => s + (q['score'] as double)) / answered.length),
    },
    'createdAt': '2026-10-19T09:00:00.000Z',
    'includeDsa': includeDsa,
    'resume': resume,
    'mockInterviews': mockInterviews,
  };
}
