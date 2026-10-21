/// Live-practice replies shaped exactly like the API's types
/// (`docs/live-practice.md`).
library;

Map<String, Object?> liveExchangeJson({
  String id = 'x1',
  int order = 0,
  String question = 'What is a closure in JavaScript?',
  String answer = 'A closure is a function that keeps the variables of the scope it was created in.',
  String answerFor = 'me',
}) => {
  'id': id,
  'order': order,
  'question': question,
  'answer': answer,
  'answerFor': answerFor,
  'createdAt': '2026-10-21T10:01:00.000Z',
};

Map<String, Object?> liveViewJson({
  String id = 's1',
  String? prepId,
  String title = 'React, Node.js',
  String status = 'ACTIVE',
  String answerFor = 'me',
  List<Map<String, Object?>>? exchanges,
}) => {
  'id': id,
  'prepId': prepId,
  'title': title,
  'technologies': ['React', 'Node.js'],
  'answerFor': answerFor,
  'status': status,
  'exchanges': exchanges ?? const [],
  'createdAt': '2026-10-21T10:00:00.000Z',
  'endedAt': status == 'ENDED' ? '2026-10-21T10:30:00.000Z' : null,
};

Map<String, Object?> liveSummaryJson({
  String id = 's1',
  String title = 'React, Node.js',
  String status = 'ENDED',
  int exchanges = 3,
}) => {
  'id': id,
  'prepId': null,
  'title': title,
  'status': status,
  'exchanges': exchanges,
  'createdAt': '2026-10-21T10:00:00.000Z',
  'endedAt': status == 'ENDED' ? '2026-10-21T10:30:00.000Z' : null,
};

Map<String, Object?> realtimePassJson({String secret = 'ek_test1'}) => {
  'clientSecret': secret,
  'expiresAt': '2026-10-21T10:10:00.000Z',
  'model': 'gpt-realtime',
  'url': 'wss://api.openai.com/v1/realtime?model=gpt-realtime',
};
