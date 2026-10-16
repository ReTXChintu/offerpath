import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/state/auth_controller.dart';
import 'package:offerpath_mobile/state/learning_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

const _today = {
  'date': '2026-10-16',
  'startedAt': null,
  'streak': 3,
  'goal': {'targetRoles': ['Backend engineer'], 'targetCompanies': <String>[], 'locations': <String>[], 'targetDate': '2026-12-31', 'daysLeft': 76},
  'learning': {
    'id': 'r1',
    'date': '2026-10-16',
    'totalMinutes': 45,
    'completedMinutes': 15,
    'recallDue': 2,
    'carriedCount': 0,
    'items': <Object>[],
  },
  'hunt': {'todos': <Object>[], 'approvals': 0, 'questions': 0},
  'interviews': [
    {'company': 'Acme', 'title': 'Backend engineer', 'daysLeft': 3, 'technologies': [{'id': 't1', 'name': 'Docker', 'onRoadmap': false}]},
  ],
  'skillGaps': [{'skill': 'Docker', 'jobs': 2, 'technology': null, 'onRoadmap': false}],
  'desktopOnline': true,
};

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  Future<(LearningController, FakeApi)> signedIn() async {
    final fake = FakeApi()
      ..on('POST', '/api/v1/pairing/redeem', const FakeReply.ok({'deviceId': 'd1', 'deviceToken': 'dev-1', 'userId': 'u1'}))
      ..on('GET', '/api/v1/today', const FakeReply.ok(_today))
      ..on('POST', '/api/v1/today/start', FakeReply.ok({..._today, 'startedAt': '2026-10-16T07:00:00.000Z', 'streak': 4}));
    final auth = AuthController(apiFactory: (url, {token}) => fake.client(server: url, token: token ?? ''));
    await auth.loadPersisted();
    await auth.pairWithCode(serverUrl: 'http://srv:50005', code: 'ABC123', deviceName: 'Pixel');
    return (LearningController(auth), fake);
  }

  test('reads the day from /today: the routine, the goal, the streak and interview prep', () async {
    final (learning, _) = await signedIn();
    await learning.refresh();

    expect(learning.routine?.completedMinutes, 15);
    expect(learning.recallDue, 2);
    expect(learning.plan?.streak, 3);
    expect(learning.plan?.goalRoles, ['Backend engineer']);
    expect(learning.plan?.goalDaysLeft, 76);
    expect(learning.plan?.prep.single.company, 'Acme');
    expect(learning.plan?.prep.single.technologies, ['Docker']);
    expect(learning.plan?.startedAt, isNull);
  });

  test('starts the day', () async {
    final (learning, fake) = await signedIn();
    await learning.refresh();
    await learning.startDay();

    expect(fake.requests.last.path, '/api/v1/today/start');
    expect(learning.plan?.startedAt, isNotNull);
    expect(learning.plan?.streak, 4);
  });
}
