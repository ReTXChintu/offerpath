import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/voice_math.dart';

import '../support/fake_voice.dart';

Float32List _sine(int n, double hz, int rate, {double amplitude = 0.5}) =>
    Float32List.fromList([
      for (var i = 0; i < n; i++)
        amplitude * math.sin(2 * math.pi * hz * i / rate),
    ]);

void main() {
  group('resampleLinear', () {
    test('24 kHz to 16 kHz keeps the duration: 3 samples become 2', () {
      expect(resampleLinear(Float32List(24000), 24000, 16000).length, 16000);
      expect(resampleLinear(Float32List(3), 24000, 16000).length, 2);
      expect(resampleLinear(Float32List(0), 24000, 16000), isEmpty);
    });

    test('interpolates between neighbours at the right positions', () {
      // Output i sits at input position 1.5 * i.
      final ramp = Float32List.fromList([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(resampleLinear(ramp, 24000, 16000), [0, 1.5, 3, 4.5, 6, 7.5]);
      final up = resampleLinear(Float32List.fromList([0, 2, 4]), 8000, 16000);
      expect(up, [0, 1, 2, 3, 4, 4]);
    });

    test('a constant stays constant and the same rate is a copy', () {
      final flat = Float32List.fromList(List.filled(300, 0.25));
      expect(
        resampleLinear(flat, 24000, 16000).every((v) => v == 0.25),
        isTrue,
      );
      final same = resampleLinear(flat, 16000, 16000);
      expect(same, flat);
      expect(identical(same, flat), isFalse);
    });

    test('a 440 Hz tone is still 440 Hz at 16 kHz', () {
      final out = resampleLinear(_sine(24000, 440, 24000), 24000, 16000);
      final expected = _sine(16000, 440, 16000);
      var worst = 0.0;
      for (var i = 0; i < out.length; i++) {
        worst = math.max(worst, (out[i] - expected[i]).abs());
      }
      // Linear interpolation of a 440 Hz tone sampled at 24 kHz is close.
      expect(worst, lessThan(0.01));
    });

    test('rejects a rate of zero', () {
      expect(
        () => resampleLinear(Float32List(4), 0, 16000),
        throwsArgumentError,
      );
    });
  });

  test('PCM16 becomes samples in [-1, 1]; an odd byte is ignored', () {
    final samples = pcm16ToFloat([0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0x01]);
    expect(samples, hasLength(3));
    expect(samples[0], -1);
    expect(samples[1], closeTo(1, 0.0001));
    expect(samples[2], 0);
    // 24 kHz PCM16 to 16 kHz samples.
    expect(speakerSamples(tone(1500, 0.5), fromRate: 24000), hasLength(24000));
  });

  group('embeddings', () {
    test('cosine similarity', () {
      expect(cosineSimilarity([1, 0], [1, 0]), 1);
      expect(cosineSimilarity([1, 0], [0, 1]), 0);
      expect(cosineSimilarity([1, 0], [-2, 0]), -1);
      expect(cosineSimilarity([3, 4], [6, 8]), closeTo(1, 1e-9));
      expect(cosineSimilarity([1, 1], [1, 0]), closeTo(math.sqrt1_2, 1e-9));
      expect(cosineSimilarity([0, 0], [1, 0]), 0);
      expect(cosineSimilarity([1, 0], [1, 0, 0]), 0);
    });

    test('l2Normalize scales to length 1', () {
      expect(l2Normalize([3, 4]), [closeTo(0.6, 1e-6), closeTo(0.8, 1e-6)]);
      expect(l2Normalize([0, 0]), [0, 0]);
    });

    test(
      'a voiceprint normalises each embedding, averages, and normalises',
      () {
        // Without normalising first the long [0, 10] would dominate.
        final print = averageVoiceprint([
          [3, 4, 0],
          [0, 10, 0],
          [0, 0, 2],
        ]);
        final sum = [0.6, 1.8, 1.0];
        final norm = math.sqrt(sum.fold<double>(0, (a, v) => a + v * v));
        for (var i = 0; i < 3; i++) {
          expect(print[i], closeTo(sum[i] / norm, 1e-6));
        }
        expect(cosineSimilarity(print, print), closeTo(1, 1e-6));
        expect(() => averageVoiceprint([]), throwsArgumentError);
        expect(
          () => averageVoiceprint([
            [1, 0],
            [1, 0, 0],
          ]),
          throwsArgumentError,
        );
      },
    );
  });

  group('takes', () {
    test('silence either side is trimmed, keeping 100 ms around the sound', () {
      final samples = Float32List(16000 * 3)
        ..setAll(16000, _sine(16000, 220, 16000));
      final trimmed = trimSilence(samples);
      // One second of sound plus up to 100 ms either side.
      expect(trimmed.length, inInclusiveRange(16000, 16000 + 3200 + 640));
      expect(trimSilence(Float32List(16000)), isEmpty);
    });

    test('too quiet or too short is refused', () {
      final loud = _sine(16000 * 3, 220, 16000);
      expect(checkTake(loud), isNull);
      expect(checkTake(_sine(16000, 220, 16000)), TakeProblem.tooShort);
      expect(checkTake(_sine(16000, 220, 16000), minSeconds: 1), isNull);
      expect(
        checkTake(_sine(16000 * 3, 220, 16000, amplitude: 0.005)),
        TakeProblem.tooQuiet,
      );
      expect(checkTake(Float32List(0)), TakeProblem.tooQuiet);
    });
  });
}
