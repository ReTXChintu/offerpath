import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:record/record.dart';

/// The microphone, as live practice needs it: record to a file, stop and
/// hand back the bytes, and report the input level. Behind an interface so
/// [SegmentRecorder] can be tested with a fake.
abstract interface class MicRecorder {
  /// Asks for the microphone permission when it hasn't been decided yet.
  Future<bool> hasPermission();

  /// Starts a new recording (AAC-LC in an m4a file, mono, 16 kHz).
  Future<void> start();

  /// Stops the recording and returns what was recorded (null when nothing
  /// was). The file is deleted.
  Future<Uint8List?> stop();

  /// The input level in dBFS (0 is the loudest, about -160 is silence),
  /// every [interval] while recording.
  Stream<double> levels(Duration interval);

  Future<void> dispose();
}

/// [MicRecorder] on the `record` plugin. Each segment is its own file in the
/// app's temporary directory, read and deleted as soon as it's stopped.
class PlatformMicRecorder implements MicRecorder {
  PlatformMicRecorder({AudioRecorder? recorder})
    : _recorder = recorder ?? AudioRecorder();

  final AudioRecorder _recorder;
  String? _path;
  int _n = 0;

  static const config = RecordConfig(
    encoder: AudioEncoder.aacLc,
    sampleRate: 16000,
    numChannels: 1,
    bitRate: 32000,
  );

  @override
  Future<bool> hasPermission() => _recorder.hasPermission();

  @override
  Future<void> start() async {
    // Flutter points systemTemp at the app's own cache directory on Android
    // and iOS.
    final dir = Directory.systemTemp.path;
    final path =
        '$dir${Platform.pathSeparator}live-${DateTime.now().millisecondsSinceEpoch}-${_n++}.m4a';
    _path = path;
    await _recorder.start(config, path: path);
  }

  @override
  Future<Uint8List?> stop() async {
    final stopped = await _recorder.stop();
    final path = stopped ?? _path;
    _path = null;
    if (path == null) return null;
    final file = File(path);
    try {
      if (!await file.exists()) return null;
      return await file.readAsBytes();
    } finally {
      try {
        await file.delete();
      } catch (_) {}
    }
  }

  @override
  Stream<double> levels(Duration interval) =>
      _recorder.onAmplitudeChanged(interval).map((a) => a.current);

  @override
  Future<void> dispose() async {
    final path = _path;
    _path = null;
    await _recorder.dispose();
    if (path != null) {
      try {
        await File(path).delete();
      } catch (_) {}
    }
  }
}

/// One finished stretch of speech, ready to upload.
class RecordedSegment {
  const RecordedSegment({required this.bytes, required this.durationMs});

  final Uint8List bytes;
  final int durationMs;
}

/// What [SpeechDetector.add] decided for one level sample.
enum SegmentDecision {
  /// Keep recording.
  none,

  /// The speech is over (or the segment is at its cap): upload it.
  cut,

  /// Nothing was said: throw the recording away and start again.
  discard,
}

/// The voice-activity check, on its own so it can be tested sample by
/// sample. Speech is any level above the threshold: [threshold] dBFS, or
/// [noiseMargin] dB over the room's noise floor when that's louder (a busy
/// café shouldn't count as someone talking). A segment ends [silence] after
/// the last speech, and never runs longer than [maxSegment]. A segment with
/// less than [minSpeech] of speech in it (a cough, a cup on the table) is
/// discarded, and one with no speech at all is restarted after [idleRestart]
/// so the files stay small.
class SpeechDetector {
  SpeechDetector({
    this.threshold = -40,
    this.adaptToNoise = true,
    this.noiseMargin = 12,
    this.silence = const Duration(milliseconds: 1200),
    this.maxSegment = const Duration(seconds: 30),
    this.idleRestart = const Duration(seconds: 10),
    this.minSpeech = const Duration(milliseconds: 250),
  });

  final double threshold;
  final bool adaptToNoise;
  final double noiseMargin;
  final Duration silence;
  final Duration maxSegment;
  final Duration idleRestart;
  final Duration minSpeech;

  /// The estimated noise floor, dBFS (null until the first sample).
  double? noiseFloor;

  Duration _start = Duration.zero;
  Duration? _lastSample;
  Duration? _lastSpeech;
  Duration _speech = Duration.zero;

  /// Whether the last sample was speech.
  bool speaking = false;

  bool get heardSpeech => _speech >= minSpeech;

  /// The level speech has to reach right now.
  double get effectiveThreshold {
    final floor = noiseFloor;
    if (!adaptToNoise || floor == null) return threshold;
    return math.max(threshold, floor + noiseMargin);
  }

  /// Starts a new segment at [at] (the noise floor carries over).
  void reset(Duration at) {
    _start = at;
    _lastSample = at;
    _lastSpeech = null;
    _speech = Duration.zero;
    speaking = false;
  }

  /// How long the current segment has run at [at].
  Duration elapsed(Duration at) => at - _start;

  /// Takes one level sample, [db] dBFS at time [at].
  SegmentDecision add(double db, Duration at) {
    final level = db.isFinite ? db.clamp(-160.0, 0.0) : -160.0;
    final since = _lastSample == null ? Duration.zero : at - _lastSample!;
    _lastSample = at;
    speaking = level > effectiveThreshold;
    if (speaking) {
      _speech += since;
      _lastSpeech = at;
    } else {
      _trackNoise(level);
    }

    final length = at - _start;
    final lastSpeech = _lastSpeech;
    if (lastSpeech != null && at - lastSpeech >= silence) {
      return heardSpeech ? SegmentDecision.cut : SegmentDecision.discard;
    }
    if (length >= maxSegment) {
      return heardSpeech ? SegmentDecision.cut : SegmentDecision.discard;
    }
    if (lastSpeech == null && length >= idleRestart) {
      return SegmentDecision.discard;
    }
    return SegmentDecision.none;
  }

  /// The floor follows quiet samples: down at once, up slowly.
  void _trackNoise(double level) {
    final floor = noiseFloor;
    if (floor == null || level < floor) {
      noiseFloor = level;
    } else {
      noiseFloor = floor + (level - floor) * 0.05;
    }
  }
}

/// Records the microphone and cuts it into segments at pauses
/// ([SpeechDetector]); each finished segment comes out of [segments] while
/// the next one is already recording. Segments with no speech in them are
/// thrown away, never uploaded.
class SegmentRecorder {
  SegmentRecorder({
    MicRecorder? recorder,
    SpeechDetector? detector,
    this.sampleEvery = const Duration(milliseconds: 100),
    Duration Function()? clock,
  }) : recorder = recorder ?? PlatformMicRecorder(),
       detector = detector ?? SpeechDetector(),
       _clock = clock ?? _stopwatchClock();

  final MicRecorder recorder;
  final SpeechDetector detector;
  final Duration sampleEvery;
  final Duration Function() _clock;

  // Synchronous, so a segment flushed by [stop] is queued before it returns.
  final _segments = StreamController<RecordedSegment>.broadcast(sync: true);
  StreamSubscription<double>? _levelsSub;
  bool _listening = false;
  bool _cutting = false;
  Future<void>? _pendingCut;
  bool _disposed = false;

  /// The input level, 0 (silence) to 1 (loud), for a meter.
  final ValueNotifier<double> level = ValueNotifier(0);

  /// Whether someone is speaking right now.
  final ValueNotifier<bool> speaking = ValueNotifier(false);

  /// Finished segments, in order.
  Stream<RecordedSegment> get segments => _segments.stream;

  bool get isListening => _listening;

  static Duration Function() _stopwatchClock() {
    final watch = Stopwatch()..start();
    return () => watch.elapsed;
  }

  Future<bool> hasPermission() => recorder.hasPermission();

  /// Starts listening (the caller has checked the permission).
  Future<void> start() async {
    if (_listening || _disposed) return;
    _listening = true;
    await recorder.start();
    detector.reset(_clock());
    _levelsSub ??= recorder.levels(sampleEvery).listen(_onLevel);
  }

  /// Stops listening. The speech recorded so far is sent as a last segment
  /// when [flush] is set.
  Future<void> stop({bool flush = true}) async {
    if (!_listening) return;
    _listening = false;
    // Not awaited: nothing depends on it, and it can resolve late.
    unawaited(_levelsSub?.cancel());
    _levelsSub = null;
    // Let a cut that's halfway through finish first (it won't restart now).
    await _pendingCut;
    final duration = detector.elapsed(_clock());
    final keep = flush && detector.heardSpeech;
    Uint8List? bytes;
    try {
      bytes = await recorder.stop();
    } catch (_) {}
    level.value = 0;
    speaking.value = false;
    if (keep && bytes != null && bytes.isNotEmpty) {
      _emit(RecordedSegment(bytes: bytes, durationMs: duration.inMilliseconds));
    }
  }

  void _onLevel(double db) {
    if (!_listening || _cutting) return;
    final now = _clock();
    final decision = detector.add(db, now);
    level.value = normalisedLevel(db);
    speaking.value = detector.speaking;
    if (decision == SegmentDecision.none) return;
    _pendingCut = _cut(upload: decision == SegmentDecision.cut, at: now);
  }

  /// Ends the segment and starts the next one at once, so as little as
  /// possible is missed between them.
  Future<void> _cut({required bool upload, required Duration at}) async {
    _cutting = true;
    final duration = detector.elapsed(at);
    Uint8List? bytes;
    try {
      bytes = await recorder.stop();
      if (_listening && !_disposed) await recorder.start();
    } catch (_) {
      // A failed restart: the next sample tries again via a fresh segment.
    } finally {
      detector.reset(_clock());
      _cutting = false;
    }
    if (upload && bytes != null && bytes.isNotEmpty) {
      _emit(RecordedSegment(bytes: bytes, durationMs: duration.inMilliseconds));
    }
  }

  void _emit(RecordedSegment segment) {
    if (!_segments.isClosed) _segments.add(segment);
  }

  Future<void> dispose() async {
    if (_disposed) return;
    await stop(flush: false);
    _disposed = true;
    await _segments.close();
    level.dispose();
    speaking.dispose();
    try {
      await recorder.dispose();
    } catch (_) {}
  }
}

/// dBFS to 0..1 for a level meter (-60 dBFS and below is empty).
double normalisedLevel(double db) {
  if (!db.isFinite) return 0;
  return ((db + 60) / 60).clamp(0.0, 1.0);
}
