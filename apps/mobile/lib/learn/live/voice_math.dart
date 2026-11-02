import 'dart:math' as math;
import 'dart:typed_data';

/// The audio arithmetic behind recognising the user's voice
/// (`docs/live-practice.md`, "Your voice"): PCM16 to float samples,
/// resampling the microphone's 24 kHz to the speaker model's 16 kHz, trimming
/// silence, and comparing embeddings. Both the voice setup and a session run
/// the same steps, so a voiceprint and a turn are measured alike.

/// The speaker model's sample rate.
const speakerSampleRate = 16000;

/// Little-endian PCM16 as samples in [-1, 1]. An odd last byte is ignored.
Float32List pcm16ToFloat(List<int> bytes) {
  final data = bytes is Uint8List ? bytes : Uint8List.fromList(bytes);
  final view = ByteData.sublistView(data);
  final n = data.length ~/ 2;
  final out = Float32List(n);
  for (var i = 0; i < n; i++) {
    out[i] = view.getInt16(i * 2, Endian.little) / 32768.0;
  }
  return out;
}

/// [input] at [fromRate] resampled to [toRate] by linear interpolation.
/// Output sample i sits at input position `i * fromRate / toRate`.
Float32List resampleLinear(Float32List input, int fromRate, int toRate) {
  if (fromRate <= 0 || toRate <= 0) {
    throw ArgumentError('Sample rates must be positive');
  }
  if (fromRate == toRate || input.isEmpty) return Float32List.fromList(input);
  final outLength = (input.length * toRate) ~/ fromRate;
  final out = Float32List(outLength);
  final last = input.length - 1;
  for (var i = 0; i < outLength; i++) {
    // Integer arithmetic for the position keeps it exact for 24k -> 16k.
    final pos = i * fromRate;
    final i0 = pos ~/ toRate;
    final frac = (pos - i0 * toRate) / toRate;
    final a = input[i0 > last ? last : i0];
    final b = input[i0 + 1 > last ? last : i0 + 1];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/// The root mean square of [samples], 0 for none.
double rms(List<double> samples) {
  if (samples.isEmpty) return 0;
  var sum = 0.0;
  for (final s in samples) {
    sum += s * s;
  }
  return math.sqrt(sum / samples.length);
}

/// [samples] without the quiet at either end. A 20 ms frame counts as sound
/// when its RMS is at least a tenth of the loudest frame's (and above a
/// floor); 100 ms either side of the sound is kept. Empty when nothing is
/// above the floor.
Float32List trimSilence(
  Float32List samples, {
  int sampleRate = speakerSampleRate,
  double floor = 0.003,
}) {
  final frame = sampleRate ~/ 50;
  if (frame <= 0 || samples.length < frame) return Float32List(0);
  final frames = samples.length ~/ frame;
  final levels = List<double>.generate(
    frames,
    (f) => rms(Float32List.sublistView(samples, f * frame, (f + 1) * frame)),
  );
  final loudest = levels.reduce(math.max);
  final threshold = math.max(floor, loudest * 0.1);
  final first = levels.indexWhere((l) => l >= threshold);
  if (first < 0) return Float32List(0);
  final lastFrame = levels.lastIndexWhere((l) => l >= threshold);
  final pad = sampleRate ~/ 10;
  final start = math.max(0, first * frame - pad);
  final end = math.min(samples.length, (lastFrame + 1) * frame + pad);
  return Float32List.fromList(Float32List.sublistView(samples, start, end));
}

/// [v] scaled to length 1 (all zeros stays all zeros).
Float32List l2Normalize(List<double> v) {
  var sum = 0.0;
  for (final x in v) {
    sum += x * x;
  }
  final norm = math.sqrt(sum);
  final out = Float32List(v.length);
  if (norm == 0) return out;
  for (var i = 0; i < v.length; i++) {
    out[i] = v[i] / norm;
  }
  return out;
}

/// The cosine similarity of [a] and [b], -1 to 1; 0 when either is all
/// zeros or their lengths differ.
double cosineSimilarity(List<double> a, List<double> b) {
  if (a.length != b.length || a.isEmpty) return 0;
  var dot = 0.0, na = 0.0, nb = 0.0;
  for (var i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na == 0 || nb == 0) return 0;
  return dot / (math.sqrt(na) * math.sqrt(nb));
}

/// The voiceprint of several embeddings: each normalised, averaged, and the
/// average normalised.
Float32List averageVoiceprint(List<List<double>> embeddings) {
  if (embeddings.isEmpty) throw ArgumentError('No embeddings');
  final dim = embeddings.first.length;
  if (embeddings.any((e) => e.length != dim)) {
    throw ArgumentError('Embeddings differ in length');
  }
  final sum = Float64List(dim);
  for (final e in embeddings) {
    final n = l2Normalize(e);
    for (var i = 0; i < dim; i++) {
      sum[i] += n[i];
    }
  }
  for (var i = 0; i < dim; i++) {
    sum[i] /= embeddings.length;
  }
  return l2Normalize(sum);
}

/// Why a recording can't be used.
enum TakeProblem { tooShort, tooQuiet }

/// Checks speech that [trimSilence] kept: at least [minSeconds] long and
/// loud enough (RMS of at least [minRms], about -40 dBFS). Null when it's
/// fine.
TakeProblem? checkTake(
  Float32List speech, {
  int sampleRate = speakerSampleRate,
  double minSeconds = 2,
  double minRms = 0.01,
}) {
  if (speech.isEmpty) return TakeProblem.tooQuiet;
  if (rms(speech) < minRms) return TakeProblem.tooQuiet;
  if (speech.length < minSeconds * sampleRate) return TakeProblem.tooShort;
  return null;
}

/// A turn is checked against the voiceprint in windows this long, one
/// starting every [speakerWindowHop]: a single score for the whole turn
/// blends both voices when the partner and the user speak without a pause.
const speakerWindow = Duration(milliseconds: 1500);
const speakerWindowHop = Duration(milliseconds: 750);

/// At most this many windows are checked per turn (spread evenly, first and
/// last included), so a long answer doesn't hold up the next question.
const speakerMaxWindows = 16;

/// How far below the threshold a window must score to count as someone
/// else's voice.
const speakerOtherMargin = 0.15;

/// The windows of a turn that hold speech (see [speakerWindow]). A window
/// quieter than a tenth of the loudest, or below [floor], is a pause and
/// skipped. A turn no longer than one window is one window; a silent one
/// has none.
List<Float32List> speechWindows(
  Float32List samples, {
  int sampleRate = speakerSampleRate,
  Duration window = speakerWindow,
  Duration hop = speakerWindowHop,
  int maxWindows = speakerMaxWindows,
  double floor = 0.003,
}) {
  final w = sampleRate * window.inMilliseconds ~/ 1000;
  final h = sampleRate * hop.inMilliseconds ~/ 1000;
  if (samples.length <= w) {
    return samples.isEmpty || rms(samples) < floor ? [] : [samples];
  }
  final starts = <int>[for (var s = 0; s + w <= samples.length; s += h) s];
  // One more ending at the end, so the turn's tail is checked too.
  if (starts.last + w < samples.length) starts.add(samples.length - w);
  final windows = [
    for (final s in starts) Float32List.sublistView(samples, s, s + w),
  ];
  final levels = windows.map(rms).toList();
  final quiet = math.max(floor, levels.reduce(math.max) * 0.1);
  final speech = [
    for (var i = 0; i < windows.length; i++)
      if (levels[i] >= quiet) windows[i],
  ];
  if (speech.length <= maxWindows) return speech;
  return [
    for (var i = 0; i < maxWindows; i++)
      speech[i * (speech.length - 1) ~/ (maxWindows - 1)],
  ];
}

/// Whether a turn is the user's, from each speech window's similarity to
/// the voiceprint: on average at or above [threshold], and no window
/// clearly someone else's (more than [margin] below it). A turn where both
/// spoke is the interviewer's, so the question in it still gets an answer;
/// the user's own words answered by mistake cost little, since anything
/// that isn't a question gets no answer.
bool isUsersTurn(
  List<double> scores,
  double threshold, {
  double margin = speakerOtherMargin,
}) {
  if (scores.isEmpty) return false;
  final mean = scores.reduce((a, b) => a + b) / scores.length;
  return mean >= threshold && scores.every((s) => s >= threshold - margin);
}

/// Microphone audio (PCM16 at [fromRate]) ready for the speaker model:
/// float samples at 16 kHz.
Float32List speakerSamples(List<int> pcm16, {required int fromRate}) =>
    resampleLinear(pcm16ToFloat(pcm16), fromRate, speakerSampleRate);
