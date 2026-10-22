import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import '../learn/live/pcm_ring_buffer.dart';
import '../learn/live/realtime_client.dart';
import '../learn/live/speaker_embedder.dart';
import '../learn/live/voice_math.dart';
import '../models/live_practice.dart';
import '../services/api_client.dart';

/// What the screen says when the microphone permission is refused.
const liveMicDeniedMessage =
    "Offerpath can't use the microphone. Allow it in your phone's settings "
    '(Apps → Offerpath → Permissions), or type a question below.';

/// What the screen says when the phone can't tell the user's voice apart.
const liveVoiceHint =
    'Set up your voice so only the interviewer gets answers';

/// A turn shorter than this is too short to tell whose voice it is; it
/// counts as the interviewer's.
const liveMinCheckedTurn = Duration(seconds: 1);

/// Loads what a session needs to recognise the user's voice; null when it
/// can't (then every turn is answered).
typedef LiveVoiceLoader = Future<LiveVoice?> Function();

/// The connection to OpenAI Realtime.
enum LiveConnection { offline, connecting, connected, reconnecting }

/// One spoken turn's voice check, by OpenAI's item id.
class _TurnCheck {
  int? startMs;
  int? endMs;
  bool committed = false;
  LiveRole? role;
  bool asked = false;
}

/// One live-practice session on screen. Listening gets a realtime pass from
/// the API, connects to OpenAI and streams the microphone ~100 ms at a time,
/// keeping the last minute of it. When OpenAI's voice detection ends a turn,
/// the turn's audio is compared with the user's voiceprint: the user's own
/// turns (the interviewee's) are only captioned, and an answer is asked for
/// each of the interviewer's (`docs/live-practice.md`). [conversation] turns
/// OpenAI's events into captions and answer cards, and each finished card is
/// saved as an exchange. A dropped connection is reconnected with a new pass
/// while listening. Also: typed questions, ending and deleting.
class LivePracticeController extends ChangeNotifier {
  LivePracticeController({
    required this.api,
    required this.sessionId,
    LivePracticeView? initial,
    LiveMic? mic,
    RealtimeConnector? connect,
    this._loadVoice,
    this.reconnectDelays = const [
      Duration(seconds: 1),
      Duration(seconds: 2),
      Duration(seconds: 4),
    ],
    this.saveRetryDelays = const [Duration(seconds: 1), Duration(seconds: 3)],
    Duration transcriptWait = const Duration(seconds: 3),
  }) : view = initial,
       mic = mic ?? PlatformLiveMic(),
       _connector = connect ?? connectRealtimeSocket {
    conversation = LiveConversation(
      onChanged: _notify,
      onFinished: (card) => unawaited(_save(card)),
      onError: _onRealtimeError,
      checksSpeakers: true,
      transcriptWait: transcriptWait,
    );
  }

  final ApiClient api;
  final String sessionId;
  final LiveMic mic;
  final RealtimeConnector _connector;
  final LiveVoiceLoader? _loadVoice;

  /// Waits between reconnect attempts (the first one is immediate).
  final List<Duration> reconnectDelays;

  /// Waits between attempts to save an exchange.
  final List<Duration> saveRetryDelays;
  late final LiveConversation conversation;

  LivePracticeView? view;

  /// Why the first load failed (nothing to show yet).
  Object? loadError;

  LiveConnection connection = LiveConnection.offline;

  /// The mic is on.
  bool listening = false;

  /// Asking for the permission / connecting / starting the recorder.
  bool startingMic = false;

  /// Why listening couldn't start (permission refused, ...).
  String? micError;

  /// OpenAI's (or the server's) last error, word for word, until dismissed.
  String? banner;

  bool ending = false;

  /// The user's voiceprint and the model to compare turns with it; null
  /// when it isn't set up (then every turn is answered).
  LiveVoice? voice;

  /// The voice has been looked for ([loadVoice]).
  bool voiceChecked = false;
  Future<void>? _voiceLoading;

  /// Typed questions being sent.
  int asking = 0;

  /// The input level, 0 to 1, for a meter.
  final ValueNotifier<double> level = ValueNotifier(0);

  /// The last failed action, for a snack bar ([takeActionError]).
  String? _actionError;

  RealtimeSocket? _socket;
  StreamSubscription<String>? _socketSub;
  Future<bool>? _connecting;
  bool _reconnecting = false;

  /// Completes when the running reconnect is over.
  Completer<void>? _reconnectDone;
  StreamSubscription<Uint8List>? _micSub;
  final BytesBuilder _pending = BytesBuilder();

  /// What was sent on this connection, by milliseconds since its first byte.
  final PcmRingBuffer _sentAudio = PcmRingBuffer();

  /// Counts connections, so a voice check that finishes after a reconnect
  /// is dropped.
  int _connectionNo = 0;
  final Map<String, _TurnCheck> _checks = {};

  /// Turns waiting for an answer to be asked for (one answer at a time).
  final List<LiveTurn> _toAnswer = [];

  /// An answer was asked for and isn't done yet.
  bool _answerActive = false;

  /// ... and hasn't started either.
  bool _answerRequested = false;
  final Set<Future<void>> _saves = {};
  final Set<Timer> _timers = {};
  bool _disposed = false;
  bool _loading = false;

  bool get isEnded => view?.isEnded ?? false;

  /// Show "set up your voice": it's been looked for and isn't there.
  bool get showVoiceHint => voiceChecked && voice == null;

  /// Cards to show while the session runs, newest first.
  List<LiveCard> get cards => conversation.visibleCards.reversed.toList();

  /// Saved exchanges that aren't on screen as a card already, newest first.
  List<LiveExchange> get earlierExchanges {
    final shown = {
      for (final c in conversation.cards)
        if (c.exchangeId != null) c.exchangeId,
    };
    return (view?.exchanges ?? const <LiveExchange>[])
        .where((e) => !shown.contains(e.id))
        .toList()
        .reversed
        .toList();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _apply(LivePracticeView next) {
    if (_disposed) return;
    view = next;
    loadError = null;
    _notify();
  }

  /// The failed action's sentence, once.
  String? takeActionError() {
    final e = _actionError;
    _actionError = null;
    return e;
  }

  void _fail(Object error) {
    _actionError = liveErrorMessage(error);
    _notify();
  }

  void dismissBanner() {
    if (banner == null) return;
    banner = null;
    _notify();
  }

  Future<void> load() async {
    if (_loading || _disposed) return;
    _loading = true;
    try {
      _apply(await api.getLivePractice(sessionId));
    } catch (error) {
      if (view == null) loadError = error;
      _notify();
    } finally {
      _loading = false;
    }
  }

  // -- Your voice -------------------------------------------------------------

  /// Looks for the user's voiceprint (once; [reloadVoice] looks again).
  Future<void> loadVoice() => _voiceLoading ??= _loadVoiceNow();

  Future<void> _loadVoiceNow() async {
    LiveVoice? found;
    try {
      found = await _loadVoice?.call();
    } catch (_) {
      found = null;
    }
    if (_disposed) {
      unawaited(found?.dispose().catchError((Object _) {}));
      return;
    }
    final old = voice;
    voice = found;
    voiceChecked = true;
    if (old != null && !identical(old, found)) {
      unawaited(old.dispose().catchError((Object _) {}));
    }
    _notify();
  }

  /// Looks for the voiceprint again (after the voice setup).
  Future<void> reloadVoice() {
    _voiceLoading = null;
    return loadVoice();
  }

  /// Who spoke each turn, from OpenAI's voice detection events.
  void _route(Map<String, dynamic> e) {
    final itemId = e['item_id'];
    switch (e['type']) {
      case 'input_audio_buffer.speech_started':
        if (itemId is! String) return;
        _checkFor(itemId).startMs = _intOf(e['audio_start_ms']);
      case 'input_audio_buffer.speech_stopped':
        if (itemId is! String) return;
        final check = _checkFor(itemId)..endMs = _intOf(e['audio_end_ms']);
        _classify(itemId, check);
      case 'input_audio_buffer.committed':
        if (itemId is! String) return;
        final check = _checkFor(itemId)..committed = true;
        if (check.role == null && check.endMs == null) {
          // No end of speech was seen: nothing to check.
          _decide(itemId, check, LiveRole.interviewer);
        } else {
          _askIfReady(itemId, check);
        }
      case 'response.created':
        _answerRequested = false;
      case 'response.done':
        _answerActive = false;
        _answerRequested = false;
        _askNext();
      case 'error':
        final err = e['error'];
        final code = err is Map ? err['code'] : null;
        if (code == 'conversation_already_has_active_response') {
          // Ours was refused: ask again when that one is done.
          _toAnswer.insertAll(0, conversation.withdrawExpected());
          _answerActive = true;
          _answerRequested = false;
        } else if (_answerRequested) {
          // The request itself failed; don't wait for it.
          conversation.withdrawExpected();
          _answerActive = false;
          _answerRequested = false;
          _askNext();
        }
    }
  }

  static int? _intOf(Object? v) => v is num ? v.toInt() : null;

  _TurnCheck _checkFor(String itemId) {
    final known = _checks[itemId];
    if (known != null) return known;
    if (_checks.length > 200) _checks.remove(_checks.keys.first);
    return _checks[itemId] = _TurnCheck();
  }

  /// Compares the turn's audio with the voiceprint. Too short, not in the
  /// buffer, or no voice set up: the interviewer's.
  void _classify(String itemId, _TurnCheck check) {
    if (check.role != null) return;
    final voice = this.voice;
    final start = check.startMs, end = check.endMs;
    if (voice == null ||
        start == null ||
        end == null ||
        end - start < liveMinCheckedTurn.inMilliseconds) {
      _decide(itemId, check, LiveRole.interviewer);
      return;
    }
    final pcm = _sentAudio.slice(start, end);
    if (pcm == null) {
      _decide(itemId, check, LiveRole.interviewer);
      return;
    }
    final connectionNo = _connectionNo;
    unawaited(() async {
      var role = LiveRole.interviewer;
      try {
        final similarity = await voice.similarity(
          speakerSamples(pcm, fromRate: realtimeSampleRate),
        );
        if (similarity >= voice.threshold) role = LiveRole.interviewee;
      } catch (_) {}
      if (_disposed || connectionNo != _connectionNo) return;
      _decide(itemId, check, role);
    }());
  }

  void _decide(String itemId, _TurnCheck check, LiveRole role) {
    if (check.role != null) return;
    check.role = role;
    conversation.setRole(itemId, role);
    _askIfReady(itemId, check);
  }

  /// The interviewer's turn is in the conversation: ask for its answer.
  void _askIfReady(String itemId, _TurnCheck check) {
    if (check.asked || !check.committed || check.role != LiveRole.interviewer) {
      return;
    }
    check.asked = true;
    final turn = conversation.turn(itemId);
    if (turn != null) _ask(turn);
  }

  /// Asks for an answer to [turn], or queues it while one is being written.
  void _ask(LiveTurn turn) {
    _toAnswer.add(turn);
    _askNext();
  }

  void _askNext() {
    if (_answerActive || _toAnswer.isEmpty || _socket == null) return;
    conversation.expectAnswer(List.of(_toAnswer));
    _toAnswer.clear();
    _answerActive = true;
    _answerRequested = true;
    _send(responseCreateEvent);
  }

  /// A new connection: new milliseconds, nothing pending.
  void _resetTurns() {
    _connectionNo++;
    _sentAudio.reset();
    _checks.clear();
    _toAnswer.clear();
    _answerActive = false;
    _answerRequested = false;
  }

  void _onMessage(String raw) {
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } catch (_) {
      return;
    }
    if (decoded is! Map) return;
    final event = decoded.cast<String, dynamic>();
    conversation.handleEvent(event);
    if (!_disposed) _route(event);
  }

  // -- Connection -------------------------------------------------------------

  /// A pass from the API, then the socket. Throws when either fails.
  Future<void> _open() async {
    final pass = await api.livePracticeRealtime(sessionId);
    if (_disposed) return;
    final socket = await _connector(Uri.parse(pass.url), {
      'Authorization': 'Bearer ${pass.clientSecret}',
    });
    if (_disposed) {
      unawaited(socket.close());
      return;
    }
    _resetTurns();
    _socket = socket;
    _socketSub = socket.messages.listen(
      _onMessage,
      onError: (Object _) {},
      onDone: () => _onClosed(socket),
    );
    connection = LiveConnection.connected;
    _notify();
  }

  Future<bool> _ensureConnected() async {
    // A reconnect is running: wait for it rather than open a second socket.
    final reconnect = _reconnectDone;
    if (reconnect != null) await reconnect.future;
    if (_socket != null) return true;
    return _connecting ??= _connectFirst().whenComplete(
      () => _connecting = null,
    );
  }

  Future<bool> _connectFirst() async {
    connection = LiveConnection.connecting;
    _notify();
    try {
      await _open();
      return _socket != null;
    } catch (error) {
      _connectFailed(error);
      return false;
    }
  }

  void _connectFailed(Object error) {
    connection = LiveConnection.offline;
    banner = _connectError(error);
    // The session ended elsewhere: show it as ended.
    if (error is ApiException && error.status == 409) unawaited(load());
    _notify();
  }

  static String _connectError(Object error) {
    if (error is ApiException) return liveErrorMessage(error);
    return "Couldn't connect to OpenAI: $error";
  }

  /// Retrying won't help: no key, ended, not found, ...
  static bool _fatal(Object error) =>
      error is ApiException && error.status >= 400 && error.status < 500;

  /// The socket closed. Expected when this side closed it; otherwise
  /// reconnect while listening.
  void _onClosed(RealtimeSocket socket) {
    if (!identical(socket, _socket) || _disposed) return;
    _socket = null;
    _socketSub = null;
    if (listening) {
      unawaited(_reconnect());
    } else {
      conversation.interrupt();
      connection = LiveConnection.offline;
      _notify();
    }
  }

  void _closeSocket() {
    final socket = _socket;
    _socket = null;
    _resetTurns();
    unawaited(_socketSub?.cancel());
    _socketSub = null;
    if (socket != null) unawaited(socket.close());
    connection = LiveConnection.offline;
  }

  /// A new pass and a new socket, a few times with a growing wait. The cards
  /// stay; an answer cut off midway is kept as it was.
  Future<void> _reconnect() async {
    if (_reconnecting || _disposed) return;
    _reconnecting = true;
    final done = _reconnectDone = Completer<void>();
    _closeSocket();
    conversation.interrupt();
    connection = LiveConnection.reconnecting;
    _notify();
    Object? failure;
    for (var attempt = 0; attempt <= reconnectDelays.length; attempt++) {
      if (attempt > 0) await _sleep(reconnectDelays[attempt - 1]);
      if (_disposed || !listening || isEnded) {
        failure = null;
        break;
      }
      try {
        await _open();
        failure = null;
        break;
      } catch (error) {
        failure = error;
        if (_fatal(error)) break;
      }
    }
    _reconnecting = false;
    _reconnectDone = null;
    done.complete();
    if (_disposed) return;
    if (_socket == null) connection = LiveConnection.offline;
    if (failure != null) {
      _connectFailed(failure);
      await pauseListening();
    }
    _notify();
  }

  void _send(Map<String, Object?> event) {
    _socket?.send(jsonEncode(event));
  }

  void _onRealtimeError(String message, String? code) {
    // An answer was asked for while one was being written: it's asked again
    // when that one is done.
    if (code == 'conversation_already_has_active_response') return;
    final expired =
        code == 'session_expired' ||
        message.toLowerCase().contains('maximum duration');
    if (expired) {
      if (listening) {
        unawaited(_reconnect());
      } else {
        _closeSocket();
        conversation.interrupt();
      }
      return;
    }
    banner = message;
  }

  // -- Microphone -------------------------------------------------------------

  /// Turns the mic on: the permission, a connection, then the audio. Returns
  /// whether it's listening.
  Future<bool> startListening() async {
    if (listening || startingMic || isEnded || _disposed) return listening;
    startingMic = true;
    micError = null;
    _notify();
    try {
      if (!await mic.hasPermission()) {
        micError = liveMicDeniedMessage;
        return false;
      }
      if (_disposed || !await _ensureConnected() || _disposed) return false;
      // Turns are checked against the voiceprint from the first one.
      await loadVoice();
      if (_disposed) return false;
      final stream = await mic.start();
      if (_disposed) return false;
      _micSub = stream.listen(_onAudio, onError: (Object _) {});
      listening = true;
      return true;
    } catch (error) {
      micError = "Couldn't start the microphone: $error";
      return false;
    } finally {
      startingMic = false;
      _notify();
    }
  }

  void _onAudio(Uint8List chunk) {
    _pending.add(chunk);
    if (_pending.length >= realtimeChunkBytes) _flushAudio();
  }

  /// Sends what's been recorded (whole samples only; an odd byte waits).
  void _flushAudio() {
    var bytes = _pending.takeBytes();
    if (bytes.length.isOdd) {
      _pending.addByte(bytes.last);
      bytes = Uint8List.sublistView(bytes, 0, bytes.length - 1);
    }
    if (bytes.isEmpty) return;
    level.value = pcmLevel(bytes);
    // Not connected (reconnecting): the audio is dropped.
    if (_socket != null) _sendAudio(bytes);
  }

  /// Sends audio and keeps it, so a turn can be cut out of it.
  void _sendAudio(Uint8List bytes) {
    _sentAudio.add(bytes);
    _send(appendAudioEvent(bytes));
  }

  /// Turns the mic off. Speech cut off midway is still answered: a second
  /// of silence lets OpenAI see the end of it.
  Future<void> pauseListening() async {
    if (!listening) return;
    listening = false;
    _notify();
    final sub = _micSub;
    _micSub = null;
    // Not awaited: no more audio is delivered either way, and the future can
    // belong to another zone.
    unawaited(sub?.cancel());
    try {
      await mic.stop();
    } catch (_) {}
    _flushAudio();
    _pending.clear();
    if (conversation.speech == LiveSpeech.hearing && _socket != null) {
      _sendAudio(Uint8List(realtimeSampleRate * 2));
    }
    if (!_disposed) level.value = 0;
  }

  Future<void> toggleListening() =>
      listening ? pauseListening() : startListening();

  // -- Questions and answers --------------------------------------------------

  /// A typed question, answered like the interviewer's spoken ones. Returns
  /// whether it was sent.
  Future<bool> ask(String text) async {
    final t = text.trim();
    if (t.isEmpty || isEnded || _disposed) return false;
    if (t.length > 2000) {
      _actionError = 'Keep it under 2,000 characters.';
      _notify();
      return false;
    }
    asking++;
    _notify();
    try {
      if (!await _ensureConnected() || _disposed) return false;
      final turn = conversation.addTyped(t);
      _send(typedQuestionItem(t));
      _ask(turn);
      return true;
    } finally {
      asking--;
      _notify();
    }
  }

  Future<void> _save(LiveCard card) {
    final future = _saveNow(card);
    _saves.add(future);
    return future.whenComplete(() => _saves.remove(future));
  }

  Future<void> _saveNow(LiveCard card) async {
    if (card.save == LiveSaveState.saving || card.save == LiveSaveState.saved) {
      return;
    }
    card
      ..save = LiveSaveState.saving
      ..saveError = null;
    _notify();
    final question = card.question.isEmpty
        ? liveQuestionNotCaptured
        : card.question;
    for (var attempt = 0; ; attempt++) {
      try {
        final exchange = await api.saveLivePracticeExchange(
          sessionId,
          question: question,
          answer: card.answer,
        );
        card
          ..exchangeId = exchange.id
          ..save = LiveSaveState.saved;
        break;
      } catch (error) {
        final ended = error is ApiException && error.status == 409;
        if (ended || _disposed || attempt >= saveRetryDelays.length) {
          card
            ..save = LiveSaveState.failed
            ..saveError = liveErrorMessage(error);
          break;
        }
        await _sleep(saveRetryDelays[attempt]);
      }
    }
    _notify();
  }

  /// Tries a failed save again.
  Future<void> retrySave(LiveCard card) {
    if (card.save != LiveSaveState.failed) return Future.value();
    return _save(card);
  }

  /// Stops listening, saves the answers on screen, closes the connection and
  /// ends the session.
  Future<bool> end() async {
    if (ending || isEnded) return false;
    ending = true;
    _notify();
    try {
      await pauseListening();
      conversation.finishAll();
      _closeSocket();
      if (_saves.isNotEmpty) {
        await Future.wait([..._saves])
            .timeout(const Duration(seconds: 15), onTimeout: () => const []);
      }
      _apply(await api.endLivePractice(sessionId));
      return true;
    } catch (error) {
      _fail(error);
      return false;
    } finally {
      ending = false;
      _notify();
    }
  }

  Future<bool> delete() async {
    try {
      await pauseListening();
      _closeSocket();
      await api.deleteLivePractice(sessionId);
      return true;
    } catch (error) {
      _fail(error);
      return false;
    }
  }

  /// A wait that [dispose] cancels.
  Future<void> _sleep(Duration d) {
    final done = Completer<void>();
    late final Timer timer;
    timer = Timer(d, () {
      _timers.remove(timer);
      done.complete();
    });
    _timers.add(timer);
    return done.future;
  }

  @override
  void dispose() {
    _disposed = true;
    for (final t in _timers) {
      t.cancel();
    }
    _timers.clear();
    unawaited(_micSub?.cancel());
    _micSub = null;
    listening = false;
    unawaited(mic.dispose().catchError((Object _) {}));
    _closeSocket();
    unawaited(voice?.dispose().catchError((Object _) {}));
    voice = null;
    conversation.dispose();
    level.dispose();
    super.dispose();
  }
}
