import 'dart:convert';

import 'package:dio/dio.dart';

import '../config.dart';
import '../models/envelope.dart';
import '../models/interview_prep.dart';
import '../models/live_practice.dart';
import '../models/mock_interview.dart';

/// What the phone shows when an AI answer needs the desktop and it's off.
const desktopOfflineAiMessage = "Your desktop is offline: AI answers come back when it's on";

/// A failed API call. The API answers every error as RFC 9457 problem
/// details (`{type, title, status, detail, errors?}`); this keeps those
/// fields, plus [code] for the few replies that use `{error: {code,
/// message}}` (`POST /desktop/request`, and errors from older servers).
/// A network failure has [status] 0.
class ApiException implements Exception {
  final int status;

  /// The problem type URI, e.g. `urn:offerpath:error:invalid-credentials`.
  final String type;
  final String title;
  final String? detail;

  /// Field errors from a `validation-failed` problem.
  final Map<String, List<String>> errors;

  /// `DESKTOP_OFFLINE`, `NETWORK`, ... when the reply carried a code.
  final String? code;

  const ApiException({required this.status, required this.type, required this.title, this.detail, this.errors = const {}, this.code});

  /// The last segment of [type]: `invalid-credentials`, `ai-unavailable`.
  String get kind {
    final i = type.lastIndexOf(RegExp('[:/]'));
    return i < 0 ? type : type.substring(i + 1);
  }

  bool get isNetwork => status == 0;
  bool get isUnauthorized => status == 401;

  /// The work needed the user's desktop (AI answers, relayed requests) and
  /// it isn't connected. The API says so with 503.
  bool get isDesktopOffline => status == 503 || code == 'DESKTOP_OFFLINE';

  /// One sentence for the user.
  String get message {
    if (isDesktopOffline) return desktopOfflineAiMessage;
    if (errors.isNotEmpty) {
      final first = errors.values.expand((e) => e).where((e) => e.isNotEmpty).firstOrNull;
      if (first != null) return first;
    }
    if (detail != null && detail!.trim().isNotEmpty) return detail!;
    return title;
  }

  @override
  String toString() => message;

  /// Reads an error reply: problem details, `{error: {code, message}}`, or
  /// anything else (a proxy's HTML page, nothing at all).
  factory ApiException.fromResponse(int status, dynamic body) {
    if (body is Map) {
      final map = body.cast<String, dynamic>();
      if (map['error'] is Map) {
        final err = (map['error'] as Map).cast<String, dynamic>();
        final message = err['message']?.toString();
        return ApiException(status: status, type: 'urn:offerpath:error:${_slug(status)}', title: message ?? 'Something went wrong.', code: err['code']?.toString());
      }
      if (map['title'] is String || map['type'] is String) {
        final errors = <String, List<String>>{};
        final raw = map['errors'];
        if (raw is Map) {
          raw.forEach((k, v) => errors[k.toString()] = v is List ? v.map((e) => e.toString()).toList() : [v.toString()]);
        }
        return ApiException(
          status: (map['status'] as num?)?.toInt() ?? status,
          type: map['type']?.toString() ?? 'urn:offerpath:error:${_slug(status)}',
          title: map['title']?.toString() ?? 'Request failed',
          detail: map['detail']?.toString(),
          errors: errors,
        );
      }
    }
    return ApiException(status: status, type: 'urn:offerpath:error:${_slug(status)}', title: status >= 500 ? 'The server had a problem. Try again in a moment.' : 'Request failed ($status).');
  }

  static String _slug(int status) => switch (status) {
        400 => 'bad-request',
        401 => 'unauthorized',
        403 => 'forbidden',
        404 => 'not-found',
        409 => 'conflict',
        429 => 'rate-limited',
        503 => 'unavailable',
        _ => 'error',
      };
}

/// The tokens `POST /auth/login` and `/auth/register` return. Only the
/// access token is used, once, to register this phone as a device.
class AuthTokens {
  final String userId;
  final String accessToken;
  const AuthTokens({required this.userId, required this.accessToken});
}

class DeviceRegistration {
  final String deviceId;
  final String deviceToken;
  const DeviceRegistration({required this.deviceId, required this.deviceToken});
}

/// REST calls to the Offerpath API (`<server>/api/v1/...`), authorized with
/// this phone's device token, which the API accepts anywhere a JWT works.
/// Every method throws [ApiException] on failure.
class ApiClient {
  final String serverUrl;
  final String? token;
  final Dio _dio;

  ApiClient(String serverUrl, {this.token, Dio? dio, Duration timeout = const Duration(seconds: 20)})
      : serverUrl = normalizeServerUrl(serverUrl),
        _dio = dio ?? Dio() {
    _dio.options
      ..baseUrl = apiBaseUrl(serverUrl)
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = timeout
      ..headers = {
        ..._dio.options.headers,
        if (token != null && token!.isNotEmpty) 'Authorization': 'Bearer $token',
      };
  }

  /// How long an answer that comes from Claude on the user's desktop may
  /// take (a tutor reply, an interview question, a first explanation).
  static const aiTimeout = Duration(minutes: 3);

  Future<dynamic> get(String path, {Map<String, dynamic>? query, Duration? timeout}) => _send('GET', path, query: query, timeout: timeout);
  Future<dynamic> post(String path, {Object? body, Duration? timeout}) => _send('POST', path, body: body ?? const <String, dynamic>{}, timeout: timeout);
  Future<dynamic> patch(String path, {Object? body, Duration? timeout}) => _send('PATCH', path, body: body ?? const <String, dynamic>{}, timeout: timeout);
  Future<dynamic> put(String path, {Object? body}) => _send('PUT', path, body: body ?? const <String, dynamic>{});
  Future<dynamic> delete(String path) => _send('DELETE', path);

  Future<dynamic> _send(String method, String path, {Object? body, Map<String, dynamic>? query, Options? options, Duration? timeout}) async {
    try {
      final opts = (options ?? Options()).copyWith(method: method, receiveTimeout: timeout);
      final resp = await _dio.request<dynamic>(path, data: body, queryParameters: query, options: opts);
      final data = resp.data;
      // Nest answers `null` (a routine not planned yet) with an empty body.
      if (data is String && data.isEmpty) return null;
      return data;
    } on DioException catch (e) {
      throw translate(e);
    }
  }

  /// Maps a Dio failure to an [ApiException].
  static ApiException translate(DioException e) {
    final response = e.response;
    if (response != null) return ApiException.fromResponse(response.statusCode ?? 0, response.data);
    final timedOut = e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout || e.type == DioExceptionType.sendTimeout;
    return ApiException(
      status: 0,
      type: 'network',
      title: timedOut ? 'The server took too long to answer. Check your connection and try again.' : "Couldn't reach the Offerpath server. Check your connection.",
      code: 'NETWORK',
    );
  }

  // -- Accounts and devices -------------------------------------------------

  Future<AuthTokens> login(String email, String password) async =>
      _tokens(await post('/auth/login', body: {'email': email, 'password': password}));

  Future<AuthTokens> register(String email, String password, String displayName) async =>
      _tokens(await post('/auth/register', body: {'email': email, 'password': password, 'displayName': displayName}));

  AuthTokens _tokens(dynamic j) {
    if (j is! Map || j['accessToken'] is! String) throw const ApiException(status: 0, type: 'bad-reply', title: 'Unexpected reply from the server.');
    return AuthTokens(userId: j['userId']?.toString() ?? '', accessToken: j['accessToken'] as String);
  }

  /// Registers this phone with a fresh access token (from [login]); the
  /// device token it returns is the only credential the app keeps.
  Future<DeviceRegistration> registerDevice({required String accessToken, required String name, required String platform}) async {
    final j = await _send('POST', '/devices/register',
        body: {'name': name, 'kind': 'mobile', 'platform': platform}, options: Options(headers: {'Authorization': 'Bearer $accessToken'}));
    return _device(j);
  }

  /// Exchanges a pairing code from the desktop for a device token.
  Future<DeviceRegistration> redeemPairingCode({required String code, required String name, required String platform}) async =>
      _device(await post('/pairing/redeem', body: {'code': code, 'name': name, 'platform': platform}));

  DeviceRegistration _device(dynamic j) {
    if (j is! Map || j['deviceToken'] is! String) throw const ApiException(status: 0, type: 'bad-reply', title: 'Unexpected reply from the server.');
    return DeviceRegistration(deviceId: j['deviceId']?.toString() ?? '', deviceToken: j['deviceToken'] as String);
  }

  /// Signs a device out (this phone's own, on sign-out).
  Future<void> revokeDevice(String deviceId) => delete('/devices/${Uri.encodeComponent(deviceId)}');

  /// Where Firebase should push for this phone; null stops pushes.
  Future<void> setPushToken(String? pushToken) => put('/devices/me/push-token', body: {'token': pushToken});

  // -- The desktop --------------------------------------------------------

  /// One request to the desktop over HTTP (`POST /desktop/request`), the
  /// same as a hub request frame. Never throws: failures come back as a
  /// [RelayResponse] with the desktop's code (`DESKTOP_OFFLINE`, ...).
  Future<RelayResponse> desktopRequest(String type, [Map<String, dynamic> payload = const {}]) async {
    try {
      final j = await post('/desktop/request', body: {'type': type, 'payload': payload});
      return RelayResponse(ok: true, data: j is Map ? j['data'] : null);
    } on ApiException catch (e) {
      return RelayResponse(ok: false, errorCode: e.code ?? (e.isDesktopOffline ? 'DESKTOP_OFFLINE' : e.kind.toUpperCase()), errorMessage: e.isDesktopOffline ? null : e.message);
    }
  }

  // -- Interview prep -------------------------------------------------------

  static String _prepPath(String id) => '/interview-preps/${Uri.encodeComponent(id)}';

  static Prep _prep(dynamic j) {
    if (j is! Map) throw const ApiException(status: 0, type: 'bad-reply', title: 'Unexpected reply from the server.');
    return Prep.fromJson(j.cast<String, dynamic>());
  }

  /// Every interview being prepared for, soonest first.
  Future<List<Prep>> listPreps() async {
    final j = await get('/interview-preps');
    final list = j is Map ? j['preps'] : j;
    return (list is List ? list : const []).whereType<Map>().map((m) => Prep.fromJson(m.cast<String, dynamic>())).toList();
  }

  Future<Prep> getPrep(String id) async => _prep(await get(_prepPath(id)));

  /// Where prep AI would run right now; null when nowhere (laptop offline,
  /// no OpenAI key).
  Future<PrepAiSource?> prepAiSource() async {
    final j = await get('/interview-preps/ai');
    return prepAiSourceOf(j is Map ? j['source'] : null);
  }

  /// Starts a prep; it comes back `GENERATING`. [scheduledAt] is local time,
  /// sent as an ISO date-time with its offset.
  Future<Prep> createPrep({
    String? company,
    String? role,
    String? jobDescription,
    List<String> technologies = const [],
    required DateTime scheduledAt,
    bool includeDsa = false,
    PrepResume? resume,
  }) async {
    String? orNull(String? s) => s == null || s.trim().isEmpty ? null : s.trim();
    return _prep(await post('/interview-preps', body: {
      'company': orNull(company),
      'role': orNull(role),
      'jobDescription': orNull(jobDescription),
      'technologies': technologies,
      'scheduledAt': isoWithOffset(scheduledAt),
      'includeDsa': includeDsa,
      if (resume != null) 'resume': resume.toJson(),
    }));
  }

  /// Changes a prep (only what's given; an empty company, role or job
  /// description clears it). Changing the job description, technologies,
  /// DSA or the CV ([resume], or [removeResume]) rewrites the plan and
  /// questions: the prep comes back `GENERATING`.
  Future<Prep> updatePrep(
    String id, {
    String? company,
    String? role,
    DateTime? scheduledAt,
    String? jobDescription,
    List<String>? technologies,
    bool? includeDsa,
    PrepResume? resume,
    bool removeResume = false,
  }) async =>
      _prep(await patch(_prepPath(id), body: {
        if (company != null) 'company': company.trim().isEmpty ? null : company.trim(),
        if (role != null) 'role': role.trim().isEmpty ? null : role.trim(),
        if (scheduledAt != null) 'scheduledAt': isoWithOffset(scheduledAt),
        if (jobDescription != null) 'jobDescription': jobDescription.trim().isEmpty ? null : jobDescription.trim(),
        'technologies': ?technologies,
        'includeDsa': ?includeDsa,
        if (resume != null) 'resume': resume.toJson() else if (removeResume) 'resume': null,
      }));

  Future<void> deletePrep(String id) => delete(_prepPath(id));

  /// Writes the plan and questions again (after a failure).
  Future<Prep> regeneratePrep(String id) async => _prep(await post('${_prepPath(id)}/regenerate'));

  /// Grades a practice answer. Fails with a 503 `ai-unavailable` when no AI
  /// can run (see [isPrepAiUnavailable]).
  Future<PrepQuestion> answerPrepQuestion(String prepId, String questionId, String answer) async {
    final j = await post('${_prepPath(prepId)}/questions/${Uri.encodeComponent(questionId)}/answer', body: {'answer': answer.trim()}, timeout: aiTimeout);
    if (j is! Map) throw const ApiException(status: 0, type: 'bad-reply', title: 'Unexpected reply from the server.');
    return PrepQuestion.fromJson(j.cast<String, dynamic>());
  }

  /// Reads the text out of a CV file (.pdf, .docx, .txt, .md, 4 MB at most).
  /// Fails with a validation error when the type isn't supported or no text
  /// comes out (a scanned PDF).
  Future<CvExtract> extractCv(String fileName, List<int> bytes) async {
    final j = await post('/interview-preps/cv/extract', body: {'fileName': fileName, 'contentBase64': base64Encode(bytes)}, timeout: const Duration(seconds: 90));
    if (j is! Map) throw const ApiException(status: 0, type: 'bad-reply', title: 'Unexpected reply from the server.');
    return CvExtract.fromJson(j.cast<String, dynamic>());
  }

  /// A CV written from the user's synced Offerpath profile; null when there
  /// isn't one.
  Future<String?> profileCv() async {
    final j = await get('/interview-preps/cv/profile');
    final text = j is Map ? j['text'] : null;
    return text is String && text.trim().isNotEmpty ? text : null;
  }

  // -- Mock interviews ------------------------------------------------------

  static String _mockPath(String id) => '/mock-interviews/${Uri.encodeComponent(id)}';

  static MockInterview _mock(dynamic j) {
    if (j is! Map) throw const ApiException(status: 0, type: 'bad-reply', title: 'Unexpected reply from the server.');
    return MockInterview.fromJson(j.cast<String, dynamic>());
  }

  /// The prep's mock interview still in progress, or a new one (the opening
  /// question is there at once). [restart] abandons the one in progress.
  Future<MockInterview> startMockInterview(String prepId, {bool restart = false}) async =>
      _mock(await post('${_prepPath(prepId)}/mock-interviews', body: {if (restart) 'restart': true}, timeout: const Duration(seconds: 60)));

  Future<MockInterview> getMockInterview(String id) async => _mock(await get(_mockPath(id)));

  /// Sends an answer and waits for the interviewer's next turn (5-60 s, so
  /// [aiTimeout]). A 503 `ai-unavailable` still saves the answer: retry with
  /// [replyMockInterview].
  Future<MockInterview> answerMockInterview(String id, {String? text, String? code, String? codeLanguage}) async {
    final t = text?.trim() ?? '';
    final c = code == null || code.trim().isEmpty ? null : code;
    return _mock(await post('${_mockPath(id)}/answer', body: {
      if (t.isNotEmpty) 'text': t,
      'code': ?c,
      if (c != null && codeLanguage != null) 'codeLanguage': codeLanguage,
    }, timeout: aiTimeout));
  }

  /// Retries the interviewer's reply to the last answer.
  Future<MockInterview> replyMockInterview(String id) async => _mock(await post('${_mockPath(id)}/reply', timeout: aiTimeout));

  /// Ends the interview now; the report is written in the background.
  Future<MockInterview> finishMockInterview(String id) async => _mock(await post('${_mockPath(id)}/finish', timeout: const Duration(seconds: 60)));

  /// Writes a failed report again.
  Future<MockInterview> retryMockReport(String id) async => _mock(await post('${_mockPath(id)}/report', timeout: const Duration(seconds: 60)));

  Future<void> deleteMockInterview(String id) => delete(_mockPath(id));

  // -- Live practice ----------------------------------------------------------

  static String _livePath(String id) => '/live-practice/${Uri.encodeComponent(id)}';

  static LivePracticeView _live(dynamic j) {
    if (j is! Map) throw const ApiException(status: 0, type: 'bad-reply', title: 'Unexpected reply from the server.');
    return LivePracticeView.fromJson(j.cast<String, dynamic>());
  }

  /// Whether live practice can start (it needs the user's OpenAI key).
  Future<LiveReady> livePracticeReady() async {
    final j = await get('/live-practice/ready');
    if (j is! Map) throw const ApiException(status: 0, type: 'bad-reply', title: 'Unexpected reply from the server.');
    return LiveReady.fromJson(j.cast<String, dynamic>());
  }

  /// Every live-practice session, newest first.
  Future<List<LivePracticeSummary>> listLivePractice() async {
    final j = await get('/live-practice');
    final list = j is Map ? j['sessions'] : j;
    return (list is List ? list : const []).whereType<Map>().map((m) => LivePracticeSummary.fromJson(m.cast<String, dynamic>())).toList();
  }

  /// Starts a session (for a prep, or for [technologies]). Fails with 400
  /// when no OpenAI key is saved.
  Future<LivePracticeView> startLivePractice({String? prepId, List<String> technologies = const [], String? title, AnswerFor answerFor = AnswerFor.me}) async {
    final t = title?.trim() ?? '';
    final techs = technologies.map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
    return _live(await post('/live-practice', body: {
      'prepId': ?prepId,
      if (techs.isNotEmpty) 'technologies': techs,
      if (t.isNotEmpty) 'title': t,
      'answerFor': answerForValue(answerFor),
    }, timeout: const Duration(seconds: 60)));
  }

  Future<LivePracticeView> getLivePractice(String id) async => _live(await get(_livePath(id)));

  /// A new [answerFor] needs a new realtime pass (and a reconnect).
  Future<LivePracticeView> updateLivePractice(String id, {AnswerFor? answerFor, String? title}) async => _live(await patch(_livePath(id), body: {
        if (answerFor != null) 'answerFor': answerForValue(answerFor),
        if (title != null && title.trim().isNotEmpty) 'title': title.trim(),
      }));

  /// A short-lived OpenAI Realtime pass for this session: the phone connects
  /// with it straight to OpenAI. 409 once the session has ended; 503 with
  /// OpenAI's own message when it refuses.
  Future<RealtimePass> livePracticeRealtime(String id) async {
    final j = await post('${_livePath(id)}/realtime', timeout: const Duration(seconds: 30));
    if (j is! Map) throw const ApiException(status: 0, type: 'bad-reply', title: 'Unexpected reply from the server.');
    return RealtimePass.fromJson(j.cast<String, dynamic>());
  }

  /// Saves one answered question (cut to the API's limits: 2,000 and 8,000
  /// characters).
  Future<LiveExchange> saveLivePracticeExchange(String id, {required String question, required String answer}) async {
    String cut(String s, int max) => s.length > max ? s.substring(0, max) : s;
    final j = await post('${_livePath(id)}/exchanges', body: {'question': cut(question.trim(), 2000), 'answer': cut(answer.trim(), 8000)});
    if (j is! Map) throw const ApiException(status: 0, type: 'bad-reply', title: 'Unexpected reply from the server.');
    return LiveExchange.fromJson(j.cast<String, dynamic>());
  }

  /// Ends the session.
  Future<LivePracticeView> endLivePractice(String id) async => _live(await post('${_livePath(id)}/end', timeout: const Duration(seconds: 60)));

  Future<void> deleteLivePractice(String id) => delete(_livePath(id));
}
