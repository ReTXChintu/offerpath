import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:offerpath_mobile/learn/live/realtime_client.dart';
import 'package:offerpath_mobile/learn/live/speaker_embedder.dart';
import 'package:offerpath_mobile/learn/live/speaker_model_store.dart';
import 'package:offerpath_mobile/learn/live/voice_math.dart';
import 'package:offerpath_mobile/learn/live/voice_repository.dart';
import 'package:offerpath_mobile/models/live_practice.dart';
import 'package:offerpath_mobile/services/api_client.dart';

import 'fake_realtime.dart';

/// The amplitude of the user's voice in tests; [otherVoice] is anyone
/// else's. [FakeEmbedder.byLoudness] tells them apart by loudness.
const ownerVoice = 0.5;
const otherVoice = 0.15;

/// [ms] of a 220 Hz tone at [amplitude] as PCM16 little-endian at
/// [rate] (24 kHz: what the microphone records).
Uint8List tone(int ms, double amplitude, {int rate = realtimeSampleRate}) {
  final n = rate * ms ~/ 1000;
  final data = ByteData(n * 2);
  for (var i = 0; i < n; i++) {
    final v = amplitude * math.sin(2 * math.pi * 220 * i / rate);
    data.setInt16(i * 2, (v * 32767).round(), Endian.little);
  }
  return data.buffer.asUint8List();
}

/// A [SpeakerEmbedder] with no model. By default the embedding says whose
/// voice it is from the loudness: [ownerVoice] is `[1, 0]`, quieter is
/// `[0, 1]`. Or [queue] hands out set embeddings in order.
class FakeEmbedder implements SpeakerEmbedder {
  FakeEmbedder({this.queue});

  /// Embeddings to return, first first (instead of by loudness).
  final List<List<double>>? queue;

  /// While set, [embed] waits for it.
  Completer<void>? hold;
  final List<Float32List> calls = [];
  bool disposed = false;

  static Float32List byLoudness(Float32List samples) =>
      Float32List.fromList(rms(samples) > 0.25 ? [1, 0] : [0, 1]);

  @override
  Future<Float32List> embed(Float32List samples16k) async {
    calls.add(samples16k);
    final h = hold;
    if (h != null) await h.future;
    final q = queue;
    if (q != null && q.isNotEmpty) return Float32List.fromList(q.removeAt(0));
    return byLoudness(samples16k);
  }

  @override
  Future<void> dispose() async => disposed = true;
}

/// A [SpeakerModelStore] with no files: the model is on the phone once
/// [path] is set; [download] sets it.
class FakeModelStore implements SpeakerModelStore {
  FakeModelStore({this.path});

  String? path;
  int downloads = 0;

  /// Fail the next download with this.
  Object? failWith;

  @override
  Future<String?> localPath(SpeakerModelInfo info) async => path;

  @override
  Future<String> download(
    SpeakerModelInfo info, {
    void Function(double? progress)? onProgress,
  }) async {
    downloads++;
    final fail = failWith;
    if (fail != null) {
      failWith = null;
      throw fail;
    }
    onProgress?.call(0.5);
    await Future<void>.delayed(Duration.zero);
    onProgress?.call(1);
    return path = '/models/${info.fileName}';
  }
}

const speakerModelFile = 'wespeaker_en_voxceleb_resnet34_LM.onnx';

Map<String, Object?> speakerModelJson({String fileName = speakerModelFile}) => {
  'fileName': fileName,
  'sizeBytes': 26 * 1024 * 1024,
  'sha256': 'ab' * 32,
  'url': '/api/v1/downloads/speaker-model/file',
};

Map<String, Object?> voiceProfileJson({
  String model = speakerModelFile,
  List<double> embedding = const [1, 0],
  double threshold = 0.5,
}) => {
  'model': model,
  'embedding': embedding,
  'threshold': threshold,
  'updatedAt': '2026-10-21T09:00:00.000Z',
};

/// A [VoiceRepository] on fakes.
VoiceRepository fakeVoiceRepo(
  ApiClient api, {
  FakeModelStore? models,
  FakeEmbedder? embedder,
  FakeLiveMic? mic,
  MemoryVoiceCache? cache,
}) => VoiceRepository(
  api: api,
  models: models ?? FakeModelStore(path: '/models/$speakerModelFile'),
  createEmbedder: (_) => embedder ?? FakeEmbedder(),
  createMic: () => mic ?? FakeLiveMic(),
  cache: cache ?? MemoryVoiceCache(),
);

/// The voice a session uses: the user's voiceprint `[1, 0]`.
LiveVoice fakeLiveVoice(FakeEmbedder embedder, {double threshold = 0.5}) =>
    LiveVoice(
      embedder: embedder,
      voiceprint: const [1, 0],
      threshold: threshold,
    );
