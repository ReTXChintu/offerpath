import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/prep_detail_page.dart';
import 'package:offerpath_mobile/logic/links.dart';
import 'package:offerpath_mobile/models/app_notification.dart';
import 'package:offerpath_mobile/screens/notifications_screen.dart';
import 'package:offerpath_mobile/screens/shell_screen.dart';
import 'package:offerpath_mobile/services/link_bus.dart';
import 'package:offerpath_mobile/state/auth_controller.dart';
import 'package:offerpath_mobile/state/connection_controller.dart';
import 'package:offerpath_mobile/state/interview_prep_controller.dart';
import 'package:offerpath_mobile/state/nav_controller.dart';
import 'package:offerpath_mobile/state/notifications_controller.dart';
import 'package:provider/provider.dart';
import 'package:provider/single_child_widget.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/fake_api.dart';
import 'support/fakes.dart';
import 'support/prep_fixtures.dart';

/// What the server sends when a prep is ready: the hub `notification`
/// frame, and the same fields as a Firebase push's `data` (strings).
final _frame = <String, dynamic>{
  'id': 'prep-p1',
  'level': 'info',
  'kind': 'INTERVIEW_PREP_READY',
  'title': 'Interview prep is ready',
  'body': '3 questions for Frontend developer at Acme. Practise them on your phone or laptop.',
  'linkPage': 'interview-prep',
  'linkId': 'p1',
  'createdAt': '2026-10-19T10:00:00.000Z',
};

void main() {
  group('INTERVIEW_PREP_READY links', () {
    test('open the prep from every path: hub frame, local notification, Firebase data', () {
      expect(resolveLink('interview-prep', 'p1'), const AppLink(LinkKind.interviewPrep, 'p1'));
      expect(resolveLink('interview-prep', ''), const AppLink(LinkKind.interviewPreps), reason: 'no id: the list');
      expect(AppNotification.fromJson(_frame).link, const AppLink(LinkKind.interviewPrep, 'p1'));
      expect(decodeLinkPayload(encodeLinkPayload('interview-prep', 'p1')), const AppLink(LinkKind.interviewPrep, 'p1'));
      expect(linkFromPushData(_frame.map((k, v) => MapEntry(k, v.toString()))), const AppLink(LinkKind.interviewPrep, 'p1'));
      expect(tabFor(const AppLink(LinkKind.interviewPrep, 'p1')), tabLearn);
    });
  });

  group('opening the prep', () {
    late FakeApi fake;
    late AuthController auth;
    late NavController nav;
    late InterviewPrepController preps;

    Future<void> signIn() async {
      SharedPreferences.setMockInitialValues({'offerpath.server_url': 'http://test.local:50005'});
      FlutterSecureStorage.setMockInitialValues({'offerpath.device_token': 'dev-tok'});
      fake = FakeApi()
        ..on('GET', '/api/v1/interview-preps', FakeReply.ok({'preps': [prepJson()]}))
        ..on('GET', '/api/v1/interview-preps/p1', FakeReply.ok(prepJson()));
      auth = AuthController(apiFactory: (url, {token}) => fake.client(server: url, token: token ?? ''));
      await auth.loadPersisted();
      nav = NavController();
      preps = InterviewPrepController(auth);
    }

    Widget host(Widget child, {List<SingleChildWidget> extra = const []}) => MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthController>.value(value: auth),
            ChangeNotifierProvider<NavController>.value(value: nav),
            ChangeNotifierProvider<InterviewPrepController>.value(value: preps),
            ...extra,
          ],
          child: MaterialApp(home: child),
        );

    testWidgets('a notification that launched the app (cold start) opens the prep once the shell is up', (tester) async {
      await signIn();
      // The tap arrives before any screen exists, as on a cold start.
      LinkBus.instance.open(resolveLink('interview-prep', 'p1'));
      await tester.pumpWidget(host(const AppLinkListener(child: Scaffold(body: Text('shell')))));
      await tester.pumpAndSettle();

      expect(find.byType(PrepDetailPage), findsOneWidget);
      expect(find.text('Frontend developer at Acme'), findsOneWidget);
      expect(nav.tab, tabLearn);
      expect(nav.learnPage, learnPrep);
      expect(fake.requests.any((r) => r.path == '/api/v1/interview-preps/p1' && r.headers['Authorization'] == 'Bearer dev-tok'), isTrue);
      expect(LinkBus.instance.take(), isNull, reason: 'taken once');
    });

    testWidgets('a notification tapped while the app runs opens the prep', (tester) async {
      await signIn();
      await tester.pumpWidget(host(const AppLinkListener(child: Scaffold(body: Text('shell')))));
      await tester.pumpAndSettle();
      expect(find.byType(PrepDetailPage), findsNothing);

      LinkBus.instance.open(linkFromPushData({'linkPage': 'interview-prep', 'linkId': 'p1'}));
      await tester.pumpAndSettle();
      expect(find.byType(PrepDetailPage), findsOneWidget);
    });

    testWidgets('tapping the alert in the Alerts list opens the prep', (tester) async {
      await signIn();
      // The connection and the alerts list run signed out: nothing touches
      // the network or the notification plugins.
      final offline = AuthController();
      final connection = FakeConnectionController(offline);
      final alerts = NotificationsController(offline, connection)..items = [AppNotification.fromJson(_frame)];
      await tester.pumpWidget(host(
        const NotificationsScreen(),
        extra: [
          ChangeNotifierProvider<ConnectionController>.value(value: connection),
          ChangeNotifierProvider<NotificationsController>.value(value: alerts),
        ],
      ));
      await tester.pumpAndSettle();
      expect(find.text('Interview prep is ready'), findsOneWidget);

      await tester.tap(find.text('Interview prep is ready'));
      await tester.pumpAndSettle();
      expect(find.byType(PrepDetailPage), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Expect React fundamentals and one system design round.'), 200);
      expect(find.text('Expect React fundamentals and one system design round.'), findsOneWidget);
      expect(nav.tab, tabLearn);
    });
  });
}
