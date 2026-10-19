import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/models/dashboard.dart';
import 'package:offerpath_mobile/models/envelope.dart';
import 'package:offerpath_mobile/models/interview_prep.dart';
import 'package:offerpath_mobile/screens/home_screen.dart';
import 'package:offerpath_mobile/screens/queue_screen.dart';
import 'package:offerpath_mobile/state/agent_controller.dart';
import 'package:offerpath_mobile/state/applications_controller.dart';
import 'package:offerpath_mobile/state/auth_controller.dart';
import 'package:offerpath_mobile/state/connection_controller.dart';
import 'package:offerpath_mobile/state/interview_prep_controller.dart';
import 'package:offerpath_mobile/state/learning_controller.dart';
import 'package:offerpath_mobile/state/nav_controller.dart';
import 'package:offerpath_mobile/state/queue_controller.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/fakes.dart';
import 'support/prep_fixtures.dart';

Future<(FakeConnectionController, QueueController)> pumpHome(WidgetTester tester, {Widget? home, void Function(InterviewPrepController)? preps}) async {
  SharedPreferences.setMockInitialValues({});
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  final auth = AuthController();
  final fake = FakeConnectionController(auth);
  fake.stubbed['list_applications'] = const RelayResponse(ok: true, data: []);
  fake.stubbed['list_queue'] = const RelayResponse(ok: true, data: [
    {'id': 'q1', 'title': 'Apply: Developer at Acme', 'task': {'kind': 'APPLICATION'}, 'requestedAt': '2026-10-11T10:00:00Z'},
    {'id': 'q2', 'title': 'Search only: Naukri', 'task': {'kind': 'JOB_HUNT'}},
  ]);
  fake.stubbed['remove_queued_task'] = const RelayResponse(ok: true, data: {'removed': true});
  fake.agentStatus = const AgentStatusLite(state: 'DISCOVERING', paused: false, runKind: 'JOB_HUNT', queued: 2);
  final queue = QueueController(fake);
  final prepController = InterviewPrepController(auth, fake);
  preps?.call(prepController);
  await tester.pumpWidget(MultiProvider(
    providers: [
      ChangeNotifierProvider<AuthController>.value(value: auth),
      ChangeNotifierProvider<ConnectionController>.value(value: fake),
      ChangeNotifierProvider<ApplicationsController>.value(value: ApplicationsController(fake)),
      ChangeNotifierProvider<AgentController>.value(value: AgentController(fake)),
      ChangeNotifierProvider<QueueController>.value(value: queue),
      ChangeNotifierProvider<NavController>.value(value: NavController()),
      ChangeNotifierProvider<LearningController>.value(value: LearningController(auth)),
      ChangeNotifierProvider<InterviewPrepController>.value(value: prepController),
    ],
    child: MaterialApp(home: home ?? const HomeScreen()),
  ));
  // The queue reads itself once the agent status is known.
  fake.notifyListeners();
  await tester.pumpAndSettle();
  return (fake, queue);
}

void main() {
  testWidgets('Today shows learning, what is queued and every desktop action', (tester) async {
    await pumpHome(tester);
    expect(find.text('Learn today'), findsOneWidget);
    expect(find.text('Up next'), findsOneWidget);
    expect(find.text('1. Apply: Developer at Acme'), findsNothing); // titles are plain; the place is drawn as a badge
    expect(find.text('Apply: Developer at Acme'), findsOneWidget);
    expect(find.text('Search only: Naukri'), findsOneWidget);
    for (final action in ['Start job hunt', 'Prepare applications', 'Search only', 'Find hiring posts', 'Company careers', 'Scan Telegram', 'Check Gmail', 'Apply from a link', 'Add a job I found']) {
      expect(find.text(action), findsOneWidget, reason: action);
    }
  });

  testWidgets('Today shows interview prep for the next 14 days only', (tester) async {
    final now = DateTime.now().toUtc();
    await pumpHome(tester, preps: (c) {
      c.put(Prep.fromJson(prepJson(id: 'soon', scheduledAt: now.add(const Duration(days: 3)).toIso8601String())));
      c.put(Prep.fromJson(prepJson(id: 'later', company: 'Globex', scheduledAt: now.add(const Duration(days: 30)).toIso8601String())));
    });
    expect(find.text('Interview prep'), findsOneWidget);
    expect(find.text('1 in the next 14 days'), findsOneWidget);
    expect(find.text('Frontend developer at Acme'), findsOneWidget);
    expect(find.text('Frontend developer at Globex'), findsNothing);
    expect(find.textContaining('in 3 days'), findsOneWidget);
    expect(find.text('0 of 3 practised'), findsOneWidget);
  });

  testWidgets('the Queue screen lists tasks in order and removes one on the desktop', (tester) async {
    final (fake, _) = await pumpHome(tester, home: const QueueScreen());
    expect(find.text('Queue (2)'), findsOneWidget);
    expect(find.text('Apply: Developer at Acme'), findsOneWidget);
    expect(find.text('Clear all'), findsOneWidget);
    // Removing needs the desktop; the fake is never "online", so the button is disabled.
    final remove = find.ancestor(of: find.byTooltip('Remove').first, matching: find.byType(IconButton)).first;
    expect(tester.widget<IconButton>(remove).onPressed, isNull);
    expect(fake.calls.where((c) => c.type == 'remove_queued_task'), isEmpty);
  });
}
