import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:offerpath_mobile/learn/live/realtime_client.dart';

/// A [RealtimeSocket] with no network: the test pushes server events with
/// [emit] and reads what the phone sent from [sent].
class FakeSocket implements RealtimeSocket {
  final _incoming = StreamController<String>();
  final List<Map<String, dynamic>> sent = [];
  bool closed = false;

  @override
  Stream<String> get messages => _incoming.stream;

  @override
  void send(String data) =>
      sent.add((jsonDecode(data) as Map).cast<String, dynamic>());

  /// One server event.
  void emit(Map<String, Object?> event) => _incoming.add(jsonEncode(event));

  /// The server dropped the connection.
  void drop() => unawaited(_incoming.close());

  @override
  Future<void> close() async {
    closed = true;
    // Not awaited: the done event waits for a listener.
    if (!_incoming.isClosed) unawaited(_incoming.close());
  }

  List<String> get sentTypes => sent.map((e) => e['type'] as String).toList();
}

/// Hands out [FakeSocket]s and records each connection's url and headers.
class FakeConnector {
  final List<FakeSocket> sockets = [];
  final List<Uri> urls = [];
  final List<Map<String, String>> headers = [];

  /// Fail the next connections with this.
  Object? failWith;

  FakeSocket get last => sockets.last;

  Future<RealtimeSocket> call(Uri url, Map<String, String> h) async {
    urls.add(url);
    headers.add(h);
    final fail = failWith;
    if (fail != null) throw fail;
    final socket = FakeSocket();
    sockets.add(socket);
    return socket;
  }
}

/// A [LiveMic] with no microphone: the test pushes audio with [push].
class FakeLiveMic implements LiveMic {
  FakeLiveMic({this.permission = true});

  bool permission;
  int starts = 0;
  int stops = 0;
  bool recording = false;
  bool disposed = false;
  StreamController<Uint8List>? _audio;

  void push(List<int> bytes) => _audio?.add(Uint8List.fromList(bytes));

  @override
  Future<bool> hasPermission() async => permission;

  @override
  Future<Stream<Uint8List>> start() async {
    starts++;
    recording = true;
    _audio = StreamController<Uint8List>();
    return _audio!.stream;
  }

  @override
  Future<void> stop() async {
    if (!recording) return;
    recording = false;
    stops++;
    final audio = _audio;
    _audio = null;
    if (audio != null) unawaited(audio.close());
  }

  @override
  Future<void> dispose() async {
    disposed = true;
    await stop();
  }
}
