import 'dart:async';
import 'dart:math';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../config.dart';
import '../models/envelope.dart';

enum SocketState { disconnected, connecting, connected }

/// Close code the API uses for a bad or revoked device token.
const hubCloseUnauthorized = 4401;

/// Opens a WebSocket; replaced in tests.
typedef SocketConnector = WebSocketChannel Function(Uri uri);

/// Owns the one WebSocket to the API's hub (`/api/v1/hub?token=<deviceToken>`,
/// see `docs/hub-protocol.md`): reconnects with backoff on any drop, resolves
/// `request()` calls against matching `response` frames, and exposes pushes
/// (`presence`, `changed`, `notification`, `agent_status`) as a stream. Pure
/// transport: it never interprets `payload` beyond routing by `type`/`id`.
///
/// A close with code 4401 means this phone was signed out (revoked from the
/// desktop or the web): it stops reconnecting and fires [signedOut].
class HubClient {
  final String serverUrl;
  final String deviceToken;
  final SocketConnector _connector;

  HubClient({required this.serverUrl, required this.deviceToken, SocketConnector? connector}) : _connector = connector ?? WebSocketChannel.connect;

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _reconnectTimer;
  Duration _backoff = const Duration(seconds: 1);
  bool _closed = false;

  final _stateController = StreamController<SocketState>.broadcast();
  final _pushController = StreamController<Envelope>.broadcast();
  final _signedOutController = StreamController<void>.broadcast();
  final _pending = <String, Completer<RelayResponse>>{};

  Stream<SocketState> get state => _stateController.stream;
  Stream<Envelope> get pushes => _pushController.stream;

  /// The server closed the socket with 4401: this device token is no good.
  Stream<void> get signedOut => _signedOutController.stream;
  SocketState _current = SocketState.disconnected;
  SocketState get currentState => _current;

  Uri get uri => hubUri(serverUrl, deviceToken);

  void connect() {
    _closed = false;
    _connectOnce();
  }

  void _connectOnce() {
    if (_closed) return;
    _setState(SocketState.connecting);
    try {
      final channel = _connector(uri);
      _channel = channel;
      _sub = channel.stream.listen(_onFrame, onDone: () => _onClosed(channel), onError: (_) => _onClosed(channel), cancelOnError: true);
      // `ready` completes once the handshake succeeds; its error is handled
      // by onError/onDone the same way as any other drop.
      channel.ready.then((_) {
        if (!_closed && identical(_channel, channel)) {
          _setState(SocketState.connected);
          _backoff = const Duration(seconds: 1);
        }
      }).catchError((_) {});
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _onFrame(dynamic raw) {
    if (raw is! String) return;
    Envelope env;
    try {
      env = Envelope.decode(raw);
    } catch (_) {
      return;
    }
    if (env.type == 'response') {
      final id = env.id?.toString();
      final completer = id == null ? null : _pending.remove(id);
      completer?.complete(RelayResponse.fromPayload(env.payload));
      return;
    }
    _pushController.add(env);
  }

  void _onClosed(WebSocketChannel channel) {
    if (!identical(_channel, channel)) return;
    final code = channel.closeCode;
    _sub?.cancel();
    _sub = null;
    _channel = null;
    _setState(SocketState.disconnected);
    if (_closed) return;
    _failAllPending('NOT_CONNECTED', 'Lost the connection to the server.');
    if (code == hubCloseUnauthorized) {
      // Revoked: reconnecting with the same token would only be refused again.
      _closed = true;
      _signedOutController.add(null);
      return;
    }
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(_backoff, _connectOnce);
    _backoff = Duration(seconds: min(_backoff.inSeconds * 2, 30));
  }

  void _setState(SocketState s) {
    _current = s;
    if (!_stateController.isClosed) _stateController.add(s);
  }

  /// Sends a request and resolves once the matching `response` arrives, or
  /// after [timeout] with a synthetic timeout error, or immediately with a
  /// synthetic offline error if there is no live connection to send on.
  Future<RelayResponse> request(String type, [Map<String, dynamic> payload = const {}, Duration timeout = const Duration(seconds: 20)]) {
    final channel = _channel;
    if (channel == null || _current != SocketState.connected) {
      return Future.value(const RelayResponse(ok: false, errorCode: 'NOT_CONNECTED', errorMessage: 'Not connected to the server right now.'));
    }
    final id = _randomId();
    final completer = Completer<RelayResponse>();
    _pending[id] = completer;
    channel.sink.add(Envelope.request(id, type, payload).encode());
    Timer(timeout, () {
      if (!completer.isCompleted) {
        _pending.remove(id);
        completer.complete(const RelayResponse(ok: false, errorCode: 'TIMEOUT', errorMessage: 'The desktop took too long to respond.'));
      }
    });
    return completer.future;
  }

  void _failAllPending(String code, String message) {
    final entries = _pending.values.toList();
    _pending.clear();
    for (final c in entries) {
      if (!c.isCompleted) c.complete(RelayResponse(ok: false, errorCode: code, errorMessage: message));
    }
  }

  void dispose() {
    _closed = true;
    _reconnectTimer?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
    _channel = null;
    _failAllPending('CLOSED', 'Disconnected.');
    _stateController.close();
    _pushController.close();
    _signedOutController.close();
  }
}

final _rand = Random.secure();
String _randomId() => List.generate(16, (_) => _rand.nextInt(16).toRadixString(16)).join();
