/// Mock-interview replies shaped exactly like the API's `MockInterviewView`
/// (`docs/mock-interview.md`).
library;

Map<String, Object?> turnJson({
  required int order,
  required String speaker,
  required String stage,
  required String kind,
  required String text,
  String? code,
  String? codeLanguage,
  Map<String, Object?>? problem,
  Map<String, Object?>? language,
  Map<String, Object?>? assessment,
}) => {
  'id': 't$order',
  'order': order,
  'speaker': speaker,
  'stage': stage,
  'kind': kind,
  'text': text,
  'code': code,
  'codeLanguage': codeLanguage,
  'problem': problem,
  'language': language,
  'assessment': assessment,
  'createdAt': '2026-10-20T10:0$order:00.000Z',
};

const twoSumProblem = <String, Object?>{
  'title': 'Two Sum',
  'statement': 'Given an array of integers `nums` and a target, return the **indices** of the two numbers that add up to it.',
  'examples': [
    {
      'input': 'nums = [2,7,11,15], target = 9',
      'output': '[0,1]',
      'explanation': 'nums[0] + nums[1] == 9',
    },
  ],
  'constraints': ['2 <= nums.length <= 10^4', 'Exactly one solution exists'],
};

/// The conversation up to the coding question (5 turns).
List<Map<String, Object?>> openingTurns({bool assessed = false}) => [
  turnJson(
    order: 0,
    speaker: 'INTERVIEWER',
    stage: 'INTRO',
    kind: 'OPENING',
    text: 'Tell me about yourself.',
  ),
  turnJson(
    order: 1,
    speaker: 'CANDIDATE',
    stage: 'INTRO',
    kind: 'ANSWER',
    text: 'I has five years of experience with React.',
    language: {
      'ok': false,
      'corrections': [
        {
          'original': 'I has',
          'corrected': 'I have',
          'note': 'Subject-verb agreement: "I" takes "have".',
        },
      ],
    },
    assessment: assessed
        ? {'verdict': 'CORRECT', 'note': 'Clear, but short on specifics.'}
        : null,
  ),
  turnJson(
    order: 2,
    speaker: 'INTERVIEWER',
    stage: 'TECHNICAL',
    kind: 'NEW_QUESTION',
    text: 'How does **React** reconcile the virtual DOM?',
  ),
  turnJson(
    order: 3,
    speaker: 'CANDIDATE',
    stage: 'TECHNICAL',
    kind: 'ANSWER',
    text: 'It diffs the old and new trees and patches the DOM.',
    language: {'ok': true, 'corrections': <Object?>[]},
    assessment: assessed
        ? {'verdict': 'PARTIAL', 'note': 'Missed keys and bail-outs.'}
        : null,
  ),
  turnJson(
    order: 4,
    speaker: 'INTERVIEWER',
    stage: 'CODING',
    kind: 'CODING',
    text: "Let's write some code.",
    problem: twoSumProblem,
  ),
];

/// The whole conversation, closed by the interviewer (7 turns).
List<Map<String, Object?>> completedTurns() => [
  ...openingTurns(assessed: true),
  turnJson(
    order: 5,
    speaker: 'CANDIDATE',
    stage: 'CODING',
    kind: 'ANSWER',
    text: 'A hash map from value to index, one pass.',
    code: 'def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i',
    codeLanguage: 'python',
    language: {'ok': true, 'corrections': <Object?>[]},
    assessment: {'verdict': 'STRONG', 'note': 'Optimal and explained.'},
  ),
  turnJson(
    order: 6,
    speaker: 'INTERVIEWER',
    stage: 'WRAP_UP',
    kind: 'CLOSING',
    text: 'Thanks, that is all from me.',
  ),
];

const mockReportJson = <String, Object?>{
  'overallScore': 7.5,
  'verdict': 'LEAN_HIRE',
  'summary': 'Solid React fundamentals and a clean coding round; go deeper on reconciliation.',
  'dimensions': [
    {'name': 'SELF_PRESENTATION', 'score': 6, 'comment': 'Brief; add numbers.'},
    {'name': 'TECHNICAL_DEPTH', 'score': 7, 'comment': 'Good basics.'},
    {'name': 'CODING', 'score': 9, 'comment': 'Optimal solution.'},
  ],
  'questions': [
    {
      'turnOrder': 2,
      'question': 'React reconciliation',
      'answerSummary': 'Diffing and patching.',
      'score': 6,
      'wentWell': 'Named the diff.',
      'couldBeBetter': 'Mention keys and bail-outs.',
      'strongerAnswer': 'React compares element types, uses **keys** for lists, and skips subtrees that did not change.',
    },
    {
      'turnOrder': 0,
      'question': 'Introduce yourself',
      'answerSummary': 'Five years of React.',
      'score': 6.5,
      'wentWell': 'Confident.',
      'couldBeBetter': 'Name a result you are proud of.',
      'strongerAnswer': 'Lead with your current role and one measurable win.',
    },
    {
      'turnOrder': 4,
      'question': 'Two Sum',
      'answerSummary': 'Hash map, one pass.',
      'score': 9,
      'wentWell': 'Optimal O(n).',
      'couldBeBetter': 'State the complexity up front.',
      'strongerAnswer': 'Same solution, saying O(n) time and O(n) space first.',
    },
  ],
  'language': {
    'score': 7,
    'patterns': ['Subject-verb agreement'],
    'note': 'Mostly clear; watch "I has".',
  },
  'strengths': ['Clean code'],
  'improvements': ['Depth on React internals'],
  'nextSteps': ['Read about keys and reconciliation'],
};

Map<String, Object?> mockInterviewJson({
  String id = 'm1',
  String prepId = 'p1',
  String status = 'IN_PROGRESS',
  String? stage,
  bool awaitingReply = false,
  bool replying = false,
  String? error,
  List<Map<String, Object?>>? turns,
}) {
  final completed = status == 'COMPLETED';
  final ts = turns ?? (completed ? completedTurns() : openingTurns());
  return {
    'id': id,
    'prepId': prepId,
    'status': status,
    'stage': stage ?? (completed ? 'WRAP_UP' : 'CODING'),
    'stages': ['INTRO', 'TECHNICAL', 'CODING', 'WRAP_UP'],
    'awaitingReply': awaitingReply,
    'replying': replying,
    'aiSource': 'desktop',
    'turns': ts,
    'answered': ts.where((t) => t['speaker'] == 'CANDIDATE').length,
    'report': completed ? mockReportJson : null,
    'overallScore': completed ? 7.5 : null,
    'error': error,
    'startedAt': '2026-10-20T10:00:00.000Z',
    'endedAt': completed ? '2026-10-20T10:30:00.000Z' : null,
  };
}

Map<String, Object?> mockSummaryJson({
  String id = 'm1',
  String status = 'COMPLETED',
  double? score = 7.5,
  String? verdict = 'LEAN_HIRE',
  String startedAt = '2026-10-20T10:00:00.000Z',
}) => {
  'id': id,
  'status': status,
  'stage': status == 'COMPLETED' ? 'WRAP_UP' : 'TECHNICAL',
  'overallScore': score,
  'verdict': verdict,
  'answered': 4,
  'startedAt': startedAt,
  'endedAt': status == 'COMPLETED' ? '2026-10-20T10:30:00.000Z' : null,
};
