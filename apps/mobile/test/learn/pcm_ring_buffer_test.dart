import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/pcm_ring_buffer.dart';

/// [ms] milliseconds of PCM where every byte is [value].
List<int> _ms(int ms, int value) => List.filled(ms * 48, value);

void main() {
  test('slices by milliseconds since the first byte (48 bytes per ms)', () {
    final ring = PcmRingBuffer();
    ring
      ..add(_ms(100, 1))
      ..add(_ms(100, 2));
    expect(ring.totalMs, 200);
    expect(ring.slice(0, 100), _ms(100, 1));
    expect(ring.slice(90, 110), [..._ms(10, 1), ..._ms(10, 2)]);
    expect(ring.slice(150, 200), _ms(50, 2));
  });

  test('an end past what was sent is cut to it; an empty range is null', () {
    final ring = PcmRingBuffer()..add(_ms(100, 7));
    expect(ring.slice(50, 500), _ms(50, 7));
    expect(ring.slice(100, 200), isNull);
    expect(ring.slice(50, 50), isNull);
    expect(ring.slice(-10, 20), isNull);
  });

  test('keeps only the last capacity; older audio is gone', () {
    final ring = PcmRingBuffer(capacityMs: 100);
    ring
      ..add(_ms(60, 1))
      ..add(_ms(60, 2))
      ..add(_ms(30, 3));
    expect(ring.totalMs, 150);
    // 0-50 ms was overwritten.
    expect(ring.slice(0, 60), isNull);
    expect(ring.slice(40, 60), isNull);
    // Wraps around the end of the buffer.
    expect(ring.slice(50, 150), [..._ms(10, 1), ..._ms(60, 2), ..._ms(30, 3)]);
    expect(ring.slice(110, 130), [..._ms(10, 2), ..._ms(10, 3)]);
  });

  test('one write bigger than the buffer keeps its newest part', () {
    final ring = PcmRingBuffer(capacityMs: 10);
    ring.add([..._ms(10, 1), ..._ms(10, 2)]);
    expect(ring.totalMs, 20);
    expect(ring.slice(10, 20), _ms(10, 2));
    expect(ring.slice(5, 20), isNull);
  });

  test('a reconnect starts the milliseconds again from zero', () {
    final ring = PcmRingBuffer()..add(_ms(500, 1));
    ring.reset();
    expect(ring.totalMs, 0);
    expect(ring.slice(0, 100), isNull);
    ring.add(_ms(100, 9));
    expect(ring.slice(0, 100), _ms(100, 9));
  });
}
