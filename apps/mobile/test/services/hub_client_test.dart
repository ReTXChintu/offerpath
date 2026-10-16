import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/services/hub_client.dart';

/// Runs [HubClient] against a real local WebSocket server standing in for
/// the API's hub.
void main() {
  late HttpServer server;
  late StreamController<WebSocket> sockets;
  final paths = <String>[];

  setUp(() async {
    sockets = StreamController<WebSocket>.broadcast();
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      paths.add('${request.uri.path}?${request.uri.query}');
      sockets.add(await WebSocketTransformer.upgrade(request));
    });
  });

  tearDown(() async {
    await server.close(force: true);
    await sockets.close();
    paths.clear();
  });

  String url() => 'http://127.0.0.1:${server.port}';

  test('connects to /api/v1/hub with the token and resolves a request by id', () async {
    sockets.stream.listen((ws) {
      ws.listen((raw) {
        final frame = jsonDecode(raw as String) as Map<String, dynamic>;
        ws.add(jsonEncode({'v': 1, 'id': frame['id'], 'type': 'response', 'payload': {'ok': true, 'data': {'echo': frame['type']}}}));
      });
    });
    final hub = HubClient(serverUrl: url(), deviceToken: 'tok');
    addTearDown(hub.dispose);
    hub.connect();
    await hub.state.firstWhere((s) => s == SocketState.connected);
    expect(paths.single, '/api/v1/hub?token=tok');
    final resp = await hub.request('list_queue');
    expect(resp.ok, isTrue);
    expect(resp.data, {'echo': 'list_queue'});
  });

  test('pushes (presence) come out of the push stream', () async {
    sockets.stream.listen((ws) => ws.add(jsonEncode({'v': 1, 'id': 'p1', 'type': 'presence', 'payload': {'device': 'desktop', 'online': true}})));
    final hub = HubClient(serverUrl: url(), deviceToken: 'tok');
    addTearDown(hub.dispose);
    final push = hub.pushes.first;
    hub.connect();
    final env = await push.timeout(const Duration(seconds: 5));
    expect(env.type, 'presence');
    expect(env.payload['online'], isTrue);
  });

  test('close code 4401 signs the phone out and stops reconnecting', () async {
    sockets.stream.listen((ws) => ws.close(hubCloseUnauthorized, 'This device was signed out'));
    final hub = HubClient(serverUrl: url(), deviceToken: 'revoked');
    addTearDown(hub.dispose);
    final signedOut = hub.signedOut.first;
    hub.connect();
    await signedOut.timeout(const Duration(seconds: 5));
    await Future<void>.delayed(const Duration(milliseconds: 1500));
    // No second attempt with a token the server already refused.
    expect(paths, hasLength(1));
    expect(hub.currentState, SocketState.disconnected);
  });

  test('without a connection a request fails at once with NOT_CONNECTED', () async {
    final hub = HubClient(serverUrl: url(), deviceToken: 'tok');
    addTearDown(hub.dispose);
    final resp = await hub.request('list_queue');
    expect(resp.errorCode, 'NOT_CONNECTED');
  });
}
