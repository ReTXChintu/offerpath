import 'dart:async';
import 'dart:typed_data';

import 'package:offerpath_mobile/learn/live/segment_recorder.dart';

/// A [MicRecorder] with no microphone: the test pushes levels into
/// [pushLevel], and each recording's "bytes" are its number.
class FakeMicRecorder implements MicRecorder {
  FakeMicRecorder({this.permission = true});

  bool permission;
  int starts = 0;
  int stops = 0;
  bool recording = false;
  bool disposed = false;
  final _levels = StreamController<double>.broadcast();

  void pushLevel(double db) => _levels.add(db);

  @override
  Future<bool> hasPermission() async => permission;

  @override
  Future<void> start() async {
    starts++;
    recording = true;
  }

  @override
  Future<Uint8List?> stop() async {
    if (!recording) return null;
    recording = false;
    stops++;
    return Uint8List.fromList([stops]);
  }

  @override
  Stream<double> levels(Duration interval) => _levels.stream;

  @override
  Future<void> dispose() async {
    disposed = true;
    recording = false;
  }
}

/// A clock the test moves by hand.
class ManualClock {
  Duration now = Duration.zero;
  Duration call() => now;
  void advance(Duration by) => now += by;
}
