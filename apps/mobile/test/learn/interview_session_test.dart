import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/interview_session_page.dart';
import 'package:offerpath_mobile/learn/voice.dart';
import 'package:offerpath_mobile/services/api_client.dart';

import '../support/fake_api.dart';

/// Ported from ForgeRoutine. Two properties of this screen are product rules
/// and both fail silently: nothing is graded in front of the user
/// mid-interview, and a dimension the interview never tested is omitted,
/// never shown at zero.
void main() {
  Widget wrap(ApiClient api, {VoiceInput? voice}) => MaterialApp(home: InterviewSessionPage(api: api, interviewId: 'iv1', voice: voice ?? FakeVoiceInput(available: false)));

  FakeApi api({required Map<String, Object?> interview, Map<String, Object?>? report}) => FakeApi()
    ..on('GET', '/api/v1/interviews/iv1', FakeReply.ok(interview))
    ..on('GET', '/api/v1/interviews/iv1/report', FakeReply.ok(report ?? <String, Object?>{}));

  testWidgets('shows the question and no score while the interview is running', (tester) async {
    await tester.pumpWidget(wrap(api(interview: _inProgress).client()));
    await tester.pumpAndSettle();
    expect(find.text('What happens between two await points?'), findsOneWidget);
    expect(find.textContaining('%'), findsNothing);
    expect(find.text('Debrief'), findsNothing);
  });

  testWidgets('hides dictation when the device cannot do it', (tester) async {
    await tester.pumpWidget(wrap(api(interview: _inProgress).client(), voice: FakeVoiceInput(available: false)));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.mic_none), findsNothing);
  });

  testWidgets('offers dictation, and says what happens to the audio', (tester) async {
    await tester.pumpWidget(wrap(api(interview: _inProgress).client(), voice: FakeVoiceInput(transcript: 'x')));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.mic_none), findsOneWidget);
    expect(find.text('Dictation runs on your device. Only the text is sent.'), findsOneWidget);
  });

  testWidgets('dictation appends to what was already typed', (tester) async {
    await tester.pumpWidget(wrap(api(interview: _inProgress).client(), voice: FakeVoiceInput(transcript: 'the microtask queue drains')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'First,');
    await tester.tap(find.byIcon(Icons.mic_none));
    await tester.pumpAndSettle();
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller!.text, 'First, the microtask queue drains');
  });

  testWidgets('an answer sent while the desktop is off is kept, with the offline message', (tester) async {
    final fake = api(interview: _inProgress)..on('POST', '/api/v1/interviews/iv1/answer', FakeReply.problem(503, 'ai-unavailable', 'AI assistance unavailable'));
    await tester.pumpWidget(wrap(fake.client()));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Microtasks run first.');
    await tester.tap(find.text('Send'));
    await tester.pumpAndSettle();
    expect(find.text("Your desktop is offline: AI answers come back when it's on"), findsOneWidget);
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, 'Microtasks run first.');
    expect(fake.requests.last.body, {'questionId': 'q1-0000000000000000000000', 'text': 'Microtasks run first.'});
  });

  testWidgets('omits untested dimensions rather than showing them at zero', (tester) async {
    await tester.pumpWidget(wrap(api(interview: _finished, report: _report).client()));
    await tester.pumpAndSettle();
    expect(find.text('Debrief'), findsOneWidget);
    expect(find.text('Technical Correctness'), findsOneWidget);
    expect(find.text('Architecture Thinking'), findsNothing);
    expect(find.text('Dimensions this interview did not test are left out, not scored zero.'), findsOneWidget);
  });

  testWidgets('admits when the written review is missing', (tester) async {
    await tester.pumpWidget(wrap(api(interview: _finished, report: {..._report, 'summary': null, 'degraded': true}).client()));
    await tester.pumpAndSettle();
    expect(find.textContaining('arithmetic only'), findsOneWidget);
  });

  testWidgets('hides the composer once the interview is over', (tester) async {
    await tester.pumpWidget(wrap(api(interview: _finished, report: _report).client()));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsNothing);
  });
}

final _inProgress = <String, Object?>{
  'id': 'iv1',
  'mode': 'TECHNICAL',
  'targetLevel': 'MID',
  'status': 'IN_PROGRESS',
  'startedAt': '2026-09-13T09:00:00.000Z',
  'endedAt': null,
  'turnsRemaining': 11,
  'currentQuestion': {'id': 'q1-0000000000000000000000', 'prompt': 'What happens between two await points?'},
  'turns': [
    {'questionId': 'q1-0000000000000000000000', 'orderIndex': 0, 'prompt': 'What happens between two await points?', 'conceptName': 'Event loop', 'answer': null},
  ],
};

final _finished = <String, Object?>{..._inProgress, 'status': 'COMPLETED', 'currentQuestion': null, 'endedAt': '2026-09-13T09:20:00.000Z'};

final _report = <String, Object?>{
  'overallScore': 0.62,
  'dimensions': {'technicalCorrectness': 0.7, 'depth': 0.5, 'architectureThinking': null, 'debugging': null},
  'strongAreas': ['explained closures precisely'],
  'weakAreas': ['could not say when a microtask runs'],
  'recommendedTopics': ['event loop'],
  'summary': 'Solid fundamentals, thin on async scheduling.',
  'degraded': false,
};
