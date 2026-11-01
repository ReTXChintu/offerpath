/// Portfolio replies shaped exactly like the private API in
/// `docs/portfolio.md`, and a signed-in app wired to a [FakeApi] serving
/// them.
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:offerpath_mobile/state/auth_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_api.dart';

/// An [AuthController] signed in with a device token, whose API calls go to
/// [fake].
Future<AuthController> signedInAuth(FakeApi fake) async {
  SharedPreferences.setMockInitialValues({
    'offerpath.server_url': 'http://test.local:50005',
  });
  FlutterSecureStorage.setMockInitialValues({
    'offerpath.device_token': 'dev-tok',
  });
  final auth = AuthController(
    apiFactory: (url, {token}) => fake.client(server: url, token: token ?? ''),
  );
  await auth.loadPersisted();
  return auth;
}

/// Serves a portfolio: the overview, [messages] and one list per kind.
FakeApi portfolioApi({
  bool exists = true,
  List<Map<String, Object?>>? messages,
  List<Map<String, Object?>>? projects,
  List<Map<String, Object?>>? skills,
  List<Map<String, Object?>>? experience,
  List<Map<String, Object?>>? tools,
}) {
  final fake = FakeApi();
  if (exists) {
    fake.on('GET', '/api/v1/portfolio', FakeReply.ok(portfolioViewJson()));
  }
  fake
    ..on(
      'GET',
      '/api/v1/portfolio/messages',
      FakeReply.ok({
        'items': messages ?? [messageJson()],
      }),
    )
    ..on(
      'GET',
      '/api/v1/portfolio/projects',
      FakeReply.ok({
        'items': projects ?? [projectJson()],
      }),
    )
    ..on(
      'GET',
      '/api/v1/portfolio/skills',
      FakeReply.ok({
        'items': skills ?? [skillJson()],
      }),
    )
    ..on(
      'GET',
      '/api/v1/portfolio/experience',
      FakeReply.ok({
        'items': experience ?? [experienceJson()],
      }),
    )
    ..on(
      'GET',
      '/api/v1/portfolio/developer-tools',
      FakeReply.ok({
        'items': tools ?? [toolJson()],
      }),
    );
  return fake;
}

Map<String, Object?> portfolioViewJson({
  String handle = 'asha',
  int unreadMessages = 1,
  int drafts = 2,
}) => {
  'handle': handle,
  'settings': {
    'heroName': 'Asha Rao',
    'heroEyebrow': 'Full-stack developer',
    'roles': ['Developer'],
    'heroBio': '',
    'resumeUrl': '',
    'aboutHeadline': '',
    'aboutParagraphs': <String>[],
    'socials': {'github': '#', 'linkedin': '#', 'twitter': '#', 'email': '#'},
  },
  'cloudinary': {
    'configured': true,
    'cloudName': 'demo',
    'apiKeyLast4': '1234',
  },
  'publicUrl': '/api/v1/public/portfolio/$handle/site',
  'counts': {
    'projects': 3,
    'drafts': drafts,
    'skills': 2,
    'experience': 1,
    'developerTools': 0,
    'unreadMessages': unreadMessages,
  },
  'createdAt': '2026-10-20T09:00:00.000Z',
  'updatedAt': '2026-10-22T09:00:00.000Z',
};

Map<String, Object?> messageJson({
  String id = 'm1',
  String name = 'Ravi Kumar',
  String email = 'ravi@example.com',
  String message =
      'Hi Asha,\nloved the Offerpath project. Are you open to a contract role?',
  bool read = false,
  String createdAt = '2026-10-23T08:00:00.000Z',
}) => {
  'id': id,
  'name': name,
  'email': email,
  'message': message,
  'read': read,
  'createdAt': createdAt,
};

Map<String, Object?> projectJson({
  String id = 'pr1',
  String title = 'Offerpath',
  String? imageUrl,
  bool published = false,
  Map<String, Object?>? source = const {
    'collection': 'projects',
    'id': 'prof-1',
  },
}) => {
  'id': id,
  'title': title,
  'desc': 'Finds jobs and prepares you for interviews.',
  'tags': ['Flutter', 'NestJS'],
  'accent': '#6366f1',
  'gradientFrom': '#6366f1',
  'gradientTo': '#22d3ee',
  'imageUrl': imageUrl,
  'liveUrl': '',
  'githubUrl': 'https://github.com/asha/offerpath',
  'domain': 'Productivity',
  'order': 0,
  'published': published,
  'source': source,
  'followsSource': source != null,
  'localPath': null,
  'createdAt': '2026-10-20T09:00:00.000Z',
  'updatedAt': '2026-10-20T09:00:00.000Z',
};

Map<String, Object?> skillJson({String id = 's1', bool published = false}) => {
  'id': id,
  'cat': 'Frontend',
  'items': ['React', 'Flutter'],
  'order': 0,
  'published': published,
  'source': {'collection': 'skills', 'id': 'skills:frontend'},
  'followsSource': true,
  'createdAt': '2026-10-20T09:00:00.000Z',
  'updatedAt': '2026-10-20T09:00:00.000Z',
};

Map<String, Object?> experienceJson({
  String id = 'e1',
  bool published = true,
}) => {
  'id': id,
  'title': 'Senior engineer',
  'company': 'Acme',
  'period': 'Jan 2024 – Present',
  'bullets': ['Shipped things'],
  'order': 0,
  'published': published,
  'source': null,
  'followsSource': false,
  'createdAt': '2026-10-20T09:00:00.000Z',
  'updatedAt': '2026-10-20T09:00:00.000Z',
};

Map<String, Object?> toolJson({String id = 't1', bool published = false}) => {
  'id': id,
  'title': 'json-diff-cli',
  'slug': 'json-diff-cli',
  'shortDescription': 'Diff two JSON files in the terminal.',
  'fullDescription': '',
  'domain': 'CLI',
  'techStacks': ['Node'],
  'accent': '#10b981',
  'gradientFrom': '#10b981',
  'gradientTo': '#3b82f6',
  'githubUrl': '',
  'npmUrl': '',
  'docsUrl': '',
  'demoUrl': '',
  'installCommand': 'npm i -g json-diff-cli',
  'packageName': 'json-diff-cli',
  'version': '1.0.0',
  'featured': false,
  'published': published,
  'sortOrder': 2,
  'createdAt': '2026-10-20T09:00:00.000Z',
  'updatedAt': '2026-10-20T09:00:00.000Z',
};
