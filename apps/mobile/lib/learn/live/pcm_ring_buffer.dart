import 'dart:math' as math;
import 'dart:typed_data';

/// The last [capacityMs] of the audio sent on one realtime connection,
/// indexed by milliseconds since its first byte. OpenAI's voice detection
/// gives each turn's start and end in those milliseconds
/// (`input_audio_buffer.speech_started` / `speech_stopped`), and [slice] cuts
/// the turn out to check whose voice it is.
class PcmRingBuffer {
  PcmRingBuffer({this.capacityMs = 60000, this.bytesPerMs = 48})
    : _data = Uint8List(capacityMs * bytesPerMs);

  /// How much audio is kept.
  final int capacityMs;

  /// PCM16 mono at 24 kHz: 48 bytes per millisecond.
  final int bytesPerMs;

  final Uint8List _data;

  /// Bytes written since the last [reset].
  int _written = 0;

  /// Bytes written since the last [reset].
  int get totalBytes => _written;

  /// Milliseconds of audio written since the last [reset].
  int get totalMs => _written ~/ bytesPerMs;

  /// The first byte still held.
  int get _oldest => math.max(0, _written - _data.length);

  /// A new connection: the milliseconds start again from zero.
  void reset() => _written = 0;

  void add(List<int> bytes) {
    var src = bytes;
    // More than fits: only the newest part matters.
    if (src.length > _data.length) {
      _written += src.length - _data.length;
      src = src.sublist(src.length - _data.length);
    }
    var pos = _written % _data.length;
    var offset = 0;
    while (offset < src.length) {
      final n = math.min(src.length - offset, _data.length - pos);
      _data.setRange(pos, pos + n, src, offset);
      offset += n;
      pos = (pos + n) % _data.length;
    }
    _written += src.length;
  }

  /// The audio from [startMs] to [endMs] (an end past what was written is
  /// cut to it). Null when the start has already been overwritten, or there's
  /// nothing in the range.
  Uint8List? slice(int startMs, int endMs) {
    if (startMs < 0 || endMs <= startMs) return null;
    final start = startMs * bytesPerMs;
    final end = math.min(endMs * bytesPerMs, _written);
    if (start < _oldest || end <= start) return null;
    final out = Uint8List(end - start);
    var pos = start % _data.length;
    var offset = 0;
    while (offset < out.length) {
      final n = math.min(out.length - offset, _data.length - pos);
      out.setRange(offset, offset + n, _data, pos);
      offset += n;
      pos = (pos + n) % _data.length;
    }
    return out;
  }
}
