import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import '../learn/live/realtime_client.dart';
import '../learn/live/speaker_embedder.dart';
import '../learn/live/speaker_model_store.dart';
import '../learn/live/voice_math.dart';
import '../learn/live/voice_repository.dart';
import '../models/live_practice.dart';
import '../services/api_client.dart';

/// What the user reads to make their voiceprint, one per take.
const voiceSentences = [
  "I'm practising for my interview, and this is how my voice sounds.",
  "I've worked on backend systems and I enjoy solving hard problems.",
  "Let me tell you about a project I'm proud of.",
];

/// What the voice setup says when the microphone permission is refused.
const voiceMicDeniedMessage =
    "Offerpath can't use the microphone. Allow it in your phone's settings "
    '(Apps → Offerpath → Permissions).';

/// The threshold slider's range.
const voiceThresholdMin = 0.2;
const voiceThresholdMax = 0.8;

/// Where the voice setup is.
enum VoiceStep {
  /// Looking for the voiceprint and the model.
  loading,

  /// That failed ([VoiceSetupController.error] says why).
  failed,

  /// The speaker model isn't on the phone yet.
  model,

  /// Reading the three sentences.
  enrol,

  /// The voiceprint is saved: test it, tune it, record again or delete it.
  ready,
}

enum _Recording { none, take, test }

/// "Your voice": downloads the speaker model, records the three sentences,
/// saves their averaged embedding as the user's voiceprint, and tests it
/// (`docs/live-practice.md`, "Your voice").
class VoiceSetupController extends ChangeNotifier {
  VoiceSetupController({
    required this.repo,
    this.maxTake = const Duration(seconds: 6),
    this.maxTest = const Duration(seconds: 6),
  }) : mic = repo.createMic();

  final VoiceRepository repo;
  final LiveMic mic;

  /// A recording stops by itself after this.
  final Duration maxTake;
  final Duration maxTest;

  VoiceStep step = VoiceStep.loading;

  /// Why loading, downloading or saving failed.
  String? error;

  /// The server's speaker model.
  SpeakerModelInfo? model;
  String? _modelPath;
  bool downloading = false;

  /// 0 to 1, null when the size isn't known.
  double? progress;

  VoiceProfile? profile;

  /// The voiceprint was made with another model: record again.
  bool get profileOutdated =>
      profile != null && model != null && profile!.model != model!.fileName;

  /// The takes' embeddings so far (normalised).
  final List<Float32List> _takes = [];

  /// Which sentence to read (0-based).
  int get take => _takes.length;
  String get sentence =>
      voiceSentences[math.min(take, voiceSentences.length - 1)];

  _Recording _recording = _Recording.none;
  bool get recording => _recording != _Recording.none;
  bool get recordingTake => _recording == _Recording.take;
  bool get recordingTest => _recording == _Recording.test;

  /// Embedding a recording.
  bool processing = false;

  /// Why the last recording can't be used; read the sentence again.
  String? takeProblem;
  bool saving = false;

  /// The input level, 0 to 1, for a meter.
  final ValueNotifier<double> level = ValueNotifier(0);

  /// How long the current recording is.
  final ValueNotifier<Duration> elapsed = ValueNotifier(Duration.zero);

  /// The last test's cosine similarity with the voiceprint.
  double? testSimilarity;

  /// The threshold on the slider (saved when it's let go).
  double threshold = defaultVoiceThreshold;
  bool savingThreshold = false;
  bool deleting = false;

  /// The last failed action, for a snack bar ([takeActionError]).
  String? _actionError;

  SpeakerEmbedder? _embedder;
  StreamSubscription<Uint8List>? _sub;
  Completer<void>? _streamDone;
  BytesBuilder _audio = BytesBuilder();
  Timer? _limit;
  bool _disposed = false;

  /// Whether the last test sounded like the user, at [threshold].
  bool? get testRecognised =>
      testSimilarity == null ? null : testSimilarity! >= threshold;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  String? takeActionError() {
    final e = _actionError;
    _actionError = null;
    return e;
  }

  Future<void> load() async {
    step = VoiceStep.loading;
    error = null;
    _notify();
    try {
      final info = await repo.modelInfo();
      final saved = await repo.profile();
      if (_disposed) return;
      model = info;
      profile = saved;
      threshold = _clampThreshold(saved?.threshold ?? defaultVoiceThreshold);
      if (info == null) {
        step = VoiceStep.failed;
        error = "The Offerpath server doesn't have the voice model yet. Ask whoever runs it to add it.";
        return;
      }
      _modelPath = await repo.models.localPath(info);
      step = _modelPath == null ? VoiceStep.model : _afterModel();
    } catch (e) {
      step = VoiceStep.failed;
      error = liveErrorMessage(e);
    } finally {
      _notify();
    }
  }

  VoiceStep _afterModel() =>
      profile == null || profileOutdated ? VoiceStep.enrol : VoiceStep.ready;

  static double _clampThreshold(double t) =>
      t.clamp(voiceThresholdMin, voiceThresholdMax).toDouble();

  // -- The model --------------------------------------------------------------

  Future<void> downloadModel() async {
    final info = model;
    if (info == null || downloading) return;
    downloading = true;
    progress = 0;
    error = null;
    _notify();
    try {
      _modelPath = await repo.models.download(
        info,
        onProgress: (p) {
          progress = p;
          _notify();
        },
      );
      if (_disposed) return;
      step = _afterModel();
    } catch (e) {
      error = switch (e) {
        ApiException() => liveErrorMessage(e),
        SpeakerModelException(:final message) => message,
        _ => "Couldn't download the voice model: $e",
      };
    } finally {
      downloading = false;
      _notify();
    }
  }

  SpeakerEmbedder _embedderNow() =>
      _embedder ??= repo.createEmbedder(_modelPath!);

  // -- Recording --------------------------------------------------------------

  /// Records the current sentence; it stops by itself after [maxTake], or
  /// with [stopRecording].
  Future<void> recordTake() => _start(_Recording.take, maxTake);

  /// Records a phrase to compare with the voiceprint.
  Future<void> recordTest() => _start(_Recording.test, maxTest);

  Future<void> _start(_Recording kind, Duration max) async {
    if (recording || processing || saving || _modelPath == null) return;
    takeProblem = null;
    if (kind == _Recording.test) testSimilarity = null;
    try {
      if (!await mic.hasPermission()) {
        takeProblem = voiceMicDeniedMessage;
        _notify();
        return;
      }
      final stream = await mic.start();
      if (_disposed) return;
      _audio = BytesBuilder();
      final done = _streamDone = Completer<void>();
      elapsed.value = Duration.zero;
      _sub = stream.listen(
        (chunk) {
          _audio.add(chunk);
          level.value = pcmLevel(chunk);
          elapsed.value = Duration(
            milliseconds: _audio.length ~/ (realtimeSampleRate * 2 ~/ 1000),
          );
        },
        onError: (Object _) {},
        onDone: () {
          if (!done.isCompleted) done.complete();
        },
      );
      _recording = kind;
      _limit = Timer(max, () => unawaited(stopRecording()));
    } catch (e) {
      takeProblem = "Couldn't start the microphone: $e";
    }
    _notify();
  }

  /// Stops recording and uses what was recorded.
  Future<void> stopRecording() async {
    final kind = _recording;
    if (kind == _Recording.none) return;
    _recording = _Recording.none;
    _limit?.cancel();
    _limit = null;
    processing = true;
    _notify();
    try {
      await mic.stop();
    } catch (_) {}
    // What was recorded before the stop still arrives.
    await _streamDone?.future.timeout(
      const Duration(seconds: 1),
      onTimeout: () {},
    );
    unawaited(_sub?.cancel());
    _sub = null;
    if (_disposed) return;
    level.value = 0;
    final bytes = _audio.takeBytes();
    try {
      if (kind == _Recording.take) {
        await _useTake(bytes);
      } else {
        await _useTest(bytes);
      }
    } finally {
      processing = false;
      _notify();
    }
  }

  /// The speech in [pcm] (24 kHz PCM16) at 16 kHz, or null with
  /// [takeProblem] set when it's too quiet or short.
  Float32List? _speech(Uint8List pcm, {required double minSeconds}) {
    final speech = trimSilence(
      speakerSamples(pcm, fromRate: realtimeSampleRate),
    );
    switch (checkTake(speech, minSeconds: minSeconds)) {
      case TakeProblem.tooQuiet:
        takeProblem =
            "That was too quiet. Hold the phone a little closer and try again.";
        return null;
      case TakeProblem.tooShort:
        takeProblem = 'That was too short. Read the whole sentence again.';
        return null;
      case null:
        return speech;
    }
  }

  Future<void> _useTake(Uint8List pcm) async {
    final speech = _speech(pcm, minSeconds: 2);
    if (speech == null) return;
    try {
      final embedding = await _embedderNow().embed(speech);
      if (_disposed) return;
      _takes.add(l2Normalize(embedding));
    } catch (e) {
      takeProblem = "Couldn't recognise that recording: $e";
      return;
    }
    if (_takes.length >= voiceSentences.length) await saveVoiceprint();
  }

  /// Saves the three takes' average as the voiceprint (again, after a
  /// failure).
  Future<void> saveVoiceprint() async {
    final info = model;
    if (info == null || _takes.length < voiceSentences.length || saving) {
      return;
    }
    saving = true;
    error = null;
    _notify();
    try {
      final saved = await repo.save(
        model: info.fileName,
        embedding: averageVoiceprint(_takes).toList(),
        threshold: defaultVoiceThreshold,
      );
      if (_disposed) return;
      profile = saved;
      threshold = _clampThreshold(saved.threshold);
      testSimilarity = null;
      _takes.clear();
      step = VoiceStep.ready;
    } catch (e) {
      error = liveErrorMessage(e);
    } finally {
      saving = false;
      _notify();
    }
  }

  /// Whether every take is in and only saving is left (it failed).
  bool get takesDone => _takes.length >= voiceSentences.length;

  Future<void> _useTest(Uint8List pcm) async {
    final current = profile;
    if (current == null) return;
    final speech = _speech(pcm, minSeconds: 1);
    if (speech == null) return;
    try {
      final embedding = await _embedderNow().embed(speech);
      testSimilarity = cosineSimilarity(embedding, current.embedding);
    } catch (e) {
      takeProblem = "Couldn't recognise that recording: $e";
    }
  }

  // -- The voiceprint ---------------------------------------------------------

  /// The slider moved (not saved yet).
  void previewThreshold(double value) {
    threshold = _clampThreshold(value);
    _notify();
  }

  /// The slider was let go: saves the threshold.
  Future<void> saveThreshold(double value) async {
    final before = profile?.threshold ?? defaultVoiceThreshold;
    threshold = _clampThreshold(value);
    savingThreshold = true;
    _notify();
    try {
      final saved = await repo.setThreshold(
        double.parse(threshold.toStringAsFixed(2)),
      );
      if (_disposed) return;
      profile = saved;
      threshold = _clampThreshold(saved.threshold);
    } catch (e) {
      threshold = _clampThreshold(before);
      _actionError = liveErrorMessage(e);
    } finally {
      savingThreshold = false;
      _notify();
    }
  }

  /// Records the three sentences again (the voiceprint is replaced once
  /// they're in).
  void recordAgain() {
    if (recording || processing || saving) return;
    _takes.clear();
    takeProblem = null;
    error = null;
    testSimilarity = null;
    step = VoiceStep.enrol;
    _notify();
  }

  /// Back to the saved voiceprint without recording again.
  void cancelRecordAgain() {
    if (profile == null || profileOutdated || recording || processing) return;
    _takes.clear();
    takeProblem = null;
    step = VoiceStep.ready;
    _notify();
  }

  Future<bool> deleteVoice() async {
    if (deleting) return false;
    deleting = true;
    _notify();
    try {
      await repo.delete();
      if (_disposed) return true;
      profile = null;
      testSimilarity = null;
      threshold = defaultVoiceThreshold;
      _takes.clear();
      step = VoiceStep.enrol;
      return true;
    } catch (e) {
      _actionError = liveErrorMessage(e);
      return false;
    } finally {
      deleting = false;
      _notify();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _limit?.cancel();
    unawaited(_sub?.cancel());
    unawaited(mic.dispose().catchError((Object _) {}));
    unawaited(_embedder?.dispose().catchError((Object _) {}));
    level.dispose();
    elapsed.dispose();
    super.dispose();
  }
}
