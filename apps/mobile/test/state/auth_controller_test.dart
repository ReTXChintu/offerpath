import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/screens/login_screen.dart';
import 'package:offerpath_mobile/state/auth_controller.dart';
import 'package:offerpath_mobile/widgets/password_field.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  AuthController auth(FakeApi fake) => AuthController(apiFactory: (url, {token}) => fake.client(server: url, token: token ?? ''));

  test('pairing keeps only the device token, and later calls use it', () async {
    final fake = FakeApi()..on('POST', '/api/v1/pairing/redeem', const FakeReply.ok({'deviceId': 'd1', 'deviceToken': 'dev-1', 'userId': 'u1'}));
    final controller = auth(fake);
    await controller.loadPersisted();
    expect(controller.status, AuthStatus.signedOut);

    expect(await controller.pairWithCode(serverUrl: 'http://srv:50005/', code: ' abc123 ', deviceName: 'Pixel'), isTrue);
    expect(controller.status, AuthStatus.signedIn);
    expect(controller.serverUrl, 'http://srv:50005');
    expect(controller.deviceToken, 'dev-1');
    expect(fake.requests.single.body, {'code': 'ABC123', 'name': 'Pixel', 'platform': isA<String>()});

    // Survives a restart.
    final again = auth(fake);
    await again.loadPersisted();
    expect(again.status, AuthStatus.signedIn);
    expect(again.deviceId, 'd1');
  });

  test('a failed sign-in shows the problem detail and stays signed out', () async {
    final fake = FakeApi()..on('POST', '/api/v1/auth/login', FakeReply.problem(401, 'invalid-credentials', 'Invalid credentials', detail: 'That email and password combination is not recognised.'));
    final controller = auth(fake);
    await controller.loadPersisted();
    expect(await controller.signIn(serverUrl: 'http://srv:50005', email: 'a@b.test', password: 'nope', deviceName: ''), isFalse);
    expect(controller.status, AuthStatus.signedOut);
    expect(controller.lastError, 'That email and password combination is not recognised.');
  });

  test('a revoked token (hub 4401) forgets the phone and says why', () async {
    final fake = FakeApi()..on('POST', '/api/v1/pairing/redeem', const FakeReply.ok({'deviceId': 'd1', 'deviceToken': 'dev-1'}));
    final controller = auth(fake);
    await controller.loadPersisted();
    await controller.pairWithCode(serverUrl: 'http://srv:50005', code: 'ABC123', deviceName: '');
    await controller.handleRevoked();
    expect(controller.status, AuthStatus.signedOut);
    expect(controller.deviceToken, isNull);
    expect(controller.lastError, contains('signed out from another device'));
  });

  testWidgets('every password field has a show/hide eye with labels', (tester) async {
    final controller = AuthController();
    await controller.loadPersisted();
    await tester.pumpWidget(ChangeNotifierProvider.value(value: controller, child: const MaterialApp(home: LoginScreen())));
    await tester.tap(find.text('Email + password'));
    await tester.pumpAndSettle();

    expect(find.byType(PasswordField), findsOneWidget);
    EditableText field() => tester.widget<EditableText>(find.descendant(of: find.byType(PasswordField), matching: find.byType(EditableText)));
    expect(field().obscureText, isTrue);
    expect(find.byTooltip('Show password'), findsOneWidget);

    await tester.tap(find.byTooltip('Show password'));
    await tester.pump();
    expect(field().obscureText, isFalse);
    expect(find.byTooltip('Hide password'), findsOneWidget);
  });
}
