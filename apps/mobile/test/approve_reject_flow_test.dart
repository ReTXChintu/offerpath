import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/models/envelope.dart';
import 'package:offerpath_mobile/screens/application_detail_screen.dart';
import 'package:offerpath_mobile/services/hub_client.dart';
import 'package:offerpath_mobile/state/applications_controller.dart';
import 'package:offerpath_mobile/state/auth_controller.dart';
import 'package:offerpath_mobile/state/connection_controller.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/fakes.dart';

/// The approval gate seen from the phone: approving or rejecting is one
/// request to the desktop, only after the user confirms, and only while the
/// desktop can be reached. The desktop's own code decides the outcome.
Map<String, dynamic> _detail(String status) => {
      'application': {'id': 'app-1', 'jobId': 'job-1', 'status': status, 'updatedAt': '2026-10-01T00:00:00Z'},
      'job': {'id': 'job-1', 'title': 'Flutter Engineer', 'company': 'Acme', 'location': 'Remote'},
      'analysis': {'matchScore': 88, 'relevant': true},
    };

Future<FakeConnectionController> _pump(WidgetTester tester, {bool desktopOnline = true}) async {
  SharedPreferences.setMockInitialValues({});
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  final fake = FakeConnectionController(AuthController());
  fake.socketState = SocketState.connected;
  fake.desktopOnline = desktopOnline;
  fake.stubbed['get_application'] = RelayResponse(ok: true, data: _detail('READY_FOR_REVIEW'));
  fake.stubbed['list_applications'] = const RelayResponse(ok: true, data: []);
  await tester.pumpWidget(MultiProvider(
    providers: [
      ChangeNotifierProvider<ConnectionController>.value(value: fake),
      ChangeNotifierProvider<ApplicationsController>.value(value: ApplicationsController(fake)),
    ],
    child: const MaterialApp(home: ApplicationDetailScreen(applicationId: 'app-1')),
  ));
  await tester.pumpAndSettle();
  return fake;
}

void main() {
  testWidgets('approve asks first, then sends approve_application for this application', (tester) async {
    final fake = await _pump(tester);
    fake.stubbed['approve_application'] = RelayResponse(ok: true, data: _detail('APPROVED')['application']);

    await tester.tap(find.text('Approve & apply'));
    await tester.pumpAndSettle();
    expect(find.text('Approve and apply?'), findsOneWidget);
    // Nothing is sent before the user confirms.
    expect(fake.calls.where((c) => c.type == 'approve_application'), isEmpty);

    fake.stubbed['get_application'] = RelayResponse(ok: true, data: _detail('APPROVED'));
    await tester.tap(find.widgetWithText(FilledButton, 'Approve & apply').last);
    await tester.pumpAndSettle();

    final approve = fake.calls.where((c) => c.type == 'approve_application').single;
    expect(approve.payload, {'id': 'app-1'});
    expect(find.text('Approved. Your desktop is applying.'), findsOneWidget);
    // The screen re-reads the application from the desktop.
    expect(fake.calls.where((c) => c.type == 'get_application').length, greaterThanOrEqualTo(2));
  });

  testWidgets('cancelling the confirmation sends nothing', (tester) async {
    final fake = await _pump(tester);
    await tester.tap(find.text('Approve & apply'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(fake.calls.where((c) => c.type == 'approve_application'), isEmpty);
  });

  testWidgets('reject sends reject_application with the reason typed', (tester) async {
    final fake = await _pump(tester);
    fake.stubbed['reject_application'] = RelayResponse(ok: true, data: _detail('REJECTED')['application']);

    await tester.tap(find.text('Reject'));
    await tester.pumpAndSettle();
    expect(find.text('Reject this application?'), findsOneWidget);
    await tester.enterText(find.byType(TextField).last, 'Too far away');
    fake.stubbed['get_application'] = RelayResponse(ok: true, data: _detail('REJECTED'));
    await tester.tap(find.widgetWithText(FilledButton, 'Reject'));
    await tester.pumpAndSettle();

    final reject = fake.calls.where((c) => c.type == 'reject_application').single;
    expect(reject.payload, {'id': 'app-1', 'reason': 'Too far away'});
    expect(find.text('Rejected.'), findsOneWidget);
  });

  testWidgets('a refusal from the desktop is shown, not hidden', (tester) async {
    final fake = await _pump(tester);
    fake.stubbed['approve_application'] = const RelayResponse(ok: false, errorCode: 'INVALID_TRANSITION', errorMessage: 'This application was already sent.');
    await tester.tap(find.text('Approve & apply'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Approve & apply').last);
    await tester.pumpAndSettle();
    expect(find.text('This application was already sent.'), findsOneWidget);
  });

  testWidgets('with the desktop offline the buttons are disabled and say why', (tester) async {
    await _pump(tester, desktopOnline: false);
    final approve = tester.widget<ButtonStyleButton>(find.ancestor(of: find.text('Approve & apply'), matching: find.byWidgetPredicate((w) => w is ButtonStyleButton)).first);
    expect(approve.onPressed, isNull);
    expect(find.textContaining('Your desktop is offline'), findsOneWidget);
  });
}
