import 'dart:async';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:sherpa_onnx/sherpa_onnx.dart' as sherpa;

import 'voice_math.dart';

/// Turns speech into a speaker embedding: a vector that is close (cosine)
/// for the same voice and far for different ones. On the phone it's
/// sherpa-onnx with the WeSpeaker model the app downloads
/// ([SherpaSpeakerEmbedder]); tests use a fake, so they never load the
/// native library.
abstract interface class SpeakerEmbedder {
  /// The embedding of [samples16k]: mono, 16 kHz, in [-1, 1].
  Future<Float32List> embed(Float32List samples16k);

  Future<void> dispose();
}

/// Makes a [SpeakerEmbedder] for the model file at [modelPath].
typedef SpeakerEmbedderFactory = SpeakerEmbedder Function(String modelPath);

/// [SpeakerEmbedderFactory] on sherpa-onnx.
SpeakerEmbedder sherpaSpeakerEmbedder(String modelPath) =>
    SherpaSpeakerEmbedder(modelPath);

/// The user's voiceprint and how to compare a turn with it, for one session.
class LiveVoice {
  LiveVoice({
    required this.embedder,
    required List<double> voiceprint,
    required this.threshold,
  }) : voiceprint = l2Normalize(voiceprint);

  final SpeakerEmbedder embedder;

  /// Normalised.
  final Float32List voiceprint;

  /// At or above it, a turn is the user's.
  final double threshold;

  /// How similar [samples16k] is to the user's voice (cosine, -1 to 1).
  Future<double> similarity(Float32List samples16k) async =>
      cosineSimilarity(await embedder.embed(samples16k), voiceprint);

  Future<void> dispose() => embedder.dispose();
}

/// sherpa-onnx's speaker embedding extractor in its own isolate, so a
/// turn's few hundred milliseconds of work never block the UI. The isolate
/// starts (and loads the model) on the first [embed].
class SherpaSpeakerEmbedder implements SpeakerEmbedder {
  SherpaSpeakerEmbedder(this.modelPath, {this.numThreads = 2});

  final String modelPath;
  final int numThreads;
  Future<_EmbedWorker>? _worker;
  bool _disposed = false;

  @override
  Future<Float32List> embed(Float32List samples16k) async {
    if (_disposed) throw StateError('The voice model was closed.');
    final starting = _worker ??= _EmbedWorker.spawn(modelPath, numThreads);
    final _EmbedWorker worker;
    try {
      worker = await starting;
    } catch (_) {
      // Let the next call try again.
      if (identical(_worker, starting)) _worker = null;
      rethrow;
    }
    if (_disposed) {
      worker.close();
      throw StateError('The voice model was closed.');
    }
    return worker.embed(samples16k);
  }

  @override
  Future<void> dispose() async {
    _disposed = true;
    final starting = _worker;
    _worker = null;
    if (starting == null) return;
    try {
      (await starting).close();
    } catch (_) {}
  }
}

/// One isolate holding a loaded extractor; requests are answered in order.
class _EmbedWorker {
  _EmbedWorker._(this._isolate, this._commands, this._port);

  final Isolate _isolate;
  final SendPort _commands;
  final RawReceivePort _port;
  final Map<int, Completer<Float32List>> _pending = {};
  int _next = 0;
  bool _closed = false;

  static Future<_EmbedWorker> spawn(String modelPath, int numThreads) async {
    final port = RawReceivePort();
    final ready = Completer<SendPort>();
    _EmbedWorker? worker;
    port.handler = (Object? message) {
      final w = worker;
      if (w != null) {
        w._onMessage(message);
      } else if (message is SendPort) {
        ready.complete(message);
      } else if (!ready.isCompleted) {
        ready.completeError(
          StateError(
            message is String ? message : "The voice model didn't load.",
          ),
        );
      }
    };
    final Isolate isolate;
    try {
      isolate = await Isolate.spawn(
        _embedMain,
        (port.sendPort, modelPath, numThreads),
        onExit: port.sendPort,
        onError: port.sendPort,
        debugName: 'speaker-embedder',
      );
    } catch (_) {
      port.close();
      rethrow;
    }
    try {
      final commands = await ready.future;
      return worker = _EmbedWorker._(isolate, commands, port);
    } catch (_) {
      port.close();
      isolate.kill(priority: Isolate.immediate);
      rethrow;
    }
  }

  Future<Float32List> embed(Float32List samples) {
    if (_closed) return Future.error(StateError('The voice model was closed.'));
    final id = _next++;
    final done = Completer<Float32List>();
    _pending[id] = done;
    _commands.send((id, samples));
    return done.future;
  }

  void _onMessage(Object? message) {
    if (message case (
      final int id,
      final Float32List? embedding,
      final String? error,
    )) {
      final done = _pending.remove(id);
      if (done == null) return;
      if (embedding != null && embedding.isNotEmpty) {
        done.complete(embedding);
      } else {
        done.completeError(StateError(error ?? 'No embedding.'));
      }
      return;
    }
    // The isolate exited (null) or failed ([error, stack]).
    _failAll(StateError("The voice model stopped: $message"));
    _closed = true;
    _port.close();
  }

  void _failAll(Object error) {
    for (final done in _pending.values) {
      done.completeError(error);
    }
    _pending.clear();
  }

  void close() {
    if (_closed) return;
    _closed = true;
    _commands.send('close');
    _failAll(StateError('The voice model was closed.'));
    _port.close();
    // It exits on its own after freeing the model; this is a backstop.
    Timer(const Duration(seconds: 5), () => _isolate.kill());
  }
}

/// The isolate: loads the model, then answers `(id, samples)` with
/// `(id, embedding, error)` until it's sent anything else.
void _embedMain((SendPort, String, int) args) {
  final (reply, modelPath, numThreads) = args;
  final sherpa.SpeakerEmbeddingExtractor extractor;
  try {
    sherpa.initBindings();
    extractor = sherpa.SpeakerEmbeddingExtractor(
      config: sherpa.SpeakerEmbeddingExtractorConfig(
        model: modelPath,
        numThreads: numThreads,
        debug: false,
      ),
    );
  } catch (error) {
    reply.send("The voice model didn't load: $error");
    return;
  }
  final commands = ReceivePort();
  reply.send(commands.sendPort);
  commands.listen((message) {
    if (message case (final int id, final Float32List samples)) {
      try {
        final stream = extractor.createStream();
        try {
          stream.acceptWaveform(
            samples: samples,
            sampleRate: speakerSampleRate,
          );
          stream.inputFinished();
          if (!extractor.isReady(stream)) {
            reply.send((id, null, 'Too short to recognise.'));
          } else {
            reply.send((id, extractor.compute(stream), null));
          }
        } finally {
          stream.free();
        }
      } catch (error) {
        reply.send((id, null, '$error'));
      }
      return;
    }
    extractor.free();
    commands.close();
  });
}
