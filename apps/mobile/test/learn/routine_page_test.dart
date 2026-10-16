import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/routine_page.dart';
import 'package:offerpath_mobile/services/api_client.dart';

import '../support/fake_api.dart';

/// Ported from ForgeRoutine. The routine screen's job on a phone is to be
/// honest about what can be done here: every item shows why it was
/// scheduled, and coding work says out loud that it belongs at a desk.
void main() {
  Widget wrap(ApiClient api) => MaterialApp(home: Scaffold(body: RoutinePage(api: api)));

  FakeApi apiReturning(Object? routine) => FakeApi()
    ..on('GET', '/api/v1/routines/today', FakeReply(200, routine))
    ..on('GET', '/api/v1/recall/due', const FakeReply.ok([]));

  testWidgets('offers to plan the day when nothing is scheduled', (tester) async {
    await tester.pumpWidget(wrap(apiReturning('').client()));
    await tester.pumpAndSettle();
    expect(find.text('Nothing planned yet'), findsOneWidget);
    expect(find.text('Plan today'), findsOneWidget);
  });

  testWidgets('shows the reason every item was scheduled', (tester) async {
    await tester.pumpWidget(wrap(apiReturning(_routine).client()));
    await tester.pumpAndSettle();
    expect(find.text('Review Closures'), findsOneWidget);
    expect(find.text('3 days overdue — it will start to fade.'), findsOneWidget);
  });

  testWidgets('says coding work belongs at a desk rather than opening an editor', (tester) async {
    await tester.pumpWidget(wrap(apiReturning(_routine).client()));
    await tester.pumpAndSettle();
    expect(find.text('Writing code happens at a desk. Open this on your desktop or the web.'), findsOneWidget);
    // One CODE item in the fixture, so exactly one notice.
    expect(find.byIcon(Icons.desktop_windows_outlined), findsOneWidget);
  });

  testWidgets('a reading item can be opened, a coding item cannot', (tester) async {
    await tester.pumpWidget(wrap(apiReturning(_routine).client()));
    await tester.pumpAndSettle();
    expect(find.text('Read'), findsOneWidget);
  });

  testWidgets('reports the day as finished without celebrating it', (tester) async {
    await tester.pumpWidget(wrap(apiReturning(_finishedRoutine).client()));
    await tester.pumpAndSettle();
    expect(find.text('That is today’s work done.'), findsOneWidget);
    expect(find.text('Stopping here is the right call — tomorrow’s spacing depends on it.'), findsOneWidget);
  });

  testWidgets('shows the count of reviews that are due', (tester) async {
    await tester.pumpWidget(wrap(apiReturning(_routine).client()));
    await tester.pumpAndSettle();
    expect(find.textContaining('2 due for review'), findsOneWidget);
  });

  testWidgets('Done marks the item on the server', (tester) async {
    final fake = apiReturning(_routine)..on('PATCH', '/api/v1/routines/items/i1', const FakeReply.ok({'id': 'i1'}));
    await tester.pumpWidget(wrap(fake.client()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Done').first);
    await tester.pumpAndSettle();
    final patch = fake.requests.where((r) => r.method == 'PATCH').single;
    expect(patch.path, '/api/v1/routines/items/i1');
    expect(patch.body, {'status': 'DONE'});
  });

  testWidgets('a desktop-offline load says so instead of an error', (tester) async {
    final fake = FakeApi()..on('GET', '/api/v1/routines/today', FakeReply.problem(503, 'ai-unavailable', 'AI assistance unavailable'));
    await tester.pumpWidget(wrap(fake.client()));
    await tester.pumpAndSettle();
    expect(find.text("Your desktop is offline: AI answers come back when it's on"), findsOneWidget);
    expect(find.text('Waiting for your desktop'), findsOneWidget);
  });
}

final _routine = <String, Object?>{
  'id': 'rt1',
  'date': '2026-09-13T00:00:00.000Z',
  'totalMinutes': 45,
  'completedMinutes': 8,
  'recallDue': 2,
  'items': [
    {'id': 'i1', 'kind': 'REVIEW', 'status': 'PENDING', 'minutes': 8, 'title': 'Review Closures', 'rationale': '3 days overdue — it will start to fade.', 'conceptId': 'c1', 'exerciseId': null},
    {'id': 'i2', 'kind': 'CODE', 'status': 'PENDING', 'minutes': 25, 'title': 'Implement debounce', 'rationale': 'Next in your roadmap.', 'conceptId': 'c2', 'exerciseId': 'e1'},
  ],
};

final _finishedRoutine = <String, Object?>{
  'id': 'rt2',
  'date': '2026-09-13T00:00:00.000Z',
  'totalMinutes': 8,
  'completedMinutes': 8,
  'recallDue': 0,
  'items': [
    {'id': 'i1', 'kind': 'REVIEW', 'status': 'DONE', 'minutes': 8, 'title': 'Review Closures', 'rationale': 'Due today.', 'conceptId': 'c1', 'exerciseId': null},
  ],
};
