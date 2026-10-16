import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/config.dart';
import 'package:offerpath_mobile/services/api_client.dart';

import '../support/fake_api.dart';

void main() {
  group('addresses', () {
    test('REST lives under /api/v1 on the server root', () {
      expect(apiBaseUrl('http://1.2.3.4:50005/'), 'http://1.2.3.4:50005/api/v1');
      expect(normalizeServerUrl('  http://1.2.3.4:50005// '), 'http://1.2.3.4:50005');
    });

    test('the hub is /api/v1/hub with the device token, ws or wss', () {
      expect(hubUri('http://1.2.3.4:50005', 'abc').toString(), 'ws://1.2.3.4:50005/api/v1/hub?token=abc');
      expect(hubUri('https://op.example/', 'a b').toString(), 'wss://op.example/api/v1/hub?token=a+b');
    });
  });

  group('ApiClient requests', () {
    test('sends the device token and calls paths under /api/v1', () async {
      final fake = FakeApi()..on('GET', '/api/v1/applications', const FakeReply.ok([]));
      final result = await fake.client(token: 'tok-1').get('/applications');
      expect(result, isEmpty);
      expect(fake.requests.single.path, '/api/v1/applications');
      expect(fake.requests.single.headers['Authorization'], 'Bearer tok-1');
    });

    test('an empty 200 body (a routine not planned yet) reads as null', () async {
      final fake = FakeApi()..on('GET', '/api/v1/routines/today', const FakeReply(200, ''));
      expect(await fake.client().get('/routines/today'), isNull);
    });

    test('email sign-in: login, then register the phone with the access token', () async {
      final fake = FakeApi()
        ..on('POST', '/api/v1/auth/login', const FakeReply.ok({'userId': 'u1', 'accessToken': 'jwt-1', 'refreshToken': 'r', 'expiresInSeconds': 900}))
        ..on('POST', '/api/v1/devices/register', const FakeReply.ok({'deviceId': 'd1', 'deviceToken': 'dev-tok'}));
      final api = fake.client(token: '');
      final tokens = await api.login('a@b.test', 'secret');
      final device = await api.registerDevice(accessToken: tokens.accessToken, name: 'Pixel', platform: 'android');
      expect(device.deviceToken, 'dev-tok');
      final register = fake.requests.last;
      expect(register.headers['Authorization'], 'Bearer jwt-1');
      expect(register.body, {'name': 'Pixel', 'kind': 'mobile', 'platform': 'android'});
    });

    test('pairing redeems the code for a device token', () async {
      final fake = FakeApi()..on('POST', '/api/v1/pairing/redeem', const FakeReply.ok({'deviceId': 'd2', 'deviceToken': 'paired', 'userId': 'u1'}));
      final device = await fake.client().redeemPairingCode(code: 'ABC123', name: 'Phone', platform: 'android');
      expect(device.deviceId, 'd2');
      expect(fake.requests.single.body, {'code': 'ABC123', 'name': 'Phone', 'platform': 'android'});
    });

    test('push tokens go to PUT /devices/me/push-token, null clears', () async {
      final fake = FakeApi()..on('PUT', '/api/v1/devices/me/push-token', const FakeReply.ok({'ok': true}));
      await fake.client().setPushToken(null);
      expect(fake.requests.single.body, {'token': null});
    });
  });

  group('ApiClient errors', () {
    test('problem details become an ApiException with their fields', () async {
      final fake = FakeApi()..on('POST', '/api/v1/auth/login', FakeReply.problem(401, 'invalid-credentials', 'Invalid credentials', detail: 'That email and password combination is not recognised.'));
      final error = await _error(() => fake.client().login('a@b.test', 'wrong'));
      expect(error.status, 401);
      expect(error.kind, 'invalid-credentials');
      expect(error.isUnauthorized, isTrue);
      expect(error.message, 'That email and password combination is not recognised.');
    });

    test('a validation problem reads its first field error', () async {
      final fake = FakeApi()
        ..on('POST', '/api/v1/auth/register', FakeReply.problem(400, 'validation-failed', 'Validation failed', detail: 'One or more fields are invalid.', errors: {'password': ['Use at least 8 characters']}));
      final error = await _error(() => fake.client().register('a@b.test', 'short', 'Ann'));
      expect(error.errors['password'], ['Use at least 8 characters']);
      expect(error.message, 'Use at least 8 characters');
    });

    test("503 means the desktop is offline: say so, don't show an error", () async {
      final fake = FakeApi()..on('POST', '/api/v1/concepts/c1/chat', FakeReply.problem(503, 'ai-unavailable', 'AI assistance unavailable', detail: 'AI runs on your desktop.'));
      final error = await _error(() => fake.client().post('/concepts/c1/chat', body: {'question': 'why?'}));
      expect(error.isDesktopOffline, isTrue);
      expect(error.message, desktopOfflineAiMessage);
      expect(error.message, "Your desktop is offline: AI answers come back when it's on");
    });

    test('a body that is not a problem still gives a readable error', () async {
      final fake = FakeApi()..on('GET', '/api/v1/jobs', const FakeReply(502, '<html>Bad gateway</html>', 'text/html'));
      final error = await _error(() => fake.client().get('/jobs'));
      expect(error.status, 502);
      expect(error.message, contains('server had a problem'));
    });

    test('no connection is a network error with status 0', () async {
      final fake = FakeApi()..offline = true;
      final error = await _error(() => fake.client().get('/applications'));
      expect(error.isNetwork, isTrue);
      expect(error.code, 'NETWORK');
      expect(error.message, contains("Couldn't reach"));
    });

    test('unknown routes answer 404 not-found', () async {
      final error = await _error(() => FakeApi().client().get('/nope'));
      expect(error.status, 404);
      expect(error.kind, 'not-found');
    });
  });

  group('desktopRequest', () {
    test('{data} is a successful reply', () async {
      final fake = FakeApi()..on('POST', '/api/v1/desktop/request', const FakeReply.ok({'data': {'status': 'APPROVED'}}));
      final resp = await fake.client().desktopRequest('approve_application', {'id': 'a1'});
      expect(resp.ok, isTrue);
      expect(resp.data, {'status': 'APPROVED'});
      expect(fake.requests.single.body, {'type': 'approve_application', 'payload': {'id': 'a1'}});
    });

    test('{error: {code, message}} keeps the desktop code', () async {
      final fake = FakeApi()
        ..on('POST', '/api/v1/desktop/request', const FakeReply(409, {'error': {'code': 'INVALID_TRANSITION', 'message': 'Already applied.'}}));
      final resp = await fake.client().desktopRequest('approve_application', {'id': 'a1'});
      expect(resp.ok, isFalse);
      expect(resp.errorCode, 'INVALID_TRANSITION');
      expect(resp.errorMessage, 'Already applied.');
    });

    test('503 DESKTOP_OFFLINE maps to the offline code', () async {
      final fake = FakeApi()
        ..on('POST', '/api/v1/desktop/request', const FakeReply(503, {'error': {'code': 'DESKTOP_OFFLINE', 'message': 'Your desktop is offline.'}}));
      final resp = await fake.client().desktopRequest('list_queue');
      expect(resp.errorCode, 'DESKTOP_OFFLINE');
    });
  });
}

Future<ApiException> _error(Future<Object?> Function() call) async {
  try {
    await call();
  } on ApiException catch (e) {
    return e;
  }
  fail('expected an ApiException');
}
