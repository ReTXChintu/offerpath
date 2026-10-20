import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:offerpath_mobile/services/api_client.dart';

/// One canned HTTP reply.
class FakeReply {
  const FakeReply(this.status, [this.body, this.contentType = 'application/json']);

  /// 200 with a JSON body.
  const FakeReply.ok(Object? body) : this(200, body);

  /// An RFC 9457 problem, as the API sends every error.
  FakeReply.problem(int status, String type, String title, {String? detail, Map<String, List<String>>? errors})
      : this(status, {'type': 'urn:offerpath:error:$type', 'title': title, 'status': status, 'detail': ?detail, 'errors': ?errors}, 'application/problem+json');

  final int status;
  final Object? body;
  final String contentType;
}

/// A recorded request.
class FakeRequest {
  FakeRequest(this.method, this.path, this.body, this.headers, [this.receiveTimeout]);
  final String method;
  final String path;
  final Object? body;
  final Map<String, dynamic> headers;

  /// How long the client would wait for this reply.
  final Duration? receiveTimeout;
}

/// Answers Dio requests from a table keyed `'METHOD /api/v1/path'`, records
/// every request, and answers 404 for anything not stubbed. Lets the real
/// [ApiClient] (and every page that uses it) run with no server.
class FakeApi implements HttpClientAdapter {
  final Map<String, FakeReply Function(FakeRequest)> routes = {};
  final List<FakeRequest> requests = [];

  /// Throw a connection error instead of answering.
  bool offline = false;

  /// While set, replies wait for it (to see a screen mid-request).
  Completer<void>? hold;

  void on(String method, String path, FakeReply reply) => routes['$method $path'] = (_) => reply;

  ApiClient client({String token = 'device-token', String server = 'http://test.local:50005'}) => ApiClient(server, token: token, dio: Dio()..httpClientAdapter = this);

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (offline) throw DioException.connectionError(requestOptions: options, reason: 'offline');
    final request = FakeRequest(options.method, options.uri.path, options.data, options.headers, options.receiveTimeout);
    requests.add(request);
    if (hold != null) await hold!.future;
    final handler = routes['${options.method} ${options.uri.path}'];
    final reply = handler == null ? FakeReply.problem(404, 'not-found', 'Not found') : handler(request);
    final text = reply.body == null ? '' : (reply.body is String ? reply.body as String : jsonEncode(reply.body));
    return ResponseBody.fromString(text, reply.status, headers: {
      Headers.contentTypeHeader: [reply.contentType],
    });
  }

  @override
  void close({bool force = false}) {}
}
