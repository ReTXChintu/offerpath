import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:record/record.dart';
import 'package:web_socket_channel/io.dart';

import '../../models/live_practice.dart';

/// Live practice talks to OpenAI Realtime directly (`docs/live-practice.md`):
/// the phone streams the microphone up a WebSocket and OpenAI streams the
/// answers back. This file has the two pieces of hardware behind interfaces
/// (the socket and the microphone, so tests can use fakes), the events the
/// phone sends, and [LiveConversation], which turns OpenAI's events into
/// question-and-answer cards.

/// One open connection to OpenAI Realtime.
abstract interface class RealtimeSocket {
  /// The server's events, one JSON text per message. Done when the
  /// connection closes (for whatever reason).
  Stream<String> get messages;

  /// Sends one JSON event.
  void send(String data);

  /// Closes the connection (from this side).
  Future<void> close();
}

/// Opens a [RealtimeSocket] to [url] with [headers]; throws when the
/// handshake fails.
typedef RealtimeConnector = Future<RealtimeSocket> Function(
  Uri url,
  Map<String, String> headers,
);

/// [RealtimeConnector] on `web_socket_channel`.
Future<RealtimeSocket> connectRealtimeSocket(
  Uri url,
  Map<String, String> headers,
) async {
  final channel = IOWebSocketChannel.connect(
    url,
    headers: headers,
    connectTimeout: const Duration(seconds: 15),
    pingInterval: const Duration(seconds: 20),
  );
  await channel.ready;
  return _ChannelSocket(channel);
}

class _ChannelSocket implements RealtimeSocket {
  _ChannelSocket(this._channel);

  final IOWebSocketChannel _channel;

  @override
  Stream<String> get messages => _channel.stream.map(
    (m) => m is String ? m : utf8.decode(m as List<int>, allowMalformed: true),
  );

  @override
  void send(String data) => _channel.sink.add(data);

  @override
  Future<void> close() async {
    try {
      await _channel.sink.close();
    } catch (_) {}
  }
}

/// The microphone as a stream of raw audio: PCM16 little-endian, 24 kHz,
/// mono, which is what OpenAI Realtime takes.
abstract interface class LiveMic {
  /// Asks for the microphone permission when it hasn't been decided yet.
  Future<bool> hasPermission();

  /// Starts recording; the stream carries the audio as it's recorded.
  Future<Stream<Uint8List>> start();

  /// Stops recording (the stream ends).
  Future<void> stop();

  Future<void> dispose();
}

/// [LiveMic] on the `record` plugin.
class PlatformLiveMic implements LiveMic {
  PlatformLiveMic({AudioRecorder? recorder})
    : _recorder = recorder ?? AudioRecorder();

  final AudioRecorder _recorder;

  static const config = RecordConfig(
    encoder: AudioEncoder.pcm16bits,
    sampleRate: realtimeSampleRate,
    numChannels: 1,
  );

  @override
  Future<bool> hasPermission() => _recorder.hasPermission();

  @override
  Future<Stream<Uint8List>> start() => _recorder.startStream(config);

  @override
  Future<void> stop() async {
    await _recorder.stop();
  }

  @override
  Future<void> dispose() => _recorder.dispose();
}

const realtimeSampleRate = 24000;

/// 100 ms of PCM16 mono at 24 kHz.
const realtimeChunkBytes = realtimeSampleRate * 2 ~/ 10;

/// `input_audio_buffer.append` with [pcm] as base64.
Map<String, Object?> appendAudioEvent(List<int> pcm) => {
  'type': 'input_audio_buffer.append',
  'audio': base64Encode(pcm),
};

/// A typed question: the user item, then a request for the answer.
List<Map<String, Object?>> typedQuestionEvents(String text) => [
  {
    'type': 'conversation.item.create',
    'item': {
      'type': 'message',
      'role': 'user',
      'content': [
        {'type': 'input_text', 'text': text},
      ],
    },
  },
  {'type': 'response.create'},
];

/// The loudness of a stretch of PCM16 audio, 0 (silence, -60 dBFS and
/// below) to 1 (full scale), for a level meter.
double pcmLevel(List<int> pcm) {
  final samples = pcm.length ~/ 2;
  if (samples == 0) return 0;
  final data = ByteData.sublistView(Uint8List.fromList(pcm));
  var sum = 0.0;
  for (var i = 0; i < samples; i++) {
    final s = data.getInt16(i * 2, Endian.little) / 32768.0;
    sum += s * s;
  }
  final rms = math.sqrt(sum / samples);
  if (rms <= 0) return 0;
  final db = 20 * math.log(rms) / math.ln10;
  return ((db + 60) / 60).clamp(0.0, 1.0);
}

/// The model's reply when what was said isn't a question.
bool isNotAQuestion(String answer) {
  final t = answer.trim();
  return t.isEmpty || t == '-';
}

/// What a saved exchange says when the question's words weren't caught.
const liveQuestionNotCaptured = '(question not captured)';

/// What's being heard right now.
enum LiveSpeech {
  /// Nobody is speaking.
  quiet,

  /// Someone is speaking ("Listening…").
  hearing,

  /// They stopped; the answer is coming ("Thinking…").
  thinking,
}

enum LiveSaveState { none, saving, saved, failed }

/// One spoken (or typed) turn: a user item in OpenAI's conversation.
class LiveTurn {
  LiveTurn({this.itemId, this.text = '', this.done = false});

  final String? itemId;

  /// The transcript so far.
  String text;

  /// The transcript is complete (or failed: nothing more is coming).
  bool done;
}

/// One answer on screen, and the turns it answers.
class LiveCard {
  LiveCard({required this.id, required this.answerFor, this.responseId});

  /// Local; unique on this screen.
  final String id;
  final AnswerFor answerFor;
  final String? responseId;
  final List<LiveTurn> turns = [];
  String answer = '';

  /// The model finished (or the connection dropped mid-answer).
  bool answerDone = false;

  /// Handed over to be saved.
  bool finished = false;
  LiveSaveState save = LiveSaveState.none;
  String? saveError;

  /// The saved exchange's id.
  String? exchangeId;

  /// The question as heard so far (several turns when they were answered
  /// together).
  String get question =>
      turns.map((t) => t.text.trim()).where((t) => t.isNotEmpty).join(' ');

  /// Every turn's transcript is in.
  bool get questionDone => turns.every((t) => t.done);

  /// There's something to show: not empty and not the "not a question"
  /// reply.
  bool get hasAnswer => !isNotAQuestion(answer);
}

/// Turns OpenAI Realtime's server events into cards. Every turn OpenAI
/// answers becomes a card once its answer has real text; a reply of exactly
/// `-` (not a question) never shows. A finished card goes to [onFinished]
/// (to be saved) when its question's transcript is in, or after
/// [transcriptWait] with what was heard so far.
class LiveConversation {
  LiveConversation({
    required this.onChanged,
    required this.onFinished,
    required this.onError,
    this.answerFor = AnswerFor.me,
    this.transcriptWait = const Duration(seconds: 3),
  });

  final void Function() onChanged;
  final void Function(LiveCard card) onFinished;

  /// An `error` event (or a failed response): OpenAI's message as it is, and
  /// its code.
  final void Function(String message, String? code) onError;
  final Duration transcriptWait;

  /// Written on new cards.
  AnswerFor answerFor;

  /// Oldest first, including cards with nothing to show yet.
  final List<LiveCard> cards = [];

  /// The live caption: the newest turn's transcript.
  String caption = '';
  LiveSpeech speech = LiveSpeech.quiet;

  final Map<String, LiveTurn> _turns = {};

  /// Turns that no response has picked up yet.
  final List<LiveTurn> _waiting = [];
  final Map<String, LiveCard> _byResponse = {};
  final Map<LiveCard, Timer> _waits = {};
  LiveCard? _current;
  int _n = 0;
  bool _disposed = false;

  /// The cards worth showing, oldest first.
  List<LiveCard> get visibleCards => cards.where((c) => c.hasAnswer).toList();

  /// An answer is being written now.
  bool get answering => _current != null;

  /// One message from the socket.
  void handle(String raw) {
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } catch (_) {
      return;
    }
    if (decoded is Map) handleEvent(decoded.cast<String, dynamic>());
  }

  void handleEvent(Map<String, dynamic> e) {
    if (_disposed) return;
    final type = e['type'];
    switch (type) {
      case 'input_audio_buffer.speech_started':
        speech = LiveSpeech.hearing;
      case 'input_audio_buffer.speech_stopped':
        speech = LiveSpeech.thinking;
      case 'input_audio_buffer.committed':
        _turnFor(e['item_id']);
        if (speech == LiveSpeech.hearing) speech = LiveSpeech.thinking;
      case 'conversation.item.created' ||
          'conversation.item.added' ||
          'conversation.item.done':
        _onItem(e['item']);
      case 'conversation.item.input_audio_transcription.delta':
        final turn = _turnFor(e['item_id']);
        final delta = e['delta'];
        if (turn != null && !turn.done && delta is String) {
          turn.text += delta;
          caption = turn.text;
        }
      case 'conversation.item.input_audio_transcription.completed':
        final turn = _turnFor(e['item_id']);
        if (turn != null) {
          final transcript = e['transcript'];
          if (transcript is String) turn.text = transcript.trim();
          turn.done = true;
          if (turn.text.isNotEmpty) caption = turn.text;
          _transcriptIn(turn);
        }
      case 'conversation.item.input_audio_transcription.failed':
        final turn = _turnFor(e['item_id']);
        if (turn != null) {
          turn.done = true;
          _transcriptIn(turn);
        }
      case 'response.created':
        _onResponseCreated(e['response']);
      case 'response.output_text.delta' ||
          'response.text.delta' ||
          'response.output_audio_transcript.delta' ||
          'response.audio_transcript.delta':
        final card = _cardFor(e['response_id']);
        final delta = e['delta'];
        if (card != null && !card.answerDone && delta is String) {
          card.answer += delta;
        }
      case 'response.output_text.done' ||
          'response.text.done' ||
          'response.output_audio_transcript.done' ||
          'response.audio_transcript.done':
        final card = _cardFor(e['response_id']);
        if (card != null) {
          final text = e['text'] ?? e['transcript'];
          if (text is String && text.trim().isNotEmpty) card.answer = text;
          _complete(card);
        }
      case 'response.done':
        _onResponseDone(e['response']);
      case 'error':
        final err = e['error'];
        final map = err is Map ? err : const {};
        final message = map['message'];
        onError(
          message is String && message.trim().isNotEmpty
              ? message
              : 'OpenAI reported an error.',
          map['code']?.toString(),
        );
      default:
        return;
    }
    onChanged();
  }

  /// A typed question; the next response answers it.
  void addTyped(String text) {
    _waiting.add(LiveTurn(text: text, done: true));
  }

  /// The connection dropped: an answer being written is kept as it is (and
  /// saved), and turns nobody answered are forgotten.
  void interrupt() {
    final current = _current;
    if (current != null) _complete(current);
    for (final card in [..._byResponse.values]) {
      if (!card.answerDone) _complete(card);
    }
    _waiting.clear();
    speech = LiveSpeech.quiet;
    onChanged();
  }

  /// Hands over every finished card now, without waiting for transcripts
  /// (the session is ending).
  void finishAll() {
    interrupt();
    for (final card in [...cards]) {
      if (card.answerDone && card.hasAnswer) _finish(card);
    }
  }

  void dispose() {
    _disposed = true;
    for (final t in _waits.values) {
      t.cancel();
    }
    _waits.clear();
  }

  LiveTurn? _turnFor(Object? itemId) {
    if (itemId is! String || itemId.isEmpty) return null;
    final known = _turns[itemId];
    if (known != null) return known;
    final turn = LiveTurn(itemId: itemId);
    _turns[itemId] = turn;
    _waiting.add(turn);
    return turn;
  }

  /// A user audio item (beta `conversation.item.created`, GA
  /// `conversation.item.added` / `.done`) is a turn, like a commit.
  void _onItem(Object? item) {
    if (item is! Map || item['role'] != 'user') return;
    final content = item['content'];
    if (content is! List) return;
    final audio = content.whereType<Map>().where(
      (c) => c['type'] == 'input_audio',
    );
    if (audio.isEmpty) return;
    final turn = _turnFor(item['id']);
    final transcript = audio.first['transcript'];
    if (turn != null &&
        !turn.done &&
        transcript is String &&
        transcript.trim().isNotEmpty) {
      turn.text = transcript.trim();
      turn.done = true;
      _transcriptIn(turn);
    }
  }

  void _onResponseCreated(Object? response) {
    final id = response is Map ? response['id']?.toString() : null;
    if (id != null && _byResponse.containsKey(id)) return;
    final card = LiveCard(id: 'c${_n++}', answerFor: answerFor, responseId: id);
    card.turns.addAll(_waiting);
    _waiting.clear();
    if (id != null) _byResponse[id] = card;
    _current = card;
    cards.add(card);
    speech = speech == LiveSpeech.hearing
        ? LiveSpeech.hearing
        : LiveSpeech.thinking;
  }

  void _onResponseDone(Object? response) {
    final r = response is Map ? response : const {};
    final card = _cardFor(r['id']);
    if (r['status'] == 'failed') {
      final details = r['status_details'];
      final error = details is Map ? details['error'] : null;
      final message = error is Map ? error['message'] : null;
      if (message is String && message.trim().isNotEmpty) {
        onError(message, error is Map ? error['code']?.toString() : null);
      }
    }
    if (card != null) {
      if (card.answer.trim().isEmpty) card.answer = _outputText(r['output']);
      _complete(card);
    }
    if (speech == LiveSpeech.thinking) speech = LiveSpeech.quiet;
  }

  /// The text in a finished response's output items.
  static String _outputText(Object? output) {
    if (output is! List) return '';
    final parts = <String>[];
    for (final item in output.whereType<Map>()) {
      final content = item['content'];
      if (content is! List) continue;
      for (final c in content.whereType<Map>()) {
        final text = c['text'] ?? c['transcript'];
        if (text is String) parts.add(text);
      }
    }
    return parts.join();
  }

  LiveCard? _cardFor(Object? responseId) {
    if (responseId is String && _byResponse.containsKey(responseId)) {
      return _byResponse[responseId];
    }
    return _current;
  }

  void _complete(LiveCard card) {
    if (card.answerDone) return;
    card.answerDone = true;
    if (identical(_current, card)) _current = null;
    if (!card.hasAnswer) {
      cards.remove(card);
      if (card.responseId != null) _byResponse.remove(card.responseId);
      return;
    }
    if (card.questionDone) {
      _finish(card);
    } else {
      _waits[card] = Timer(transcriptWait, () {
        _waits.remove(card);
        if (_disposed) return;
        _finish(card);
        onChanged();
      });
    }
  }

  void _transcriptIn(LiveTurn turn) {
    for (final card in cards) {
      if (card.turns.contains(turn) &&
          card.answerDone &&
          !card.finished &&
          card.questionDone) {
        _finish(card);
      }
    }
  }

  void _finish(LiveCard card) {
    if (card.finished) return;
    card.finished = true;
    _waits.remove(card)?.cancel();
    onFinished(card);
  }
}
